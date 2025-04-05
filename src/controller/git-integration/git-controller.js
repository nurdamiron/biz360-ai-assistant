// src/controller/git-integration/git-controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const GitClient = require('../../utils/git-client');
const path = require('path');
const fs = require('fs');
const websocket = require('../../websocket');
const notificationManager = require('../../utils/notification-manager');
/**
 * Контроллер для Git-интеграции
 */
const gitController = {
  /**
   * Инициализирует Git репозиторий для проекта
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async initializeRepository(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { repositoryUrl, localPath } = req.body;
      
      if (!repositoryUrl) {
        return res.status(400).json({ error: 'Необходимо указать URL репозитория' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Проект не найден' });
      }
      
      const project = projects[0];
      
      // Определяем путь к локальному репозиторию
      const repoPath = localPath || path.join(process.env.REPOSITORIES_PATH || '/tmp/repos', `project-${projectId}`);
      
      // Создаем директорию, если она не существует
      if (!fs.existsSync(repoPath)) {
        fs.mkdirSync(repoPath, { recursive: true });
      }
      
      // Инициализируем Git клиент
      const gitClient = new GitClient(repoPath);
      
      // Клонируем репозиторий
      await gitClient.clone(repositoryUrl);
      
      // Обновляем запись о проекте с информацией о репозитории
      await connection.query(
        'UPDATE projects SET repository_url = ?, repository_path = ? WHERE id = ?',
        [repositoryUrl, repoPath, projectId]
      );
      
      connection.release();
      
      logger.info(`Репозиторий инициализирован для проекта #${projectId}: ${repositoryUrl}`);
      
      res.json({
        success: true,
        message: 'Репозиторий успешно инициализирован',
        data: {
          projectId,
          repositoryUrl,
          localPath: repoPath
        }
      });
    } catch (error) {
      logger.error(`Ошибка при инициализации репозитория для проекта #${req.params.projectId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при инициализации репозитория' });
    }
  },

  /**
   * Создает ветку для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createTaskBranch(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path, p.repository_url FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const task = tasks[0];
      
      // Проверяем, что репозиторий инициализирован
      if (!task.repository_path) {
        connection.release();
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      
      // Инициализируем Git клиент
      const gitClient = new GitClient(task.repository_path);
      
      // Создаем ветку для задачи
      const branchName = await gitClient.createTaskBranch(taskId, task.title);
      
      // Обновляем задачу с информацией о ветке
      await connection.query(
        'UPDATE tasks SET git_branch = ? WHERE id = ?',
        [branchName, taskId]
      );
      
      connection.release();
      
      // Логируем создание ветки
      await taskLogger.logInfo(taskId, `Создана Git-ветка "${branchName}" для задачи`);
      
      // Отправляем уведомление через WebSockets
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_branch_created',
          taskId,
          branchName
        });
      }
      
      res.json({
        success: true,
        message: 'Ветка для задачи успешно создана',
        data: {
          taskId,
          branchName
        }
      });
    } catch (error) {
      logger.error(`Ошибка при создании ветки для задачи #${req.params.taskId}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.taskId), `Ошибка при создании Git-ветки: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при создании ветки для задачи' });
    }
  },

  /**
   * Создает коммит изменений для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async commitTaskChanges(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const { message, files } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Необходимо указать сообщение коммита' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const task = tasks[0];
      
      // Проверяем, что репозиторий инициализирован
      if (!task.repository_path) {
        connection.release();
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      
      // Проверяем, что у задачи есть ветка
      if (!task.git_branch) {
        connection.release();
        return res.status(400).json({ error: 'Ветка для задачи не создана' });
      }
      
      // Инициализируем Git клиент
      const gitClient = new GitClient(task.repository_path);
      
      // Переключаемся на ветку задачи
      await gitClient.checkout(task.git_branch);
      
      // Создаем коммит
      const commitOutput = await gitClient.createTaskCommit(taskId, message, files);
      
      // Извлекаем хеш коммита из вывода (зависит от версии Git, это простой подход)
      const commitHash = commitOutput.match(/\[([^\]]+)\]/)?.[1] || '';
      
      // Сохраняем информацию о коммите в базе данных
      await connection.query(
        'INSERT INTO task_commits (task_id, commit_hash, message, created_at) VALUES (?, ?, ?, NOW())',
        [taskId, commitHash, message]
      );
      
      connection.release();
      
      // Логируем создание коммита
      await taskLogger.logInfo(taskId, `Изменения закоммичены: ${message}`);

      // Отправляем уведомление только автору задачи и текущему исполнителю
if (task.created_by && task.created_by !== req.user.id) {
    await notificationManager.sendNotification({
      type: 'task_changes_committed',
      userId: task.created_by,
      title: 'Коммит в ветке задачи',
      message: `В ветке задачи "${task.title}" сделан коммит: ${message}`,
      projectId: task.project_id,
      taskId,
      data: {
        taskId,
        taskTitle: task.title,
        commitMessage: message,
        commitHash,
        committedBy: req.user.username
      }
    });
  }
  
  // Если исполнитель не является ни автором задачи, ни текущим пользователем
  if (task.assigned_to && task.assigned_to !== req.user.id && task.assigned_to !== task.created_by) {
    await notificationManager.sendNotification({
      type: 'task_changes_committed',
      userId: task.assigned_to,
      title: 'Коммит в ветке задачи',
      message: `В ветке задачи "${task.title}" сделан коммит: ${message}`,
      projectId: task.project_id,
      taskId,
      data: {
        taskId,
        taskTitle: task.title,
        commitMessage: message,
        commitHash,
        committedBy: req.user.username
      }
    });
  }

  
      
      // Отправляем уведомление через WebSockets
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_changes_committed',
          taskId,
          message,
          commitHash
        });
      }
      
      res.json({
        success: true,
        message: 'Изменения успешно закоммичены',
        data: {
          taskId,
          commitHash,
          commitMessage: message
        }
      });
    } catch (error) {
      logger.error(`Ошибка при создании коммита для задачи #${req.params.taskId}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.taskId), `Ошибка при создании коммита: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при создании коммита' });
    }
  },

  /**
   * Создает Pull Request для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createPullRequest(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const { title, description, targetBranch } = req.body;
      
      if (!title) {
        return res.status(400).json({ error: 'Необходимо указать заголовок Pull Request' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path, p.repository_url FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const task = tasks[0];
      
      // Проверяем, что репозиторий инициализирован
      if (!task.repository_path || !task.repository_url) {
        connection.release();
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      
      // Проверяем, что у задачи есть ветка
      if (!task.git_branch) {
        connection.release();
        return res.status(400).json({ error: 'Ветка для задачи не создана' });
      }
      
      // Инициализируем Git клиент
      const gitClient = new GitClient(task.repository_path);
      
      // Отправляем ветку в удаленный репозиторий
      await gitClient.push('origin', task.git_branch);
      
      // Создаем Pull Request
      const prResult = await gitClient.createPullRequest({
        title: title || `[Задача #${taskId}] ${task.title}`,
        description: description || task.description,
        sourceBranch: task.git_branch,
        targetBranch: targetBranch || 'main'
      });
      
      // Сохраняем информацию о Pull Request в базе данных
      await connection.query(
        'INSERT INTO task_pull_requests (task_id, pr_url, title, created_at) VALUES (?, ?, ?, NOW())',
        [taskId, prResult.url, title]
      );
      
      // Обновляем статус задачи, если настроено
      // Это может быть на основе настроек проекта
      
      connection.release();
      
      // Логируем создание Pull Request
      await taskLogger.logInfo(taskId, `Создан Pull Request: ${title}`);
      
      // Отправляем уведомление о создании PR
// Сначала получим информацию о команде проекта
const teamConnection = await pool.getConnection();
const [projectTeam] = await teamConnection.query(
  `SELECT u.id 
   FROM project_team pt 
   JOIN users u ON pt.user_id = u.id 
   WHERE pt.project_id = ? AND (pt.role = 'developer' OR pt.role = 'reviewer' OR pt.role = 'manager')`,
  [task.project_id]
);
teamConnection.release();

// Отправляем уведомления всем членам команды
for (const member of projectTeam) {
  await notificationManager.sendNotification({
    type: 'pull_request_created',
    userId: member.id,
    title: 'Создан Pull Request',
    message: `Для задачи "${task.title}" был создан Pull Request: ${title}`,
    projectId: task.project_id,
    taskId,
    data: {
      taskId,
      taskTitle: task.title,
      prTitle: title,
      prUrl: prResult.url,
      createdBy: req.user.username
    }
  });
}

      // Отправляем уведомление через WebSockets
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_pr_created',
          taskId,
          prUrl: prResult.url,
          title
        });
      }
      
      res.json({
        success: true,
        message: 'Pull Request успешно создан',
        data: {
          taskId,
          prUrl: prResult.url,
          title
        }
      });
    } catch (error) {
      logger.error(`Ошибка при создании Pull Request для задачи #${req.params.taskId}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.taskId), `Ошибка при создании Pull Request: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при создании Pull Request' });
    }
  },

  /**
   * Получает Git-статус задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskGitStatus(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const task = tasks[0];
      
      // Проверяем, что репозиторий инициализирован
      if (!task.repository_path) {
        connection.release();
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      
      // Получаем коммиты для задачи
      const [commits] = await connection.query(
        'SELECT * FROM task_commits WHERE task_id = ? ORDER BY created_at DESC',
        [taskId]
      );
      
      // Получаем Pull Requests для задачи
      const [pullRequests] = await connection.query(
        'SELECT * FROM task_pull_requests WHERE task_id = ? ORDER BY created_at DESC',
        [taskId]
      );
      
      connection.release();
      
      // Если у задачи есть ветка, получаем git-статус
      let statusOutput = null;
      if (task.git_branch) {
        const gitClient = new GitClient(task.repository_path);
        try {
          // Переключаемся на ветку задачи
          await gitClient.checkout(task.git_branch);
          statusOutput = await gitClient.status();
        } catch (gitError) {
          logger.warn(`Ошибка при получении git-статуса для задачи #${taskId}:`, gitError);
        }
      }
      
      res.json({
        taskId,
        branch: task.git_branch,
        status: statusOutput,
        commits,
        pullRequests
      });
    } catch (error) {
      logger.error(`Ошибка при получении git-статуса для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении git-статуса задачи' });
    }
  }
};

module.exports = gitController;
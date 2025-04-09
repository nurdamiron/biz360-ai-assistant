// src/controller/git-integration/git-controller.js

// !!!ВАЖНО!!!
// Этот контроллер все еще ОЧЕНЬ "толстый". В идеале, вся логика работы с БД
// и координация между сервисами (GitService, PRManager, TaskLogger, NotificationManager)
// должна быть вынесена в отдельные сервисы (ProjectService, TaskService).
// Пока оставляем так для демонстрации использования GitService и PRManager.

const { pool } = require('../../config/db.config'); // TODO: Заменить на вызовы сервиса работы с БД
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger'); // TODO: Тоже может быть частью TaskService
const GitService = require('../../core/vcs-manager/gitService'); // <-- ИЗМЕНЕНО
const PRManager = require('../../core/vcs-manager/pr-manager'); // <-- ИЗМЕНЕНО
const path = require('path');
const fs = require('fs').promises; // Используем async fs
const websocket = require('../../websocket');
const notificationManager = require('../../utils/notification-manager'); // TODO: Тоже может быть частью сервисов
const config = require('../../config/app.config'); // Используем общий конфиг

// Вспомогательная функция для получения пути к репо (заглушка)
// В реальном приложении логика может быть сложнее
function getRepositoryPath(projectId) {
  const basePath = process.env.REPOSITORIES_PATH || config.paths?.repositories || '/tmp/repos';
  return path.join(basePath, `project-${projectId}`);
}

// Вспомогательная функция для получения API клиента хостинга (заглушка)
// В реальном приложении здесь будет логика выбора клиента (GitHub, GitLab)
// и его инициализации с нужными токенами/ключами.
function getHostingApiClient(repositoryUrl) {
    // Пока возвращаем заглушку из PRManager, но лучше иметь фабрику
    // const { HostingApiClientStub } = require('../../core/vcs-manager/pr-manager'); // Плохо так делать
    // return new HostingApiClientStub(repositoryUrl);
    logger.warn('Using HostingApiClientStub. Implement actual API client retrieval.');
    return undefined; // PRManager создаст заглушку сам
}


/**
 * Контроллер для Git-интеграции (рефакторинг)
 */
const gitController = {
  /**
   * Инициализирует Git репозиторий для проекта
   */
  async initializeRepository(req, res) {
    const projectId = parseInt(req.params.projectId);
    const { repositoryUrl, localPath } = req.body; // localPath - опционально

    if (!repositoryUrl) {
      return res.status(400).json({ error: 'Необходимо указать URL репозитория' });
    }

    let connection;
    try {
      connection = await pool.getConnection(); // TODO: Заменить на вызов ProjectService.getProject(projectId)
      const [projects] = await connection.query('SELECT * FROM projects WHERE id = ?', [projectId]);

      if (projects.length === 0) {
        return res.status(404).json({ error: 'Проект не найден' });
      }

      const repoPath = localPath || getRepositoryPath(projectId);

      // Создаем директорию асинхронно
      await fs.mkdir(repoPath, { recursive: true });

      // Используем GitService для клонирования
      const gitService = new GitService(repoPath); // Создаем инстанс для пути

      // Проверяем, не клонирован ли уже
       if (await gitService.isRepo()) {
            logger.warn(`Repository at ${repoPath} already exists. Skipping clone.`);
            // Можно добавить логику pull или проверки remote URL
       } else {
           await gitService.clone(repositoryUrl, repoPath); // Клонируем в указанный путь
       }

      // Обновляем запись о проекте
      await connection.query( // TODO: Заменить на ProjectService.updateProject(...)
        'UPDATE projects SET repository_url = ?, repository_path = ? WHERE id = ?',
        [repositoryUrl, repoPath, projectId]
      );

      logger.info(`Репозиторий инициализирован/проверен для проекта #${projectId}: ${repositoryUrl} по пути ${repoPath}`);

      res.json({
        success: true,
        message: 'Репозиторий успешно инициализирован или уже существует',
        data: { projectId, repositoryUrl, localPath: repoPath }
      });

    } catch (error) {
      logger.error(`Ошибка при инициализации репозитория для проекта #${projectId}:`, error);
      res.status(500).json({ error: `Ошибка сервера при инициализации репозитория: ${error.message}` });
    } finally {
      if (connection) connection.release();
    }
  },

  /**
   * Создает ветку для задачи
   */
  async createTaskBranch(req, res) {
    const taskId = parseInt(req.params.taskId);
    let connection;

    try {
      connection = await pool.getConnection(); // TODO: Заменить на вызов TaskService.getTaskWithProject(taskId)
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path, p.repository_url FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );

      if (tasks.length === 0) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      const task = tasks[0];

      if (!task.repository_path) {
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }

      // Используем GitService
      const gitService = new GitService(task.repository_path);

      // Генерируем имя ветки (бизнес-логика, может быть в TaskService)
      const branchName = `feature/task-${taskId}-${task.title.toLowerCase().replace(/\s+/g, '-')}`;
      // Проверка на спецсимволы в имени ветки

      // Переключаемся на базовую ветку (например, main) и обновляем ее
      const baseBranch = 'main'; // TODO: Сделать настраиваемым
      await gitService.checkout(baseBranch);
      await gitService.pull('origin', baseBranch);

      // Создаем новую ветку из актуальной базовой и переключаемся на нее
      await gitService.createBranch(branchName, true); // true - checkout new branch

      // Обновляем задачу в БД
      await connection.query( // TODO: Заменить на TaskService.updateTask(...)
        'UPDATE tasks SET git_branch = ? WHERE id = ?',
        [branchName, taskId]
      );

      await taskLogger.logInfo(taskId, `Создана Git-ветка "${branchName}" для задачи`);

      // Уведомления (оставим пока здесь)
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_branch_created', taskId, branchName
        });
      }

      res.json({
        success: true,
        message: 'Ветка для задачи успешно создана',
        data: { taskId, branchName }
      });

    } catch (error) {
      logger.error(`Ошибка при создании ветки для задачи #${taskId}:`, error);
      try { await taskLogger.logError(taskId, `Ошибка при создании Git-ветки: ${error.message}`); } catch (logError) { logger.error('Не удалось записать ошибку в лог задачи:', logError); }
      res.status(500).json({ error: `Ошибка сервера при создании ветки: ${error.message}` });
    } finally {
      if (connection) connection.release();
    }
  },

  /**
   * Создает коммит изменений для задачи
   */
  async commitTaskChanges(req, res) {
    const taskId = parseInt(req.params.taskId);
    const { message, files } = req.body; // files - опциональный массив файлов для add

    if (!message) {
      return res.status(400).json({ error: 'Необходимо указать сообщение коммита' });
    }

    let connection;
    try {
      connection = await pool.getConnection(); // TODO: TaskService.getTaskWithProject(taskId)
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );

      if (tasks.length === 0) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      const task = tasks[0];

      if (!task.repository_path) {
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      if (!task.git_branch) {
        return res.status(400).json({ error: 'Ветка для задачи не создана' });
      }

      // Используем GitService
      const gitService = new GitService(task.repository_path);

      // Переключаемся на ветку задачи
      await gitService.checkout(task.git_branch);

      // Добавляем файлы (если указаны, иначе git commit -a не сработает надежно)
      // Лучше требовать явного указания файлов или делать git add . перед коммитом
      if (files && files.length > 0) {
           await gitService.add(files);
      } else {
           // Если файлы не указаны, можно попытаться добавить все измененные, но это рискованно
           logger.warn('No specific files provided for commit, attempting to add all changes. Consider explicit file list.');
           await gitService.add('.'); // Добавить все изменения
      }

      // Создаем коммит
      // Добавляем ID задачи в сообщение коммита (бизнес-логика)
      const commitMessage = `[Task #${taskId}] ${message}`;
      const commitResult = await gitService.commit(commitMessage); // simple-git сам обрабатывает случай "nothing to commit"

      if (commitResult.commit) { // Если коммит был создан
          // Сохраняем информацию о коммите
          await connection.query( // TODO: TaskService.addCommit(...)
            'INSERT INTO task_commits (task_id, commit_hash, message, created_at) VALUES (?, ?, ?, NOW())',
            [taskId, commitResult.commit, message] // Сохраняем оригинальное сообщение
          );
          await taskLogger.logInfo(taskId, `Изменения закоммичены: ${commitMessage} (hash: ${commitResult.commit})`);

         // Уведомления
         // ... (логика уведомлений осталась прежней) ...
        if (task.created_by && task.created_by !== req.user.id) {
          await notificationManager.sendNotification({ /* ... */ });
        }
        if (task.assigned_to && task.assigned_to !== req.user.id && task.assigned_to !== task.created_by) {
          await notificationManager.sendNotification({ /* ... */ });
        }
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_changes_committed', taskId, message: commitMessage, commitHash: commitResult.commit
          });
        }

          res.json({
            success: true,
            message: 'Изменения успешно закоммичены',
            data: { taskId, commitHash: commitResult.commit, commitMessage }
          });
      } else {
          // Если коммитить было нечего
          logger.warn(`No changes to commit for task #${taskId}`);
          res.json({
              success: true, // Операция не ошибка, просто нет изменений
              message: 'Нет изменений для коммита',
              data: { taskId, commitHash: null, commitMessage: null }
          });
      }

    } catch (error) {
      logger.error(`Ошибка при создании коммита для задачи #${taskId}:`, error);
      try { await taskLogger.logError(taskId, `Ошибка при создании коммита: ${error.message}`); } catch (logError) { logger.error('Не удалось записать ошибку в лог задачи:', logError); }
      res.status(500).json({ error: `Ошибка сервера при создании коммита: ${error.message}` });
    } finally {
      if (connection) connection.release();
    }
  },

  /**
   * Создает Pull Request для задачи
   */
  async createPullRequest(req, res) {
    const taskId = parseInt(req.params.taskId);
    const { title, description, targetBranch } = req.body; // targetBranch - опционально, по умолч. 'main'

    if (!title) {
      return res.status(400).json({ error: 'Необходимо указать заголовок Pull Request' });
    }

    let connection;
    try {
      connection = await pool.getConnection(); // TODO: TaskService.getTaskWithProject(taskId)
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path, p.repository_url FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );

      if (tasks.length === 0) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      const task = tasks[0];

      if (!task.repository_path || !task.repository_url) {
        return res.status(400).json({ error: 'Репозиторий проекта не инициализирован' });
      }
      if (!task.git_branch) {
        return res.status(400).json({ error: 'Ветка для задачи не создана или не сохранена' });
      }

      // Получаем API клиент для хостинга
      const apiClient = getHostingApiClient(task.repository_url);

      // Используем PRManager
      const prManager = new PRManager(task.repository_path, task.repository_url, apiClient);

      // Определяем целевую ветку
      const baseBranch = targetBranch || config.git?.defaultBaseBranch || 'main';

      // Создаем PR через PRManager
      const prResult = await prManager.createPR({
        title: title || `[Задача #${taskId}] ${task.title}`, // Используем title из запроса или генерируем
        body: description, // Описание из запроса или будет сгенерировано PRManager'ом
        headBranch: task.git_branch,
        baseBranch: baseBranch,
        taskId: taskId,
        taskTitle: task.title,
        // repositoryUrl: task.repository_url // PRManager уже знает URL
      });

      // Проверяем результат от PRManager
      if (!prResult.success) {
         // Вероятно, были конфликты
         logger.warn(`Failed to create PR for task #${taskId}: ${prResult.message}`);
         return res.status(409).json({ // 409 Conflict
             success: false,
             error: prResult.message,
             conflicts: prResult.conflicts
         });
      }

      // Сохраняем информацию о PR в БД
      await connection.query( // TODO: TaskService.addPullRequest(...)
        'INSERT INTO task_pull_requests (task_id, pr_url, pr_number, pr_id_external, title, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [taskId, prResult.url, prResult.number, prResult.id, title] // Сохраняем номер и ID из API хостинга
      );

      await taskLogger.logInfo(taskId, `Создан Pull Request: ${prResult.title} (${prResult.url})`);

      // Уведомления (оставим пока здесь)
      // ... (логика уведомлений команде проекта) ...
      const teamConnection = await pool.getConnection();
      const [projectTeam] = await teamConnection.query( /* ... */ );
      teamConnection.release();
      for (const member of projectTeam) {
        await notificationManager.sendNotification({ /* ... data: { ..., prUrl: prResult.url } ... */});
      }

      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_pr_created', taskId, prUrl: prResult.url, title: prResult.title
        });
      }

      res.json({
        success: true,
        message: 'Pull Request успешно создан',
        data: { taskId, prUrl: prResult.url, title: prResult.title, prNumber: prResult.number }
      });

    } catch (error) {
      logger.error(`Ошибка при создании Pull Request для задачи #${taskId}:`, error);
      try { await taskLogger.logError(taskId, `Ошибка при создании Pull Request: ${error.message}`); } catch (logError) { logger.error('Не удалось записать ошибку в лог задачи:', logError); }
      res.status(500).json({ error: `Ошибка сервера при создании Pull Request: ${error.message}` });
    } finally {
      if (connection) connection.release();
    }
  },

  /**
   * Получает Git-статус задачи
   */
  async getTaskGitStatus(req, res) {
    const taskId = parseInt(req.params.taskId);
    let connection;
    try {
      connection = await pool.getConnection(); // TODO: TaskService.getTaskWithDetails(taskId)
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );

      if (tasks.length === 0) {
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      const task = tasks[0];

      if (!task.repository_path) {
        // Можно вернуть статус без информации из Git
         return res.status(200).json({
             taskId,
             branch: null,
             status: { message: "Репозиторий проекта не инициализирован"},
             commits: [],
             pullRequests: []
         });
      }

      // Получаем коммиты и PR из БД
      const [commits] = await connection.query( // TODO: TaskService.getCommits(taskId)
          'SELECT * FROM task_commits WHERE task_id = ? ORDER BY created_at DESC', [taskId]
      );
      const [pullRequests] = await connection.query( // TODO: TaskService.getPullRequests(taskId)
          'SELECT * FROM task_pull_requests WHERE task_id = ? ORDER BY created_at DESC', [taskId]
      );

      let gitStatus = null;
      if (task.git_branch) {
        const gitService = new GitService(task.repository_path);
        try {
          await gitService.checkout(task.git_branch); // Убедимся, что на нужной ветке
          gitStatus = await gitService.status(); // Получаем статус simple-git
        } catch (gitError) {
          logger.warn(`Ошибка при получении git-статуса для задачи #${taskId} (ветка: ${task.git_branch}):`, gitError);
          gitStatus = { error: `Не удалось получить статус для ветки ${task.git_branch}: ${gitError.message}` };
        }
      } else {
           gitStatus = { message: "Git-ветка для задачи не найдена или не создана." };
      }

      res.json({
        taskId,
        branch: task.git_branch,
        status: gitStatus, // Результат simpleGit.status() или сообщение об ошибке/отсутствии ветки
        commits,
        pullRequests
      });

    } catch (error) {
      logger.error(`Ошибка при получении git-статуса для задачи #${taskId}:`, error);
      res.status(500).json({ error: `Ошибка сервера при получении git-статуса: ${error.message}` });
    } finally {
       if (connection) connection.release();
    }
  }
};

module.exports = gitController;
// src/core/vcs-manager/index.js

const GitClient = require('./git-client');
const PRManager = require('./pr-manager');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const path = require('path');
const { parseRepositoryUrl } = require('../../utils/git-utils');

/**
 * Класс для управления репозиторием и работы с VCS
 */
class VCSManager {
  /**
   * Конструктор менеджера VCS
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    this.projectId = projectId;
    this.gitClient = null;
    this.prManager = null;
  }

  /**
   * Инициализирует менеджер VCS
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      if (this.gitClient && this.prManager) {
        return;
      }
      
      // Получаем информацию о проекте
      const projectInfo = await this.getProjectInfo();
      
      // Инициализируем Git-клиент
      this.gitClient = new GitClient(projectInfo.repository_url);
      await this.gitClient.initialize();
      
      // Инициализируем менеджер PR
      const { owner, repo } = parseRepositoryUrl(projectInfo.repository_url);
      this.prManager = new PRManager(owner, repo);
      
      logger.info(`VCS Manager инициализирован для проекта ${this.projectId}`);
    } catch (error) {
      logger.error(`Ошибка при инициализации VCS Manager для проекта ${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Получает информацию о проекте
   * @returns {Promise<Object>} - Информация о проекте
   */
  async getProjectInfo() {
    try {
      const connection = await pool.getConnection();
      
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [this.projectId]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        throw new Error(`Проект с id=${this.projectId} не найден`);
      }
      
      return projects[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о проекте:', error);
      throw error;
    }
  }

  /**
   * Создает ветку для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<string>} - Имя созданной ветки
   */
  async createBranchForTask(taskId) {
    try {
      await this.initialize();
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [taskId, this.projectId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Формируем имя ветки
      const branchName = `ai-task-${taskId}-${task.title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 30)}`;
      
      // Создаем ветку
      await this.gitClient.createBranch(branchName);
      
      return branchName;
    } catch (error) {
      logger.error(`Ошибка при создании ветки для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Создает коммит для задачи
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение коммита
   * @param {Array<string>} files - Файлы для коммита
   * @returns {Promise<Object>} - Информация о коммите
   */
  async commitChanges(taskId, message, files) {
    try {
      await this.initialize();
      
      // Добавляем файлы в индекс
      await this.gitClient.addFiles(files);
      
      // Создаем коммит
      const commit = await this.gitClient.commit(message);
      
      // Сохраняем информацию о коммите в БД
      const connection = await pool.getConnection();
      
      await connection.query(
        'INSERT INTO commits (task_id, commit_hash, commit_message) VALUES (?, ?, ?)',
        [taskId, commit.hash, message]
      );
      
      connection.release();
      
      logger.info(`Создан коммит для задачи #${taskId}: ${commit.hash}`);
      
      return commit;
    } catch (error) {
      logger.error(`Ошибка при создании коммита для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Отправляет изменения в удаленный репозиторий
   * @param {string} branch - Ветка для отправки
   * @returns {Promise<void>}
   */
  async pushChanges(branch) {
    try {
      await this.initialize();
      
      await this.gitClient.push(branch);
      
      logger.info(`Изменения отправлены в удаленный репозиторий (ветка ${branch})`);
    } catch (error) {
      logger.error(`Ошибка при отправке изменений в удаленный репозиторий:`, error);
      throw error;
    }
  }

  /**
   * Создает Pull Request для задачи
   * @param {number} taskId - ID задачи
   * @param {string} branch - Ветка с изменениями
   * @returns {Promise<Object>} - Созданный Pull Request
   */
  async createPullRequest(taskId, branch) {
    try {
      await this.initialize();
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [taskId, this.projectId]
      );
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Получаем список измененных файлов
      const changedFiles = await this.gitClient.getChangedFiles();
      
      // Формируем сообщение для PR
      const { title, body } = this.prManager.createPullRequestMessage(task, changedFiles);
      
      // Создаем PR
      const pullRequest = await this.prManager.createPullRequest(title, body, branch);
      
      // Сохраняем информацию о PR в БД
      await connection.query(
        'UPDATE tasks SET pull_request_number = ? WHERE id = ?',
        [pullRequest.number, taskId]
      );
      
      connection.release();
      
      logger.info(`Создан Pull Request #${pullRequest.number} для задачи #${taskId}`);
      
      return pullRequest;
    } catch (error) {
      logger.error(`Ошибка при создании Pull Request для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Читает содержимое файла из репозитория
   * @param {string} filePath - Путь к файлу
   * @returns {Promise<string>} - Содержимое файла
   */
  async readFile(filePath) {
    try {
      await this.initialize();
      
      return await this.gitClient.getFileContent(filePath);
    } catch (error) {
      logger.error(`Ошибка при чтении файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Записывает содержимое в файл в репозитории
   * @param {string} filePath - Путь к файлу
   * @param {string} content - Содержимое для записи
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    try {
      await this.initialize();
      
      await this.gitClient.writeFile(filePath, content);
    } catch (error) {
      logger.error(`Ошибка при записи файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Получает историю коммитов для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Array<Object>>} - История коммитов
   */
  async getTaskCommits(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [commits] = await connection.query(
        'SELECT * FROM commits WHERE task_id = ? ORDER BY committed_at DESC',
        [taskId]
      );
      
      connection.release();
      
      return commits;
    } catch (error) {
      logger.error(`Ошибка при получении истории коммитов для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Выполняет полный цикл работы с VCS для задачи
   * @param {number} taskId - ID задачи
   * @param {Array<Object>} generatedFiles - Список сгенерированных файлов
   * @returns {Promise<Object>} - Результат операции
   */
  async processTask(taskId, generatedFiles) {
    try {
      await this.initialize();
      
      // Создаем ветку для задачи
      const branchName = await this.createBranchForTask(taskId);
      
      // Записываем файлы в репозиторий
      for (const file of generatedFiles) {
        await this.writeFile(file.path, file.content);
      }
      
      // Получаем информацию о задаче для сообщения коммита
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Создаем коммит
      const commitMessage = `[AI] ${task.title}`;
      const filePaths = generatedFiles.map(file => file.path);
      
      const commit = await this.commitChanges(taskId, commitMessage, filePaths);
      
      // Отправляем изменения в удаленный репозиторий
      await this.pushChanges(branchName);
      
      // Создаем Pull Request
      const pullRequest = await this.createPullRequest(taskId, branchName);
      
      return {
        branch: branchName,
        commit,
        pull_request: pullRequest
      };
    } catch (error) {
      logger.error(`Ошибка при обработке задачи #${taskId} в VCS:`, error);
      throw error;
    }
  }
}

module.exports = VCSManager;
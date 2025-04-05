// src/utils/git-client.js

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Клиент для выполнения Git операций
 */
class GitClient {
  /**
   * Создает новый экземпляр GitClient
   * @param {string} repoPath - Путь к локальному репозиторию
   * @param {Object} config - Настройки
   */
  constructor(repoPath, config = {}) {
    this.repoPath = repoPath;
    this.config = {
      defaultBranch: 'main',
      username: config.username || 'AI Assistant',
      email: config.email || 'ai-assistant@example.com',
      ...config
    };
  }

  /**
   * Выполняет команду Git
   * @param {string} command - Команда Git для выполнения
   * @returns {Promise<string>} - Вывод команды
   * @private
   */
  async _executeGitCommand(command) {
    return new Promise((resolve, reject) => {
      exec(`git ${command}`, { cwd: this.repoPath }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Ошибка выполнения Git команды: ${error.message}`);
          return reject(error);
        }
        if (stderr) {
          logger.warn(`Предупреждение Git команды: ${stderr}`);
        }
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Инициализирует Git репозиторий
   * @returns {Promise<string>} - Вывод команды
   */
  async init() {
    return this._executeGitCommand('init');
  }

  /**
   * Клонирует репозиторий
   * @param {string} url - URL репозитория
   * @returns {Promise<string>} - Вывод команды
   */
  async clone(url) {
    return this._executeGitCommand(`clone ${url} ${this.repoPath}`);
  }

  /**
   * Создает новую ветку
   * @param {string} branchName - Имя ветки
   * @returns {Promise<string>} - Вывод команды
   */
  async createBranch(branchName) {
    return this._executeGitCommand(`checkout -b ${branchName}`);
  }

  /**
   * Переключается на указанную ветку
   * @param {string} branchName - Имя ветки
   * @returns {Promise<string>} - Вывод команды
   */
  async checkout(branchName) {
    return this._executeGitCommand(`checkout ${branchName}`);
  }

  /**
   * Добавляет файлы в индекс (staging area)
   * @param {string} files - Файлы для добавления (например, '.' для всех, 'file.js' и т.д.)
   * @returns {Promise<string>} - Вывод команды
   */
  async add(files = '.') {
    return this._executeGitCommand(`add ${files}`);
  }

  /**
   * Создает коммит
   * @param {string} message - Сообщение коммита
   * @returns {Promise<string>} - Вывод команды
   */
  async commit(message) {
    return this._executeGitCommand(`commit -m "${message}"`);
  }

  /**
   * Отправляет изменения в удаленный репозиторий
   * @param {string} remote - Имя удаленного репозитория
   * @param {string} branch - Имя ветки
   * @returns {Promise<string>} - Вывод команды
   */
  async push(remote = 'origin', branch = this.config.defaultBranch) {
    return this._executeGitCommand(`push ${remote} ${branch}`);
  }

  /**
   * Получает изменения из удаленного репозитория
   * @param {string} remote - Имя удаленного репозитория
   * @param {string} branch - Имя ветки
   * @returns {Promise<string>} - Вывод команды
   */
  async pull(remote = 'origin', branch = this.config.defaultBranch) {
    return this._executeGitCommand(`pull ${remote} ${branch}`);
  }

  /**
   * Получает статус репозитория
   * @returns {Promise<string>} - Вывод команды
   */
  async status() {
    return this._executeGitCommand('status');
  }

  /**
   * Создает ветку для задачи
   * @param {number} taskId - ID задачи
   * @param {string} taskTitle - Название задачи
   * @returns {Promise<string>} - Имя ветки
   */
  async createTaskBranch(taskId, taskTitle) {
    // Создаем имя ветки из названия задачи (slugify)
    const slugify = str => str.toLowerCase()
      .replace(/[^\w\s-]/g, '') // Удаляем специальные символы
      .replace(/\s+/g, '-') // Заменяем пробелы на -
      .replace(/--+/g, '-') // Заменяем множественные - на одинарные
      .trim(); // Удаляем пробелы по краям

    const branchName = `task-${taskId}-${slugify(taskTitle)}`;
    
    // Проверяем, существует ли уже ветка
    try {
      const branches = await this._executeGitCommand('branch');
      if (branches.includes(branchName)) {
        return branchName;
      }
    } catch (error) {
      // Игнорируем ошибку и пытаемся создать ветку
    }
    
    // Создаем и переключаемся на ветку
    await this.createBranch(branchName);
    
    return branchName;
  }

  /**
   * Создает коммит для задачи
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение коммита
   * @param {Array<string>} files - Файлы для коммита
   * @returns {Promise<string>} - Вывод команды
   */
  async createTaskCommit(taskId, message, files = []) {
    // Добавляем конкретные файлы или все файлы
    if (files.length > 0) {
      await Promise.all(files.map(file => this.add(file)));
    } else {
      await this.add();
    }
    
    // Создаем коммит с указанием задачи
    const commitMessage = `[Задача #${taskId}] ${message}`;
    return this.commit(commitMessage);
  }

  /**
   * Создает Pull Request (через API для GitHub/GitLab/etc.)
   * @param {Object} options - Опции для Pull Request
   * @returns {Promise<Object>} - Данные Pull Request
   */
  async createPullRequest(options) {
    // Это placeholder - реальная реализация зависит от Git-сервиса (GitHub, GitLab и т.д.)
    // В реальной реализации здесь был бы вызов соответствующего API
    logger.info(`Создание pull request: ${JSON.stringify(options)}`);
    return { url: 'https://example.com/pull/123' };
  }
}

module.exports = GitClient;
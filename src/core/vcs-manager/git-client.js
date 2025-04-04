// src/core/vcs-manager/git-client.js

const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const logger = require('../../utils/logger');
const config = require('../../config/app.config');

/**
 * Класс для работы с Git-репозиторием
 */
class GitClient {
  /**
   * Конструктор клиента Git
   * @param {string} repositoryUrl - URL репозитория
   * @param {string} [workingDir] - Рабочая директория для клонирования (опционально)
   */
  constructor(repositoryUrl, workingDir = null) {
    this.repositoryUrl = repositoryUrl;
    this.workingDir = workingDir || path.join(os.tmpdir(), 'biz360-repos', this.getRepoName(repositoryUrl));
    this.git = null;
    this.initialized = false;
  }

  /**
   * Извлекает имя репозитория из URL
   * @param {string} url - URL репозитория
   * @returns {string} - Имя репозитория
   */
  getRepoName(url) {
    // Удаляем расширение .git, если оно есть
    const withoutExt = url.replace(/\.git$/, '');
    
    // Разбиваем URL по слэшам и берем последний элемент
    const parts = withoutExt.split('/');
    return parts[parts.length - 1];
  }

  /**
   * Инициализирует Git-клиент
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }
      
      // Проверяем существование директории
      try {
        await fs.access(this.workingDir);
        
        // Директория существует, инициализируем Git-клиент
        this.git = simpleGit(this.workingDir);
        
        // Обновляем репозиторий
        await this.git.pull();
        
        logger.info(`Git-репозиторий ${this.repositoryUrl} обновлен`);
      } catch (error) {
        // Директория не существует, создаем её и клонируем репозиторий
        await fs.mkdir(this.workingDir, { recursive: true });
        
        // Клонируем репозиторий
        this.git = simpleGit();
        
        // Добавляем аутентификацию, если есть учетные данные
        let repoUrl = this.repositoryUrl;
        if (config.git.username && config.git.token) {
          const urlObj = new URL(this.repositoryUrl);
          repoUrl = `${urlObj.protocol}//${config.git.username}:${config.git.token}@${urlObj.host}${urlObj.pathname}`;
        }
        
        await this.git.clone(repoUrl, this.workingDir);
        
        // Переинициализируем Git-клиент для работы с клонированным репозиторием
        this.git = simpleGit(this.workingDir);
        
        logger.info(`Git-репозиторий ${this.repositoryUrl} клонирован в ${this.workingDir}`);
      }
      
      // Настраиваем пользователя (для коммитов)
      await this.git.addConfig('user.name', config.git.username || 'Biz360 AI Assistant');
      await this.git.addConfig('user.email', 'ai-assistant@biz360.com');
      
      this.initialized = true;
    } catch (error) {
      logger.error(`Ошибка при инициализации Git-клиента для ${this.repositoryUrl}:`, error);
      throw error;
    }
  }

  /**
   * Создает новую ветку из текущей
   * @param {string} branchName - Имя новой ветки
   * @returns {Promise<void>}
   */
  async createBranch(branchName) {
    try {
      await this.initialize();
      
      // Обновляем main/master ветку
      await this.git.checkout('main').catch(() => this.git.checkout('master'));
      await this.git.pull();
      
      // Создаем новую ветку
      await this.git.checkoutBranch(branchName, 'origin/main').catch(() => 
        this.git.checkoutBranch(branchName, 'origin/master')
      );
      
      logger.info(`Создана новая ветка ${branchName}`);
    } catch (error) {
      logger.error(`Ошибка при создании ветки ${branchName}:`, error);
      throw error;
    }
  }

  /**
   * Переключается на указанную ветку
   * @param {string} branchName - Имя ветки
   * @returns {Promise<void>}
   */
  async checkout(branchName) {
    try {
      await this.initialize();
      
      await this.git.checkout(branchName);
      logger.info(`Переключение на ветку ${branchName}`);
    } catch (error) {
      logger.error(`Ошибка при переключении на ветку ${branchName}:`, error);
      throw error;
    }
  }

  /**
   * Получает статус репозитория
   * @returns {Promise<Object>} - Статус репозитория
   */
  async getStatus() {
    try {
      await this.initialize();
      
      const status = await this.git.status();
      return status;
    } catch (error) {
      logger.error('Ошибка при получении статуса репозитория:', error);
      throw error;
    }
  }

  /**
   * Добавляет файлы в индекс
   * @param {string|Array<string>} files - Файлы для добавления
   * @returns {Promise<void>}
   */
  async addFiles(files) {
    try {
      await this.initialize();
      
      await this.git.add(files);
      logger.info(`Файлы добавлены в индекс: ${Array.isArray(files) ? files.join(', ') : files}`);
    } catch (error) {
      logger.error('Ошибка при добавлении файлов в индекс:', error);
      throw error;
    }
  }

  /**
   * Создает коммит
   * @param {string} message - Сообщение коммита
   * @returns {Promise<Object>} - Информация о созданном коммите
   */
  async commit(message) {
    try {
      await this.initialize();
      
      const result = await this.git.commit(message);
      logger.info(`Создан коммит: ${result.commit} с сообщением "${message}"`);
      
      return {
        hash: result.commit,
        message,
        date: new Date()
      };
    } catch (error) {
      logger.error(`Ошибка при создании коммита: ${error}`);
      throw error;
    }
  }

  /**
   * Отправляет изменения в удаленный репозиторий
   * @param {string} branch - Ветка для отправки
   * @returns {Promise<void>}
   */
  async push(branch) {
    try {
      await this.initialize();
      
      await this.git.push('origin', branch);
      logger.info(`Изменения отправлены в удаленный репозиторий (ветка ${branch})`);
    } catch (error) {
      logger.error(`Ошибка при отправке изменений в удаленный репозиторий: ${error}`);
      throw error;
    }
  }

  /**
   * Получает содержимое файла из репозитория
   * @param {string} filePath - Путь к файлу относительно корня репозитория
   * @returns {Promise<string>} - Содержимое файла
   */
  async getFileContent(filePath) {
    try {
      await this.initialize();
      
      const fullPath = path.join(this.workingDir, filePath);
      
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        return content;
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null; // Файл не существует
        }
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при получении содержимого файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Записывает содержимое в файл в репозитории
   * @param {string} filePath - Путь к файлу относительно корня репозитория
   * @param {string} content - Содержимое для записи
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    try {
      await this.initialize();
      
      const fullPath = path.join(this.workingDir, filePath);
      
      // Создаем директории, если они не существуют
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      
      // Записываем содержимое
      await fs.writeFile(fullPath, content, 'utf8');
      
      logger.info(`Файл ${filePath} успешно записан`);
    } catch (error) {
      logger.error(`Ошибка при записи файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Получает список измененных файлов
   * @returns {Promise<Array<string>>} - Список измененных файлов
   */
  async getChangedFiles() {
    try {
      await this.initialize();
      
      const status = await this.git.status();
      
      return [
        ...status.not_added,
        ...status.created,
        ...status.modified,
        ...status.renamed.map(file => file.to)
      ];
    } catch (error) {
      logger.error('Ошибка при получении списка измененных файлов:', error);
      throw error;
    }
  }

  /**
   * Получает историю коммитов
   * @param {number} limit - Максимальное количество коммитов
   * @returns {Promise<Array<Object>>} - История коммитов
   */
  async getCommitHistory(limit = 10) {
    try {
      await this.initialize();
      
      const log = await this.git.log({ maxCount: limit });
      
      return log.all.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: new Date(commit.date)
      }));
    } catch (error) {
      logger.error('Ошибка при получении истории коммитов:', error);
      throw error;
    }
  }
}

module.exports = GitClient;
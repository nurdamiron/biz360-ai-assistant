/**
 * @fileoverview Унифицированный Git клиент для работы с репозиториями.
 * Предоставляет высокоуровневый API для выполнения операций Git,
 * таких как клонирование, создание веток, коммитов, пулл-реквестов и т.д.
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

// Промисифицируем exec для удобства использования
const execPromise = promisify(exec);

/**
 * Класс для работы с Git репозиториями.
 */
class GitClient {
  /**
   * Создает экземпляр GitClient.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.db - Интерфейс к базе данных.
   * @param {Object} options.config - Конфигурация клиента.
   * @param {string} options.config.baseDir - Базовая директория для клонирования репозиториев.
   * @param {Object} options.config.github - Настройки для GitHub API.
   * @param {string} options.config.github.token - Токен для доступа к GitHub API.
   * @param {Object} options.config.gitlab - Настройки для GitLab API.
   * @param {string} options.config.gitlab.token - Токен для доступа к GitLab API.
   */
  constructor({ db, config = {} } = {}) {
    this.db = db;
    this.config = config;
    
    // Базовая директория для клонирования репозиториев
    this.baseDir = config.baseDir || path.join(process.cwd(), 'repositories');
    
    // Настройки для GitHub API
    this.githubToken = config.github?.token;
    
    // Настройки для GitLab API
    this.gitlabToken = config.gitlab?.token;
    
    // Кэш для локальных путей репозиториев
    this.repoPathCache = new Map();
    
    // Создаем базовую директорию, если она не существует
    this._ensureBaseDir();
  }

  /**
   * Создает базовую директорию, если она не существует.
   * @private
   * @returns {Promise<void>}
   */
  async _ensureBaseDir() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      logger.debug(`Base directory created: ${this.baseDir}`);
    } catch (error) {
      logger.error(`Error creating base directory: ${error.message}`);
    }
  }

  /**
   * Выполняет команду Git в указанной директории.
   * @private
   * @param {string} command - Команда Git для выполнения.
   * @param {string} cwd - Рабочая директория (путь к репозиторию).
   * @returns {Promise<Object>} - Результат выполнения команды.
   */
  async _executeGitCommand(command, cwd) {
    logger.debug(`Executing Git command: ${command} in ${cwd}`);
    
    try {
      const { stdout, stderr } = await execPromise(command, { cwd });
      
      return { success: true, stdout, stderr };
    } catch (error) {
      logger.error(`Error executing Git command: ${error.message}`);
      
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || '',
        stdout: error.stdout || ''
      };
    }
  }

  /**
   * Определяет тип репозитория по URL.
   * @private
   * @param {string} repoUrl - URL репозитория.
   * @returns {string} - Тип репозитория ('github', 'gitlab', 'other').
   */
  _getRepoType(repoUrl) {
    if (!repoUrl) {
      return 'unknown';
    }
    
    if (repoUrl.includes('github.com')) {
      return 'github';
    } else if (repoUrl.includes('gitlab.com')) {
      return 'gitlab';
    } else {
      return 'other';
    }
  }

  /**
   * Получает локальный путь к репозиторию.
   * @private
   * @param {string} repoUrl - URL репозитория.
   * @returns {string} - Локальный путь к репозиторию.
   */
  _getRepoPath(repoUrl) {
    // Проверяем, есть ли путь в кэше
    if (this.repoPathCache.has(repoUrl)) {
      return this.repoPathCache.get(repoUrl);
    }
    
    // Извлекаем имя репозитория из URL
    const repoName = repoUrl.split('/').pop().replace('.git', '');
    
    // Создаем хэш URL для уникального имени директории
    const urlHash = Buffer.from(repoUrl).toString('base64').replace(/[\/\+\=]/g, '_');
    
    // Формируем путь
    const repoPath = path.join(this.baseDir, `${repoName}_${urlHash}`);
    
    // Сохраняем путь в кэше
    this.repoPathCache.set(repoUrl, repoPath);
    
    return repoPath;
  }

  /**
   * Проверяет, существует ли репозиторий локально.
   * @private
   * @param {string} repoPath - Локальный путь к репозиторию.
   * @returns {Promise<boolean>} - true, если репозиторий существует локально.
   */
  async _repoExists(repoPath) {
    try {
      const stats = await fs.stat(path.join(repoPath, '.git'));
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Получает информацию о репозитории из БД.
   * @private
   * @param {string} projectId - Идентификатор проекта.
   * @returns {Promise<Object|null>} - Информация о репозитории или null, если не найдена.
   */
  async _getRepoInfo(projectId) {
    logger.debug(`Getting repository info for project ${projectId}`);
    
    try {
      // Если БД недоступна, пытаемся получить информацию из кэша
      if (!this.db) {
        logger.warn('Database not available, unable to get repository info');
        return null;
      }
      
      // Получаем проект из БД
      const project = await this.db.Project.findByPk(projectId);
      
      if (!project) {
        logger.error(`Project with ID ${projectId} not found`);
        return null;
      }
      
      // Проверяем наличие URL репозитория
      if (!project.repositoryUrl) {
        logger.error(`Repository URL not specified for project ${projectId}`);
        return null;
      }
      
      return {
        id: project.id,
        name: project.name,
        url: project.repositoryUrl,
        type: this._getRepoType(project.repositoryUrl),
        localPath: project.localPath || this._getRepoPath(project.repositoryUrl)
      };
    } catch (error) {
      logger.error(`Error getting repository info: ${error.message}`);
      return null;
    }
  }

  /**
   * Клонирует репозиторий.
   * @param {string} repoUrl - URL репозитория.
   * @param {Object} options - Опции клонирования.
   * @param {string} options.branch - Ветка для клонирования.
   * @param {boolean} options.shallow - Выполнить shallow clone.
   * @returns {Promise<Object>} - Результат клонирования.
   */
  async cloneRepository(repoUrl, options = {}) {
    logger.info(`Cloning repository: ${repoUrl}`);
    
    try {
      const repoPath = this._getRepoPath(repoUrl);
      
      // Проверяем, не существует ли репозиторий уже
      const exists = await this._repoExists(repoPath);
      
      if (exists) {
        logger.info(`Repository already exists at ${repoPath}`);
        
        // Обновляем репозиторий вместо клонирования
        return this.pullRepository(repoUrl);
      }
      
      // Формируем команду для клонирования
      let command = `git clone`;
      
      // Добавляем опции
      if (options.shallow) {
        command += ` --depth 1`;
      }
      
      if (options.branch) {
        command += ` -b ${options.branch}`;
      }
      
      // Добавляем URL и путь
      command += ` ${repoUrl} ${repoPath}`;
      
      // Выполняем команду
      const result = await this._executeGitCommand(command, this.baseDir);
      
      if (result.success) {
        logger.info(`Repository cloned successfully to ${repoPath}`);
        
        return {
          success: true,
          repoPath,
          message: 'Repository cloned successfully'
        };
      } else {
        logger.error(`Error cloning repository: ${result.error}`);
        
        return {
          success: false,
          error: result.error,
          stderr: result.stderr
        };
      }
    } catch (error) {
      logger.error(`Error cloning repository: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обновляет локальный репозиторий (git pull).
   * @param {string} repoUrl - URL репозитория.
   * @returns {Promise<Object>} - Результат обновления.
   */
  async pullRepository(repoUrl) {
    logger.info(`Pulling repository: ${repoUrl}`);
    
    try {
      const repoPath = this._getRepoPath(repoUrl);
      
      // Проверяем, существует ли репозиторий
      const exists = await this._repoExists(repoPath);
      
      if (!exists) {
        logger.error(`Repository does not exist at ${repoPath}`);
        
        return {
          success: false,
          error: 'Repository does not exist locally'
        };
      }
      
      // Выполняем git pull
      const result = await this._executeGitCommand('git pull', repoPath);
      
      if (result.success) {
        logger.info(`Repository updated successfully at ${repoPath}`);
        
        return {
          success: true,
          repoPath,
          message: 'Repository updated successfully'
        };
      } else {
        logger.error(`Error updating repository: ${result.error}`);
        
        return {
          success: false,
          error: result.error,
          stderr: result.stderr
        };
      }
    } catch (error) {
      logger.error(`Error updating repository: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получает или клонирует репозиторий для проекта.
   * @param {string} projectId - Идентификатор проекта.
   * @returns {Promise<Object>} - Результат операции.
   */
  async getProjectRepository(projectId) {
    logger.info(`Getting repository for project ${projectId}`);
    
    try {
      // Получаем информацию о репозитории
      const repoInfo = await this._getRepoInfo(projectId);
      
      if (!repoInfo) {
        return {
          success: false,
          error: 'Repository information not found'
        };
      }
      
      // Проверяем, существует ли репозиторий локально
      const exists = await this._repoExists(repoInfo.localPath);
      
      if (exists) {
        // Обновляем репозиторий
        const pullResult = await this.pullRepository(repoInfo.url);
        
        if (pullResult.success) {
          return {
            success: true,
            repoInfo,
            repoPath: repoInfo.localPath,
            message: 'Repository updated successfully'
          };
        } else {
          return {
            success: false,
            repoInfo,
            error: pullResult.error,
            stderr: pullResult.stderr
          };
        }
      } else {
        // Клонируем репозиторий
        const cloneResult = await this.cloneRepository(repoInfo.url);
        
        if (cloneResult.success) {
          // Обновляем локальный путь в БД
          if (this.db) {
            await this.db.Project.update(
              { localPath: cloneResult.repoPath },
              { where: { id: projectId } }
            );
          }
          
          return {
            success: true,
            repoInfo: {
              ...repoInfo,
              localPath: cloneResult.repoPath
            },
            repoPath: cloneResult.repoPath,
            message: 'Repository cloned successfully'
          };
        } else {
          return {
            success: false,
            repoInfo,
            error: cloneResult.error,
            stderr: cloneResult.stderr
          };
        }
      }
    } catch (error) {
      logger.error(`Error getting project repository: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создает новую ветку в репозитории.
   * @param {string} projectId - Идентификатор проекта.
   * @param {string} branchName - Имя новой ветки.
   * @param {Object} options - Опции создания ветки.
   * @param {string} options.baseBranch - Базовая ветка (default: 'main').
   * @returns {Promise<Object>} - Результат создания ветки.
   */
  async createBranch(projectId, branchName, options = {}) {
    logger.info(`Creating branch ${branchName} for project ${projectId}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Определяем базовую ветку
      const baseBranch = options.baseBranch || 'main';
      
      // Переключаемся на базовую ветку и обновляем ее
      let result = await this._executeGitCommand(`git checkout ${baseBranch}`, repoPath);
      
      if (!result.success) {
        // Проверяем, возможно базовая ветка называется 'master'
        result = await this._executeGitCommand('git checkout master', repoPath);
        
        if (!result.success) {
          return {
            success: false,
            error: `Failed to checkout base branch: ${result.error}`,
            stderr: result.stderr
          };
        }
      }
      
      // Обновляем базовую ветку
      result = await this._executeGitCommand('git pull', repoPath);
      
      // Создаем новую ветку
      result = await this._executeGitCommand(`git checkout -b ${branchName}`, repoPath);
      
      if (result.success) {
        logger.info(`Branch ${branchName} created successfully`);
        
        return {
          success: true,
          branchName,
          repoPath,
          message: `Branch ${branchName} created successfully`
        };
      } else {
        logger.error(`Error creating branch: ${result.error}`);
        
        return {
          success: false,
          error: result.error,
          stderr: result.stderr
        };
      }
    } catch (error) {
      logger.error(`Error creating branch: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создает коммит с указанными изменениями.
   * @param {string} projectId - Идентификатор проекта.
   * @param {string} commitMessage - Сообщение коммита.
   * @param {Array<Object>} changes - Список изменений.
   * @param {string} changes[].path - Путь к файлу.
   * @param {string} changes[].content - Новое содержимое файла.
   * @param {string} changes[].operation - Операция ('add', 'modify', 'delete').
   * @param {Object} options - Дополнительные опции.
   * @param {string} options.branch - Ветка для коммита (default: текущая).
   * @param {string} options.authorName - Имя автора коммита.
   * @param {string} options.authorEmail - Email автора коммита.
   * @returns {Promise<Object>} - Результат создания коммита.
   */
  async createCommit(projectId, commitMessage, changes, options = {}) {
    logger.info(`Creating commit for project ${projectId}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Переключаемся на нужную ветку, если указана
      if (options.branch) {
        let result = await this._executeGitCommand(`git checkout ${options.branch}`, repoPath);
        
        if (!result.success) {
          // Пытаемся создать ветку, если она не существует
          result = await this._executeGitCommand(`git checkout -b ${options.branch}`, repoPath);
          
          if (!result.success) {
            return {
              success: false,
              error: `Failed to checkout branch ${options.branch}: ${result.error}`,
              stderr: result.stderr
            };
          }
        }
      }
      
      // Применяем изменения
      for (const change of changes) {
        const filePath = path.join(repoPath, change.path);
        
        try {
          // Создаем директории, если они не существуют
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          
          switch (change.operation) {
            case 'add':
            case 'modify':
              await fs.writeFile(filePath, change.content);
              break;
              
            case 'delete':
              await fs.unlink(filePath);
              break;
              
            default:
              logger.warn(`Unknown operation ${change.operation} for file ${change.path}`);
          }
        } catch (error) {
          logger.error(`Error applying change to ${change.path}: ${error.message}`);
          
          return {
            success: false,
            error: `Failed to apply change to ${change.path}: ${error.message}`
          };
        }
      }
      
      // Добавляем изменения в индекс
      let result = await this._executeGitCommand('git add .', repoPath);
      
      if (!result.success) {
        return {
          success: false,
          error: `Failed to add changes: ${result.error}`,
          stderr: result.stderr
        };
      }
      
      // Формируем команду коммита
      let commitCommand = 'git commit';
      
      // Добавляем автора, если указан
      if (options.authorName && options.authorEmail) {
        commitCommand += ` --author="${options.authorName} <${options.authorEmail}>"`;
      }
      
      // Добавляем сообщение коммита
      commitCommand += ` -m "${commitMessage.replace(/"/g, '\\"')}"`;
      
      // Создаем коммит
      result = await this._executeGitCommand(commitCommand, repoPath);
      
      if (result.success) {
        logger.info(`Commit created successfully`);
        
        // Получаем хэш коммита
        const hashResult = await this._executeGitCommand('git rev-parse HEAD', repoPath);
        const commitHash = hashResult.success ? hashResult.stdout.trim() : 'unknown';
        
        return {
          success: true,
          commitHash,
          message: 'Commit created successfully'
        };
      } else {
        // Проверяем, нет ли изменений для коммита
        if (result.stderr.includes('nothing to commit') || result.stdout.includes('nothing to commit')) {
          logger.info('No changes to commit');
          
          return {
            success: true,
            commitHash: null,
            message: 'No changes to commit'
          };
        }
        
        logger.error(`Error creating commit: ${result.error}`);
        
        return {
          success: false,
          error: result.error,
          stderr: result.stderr
        };
      }
    } catch (error) {
      logger.error(`Error creating commit: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Отправляет изменения в удаленный репозиторий (git push).
   * @param {string} projectId - Идентификатор проекта.
   * @param {Object} options - Опции отправки.
   * @param {string} options.branch - Ветка для отправки (default: текущая).
   * @param {boolean} options.force - Выполнить force push.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async pushChanges(projectId, options = {}) {
    logger.info(`Pushing changes for project ${projectId}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Переключаемся на нужную ветку, если указана
      if (options.branch) {
        const result = await this._executeGitCommand(`git checkout ${options.branch}`, repoPath);
        
        if (!result.success) {
          return {
            success: false,
            error: `Failed to checkout branch ${options.branch}: ${result.error}`,
            stderr: result.stderr
          };
        }
      }
      
      // Формируем команду отправки
      let pushCommand = 'git push';
      
      // Добавляем опции
      if (options.force) {
        pushCommand += ' --force';
      }
      
      // Указываем ветку, если задана
      if (options.branch) {
        pushCommand += ` origin ${options.branch}`;
      }
      
      // Отправляем изменения
      const result = await this._executeGitCommand(pushCommand, repoPath);
      
      if (result.success) {
        logger.info(`Changes pushed successfully`);
        
        return {
          success: true,
          message: 'Changes pushed successfully'
        };
      } else {
        logger.error(`Error pushing changes: ${result.error}`);
        
        return {
          success: false,
          error: result.error,
          stderr: result.stderr
        };
      }
    } catch (error) {
      logger.error(`Error pushing changes: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создает пулл-реквест в GitHub или GitLab.
   * @param {string} projectId - Идентификатор проекта.
   * @param {Object} prData - Данные для создания пулл-реквеста.
   * @param {string} prData.title - Заголовок пулл-реквеста.
   * @param {string} prData.description - Описание пулл-реквеста.
   * @param {string} prData.sourceBranch - Исходная ветка.
   * @param {string} prData.targetBranch - Целевая ветка (default: 'main').
   * @returns {Promise<Object>} - Результат создания пулл-реквеста.
   */
  async createPullRequest(projectId, prData) {
    logger.info(`Creating pull request for project ${projectId}`);
    
    try {
      // Получаем информацию о репозитории
      const repoInfo = await this._getRepoInfo(projectId);
      
      if (!repoInfo) {
        return {
          success: false,
          error: 'Repository information not found'
        };
      }
      
      // Отправляем изменения в удаленный репозиторий
      const pushResult = await this.pushChanges(projectId, {
        branch: prData.sourceBranch
      });
      
      if (!pushResult.success) {
        return {
          success: false,
          error: `Failed to push changes: ${pushResult.error}`,
          stderr: pushResult.stderr
        };
      }
      
      // Определяем тип репозитория и создаем PR соответствующим образом
      switch (repoInfo.type) {
        case 'github':
          return this._createGitHubPullRequest(repoInfo, prData);
          
        case 'gitlab':
          return this._createGitLabPullRequest(repoInfo, prData);
          
        default:
          return {
            success: false,
            error: `Unsupported repository type: ${repoInfo.type}`
          };
      }
    } catch (error) {
      logger.error(`Error creating pull request: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создает пулл-реквест в GitHub.
   * @private
   * @param {Object} repoInfo - Информация о репозитории.
   * @param {Object} prData - Данные для создания пулл-реквеста.
   * @returns {Promise<Object>} - Результат создания пулл-реквеста.
   */
  async _createGitHubPullRequest(repoInfo, prData) {
    logger.debug(`Creating GitHub pull request for repository ${repoInfo.url}`);
    
    try {
      // Проверяем наличие токена GitHub
      if (!this.githubToken) {
        return {
          success: false,
          error: 'GitHub token not provided'
        };
      }
      
      // Извлекаем owner и repo из URL
      const match = repoInfo.url.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      
      if (!match) {
        return {
          success: false,
          error: 'Invalid GitHub repository URL'
        };
      }
      
      const owner = match[1];
      const repo = match[2];
      
      // Формируем данные для запроса
      const requestData = {
        title: prData.title,
        body: prData.description,
        head: prData.sourceBranch,
        base: prData.targetBranch || 'main'
      };
      
      // Отправляем запрос к GitHub API
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.githubToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(requestData)
      });
      
      // Получаем результат
      const result = await response.json();
      
      if (response.ok) {
        logger.info(`GitHub pull request created successfully: ${result.html_url}`);
        
        return {
          success: true,
          pullRequestUrl: result.html_url,
          pullRequestId: result.number,
          message: 'Pull request created successfully'
        };
      } else {
        logger.error(`Error creating GitHub pull request: ${result.message}`);
        
        return {
          success: false,
          error: result.message,
          details: result.errors
        };
      }
    } catch (error) {
      logger.error(`Error creating GitHub pull request: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создает пулл-реквест (Merge Request) в GitLab.
   * @private
   * @param {Object} repoInfo - Информация о репозитории.
   * @param {Object} prData - Данные для создания пулл-реквеста.
   * @returns {Promise<Object>} - Результат создания пулл-реквеста.
   */
  async _createGitLabPullRequest(repoInfo, prData) {
    logger.debug(`Creating GitLab merge request for repository ${repoInfo.url}`);
    
    try {
      // Проверяем наличие токена GitLab
      if (!this.gitlabToken) {
        return {
          success: false,
          error: 'GitLab token not provided'
        };
      }
      
      // Извлекаем project ID из URL
      const match = repoInfo.url.match(/gitlab\.com\/([^\/]+\/[^\.]+)/);
      
      if (!match) {
        return {
          success: false,
          error: 'Invalid GitLab repository URL'
        };
      }
      
      const projectPath = encodeURIComponent(match[1]);
      
      // Формируем данные для запроса
      const requestData = {
        title: prData.title,
        description: prData.description,
        source_branch: prData.sourceBranch,
        target_branch: prData.targetBranch || 'main'
      };
      
      // Отправляем запрос к GitLab API
      const response = await fetch(`https://gitlab.com/api/v4/projects/${projectPath}/merge_requests`, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
      
      // Получаем результат
      const result = await response.json();
      
      if (response.ok) {
        logger.info(`GitLab merge request created successfully: ${result.web_url}`);
        
        return {
          success: true,
          pullRequestUrl: result.web_url,
          pullRequestId: result.iid,
          message: 'Merge request created successfully'
        };
      } else {
        logger.error(`Error creating GitLab merge request: ${result.message}`);
        
        return {
          success: false,
          error: result.message,
          details: result.errors
        };
      }
    } catch (error) {
      logger.error(`Error creating GitLab merge request: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Проверяет наличие конфликтов между ветками.
   * @param {string} projectId - Идентификатор проекта.
   * @param {string} sourceBranch - Исходная ветка.
   * @param {string} targetBranch - Целевая ветка.
   * @returns {Promise<Object>} - Результат проверки.
   */
  async checkMergeConflicts(projectId, sourceBranch, targetBranch) {
    logger.info(`Checking merge conflicts for project ${projectId} between ${sourceBranch} and ${targetBranch}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Обновляем репозиторий
      let result = await this._executeGitCommand('git fetch', repoPath);
      
      if (!result.success) {
        return {
          success: false,
          error: `Failed to fetch repository: ${result.error}`,
          stderr: result.stderr
        };
      }
      
      // Проверяем конфликты
      result = await this._executeGitCommand(
        `git merge-tree $(git merge-base ${targetBranch} ${sourceBranch}) ${targetBranch} ${sourceBranch}`,
        repoPath
      );
      
      // Анализируем результат
      const hasConflicts = result.stdout.includes('<<<<<<< ') || result.stderr.includes('conflict');
      
      if (hasConflicts) {
        logger.info(`Merge conflicts detected between ${sourceBranch} and ${targetBranch}`);
        
        // Получаем список файлов с конфликтами
        const conflictFiles = [];
        const lines = result.stdout.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          if (line.includes('changed in both')) {
            const fileLine = lines[i - 1] || '';
            const match = fileLine.match(/([^\s]+)$/);
            
            if (match) {
              conflictFiles.push(match[1]);
            }
          }
        }
        
        return {
          success: true,
          hasConflicts: true,
          conflictFiles,
          message: 'Merge conflicts detected'
        };
      } else {
        logger.info(`No merge conflicts detected between ${sourceBranch} and ${targetBranch}`);
        
        return {
          success: true,
          hasConflicts: false,
          message: 'No merge conflicts detected'
        };
      }
    } catch (error) {
      logger.error(`Error checking merge conflicts: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получает список файлов, измененных в ветке.
   * @param {string} projectId - Идентификатор проекта.
   * @param {string} branch - Ветка.
   * @param {string} baseBranch - Базовая ветка для сравнения (default: 'main').
   * @returns {Promise<Object>} - Результат получения списка файлов.
   */
  async getChangedFiles(projectId, branch, baseBranch) {
    logger.info(`Getting changed files for project ${projectId} in branch ${branch}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Определяем базовую ветку
      const base = baseBranch || 'main';
      
      // Обновляем репозиторий
      let result = await this._executeGitCommand('git fetch', repoPath);
      
      if (!result.success) {
        return {
          success: false,
          error: `Failed to fetch repository: ${result.error}`,
          stderr: result.stderr
        };
      }
      
      // Получаем список измененных файлов
      result = await this._executeGitCommand(
        `git diff --name-status ${base}...${branch}`,
        repoPath
      );
      
      if (!result.success) {
        return {
          success: false,
          error: `Failed to get changed files: ${result.error}`,
          stderr: result.stderr
        };
      }
      
      // Парсим результат
      const changedFiles = [];
      const lines = result.stdout.trim().split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const [status, ...fileParts] = line.split('\t');
        const filePath = fileParts.join('\t'); // Обрабатываем случай, когда в пути есть табуляции
        
        let operation;
        
        switch (status.charAt(0)) {
          case 'A':
            operation = 'added';
            break;
          case 'M':
            operation = 'modified';
            break;
          case 'D':
            operation = 'deleted';
            break;
          case 'R':
            operation = 'renamed';
            break;
          case 'C':
            operation = 'copied';
            break;
          default:
            operation = 'unknown';
        }
        
        changedFiles.push({
          path: filePath,
          operation,
          status
        });
      }
      
      return {
        success: true,
        changedFiles,
        message: `Found ${changedFiles.length} changed files`
      };
    } catch (error) {
      logger.error(`Error getting changed files: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получает содержимое файла из репозитория.
   * @param {string} projectId - Идентификатор проекта.
   * @param {string} filePath - Путь к файлу.
   * @param {Object} options - Опции получения файла.
   * @param {string} options.branch - Ветка (default: текущая).
   * @returns {Promise<Object>} - Результат получения файла.
   */
  async getFileContent(projectId, filePath, options = {}) {
    logger.debug(`Getting file content for project ${projectId}: ${filePath}`);
    
    try {
      // Получаем информацию о репозитории
      const repoResult = await this.getProjectRepository(projectId);
      
      if (!repoResult.success) {
        return repoResult;
      }
      
      const repoPath = repoResult.repoPath;
      
      // Переключаемся на нужную ветку, если указана
      if (options.branch) {
        const result = await this._executeGitCommand(`git checkout ${options.branch}`, repoPath);
        
        if (!result.success) {
          return {
            success: false,
            error: `Failed to checkout branch ${options.branch}: ${result.error}`,
            stderr: result.stderr
          };
        }
      }
      
      // Получаем содержимое файла
      const fullPath = path.join(repoPath, filePath);
      
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        
        return {
          success: true,
          content,
          message: 'File content retrieved successfully'
        };
      } catch (readError) {
        logger.error(`Error reading file ${fullPath}: ${readError.message}`);
        
        return {
          success: false,
          error: `Failed to read file: ${readError.message}`
        };
      }
    } catch (error) {
      logger.error(`Error getting file content: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { GitClient };
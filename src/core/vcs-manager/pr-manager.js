// src/core/vcs-manager/pr-manager.js

const gitClient = require('./git-client');
const logger = require('../../utils/logger');
const prDescriptionGenerator = require('./pr-description-generator');
const conflictChecker = require('./conflict-checker');
const reviewChecklistGenerator = require('./review-checklist-generator');
const config = require('../../config/app.config');

/**
 * Менеджер для работы с Pull Request
 */
class PRManager {
  /**
   * Создает Pull Request
   * 
   * @param {Object} options - Опции для создания PR
   * @param {String} options.baseBranch - Базовая ветка (куда мерджим)
   * @param {String} options.headBranch - Текущая ветка (откуда мерджим)
   * @param {String} options.title - Заголовок PR
   * @param {String} options.body - Описание PR (опционально)
   * @param {Boolean} options.draft - Черновик PR (опционально)
   * @param {String} options.taskId - ID задачи (опционально)
   * @param {String} options.taskTitle - Название задачи (опционально)
   * @param {String} options.repositoryUrl - URL репозитория (опционально)
   * @returns {Promise<Object>} Созданный PR
   */
  async createPR(options) {
    try {
      logger.info(`Создание PR из ${options.headBranch} в ${options.baseBranch}`);
      
      // Проверяем наличие конфликтов перед созданием PR
      const conflictResult = await conflictChecker.checkConflicts({
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        analyzeConflicts: false
      });
      
      if (conflictResult.hasConflicts) {
        logger.warn(`Обнаружены конфликты: ${conflictResult.message}`);
        return {
          success: false,
          message: conflictResult.message,
          conflicts: conflictResult.conflictFiles,
          url: null
        };
      }
      
      // Если не указано описание PR, генерируем его автоматически
      let prBody = options.body;
      if (!prBody) {
        prBody = await prDescriptionGenerator.generateDescription({
          baseBranch: options.baseBranch,
          headBranch: options.headBranch,
          repositoryUrl: options.repositoryUrl || config.github?.repositoryUrl,
          taskId: options.taskId,
          taskTitle: options.taskTitle,
          includeChangeList: true
        });
      }
      
      // Создаем PR через API GitHub/GitLab
      const pr = await gitClient.createPullRequest({
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        title: options.title,
        body: prBody,
        draft: options.draft || false
      });
      
      logger.info(`PR успешно создан: ${pr.url}`);
      
      return {
        success: true,
        message: 'Pull Request успешно создан',
        url: pr.url,
        id: pr.id,
        number: pr.number
      };
    } catch (error) {
      logger.error('Ошибка при создании PR:', error);
      throw new Error(`Не удалось создать Pull Request: ${error.message}`);
    }
  }
  
  /**
   * Проверяет наличие конфликтов и анализирует их
   * 
   * @param {Object} options - Опции для проверки
   * @param {String} options.baseBranch - Базовая ветка
   * @param {String} options.headBranch - Текущая ветка
   * @param {Boolean} options.analyzeConflicts - Нужно ли анализировать конфликты
   * @returns {Promise<Object>} Результат проверки
   */
  async checkMergeConflicts(options) {
    try {
      return await conflictChecker.checkConflicts(options);
    } catch (error) {
      logger.error('Ошибка при проверке конфликтов:', error);
      throw new Error(`Не удалось проверить наличие конфликтов: ${error.message}`);
    }
  }
  
  /**
   * Генерирует описание для PR
   * 
   * @param {Object} options - Опции для генерации
   * @returns {Promise<String>} Сгенерированное описание
   */
  async generatePRDescription(options) {
    try {
      return await prDescriptionGenerator.generateDescription(options);
    } catch (error) {
      logger.error('Ошибка при генерации описания PR:', error);
      throw new Error(`Не удалось сгенерировать описание PR: ${error.message}`);
    }
  }
  
  /**
   * Генерирует шаблон для PR
   * 
   * @param {Object} options - Опции для генерации
   * @returns {Promise<String>} Шаблон для PR
   */
  async generatePRTemplate(options) {
    try {
      return await prDescriptionGenerator.generateTemplate(options);
    } catch (error) {
      logger.error('Ошибка при генерации шаблона PR:', error);
      throw new Error(`Не удалось сгенерировать шаблон PR: ${error.message}`);
    }
  }
  
  /**
   * Генерирует чеклист для код-ревью
   * 
   * @param {Object} options - Опции для генерации
   * @returns {Promise<Object>} Сгенерированный чеклист
   */
  async generateReviewChecklist(options) {
    try {
      return await reviewChecklistGenerator.generateChecklist(options);
    } catch (error) {
      logger.error('Ошибка при генерации чеклиста для код-ревью:', error);
      throw new Error(`Не удалось сгенерировать чеклист: ${error.message}`);
    }
  }
  
  /**
   * Оценивает PR на основе чеклиста
   * 
   * @param {Object} options - Опции для оценки
   * @returns {Promise<Object>} Результат оценки
   */
  async evaluatePR(options) {
    try {
      return await reviewChecklistGenerator.evaluatePR(options);
    } catch (error) {
      logger.error('Ошибка при оценке PR:', error);
      throw new Error(`Не удалось оценить PR: ${error.message}`);
    }
  }
  
  /**
   * Получает информацию о PR
   * 
   * @param {Object} options - Опции для получения информации
   * @param {String} options.prId - ID или номер PR
   * @param {String} options.repositoryUrl - URL репозитория (опционально)
   * @returns {Promise<Object>} Информация о PR
   */
  async getPRInfo(options) {
    try {
      logger.info(`Получение информации о PR ${options.prId}`);
      
      const prInfo = await gitClient.getPullRequestInfo(options.prId);
      
      return {
        success: true,
        pr: prInfo
      };
    } catch (error) {
      logger.error('Ошибка при получении информации о PR:', error);
      throw new Error(`Не удалось получить информацию о PR: ${error.message}`);
    }
  }
  
  /**
   * Обновляет PR
   * 
   * @param {Object} options - Опции для обновления
   * @param {String} options.prId - ID или номер PR
   * @param {String} options.title - Новый заголовок PR (опционально)
   * @param {String} options.body - Новое описание PR (опционально)
   * @param {Boolean} options.state - Новое состояние PR (опционально: 'open', 'closed')
   * @returns {Promise<Object>} Обновленный PR
   */
  async updatePR(options) {
    try {
      logger.info(`Обновление PR ${options.prId}`);
      
      const updatedPR = await gitClient.updatePullRequest(options);
      
      return {
        success: true,
        message: 'Pull Request успешно обновлен',
        pr: updatedPR
      };
    } catch (error) {
      logger.error('Ошибка при обновлении PR:', error);
      throw new Error(`Не удалось обновить Pull Request: ${error.message}`);
    }
  }
  
  /**
   * Добавляет комментарий к PR
   * 
   * @param {Object} options - Опции для добавления комментария
   * @param {String} options.prId - ID или номер PR
   * @param {String} options.comment - Текст комментария
   * @returns {Promise<Object>} Результат добавления комментария
   */
  async addPRComment(options) {
    try {
      logger.info(`Добавление комментария к PR ${options.prId}`);
      
      const result = await gitClient.addPullRequestComment(
        options.prId, 
        options.comment
      );
      
      return {
        success: true,
        message: 'Комментарий успешно добавлен',
        comment: result
      };
    } catch (error) {
      logger.error('Ошибка при добавлении комментария к PR:', error);
      throw new Error(`Не удалось добавить комментарий: ${error.message}`);
    }
  }
  
  /**
   * Мерджит PR
   * 
   * @param {Object} options - Опции для мерджа
   * @param {String} options.prId - ID или номер PR
   * @param {String} options.mergeMethod - Метод мерджа (опционально: 'merge', 'squash', 'rebase')
   * @param {String} options.commitTitle - Заголовок коммита (опционально)
   * @param {String} options.commitMessage - Сообщение коммита (опционально)
   * @returns {Promise<Object>} Результат мерджа
   */
  async mergePR(options) {
    try {
      logger.info(`Мердж PR ${options.prId}`);
      
      const result = await gitClient.mergePullRequest(options);
      
      return {
        success: true,
        message: 'Pull Request успешно смерджен',
        result
      };
    } catch (error) {
      logger.error('Ошибка при мердже PR:', error);
      throw new Error(`Не удалось смерджить Pull Request: ${error.message}`);
    }
  }
}

module.exports = new PRManager();
// src/core/vcs-manager/pr-description-generator.js

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const GitService = require('./git-client');

/**
 * Генератор описаний для Pull Request
 */
class PrDescriptionGenerator {
  /**
   * Генерирует описание PR на основе изменений
   * 
   * @param {Object} options - Опции для генерации описания
   * @param {String} options.baseBranch - Базовая ветка (куда мерджим)
   * @param {String} options.headBranch - Текущая ветка (откуда мерджим)
   * @param {String} options.repositoryUrl - URL репозитория
   * @param {String} options.taskId - ID задачи (если есть)
   * @param {String} options.taskTitle - Название задачи (если есть)
   * @param {String} options.taskDescription - Описание задачи (если есть)
   * @param {Boolean} options.includeChangeList - Включать ли список измененных файлов
   * @returns {Promise<String>} Сгенерированное описание PR
   */
  async generateDescription(options) {
    try {
      logger.info(`Генерация описания PR для ветки ${options.headBranch}`);
      
      // Получаем список изменений между ветками
      const diffSummary = await this._getDiffSummary(options.baseBranch, options.headBranch);
      
      // Получаем список коммитов
      const commits = await this._getCommitsList(options.baseBranch, options.headBranch);
      
      // Формируем переменные для промпта
      const promptVars = {
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        repositoryUrl: options.repositoryUrl,
        taskId: options.taskId,
        taskTitle: options.taskTitle,
        taskDescription: options.taskDescription,
        diffSummary,
        commits,
        changeList: options.includeChangeList ? await this._getChangeList(options.baseBranch, options.headBranch) : null
      };
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('pr-description', promptVars);
      const result = await llmClient.sendMessage(promptText);
      
      return result;
    } catch (error) {
      logger.error('Ошибка при генерации описания PR:', error);
      throw new Error(`Не удалось сгенерировать описание PR: ${error.message}`);
    }
  }
  
  /**
   * Получает краткую сводку изменений между ветками
   * @private
   * @param {String} baseBranch - Базовая ветка
   * @param {String} headBranch - Текущая ветка
   * @returns {Promise<String>} Сводка изменений
   */
  async _getDiffSummary(baseBranch, headBranch) {
    try {
      // Получаем статистику изменений
      const diffStats = await GitService.getDiffStats(baseBranch, headBranch);
      
      // Форматируем результат
      return [
        `Всего изменено файлов: ${diffStats.changedFilesCount}`,
        `Добавлено строк: ${diffStats.insertions}`,
        `Удалено строк: ${diffStats.deletions}`
      ].join('\n');
    } catch (error) {
      logger.warn('Не удалось получить сводку изменений:', error);
      return 'Не удалось получить сводку изменений';
    }
  }
  
  /**
   * Получает список коммитов между ветками
   * @private
   * @param {String} baseBranch - Базовая ветка
   * @param {String} headBranch - Текущая ветка
   * @returns {Promise<Array<Object>>} Список коммитов
   */
  async _getCommitsList(baseBranch, headBranch) {
    try {
      return await GitService.getCommits(baseBranch, headBranch);
    } catch (error) {
      logger.warn('Не удалось получить список коммитов:', error);
      return [];
    }
  }
  
  /**
   * Получает список измененных файлов
   * @private
   * @param {String} baseBranch - Базовая ветка
   * @param {String} headBranch - Текущая ветка
   * @returns {Promise<Array<String>>} Список измененных файлов
   */
  async _getChangeList(baseBranch, headBranch) {
    try {
      return await GitService.getChangedFiles(baseBranch, headBranch);
    } catch (error) {
      logger.warn('Не удалось получить список измененных файлов:', error);
      return [];
    }
  }
  
  /**
   * Генерирует шаблон для PR на основе конфигурации проекта
   * @param {Object} options - Опции для генерации шаблона
   * @returns {Promise<String>} Шаблон для PR
   */
  async generateTemplate(options) {
    try {
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('pr-template', { 
        taskId: options.taskId,
        taskTitle: options.taskTitle,
        repositoryUrl: options.repositoryUrl
      });
      
      const result = await llmClient.sendMessage(promptText);
      return result;
    } catch (error) {
      logger.error('Ошибка при генерации шаблона PR:', error);
      throw new Error(`Не удалось сгенерировать шаблон PR: ${error.message}`);
    }
  }
}

module.exports = new PrDescriptionGenerator();
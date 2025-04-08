// src/core/feedback-system/index.js

const feedbackAnalyzer = require('./feedback-analyzer');
const changePrioritizer = require('./change-prioritizer');
const commentProcessor = require('./comment-processor');  // Этот файл мы пока не создали
const logger = require('../../utils/logger');

/**
 * Система обработки обратной связи
 * 
 * Промпты, используемые в этом модуле:
 * - templates/prompts/feedback-analysis.txt - используется в feedback-analyzer.js
 * - templates/prompts/feedback-summary-analysis.txt - используется в feedback-analyzer.js
 * - templates/prompts/code-comments-analysis.txt - используется в feedback-analyzer.js
 * - templates/prompts/group-similar-suggestions.txt - используется в change-prioritizer.js
 * - templates/prompts/prioritize-changes.txt - используется в change-prioritizer.js
 * - templates/prompts/change-to-task.txt - используется в change-prioritizer.js
 * - templates/prompts/comment-processing.txt - будет использоваться в comment-processor.js
 */
class FeedbackSystem {
  /**
   * Обрабатывает новую обратную связь
   * 
   * @param {Object} feedback - Обратная связь для обработки
   * @returns {Promise<Object>} Результат обработки
   */
  async processFeedback(feedback) {
    try {
      logger.info('Обработка новой обратной связи');
      
      // Анализируем обратную связь
      const analysis = await feedbackAnalyzer.analyzeFeedback(feedback);
      
      // Сохраняем результаты анализа в БД
      await this._saveFeedbackAnalysis(feedback.id, analysis);
      
      return {
        success: true,
        analysis
      };
    } catch (error) {
      logger.error('Ошибка при обработке обратной связи:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Получает сводный анализ обратной связи за период
   * 
   * @param {Object} options - Опции для анализа
   * @returns {Promise<Object>} Сводный анализ
   */
  async getFeedbackSummary(options) {
    try {
      return await feedbackAnalyzer.getSummaryAnalysis(options);
    } catch (error) {
      logger.error('Ошибка при получении сводного анализа обратной связи:', error);
      throw error;
    }
  }
  
  /**
   * Приоритизирует изменения на основе обратной связи
   * 
   * @param {Object} options - Опции для приоритизации
   * @returns {Promise<Object>} Приоритизированные изменения
   */
  async prioritizeChanges(options) {
    try {
      return await changePrioritizer.prioritizeChanges(options);
    } catch (error) {
      logger.error('Ошибка при приоритизации изменений:', error);
      throw error;
    }
  }
  
  /**
   * Создает задачи из приоритизированных изменений
   * 
   * @param {Object} options - Опции для создания задач
   * @returns {Promise<Object>} Результат создания задач
   */
  async createTasksFromChanges(options) {
    try {
      return await changePrioritizer.createTasksFromChanges(options);
    } catch (error) {
      logger.error('Ошибка при создании задач из изменений:', error);
      throw error;
    }
  }
  
  /**
   * Обрабатывает комментарии к коду
   * 
   * @param {Object} options - Опции для обработки комментариев
   * @returns {Promise<Object>} Результат обработки
   */
  async processCodeComments(options) {
    try {
      // Этот метод будет вызывать commentProcessor.processComments, 
      // который мы пока не реализовали
      return await feedbackAnalyzer.analyzeCodeComments(options);
    } catch (error) {
      logger.error('Ошибка при обработке комментариев к коду:', error);
      throw error;
    }
  }
  
  /**
   * Сохраняет результаты анализа обратной связи в БД
   * @private
   * @param {String} feedbackId - ID обратной связи
   * @param {Object} analysis - Результаты анализа
   * @returns {Promise<void>}
   */
  async _saveFeedbackAnalysis(feedbackId, analysis) {
    try {
      const FeedbackModel = require('../../models/feedback.model');
      await FeedbackModel.update(
        { analysis: JSON.stringify(analysis) },
        { where: { id: feedbackId } }
      );
    } catch (error) {
      logger.error('Ошибка при сохранении анализа обратной связи:', error);
    }
  }
}

module.exports = new FeedbackSystem();
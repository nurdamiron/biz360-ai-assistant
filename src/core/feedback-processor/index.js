// src/core/feedback-processor/index.js
const logger = require('../../utils/logger');
const Feedback = require('../../models/feedback.model');
const llmClient = require('../../utils/llm-client');
const { getPromptTemplate } = require('../../utils/prompt-utils');
const analyticsService = require('../analytics/analytics-service');

/**
 * Сервис обработки обратной связи
 */
class FeedbackProcessor {
  /**
   * Обработка новой обратной связи
   * @param {object} feedback - Объект обратной связи
   * @returns {Promise<object>} - Результат обработки
   */
  async processFeedback(feedback) {
    logger.info(`Processing feedback ID: ${feedback.id}`);
    
    try {
      // Загружаем полную информацию о обратной связи
      const feedbackRecord = await Feedback.findByPk(feedback.id, {
        include: [
          { association: 'user' },
          { association: 'task' },
          { association: 'subtask' }
        ]
      });
      
      if (!feedbackRecord) {
        throw new Error(`Feedback with ID ${feedback.id} not found`);
      }
      
      // Анализируем обратную связь с помощью LLM
      const analysis = await this.analyzeFeedback(feedbackRecord);
      
      // Сохраняем результаты анализа
      await feedbackRecord.update({
        processed: true,
        processing_notes: JSON.stringify(analysis)
      });
      
      // Отправляем данные в аналитику
      await analyticsService.trackFeedback({
        feedbackId: feedbackRecord.id,
        userId: feedbackRecord.user_id,
        taskId: feedbackRecord.task_id,
        subtaskId: feedbackRecord.subtask_id,
        feedbackType: feedbackRecord.feedback_type,
        rating: feedbackRecord.rating,
        analysis
      });
      
      return {
        id: feedbackRecord.id,
        processed: true,
        analysis
      };
    } catch (error) {
      logger.error(`Error processing feedback: ${error.message}`, {
        feedbackId: feedback.id,
        error: error.stack
      });
      
      // Обновляем запись, чтобы показать ошибку
      if (feedback.id) {
        await Feedback.update(
          {
            processed: false,
            processing_notes: `Error: ${error.message}`
          },
          { where: { id: feedback.id } }
        );
      }
      
      throw error;
    }
  }

  /**
   * Анализ обратной связи с помощью LLM
   * @param {object} feedback - Объект обратной связи
   * @returns {Promise<object>} - Результат анализа
   */
  async analyzeFeedback(feedback) {
    // Получаем шаблон промпта для анализа обратной связи
    const promptTemplate = await getPromptTemplate('feedback-analysis');
    
    // Формируем контекст для промпта
    const context = {
      feedbackType: feedback.feedback_type,
      rating: feedback.rating,
      comments: feedback.comments || '',
      specificIssues: feedback.specific_issues ? JSON.parse(feedback.specific_issues) : [],
      suggestions: feedback.suggestions || '',
      taskTitle: feedback.task ? feedback.task.title : 'N/A',
      taskDescription: feedback.task ? feedback.task.description : 'N/A',
      subtaskTitle: feedback.subtask ? feedback.subtask.title : 'N/A',
      subtaskDescription: feedback.subtask ? feedback.subtask.description : 'N/A'
    };
    
    // Запрашиваем анализ у LLM
    const response = await llmClient.generateContent(promptTemplate, context);
    
    try {
      // Пытаемся парсить ответ как JSON
      return JSON.parse(response);
    } catch (e) {
      logger.warn(`Failed to parse LLM response as JSON: ${e.message}`);
      
      // Если парсинг не удался, возвращаем сырой ответ
      return {
        raw: response,
        structured: false,
        categories: [],
        actionItems: [],
        severity: 'unknown'
      };
    }
  }

  /**
   * Получение агрегированных данных обратной связи
   * @param {object} filters - Фильтры для выборки
   * @returns {Promise<object>} - Агрегированные данные
   */
  async getAggregatedFeedback(filters = {}) {
    // Базовый запрос
    const whereClause = {};
    
    // Применяем фильтры
    if (filters.taskId) whereClause.task_id = filters.taskId;
    if (filters.subtaskId) whereClause.subtask_id = filters.subtaskId;
    if (filters.userId) whereClause.user_id = filters.userId;
    if (filters.feedbackType) whereClause.feedback_type = filters.feedbackType;
    if (filters.minRating) whereClause.rating = { [Op.gte]: filters.minRating };
    if (filters.maxRating) whereClause.rating = { ...whereClause.rating, [Op.lte]: filters.maxRating };
    if (filters.processed !== undefined) whereClause.processed = filters.processed;
    
    // Временные фильтры
    if (filters.startDate) whereClause.created_at = { [Op.gte]: new Date(filters.startDate) };
    if (filters.endDate) whereClause.created_at = { ...whereClause.created_at, [Op.lte]: new Date(filters.endDate) };
    
    // Получаем все отзывы по фильтрам
    const feedbacks = await Feedback.findAll({
      where: whereClause,
      include: [
        { association: 'user', attributes: ['id', 'name', 'email'] },
        { association: 'task', attributes: ['id', 'title'] },
        { association: 'subtask', attributes: ['id', 'title'] }
      ],
      order: [['created_at', 'DESC']]
    });
    
    // Агрегируем данные
    const aggregated = {
      total: feedbacks.length,
      averageRating: 0,
      byType: {},
      byTask: {},
      byUser: {},
      recentFeedbacks: feedbacks.slice(0, 10).map(f => ({
        id: f.id,
        type: f.feedback_type,
        rating: f.rating,
        comments: f.comments,
        user: f.user ? { id: f.user.id, name: f.user.name } : null,
        task: f.task ? { id: f.task.id, title: f.task.title } : null,
        createdAt: f.created_at
      }))
    };
    
    // Считаем средний рейтинг
    if (feedbacks.length > 0) {
      aggregated.averageRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;
    }
    
    // Группируем по типу отзыва
    feedbacks.forEach(f => {
      if (!aggregated.byType[f.feedback_type]) {
        aggregated.byType[f.feedback_type] = {
          count: 0,
          averageRating: 0,
          sum: 0
        };
      }
      
      aggregated.byType[f.feedback_type].count++;
      aggregated.byType[f.feedback_type].sum += f.rating;
    });
    
    // Вычисляем средние рейтинги по типам
    for (const type in aggregated.byType) {
      if (aggregated.byType[type].count > 0) {
        aggregated.byType[type].averageRating = aggregated.byType[type].sum / aggregated.byType[type].count;
      }
      delete aggregated.byType[type].sum;
    }
    
    // Группируем по задаче
    feedbacks.forEach(f => {
      if (f.task_id) {
        if (!aggregated.byTask[f.task_id]) {
          aggregated.byTask[f.task_id] = {
            title: f.task ? f.task.title : `Task #${f.task_id}`,
            count: 0,
            averageRating: 0,
            sum: 0
          };
        }
        
        aggregated.byTask[f.task_id].count++;
        aggregated.byTask[f.task_id].sum += f.rating;
      }
    });
    
    // Вычисляем средние рейтинги по задачам
    for (const taskId in aggregated.byTask) {
      if (aggregated.byTask[taskId].count > 0) {
        aggregated.byTask[taskId].averageRating = aggregated.byTask[taskId].sum / aggregated.byTask[taskId].count;
      }
      delete aggregated.byTask[taskId].sum;
    }
    
    // Группируем по пользователю
    feedbacks.forEach(f => {
      if (!aggregated.byUser[f.user_id]) {
        aggregated.byUser[f.user_id] = {
          name: f.user ? f.user.name : `User #${f.user_id}`,
          count: 0
        };
      }
      
      aggregated.byUser[f.user_id].count++;
    });
    
    return aggregated;
  }
}

module.exports = new FeedbackProcessor();
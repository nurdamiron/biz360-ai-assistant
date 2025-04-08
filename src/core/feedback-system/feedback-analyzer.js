// src/core/feedback-system/feedback-analyzer.js

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const FeedbackModel = require('../../models/feedback.model');
const LLMInteractionModel = require('../../models/llm-interaction.model');

/**
 * Класс для анализа обратной связи от пользователей
 */
class FeedbackAnalyzer {
  /**
   * Анализирует обратную связь и извлекает структурированную информацию
   * 
   * @param {Object} feedback - Объект с обратной связью
   * @param {String} feedback.text - Текст обратной связи
   * @param {Number} feedback.rating - Оценка (1-5)
   * @param {String} feedback.userId - ID пользователя
   * @param {String} feedback.taskId - ID задачи
   * @param {String} feedback.category - Категория обратной связи
   * @returns {Promise<Object>} Результат анализа
   */
  async analyzeFeedback(feedback) {
    try {
      logger.info('Анализ обратной связи:', { userId: feedback.userId, taskId: feedback.taskId });
      
      // Получаем связанные данные из БД, если доступны
      let relatedData = {};
      
      if (feedback.taskId) {
        relatedData = await this._getRelatedTaskData(feedback.taskId);
      }
      
      if (feedback.llmInteractionId) {
        relatedData.llmInteraction = await this._getLLMInteractionData(feedback.llmInteractionId);
      }
      
      // Формируем переменные для промпта
      const promptVars = {
        feedback: feedback.text,
        rating: feedback.rating,
        category: feedback.category,
        taskData: relatedData.task,
        interactionData: relatedData.llmInteraction
      };
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('feedback-analysis', promptVars);
      const analysisResult = await llmClient.sendMessage(promptText);
      
      // Пытаемся извлечь структурированные данные из ответа LLM
      let structuredResult = {};
      
      try {
        // Проверяем, является ли ответ JSON
        if (analysisResult.trim().startsWith('{') && analysisResult.trim().endsWith('}')) {
          structuredResult = JSON.parse(analysisResult);
        } else {
          // Если не JSON, пытаемся извлечь структурированные данные из текста
          structuredResult = this._extractStructuredData(analysisResult);
        }
      } catch (error) {
        logger.warn('Не удалось извлечь структурированные данные из анализа:', error);
        structuredResult = { 
          analysis: analysisResult,
          error: 'Не удалось извлечь структурированные данные'
        };
      }
      
      return {
        originalFeedback: feedback,
        structuredAnalysis: structuredResult,
        rawAnalysis: analysisResult
      };
    } catch (error) {
      logger.error('Ошибка при анализе обратной связи:', error);
      throw new Error(`Не удалось проанализировать обратную связь: ${error.message}`);
    }
  }
  
  /**
   * Получает сводный анализ обратной связи за период
   * 
   * @param {Object} options - Опции для анализа
   * @param {Date} options.startDate - Начальная дата
   * @param {Date} options.endDate - Конечная дата
   * @param {String} options.category - Категория обратной связи (опционально)
   * @param {String} options.userId - ID пользователя (опционально)
   * @returns {Promise<Object>} Сводный анализ
   */
  async getSummaryAnalysis(options) {
    try {
      logger.info('Получение сводного анализа обратной связи:', options);
      
      // Получаем данные обратной связи за период
      const feedbackData = await this._getFeedbackForPeriod(options);
      
      if (feedbackData.length === 0) {
        return {
          message: 'Нет данных обратной связи за указанный период',
          data: []
        };
      }
      
      // Вычисляем базовую статистику
      const stats = this._calculateBasicStats(feedbackData);
      
      // Если данных слишком много, ограничиваем для анализа через LLM
      const feedbackForAnalysis = feedbackData.slice(0, 50);
      
      // Формируем переменные для промпта
      const promptVars = {
        feedbackData: feedbackForAnalysis,
        stats,
        period: {
          startDate: options.startDate,
          endDate: options.endDate
        },
        category: options.category,
        userId: options.userId
      };
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('feedback-summary-analysis', promptVars);
      const summaryResult = await llmClient.sendMessage(promptText);
      
      return {
        stats,
        summary: summaryResult,
        rawData: feedbackData
      };
    } catch (error) {
      logger.error('Ошибка при получении сводного анализа обратной связи:', error);
      throw new Error(`Не удалось получить сводный анализ: ${error.message}`);
    }
  }
  
  /**
   * Анализирует комментарии к коду
   * 
   * @param {Object} options - Опции для анализа
   * @param {Array} options.comments - Массив комментариев
   * @param {String} options.fileContent - Содержимое файла (опционально)
   * @param {String} options.filePath - Путь к файлу (опционально)
   * @returns {Promise<Object>} Результат анализа
   */
  async analyzeCodeComments(options) {
    try {
      logger.info('Анализ комментариев к коду:', { commentsCount: options.comments.length });
      
      // Формируем переменные для промпта
      const promptVars = {
        comments: options.comments,
        fileContent: options.fileContent,
        filePath: options.filePath
      };
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('code-comments-analysis', promptVars);
      const analysisResult = await llmClient.sendMessage(promptText);
      
      // Пытаемся извлечь структурированные данные из ответа LLM
      let structuredResult = {};
      
      try {
        if (analysisResult.trim().startsWith('{') && analysisResult.trim().endsWith('}')) {
          structuredResult = JSON.parse(analysisResult);
        } else {
          structuredResult = this._extractStructuredData(analysisResult);
        }
      } catch (error) {
        logger.warn('Не удалось извлечь структурированные данные из анализа комментариев:', error);
        structuredResult = { 
          analysis: analysisResult,
          error: 'Не удалось извлечь структурированные данные'
        };
      }
      
      return {
        originalComments: options.comments,
        structuredAnalysis: structuredResult,
        rawAnalysis: analysisResult
      };
    } catch (error) {
      logger.error('Ошибка при анализе комментариев к коду:', error);
      throw new Error(`Не удалось проанализировать комментарии: ${error.message}`);
    }
  }
  
  /**
   * Получает связанные данные задачи
   * @private
   * @param {String} taskId - ID задачи
   * @returns {Promise<Object>} Данные задачи
   */
  async _getRelatedTaskData(taskId) {
    try {
      const TaskModel = require('../../models/task.model');
      const task = await TaskModel.findByPk(taskId, {
        include: [
          { model: require('../../models/subtask.model'), as: 'subtasks' }
        ]
      });
      
      return { task: task ? task.toJSON() : null };
    } catch (error) {
      logger.warn(`Не удалось получить данные для задачи ${taskId}:`, error);
      return { task: null };
    }
  }
  
  /**
   * Получает данные взаимодействия с LLM
   * @private
   * @param {String} interactionId - ID взаимодействия
   * @returns {Promise<Object>} Данные взаимодействия
   */
  async _getLLMInteractionData(interactionId) {
    try {
      const interaction = await LLMInteractionModel.findByPk(interactionId);
      return interaction ? interaction.toJSON() : null;
    } catch (error) {
      logger.warn(`Не удалось получить данные взаимодействия ${interactionId}:`, error);
      return null;
    }
  }
  
  /**
   * Получает обратную связь за период
   * @private
   * @param {Object} options - Опции для выборки
   * @returns {Promise<Array>} Массив обратной связи
   */
  async _getFeedbackForPeriod(options) {
    const { startDate, endDate, category, userId } = options;
    
    const whereClause = {
      createdAt: {
        [Op]: {
          [Op.gte]: startDate,
          [Op.lte]: endDate
        }
      }
    };
    
    if (category) {
      whereClause.category = category;
    }
    
    if (userId) {
      whereClause.userId = userId;
    }
    
    try {
      const feedback = await FeedbackModel.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']]
      });
      
      return feedback.map(item => item.toJSON());
    } catch (error) {
      logger.error('Ошибка при получении обратной связи из БД:', error);
      return [];
    }
  }
  
  /**
   * Вычисляет базовую статистику по обратной связи
   * @private
   * @param {Array} feedbackData - Массив обратной связи
   * @returns {Object} Статистика
   */
  _calculateBasicStats(feedbackData) {
    // Базовая статистика
    const stats = {
      total: feedbackData.length,
      averageRating: 0,
      countByRating: {
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
        '5': 0
      },
      countByCategory: {}
    };
    
    // Вычисляем статистику
    let totalRating = 0;
    
    feedbackData.forEach(item => {
      if (item.rating) {
        totalRating += item.rating;
        stats.countByRating[item.rating.toString()] = (stats.countByRating[item.rating.toString()] || 0) + 1;
      }
      
      if (item.category) {
        stats.countByCategory[item.category] = (stats.countByCategory[item.category] || 0) + 1;
      }
    });
    
    stats.averageRating = totalRating / feedbackData.length;
    
    return stats;
  }
  
  /**
   * Извлекает структурированные данные из текстового ответа
   * @private
   * @param {String} text - Текст ответа
   * @returns {Object} Структурированные данные
   */
  _extractStructuredData(text) {
    const result = {
      sentimentScore: null,
      categories: [],
      suggestions: [],
      issues: []
    };
    
    // Ищем оценку настроения
    const sentimentMatch = text.match(/(?:sentiment|sentiment score|оценка настроения|настроение)\s*(?::|\-|=)\s*(-?\d+(?:\.\d+)?)/i);
    if (sentimentMatch) {
      result.sentimentScore = parseFloat(sentimentMatch[1]);
    }
    
    // Ищем категории
    const categoriesSection = this._extractSection(text, 'categories', 'категории');
    if (categoriesSection) {
      const categoryMatches = categoriesSection.match(/(?:^|\n)[-•*]\s*(.+?)(?:$|\n)/g);
      if (categoryMatches) {
        result.categories = categoryMatches.map(match => match.replace(/^[-•*\s]+/, '').trim());
      }
    }
    
    // Ищем предложения
    const suggestionsSection = this._extractSection(text, 'suggestions', 'предложения', 'recommendations', 'рекомендации');
    if (suggestionsSection) {
      const suggestionMatches = suggestionsSection.match(/(?:^|\n)[-•*]\s*(.+?)(?:$|\n)/g);
      if (suggestionMatches) {
        result.suggestions = suggestionMatches.map(match => match.replace(/^[-•*\s]+/, '').trim());
      }
    }
    
    // Ищем проблемы
    const issuesSection = this._extractSection(text, 'issues', 'проблемы', 'concerns', 'замечания');
    if (issuesSection) {
      const issueMatches = issuesSection.match(/(?:^|\n)[-•*]\s*(.+?)(?:$|\n)/g);
      if (issueMatches) {
        result.issues = issueMatches.map(match => match.replace(/^[-•*\s]+/, '').trim());
      }
    }
    
    return result;
  }
  
  /**
   * Извлекает секцию из текста
   * @private
   * @param {String} text - Исходный текст
   * @param {...String} sectionNames - Возможные названия секций
   * @returns {String|null} Содержимое секции или null
   */
  _extractSection(text, ...sectionNames) {
    for (const name of sectionNames) {
      const regex = new RegExp(`${name}[:\\s-]*\\n(.+?)(?:\\n\\s*\\n|$)`, 'is');
      const match = text.match(regex);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }
}

module.exports = new FeedbackAnalyzer();
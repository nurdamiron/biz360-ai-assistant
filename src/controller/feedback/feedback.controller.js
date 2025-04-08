// src/controller/feedback/feedback.controller.js

const FeedbackSystem = require('../../core/feedback-system');
const FeedbackModel = require('../../models/feedback.model');
const CommentModel = require('../../models/comment.model');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

/**
 * Контроллер для работы с системой обратной связи
 * 
 * Связан с модулем src/core/feedback-system
 * Использует промпты:
 * - templates/prompts/feedback-analysis.txt (через FeedbackAnalyzer)
 * - templates/prompts/feedback-summary-analysis.txt (через FeedbackAnalyzer)
 * - templates/prompts/group-similar-suggestions.txt (через ChangePrioritizer)
 * - templates/prompts/prioritize-changes.txt (через ChangePrioritizer)
 * - templates/prompts/change-to-task.txt (через ChangePrioritizer)
 * - templates/prompts/comment-processing.txt (через CommentProcessor)
 * - templates/prompts/comment-summarization.txt (через CommentProcessor)
 * - templates/prompts/comment-to-task.txt (через CommentProcessor)
 */
class FeedbackController {
  /**
   * Создает новую обратную связь
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async createFeedback(req, res) {
    try {
      const { text, rating, taskId, category } = req.body;
      
      // Создаем запись в БД
      const feedback = await FeedbackModel.create({
        text,
        rating,
        taskId,
        category,
        userId: req.user.id
      });
      
      // Обрабатываем обратную связь
      const result = await FeedbackSystem.processFeedback(feedback);
      
      return res.status(201).json({
        success: true,
        feedback: feedback.id,
        analysis: result.analysis
      });
    } catch (error) {
      logger.error('Ошибка при создании обратной связи:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Получает список обратной связи с фильтрацией
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async getFeedbackList(req, res) {
    try {
      const { 
        startDate, 
        endDate, 
        category, 
        minRating, 
        maxRating, 
        taskId,
        limit = 50, 
        offset = 0 
      } = req.query;
      
      // Формируем условия для выборки
      const where = {};
      
      if (startDate && endDate) {
        where.createdAt = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      } else if (startDate) {
        where.createdAt = { [Op.gte]: new Date(startDate) };
      } else if (endDate) {
        where.createdAt = { [Op.lte]: new Date(endDate) };
      }
      
      if (category) {
        where.category = category;
      }
      
      if (minRating || maxRating) {
        where.rating = {};
        
        if (minRating) {
          where.rating[Op.gte] = minRating;
        }
        
        if (maxRating) {
          where.rating[Op.lte] = maxRating;
        }
      }
      
      if (taskId) {
        where.taskId = taskId;
      }
      
      // Получаем данные из БД
      const { count, rows } = await FeedbackModel.findAndCountAll({
        where,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['createdAt', 'DESC']]
      });
      
      return res.status(200).json({
        success: true,
        total: count,
        data: rows
      });
    } catch (error) {
      logger.error('Ошибка при получении списка обратной связи:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Получает сводный анализ обратной связи
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async getFeedbackSummary(req, res) {
    try {
      const { startDate, endDate, category, userId } = req.body;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать startDate и endDate'
        });
      }
      
      const result = await FeedbackSystem.getFeedbackSummary({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        category,
        userId
      });
      
      return res.status(200).json({
        success: true,
        summary: result
      });
    } catch (error) {
      logger.error('Ошибка при получении сводного анализа:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Получает приоритизированные изменения на основе обратной связи
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async getPrioritizedChanges(req, res) {
    try {
      const { 
        startDate, 
        endDate, 
        category, 
        limit, 
        projectId,
        minRating
      } = req.body;
      
      const feedbackFilter = {
        startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: endDate ? new Date(endDate) : new Date(),
        category,
        minRating: minRating || 1
      };
      
      const result = await FeedbackSystem.prioritizeChanges({
        feedbackFilter,
        limit,
        projectContext: { projectId }
      });
      
      return res.status(200).json({
        success: true,
        changes: result
      });
    } catch (error) {
      logger.error('Ошибка при получении приоритизированных изменений:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Создает задачи на основе приоритизированных изменений
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async createTasksFromChanges(req, res) {
    try {
      const { changes, projectId } = req.body;
      
      if (!changes || !Array.isArray(changes) || changes.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать массив изменений'
        });
      }
      
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать projectId'
        });
      }
      
      const result = await FeedbackSystem.createTasksFromChanges({
        changes,
        projectId,
        userId: req.user.id
      });
      
      return res.status(201).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при создании задач из изменений:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Обрабатывает комментарии к коду
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async processCodeComments(req, res) {
    try {
      const { commentIds, filePath, fileContent, pullRequestId } = req.body;
      
      if (!commentIds || !Array.isArray(commentIds) || commentIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать массив commentIds'
        });
      }
      
      // Получаем комментарии из БД
      const comments = await CommentModel.findAll({
        where: {
          id: { [Op.in]: commentIds }
        }
      });
      
      if (comments.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Комментарии не найдены'
        });
      }
      
      // Обрабатываем комментарии
      const result = await FeedbackSystem.processCodeComments({
        comments: comments.map(c => c.toJSON()),
        filePath,
        fileContent,
        pullRequestId
      });
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при обработке комментариев к коду:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Создает задачи из комментариев к коду
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async createTasksFromComments(req, res) {
    try {
      const { commentIds, projectId } = req.body;
      
      if (!commentIds || !Array.isArray(commentIds) || commentIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать массив commentIds'
        });
      }
      
      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: 'Необходимо указать projectId'
        });
      }
      
      // Получаем комментарии из БД
      const comments = await CommentModel.findAll({
        where: {
          id: { [Op.in]: commentIds }
        }
      });
      
      if (comments.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Комментарии не найдены'
        });
      }
      
      // Создаем задачи из комментариев
      const result = await FeedbackSystem.createTasksFromComments({
        comments: comments.map(c => c.toJSON()),
        projectId,
        userId: req.user.id
      });
      
      return res.status(201).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при создании задач из комментариев:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new FeedbackController();
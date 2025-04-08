// src/models/feedback.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();
const User = require('./user.model');
const Task = require('./task.model');
const Subtask = require('./subtask.model');

/**
 * Модель обратной связи
 */
class Feedback extends Model {}

Feedback.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'tasks',
      key: 'id'
    }
  },
  subtask_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'subtasks',
      key: 'id'
    }
  },
  feedback_type: {
    type: DataTypes.ENUM('code_quality', 'code_correctness', 'task_decomposition', 'bug_fixing', 'refactoring', 'general'),
    allowNull: false
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Rating from 1 to 5'
  },
  comments: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  specific_issues: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON string with specific issues found'
  },
  suggestions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ai_response_id: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID of the AI response this feedback is about'
  },
  context: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Additional context for the feedback in JSON format'
  },
  processed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  processing_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  tableName: 'feedbacks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Связи
Feedback.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Feedback.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
Feedback.belongsTo(Subtask, { foreignKey: 'subtask_id', as: 'subtask' });

module.exports = Feedback;

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

// src/controller/feedback/feedback.controller.js
const Feedback = require('../../models/feedback.model');
const feedbackProcessor = require('../../core/feedback-processor');
const queueManager = require('../../queue/redis-queue');
const queueTypes = require('../../queue/queue-types');
const logger = require('../../utils/logger');

/**
 * Контроллер для управления обратной связью
 */
class FeedbackController {
  /**
   * Создание новой обратной связи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async createFeedback(req, res) {
    try {
      const {
        task_id,
        subtask_id,
        feedback_type,
        rating,
        comments,
        specific_issues,
        suggestions,
        ai_response_id,
        context
      } = req.body;
      
      // Валидация
      if (!feedback_type || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          error: 'Invalid feedback data. feedback_type and rating (1-5) are required.'
        });
      }
      
      // Создаем запись в БД
      const feedback = await Feedback.create({
        user_id: req.user.id,
        task_id,
        subtask_id,
        feedback_type,
        rating,
        comments,
        specific_issues: specific_issues ? JSON.stringify(specific_issues) : null,
        suggestions,
        ai_response_id,
        context: context ? JSON.stringify(context) : null
      });
      
      // Отправляем задачу обработки обратной связи в очередь
      const job = await queueManager.addJob('feedback-processing', {
        feedbackId: feedback.id
      });
      
      res.status(201).json({
        success: true,
        data: {
          id: feedback.id,
          jobId: job.id,
          message: 'Feedback submitted successfully'
        }
      });
    } catch (error) {
      logger.error(`Error creating feedback: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to create feedback',
        message: error.message
      });
    }
  }

  /**
   * Получение обратной связи по ID
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getFeedbackById(req, res) {
    try {
      const { feedbackId } = req.params;
      
      const feedback = await Feedback.findByPk(feedbackId, {
        include: [
          { association: 'user', attributes: ['id', 'name', 'email'] },
          { association: 'task', attributes: ['id', 'title', 'description'] },
          { association: 'subtask', attributes: ['id', 'title', 'description'] }
        ]
      });
      
      if (!feedback) {
        return res.status(404).json({
          success: false,
          error: 'Feedback not found'
        });
      }
      
      // Преобразуем JSON-поля
      const result = feedback.toJSON();
      if (result.specific_issues) {
        try {
          result.specific_issues = JSON.parse(result.specific_issues);
        } catch (e) {
          logger.warn(`Error parsing specific_issues for feedback ${feedbackId}`);
        }
      }
      
      if (result.context) {
        try {
          result.context = JSON.parse(result.context);
        } catch (e) {
          logger.warn(`Error parsing context for feedback ${feedbackId}`);
        }
      }
      
      if (result.processing_notes) {
        try {
          result.processing_notes = JSON.parse(result.processing_notes);
        } catch (e) {
          logger.warn(`Error parsing processing_notes for feedback ${feedbackId}`);
        }
      }
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error getting feedback: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get feedback',
        message: error.message
      });
    }
  }

  /**
   * Получение списка обратной связи с фильтрацией
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getFeedbackList(req, res) {
    try {
      const {
        task_id,
        subtask_id,
        user_id,
        feedback_type,
        min_rating,
        max_rating,
        processed,
        start_date,
        end_date,
        page = 1,
        limit = 20,
        sort_by = 'created_at',
        sort_order = 'DESC'
      } = req.query;
      
      // Формируем фильтры
      const filters = {
        taskId: task_id,
        subtaskId: subtask_id,
        userId: user_id,
        feedbackType: feedback_type,
        minRating: min_rating,
        maxRating: max_rating,
        processed: processed === 'true' ? true : processed === 'false' ? false : undefined,
        startDate: start_date,
        endDate: end_date
      };
      
      // Параметры пагинации
      const offset = (page - 1) * limit;
      
      // Выполняем запрос с учетом пагинации и сортировки
      const { count, rows } = await Feedback.findAndCountAll({
        where: { ...filters },
        include: [
          { association: 'user', attributes: ['id', 'name', 'email'] },
          { association: 'task', attributes: ['id', 'title'] },
          { association: 'subtask', attributes: ['id', 'title'] }
        ],
        order: [[sort_by, sort_order]],
        limit,
        offset
      });
      
      // Преобразуем JSON-поля для каждого feedback
      const formattedRows = rows.map(feedback => {
        const result = feedback.toJSON();
        
        if (result.specific_issues) {
          try {
            result.specific_issues = JSON.parse(result.specific_issues);
          } catch (e) {
            // Оставляем как есть в случае ошибки
          }
        }
        
        if (result.context) {
          try {
            result.context = JSON.parse(result.context);
          } catch (e) {
            // Оставляем как есть в случае ошибки
          }
        }
        
        if (result.processing_notes) {
          try {
            result.processing_notes = JSON.parse(result.processing_notes);
          } catch (e) {
            // Оставляем как есть в случае ошибки
          }
        }
        
        return result;
      });
      
      res.json({
        success: true,
        data: {
          total: count,
          totalPages: Math.ceil(count / limit),
          currentPage: page,
          feedbacks: formattedRows
        }
      });
    } catch (error) {
      logger.error(`Error getting feedback list: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get feedback list',
        message: error.message
      });
    }
  }

  /**
   * Получение агрегированных данных обратной связи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getFeedbackStats(req, res) {
    try {
      const {
        task_id,
        subtask_id,
        user_id,
        feedback_type,
        min_rating,
        max_rating,
        start_date,
        end_date
      } = req.query;
      
      // Формируем фильтры
      const filters = {
        taskId: task_id,
        subtaskId: subtask_id,
        userId: user_id,
        feedbackType: feedback_type,
        minRating: min_rating,
        maxRating: max_rating,
        startDate: start_date,
        endDate: end_date
      };
      
      // Получаем агрегированные данные
      const stats = await feedbackProcessor.getAggregatedFeedback(filters);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error(`Error getting feedback stats: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get feedback stats',
        message: error.message
      });
    }
  }
}

module.exports = new FeedbackController();

// src/api/routes/feedback/index.js
const express = require('express');
const router = express.Router();
const feedbackController = require('../../../controller/feedback/feedback.controller');
const authMiddleware = require('../../middleware/auth');
const validationMiddleware = require('../../middleware/validation');
const { feedbackValidationSchema } = require('./validation');

// Все эндпоинты для обратной связи требуют аутентификации
router.use(authMiddleware);

// Создание новой обратной связи
router.post(
  '/',
  validationMiddleware(feedbackValidationSchema), 
  feedbackController.createFeedback
);

// Получение обратной связи по ID
router.get('/:feedbackId', feedbackController.getFeedbackById);

// Получение списка обратной связи с фильтрацией
router.get('/', feedbackController.getFeedbackList);

// Получение агрегированных данных обратной связи
router.get('/stats/aggregate', feedbackController.getFeedbackStats);

module.exports = router;

// src/api/routes/feedback/validation.js
const Joi = require('joi');

// Схема валидации для создания обратной связи
const feedbackValidationSchema = Joi.object({
  task_id: Joi.number().integer().allow(null),
  subtask_id: Joi.number().integer().allow(null),
  feedback_type: Joi.string().valid(
    'code_quality', 
    'code_correctness', 
    'task_decomposition', 
    'bug_fixing', 
    'refactoring', 
    'general'
  ).required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comments: Joi.string().allow('', null),
  specific_issues: Joi.array().items(
    Joi.object({
      issue_type: Joi.string().required(),
      description: Joi.string().required(),
      severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
      file_path: Joi.string().allow('', null),
      line_number: Joi.number().integer().allow(null)
    })
  ).allow(null),
  suggestions: Joi.string().allow('', null),
  ai_response_id: Joi.string().allow('', null),
  context: Joi.object().allow(null)
});

module.exports = {
  feedbackValidationSchema
};




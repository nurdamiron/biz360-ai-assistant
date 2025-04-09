// src/controller/orchestrator.controller.js

const { Task, Transition } = require('../models');
const TaskOrchestrator = require('../core/orchestrator/task-orchestrator');
const logger = require('../utils/logger');

// Кэш оркестраторов для текущих задач
const orchestratorCache = new Map();

/**
 * Контроллер для управления задачами через оркестратор
 */
const orchestratorController = {
  /**
   * Создание новой задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async createTask(req, res) {
    try {
      const { title, description, projectId, priority = 'medium' } = req.body;
      const userId = req.user.id;
      
      // Создаем запись задачи в БД
      const task = await Task.create({
        title,
        description,
        projectId,
        userId,
        priority,
        status: 'pending',
        currentStep: 1,
        stepStatuses: [],
        context: {
          task: {
            title,
            description,
            priority
          },
          projectId,
          userId
        },
        createdAt: new Date()
      });
      
      logger.info(`Task created: ${task.id}`, {
        taskId: task.id,
        userId,
        projectId
      });
      
      return res.status(201).json({
        success: true,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          projectId: task.projectId,
          createdAt: task.createdAt
        }
      });
    } catch (error) {
      logger.error(`Error creating task: ${error.message}`, { error });
      return res.status(500).json({
        success: false,
        message: 'Error creating task',
        error: error.message
      });
    }
  },

  /**
   * Запуск выполнения задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async startTask(req, res) {
    try {
      const { taskId } = req.params;
      const { startStep } = req.body;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Проверяем, не запущена ли уже задача
      if (task.status === 'in_progress') {
        return res.status(409).json({
          success: false,
          message: 'Task is already running'
        });
      }
      
      // Получаем или создаем оркестратор для задачи
      let orchestrator = orchestratorCache.get(taskId);
      
      if (!orchestrator) {
        orchestrator = new TaskOrchestrator(task);
        orchestratorCache.set(taskId, orchestrator);
      }
      
      // Устанавливаем обработчики событий
      _setupEventHandlers(orchestrator);
      
      // Запускаем выполнение задачи
      await orchestrator.start(startStep);
      
      logger.info(`Task execution started: ${taskId}`, {
        taskId,
        startStep: startStep || task.currentStep || 1
      });
      
      return res.status(200).json({
        success: true,
        message: 'Task execution started',
        task: {
          id: task.id,
          status: 'in_progress',
          currentStep: startStep || task.currentStep || 1
        }
      });
    } catch (error) {
      logger.error(`Error starting task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error starting task',
        error: error.message
      });
    }
  },

  /**
   * Пауза выполнения задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async pauseTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Проверяем, запущена ли задача
      if (task.status !== 'in_progress') {
        return res.status(409).json({
          success: false,
          message: 'Task is not running'
        });
      }
      
      // Получаем оркестратор для задачи
      const orchestrator = orchestratorCache.get(taskId);
      
      if (!orchestrator) {
        return res.status(500).json({
          success: false,
          message: 'Orchestrator not found for running task'
        });
      }
      
      // Приостанавливаем выполнение задачи
      await orchestrator.pause();
      
      logger.info(`Task execution paused: ${taskId}`, { taskId });
      
      return res.status(200).json({
        success: true,
        message: 'Task execution paused',
        task: {
          id: task.id,
          status: 'paused'
        }
      });
    } catch (error) {
      logger.error(`Error pausing task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error pausing task',
        error: error.message
      });
    }
  },

  /**
   * Возобновление выполнения задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async resumeTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Проверяем, приостановлена ли задача
      if (task.status !== 'paused') {
        return res.status(409).json({
          success: false,
          message: 'Task is not paused'
        });
      }
      
      // Получаем оркестратор для задачи
      let orchestrator = orchestratorCache.get(taskId);
      
      if (!orchestrator) {
        // Если оркестратор не найден, создаем новый
        orchestrator = new TaskOrchestrator(task);
        orchestratorCache.set(taskId, orchestrator);
        
        // Устанавливаем обработчики событий
        _setupEventHandlers(orchestrator);
      }
      
      // Возобновляем выполнение задачи
      await orchestrator.resume();
      
      logger.info(`Task execution resumed: ${taskId}`, { taskId });
      
      return res.status(200).json({
        success: true,
        message: 'Task execution resumed',
        task: {
          id: task.id,
          status: 'in_progress',
          currentStep: task.currentStep
        }
      });
    } catch (error) {
      logger.error(`Error resuming task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error resuming task',
        error: error.message
      });
    }
  },

  /**
   * Отмена выполнения задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async cancelTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Получаем оркестратор для задачи
      const orchestrator = orchestratorCache.get(taskId);
      
      if (orchestrator) {
        // Отменяем выполнение задачи
        await orchestrator.cancel();
        orchestratorCache.delete(taskId);
      } else {
        // Если оркестратор не найден, просто обновляем статус задачи
        task.status = 'cancelled';
        await task.save();
      }
      
      logger.info(`Task execution cancelled: ${taskId}`, { taskId });
      
      return res.status(200).json({
        success: true,
        message: 'Task execution cancelled',
        task: {
          id: task.id,
          status: 'cancelled'
        }
      });
    } catch (error) {
      logger.error(`Error cancelling task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error cancelling task',
        error: error.message
      });
    }
  },

  /**
   * Переход к определенному шагу задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async transitionTask(req, res) {
    try {
      const { taskId } = req.params;
      const { stepNumber, reason = 'manual' } = req.body;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Проверяем корректность номера шага
      if (stepNumber < 1 || stepNumber > 16) {
        return res.status(400).json({
          success: false,
          message: 'Invalid step number. Must be between 1 and 16.'
        });
      }
      
      // Получаем оркестратор для задачи
      let orchestrator = orchestratorCache.get(taskId);
      
      if (!orchestrator) {
        // Если оркестратор не найден, создаем новый
        orchestrator = new TaskOrchestrator(task);
        orchestratorCache.set(taskId, orchestrator);
        
        // Устанавливаем обработчики событий
        _setupEventHandlers(orchestrator);
      }
      
      // Выполняем переход к указанному шагу
      await orchestrator.goToStep(stepNumber, reason);
      
      logger.info(`Task transitioned to step ${stepNumber}: ${taskId}`, {
        taskId,
        fromStep: task.currentStep,
        toStep: stepNumber,
        reason
      });
      
      return res.status(200).json({
        success: true,
        message: `Task transitioned to step ${stepNumber}`,
        task: {
          id: task.id,
          currentStep: stepNumber
        }
      });
    } catch (error) {
      logger.error(`Error transitioning task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error transitioning task',
        error: error.message
      });
    }
  },

  /**
   * Получение детальной информации о задаче
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async getTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Получаем задачу с историей статусов шагов
      const task = await Task.findByPk(taskId, {
        include: [
          { association: 'stepStatuses' }
        ]
      });
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      return res.status(200).json({
        success: true,
        task
      });
    } catch (error) {
      logger.error(`Error getting task: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error getting task',
        error: error.message
      });
    }
  },

  /**
   * Получение списка задач с фильтрацией и пагинацией
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async getTasks(req, res) {
    try {
      const { status, projectId, page = 1, limit = 20 } = req.query;
      const userId = req.user.id;
      
      // Формируем условия для фильтрации
      const where = { userId };
      
      if (status) {
        where.status = status;
      }
      
      if (projectId) {
        where.projectId = projectId;
      }
      
      // Вычисляем смещение для пагинации
      const offset = (page - 1) * limit;
      
      // Получаем задачи
      const { count, rows: tasks } = await Task.findAndCountAll({
        where,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['createdAt', 'DESC']]
      });
      
      return res.status(200).json({
        success: true,
        tasks,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit)
        }
      });
    } catch (error) {
      logger.error(`Error getting tasks: ${error.message}`, { error });
      
      return res.status(500).json({
        success: false,
        message: 'Error getting tasks',
        error: error.message
      });
    }
  },

  /**
   * Получение текущего состояния задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async getTaskState(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Получаем оркестратор для задачи
      let orchestrator = orchestratorCache.get(taskId);
      
      let state;
      
      if (orchestrator) {
        // Если оркестратор существует, получаем состояние от него
        state = await orchestrator.getState();
      } else {
        // Иначе формируем состояние из данных БД
        state = {
          taskId,
          status: task.status,
          currentStep: task.currentStep,
          isRunning: task.status === 'in_progress',
          isPaused: task.status === 'paused',
          isCompleted: task.status === 'completed',
          context: task.context
        };
      }
      
      return res.status(200).json({
        success: true,
        state
      });
    } catch (error) {
      logger.error(`Error getting task state: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error getting task state',
        error: error.message
      });
    }
  },

  /**
   * Получение истории выполнения задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async getTaskHistory(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Получаем историю статусов шагов
      const stepStatuses = await task.getStepStatuses({
        order: [['createdAt', 'ASC']]
      });
      
      // Получаем историю переходов
      const transitions = await Transition.findAll({
        where: { taskId },
        order: [['timestamp', 'ASC']]
      });
      
      // Формируем хронологическую историю выполнения
      const events = [
        ...stepStatuses.map(status => ({
          type: 'step_status',
          step: status.step,
          status: status.status,
          timestamp: status.startedAt || status.createdAt,
          data: status
        })),
        ...transitions.map(transition => ({
          type: 'transition',
          fromStep: transition.fromStep,
          toStep: transition.toStep,
          trigger: transition.trigger,
          timestamp: transition.timestamp,
          data: transition
        }))
      ];
      
      // Сортируем события по времени
      events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      return res.status(200).json({
        success: true,
        taskId,
        events
      });
    } catch (error) {
      logger.error(`Error getting task history: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error getting task history',
        error: error.message
      });
    }
  },

  /**
   * Получение метрик производительности задачи
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @returns {Promise<void>}
   */
  async getTaskMetrics(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        return res.status(404).json({
          success: false,
          message: `Task with ID ${taskId} not found`
        });
      }
      
      // Получаем оркестратор для задачи
      let orchestrator = orchestratorCache.get(taskId);
      
      let metrics;
      
      if (orchestrator) {
        // Если оркестратор существует, получаем метрики от него
        metrics = await orchestrator.metricsCollector.collectTaskMetrics(taskId);
      } else {
        // Иначе здесь можно было бы загрузить метрики из БД
        // Для примера возвращаем заглушку
        metrics = {
          taskId,
          message: 'No active orchestrator for task, metrics unavailable'
        };
      }
      
      return res.status(200).json({
        success: true,
        metrics
      });
    } catch (error) {
      logger.error(`Error getting task metrics: ${error.message}`, {
        taskId: req.params.taskId,
        error
      });
      
      return res.status(500).json({
        success: false,
        message: 'Error getting task metrics',
        error: error.message
      });
    }
  }
};

/**
 * Настройка обработчиков событий для оркестратора
 * @param {TaskOrchestrator} orchestrator - Экземпляр оркестратора
 * @private
 */
function _setupEventHandlers(orchestrator) {
  orchestrator.on('error', async ({ error, taskId, step }) => {
    logger.error(`Orchestrator error for task ${taskId}: ${error.message}`, {
      taskId,
      step,
      error
    });
    
    // Здесь можно добавить логику обработки ошибок оркестратора
    // Например, отправку уведомлений, запись в лог и т.д.
  });
  
  orchestrator.on('completed', async ({ taskId }) => {
    logger.info(`Task ${taskId} completed successfully`);
    
    // Удаляем оркестратор из кэша
    orchestratorCache.delete(taskId);
    
    // Здесь можно добавить логику обработки завершения задачи
    // Например, отправку уведомлений, обновление связанных сущностей и т.д.
  });
  
  orchestrator.on('failed', async ({ taskId, step, error }) => {
    logger.error(`Task ${taskId} failed at step ${step}: ${error.message}`, {
      taskId,
      step,
      error
    });
    
    // Удаляем оркестратор из кэша
    orchestratorCache.delete(taskId);
    
    // Здесь можно добавить логику обработки неудачного выполнения задачи
  });
  
  // Можно добавить обработчики для других событий оркестратора
}

module.exports = orchestratorController;
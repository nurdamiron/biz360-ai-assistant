// src/controller/task/task-ai.controller.js (обновленная версия)
const Task = require('../../models/task.model');
const Subtask = require('../../models/subtask.model');
const taskDecomposer = require('../../core/task-planner/decomposer');
const taskAnalyzer = require('../../core/task-planner/task-analyzer');
const queueManager = require('../../queue/redis-queue');
const queueTypes = require('../../queue/queue-types');
const logger = require('../../utils/logger');
const projectContext = require('../../core/project-understanding');
const websocketManager = require('../../websocket');

/**
 * Контроллер для AI-операций с задачами
 */
class TaskAIController {
  /**
   * Запуск декомпозиции задачи на подзадачи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async decomposeTask(req, res) {
    try {
      const { taskId } = req.params;
      const { maxSubtasks, force = false } = req.body;
      
      // Получаем задачу из БД
      const task = await Task.findByPk(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      // Проверяем, есть ли уже подзадачи
      const existingSubtasks = await Subtask.count({
        where: { task_id: taskId }
      });
      
      if (existingSubtasks > 0 && !force) {
        return res.status(400).json({
          success: false,
          error: 'Task already has subtasks. Use force=true to override.',
          existingSubtasksCount: existingSubtasks
        });
      }
      
      // Обновляем статус задачи
      await task.update({ ai_processing_status: 'queued' });
      
      // Отправляем задачу декомпозиции в очередь
      const job = await queueManager.addJob(queueTypes.TASK_DECOMPOSITION, {
        taskId,
        userId: req.user.id,
        maxSubtasks: maxSubtasks || 10
      });
      
      // Отправляем уведомление через WebSocket
      websocketManager.sendToUser(req.user.id, {
        type: 'task_decomposition_queued',
        data: {
          taskId,
          jobId: job.id
        }
      });
      
      res.json({
        success: true,
        message: 'Task decomposition queued',
        data: {
          taskId,
          jobId: job.id
        }
      });
    } catch (error) {
      logger.error(`Error requesting task decomposition: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to queue task decomposition',
        message: error.message
      });
    }
  }

  /**
   * Получение предварительного анализа задачи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async analyzeTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Получаем задачу из БД
      const task = await Task.findByPk(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      // Выполняем анализ задачи
      const analysis = await taskAnalyzer.analyzeTask(task);
      
      // Получаем контекст проекта
      const context = await projectContext.getContextForTask(task);
      
      // Определяем требуемые технологии
      const technologies = await taskAnalyzer.identifyRequiredTechnologies(task, context);
      
      // Извлекаем требования
      const requirements = await taskAnalyzer.extractRequirements(task);
      
      res.json({
        success: true,
        data: {
          taskId,
          analysis,
          technologies,
          requirements,
          projectContext: {
            repositoryStructure: context.repositoryStructure,
            projectTechnologies: context.technologies
          }
        }
      });
    } catch (error) {
      logger.error(`Error analyzing task: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to analyze task',
        message: error.message
      });
    }
  }

  /**
   * Проверка статуса выполнения AI-задач для задачи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async checkTaskAIStatus(req, res) {
    try {
      const { taskId } = req.params;
      
      // Получаем задачу из БД
      const task = await Task.findByPk(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      // Формируем общий статус
      const status = {
        taskId,
        aiProcessingStatus: task.ai_processing_status,
        aiProcessingStartedAt: task.ai_processing_started_at,
        aiProcessingCompletedAt: task.ai_processing_completed_at,
        aiProcessingError: task.ai_processing_error,
        subtasksCount: await Subtask.count({ where: { task_id: taskId } })
      };
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error(`Error checking task AI status: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to check AI status',
        message: error.message
      });
    }
  }

  /**
   * Получение рекомендаций по задаче
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getTaskRecommendations(req, res) {
    try {
      const { taskId } = req.params;
      
      // Получаем задачу из БД
      const task = await Task.findByPk(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      // Анализируем задачу
      const analysis = await taskAnalyzer.analyzeTask(task);
      
      // Получаем контекст проекта
      const context = await projectContext.getContextForTask(task);
      
      // Получаем шаблон промпта
      const promptTemplate = await getPromptTemplate('task-recommendations');
      
      // Формируем контекст для промпта
      const promptContext = {
        taskTitle: task.title,
        taskDescription: task.description,
        taskAnalysis: analysis,
        projectContext: context
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let recommendations = {};
      
      try {
        if (typeof response === 'string') {
          recommendations = JSON.parse(response);
        } else {
          recommendations = response;
        }
      } catch (parseError) {
        logger.error(`Error parsing LLM recommendations response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        recommendations = {
          suggestedApproach: 'Unable to generate recommendations',
          resources: [],
          warnings: [`Error parsing recommendations: ${parseError.message}`]
        };
      }
      
      res.json({
        success: true,
        data: {
          taskId,
          recommendations
        }
      });
    } catch (error) {
      logger.error(`Error getting task recommendations: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get task recommendations',
        message: error.message
      });
    }
  }
}

module.exports = new TaskAIController();
// src/core/orchestrator/state-manager.js

const { Task, TaskLifecycle } = require('../../models');
const logger = require('../../utils/logger');

/**
 * Менеджер состояний задачи
 * Отвечает за загрузку и сохранение состояния задачи в БД
 */
class StateManager {
  /**
   * Инициализация менеджера состояний
   * @param {object} task - Объект задачи
   * @returns {Promise<void>}
   */
  async initialize(task) {
    this.task = task;
    logger.debug('StateManager initialized', { taskId: task.id });
  }

  /**
   * Загрузка задачи из БД
   * @param {string} taskId - ID задачи
   * @returns {Promise<object>} - Объект задачи
   * @throws {Error} - Если задача не найдена
   */
  async loadTask(taskId) {
    try {
      const task = await Task.findByPk(taskId, {
        include: [
          { model: TaskLifecycle, as: 'stepStatuses' }
        ]
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      this.task = task;
      return task;
    } catch (error) {
      logger.error(`Error loading task ${taskId}: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Сохранение задачи в БД
   * @param {object} task - Объект задачи
   * @returns {Promise<object>} - Обновленный объект задачи
   */
  async saveTask(task) {
    try {
      this.task = task;
      await task.save();
      return task;
    } catch (error) {
      logger.error(`Error saving task ${task.id}: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Обновление статуса задачи
   * @param {string} taskId - ID задачи
   * @param {string} status - Новый статус ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'paused')
   * @returns {Promise<object>} - Обновленный объект задачи
   */
  async updateTaskStatus(taskId, status) {
    try {
      const task = await this.loadTask(taskId);
      
      const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'paused'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid task status: ${status}`);
      }
      
      task.status = status;
      task.updatedAt = new Date();
      
      if (status === 'completed') {
        task.completedAt = new Date();
      }
      
      await this.saveTask(task);
      
      logger.info(`Task ${taskId} status updated to ${status}`);
      return task;
    } catch (error) {
      logger.error(`Error updating task status: ${error.message}`, { taskId, error });
      throw error;
    }
  }

  /**
   * Обновление статуса шага
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @param {string} status - Статус шага ('pending', 'in_progress', 'completed', 'failed', 'skipped')
   * @param {string} [error=null] - Сообщение об ошибке (если статус 'failed')
   * @param {object} [output=null] - Результат выполнения шага (если статус 'completed')
   * @returns {Promise<object>} - Обновленный объект статуса шага
   */
  async updateStepStatus(taskId, stepNumber, status, error = null, output = null) {
    try {
      const task = await this.loadTask(taskId);
      
      const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'skipped'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid step status: ${status}`);
      }
      
      // Найти существующий статус шага или создать новый
      let stepStatus = task.stepStatuses.find(s => s.step === stepNumber);
      
      if (!stepStatus) {
        // Если статус шага не существует, создаем новый
        stepStatus = await TaskLifecycle.create({
          taskId,
          step: stepNumber,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          error: null,
          output: null,
          metadata: {}
        });
        
        task.stepStatuses.push(stepStatus);
      }
      
      // Обновляем статус шага
      stepStatus.status = status;
      
      if (status === 'in_progress' && !stepStatus.startedAt) {
        stepStatus.startedAt = new Date();
      }
      
      if (['completed', 'failed', 'skipped'].includes(status)) {
        stepStatus.completedAt = new Date();
      }
      
      if (status === 'failed' && error) {
        stepStatus.error = error;
      }
      
      if (status === 'completed' && output) {
        stepStatus.output = output;
      }
      
      await stepStatus.save();
      
      // Обновляем текущий шаг задачи
      if (status === 'completed' || status === 'skipped') {
        // Если шаг завершен или пропущен, текущим становится следующий
        task.currentStep = stepNumber + 1;
        if (task.currentStep > 16) {
          // Если это был последний шаг, то задача завершена
          task.currentStep = null;
          task.status = 'completed';
          task.completedAt = new Date();
        }
      } else if (status === 'in_progress') {
        // Если шаг выполняется, он становится текущим
        task.currentStep = stepNumber;
      }
      
      await this.saveTask(task);
      
      logger.info(`Step ${stepNumber} for task ${taskId} status updated to ${status}`);
      return stepStatus;
    } catch (error) {
      logger.error(`Error updating step status: ${error.message}`, {
        taskId,
        stepNumber,
        error
      });
      throw error;
    }
  }

  /**
   * Получить историю статусов шагов
   * @param {string} taskId - ID задачи
   * @returns {Promise<Array>} - История статусов шагов
   */
  async getStepHistory(taskId) {
    try {
      const task = await this.loadTask(taskId);
      return task.stepStatuses.sort((a, b) => {
        // Сортировка по шагу и времени начала
        if (a.step !== b.step) {
          return a.step - b.step;
        }
        return new Date(a.startedAt || 0) - new Date(b.startedAt || 0);
      });
    } catch (error) {
      logger.error(`Error getting step history: ${error.message}`, { taskId, error });
      throw error;
    }
  }
}

module.exports = StateManager;


// src/core/task-workflow-engine.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');
const taskLogger = require('../utils/task-logger');
const websocket = require('../websocket');
const TaskLifecycle = require('../models/task-lifecycle.model');

/**
 * Движок для управления автоматическими переходами в рабочем процессе задач
 */
class TaskWorkflowEngine {
  /**
   * Выполняет автоматические переходы на основе события
   * @param {string} eventType - Тип события
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   */
  async processEvent(eventType, eventData) {
    try {
      logger.debug(`TaskWorkflowEngine: Обработка события ${eventType}`, eventData);
      
      switch (eventType) {
        case 'code_generation_completed':
          return await this.handleCodeGenerationCompleted(eventData);
          
        case 'code_review_completed':
          return await this.handleCodeReviewCompleted(eventData);
          
        case 'subtasks_all_completed':
          return await this.handleAllSubtasksCompleted(eventData);
          
        case 'task_inactive':
          return await this.handleTaskInactive(eventData);
          
        case 'task_blocked_dependents':
          return await this.handleTaskBlockedDependents(eventData);
          
        default:
          logger.warn(`TaskWorkflowEngine: Неизвестный тип события: ${eventType}`);
          return null;
      }
    } catch (error) {
      logger.error(`TaskWorkflowEngine: Ошибка при обработке события ${eventType}:`, error);
      return null;
    }
  }

  /**
   * Обрабатывает событие завершения генерации кода
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   * @private
   */
  async handleCodeGenerationCompleted(eventData) {
    try {
      const { taskId, generationId, success } = eventData;
      
      if (!taskId) {
        throw new Error('Отсутствует обязательный параметр taskId');
      }
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем, что задача существует и находится в подходящем статусе
      if (!task || task.status !== 'in_progress') {
        return null;
      }
      
      // Если генерация прошла успешно, переводим задачу в статус "code_review"
      if (success) {
        return await this.changeTaskStatus(
          taskId, 
          'code_review', 
          'Автоматический переход: Код сгенерирован и готов к проверке',
          null, // userId (пустой для системных переходов)
          { generationId }
        );
      }
      
      return null;
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при обработке генерации кода:', error);
      return null;
    }
  }

  /**
   * Обрабатывает событие завершения проверки кода
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   * @private
   */
  async handleCodeReviewCompleted(eventData) {
    try {
      const { taskId, reviewId, reviewResult } = eventData;
      
      if (!taskId || !reviewResult) {
        throw new Error('Отсутствуют обязательные параметры');
      }
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем, что задача существует и находится в подходящем статусе
      if (!task || task.status !== 'code_review') {
        return null;
      }
      
      // Проверяем оценку проверки
      if (reviewResult.score >= 7) {
        // Если оценка высокая, переводим задачу в статус "testing"
        return await this.changeTaskStatus(
          taskId, 
          'testing', 
          `Автоматический переход: Код успешно прошел проверку с оценкой ${reviewResult.score}/10`,
          null,
          { reviewId, reviewResult }
        );
      } else if (reviewResult.score < 4) {
        // Если оценка низкая, возвращаем задачу в работу
        return await this.changeTaskStatus(
          taskId, 
          'in_progress', 
          `Автоматический переход: Код не прошел проверку (оценка ${reviewResult.score}/10)`,
          null,
          { reviewId, reviewResult }
        );
      }
      
      return null;
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при обработке проверки кода:', error);
      return null;
    }
  }

  /**
   * Обрабатывает событие завершения всех подзадач
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   * @private
   */
  async handleAllSubtasksCompleted(eventData) {
    try {
      const { taskId } = eventData;
      
      if (!taskId) {
        throw new Error('Отсутствует обязательный параметр taskId');
      }
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем, что задача существует и не находится в конечном статусе
      if (!task || TaskLifecycle.isFinalStatus(task.status)) {
        return null;
      }
      
      // Если задача в статусе "testing", переводим в "completed"
      if (task.status === 'testing') {
        return await this.changeTaskStatus(
          taskId, 
          'completed', 
          'Автоматический переход: Все подзадачи выполнены и тестирование завершено',
          null
        );
      }
      
      return null;
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при обработке завершения всех подзадач:', error);
      return null;
    }
  }

  /**
   * Обрабатывает событие неактивности задачи
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   * @private
   */
  async handleTaskInactive(eventData) {
    try {
      const { taskId, inactiveDays } = eventData;
      
      if (!taskId || !inactiveDays) {
        throw new Error('Отсутствуют обязательные параметры');
      }
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем, что задача существует и не находится в конечном статусе
      if (!task || TaskLifecycle.isFinalStatus(task.status)) {
        return null;
      }
      
      // Если задача неактивна более 30 дней, автоматически закрываем
      if (inactiveDays > 30) {
        return await this.changeTaskStatus(
          taskId, 
          'closed', 
          `Автоматический переход: Задача была неактивна более ${inactiveDays} дней`,
          null
        );
      }
      
      return null;
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при обработке неактивности задачи:', error);
      return null;
    }
  }

  /**
   * Обрабатывает событие блокировки зависимых задач
   * @param {Object} eventData - Данные события
   * @returns {Promise<Object|null>} - Результат перехода или null
   * @private
   */
  async handleTaskBlockedDependents(eventData) {
    try {
      const { taskId, blockedByTaskId } = eventData;
      
      if (!taskId || !blockedByTaskId) {
        throw new Error('Отсутствуют обязательные параметры');
      }
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем, что задача существует и находится в активном статусе
      if (!task || TaskLifecycle.isFinalStatus(task.status)) {
        return null;
      }
      
      // Если задача не в статусе "blocked", блокируем ее
      if (task.status !== 'blocked') {
        return await this.changeTaskStatus(
          taskId, 
          'blocked', 
          `Автоматический переход: Задача заблокирована из-за зависимости от задачи #${blockedByTaskId}`,
          null,
          { blockedByTaskId }
        );
      }
      
      return null;
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при обработке блокировки зависимых задач:', error);
      return null;
    }
  }

  /**
   * Получает информацию о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object|null>} - Информация о задаче или null
   * @private
   */
  async getTaskInfo(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      return tasks.length > 0 ? tasks[0] : null;
    } catch (error) {
      logger.error(`TaskWorkflowEngine: Ошибка при получении информации о задаче #${taskId}:`, error);
      return null;
    }
  }

  /**
   * Изменяет статус задачи
   * @param {number} taskId - ID задачи
   * @param {string} newStatus - Новый статус
   * @param {string} comment - Комментарий к изменению статуса
   * @param {number|null} userId - ID пользователя или null для системных действий
   * @param {Object} metadata - Дополнительные данные
   * @returns {Promise<Object|null>} - Результат операции или null
   * @private
   */
  async changeTaskStatus(taskId, newStatus, comment, userId = null, metadata = {}) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем текущий статус задачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return null;
      }
      
      const task = tasks[0];
      const oldStatus = task.status;
      
      // Проверяем, что статус изменился
      if (oldStatus === newStatus) {
        connection.release();
        return null;
      }
      
      // Проверяем, допустим ли переход
      if (!TaskLifecycle.isValidTransition(oldStatus, newStatus)) {
        logger.warn(`TaskWorkflowEngine: Недопустимый переход статуса: ${oldStatus} -> ${newStatus} для задачи #${taskId}`);
        connection.release();
        return null;
      }
      
      await connection.beginTransaction();
      
      try {
        // Обновляем статус
        if (TaskLifecycle.isFinalStatus(newStatus)) {
          // Если это финальный статус, устанавливаем completed_at
          await connection.query(
            'UPDATE tasks SET status = ?, updated_at = NOW(), completed_at = NOW() WHERE id = ?',
            [newStatus, taskId]
          );
        } else {
          // Для других статусов
          await connection.query(
            'UPDATE tasks SET status = ?, updated_at = NOW(), completed_at = NULL WHERE id = ?',
            [newStatus, taskId]
          );
        }
        
        // Логируем изменение статуса
        const statusChangeText = TaskLifecycle.getStatusChangeText(oldStatus, newStatus);
        await taskLogger.logInfo(taskId, statusChangeText);
        
        if (comment) {
          // Если указан комментарий, добавляем его
          await taskLogger.logInfo(taskId, comment);
        }
        
        // Записываем историю изменения статуса
        await connection.query(
          `INSERT INTO task_status_history 
           (task_id, previous_status, new_status, user_id, comment, created_at) 
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [taskId, oldStatus, newStatus, userId, comment]
        );
        
        // Получаем обновленную задачу
        const [updatedTasks] = await connection.query(
          `SELECT t.*, u.username as assignee_name, p.name as project_name
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           LEFT JOIN projects p ON t.project_id = p.id
           WHERE t.id = ?`,
          [taskId]
        );
        
        await connection.commit();
        
        const updatedTask = updatedTasks[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_status_changed',
            task: updatedTask,
            oldStatus,
            newStatus,
            automatic: true,
            metadata
          });
          
          wsServer.notifySubscribers('project', updatedTask.project_id, {
            type: 'task_status_changed',
            task: updatedTask,
            oldStatus,
            newStatus,
            automatic: true,
            metadata
          });
        }
        
        connection.release();
        
        return {
          success: true,
          task: updatedTask,
          oldStatus,
          newStatus,
          metadata
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`TaskWorkflowEngine: Ошибка при изменении статуса задачи #${taskId}:`, error);
      return null;
    }
  }

  /**
   * Запускает проверку неактивных задач
   * @returns {Promise<void>}
   */
  async checkInactiveTasks() {
    try {
      logger.debug('TaskWorkflowEngine: Запуск проверки неактивных задач');
      
      const connection = await pool.getConnection();
      
      // Находим задачи, которые не обновлялись более 14 дней и не в конечном статусе
      const [inactiveTasks] = await connection.query(`
        SELECT id, status, DATEDIFF(NOW(), updated_at) as inactive_days
        FROM tasks
        WHERE 
          status NOT IN ('completed', 'failed', 'cancelled', 'closed') 
          AND DATEDIFF(NOW(), updated_at) > 14
      `);
      
      connection.release();
      
      logger.debug(`TaskWorkflowEngine: Найдено ${inactiveTasks.length} неактивных задач`);
      
      // Обрабатываем каждую неактивную задачу
      for (const task of inactiveTasks) {
        await this.processEvent('task_inactive', {
          taskId: task.id,
          inactiveDays: task.inactive_days
        });
      }
    } catch (error) {
      logger.error('TaskWorkflowEngine: Ошибка при проверке неактивных задач:', error);
    }
  }
}

module.exports = new TaskWorkflowEngine();
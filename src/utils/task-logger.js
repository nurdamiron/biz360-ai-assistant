// src/utils/task-logger.js

/**
 * Утилита для логирования прогресса выполнения задач
 * Сохраняет логи в БД и отправляет уведомления через WebSocket
 */

const { pool } = require('../config/db.config');
const logger = require('./logger');
const websocket = require('../websocket');

class TaskLogger {
  /**
   * Логирует сообщение о прогрессе задачи
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение
   * @param {number} progress - Прогресс выполнения (0-100)
   * @returns {Promise<number>} - ID созданной записи
   */
  async logProgress(taskId, message, progress) {
    return this.logMessage(taskId, 'progress', message, progress);
  }

  /**
   * Логирует информационное сообщение о задаче
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение
   * @returns {Promise<number>} - ID созданной записи
   */
  async logInfo(taskId, message) {
    return this.logMessage(taskId, 'info', message);
  }

  /**
   * Логирует предупреждение о задаче
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение
   * @returns {Promise<number>} - ID созданной записи
   */
  async logWarning(taskId, message) {
    return this.logMessage(taskId, 'warning', message);
  }

  /**
   * Логирует ошибку задачи
   * @param {number} taskId - ID задачи
   * @param {string} message - Сообщение
   * @param {Error} [error] - Объект ошибки (опционально)
   * @returns {Promise<number>} - ID созданной записи
   */
  async logError(taskId, message, error) {
    const fullMessage = error ? 
      `${message}: ${error.message}\n${error.stack || ''}` : 
      message;
    
    return this.logMessage(taskId, 'error', fullMessage);
  }

  /**
   * Основной метод логирования сообщений
   * @param {number} taskId - ID задачи
   * @param {string} logType - Тип лога ('info', 'warning', 'error', 'progress')
   * @param {string} message - Сообщение
   * @param {number} [progress] - Прогресс выполнения (0-100)
   * @returns {Promise<number>} - ID созданной записи
   * @private
   */
  async logMessage(taskId, logType, message, progress = null) {
    try {
      // Валидация входных данных
      if (!taskId) {
        logger.warn('TaskLogger: попытка логирования без ID задачи');
        return null;
      }
      
      if (!message) {
        logger.warn(`TaskLogger: попытка логирования пустого сообщения для задачи #${taskId}`);
        return null;
      }
      
      // Логируем в систему логирования
      switch (logType) {
        case 'error':
          logger.error(`Задача #${taskId}: ${message}`);
          break;
        case 'warning':
          logger.warn(`Задача #${taskId}: ${message}`);
          break;
        case 'progress':
          logger.debug(`Задача #${taskId} [${progress}%]: ${message}`);
          break;
        case 'info':
        default:
          logger.info(`Задача #${taskId}: ${message}`);
      }
      
      // Сохраняем в БД
      const connection = await pool.getConnection();
      
      const [result] = await connection.query(
        `INSERT INTO task_logs 
         (task_id, log_type, message, progress) 
         VALUES (?, ?, ?, ?)`,
        [taskId, logType, message, progress]
      );
      
      connection.release();
      
      const logId = result.insertId;
      
      // Отправляем уведомление через WebSocket
      this.notifySubscribers(taskId, {
        id: logId,
        task_id: taskId,
        log_type: logType,
        message,
        progress,
        created_at: new Date()
      });
      
      return logId;
    } catch (error) {
      logger.error(`Ошибка при логировании сообщения для задачи #${taskId}:`, error);
      return null;
    }
  }

  /**
   * Получает список логов для задачи
   * @param {number} taskId - ID задачи
   * @param {Object} options - Опции запроса
   * @param {number} [options.limit=100] - Лимит записей
   * @param {number} [options.offset=0] - Смещение
   * @param {string} [options.logType] - Фильтр по типу лога
   * @returns {Promise<Array>} - Список логов
   */
  async getTaskLogs(taskId, options = {}) {
    try {
      const { limit = 100, offset = 0, logType } = options;
      
      const connection = await pool.getConnection();
      
      let query = 'SELECT * FROM task_logs WHERE task_id = ?';
      const params = [taskId];
      
      if (logType) {
        query += ' AND log_type = ?';
        params.push(logType);
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const [logs] = await connection.query(query, params);
      
      connection.release();
      
      return logs;
    } catch (error) {
      logger.error(`Ошибка при получении логов для задачи #${taskId}:`, error);
      return [];
    }
  }

  /**
   * Отправляет уведомление подписчикам через WebSocket
   * @param {number} taskId - ID задачи
   * @param {Object} logData - Данные лога
   * @private
   */
  notifySubscribers(taskId, logData) {
    try {
      const wsServer = websocket.getInstance();
      
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_log',
          log: logData
        });
      }
    } catch (error) {
      logger.error(`Ошибка при отправке уведомления подписчикам для задачи #${taskId}:`, error);
    }
  }
}

// Создаем и экспортируем экземпляр логгера задач
const taskLogger = new TaskLogger();

module.exports = taskLogger;
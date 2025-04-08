// src/core/orchestrator/notification-manager.js

const logger = require('../../utils/logger');
const WebSocket = require('../../websocket');

/**
 * Менеджер уведомлений
 * Отправляет уведомления о прогрессе выполнения задачи через WebSocket
 */
class NotificationManager {
  /**
   * Инициализация менеджера уведомлений
   * @param {object} task - Объект задачи
   * @returns {Promise<void>}
   */
  async initialize(task) {
    this.taskId = task.id;
    this.userId = task.userId;
    this.projectId = task.projectId;
    
    logger.debug('NotificationManager initialized', {
      taskId: this.taskId,
      userId: this.userId
    });
  }

  /**
   * Отправка уведомления
   * @param {string} eventType - Тип события
   * @param {object} data - Данные уведомления
   * @returns {Promise<void>}
   */
  async sendNotification(eventType, data) {
    try {
      const notificationData = {
        eventType,
        taskId: this.taskId,
        timestamp: new Date(),
        ...data
      };
      
      // Отправляем уведомление через WebSocket
      await this._sendWebSocketNotification(notificationData);
      
      // Сохраняем уведомление в БД для истории
      await this._persistNotification(notificationData);
      
      logger.debug(`Notification sent: ${eventType}`, {
        taskId: this.taskId,
        eventType
      });
    } catch (error) {
      logger.error(`Error sending notification: ${error.message}`, {
        taskId: this.taskId,
        eventType,
        error
      });
      // Не выбрасываем ошибку, чтобы не прерывать основной процесс
    }
  }

  /**
   * Отправка уведомления через WebSocket
   * @param {object} notificationData - Данные уведомления
   * @returns {Promise<void>}
   * @private
   */
  async _sendWebSocketNotification(notificationData) {
    try {
      // Определяем каналы для отправки уведомления
      const channels = this._getNotificationChannels(notificationData);
      
      // Отправляем уведомление по всем каналам
      for (const channel of channels) {
        WebSocket.sendToChannel(channel, 'task_progress', notificationData);
      }
    } catch (error) {
      logger.error(`WebSocket notification error: ${error.message}`, {
        taskId: this.taskId,
        error
      });
    }
  }

  /**
   * Получение каналов для отправки уведомления
   * @param {object} notificationData - Данные уведомления
   * @returns {Array<string>} - Массив каналов
   * @private
   */
  _getNotificationChannels(notificationData) {
    const channels = [];
    
    // Канал конкретной задачи
    channels.push(`task:${this.taskId}`);
    
    // Канал пользователя
    if (this.userId) {
      channels.push(`user:${this.userId}`);
    }
    
    // Канал проекта
    if (this.projectId) {
      channels.push(`project:${this.projectId}`);
    }
    
    // Канал администраторов (для системных событий)
    if (notificationData.eventType.startsWith('system_')) {
      channels.push('admin');
    }
    
    return channels;
  }

  /**
   * Сохранение уведомления в БД
   * @param {object} notificationData - Данные уведомления
   * @returns {Promise<void>}
   * @private
   */
  async _persistNotification(notificationData) {
    try {
      // В реальной реализации здесь может быть сохранение в БД
      // Например, через модель Notification
      /*
      const { Notification } = require('../../models');
      await Notification.create({
        taskId: this.taskId,
        userId: this.userId,
        projectId: this.projectId,
        eventType: notificationData.eventType,
        data: JSON.stringify(notificationData),
        createdAt: notificationData.timestamp
      });
      */
      
      // Для примера просто логируем
      logger.debug('Would persist notification to DB', {
        taskId: this.taskId,
        eventType: notificationData.eventType
      });
    } catch (error) {
      logger.error(`Error persisting notification: ${error.message}`, {
        taskId: this.taskId,
        error
      });
    }
  }

  /**
   * Отправка уведомления о прогрессе задачи
   * @param {number} stepNumber - Номер шага
   * @param {number} progress - Прогресс выполнения шага (0-100)
   * @param {string} [message=null] - Сообщение о прогрессе
   * @returns {Promise<void>}
   */
  async sendProgressUpdate(stepNumber, progress, message = null) {
    await this.sendNotification('step_progress', {
      taskId: this.taskId,
      step: stepNumber,
      progress,
      message
    });
  }

  /**
   * Отправка уведомления об ошибке
   * @param {number} stepNumber - Номер шага
   * @param {string} errorMessage - Сообщение об ошибке
   * @param {string} [errorType=null] - Тип ошибки
   * @returns {Promise<void>}
   */
  async sendErrorNotification(stepNumber, errorMessage, errorType = null) {
    await this.sendNotification('error', {
      taskId: this.taskId,
      step: stepNumber,
      errorMessage,
      errorType
    });
  }

  /**
   * Отправка уведомления с запросом действия от пользователя
   * @param {number} stepNumber - Номер шага
   * @param {string} action - Тип требуемого действия ('confirm', 'choose', 'input')
   * @param {object} options - Опции действия
   * @returns {Promise<void>}
   */
  async sendActionRequest(stepNumber, action, options) {
    await this.sendNotification('action_required', {
      taskId: this.taskId,
      step: stepNumber,
      action,
      options,
      actionId: `${this.taskId}:${stepNumber}:${Date.now()}`
    });
  }
}

module.exports = NotificationManager;
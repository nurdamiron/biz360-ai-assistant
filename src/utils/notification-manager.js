// src/utils/notification-manager.js

const { pool } = require('../config/db.config');
const logger = require('./logger');
const websocket = require('../websocket');
const emailSender = require('./email-sender');

/**
 * Менеджер уведомлений - центральный компонент для отправки уведомлений различными способами
 */
class NotificationManager {
  constructor() {
    this.providers = {};
    this.initializeDefaultProviders();
  }

  /**
   * Инициализирует стандартные провайдеры уведомлений
   * @private
   */
  initializeDefaultProviders() {
    // Провайдер для сохранения уведомлений в БД
    this.registerProvider('database', this.saveNotificationToDatabase.bind(this));
    
    // Провайдер для отправки уведомлений через WebSocket
    this.registerProvider('websocket', this.sendNotificationViaWebSocket.bind(this));
    
    // Провайдер для отправки email-уведомлений
    this.registerProvider('email', this.sendNotificationViaEmail.bind(this));
    
    // Можно добавить другие провайдеры, например, Slack, Discord и т.д.
  }

  /**
   * Регистрирует нового провайдера уведомлений
   * @param {string} name - Имя провайдера
   * @param {Function} handler - Функция-обработчик
   */
  registerProvider(name, handler) {
    this.providers[name] = handler;
    logger.info(`Зарегистрирован провайдер уведомлений: ${name}`);
  }

  /**
   * Отправляет уведомление
   * @param {Object} notification - Объект уведомления
   * @param {string} notification.type - Тип уведомления
   * @param {number} notification.userId - ID пользователя-получателя (может быть null для системных уведомлений)
   * @param {string} notification.title - Заголовок уведомления
   * @param {string} notification.message - Текст уведомления
   * @param {Object} notification.data - Дополнительные данные (опционально)
   * @param {string[]} notification.channels - Каналы отправки (если не указаны, используются все доступные)
   * @param {number} notification.projectId - ID проекта (опционально)
   * @param {number} notification.taskId - ID задачи (опционально)
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendNotification(notification) {
    try {
      logger.debug(`Отправка уведомления типа ${notification.type}`, notification);
      
      // Проверяем обязательные поля
      if (!notification.type || !notification.title || !notification.message) {
        throw new Error('Не указаны обязательные поля уведомления (type, title, message)');
      }
      
      // Если каналы не указаны, используем все доступные
      const channels = notification.channels || Object.keys(this.providers);
      
      // Результаты отправки по каждому каналу
      const results = {};
      
      // Отправляем уведомление через каждый канал
      await Promise.all(channels.map(async channel => {
        try {
          if (this.providers[channel]) {
            results[channel] = await this.providers[channel](notification);
          } else {
            results[channel] = { success: false, error: `Провайдер ${channel} не найден` };
            logger.warn(`Провайдер уведомлений ${channel} не найден`);
          }
        } catch (error) {
          results[channel] = { success: false, error: error.message };
          logger.error(`Ошибка при отправке уведомления через ${channel}:`, error);
        }
      }));
      
      // Возвращаем результаты отправки
      return {
        success: Object.values(results).some(result => result.success),
        results,
        notification
      };
    } catch (error) {
      logger.error('Ошибка при отправке уведомления:', error);
      return { success: false, error: error.message, notification };
    }
  }

  /**
   * Сохраняет уведомление в базе данных
   * @param {Object} notification - Объект уведомления
   * @returns {Promise<Object>} - Результат сохранения
   * @private
   */
  async saveNotificationToDatabase(notification) {
    try {
      const connection = await pool.getConnection();
      
      // Вставляем уведомление в БД
      const [result] = await connection.query(
        `INSERT INTO notifications 
         (user_id, type, title, message, data, project_id, task_id, read, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          notification.userId || null,
          notification.type,
          notification.title,
          notification.message,
          notification.data ? JSON.stringify(notification.data) : null,
          notification.projectId || null,
          notification.taskId || null,
          false // по умолчанию уведомление не прочитано
        ]
      );
      
      connection.release();
      
      return {
        success: true,
        notificationId: result.insertId
      };
    } catch (error) {
      logger.error('Ошибка при сохранении уведомления в БД:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Отправляет уведомление через WebSocket
   * @param {Object} notification - Объект уведомления
   * @returns {Promise<Object>} - Результат отправки
   * @private
   */
  async sendNotificationViaWebSocket(notification) {
    try {
      const wsServer = websocket.getInstance();
      
      if (!wsServer) {
        throw new Error('WebSocket сервер не инициализирован');
      }
      
      // Определяем события для отправки
      const events = [];
      
      // Если указан пользователь, отправляем ему личное уведомление
      if (notification.userId) {
        events.push({
          type: 'user',
          id: notification.userId,
          data: {
            type: 'notification',
            notification
          }
        });
      }
      
      // Если указан проект, отправляем уведомление участникам проекта
      if (notification.projectId) {
        events.push({
          type: 'project',
          id: notification.projectId,
          data: {
            type: 'notification',
            notification
          }
        });
      }
      
      // Если указана задача, отправляем уведомление участникам задачи
      if (notification.taskId) {
        events.push({
          type: 'task',
          id: notification.taskId,
          data: {
            type: 'notification',
            notification
          }
        });
      }
      
      // Если не указаны конкретные адресаты, отправляем всем
      if (events.length === 0) {
        wsServer.broadcast({
          type: 'notification',
          notification
        });
        
        return { success: true, broadcast: true };
      }
      
      // Отправляем каждое событие
      events.forEach(event => {
        wsServer.notifySubscribers(event.type, event.id, event.data);
      });
      
      return { success: true, events };
    } catch (error) {
      logger.error('Ошибка при отправке уведомления через WebSocket:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Отправляет уведомление по электронной почте
   * @param {Object} notification - Объект уведомления
   * @returns {Promise<Object>} - Результат отправки
   * @private
   */
  async sendNotificationViaEmail(notification) {
    try {
      // Если не указан пользователь, не отправляем email
      if (!notification.userId) {
        return { success: false, error: 'Не указан пользователь для отправки email' };
      }
      
      // Получаем email пользователя
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT email FROM users WHERE id = ?',
        [notification.userId]
      );
      
      connection.release();
      
      if (users.length === 0 || !users[0].email) {
        return { success: false, error: 'Email пользователя не найден' };
      }
      
      const email = users[0].email;
      
      // Формируем тему и содержимое письма
      const subject = notification.title;
      
      // Простое текстовое письмо
      const text = notification.message;
      
      // HTML-версия письма (можно использовать шаблонизатор)
      let html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">${notification.title}</h2>
          <p style="margin: 15px 0; line-height: 1.5;">${notification.message}</p>
      `;
      
      // Добавляем контекстные данные, если они есть
      if (notification.taskId) {
        html += `<p style="margin: 15px 0;"><a href="${process.env.APP_URL}/tasks/${notification.taskId}" style="color: #0066cc; text-decoration: none;">Перейти к задаче</a></p>`;
      } else if (notification.projectId) {
        html += `<p style="margin: 15px 0;"><a href="${process.env.APP_URL}/projects/${notification.projectId}" style="color: #0066cc; text-decoration: none;">Перейти к проекту</a></p>`;
      }
      
      // Добавляем дополнительные данные, если они есть
      if (notification.data) {
        if (notification.data.action) {
          html += `<p style="margin: 15px 0;"><a href="${notification.data.action.url}" style="display: inline-block; padding: 10px 20px; background-color: #0066cc; color: white; text-decoration: none; border-radius: 4px;">${notification.data.action.text}</a></p>`;
        }
        
        if (notification.data.details) {
          html += `<div style="background-color: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 4px;"><p style="margin: 0;">${notification.data.details}</p></div>`;
        }
      }
      
      html += `
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #777; font-size: 12px;">Это автоматическое уведомление, пожалуйста, не отвечайте на него.</p>
        </div>
      `;
      
      // Отправляем email
      const emailResult = await emailSender.sendEmail({
        to: email,
        subject,
        text,
        html
      });
      
      return { success: true, emailResult };
    } catch (error) {
      logger.error('Ошибка при отправке уведомления по email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Получает уведомления пользователя
   * @param {number} userId - ID пользователя
   * @param {Object} options - Параметры запроса
   * @param {number} options.limit - Лимит (по умолчанию 20)
   * @param {number} options.offset - Смещение (по умолчанию 0)
   * @param {boolean} options.unreadOnly - Только непрочитанные (по умолчанию false)
   * @returns {Promise<Object>} - Уведомления пользователя
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const limit = options.limit || 20;
      const offset = options.offset || 0;
      const unreadOnly = options.unreadOnly || false;
      
      const connection = await pool.getConnection();
      
      // Формируем запрос
      let query = `
        SELECT * FROM notifications 
        WHERE user_id = ?
      `;
      
      const params = [userId];
      
      if (unreadOnly) {
        query += ' AND read = FALSE';
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      // Получаем уведомления
      const [notifications] = await connection.query(query, params);
      
      // Получаем общее количество
      let countQuery = `
        SELECT COUNT(*) as total FROM notifications 
        WHERE user_id = ?
      `;
      
      const countParams = [userId];
      
      if (unreadOnly) {
        countQuery += ' AND read = FALSE';
      }
      
      const [countResult] = await connection.query(countQuery, countParams);
      
      // Обрабатываем уведомления (например, парсим JSON в data)
      const processedNotifications = notifications.map(notification => {
        if (notification.data && typeof notification.data === 'string') {
          try {
            notification.data = JSON.parse(notification.data);
          } catch (error) {
            // В случае ошибки парсинга оставляем как есть
          }
        }
        return notification;
      });
      
      connection.release();
      
      return {
        items: processedNotifications,
        pagination: {
          total: countResult[0].total,
          limit,
          offset
        }
      };
    } catch (error) {
      logger.error(`Ошибка при получении уведомлений пользователя #${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отмечает уведомление как прочитанное
   * @param {number} notificationId - ID уведомления
   * @param {number} userId - ID пользователя (для проверки доступа)
   * @returns {Promise<boolean>} - Результат операции
   */
  async markAsRead(notificationId, userId) {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем, что уведомление принадлежит пользователю
      const [notifications] = await connection.query(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
        [notificationId, userId]
      );
      
      if (notifications.length === 0) {
        connection.release();
        return false;
      }
      
      // Отмечаем как прочитанное
      await connection.query(
        'UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE id = ?',
        [notificationId]
      );
      
      connection.release();
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при отметке уведомления #${notificationId} как прочитанного:`, error);
      return false;
    }
  }

  /**
   * Отмечает все уведомления пользователя как прочитанные
   * @param {number} userId - ID пользователя
   * @returns {Promise<number>} - Количество обновленных уведомлений
   */
  async markAllAsRead(userId) {
    try {
      const connection = await pool.getConnection();
      
      // Обновляем все непрочитанные уведомления пользователя
      const [result] = await connection.query(
        'UPDATE notifications SET read = TRUE, updated_at = NOW() WHERE user_id = ? AND read = FALSE',
        [userId]
      );
      
      connection.release();
      
      return result.affectedRows;
    } catch (error) {
      logger.error(`Ошибка при отметке всех уведомлений пользователя #${userId} как прочитанных:`, error);
      return 0;
    }
  }

  /**
   * Удаляет уведомление
   * @param {number} notificationId - ID уведомления
   * @param {number} userId - ID пользователя (для проверки доступа)
   * @returns {Promise<boolean>} - Результат операции
   */
  async deleteNotification(notificationId, userId) {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем, что уведомление принадлежит пользователю
      const [notifications] = await connection.query(
        'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
        [notificationId, userId]
      );
      
      if (notifications.length === 0) {
        connection.release();
        return false;
      }
      
      // Удаляем уведомление
      await connection.query(
        'DELETE FROM notifications WHERE id = ?',
        [notificationId]
      );
      
      connection.release();
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при удалении уведомления #${notificationId}:`, error);
      return false;
    }
  }
}

// Экспортируем синглтон
const notificationManager = new NotificationManager();
module.exports = notificationManager;
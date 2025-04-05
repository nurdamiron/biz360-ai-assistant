// src/controller/notification/notification.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const notificationManager = require('../../utils/notification-manager');
const websocket = require('../../websocket');

/**
 * Контроллер для управления уведомлениями
 */
const notificationController = {
  /**
   * Получить уведомления текущего пользователя
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getUserNotifications(req, res) {
    try {
      const userId = req.user.id; // ID пользователя из аутентификации
      const { limit, offset, unreadOnly } = req.query;
      
      // Получаем уведомления пользователя
      const result = await notificationManager.getUserNotifications(userId, {
        limit: limit ? parseInt(limit) : 20,
        offset: offset ? parseInt(offset) : 0,
        unreadOnly: unreadOnly === 'true'
      });
      
      res.json(result);
    } catch (error) {
      logger.error(`Ошибка при получении уведомлений пользователя #${req.user.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении уведомлений' });
    }
  },

  /**
   * Получить количество непрочитанных уведомлений
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id; // ID пользователя из аутентификации
      
      const connection = await pool.getConnection();
      
      // Получаем количество непрочитанных уведомлений
      const [result] = await connection.query(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = FALSE',
        [userId]
      );
      
      connection.release();
      
      res.json({ count: result[0].count });
    } catch (error) {
      logger.error(`Ошибка при получении количества непрочитанных уведомлений пользователя #${req.user.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении количества непрочитанных уведомлений' });
    }
  },

  /**
   * Отметить уведомление как прочитанное
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async markAsRead(req, res) {
    try {
      const notificationId = parseInt(req.params.id);
      const userId = req.user.id; // ID пользователя из аутентификации
      
      // Отмечаем уведомление как прочитанное
      const success = await notificationManager.markAsRead(notificationId, userId);
      
      if (!success) {
        return res.status(404).json({ error: 'Уведомление не найдено или у вас нет прав для его изменения' });
      }
      
      res.json({ success: true });
    } catch (error) {
      logger.error(`Ошибка при отметке уведомления #${req.params.id} как прочитанного:`, error);
      res.status(500).json({ error: 'Ошибка сервера при отметке уведомления как прочитанного' });
    }
  },

  /**
   * Отметить все уведомления как прочитанные
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id; // ID пользователя из аутентификации
      
      // Отмечаем все уведомления как прочитанные
      const count = await notificationManager.markAllAsRead(userId);
      
      res.json({ success: true, count });
    } catch (error) {
      logger.error(`Ошибка при отметке всех уведомлений пользователя #${req.user.id} как прочитанных:`, error);
      res.status(500).json({ error: 'Ошибка сервера при отметке всех уведомлений как прочитанных' });
    }
  },

  /**
   * Удалить уведомление
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteNotification(req, res) {
    try {
      const notificationId = parseInt(req.params.id);
      const userId = req.user.id; // ID пользователя из аутентификации
      
      // Удаляем уведомление
      const success = await notificationManager.deleteNotification(notificationId, userId);
      
      if (!success) {
        return res.status(404).json({ error: 'Уведомление не найдено или у вас нет прав для его удаления' });
      }
      
      res.json({ success: true });
    } catch (error) {
      logger.error(`Ошибка при удалении уведомления #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении уведомления' });
    }
  },

  /**
   * Отправить тестовое уведомление (для администраторов)
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async sendTestNotification(req, res) {
    try {
      // Проверяем, что пользователь является администратором
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Недостаточно прав для отправки тестовых уведомлений' });
      }
      
      const { userId, type, channels } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'Необходимо указать userId' });
      }
      
      // Проверяем существование пользователя
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT id, username, email FROM users WHERE id = ?',
        [userId]
      );
      
      connection.release();
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      // Отправляем тестовое уведомление
      const result = await notificationManager.sendNotification({
        type: type || 'test',
        userId,
        title: 'Тестовое уведомление',
        message: `Это тестовое уведомление, отправленное администратором ${req.user.username}`,
        data: {
          test: true,
          timestamp: new Date()
        },
        channels: channels || ['database', 'websocket', 'email']
      });
      
      res.json({
        success: true,
        message: 'Тестовое уведомление отправлено',
        result
      });
    } catch (error) {
      logger.error('Ошибка при отправке тестового уведомления:', error);
      res.status(500).json({ error: 'Ошибка сервера при отправке тестового уведомления' });
    }
  },

  /**
   * Удалить все уведомления пользователя (для администраторов)
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async clearUserNotifications(req, res) {
    try {
      // Проверяем, что пользователь является администратором
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Недостаточно прав для удаления всех уведомлений' });
      }
      
      const userId = parseInt(req.params.userId);
      
      if (!userId) {
        return res.status(400).json({ error: 'Необходимо указать userId' });
      }
      
      // Проверяем существование пользователя
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT id FROM users WHERE id = ?',
        [userId]
      );
      
      if (users.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      // Удаляем все уведомления пользователя
      const [result] = await connection.query(
        'DELETE FROM notifications WHERE user_id = ?',
        [userId]
      );
      
      connection.release();
      
      res.json({
        success: true,
        message: 'Все уведомления пользователя удалены',
        count: result.affectedRows
      });
    } catch (error) {
      logger.error(`Ошибка при удалении всех уведомлений пользователя #${req.params.userId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении всех уведомлений пользователя' });
    }
  },

  /**
   * Получить настройки уведомлений пользователя
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getNotificationSettings(req, res) {
    try {
      const userId = req.user.id; // ID пользователя из аутентификации
      
      const connection = await pool.getConnection();
      
      // Получаем настройки уведомлений пользователя
      const [settings] = await connection.query(
        'SELECT * FROM notification_settings WHERE user_id = ?',
        [userId]
      );
      
      connection.release();
      
      // Если настройки не найдены, возвращаем настройки по умолчанию
      if (settings.length === 0) {
        return res.json({
          email_enabled: true,
          push_enabled: true,
          task_notifications: true,
          project_notifications: true,
          system_notifications: true,
          digest_frequency: 'daily'
        });
      }
      
      res.json(settings[0]);
    } catch (error) {
      logger.error(`Ошибка при получении настроек уведомлений пользователя #${req.user.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении настроек уведомлений' });
    }
  },

  /**
   * Обновить настройки уведомлений пользователя
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateNotificationSettings(req, res) {
    try {
      const userId = req.user.id; // ID пользователя из аутентификации
      const { 
        email_enabled,
        push_enabled,
        task_notifications,
        project_notifications,
        system_notifications,
        digest_frequency
      } = req.body;
      
      const connection = await pool.getConnection();
      
      // Проверяем, существуют ли настройки
      const [existingSettings] = await connection.query(
        'SELECT id FROM notification_settings WHERE user_id = ?',
        [userId]
      );
      
      // Если настройки существуют, обновляем их
      if (existingSettings.length > 0) {
        await connection.query(
          `UPDATE notification_settings 
           SET 
             email_enabled = ?,
             push_enabled = ?,
             task_notifications = ?,
             project_notifications = ?,
             system_notifications = ?,
             digest_frequency = ?,
             updated_at = NOW()
           WHERE user_id = ?`,
          [
            email_enabled !== undefined ? email_enabled : true,
            push_enabled !== undefined ? push_enabled : true,
            task_notifications !== undefined ? task_notifications : true,
            project_notifications !== undefined ? project_notifications : true,
            system_notifications !== undefined ? system_notifications : true,
            digest_frequency || 'daily',
            userId
          ]
        );
      } else {
        // Иначе создаем новые настройки
        await connection.query(
          `INSERT INTO notification_settings 
           (user_id, email_enabled, push_enabled, task_notifications, project_notifications, system_notifications, digest_frequency, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            userId,
            email_enabled !== undefined ? email_enabled : true,
            push_enabled !== undefined ? push_enabled : true,
            task_notifications !== undefined ? task_notifications : true,
            project_notifications !== undefined ? project_notifications : true,
            system_notifications !== undefined ? system_notifications : true,
            digest_frequency || 'daily'
          ]
        );
      }
      
      // Получаем обновленные настройки
      const [settings] = await connection.query(
        'SELECT * FROM notification_settings WHERE user_id = ?',
        [userId]
      );
      
      connection.release();
      
      res.json({
        success: true,
        settings: settings[0]
      });
    } catch (error) {
      logger.error(`Ошибка при обновлении настроек уведомлений пользователя #${req.user.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении настроек уведомлений' });
    }
  }
};

module.exports = notificationController;
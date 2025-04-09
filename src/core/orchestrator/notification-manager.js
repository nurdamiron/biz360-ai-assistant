/**
 * @fileoverview Notification Manager отвечает за отправку уведомлений о событиях
 * в процессе выполнения задачи. Он поддерживает различные каналы уведомлений,
 * включая WebSocket, API webhooks, электронную почту и системные уведомления.
 * NotificationManager позволяет информировать пользователей о прогрессе, ошибках
 * и требуемых действиях.
 */

const logger = require('../../utils/logger');

// Типы уведомлений
const NOTIFICATION_TYPES = {
  INFO: 'info',           // Информационное сообщение
  SUCCESS: 'success',     // Успешное выполнение
  WARNING: 'warning',     // Предупреждение
  ERROR: 'error',         // Ошибка
  PROGRESS: 'progress',   // Прогресс выполнения
  ACTION_REQUIRED: 'action_required', // Требуется действие пользователя
};

// Каналы уведомлений
const NOTIFICATION_CHANNELS = {
  WEBSOCKET: 'websocket', // WebSocket уведомления в реальном времени
  API: 'api',             // API WebHooks
  EMAIL: 'email',         // Электронная почта
  SYSTEM: 'system',       // Внутренние системные уведомления
};

// Уровни приоритета уведомлений
const PRIORITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Класс управления уведомлениями.
 */
class NotificationManager {
  /**
   * Создает экземпляр NotificationManager.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.websocket - Экземпляр WebSocket сервера.
   * @param {Object} options.db - Интерфейс к базе данных.
   * @param {Object} options.emailService - Сервис для отправки email.
   * @param {Object} options.config - Конфигурация уведомлений.
   */
  constructor({ websocket, db, emailService, config } = {}) {
    this.websocket = websocket;
    this.db = db;
    this.emailService = emailService;
    this.config = config || {
      defaultChannels: [NOTIFICATION_CHANNELS.WEBSOCKET, NOTIFICATION_CHANNELS.SYSTEM],
      enabledChannels: [
        NOTIFICATION_CHANNELS.WEBSOCKET, 
        NOTIFICATION_CHANNELS.SYSTEM
      ],
      channelSettings: {
        [NOTIFICATION_CHANNELS.EMAIL]: {
          minPriority: PRIORITY_LEVELS.HIGH,
        },
        [NOTIFICATION_CHANNELS.API]: {
          webhooks: [],
        },
      },
    };
    
    // Инициализируем каналы уведомлений
    this._initializeChannels();
  }

  /**
   * Инициализирует каналы уведомлений.
   * @private
   */
  _initializeChannels() {
    logger.debug('Initializing notification channels');
    
    // Проверяем, доступен ли WebSocket
    if (this.websocket) {
      logger.debug('WebSocket channel is available');
    } else {
      logger.warn('WebSocket channel is not available');
      
      // Удаляем WebSocket из списка включенных каналов
      this.config.enabledChannels = this.config.enabledChannels
        .filter(channel => channel !== NOTIFICATION_CHANNELS.WEBSOCKET);
      
      // Удаляем WebSocket из списка каналов по умолчанию
      this.config.defaultChannels = this.config.defaultChannels
        .filter(channel => channel !== NOTIFICATION_CHANNELS.WEBSOCKET);
    }
    
    // Проверяем, доступен ли Email
    if (this.emailService) {
      logger.debug('Email channel is available');
    } else {
      logger.warn('Email channel is not available');
      
      // Удаляем Email из списка включенных каналов
      this.config.enabledChannels = this.config.enabledChannels
        .filter(channel => channel !== NOTIFICATION_CHANNELS.EMAIL);
      
      // Удаляем Email из списка каналов по умолчанию
      this.config.defaultChannels = this.config.defaultChannels
        .filter(channel => channel !== NOTIFICATION_CHANNELS.EMAIL);
    }
  }

  /**
   * Определяет приоритет уведомления на основе типа и контекста.
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {string} - Уровень приоритета.
   */
  _determinePriority(notification) {
    // Определяем приоритет на основе типа уведомления
    switch (notification.type) {
      case NOTIFICATION_TYPES.ERROR:
        return notification.critical ? PRIORITY_LEVELS.CRITICAL : PRIORITY_LEVELS.HIGH;
        
      case NOTIFICATION_TYPES.ACTION_REQUIRED:
        return PRIORITY_LEVELS.HIGH;
        
      case NOTIFICATION_TYPES.WARNING:
        return PRIORITY_LEVELS.MEDIUM;
        
      case NOTIFICATION_TYPES.SUCCESS:
        return PRIORITY_LEVELS.LOW;
        
      case NOTIFICATION_TYPES.INFO:
      case NOTIFICATION_TYPES.PROGRESS:
      default:
        return PRIORITY_LEVELS.LOW;
    }
  }

  /**
   * Определяет каналы для отправки уведомления.
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {Array<string>} - Список каналов.
   */
  _determineChannels(notification) {
    // Если каналы явно указаны в уведомлении, используем их
    if (notification.channels && Array.isArray(notification.channels) && notification.channels.length > 0) {
      // Фильтруем только включенные каналы
      return notification.channels.filter(channel => 
        this.config.enabledChannels.includes(channel)
      );
    }
    
    // Иначе определяем каналы на основе приоритета
    const priority = notification.priority || this._determinePriority(notification);
    
    // Набор каналов по умолчанию
    let channels = [...this.config.defaultChannels];
    
    // Добавляем дополнительные каналы в зависимости от приоритета
    if (priority === PRIORITY_LEVELS.HIGH || priority === PRIORITY_LEVELS.CRITICAL) {
      // Для высокого приоритета добавляем email
      if (this.emailService && 
          this.config.enabledChannels.includes(NOTIFICATION_CHANNELS.EMAIL) &&
          (!this.config.channelSettings[NOTIFICATION_CHANNELS.EMAIL]?.minPriority ||
           priority >= this.config.channelSettings[NOTIFICATION_CHANNELS.EMAIL].minPriority)) {
        channels.push(NOTIFICATION_CHANNELS.EMAIL);
      }
    }
    
    // Фильтруем только включенные каналы
    return channels.filter(channel => 
      this.config.enabledChannels.includes(channel)
    );
  }

  /**
   * Отправляет уведомление через WebSocket.
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {Promise<boolean>} - Результат отправки.
   */
  async _sendWebSocketNotification(notification) {
    logger.debug(`Sending WebSocket notification: ${notification.title}`);
    
    try {
      // Проверяем, доступен ли WebSocket
      if (!this.websocket) {
        logger.warn('WebSocket server is not available');
        return false;
      }
      
      // Подготавливаем данные для отправки
      const wsPayload = {
        type: 'notification',
        notification: {
          id: notification.id,
          type: notification.type,
          taskId: notification.taskId,
          projectId: notification.projectId,
          title: notification.title,
          message: notification.message,
          data: notification.data,
          timestamp: notification.timestamp,
          priority: notification.priority
        }
      };
      
      // Определяем получателей
      let recipients = notification.recipients || [];
      
      // Если есть taskId, отправляем всем подписчикам этой задачи
      if (notification.taskId) {
        // Здесь должна быть логика получения списка подписчиков задачи
        const taskSubscribers = await this._getTaskSubscribers(notification.taskId);
        recipients = [...recipients, ...taskSubscribers];
      }
      
      // Если есть projectId, отправляем всем подписчикам этого проекта
      if (notification.projectId) {
        // Здесь должна быть логика получения списка подписчиков проекта
        const projectSubscribers = await this._getProjectSubscribers(notification.projectId);
        recipients = [...recipients, ...projectSubscribers];
      }
      
      // Если получателей нет, отправляем всем подключенным клиентам
      if (recipients.length === 0) {
        this.websocket.broadcastToAll(wsPayload);
      } else {
        // Отправляем только указанным получателям
        recipients.forEach(recipient => {
          this.websocket.sendToUser(recipient, wsPayload);
        });
      }
      
      return true;
    } catch (error) {
      logger.error('Error sending WebSocket notification:', error);
      return false;
    }
  }

  /**
   * Отправляет уведомление через Email.
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {Promise<boolean>} - Результат отправки.
   */
  async _sendEmailNotification(notification) {
    logger.debug(`Sending Email notification: ${notification.title}`);
    
    try {
      // Проверяем, доступен ли сервис Email
      if (!this.emailService) {
        logger.warn('Email service is not available');
        return false;
      }
      
      // Определяем получателей
      let recipients = notification.recipients || [];
      
      // Если есть taskId, получаем email пользователей, подписанных на задачу
      if (notification.taskId) {
        const taskSubscribers = await this._getTaskSubscriberEmails(notification.taskId);
        recipients = [...recipients, ...taskSubscribers];
      }
      
      // Если есть projectId, получаем email пользователей, подписанных на проект
      if (notification.projectId) {
        const projectSubscribers = await this._getProjectSubscriberEmails(notification.projectId);
        recipients = [...recipients, ...projectSubscribers];
      }
      
      // Если получателей нет, прерываем отправку
      if (recipients.length === 0) {
        logger.warn('No recipients for email notification');
        return false;
      }
      
      // Подготавливаем данные для отправки
      const emailData = {
        to: recipients,
        subject: `[${notification.type.toUpperCase()}] ${notification.title}`,
        text: notification.message,
        html: `<h2>${notification.title}</h2><p>${notification.message}</p>`,
        data: notification.data
      };
      
      // Отправляем email
      await this.emailService.send(emailData);
      
      return true;
    } catch (error) {
      logger.error('Error sending Email notification:', error);
      return false;
    }
  }

  /**
   * Отправляет уведомление через API WebHook.
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {Promise<boolean>} - Результат отправки.
   */
  async _sendApiNotification(notification) {
    logger.debug(`Sending API notification: ${notification.title}`);
    
    try {
      // Получаем список WebHook URL из конфигурации
      const webhooks = this.config.channelSettings[NOTIFICATION_CHANNELS.API]?.webhooks || [];
      
      // Если WebHook'ов нет, прерываем отправку
      if (webhooks.length === 0) {
        logger.warn('No webhooks configured for API notifications');
        return false;
      }
      
      // Подготавливаем данные для отправки
      const payload = {
        id: notification.id,
        type: notification.type,
        taskId: notification.taskId,
        projectId: notification.projectId,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        timestamp: notification.timestamp,
        priority: notification.priority
      };
      
      // Отправляем запросы на все WebHook URL
      const requests = webhooks.map(async (webhook) => {
        try {
          const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(webhook.headers || {})
            },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            logger.warn(`Failed to send webhook notification to ${webhook.url}: ${response.status} ${response.statusText}`);
            return false;
          }
          
          return true;
        } catch (error) {
          logger.error(`Error sending webhook notification to ${webhook.url}:`, error);
          return false;
        }
      });
      
      // Ожидаем завершения всех запросов
      const results = await Promise.all(requests);
      
      // Считаем отправку успешной, если хотя бы один WebHook сработал
      return results.some(result => result);
    } catch (error) {
      logger.error('Error sending API notification:', error);
      return false;
    }
  }

  /**
   * Сохраняет уведомление в системе (БД).
   * @private
   * @param {Object} notification - Объект уведомления.
   * @returns {Promise<boolean>} - Результат сохранения.
   */
  async _saveSystemNotification(notification) {
    logger.debug(`Saving system notification: ${notification.title}`);
    
    try {
      // Проверяем, доступна ли БД
      if (!this.db) {
        logger.warn('Database is not available for saving notification');
        return false;
      }
      
      // Сохраняем уведомление в БД
      await this.db.Notification.create({
        id: notification.id,
        type: notification.type,
        taskId: notification.taskId,
        projectId: notification.projectId,
        title: notification.title,
        message: notification.message,
        data: JSON.stringify(notification.data),
        priority: notification.priority,
        isRead: false,
        createdAt: notification.timestamp
      });
      
      return true;
    } catch (error) {
      logger.error('Error saving system notification:', error);
      return false;
    }
  }

  /**
   * Получает список подписчиков задачи для WebSocket.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Array<string>>} - Список идентификаторов пользователей.
   */
  async _getTaskSubscribers(taskId) {
    try {
      // Если БД недоступна, возвращаем пустой список
      if (!this.db) {
        return [];
      }
      
      // Получаем подписчиков из БД
      const subscribers = await this.db.TaskSubscriber.findAll({
        where: { taskId }
      });
      
      return subscribers.map(subscriber => subscriber.userId);
    } catch (error) {
      logger.error(`Error getting task subscribers for task ${taskId}:`, error);
      return [];
    }
  }

  /**
   * Получает список подписчиков проекта для WebSocket.
   * @private
   * @param {string} projectId - Идентификатор проекта.
   * @returns {Promise<Array<string>>} - Список идентификаторов пользователей.
   */
  async _getProjectSubscribers(projectId) {
    try {
      // Если БД недоступна, возвращаем пустой список
      if (!this.db) {
        return [];
      }
      
      // Получаем подписчиков из БД
      const subscribers = await this.db.ProjectSubscriber.findAll({
        where: { projectId }
      });
      
      return subscribers.map(subscriber => subscriber.userId);
    } catch (error) {
      logger.error(`Error getting project subscribers for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Получает список email подписчиков задачи.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Array<string>>} - Список email адресов.
   */
  async _getTaskSubscriberEmails(taskId) {
    try {
      // Если БД недоступна, возвращаем пустой список
      if (!this.db) {
        return [];
      }
      
      // Получаем подписчиков из БД вместе с информацией о пользователях
      const subscribers = await this.db.TaskSubscriber.findAll({
        where: { taskId },
        include: [
          {
            model: this.db.User,
            attributes: ['email']
          }
        ]
      });
      
      return subscribers
        .map(subscriber => subscriber.User?.email)
        .filter(email => !!email);
    } catch (error) {
      logger.error(`Error getting task subscriber emails for task ${taskId}:`, error);
      return [];
    }
  }

  /**
   * Получает список email подписчиков проекта.
   * @private
   * @param {string} projectId - Идентификатор проекта.
   * @returns {Promise<Array<string>>} - Список email адресов.
   */
  async _getProjectSubscriberEmails(projectId) {
    try {
      // Если БД недоступна, возвращаем пустой список
      if (!this.db) {
        return [];
      }
      
      // Получаем подписчиков из БД вместе с информацией о пользователях
      const subscribers = await this.db.ProjectSubscriber.findAll({
        where: { projectId },
        include: [
          {
            model: this.db.User,
            attributes: ['email']
          }
        ]
      });
      
      return subscribers
        .map(subscriber => subscriber.User?.email)
        .filter(email => !!email);
    } catch (error) {
      logger.error(`Error getting project subscriber emails for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Отправляет уведомление.
   * @param {Object} notification - Объект уведомления.
   * @param {string} notification.type - Тип уведомления (info, success, warning, error, progress, action_required).
   * @param {string} notification.taskId - Идентификатор задачи (опционально).
   * @param {string} notification.projectId - Идентификатор проекта (опционально).
   * @param {string} notification.title - Заголовок уведомления.
   * @param {string} notification.message - Текст уведомления.
   * @param {Object} notification.data - Дополнительные данные (опционально).
   * @param {Array<string>} notification.recipients - Список получателей (опционально).
   * @param {Array<string>} notification.channels - Список каналов (опционально).
   * @param {string} notification.priority - Приоритет уведомления (опционально).
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendNotification(notification) {
    logger.info(`Sending notification: ${notification.title}`);
    
    try {
      // Дополняем объект уведомления недостающими полями
      const fullNotification = {
        ...notification,
        id: notification.id || this._generateId(),
        timestamp: notification.timestamp || new Date(),
        priority: notification.priority || this._determinePriority(notification),
      };
      
      // Определяем каналы для отправки
      const channels = this._determineChannels(fullNotification);
      
      // Отправляем уведомление по каждому каналу
      const results = await Promise.all(
        channels.map(async (channel) => {
          try {
            switch (channel) {
              case NOTIFICATION_CHANNELS.WEBSOCKET:
                return { channel, success: await this._sendWebSocketNotification(fullNotification) };
                
              case NOTIFICATION_CHANNELS.EMAIL:
                return { channel, success: await this._sendEmailNotification(fullNotification) };
                
              case NOTIFICATION_CHANNELS.API:
                return { channel, success: await this._sendApiNotification(fullNotification) };
                
              case NOTIFICATION_CHANNELS.SYSTEM:
                return { channel, success: await this._saveSystemNotification(fullNotification) };
                
              default:
                logger.warn(`Unknown notification channel: ${channel}`);
                return { channel, success: false };
            }
          } catch (error) {
            logger.error(`Error sending notification through channel ${channel}:`, error);
            return { channel, success: false, error: error.message };
          }
        })
      );
      
      // Определяем общий результат отправки
      const success = results.some(result => result.success);
      
      return {
        success,
        id: fullNotification.id,
        timestamp: fullNotification.timestamp,
        channels: results
      };
    } catch (error) {
      logger.error('Error sending notification:', error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Отправляет информационное уведомление.
   * @param {string} title - Заголовок уведомления.
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendInfo(title, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.INFO,
      title,
      message,
      ...options
    });
  }

  /**
   * Отправляет уведомление об успешном выполнении.
   * @param {string} title - Заголовок уведомления.
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendSuccess(title, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.SUCCESS,
      title,
      message,
      ...options
    });
  }

  /**
   * Отправляет предупреждение.
   * @param {string} title - Заголовок уведомления.
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendWarning(title, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.WARNING,
      title,
      message,
      ...options
    });
  }

  /**
   * Отправляет уведомление об ошибке.
   * @param {string} title - Заголовок уведомления.
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendError(title, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.ERROR,
      title,
      message,
      ...options
    });
  }

  /**
   * Отправляет уведомление о прогрессе.
   * @param {string} taskId - Идентификатор задачи.
   * @param {number} progress - Процент выполнения (0-100).
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendProgress(taskId, progress, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.PROGRESS,
      taskId,
      title: `Progress update: ${progress}%`,
      message,
      data: { progress },
      ...options
    });
  }

  /**
   * Отправляет уведомление о необходимости действия пользователя.
   * @param {string} title - Заголовок уведомления.
   * @param {string} message - Текст уведомления.
   * @param {Object} options - Дополнительные опции.
   * @returns {Promise<Object>} - Результат отправки.
   */
  async sendActionRequired(title, message, options = {}) {
    return this.sendNotification({
      type: NOTIFICATION_TYPES.ACTION_REQUIRED,
      title,
      message,
      priority: options.priority || PRIORITY_LEVELS.HIGH,
      ...options
    });
  }

  /**
   * Генерирует уникальный идентификатор для уведомления.
   * @private
   * @returns {string} - Уникальный идентификатор.
   */
  _generateId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = {
  NotificationManager,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  PRIORITY_LEVELS
};
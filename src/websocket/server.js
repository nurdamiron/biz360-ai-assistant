// src/websocket/server.js

const WebSocket = require('ws');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db.config');

/**
 * Класс WebSocket-сервера для обеспечения реальновременной связи
 */
class WebSocketServer {
  /**
   * Создает экземпляр WebSocket-сервера
   * @param {Object} httpServer - HTTP-сервер Express
   */
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.clients = new Map(); // Map для хранения клиентов с их id
    this.taskSubscriptions = new Map(); // Map для подписок на задачи
    
    // Настройка обработчиков
    this.wss.on('connection', this.handleConnection.bind(this));
    
    logger.info('WebSocketServer запущен');
  }

  /**
   * Обрабатывает новое подключение клиента
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Object} req - HTTP-запрос
   */
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    
    ws.isAlive = true;
    ws.clientId = clientId;
    ws.userId = null;
    ws.authenticated = false;
    
    // Добавляем клиента в Map
    this.clients.set(clientId, ws);
    
    logger.info(`Новое WebSocket-соединение: ${clientId}`);
    
    // Настройка обработчиков для конкретного соединения
    ws.on('message', this.handleMessage.bind(this, ws));
    ws.on('close', this.handleClose.bind(this, ws));
    ws.on('error', this.handleError.bind(this, ws));
    ws.on('pong', () => { ws.isAlive = true; });
    
    // Отправляем приветственное сообщение
    this.sendToClient(ws, {
      type: 'connection',
      message: 'Соединение установлено',
      clientId
    });
    
    // Запускаем проверку жизнеспособности соединения
    this.setupHeartbeat();
  }

  /**
   * Обрабатывает сообщения от клиента
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {string} message - Полученное сообщение
   */
  async handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      logger.debug(`Получено сообщение от клиента ${ws.clientId}:`, data);
      
      switch (data.type) {
        case 'auth':
          await this.handleAuth(ws, data);
          break;
        
        case 'subscribe':
          await this.handleSubscribe(ws, data);
          break;
        
        case 'unsubscribe':
          await this.handleUnsubscribe(ws, data);
          break;
        
        case 'ping':
          this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
          break;
        
        default:
          logger.warn(`Неизвестный тип сообщения: ${data.type}`);
          this.sendToClient(ws, {
            type: 'error',
            message: `Неизвестный тип сообщения: ${data.type}`
          });
      }
    } catch (error) {
      logger.error(`Ошибка при обработке сообщения от клиента ${ws.clientId}:`, error);
      this.sendToClient(ws, {
        type: 'error',
        message: 'Ошибка при обработке сообщения'
      });
    }
  }

  /**
   * Обрабатывает закрытие соединения
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {number} code - Код закрытия
   * @param {string} reason - Причина закрытия
   */
  handleClose(ws, code, reason) {
    logger.info(`Соединение закрыто для клиента ${ws.clientId}: ${code} ${reason || ''}`);
    
    // Удаляем клиента из всех подписок
    for (const [taskId, subscribers] of this.taskSubscriptions.entries()) {
      if (subscribers.includes(ws.clientId)) {
        this.taskSubscriptions.set(
          taskId,
          subscribers.filter(id => id !== ws.clientId)
        );
        
        // Если нет подписчиков, удаляем задачу из Map
        if (this.taskSubscriptions.get(taskId).length === 0) {
          this.taskSubscriptions.delete(taskId);
        }
      }
    }
    
    // Удаляем клиента из Map
    this.clients.delete(ws.clientId);
  }

  /**
   * Обрабатывает ошибки соединения
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Error} error - Объект ошибки
   */
  handleError(ws, error) {
    logger.error(`Ошибка WebSocket для клиента ${ws.clientId}:`, error);
  }

  /**
   * Проверка жизнеспособности соединений
   */
  setupHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
          logger.info(`Закрытие неактивного соединения клиента ${ws.clientId}`);
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // Проверка каждые 30 секунд
  }

  /**
   * Обрабатывает аутентификацию клиента
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Object} data - Данные аутентификации
   */
  async handleAuth(ws, data) {
    try {
      const { token } = data;
      
      if (!token) {
        return this.sendToClient(ws, {
          type: 'auth_error',
          message: 'Токен не предоставлен'
        });
      }
      
      // Проверяем JWT токен
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Проверяем существование пользователя в БД
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT id, username, role FROM users WHERE id = ?',
        [decoded.userId]
      );
      
      connection.release();
      
      if (users.length === 0) {
        return this.sendToClient(ws, {
          type: 'auth_error',
          message: 'Пользователь не найден'
        });
      }
      
      // Устанавливаем данные пользователя
      ws.userId = users[0].id;
      ws.username = users[0].username;
      ws.role = users[0].role;
      ws.authenticated = true;
      
      logger.info(`Клиент ${ws.clientId} аутентифицирован как ${ws.username}`);
      
      // Отправляем успешное сообщение
      this.sendToClient(ws, {
        type: 'auth_success',
        userId: ws.userId,
        username: ws.username,
        role: ws.role
      });
    } catch (error) {
      logger.error(`Ошибка аутентификации для клиента ${ws.clientId}:`, error);
      
      this.sendToClient(ws, {
        type: 'auth_error',
        message: 'Ошибка аутентификации'
      });
    }
  }

  /**
   * Обрабатывает запрос на подписку
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Object} data - Данные подписки
   */
  async handleSubscribe(ws, data) {
    // В режиме разработки может быть разрешена подписка без аутентификации
    if (!ws.authenticated && process.env.NODE_ENV !== 'development') {
      return this.sendToClient(ws, {
        type: 'error',
        message: 'Требуется аутентификация для подписки'
      });
    }
    
    const { resource, id } = data;
    
    if (!resource || !id) {
      return this.sendToClient(ws, {
        type: 'error',
        message: 'Необходимо указать resource и id'
      });
    }
    
    // Формируем ключ подписки
    const subscriptionKey = `${resource}:${id}`;
    
    // Добавляем клиента в список подписчиков
    if (!this.taskSubscriptions.has(subscriptionKey)) {
      this.taskSubscriptions.set(subscriptionKey, []);
    }
    
    const subscribers = this.taskSubscriptions.get(subscriptionKey);
    
    if (!subscribers.includes(ws.clientId)) {
      subscribers.push(ws.clientId);
      this.taskSubscriptions.set(subscriptionKey, subscribers);
      
      logger.debug(`Клиент ${ws.clientId} подписан на ${subscriptionKey}`);
      
      // Отправляем подтверждение подписки
      this.sendToClient(ws, {
        type: 'subscribed',
        resource,
        id
      });
    }
  }

  /**
   * Обрабатывает запрос на отписку
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Object} data - Данные отписки
   */
  handleUnsubscribe(ws, data) {
    const { resource, id } = data;
    
    if (!resource || !id) {
      return this.sendToClient(ws, {
        type: 'error',
        message: 'Необходимо указать resource и id'
      });
    }
    
    // Формируем ключ подписки
    const subscriptionKey = `${resource}:${id}`;
    
    // Удаляем клиента из списка подписчиков
    if (this.taskSubscriptions.has(subscriptionKey)) {
      const subscribers = this.taskSubscriptions.get(subscriptionKey);
      
      const updatedSubscribers = subscribers.filter(
        clientId => clientId !== ws.clientId
      );
      
      if (updatedSubscribers.length === 0) {
        this.taskSubscriptions.delete(subscriptionKey);
      } else {
        this.taskSubscriptions.set(subscriptionKey, updatedSubscribers);
      }
      
      logger.debug(`Клиент ${ws.clientId} отписан от ${subscriptionKey}`);
      
      // Отправляем подтверждение отписки
      this.sendToClient(ws, {
        type: 'unsubscribed',
        resource,
        id
      });
    }
  }

  /**
   * Отправляет уведомление об обновлении подписчикам
   * @param {string} resource - Тип ресурса (task, generation, etc.)
   * @param {string|number} id - ID ресурса
   * @param {Object} data - Данные для отправки
   */
  notifySubscribers(resource, id, data) {
    const subscriptionKey = `${resource}:${id}`;
    
    if (!this.taskSubscriptions.has(subscriptionKey)) {
      return; // Нет подписчиков
    }
    
    const subscribers = this.taskSubscriptions.get(subscriptionKey);
    
    logger.debug(`Отправка уведомления ${subscribers.length} подписчикам ${subscriptionKey}`);
    
    // Отправляем уведомление всем подписчикам
    subscribers.forEach(clientId => {
      const client = this.clients.get(clientId);
      
      if (client && client.readyState === WebSocket.OPEN) {
        this.sendToClient(client, {
          type: 'update',
          resource,
          id,
          data,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Отправляет сообщение клиенту
   * @param {WebSocket} ws - WebSocket-соединение
   * @param {Object} data - Данные для отправки
   */
  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Отправляет сообщение всем клиентам
   * @param {Object} data - Данные для отправки
   */
  broadcast(data) {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  /**
   * Генерирует уникальный ID клиента
   * @returns {string} - Уникальный ID
   */
  generateClientId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Закрывает WebSocket-сервер
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      
      this.wss.close(() => {
        logger.info('WebSocketServer остановлен');
        resolve();
      });
    });
  }
}

module.exports = WebSocketServer;
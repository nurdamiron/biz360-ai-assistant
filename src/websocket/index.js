// src/websocket/index.js

const WebSocketServer = require('./server');
const logger = require('../utils/logger');

let instance = null;

/**
 * Инициализация WebSocket-сервера
 * @param {Object} httpServer - HTTP-сервер Express
 * @returns {WebSocketServer} - Экземпляр WebSocket-сервера
 */
function initialize(httpServer) {
  if (instance) {
    logger.info('WebSocketServer уже инициализирован, возвращаем существующий экземпляр');
    return instance;
  }
  
  if (!httpServer) {
    throw new Error('Для инициализации WebSocketServer требуется HTTP-сервер');
  }
  
  logger.info('Инициализация WebSocketServer');
  instance = new WebSocketServer(httpServer);
  return instance;
}

/**
 * Получение экземпляра WebSocket-сервера
 * @returns {WebSocketServer|null} - Экземпляр WebSocket-сервера или null, если не инициализирован
 */
function getInstance() {
  if (!instance) {
    logger.warn('Попытка получить экземпляр WebSocketServer до инициализации');
    return null;
  }
  
  return instance;
}

/**
 * Остановка WebSocket-сервера
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (instance) {
    logger.info('Остановка WebSocketServer');
    await instance.close();
    instance = null;
  }
}

module.exports = {
  initialize,
  getInstance,
  shutdown
};
// src/config/db.config.js

const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../utils/logger');

// Конфигурация подключения к MySQL
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Создание пула соединений
const pool = mysql.createPool(dbConfig);

/**
 * Функция для проверки соединения с базой данных
 * @returns {Promise<boolean>} Результат проверки
 */
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    logger.info('Успешное подключение к базе данных MySQL');
    connection.release();
    return true;
  } catch (error) {
    logger.error('Ошибка подключения к базе данных:', error.message);
    return false;
  }
};

/**
 * Инициализирует соединение с базой данных и выполняет необходимые проверки
 * @returns {Promise<void>}
 */
const initializeConnection = async () => {
  try {
    // Проверяем соединение с базой данных
    const connected = await testConnection();
    
    if (!connected) {
      logger.error('Не удалось подключиться к базе данных. Приложение будет остановлено.');
      process.exit(1);
    }
    
    // Инициализируем структуру базы данных
    const { initializeDatabase } = require('./db.initialize');
    await initializeDatabase();
    
    logger.info('База данных успешно инициализирована');
  } catch (error) {
    logger.error('Ошибка при инициализации базы данных:', error);
    process.exit(1);
  }
};

// Экспорт пула соединений и функций
module.exports = {
  pool,
  testConnection,
  initializeConnection
};
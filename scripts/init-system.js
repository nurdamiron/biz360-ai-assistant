// src/scripts/init-system.js

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Главная функция инициализации системы
 */
async function initSystem() {
  try {
    logger.info('Начало инициализации системы Biz360 CRM AI Assistant');
    
    // Проверяем подключение к БД
    logger.info('Проверка подключения к базе данных...');
    const connection = await createConnection();
    
    // Инициализируем базу данных
    logger.info('Инициализация базы данных...');
    await initDatabase(connection);
    
    // Создаем начальные таблицы аутентификации
    logger.info('Инициализация системы аутентификации...');
    await initAuth(connection);
    
    // Создаем тестовые данные для разработки, если необходимо
    if (process.env.NODE_ENV === 'development') {
      logger.info('Создание тестовых данных для разработки...');
      await createTestData(connection);
    }
    
    // Закрываем соединение
    await connection.end();
    
    logger.info('Инициализация системы успешно завершена!');
  } catch (error) {
    logger.error('Ошибка при инициализации системы:', error);
    process.exit(1);
  }
}

/**
 * Создает соединение с БД
 * @returns {Promise<Object>} - Соединение с БД
 */
async function createConnection() {
  try {
    // Сначала пытаемся подключиться к MySQL без указания базы данных
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });
    
    logger.info('Подключение к MySQL установлено');
    
    return connection;
  } catch (error) {
    logger.error('Ошибка при подключении к MySQL:', error);
    throw error;
  }
}

/**
 * Инициализирует базу данных
 * @param {Object} connection - Соединение с БД
 * @returns {Promise<void>}
 */
async function initDatabase(connection) {
  try {
    // Создаем базу данных, если она не существует
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    
    // Используем созданную базу данных
    await connection.query(`USE ${process.env.DB_NAME}`);
    
    // Читаем и выполняем основной SQL скрипт
    const schemaPath = path.join(__dirname, '../../database/schema.sql');
    
    // Проверяем, существует ли файл
    try {
      await fs.access(schemaPath);
    } catch (error) {
      logger.warn(`SQL файл не найден по пути ${schemaPath}`);
      logger.info('Создаем директорию и SQL файл...');
      
      // Создаем директорию
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });
      
      // Создаем SQL файл с базовой структурой
      const basicSql = `-- Скрипт для инициализации базы данных Biz360 AI Assistant
CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME};
USE ${process.env.DB_NAME};

-- Основные таблицы будут добавлены автоматически
`;
      
      await fs.writeFile(schemaPath, basicSql);
    }
    
    // Читаем и выполняем SQL скрипт
    const sqlScript = await fs.readFile(schemaPath, 'utf8');
    
    // Разделяем скрипт на отдельные запросы
    const queries = sqlScript
      .split(';')
      .filter(query => query.trim().length > 0);
    
    // Выполняем каждый запрос
    for (const query of queries) {
      await connection.query(query);
    }
    
    logger.info('База данных успешно инициализирована');
  } catch (error) {
    logger.error('Ошибка при инициализации базы данных:', error);
    throw error;
  }
}

/**
 * Инициализирует систему аутентификации
 * @param {Object} connection - Соединение с БД
 * @returns {Promise<void>}
 */
async function initAuth(connection) {
  try {
    // Читаем скрипт для создания таблиц аутентификации
    const authSchemaPath = path.join(__dirname, '../../database/auth-schema.sql');
    
    // Проверяем, существует ли файл
    try {
      await fs.access(authSchemaPath);
    } catch (error) {
      logger.warn(`SQL файл аутентификации не найден по пути ${authSchemaPath}`);
      logger.info('Создаем SQL файл аутентификации...');
      
      // Создаем SQL файл аутентификации
      const authSql = `-- Скрипт для создания таблиц аутентификации
      
-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  role ENUM('user', 'manager', 'admin') DEFAULT 'user',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL
);

-- Таблица API ключей
CREATE TABLE IF NOT EXISTS api_keys (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_key VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  user_id INT,
  scope VARCHAR(255),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Логи использования API ключей
CREATE TABLE IF NOT EXISTS api_key_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_key_id INT NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50) NOT NULL,
  user_agent VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);

-- Создание индексов
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_key_logs_api_key_id ON api_key_logs(api_key_id);
`;
      
      await fs.writeFile(authSchemaPath, authSql);
    }
    
    // Читаем и выполняем SQL скрипт аутентификации
    const authSqlScript = await fs.readFile(authSchemaPath, 'utf8');
    
    // Разделяем скрипт на отдельные запросы
    const authQueries = authSqlScript
      .split(';')
      .filter(query => query.trim().length > 0);
    
    // Выполняем каждый запрос
    for (const query of authQueries) {
      await connection.query(query);
    }
    
    // Проверяем, есть ли уже пользователи в системе
    const [users] = await connection.query('SELECT COUNT(*) as count FROM users');
    
    if (users[0].count === 0) {
      logger.info('Создание начального администратора...');
      
      // Хешируем пароль для администратора
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Создаем администратора
      await connection.query(
        `INSERT INTO users (username, password, email, role, active)
         VALUES (?, ?, ?, ?, ?)`,
        ['admin', hashedPassword, 'admin@example.com', 'admin', 1]
      );
      
      logger.info(`Создан начальный администратор (логин: admin, пароль: ${password})`);
    }
    
    // Проверяем, есть ли API ключи в системе
    const [apiKeys] = await connection.query('SELECT COUNT(*) as count FROM api_keys');
    
    if (apiKeys[0].count === 0) {
      logger.info('Создание начального API ключа...');
      
      // Создаем API ключ
      const apiKey = crypto.randomBytes(32).toString('hex');
      await connection.query(
        `INSERT INTO api_keys (api_key, name, scope, active)
         VALUES (?, ?, ?, ?)`,
        [apiKey, 'System API Key', 'system', 1]
      );
      
      logger.info(`Создан начальный API ключ: ${apiKey}`);
    }
    
    logger.info('Система аутентификации успешно инициализирована');
  } catch (error) {
    logger.error('Ошибка при инициализации системы аутентификации:', error);
    throw error;
  }
}

/**
 * Создает тестовые данные для разработки
 * @param {Object} connection - Соединение с БД
 * @returns {Promise<void>}
 */
async function createTestData(connection) {
  try {
    // Проверяем, есть ли уже проекты в системе
    const [projects] = await connection.query('SELECT COUNT(*) as count FROM projects');
    
    if (projects[0].count === 0) {
      logger.info('Создание тестового проекта...');
      
      // Создаем тестовый проект
      const [result] = await connection.query(
        `INSERT INTO projects (name, description, repository_url)
         VALUES (?, ?, ?)`,
        [
          'Biz360 CRM',
          'CRM система для управления бизнес-процессами',
          'https://github.com/yourusername/biz360-crm'
        ]
      );
      
      const projectId = result.insertId;
      
      // Создаем несколько тестовых задач
      const tasks = [
        { 
          title: 'Реализовать модуль аутентификации', 
          description: 'Создать компоненты для аутентификации пользователей, включая JWT токены и API ключи.' 
        },
        { 
          title: 'Разработать API для управления клиентами', 
          description: 'Реализовать CRUD операции для работы с клиентами в CRM системе.' 
        },
        { 
          title: 'Оптимизировать производительность базы данных', 
          description: 'Провести анализ и оптимизацию запросов к базе данных для повышения производительности.' 
        }
      ];
      
      for (const task of tasks) {
        await connection.query(
          `INSERT INTO tasks (project_id, title, description, status, priority)
           VALUES (?, ?, ?, ?, ?)`,
          [projectId, task.title, task.description, 'pending', 'medium']
        );
      }
      
      logger.info(`Создан тестовый проект и ${tasks.length} задач`);
    }
  } catch (error) {
    logger.error('Ошибка при создании тестовых данных:', error);
    // Не выбрасываем ошибку, чтобы не прерывать основной процесс
  }
}

// Запускаем инициализацию
initSystem()
  .then(() => {
    logger.info('Система успешно инициализирована');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Критическая ошибка при инициализации системы:', error);
    process.exit(1);
  });
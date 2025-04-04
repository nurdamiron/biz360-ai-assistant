// src/scripts/db-init.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

/**
 * Инициализирует базу данных, выполняя SQL скрипт
 */
async function initializeDatabase() {
  let connection;
  
  try {
    // Сначала подключаемся без указания базы данных
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });
    
    logger.info('Подключение к MySQL установлено');
    
    // Читаем SQL скрипт
    const sqlScript = fs.readFileSync(
      path.join(__dirname, '../../database/schema.sql'),
      'utf8'
    );
    
    // Разделяем скрипт на отдельные запросы
    const queries = sqlScript
      .split(';')
      .filter(query => query.trim().length > 0);
    
    // Выполняем каждый запрос
    for (const query of queries) {
      await connection.query(query);
    }
    
    logger.info('База данных успешно инициализирована');
    
    // Добавляем тестовый проект, если его еще нет
    await addTestProject(connection);
    
  } catch (error) {
    logger.error('Ошибка при инициализации базы данных:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      logger.info('Соединение с базой данных закрыто');
    }
  }
}

/**
 * Добавляет тестовый проект для демонстрации
 * @param {Object} connection - Соединение с БД
 */
async function addTestProject(connection) {
  try {
    // Подключаемся к созданной базе данных
    await connection.query(`USE ${process.env.DB_NAME}`);
    
    // Проверяем, есть ли уже проекты
    const [projects] = await connection.query(
      'SELECT COUNT(*) as count FROM projects'
    );
    
    if (projects[0].count === 0) {
      // Добавляем тестовый проект
      await connection.query(
        `INSERT INTO projects (name, description, repository_url)
         VALUES (?, ?, ?)`,
        [
          'Biz360 CRM',
          'CRM система для управления бизнес-процессами',
          'https://github.com/yourusername/biz360-crm'
        ]
      );
      
      logger.info('Тестовый проект добавлен');
    } else {
      logger.info('Тестовый проект уже существует');
    }
  } catch (error) {
    logger.error('Ошибка при добавлении тестового проекта:', error);
  }
}

// Запускаем инициализацию
initializeDatabase()
  .then(() => {
    logger.info('Инициализация завершена успешно');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Критическая ошибка при инициализации:', error);
    process.exit(1);
  });
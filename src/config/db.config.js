const mysql = require('mysql2/promise');
require('dotenv').config();

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

// Функция для проверки соединения с базой данных
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Успешное подключение к базе данных MySQL');
    connection.release();
    return true;
  } catch (error) {
    console.error('Ошибка подключения к базе данных:', error.message);
    return false;
  }
};

// Экспорт пула соединений и функции проверки
module.exports = {
  pool,
  testConnection
};

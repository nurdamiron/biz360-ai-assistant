const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Конфигурация подключения
const config = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 3306
};

async function setupDatabase() {
  let connection;

  try {
    // Подключение без указания базы данных
    connection = await mysql.createConnection(config);
    
    console.log('Подключено к MySQL серверу');
    
    // Создание базы данных, если она не существует
    const dbName = process.env.DB_NAME;
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    
    console.log(`База данных ${dbName} создана или уже существует`);
    
    // Переключение на созданную базу данных
    await connection.query(`USE ${dbName}`);
    
    // Чтение SQL файла со структурой таблиц
    const sqlPath = path.join(__dirname, 'schema.sql');
    let sql;
    
    try {
      sql = await fs.readFile(sqlPath, 'utf8');
    } catch (err) {
      console.error('Не удалось прочитать файл schema.sql. Создание базового файла...');
      
      // Если файл не существует, создаем базовую схему
      sql = `
-- Таблица проектов
CREATE TABLE IF NOT EXISTS \`projects\` (
  \`id\` INT PRIMARY KEY AUTO_INCREMENT,
  \`name\` VARCHAR(255) NOT NULL,
  \`repository_url\` VARCHAR(255) NOT NULL,
  \`description\` TEXT,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Таблица файлов
CREATE TABLE IF NOT EXISTS \`project_files\` (
  \`id\` INT PRIMARY KEY AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`file_path\` VARCHAR(512) NOT NULL,
  \`file_type\` VARCHAR(50) NOT NULL,
  \`last_commit_hash\` VARCHAR(40),
  \`last_analyzed\` TIMESTAMP,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON DELETE CASCADE
);

-- Таблица с векторными представлениями кода
CREATE TABLE IF NOT EXISTS \`code_vectors\` (
  \`id\` INT PRIMARY KEY AUTO_INCREMENT,
  \`file_id\` INT NOT NULL,
  \`code_segment\` TEXT NOT NULL,
  \`start_line\` INT NOT NULL,
  \`end_line\` INT NOT NULL,
  \`embedding\` JSON,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (\`file_id\`) REFERENCES \`project_files\`(\`id\`) ON DELETE CASCADE
);
      `;
      
      // Сохраняем сгенерированную схему в файл
      await fs.writeFile(sqlPath, sql);
    }
    
    // Выполнение SQL запросов
    const queries = sql.split(';').filter(query => query.trim().length > 0);
    
    for (const query of queries) {
      await connection.query(query);
    }
    
    console.log('Структура базы данных успешно создана');
    
  } catch (error) {
    console.error('Ошибка при настройке базы данных:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Соединение с базой данных закрыто');
    }
  }
}

// Запуск настройки
setupDatabase();

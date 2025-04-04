// src/scripts/start-dev.js

/**
 * Скрипт для запуска приложения в режиме разработки
 * - Проверяет наличие базы данных и таблиц
 * - Запускает миграции если необходимо
 * - Запускает сервер с nodemon для горячей перезагрузки
 */

require('dotenv').config();
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// Цвета для вывода в консоль
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

/**
 * Главная функция
 */
async function main() {
  console.log(`${colors.bright}${colors.cyan}=== Biz360 CRM AI Assistant - Dev Mode ===${colors.reset}\n`);
  
  try {
    // Проверяем наличие .env файла
    if (!fs.existsSync(path.join(process.cwd(), '.env'))) {
      console.log(`${colors.yellow}⚠️ Файл .env не найден${colors.reset}`);
      console.log(`Создайте файл .env на основе .env.example:\n`);
      console.log(`${colors.bright}cp .env.example .env${colors.reset}\n`);
      process.exit(1);
    }
    
    // Проверяем переменные окружения
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'LLM_API_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.log(`${colors.yellow}⚠️ Отсутствуют обязательные переменные окружения:${colors.reset} ${missingVars.join(', ')}`);
      console.log(`Добавьте их в файл .env и запустите скрипт снова\n`);
      process.exit(1);
    }
    
    // Проверяем подключение к БД
    console.log(`${colors.cyan}🔍 Проверяем подключение к MySQL...${colors.reset}`);
    
    try {
      // Пробуем подключиться к MySQL
      const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
      });
      
      // Проверяем существование базы данных
      const [rows] = await connection.query(
        `SHOW DATABASES LIKE '${process.env.DB_NAME}'`
      );
      
      if (rows.length === 0) {
        console.log(`${colors.yellow}⚠️ База данных '${process.env.DB_NAME}' не существует${colors.reset}`);
        console.log(`Инициализируем базу данных...`);
        
        // Создаем директорию для скриптов БД, если её нет
        if (!fs.existsSync(path.join(process.cwd(), 'database'))) {
          fs.mkdirSync(path.join(process.cwd(), 'database'));
        }
        
        // Копируем SQL скрипт если ещё нет
        const schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
        if (!fs.existsSync(schemaPath)) {
          fs.copyFileSync(
            path.join(__dirname, 'db-schema.sql'), 
            schemaPath
          );
        }
        
        // Запускаем инициализацию БД
        console.log(`${colors.cyan}🔄 Запускаем инициализацию базы данных...${colors.reset}`);
        await runProcess('node', [path.join(__dirname, 'db-init.js')]);
      } else {
        console.log(`${colors.green}✓ База данных '${process.env.DB_NAME}' существует${colors.reset}`);
      }
      
      // Закрываем соединение
      await connection.end();
      
    } catch (error) {
      console.log(`${colors.red}❌ Ошибка подключения к базе данных: ${error.message}${colors.reset}`);
      process.exit(1);
    }
    
    // Запускаем сервер
    console.log(`\n${colors.cyan}🚀 Запускаем сервер в режиме разработки...${colors.reset}`);
    console.log(`${colors.bright}Нажмите Ctrl+C для остановки\n${colors.reset}`);
    
    // Запускаем nodemon
    runProcess('npx', ['nodemon', 'src/index.js'], true);
    
  } catch (error) {
    console.log(`${colors.red}❌ Ошибка: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Запускает дочерний процесс
 * @param {string} command - Команда
 * @param {Array<string>} args - Аргументы
 * @param {boolean} wait - Ждать завершения или нет
 * @returns {Promise<void>}
 */
function runProcess(command, args, wait = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      stdio: wait ? 'inherit' : 'pipe',
      shell: true
    });
    
    if (!wait) {
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
        }
      });
    } else {
      // Если wait=true, просто ждем пока процесс завершится сам
      // (например, когда пользователь нажмет Ctrl+C)
      resolve();
    }
    
    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Запускаем главную функцию
main().catch(error => {
  console.error(`${colors.red}❌ Критическая ошибка: ${error.message}${colors.reset}`);
  process.exit(1);
});
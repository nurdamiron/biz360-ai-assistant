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
    
    // Настройка промптов для системы
    logger.info('Настройка промптов для AI-компонентов...');
    await setupPrompts();
    
    // Настройка системы для работы с документацией
    logger.info('Инициализация системы документации...');
    await setupDocumentationSystem();
    
    // Настройка PR менеджера
    logger.info('Инициализация PR менеджера...');
    await setupPrManager();
    
    // Настройка системы обратной связи
    logger.info('Инициализация системы обратной связи...');
    await setupFeedbackSystem(connection);
    
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

/**
 * Настраивает промпты для AI-компонентов
 * @returns {Promise<void>}
 */
async function setupPrompts() {
  try {
    const promptsDir = path.join(__dirname, '../../templates/prompts');
    
    // Проверяем наличие директории
    try {
      await fs.access(promptsDir);
    } catch (error) {
      // Создаем директорию для промптов, если она не существует
      await fs.mkdir(promptsDir, { recursive: true });
      logger.info(`Создана директория для промптов: ${promptsDir}`);
    }
    
    // Список промптов, которые должны быть в системе
    const requiredPrompts = {
      // Промпты для документации
      'generate-file-documentation.txt': 'Вам нужно создать документацию для кода. Проанализируйте код и создайте подробную документацию.\n\n# Информация о файле\n- Путь: {{filePath}}\n- Язык: {{language}}\n- Требуемый формат документации: {{outputFormat}}\n\n# Код:\n```{{language}}\n{{code}}\n```\n\n# Инструкции:\n1. Тщательно проанализируйте предоставленный код.\n2. Создайте документацию, которая включает:\n   - Общее описание файла, его назначение и роль в проекте\n   - Описание всех функций, классов, методов, переменных\n   - Входные и выходные параметры для функций и методов\n   - Любые зависимости и взаимодействия с другими частями системы\n   - Примеры использования (при необходимости)\n\n3. Структура документации должна соответствовать формату {{outputFormat}}:\n   - Если формат "markdown": используйте заголовки, списки, таблицы и форматирование Markdown\n   - Если формат "jsdoc": создайте JSDoc комментарии для каждого компонента кода\n   - Если формат "swagger": создайте спецификацию Swagger/OpenAPI для API эндпоинтов\n\nОбратите внимание на типы данных, обработку ошибок, любые бизнес-правила или сложные алгоритмы. Документация должна быть полной, точной и полезной для других разработчиков.\n\nОтвет сразу начните с документации без вступительных фраз и заключений.',
      'generate-module-overview.txt': 'Проанализируйте следующие файлы модуля и создайте обзор модуля в формате {{outputFormat}}.\n\n# Информация о модуле\n- Путь модуля: {{modulePath}}\n- Количество файлов: {{files.length}}\n\n# Файлы модуля:\n{{#each files}}\n## Файл: {{this.file}}\n```\n{{this.content}}\n```\n\n{{/each}}\n\n# Инструкции:\n1. Тщательно проанализируйте все предоставленные файлы.\n2. Создайте обзорную документацию для всего модуля, которая должна включать:\n   - Основное назначение и функциональность модуля\n   - Архитектуру модуля (его структуру и организацию)\n   - Взаимосвязи между файлами внутри модуля\n   - Основные компоненты/классы/функции модуля и их краткое описание\n   - Входные и выходные данные модуля (если применимо)\n   - Зависимости модуля от других частей системы и внешних библиотек\n   - Рекомендации по использованию модуля\n\n3. Формат документации должен соответствовать {{outputFormat}}:\n   - Если формат "markdown": используйте заголовки, списки, таблицы и форматирование Markdown\n   - Если формат "jsdoc": создайте JSDoc стиль документации\n   - Если формат "swagger": создайте компонент схемы для модуля (если применимо)\n\nОбзор должен быть информативным, но не слишком подробным. Делайте акцент на архитектуре, взаимодействиях и "большой картине". Детали отдельных функций или классов должны быть включены в документацию отдельных файлов.\n\nОтвет сразу начните с документации без вступительных фраз и заключений.',
      'generate-api-overview.txt': 'Создайте обзорную документацию для API на основе предоставленной информации о маршрутах.\n\n# Информация об API\n- Название API: {{apiTitle}}\n- Версия API: {{apiVersion}}\n- Формат документации: {{outputFormat}}\n\n# Маршруты API:\n{{#each routes}}\n- Файл: {{this.file}}, Базовый путь: {{this.basePath}}\n{{/each}}\n\n# Инструкции:\n1. Создайте полную обзорную документацию API, которая включает:\n   - Общее описание API, его назначение и основные возможности\n   - Список всех доступных эндпоинтов (сгруппированных по базовым путям)\n   - Типичные форматы запросов и ответов\n   - Требования к аутентификации (если это можно предположить по именам файлов)\n   - Общие параметры или заголовки\n   - Коды ошибок и их значения\n   - Рекомендации по использованию API\n\n2. Документация должна соответствовать формату {{outputFormat}}:\n   - Если формат "markdown": создайте документацию с заголовками, таблицами, списками и примерами в формате Markdown\n   - Если формат "swagger": создайте спецификацию OpenAPI 3.0 с базовой информацией о маршрутах\n\nОбратите внимание, что вы должны предположить типичные шаблоны REST API, если точное содержимое маршрутов не предоставлено.\n\nОтвет сразу начните с документации без вступительных фраз и заключений.',
      'generate-readme.txt': 'Создайте полный и профессиональный файл README.md для этого проекта или модуля на основе предоставленной информации.\n\n# Информация о проекте\n- Название проекта: {{projectName}}\n{{#if modulePath}}\n- Путь к модулю: {{modulePath}}\n{{/if}}\n{{#if description}}\n- Описание: {{description}}\n{{/if}}\n\n{{#if package}}\n# Package.json информация\n```json\n{{package}}\n```\n{{/if}}\n\n{{#if files.length}}\n# Файлы в проекте/модуле:\n{{#each files}}\n- {{this}}\n{{/each}}\n{{/if}}\n\n# Инструкции:\n1. Создайте полный README.md файл с следующими разделами:\n   - Название проекта (заголовок)\n   - Краткое описание\n   - Технологический стек или зависимости (на основе package.json или имен файлов)\n   - Требования/Предварительные условия\n   - Установка\n   - Использование\n   - Структура проекта (опишите основные файлы/директории и их назначение)\n   - Разработка (как настроить среду разработки)\n   - Тестирование (если есть тесты)\n   - Развертывание (основные шаги для развертывания)\n   - Лицензия (если известна из package.json)\n   - Авторы/Контрибьюторы (если известны из package.json)\n\n2. README должен быть написан в формате Markdown с правильным форматированием, заголовками, списками, таблицами и блоками кода.\n\n3. Если проект является модулем большего проекта, сосредоточьтесь на его конкретных функциях в контексте всего проекта.\n\n4. Используйте значки (badges) для статуса сборки, лицензии и т.д., если это уместно.\n\n5. Добавьте примеры кода, демонстрирующие основные функции, если их можно вывести из имен файлов или package.json.\n\nСделайте README профессиональным, информативным и удобным для пользователя. Ответ сразу начните с содержимого README без вступительных фраз.',
      
      // Промпты для PR и конфликтов
      'pr-description.txt': 'Сгенерируйте профессиональное и информативное описание Pull Request на основе предоставленной информации.\n\n# Основная информация\n- Ветка источник (head): {{headBranch}}\n- Целевая ветка (base): {{baseBranch}}\n- URL репозитория: {{repositoryUrl}}\n{{#if taskId}}\n- ID задачи: {{taskId}}\n{{/if}}\n{{#if taskTitle}}\n- Название задачи: {{taskTitle}}\n{{/if}}\n{{#if taskDescription}}\n- Описание задачи: {{taskDescription}}\n{{/if}}\n\n# Статистика изменений\n{{diffSummary}}\n\n# Список коммитов\n{{#each commits}}\n- {{this.hash}}: {{this.message}} ({{this.author}}, {{this.date}})\n{{/each}}\n\n{{#if changeList}}\n# Список измененных файлов\n{{#each changeList}}\n- {{this}}\n{{/each}}\n{{/if}}\n\n# Инструкции:\n1. Создайте четкое и профессиональное описание Pull Request, которое должно включать:\n   - Заголовок, четко указывающий на цель изменений\n   - Краткое описание внесенных изменений\n   - Причину этих изменений и решаемую проблему\n   - Ссылку на задачу, если она предоставлена (в формате соответствующем системе отслеживания задач)\n   - Список основных изменений с группировкой по категориям (если применимо)\n   - Все особые замечания или предупреждения для ревьюеров\n\n2. Используйте Markdown для форматирования:\n   - Используйте заголовки для разделов\n   - Используйте списки для перечисления изменений\n   - Используйте **жирный** текст для выделения важной информации\n   - При необходимости добавьте таблицы или цитаты\n\n3. Структура должна быть примерно следующей:\n   - Заголовок (связанный с задачей, если указана)\n   - Сводка изменений\n   - Детали и объяснения\n   - Инструкции для тестирования (при необходимости)\n   - Примечания/Предупреждения\n\nОтвет должен содержать готовое описание Pull Request в Markdown формате без дополнительных объяснений.',
      'conflict-analysis.txt': 'Проанализируйте конфликт слияния в указанном файле и предоставьте рекомендации по его разрешению.\n\n# Информация о конфликте\n- Файл: {{file}}\n- Базовая ветка (куда мерджим): {{baseBranch}}\n- Текущая ветка (откуда мерджим): {{headBranch}}\n\n# Содержимое файла с конфликтом\n```\n{{content}}\n```\n\n# Инструкции:\n1. Внимательно изучите содержимое файла и выделите конфликтующие участки, помеченные:\n   - `<<<<<<< HEAD` - начало блока кода из базовой ветки\n   - `=======` - разделитель между версиями\n   - `>>>>>>> [branch-name]` - конец блока кода из вливаемой ветки\n\n2. Проанализируйте различия между конфликтующими изменениями:\n   - Определите суть каждого изменения\n   - Оцените, не противоречат ли эти изменения друг другу логически\n   - Определите, можно ли объединить эти изменения, или нужно выбрать одно из них\n\n3. Для каждого конфликта предоставьте:\n   - Краткое описание проблемы\n   - Анализ изменений в обеих ветках\n   - Рекомендацию по разрешению конфликта с обоснованием\n   - При необходимости, предложите конкретный код для решения конфликта\n\n4. Структурируйте ваш ответ следующим образом:\n   - Общий обзор конфликта\n   - Анализ каждого конфликтующего блока\n   - Рекомендации по разрешению\n   - Возможные риски\n\nОтвет должен быть ясным, профессиональным и информативным, чтобы разработчик мог принять взвешенное решение о разрешении конфликта.',
      'review-checklist.txt': 'Сгенерируйте чеклист для код-ревью на основе предоставленной информации об изменениях.\n\n# Основная информация\n- Ветка источник (head): {{headBranch}}\n- Целевая ветка (base): {{baseBranch}}\n- URL репозитория: {{repositoryUrl}}\n{{#if taskId}}\n- ID задачи: {{taskId}}\n{{/if}}\n\n# Статистика изменений\n- Всего измененных файлов: {{changedFiles.length}}\n\n# Типы изменений\n{{#if changes.hasJsChanges}}\n- JavaScript/TypeScript файлы\n{{/if}}\n{{#if changes.hasCssChanges}}\n- CSS/SCSS/LESS файлы\n{{/if}}\n{{#if changes.hasHtmlChanges}}\n- HTML/шаблоны\n{{/if}}\n{{#if changes.hasTestChanges}}\n- Тесты\n{{/if}}\n{{#if changes.hasConfigChanges}}\n- Конфигурационные файлы\n{{/if}}\n{{#if changes.hasBackendChanges}}\n- Backend файлы\n{{/if}}\n\n# Изменения в файлах\n{{#each fileContents}}\n## {{this.file}}\n```diff\n{{this.diff}}\n```\n\n{{/each}}\n\n# Инструкции:\n1. Создайте чеклист для код-ревью, который включает все необходимые пункты для проверки предоставленных изменений.\n\n2. Чеклист должен быть разделен на категории:\n   - Функциональность (проверка соответствия требованиям)\n   - Качество кода (читаемость, поддерживаемость)\n   - Производительность\n   - Безопасность\n   - Тестирование\n   - Документация\n\n3. Адаптируйте чеклист с учетом типов измененных файлов:\n   {{#if changes.hasJsChanges}}\n   - Включите пункты по проверке JavaScript/TypeScript кода\n   {{/if}}\n   {{#if changes.hasCssChanges}}\n   - Включите пункты по стилям и верстке\n   {{/if}}\n   {{#if changes.hasHtmlChanges}}\n   - Включите пункты по HTML и шаблонам\n   {{/if}}\n   {{#if changes.hasTestChanges}}\n   - Включите особые пункты по проверке тестов\n   {{/if}}\n   {{#if changes.hasConfigChanges}}\n   - Включите пункты по проверке конфигурационных файлов\n   {{/if}}\n   {{#if changes.hasBackendChanges}}\n   - Включите пункты по проверке backend кода\n   {{/if}}\n\n4. Для каждого пункта чеклиста:\n   - Формулируйте проверку четко и конкретно\n   - Стремитесь к тому, чтобы на пункт можно было ответить "Да/Нет/Не применимо"\n   - Делайте формулировки полезными и информативными\n\nОтвет должен быть в формате Markdown, с четким разделением категорий и пунктов для проверки.',
      
      // Промпты для обратной связи
      'feedback-analysis.txt': 'Проанализируйте обратную связь пользователя и извлеките структурированную информацию.\n\n# Обратная связь пользователя\n```\n{{feedback}}\n```\n\n# Оценка пользователя\nРейтинг: {{rating}} из 5\n\n{{#if category}}\n# Категория\n{{category}}\n{{/if}}\n\n{{#if taskData}}\n# Связанная задача\nID: {{taskData.id}}\nНазвание: {{taskData.title}}\nОписание: {{taskData.description}}\n{{/if}}\n\n{{#if interactionData}}\n# Данные о взаимодействии с ИИ\nПромпт: {{interactionData.prompt}}\nОтвет: {{interactionData.response}}\n{{/if}}\n\n# Инструкции:\n1. Тщательно проанализируйте обратную связь пользователя.\n2. Извлеките следующую информацию:\n   - Общий тон обратной связи (положительный, отрицательный, нейтральный)\n   - Оценка настроения (от -5 до 5, где -5 крайне негативное, 0 нейтральное, 5 крайне положительное)\n   - Основные категории, к которым относится обратная связь\n   - Конкретные предложения по улучшению, если они есть\n   - Конкретные проблемы или жалобы, если они есть\n   - Запросы на новые функции, если они есть\n\n3. Предоставьте результат в структурированном JSON формате:\n```json\n{\n  "sentimentScore": <число от -5 до 5>,\n  "tone": "<положительный|отрицательный|нейтральный>",\n  "categories": [\n    "<категория1>", \n    "<категория2>", \n    ...\n  ],\n  "suggestions": [\n    "<предложение1>", \n    "<предложение2>", \n    ...\n  ],\n  "issues": [\n    "<проблема1>", \n    "<проблема2>", \n    ...\n  ],\n  "featureRequests": [\n    "<запрос1>", \n    "<запрос2>", \n    ...\n  ],\n  "summary": "<краткое резюме обратной связи в одном предложении>"\n}\n```\n\n4. Если из контекста недостаточно информации для заполнения какого-либо поля, оставьте пустой массив [] для списков или null для значений.\n\nВерните ответ только в формате JSON, без дополнительных комментариев.',
      'prioritize-changes.txt': 'Проанализируйте и приоритизируйте предлагаемые изменения на основе обратной связи пользователей.\n\n# Сгруппированные предложения по изменениям\n{{#each suggestions}}\n## Предложение {{@index+1}}\n- Текст: {{this.text}}\n- Количество упоминаний: {{this.count}}\n- Тип: {{this.type}}\n{{/each}}\n\n{{#if projectContext}}\n# Контекст проекта\n{{#if projectContext.name}}\n- Название проекта: {{projectContext.name}}\n{{/if}}\n{{#if projectContext.description}}\n- Описание: {{projectContext.description}}\n{{/if}}\n{{#if projectContext.currentPriorities}}\n- Текущие приоритеты: {{projectContext.currentPriorities}}\n{{/if}}\n{{#if projectContext.constraints}}\n- Ограничения: {{projectContext.constraints}}\n{{/if}}\n{{/if}}\n\n{{#if limit}}\n# Ограничения\n- Максимальное количество предложений: {{limit}}\n{{/if}}\n\n# Инструкции:\n1. Проанализируйте каждое предложение по следующим критериям:\n   - Частота упоминания (количество пользователей, предложивших подобное изменение)\n   - Потенциальное влияние на пользовательский опыт\n   - Сложность реализации (оцените на основе содержания предложения)\n   - Соответствие текущим приоритетам проекта (если указаны)\n\n2. Приоритизируйте предложения по их общей ценности и осуществимости:\n   - High (высокий): Критически важные изменения, имеющие значительное влияние и/или часто упоминаемые\n   - Medium (средний): Важные изменения, но не критические\n   - Low (низкий): Полезные, но не срочные изменения\n\n3. Для каждого предложения сформулируйте чёткое и конкретное описание изменения, которое можно использовать в качестве названия задачи.\n\n4. Предоставьте результат в JSON формате:\n```json\n{\n  "reasoning": "<объяснение вашего процесса приоритизации>",\n  "suggestedChanges": [\n    {\n      "id": "change-1",\n      "title": "<название задачи>",\n      "description": "<более подробное описание, если необходимо>",\n      "priority": "<high|medium|low>",\n      "originalSuggestion": "<исходное предложение>",\n      "count": <количество упоминаний>,\n      "estimatedEffort": "<low|medium|high>",\n      "reasoning": "<почему это получило такой приоритет>"\n    },\n    ...\n  ]\n}\n```\n\n5. Отсортируйте suggestedChanges от наивысшего приоритета к наименьшему.\n\nВерните ответ только в формате JSON, без дополнительных комментариев.',
      'comment-processing.txt': 'Проанализируйте комментарий к коду и классифицируйте его.\n\n# Комментарий\n```\n{{comment}}\n```\n\n{{#if user}}\n# Автор комментария\nПользователь: {{user}}\n{{/if}}\n\n# Контекст кода\n```\n{{codeContext}}\n```\n\n# Информация о файле\nПуть: {{filePath}}\nСтрока: {{lineNumber}}\n\n# Инструкции:\n1. Проанализируйте комментарий к коду, учитывая предоставленный контекст.\n2. Определите тип комментария:\n   - "question" - вопрос о коде\n   - "suggestion" - предложение по улучшению кода\n   - "bug" - указание на ошибку или баг\n   - "praise" - положительный отзыв\n   - "clarification" - просьба о разъяснении\n   - "other" - другой тип\n\n3. Определите серьезность комментария:\n   - "critical" - критическая проблема, требует немедленного внимания\n   - "major" - серьезная проблема, но не критическая\n   - "minor" - незначительная проблема или улучшение\n   - "trivial" - тривиальная проблема или стилистическое предложение\n   - "none" - нет проблемы (для вопросов или похвалы)\n\n4. Определите, требуется ли действие в ответ на комментарий.\n\n5. Если это предложение или указание на ошибку, предложите конкретные изменения в коде.\n\n6. Предоставьте результат в структурированном JSON формате:\n```json\n{\n  "type": "<тип комментария>",\n  "severity": "<серьезность>",\n  "requiresAction": true|false,\n  "suggestion": "<конкретное предложение для исправления, если применимо>",\n  "codeChanges": "<предлагаемые изменения в коде, если применимо>",\n  "summary": "<краткое резюме комментария>"\n}\n```\n\nВерните ответ только в формате JSON, без дополнительных комментариев.'
    };
    
    // Проверяем наличие каждого промпта и создаем, если отсутствует
    for (const [promptName, content] of Object.entries(requiredPrompts)) {
      const promptPath = path.join(promptsDir, promptName);
      
      try {
        // Проверяем, существует ли файл
        await fs.access(promptPath);
        logger.info(`Промпт ${promptName} уже существует`);
      } catch (error) {
        // Создаем файл промпта, если не существует
        await fs.writeFile(promptPath, content);
        logger.info(`Создан промпт ${promptName}`);
      }
    }
    
    logger.info('Настройка промптов завершена успешно');
  } catch (error) {
    logger.error('Ошибка при настройке промптов:', error);
    throw error;
  }
}

/**
 * Настраивает систему документации
 * @returns {Promise<void>}
 */
async function setupDocumentationSystem() {
  try {
    // Создаем директорию для документации, если она не существует
    const docsDir = path.join(__dirname, '../../docs');
    await fs.mkdir(docsDir, { recursive: true });
    
    // Создаем поддиректории для разных типов документации
    const docSubdirs = ['api', 'core', 'models', 'utils'];
    for (const subdir of docSubdirs) {
      await fs.mkdir(path.join(docsDir, subdir), { recursive: true });
      logger.info(`Создана директория для документации: ${subdir}`);
    }
    
    // Создаем базовый README для директории с документацией
    const readmePath = path.join(docsDir, 'README.md');
    try {
      await fs.access(readmePath);
      logger.info('README.md для документации уже существует');
    } catch (error) {
      const readmeContent = `# Документация проекта

В этой директории хранится автоматически сгенерированная документация для различных компонентов проекта.

## Структура директории

- **api/** - документация по API эндпоинтам
- **core/** - документация по основным компонентам системы
- **models/** - документация по моделям данных
- **utils/** - документация по вспомогательным утилитам

## Генерация документации

Документация может быть сгенерирована автоматически с помощью системы документации.

### API

\`\`\`
POST /api/documentation/generate
\`\`\`

### Через интерфейс командной строки

\`\`\`
npm run generate-docs
\`\`\`

## Обновление документации

Документация автоматически обновляется при существенных изменениях в коде.
`;
      
      await fs.writeFile(readmePath, readmeContent);
      logger.info('Создан README.md для документации');
    }
    
    logger.info('Система документации настроена успешно');
  } catch (error) {
    logger.error('Ошибка при настройке системы документации:', error);
    // Не выбрасываем ошибку, чтобы не прерывать остальную инициализацию
  }
}

/**
 * Настраивает PR менеджер
 * @returns {Promise<void>}
 */
async function setupPrManager() {
  try {
    // Создаем директорию для хранения временных данных PR, если она не существует
    const prDir = path.join(__dirname, '../../data/pr');
    await fs.mkdir(prDir, { recursive: true });
    logger.info('Создана директория для данных PR');
    
    // Создаем файл с настройками PR по умолчанию
    const prConfigPath = path.join(prDir, 'pr-config.json');
    try {
      await fs.access(prConfigPath);
      logger.info('Файл конфигурации PR уже существует');
    } catch (error) {
      // Создаем базовую конфигурацию PR
      const prConfig = {
        defaultBaseBranch: 'main',
        defaultReviewers: [],
        templatePath: 'templates/pr-template.md',
        checklistsEnabled: true,
        conflictAnalysisEnabled: true,
        autoGenerateDescription: true
      };
      
      await fs.writeFile(prConfigPath, JSON.stringify(prConfig, null, 2));
      logger.info('Создан файл конфигурации PR по умолчанию');
    }
    
    // Создаем директорию для шаблонов PR, если она не существует
    const templatesDir = path.join(__dirname, '../../templates');
    await fs.mkdir(templatesDir, { recursive: true });
    
    // Создаем базовый шаблон PR
    const prTemplatePath = path.join(templatesDir, 'pr-template.md');
    try {
      await fs.access(prTemplatePath);
      logger.info('Шаблон PR уже существует');
    } catch (error) {
      const prTemplateContent = `# Описание

## Что было сделано

_Опишите изменения, внесённые этим PR._

## Связанные задачи

_Укажите связанные задачи или проблемы._

## Скриншоты (если применимо)

_Приложите скриншоты, показывающие изменения._

## Контрольные вопросы

- [ ] Код соответствует стандартам кодирования
- [ ] Были добавлены необходимые тесты
- [ ] Документация обновлена
- [ ] Изменения не вносят регрессий

## Примечания для ревьюеров

_Укажите моменты, на которые стоит обратить внимание при ревью._
`;
      
      await fs.writeFile(prTemplatePath, prTemplateContent);
      logger.info('Создан базовый шаблон PR');
    }
    
    logger.info('PR менеджер настроен успешно');
  } catch (error) {
    logger.error('Ошибка при настройке PR менеджера:', error);
    // Не выбрасываем ошибку, чтобы не прерывать остальную инициализацию
  }
}

/**
 * Настраивает систему обратной связи
 * @param {Object} connection - Соединение с БД
 * @returns {Promise<void>}
 */
async function setupFeedbackSystem(connection) {
  try {
    // Создаем таблицы для системы обратной связи, если они еще не существуют
    const feedbackSchemaSql = `
-- Таблица для хранения обратной связи
CREATE TABLE IF NOT EXISTS feedback (
  id INT PRIMARY KEY AUTO_INCREMENT,
  text TEXT NOT NULL,
  rating INT,
  category VARCHAR(50),
  user_id INT,
  task_id INT,
  llm_interaction_id INT,
  analysis JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Таблица для комментариев к коду
CREATE TABLE IF NOT EXISTS code_comments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  text TEXT NOT NULL,
  file_path VARCHAR(255),
  line_number INT,
  user_id INT,
  pull_request_id VARCHAR(100),
  task_id INT,
  analysis JSON,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Индексы
CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_task_id ON feedback(task_id);
CREATE INDEX idx_feedback_category ON feedback(category);
CREATE INDEX idx_code_comments_file_path ON code_comments(file_path);
CREATE INDEX idx_code_comments_pull_request_id ON code_comments(pull_request_id);
`;
    
    // Выполняем запросы для создания таблиц
    const queries = feedbackSchemaSql
      .split(';')
      .filter(query => query.trim().length > 0);
    
    for (const query of queries) {
      await connection.query(query);
    }
    
    // Создаем директорию для хранения данных обратной связи
    const feedbackDir = path.join(__dirname, '../../data/feedback');
    await fs.mkdir(feedbackDir, { recursive: true });
    logger.info('Создана директория для данных обратной связи');
    
    // Создаем конфигурационный файл для системы обратной связи
    const feedbackConfigPath = path.join(feedbackDir, 'feedback-config.json');
    try {
      await fs.access(feedbackConfigPath);
      logger.info('Файл конфигурации системы обратной связи уже существует');
    } catch (error) {
      // Создаем базовую конфигурацию
      const feedbackConfig = {
        categories: ['UI', 'Performance', 'Functionality', 'Documentation', 'Other'],
        autoAnalyzeEnabled: true,
        prioritizationEnabled: true,
        autoTaskCreationEnabled: false,
        minRatingForTaskCreation: 3,
        notificationsEnabled: true
      };
      
      await fs.writeFile(feedbackConfigPath, JSON.stringify(feedbackConfig, null, 2));
      logger.info('Создан файл конфигурации системы обратной связи по умолчанию');
    }
    
    logger.info('Система обратной связи настроена успешно');
  } catch (error) {
    logger.error('Ошибка при настройке системы обратной связи:', error);
    // Не выбрасываем ошибку, чтобы не прерывать остальную инициализацию
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
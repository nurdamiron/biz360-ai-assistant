#!/usr/bin/env node

/**
 * Скрипт для установки и инициализации ИИ-ассистента Biz360 CRM
 * Выполняет следующие шаги:
 * 1. Проверка зависимостей
 * 2. Настройка базы данных
 * 3. Создание необходимых директорий
 * 4. Настройка переменных окружения
 * 5. Инициализация компонентов системы
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const readline = require('readline');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Загружаем переменные окружения из .env файла, если он существует
dotenv.config();

// Создаем интерфейс для чтения пользовательского ввода
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Промисифицируем функцию вопроса
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Основная функция установки
async function setupAssistant() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('Установка и инициализация ИИ-ассистента Biz360 CRM');
    console.log('='.repeat(80) + '\n');

    // Шаг 1: Проверка зависимостей
    await checkDependencies();

    // Шаг 2: Настройка переменных окружения
    await setupEnvironment();

    // Шаг 3: Настройка базы данных
    await setupDatabase();

    // Шаг 4: Создание необходимых директорий
    await createDirectories();

    // Шаг 5: Инициализация компонентов системы
    await initializeComponents();

    console.log('\n' + '='.repeat(80));
    console.log('Установка успешно завершена!');
    console.log('='.repeat(80) + '\n');

    console.log('Для запуска ИИ-ассистента выполните:');
    console.log('  npm start');
    console.log('\nДля запуска с режимом отладки:');
    console.log('  npm run dev');
    console.log('\nДокументация доступна в README.md');

    rl.close();
  } catch (error) {
    console.error('\n❌ Ошибка при установке:', error.message);
    console.error('Пожалуйста, исправьте ошибку и повторите попытку установки.');
    rl.close();
    process.exit(1);
  }
}

/**
 * Проверяет наличие необходимых зависимостей
 * @returns {Promise<void>}
 */
async function checkDependencies() {
  console.log('📋 Проверка необходимых зависимостей...');

  try {
    // Проверяем версию Node.js
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    
    if (majorVersion < 14) {
      throw new Error(`Требуется Node.js версии 14 или выше. Текущая версия: ${nodeVersion}`);
    }
    
    console.log(`✅ Node.js: ${nodeVersion}`);

    // Проверяем наличие npm
    execSync('npm --version', { stdio: ['ignore', 'ignore', 'ignore'] });
    console.log('✅ npm установлен');

    // Проверяем наличие Git
    try {
      execSync('git --version', { stdio: ['ignore', 'ignore', 'ignore'] });
      console.log('✅ Git установлен');
    } catch (error) {
      console.warn('⚠️ Git не установлен. Некоторые функции могут быть недоступны.');
    }

    // Проверяем наличие MySQL
    try {
      execSync('mysql --version', { stdio: ['ignore', 'ignore', 'ignore'] });
      console.log('✅ MySQL установлен');
    } catch (error) {
      console.warn('⚠️ MySQL не установлен или не доступен в PATH.');
      const installMySQL = await question('Хотите продолжить без MySQL? (y/n): ');
      if (installMySQL.toLowerCase() !== 'y') {
        throw new Error('Установка прервана пользователем. Установите MySQL и повторите попытку.');
      }
    }

    // Устанавливаем npm зависимости
    console.log('📦 Установка npm зависимостей...');
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Зависимости npm установлены');

  } catch (error) {
    throw new Error(`Ошибка при проверке зависимостей: ${error.message}`);
  }
}

/**
 * Настраивает переменные окружения
 * @returns {Promise<void>}
 */
async function setupEnvironment() {
  console.log('\n📝 Настройка переменных окружения...');

  // Проверяем наличие .env файла
  const envPath = path.join(process.cwd(), '.env');
  let envExists = false;

  try {
    await fs.access(envPath);
    envExists = true;
    console.log('📄 Найден существующий файл .env');
  } catch (error) {
    console.log('📄 Файл .env не найден, создаем новый');
  }

  if (envExists) {
    const overwrite = await question('Хотите перезаписать существующий файл .env? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('✅ Используем существующий файл .env');
      return;
    }
  }

  // Запрашиваем необходимые переменные окружения
  console.log('\nПожалуйста, введите следующие настройки:');
  
  const port = await question('Порт для API (3000): ');
  
  console.log('\n--- Настройки базы данных ---');
  const dbHost = await question('Хост MySQL (localhost): ');
  const dbPort = await question('Порт MySQL (3306): ');
  const dbUser = await question('Имя пользователя MySQL: ');
  const dbPassword = await question('Пароль MySQL: ');
  const dbName = await question('Имя базы данных (biz360_assistant): ');
  
  console.log('\n--- Настройки LLM API ---');
  const llmApiKey = await question('API ключ для LLM (Anthropic Claude): ');
  const llmModel = await question('Модель LLM (claude-3-opus-20240229): ');
  const llmApiUrl = await question('URL API LLM (https://api.anthropic.com): ');
  
  // Формируем содержимое .env файла
  const envContent = `
# Основные настройки
NODE_ENV=development
PORT=${port || '3000'}
LOG_LEVEL=info

# Настройки базы данных
DB_HOST=${dbHost || 'localhost'}
DB_PORT=${dbPort || '3306'}
DB_USER=${dbUser || 'root'}
DB_PASSWORD=${dbPassword || ''}
DB_NAME=${dbName || 'biz360_assistant'}

# Настройки LLM API
LLM_API_KEY=${llmApiKey || ''}
LLM_MODEL=${llmModel || 'claude-3-opus-20240229'}
LLM_API_URL=${llmApiUrl || 'https://api.anthropic.com'}
LLM_MAX_TOKENS=4000
LLM_TEMPERATURE=0.7
LLM_CACHE_ENABLED=true
LLM_CACHE_TTL=1800
LLM_MAX_RETRIES=3
LLM_RETRY_DELAY=1000

# Настройки для работы с Git
GIT_USERNAME=
GIT_TOKEN=
`.trim();

  // Записываем .env файл
  await fs.writeFile(envPath, envContent);
  console.log('✅ Файл .env успешно создан');
}

/**
 * Настраивает базу данных
 * @returns {Promise<void>}
 */
async function setupDatabase() {
  console.log('\n🗄️ Настройка базы данных...');

  // Получаем настройки базы данных из .env
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
  const dbUser = process.env.DB_USER || 'root';
  const dbPassword = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'biz360_assistant';

  try {
    // Создаем соединение без указания базы данных
    const connection = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      multipleStatements: false // Устанавливаем в false, чтобы использовать отдельные запросы
    });

    console.log('✅ Подключено к MySQL серверу');

    // Создаем базу данных, если она не существует
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    console.log(`✅ База данных "${dbName}" создана или уже существует`);

    // Переключаемся на созданную базу данных
    await connection.query(`USE \`${dbName}\``);

    // Запускаем скрипт создания таблиц
    console.log('📊 Создание таблиц...');
    try {
      // Считываем SQL скрипт
      const schemaPath = path.join(process.cwd(), 'scripts', 'schema.sql');
      const schemaSql = await fs.readFile(schemaPath, 'utf8');

      // Выполняем запросы из скрипта по одному
      const queries = schemaSql
        .split(';')
        .filter(query => query.trim().length > 0)
        .map(query => query.trim() + ';');
      
      for (const query of queries) {
        try {
          // Используем query вместо execute для DDL запросов
          await connection.query(query);
        } catch (queryError) {
          console.warn(`⚠️ Ошибка при выполнении запроса: ${queryError.message}`);
          console.warn('Запрос:', query.substring(0, 100) + '...');
          // Продолжаем выполнение, даже если отдельный запрос не выполнился
          // Например, если таблица уже существует
        }
      }

      console.log('✅ Таблицы успешно созданы');
    } catch (error) {
      throw new Error(`Ошибка при создании таблиц: ${error.message}`);
    }

    // Закрываем соединение
    await connection.end();
    console.log('🔌 Соединение с базой данных закрыто');

  } catch (error) {
    throw new Error(`Ошибка при настройке базы данных: ${error.message}`);
  }
}

/**
 * Создает необходимые директории
 * @returns {Promise<void>}
 */
async function createDirectories() {
  console.log('\n📁 Создание необходимых директорий...');

  const directories = [
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), 'data', 'insights'),
    path.join(process.cwd(), 'data', 'improved_prompts'),
    path.join(process.cwd(), 'data', 'cache'),
    path.join(process.cwd(), 'logs'),
    path.join(process.cwd(), 'templates'),
    path.join(process.cwd(), 'templates', 'prompts')
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`✅ Создана директория: ${path.relative(process.cwd(), dir)}`);
    } catch (error) {
      throw new Error(`Ошибка при создании директории ${dir}: ${error.message}`);
    }
  }

  // Создаем файл .gitkeep в пустых директориях
  for (const dir of directories) {
    const gitkeepPath = path.join(dir, '.gitkeep');
    try {
      await fs.writeFile(gitkeepPath, '');
    } catch (error) {
      console.warn(`⚠️ Не удалось создать файл .gitkeep в ${dir}`);
    }
  }
}

/**
 * Инициализирует компоненты системы
 * @returns {Promise<void>}
 */
async function initializeComponents() {
  console.log('\n🚀 Инициализация компонентов системы...');

  // Создаем базовые шаблоны промптов
  await createPromptTemplates();

  // Создаем тестовый проект, если пользователь хочет
  const createTestProject = await question('Создать тестовый проект для демонстрации? (y/n): ');
  
  if (createTestProject.toLowerCase() === 'y') {
    await createDemoProject();
  }

  console.log('✅ Компоненты системы успешно инициализированы');
}

/**
 * Создает базовые шаблоны промптов
 * @returns {Promise<void>}
 */
async function createPromptTemplates() {
  console.log('📝 Создание базовых шаблонов промптов...');

  const templatesDir = path.join(process.cwd(), 'templates', 'prompts');

  // Шаблон для декомпозиции задач
  const taskDecompositionTemplate = `
# Декомпозиция задачи разработки

Ты - опытный разработчик и архитектор, который помогает разбивать сложные задачи на подзадачи.

## Проект
Название: {projectName}
Описание: {projectDescription}

## Задача для декомпозиции
Название: {taskTitle}
Описание: {taskDescription}

## Инструкции
1. Разбей эту задачу на 3-7 последовательных подзадач, каждая из которых представляет четкий шаг в реализации общей задачи.
2. Подзадачи должны быть конкретными, выполнимыми и логически связанными.
3. Подзадачи должны следовать в порядке, необходимом для выполнения общей задачи.
4. Каждая подзадача должна иметь четкий заголовок и подробное описание того, что нужно сделать.

## Формат ответа
Выдай подзадачи в формате:

SUBTASK: [Заголовок подзадачи 1]
DESCRIPTION: [Подробное описание подзадачи 1]

SUBTASK: [Заголовок подзадачи 2]
DESCRIPTION: [Подробное описание подзадачи 2]

И так далее для каждой подзадачи.
`;

  // Шаблон для генерации кода
  const codeGenerationTemplate = `
# Задача разработки кода
Ты - опытный разработчик Node.js/Express, который работает над проектом Biz360 CRM.

## Требования к задаче
{taskDescription}

## Контекст проекта
{projectContext}

## Релевантные файлы
{relevantFiles}

## Структура базы данных
{dbSchema}

## Архитектурные особенности
{architectureNotes}

## Стиль кода
{codeStyle}

## Задание
Напиши {fileType} код для реализации указанных требований. 
Твой код должен следовать стилю проекта и интегрироваться с существующей архитектурой.
Код должен быть полным, рабочим и хорошо структурированным.
Используй наилучшие практики программирования, обрабатывай ошибки и документируй код.
`;

  // Шаблон для рефакторинга кода
  const codeRefactoringTemplate = `
# Задача рефакторинга
Ты - опытный разработчик Node.js/Express, работающий над улучшением проекта Biz360 CRM.

## Исходный код для рефакторинга
\`\`\`javascript
{originalCode}
\`\`\`

## Проблемы в коде
{codeIssues}

## Контекст проекта
{projectContext}

## Релевантные файлы
{relevantFiles}

## Задание
Выполни рефакторинг данного кода, устранив указанные проблемы и улучшив его качество.
Сохрани текущую функциональность, но сделай код более читаемым, эффективным и поддерживаемым.
Следуй принципам SOLID, DRY и другим лучшим практикам.
`;

  // Шаблон для исправления ошибок
  const bugFixTemplate = `
# Задача исправления ошибки
Ты - опытный разработчик Node.js/Express, работающий над проектом Biz360 CRM.

## Описание ошибки
{bugDescription}

## Код с ошибкой
\`\`\`javascript
{buggyCode}
\`\`\`

## Логи и трассировка
{logs}

## Релевантные файлы
{relevantFiles}

## Задание
Проанализируй ошибку и предложи исправление.
Опиши, в чём причина ошибки и почему твое решение ее устраняет.
Предоставь полную версию исправленного кода.
`;

  // Шаблон для генерации тестов
  const testGenerationTemplate = `
# Задача: Создание тестов для кода

## Описание задачи
{taskDescription}

## Код для тестирования
\`\`\`javascript
{code}
\`\`\`

## Фреймворк и требования к тестам
- Используй Jest в качестве фреймворка для тестирования
- Включи все необходимые импорты, включая модуль, который тестируется
- Используй describe/it/test блоки для структурирования тестов
- Используй expect с соответствующими матчерами для проверок
- Используй моки (jest.mock) для имитации зависимостей, если необходимо
- Тесты должны быть исчерпывающими и покрывать успешные и ошибочные сценарии

## Дополнительные инструкции
- Тесты должны быть автономными и не требовать внешних зависимостей
- Используй моки для сетевых запросов, баз данных и файловой системы
- Пиши тесты, которые проверяют как успешные, так и ошибочные сценарии
- Комментируй тесты для объяснения, что именно они проверяют
- Предусмотри различные случаи использования, включая граничные условия

Создай полный набор тестов, который можно запустить с помощью Jest.
Ответ должен содержать только код тестов без дополнительных пояснений.
`;

  // Записываем шаблоны
  await fs.writeFile(path.join(templatesDir, 'task-decomposition.txt'), taskDecompositionTemplate.trim());
  await fs.writeFile(path.join(templatesDir, 'code-generation.txt'), codeGenerationTemplate.trim());
  await fs.writeFile(path.join(templatesDir, 'code-refactoring.txt'), codeRefactoringTemplate.trim());
  await fs.writeFile(path.join(templatesDir, 'bug-fix.txt'), bugFixTemplate.trim());
  await fs.writeFile(path.join(templatesDir, 'test-generation.txt'), testGenerationTemplate.trim());

  console.log('✅ Базовые шаблоны промптов созданы');
}

/**
 * Создает демо-проект для тестирования
 * @returns {Promise<void>}
 */
async function createDemoProject() {
  console.log('🧪 Создание демо-проекта для тестирования...');

  try {
    // Подключаемся к базе данных
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'biz360_assistant';

    const connection = await mysql.createConnection({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName
    });

    // Создаем демо-проект
    const [projectResult] = await connection.execute(
      'INSERT INTO projects (name, repository_url, description) VALUES (?, ?, ?)',
      [
        'Biz360 CRM Demo', 
        '/path/to/demo/repository', 
        'Демо-проект для тестирования ИИ-ассистента'
      ]
    );

    const projectId = projectResult.insertId;
    console.log(`✅ Создан демо-проект с ID: ${projectId}`);

    // Создаем несколько демо-задач
    const tasks = [
      {
        title: 'Создать модель пользователя',
        description: 'Разработать модель пользователя с полями для имени, email, роли и настроек. Реализовать методы для CRUD операций и валидации данных.',
        priority: 'high'
      },
      {
        title: 'Разработать API для управления клиентами',
        description: 'Создать REST API для управления клиентами: получение списка, добавление, обновление и удаление. Реализовать фильтрацию и пагинацию результатов.',
        priority: 'medium'
      },
      {
        title: 'Исправить ошибку в модуле аутентификации',
        description: 'При попытке восстановления пароля возникает ошибка 500. Необходимо исправить обработку запроса и добавить корректную валидацию email.',
        priority: 'critical'
      }
    ];

    for (const task of tasks) {
      const [taskResult] = await connection.execute(
        'INSERT INTO tasks (project_id, title, description, status, priority) VALUES (?, ?, ?, ?, ?)',
        [projectId, task.title, task.description, 'pending', task.priority]
      );

      console.log(`✅ Создана демо-задача "${task.title}" с ID: ${taskResult.insertId}`);
    }

    await connection.end();
    console.log('✅ Демо-проект успешно создан');
  } catch (error) {
    console.error('❌ Ошибка при создании демо-проекта:', error.message);
    console.warn('⚠️ Продолжаем установку без создания демо-проекта');
  }
}

// Запускаем скрипт установки
setupAssistant();
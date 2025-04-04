// src/core/code-generator/prompt-builder.js

const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const fileUtils = require('../../utils/file-utils');
const path = require('path');

/**
 * Класс для построения промптов для генерации кода
 */
class PromptBuilder {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    
    // Максимальное количество контекстных файлов
    this.maxContextFiles = 3;
    
    // Максимальный размер содержимого каждого файла в контексте (в символах)
    this.maxFileSize = 5000;
    
    // Шаблоны промптов
    this.templates = {
      codeGeneration: `
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
`,
      
      codeRefactoring: `
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
`,
      
      bugFix: `
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
`
    };
  }

  /**
   * Получает информацию о проекте
   * @returns {Promise<Object>} - Данные о проекте
   */
  async getProjectInfo() {
    try {
      const connection = await pool.getConnection();
      
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [this.projectId]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        throw new Error(`Проект с id=${this.projectId} не найден`);
      }
      
      return projects[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о проекте:', error);
      throw error;
    }
  }

  /**
   * Находит релевантные файлы для конкретной задачи
   * @param {number} taskId - ID задачи
   * @param {string} taskDescription - Описание задачи
   * @returns {Promise<Array>} - Массив релевантных файлов
   */
  async findRelevantFiles(taskId, taskDescription) {
    try {
      // Используем LLM для определения ключевых понятий в задаче
      const keyTermsPrompt = `
Проанализируй следующее описание задачи и выдели ключевые технические термины, 
понятия и компоненты, которые могут быть связаны с конкретными файлами кода:

${taskDescription}

Выдай список из 5-7 ключевых слов или фраз, разделенных запятыми.
`;
      
      const keyTermsResponse = await this.llmClient.sendPrompt(keyTermsPrompt);
      const keyTerms = keyTermsResponse.split(',').map(term => term.trim());
      
      logger.debug('Ключевые термины для поиска релевантных файлов:', keyTerms);
      
      // Поиск файлов по ключевым терминам
      const connection = await pool.getConnection();
      
      let relevantFiles = [];
      
      // Для каждого термина ищем похожие сегменты кода
      for (const term of keyTerms) {
        if (!term || term.length < 3) continue; // Пропускаем слишком короткие термины
        
        const [results] = await connection.query(
          `SELECT pf.file_path, pf.id, cv.code_segment, cv.start_line, cv.end_line
           FROM project_files pf
           JOIN code_vectors cv ON pf.id = cv.file_id
           WHERE pf.project_id = ? 
           AND (cv.code_segment LIKE ? OR pf.file_path LIKE ?)
           LIMIT 10`,
          [this.projectId, `%${term}%`, `%${term}%`]
        );
        
        // Добавляем найденные файлы в список
        for (const result of results) {
          // Проверяем, не добавлен ли файл уже
          const existingFile = relevantFiles.find(file => file.id === result.id);
          
          if (!existingFile) {
            relevantFiles.push({
              id: result.id,
              file_path: result.file_path,
              relevant_segment: {
                content: result.code_segment,
                start_line: result.start_line,
                end_line: result.end_line
              }
            });
          }
        }
      }
      
      connection.release();
      
      // Если не нашли ничего, возвращаем пустой массив
      if (relevantFiles.length === 0) {
        logger.info('Не найдены релевантные файлы для задачи');
        return [];
      }
      
      // Отбираем наиболее релевантные файлы
      relevantFiles = relevantFiles.slice(0, this.maxContextFiles);
      
      // Получаем полное содержимое файлов
      const projectInfo = await this.getProjectInfo();
      const projectPath = projectInfo.repository_url;
      
      for (const file of relevantFiles) {
        try {
          const filePath = path.join(projectPath, file.file_path);
          let content = await fileUtils.readFile(filePath);
          
          // Если файл слишком большой, обрезаем его
          if (content.length > this.maxFileSize) {
            // Пытаемся сохранить релевантный сегмент
            const segment = file.relevant_segment;
            
            if (segment) {
              const lines = content.split('\n');
              
              // Вычисляем диапазон строк для сохранения
              const startLine = Math.max(1, segment.start_line - 10);
              const endLine = Math.min(lines.length, segment.end_line + 10);
              
              content = lines.slice(startLine - 1, endLine).join('\n');
              
              // Добавляем комментарий о том, что файл был обрезан
              content = `// Файл был обрезан. Показаны строки ${startLine}-${endLine} из общего количества ${lines.length}\n\n${content}`;
            } else {
              // Если нет информации о релевантном сегменте, берем начало файла
              content = content.substring(0, this.maxFileSize) + '\n// ... [файл обрезан] ...';
            }
          }
          
          file.content = content;
        } catch (error) {
          logger.error(`Ошибка при чтении файла ${file.file_path}:`, error);
          file.content = `// Ошибка чтения файла: ${error.message}`;
        }
      }
      
      return relevantFiles;
    } catch (error) {
      logger.error('Ошибка при поиске релевантных файлов:', error);
      return [];
    }
  }

  /**
   * Получает упрощенную схему базы данных для включения в промпт
   * @returns {Promise<string>} - Строка с описанием структуры БД
   */
  async getDBSchemaDescription() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем таблицы из нашей модели БД
      const [tables] = await connection.query(
        'SELECT name, structure FROM schema_tables'
      );
      
      // Получаем отношения из нашей модели БД
      const [relations] = await connection.query(
        'SELECT source_table, source_column, target_table, target_column FROM schema_relations'
      );
      
      connection.release();
      
      if (tables.length === 0) {
        return 'Информация о структуре базы данных отсутствует.';
      }
      
      // Формируем упрощенное описание структуры
      let description = 'Основные таблицы и их структура:\n\n';
      
      tables.forEach(table => {
        const structure = JSON.parse(table.structure);
        
        description += `### Таблица: ${table.name}\n`;
        
        // Добавляем основные колонки
        description += 'Колонки:\n';
        structure.columns.forEach(column => {
          const nullable = column.nullable ? 'NULL' : 'NOT NULL';
          description += `- ${column.name}: ${column.type} ${nullable}\n`;
        });
        
        // Добавляем ключевые индексы
        if (structure.indexes && structure.indexes.length > 0) {
          description += '\nКлючевые индексы:\n';
          structure.indexes.forEach(index => {
            const unique = index.unique ? 'UNIQUE ' : '';
            const columns = index.columns.map(col => col.name).join(', ');
            description += `- ${unique}${index.name}: (${columns})\n`;
          });
        }
        
        description += '\n';
      });
      
      // Добавляем описание связей
      if (relations.length > 0) {
        description += 'Связи между таблицами:\n\n';
        
        relations.forEach(relation => {
          description += `- ${relation.source_table}.${relation.source_column} -> ${relation.target_table}.${relation.target_column}\n`;
        });
      }
      
      return description;
    } catch (error) {
      logger.error('Ошибка при получении описания схемы БД:', error);
      return 'Не удалось получить информацию о структуре базы данных.';
    }
  }

  /**
   * Получает информацию об архитектуре проекта
   * @returns {Promise<string>} - Строка с описанием архитектуры
   */
  async getArchitectureDescription() {
    // В будущем здесь может быть сложная логика анализа архитектуры
    // Сейчас просто возвращаем базовое описание
    return `
Проект следует многослойной архитектуре:

1. Controllers - обрабатывают HTTP запросы и отвечают за маршрутизацию
2. Services - содержат бизнес-логику
3. Models - представляют сущности и взаимодействуют с базой данных
4. Utilities - вспомогательные функции и модули

В проекте используется Express.js для API, MySQL для хранения данных,
и JWT для аутентификации пользователей.

Основные принципы:
- Разделение ответственности между слоями
- Централизованная обработка ошибок
- Асинхронная обработка запросов с использованием async/await
    `;
  }

  /**
   * Получает описание стиля кода проекта
   * @returns {Promise<string>} - Строка с описанием стиля кода
   */
  async getCodeStyleDescription() {
    // В будущем можно анализировать стиль кода проекта
    // Сейчас возвращаем стандартное описание
    return `
Следуй этим правилам стиля:

1. Используй асинхронные функции (async/await) вместо колбэков
2. Используй деструктуризацию для параметров и импортов
3. Используй template strings для сложных строк
4. Документируй функции с использованием JSDoc
5. Избегай magic numbers и strings, используй константы
6. Обрабатывай ошибки через try/catch и логирование
7. Используй camelCase для переменных и функций
8. Используй PascalCase для классов
9. Индентация - 2 пробела
    `;
  }

  /**
   * Создает промпт для генерации кода
   * @param {Object} task - Информация о задаче
   * @returns {Promise<string>} - Готовый промпт для отправки в LLM
   */
  async createCodeGenerationPrompt(task) {
    try {
      // Получаем информацию о проекте
      const projectInfo = await this.getProjectInfo();
      
      // Находим релевантные файлы
      const relevantFiles = await this.findRelevantFiles(task.id, task.description);
      
      // Получаем описание схемы БД
      const dbSchema = await this.getDBSchemaDescription();
      
      // Получаем описание архитектуры
      const architectureNotes = await this.getArchitectureDescription();
      
      // Получаем описание стиля кода
      const codeStyle = await this.getCodeStyleDescription();
      
      // Формируем контекст проекта
      const projectContext = `
Проект: ${projectInfo.name}
Описание: ${projectInfo.description}
      `;
      
      // Формируем блок с релевантными файлами
      let relevantFilesText = '';
      
      if (relevantFiles.length > 0) {
        relevantFilesText = 'Вот наиболее релевантные файлы для этой задачи:\n\n';
        
        relevantFiles.forEach(file => {
          relevantFilesText += `### Файл: ${file.file_path}\n\n`;
          relevantFilesText += '```javascript\n';
          relevantFilesText += file.content;
          relevantFilesText += '\n```\n\n';
        });
      } else {
        relevantFilesText = 'Релевантные файлы не найдены. Это может быть новый компонент.';
      }
      
      // Определяем тип файла
      let fileType = 'JavaScript';
      if (task.title.toLowerCase().includes('модель')) {
        fileType = 'модель (Model)';
      } else if (task.title.toLowerCase().includes('контроллер')) {
        fileType = 'контроллер (Controller)';
      } else if (task.title.toLowerCase().includes('сервис')) {
        fileType = 'сервис (Service)';
      } else if (task.title.toLowerCase().includes('маршрут') || task.title.toLowerCase().includes('route')) {
        fileType = 'маршрут (Route)';
      } else if (task.title.toLowerCase().includes('middleware')) {
        fileType = 'middleware';
      }
      
      // Заполняем шаблон
      let prompt = this.templates.codeGeneration
        .replace('{taskDescription}', task.description)
        .replace('{projectContext}', projectContext)
        .replace('{relevantFiles}', relevantFilesText)
        .replace('{dbSchema}', dbSchema)
        .replace('{architectureNotes}', architectureNotes)
        .replace('{codeStyle}', codeStyle)
        .replace('{fileType}', fileType);
      
      // Логируем промпт для отладки
      logger.debug('Создан промпт для генерации кода:', { taskId: task.id, promptLength: prompt.length });
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта:', error);
      throw error;
    }
  }

  /**
   * Создает промпт для рефакторинга кода
   * @param {Object} task - Информация о задаче
   * @param {string} originalCode - Исходный код для рефакторинга
   * @param {string} codeIssues - Описание проблем в коде
   * @returns {Promise<string>} - Готовый промпт для отправки в LLM
   */
  async createRefactoringPrompt(task, originalCode, codeIssues) {
    try {
      // Получаем информацию о проекте
      const projectInfo = await this.getProjectInfo();
      
      // Находим релевантные файлы
      const relevantFiles = await this.findRelevantFiles(task.id, task.description);
      
      // Формируем контекст проекта
      const projectContext = `
Проект: ${projectInfo.name}
Описание: ${projectInfo.description}
      `;
      
      // Формируем блок с релевантными файлами
      let relevantFilesText = '';
      
      if (relevantFiles.length > 0) {
        relevantFilesText = 'Вот наиболее релевантные файлы для этой задачи:\n\n';
        
        relevantFiles.forEach(file => {
          relevantFilesText += `### Файл: ${file.file_path}\n\n`;
          relevantFilesText += '```javascript\n';
          relevantFilesText += file.content;
          relevantFilesText += '\n```\n\n';
        });
      } else {
        relevantFilesText = 'Релевантные файлы не найдены.';
      }
      
      // Заполняем шаблон
      let prompt = this.templates.codeRefactoring
        .replace('{originalCode}', originalCode)
        .replace('{codeIssues}', codeIssues)
        .replace('{projectContext}', projectContext)
        .replace('{relevantFiles}', relevantFilesText);
      
      // Логируем промпт для отладки
      logger.debug('Создан промпт для рефакторинга кода:', { taskId: task.id, promptLength: prompt.length });
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для рефакторинга:', error);
      throw error;
    }
  }

  /**
   * Создает промпт для исправления ошибки
   * @param {Object} task - Информация о задаче
   * @param {string} buggyCode - Код с ошибкой
   * @param {string} bugDescription - Описание ошибки
   * @param {string} logs - Логи и трассировка ошибки
   * @returns {Promise<string>} - Готовый промпт для отправки в LLM
   */
  async createBugFixPrompt(task, buggyCode, bugDescription, logs) {
    try {
      // Находим релевантные файлы
      const relevantFiles = await this.findRelevantFiles(task.id, task.description);
      
      // Формируем блок с релевантными файлами
      let relevantFilesText = '';
      
      if (relevantFiles.length > 0) {
        relevantFilesText = 'Вот наиболее релевантные файлы для этой ошибки:\n\n';
        
        relevantFiles.forEach(file => {
          relevantFilesText += `### Файл: ${file.file_path}\n\n`;
          relevantFilesText += '```javascript\n';
          relevantFilesText += file.content;
          relevantFilesText += '\n```\n\n';
        });
      } else {
        relevantFilesText = 'Релевантные файлы не найдены.';
      }
      
      // Заполняем шаблон
      let prompt = this.templates.bugFix
        .replace('{buggyCode}', buggyCode)
        .replace('{bugDescription}', bugDescription)
        .replace('{logs}', logs || 'Логи отсутствуют.')
        .replace('{relevantFiles}', relevantFilesText);
      
      // Логируем промпт для отладки
      logger.debug('Создан промпт для исправления ошибки:', { taskId: task.id, promptLength: prompt.length });
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для исправления ошибки:', error);
      throw error;
    }
  }
}

module.exports = PromptBuilder;
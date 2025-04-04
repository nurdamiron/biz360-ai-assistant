// src/core/learning-system/index.js

const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const fs = require('fs').promises;
const path = require('path');

/**
 * Система обучения и улучшения ИИ-ассистента на основе обратной связи
 * Анализирует успешные и неуспешные генерации кода, выявляет паттерны
 * и адаптирует стратегии для повышения качества будущих генераций
 */
class LearningSystem {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.promptTemplatesDir = path.join(__dirname, '../../templates/prompts');
    this.feedbackHistory = [];
    this.successPatterns = new Map();
    this.failurePatterns = new Map();
  }

  /**
   * Инициализирует систему обучения, загружая историю обратной связи
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info(`Инициализация системы обучения для проекта #${this.projectId}`);
      
      // Загружаем историю обратной связи из БД
      await this.loadFeedbackHistory();
      
      // Создаем директории для шаблонов, если они не существуют
      await fs.mkdir(this.promptTemplatesDir, { recursive: true });
      
      // Анализируем историю для выявления паттернов
      await this.analyzeFeedbackHistory();
      
      logger.info(`Система обучения инициализирована. Загружено ${this.feedbackHistory.length} записей обратной связи`);
    } catch (error) {
      logger.error(`Ошибка при инициализации системы обучения:`, error);
      throw error;
    }
  }

  /**
   * Загружает историю обратной связи из БД
   * @returns {Promise<void>}
   */
  async loadFeedbackHistory() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем информацию о всех задачах проекта
      const [tasks] = await connection.query(
        'SELECT id FROM tasks WHERE project_id = ?',
        [this.projectId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return;
      }
      
      // Извлекаем все ID задач
      const taskIds = tasks.map(task => task.id);
      
      // Получаем информацию обо всех генерациях кода для этих задач
      const [generations] = await connection.query(
        `SELECT cg.id, cg.task_id, cg.file_path, cg.status, cg.generated_content, cg.original_content 
         FROM code_generations cg
         WHERE cg.task_id IN (?)`,
        [taskIds]
      );
      
      // Получаем обратную связь для этих генераций
      const [feedback] = await connection.query(
        `SELECT f.id, f.code_generation_id, f.feedback_text, f.rating
         FROM feedback f
         WHERE f.code_generation_id IN (?)`,
        [generations.map(gen => gen.id)]
      );
      
      // Получаем информацию о коммитах
      const [commits] = await connection.query(
        `SELECT c.id, c.task_id, c.commit_hash, c.commit_message
         FROM commits c
         WHERE c.task_id IN (?)`,
        [taskIds]
      );
      
      connection.release();
      
      // Соединяем данные в единую структуру
      this.feedbackHistory = generations.map(gen => {
        const genFeedback = feedback.filter(f => f.code_generation_id === gen.id);
        const genCommits = commits.filter(c => c.task_id === gen.task_id);
        
        return {
          generationId: gen.id,
          taskId: gen.task_id,
          filePath: gen.file_path,
          status: gen.status,
          wasSuccessful: gen.status === 'approved' || gen.status === 'implemented',
          feedback: genFeedback.map(f => ({
            id: f.id,
            text: f.feedback_text,
            rating: f.rating
          })),
          commits: genCommits.map(c => ({
            id: c.id,
            hash: c.commit_hash,
            message: c.commit_message
          })),
          generatedContent: gen.generated_content,
          originalContent: gen.original_content
        };
      });
      
    } catch (error) {
      logger.error(`Ошибка при загрузке истории обратной связи:`, error);
      throw error;
    }
  }

  /**
   * Анализирует историю обратной связи для выявления паттернов
   * @returns {Promise<void>}
   */
  async analyzeFeedbackHistory() {
    try {
      if (this.feedbackHistory.length < 5) {
        logger.info('Недостаточно данных для выявления паттернов (нужно минимум 5 записей)');
        return;
      }
      
      // Разделяем на успешные и неуспешные генерации
      const successfulGenerations = this.feedbackHistory.filter(item => item.wasSuccessful);
      const failedGenerations = this.feedbackHistory.filter(item => !item.wasSuccessful);
      
      logger.debug(`Анализ ${successfulGenerations.length} успешных и ${failedGenerations.length} неуспешных генераций`);
      
      // Если достаточно данных, анализируем с помощью LLM
      if (successfulGenerations.length >= 3) {
        await this.analyzeSuccessfulPatterns(successfulGenerations);
      }
      
      if (failedGenerations.length >= 3) {
        await this.analyzeFailurePatterns(failedGenerations);
      }
    } catch (error) {
      logger.error(`Ошибка при анализе истории обратной связи:`, error);
    }
  }

  /**
   * Анализирует успешные генерации кода для выявления паттернов
   * @param {Array} successfulGenerations - Список успешных генераций
   * @returns {Promise<void>}
   */
  async analyzeSuccessfulPatterns(successfulGenerations) {
    try {
      // Выбираем несколько наиболее успешных генераций (с высоким рейтингом)
      const topGenerations = [...successfulGenerations]
        .sort((a, b) => {
          const aRating = a.feedback.length > 0 ? 
            a.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / a.feedback.length : 0;
          const bRating = b.feedback.length > 0 ? 
            b.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / b.feedback.length : 0;
          return bRating - aRating;
        })
        .slice(0, 5);
      
      // Создаем промпт для анализа успешных шаблонов
      const examples = topGenerations.map(gen => {
        return `
Файл: ${gen.filePath}
Код:
\`\`\`javascript
${gen.generatedContent.substring(0, 1500)}${gen.generatedContent.length > 1500 ? '...' : ''}
\`\`\`

Обратная связь:
${gen.feedback.map(f => f.text).join('\n')}
`;
      }).join('\n-----\n');
      
      const prompt = `
Проанализируй эти успешные примеры генерации кода для проекта Biz360 CRM.
Определи общие характеристики и паттерны, которые делают этот код успешным:

${examples}

Выдели:
1. Стилистические паттерны (форматирование, именование переменных)
2. Архитектурные подходы (структура кода, разделение ответственности)
3. Типичные библиотеки и функции
4. Подходы к обработке ошибок и асинхронности
5. Другие заметные паттерны

Представь результат в виде списка конкретных рекомендаций, которые можно использовать для будущих генераций.
`;
      
      // Отправляем запрос к LLM для анализа
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для более аналитических ответов
      });
      
      // Обрабатываем ответ и сохраняем выявленные паттерны
      this.parseAndStorePatternsFromResponse(response, this.successPatterns);
      
      // Сохраняем улучшенные шаблоны промптов
      await this.updatePromptTemplates();
      
      logger.info(`Успешно проанализированы паттерны из ${topGenerations.length} успешных генераций`);
    } catch (error) {
      logger.error(`Ошибка при анализе успешных паттернов:`, error);
    }
  }

  /**
   * Анализирует неуспешные генерации кода для выявления проблем
   * @param {Array} failedGenerations - Список неуспешных генераций
   * @returns {Promise<void>}
   */
  async analyzeFailurePatterns(failedGenerations) {
    try {
      // Выбираем несколько наиболее проблемных генераций
      const worstGenerations = [...failedGenerations]
        .sort((a, b) => {
          const aRating = a.feedback.length > 0 ? 
            a.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / a.feedback.length : 0;
          const bRating = b.feedback.length > 0 ? 
            b.feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / b.feedback.length : 0;
          return aRating - bRating;
        })
        .slice(0, 5);
      
      // Создаем промпт для анализа проблемных шаблонов
      const examples = worstGenerations.map(gen => {
        return `
Файл: ${gen.filePath}
Код:
\`\`\`javascript
${gen.generatedContent.substring(0, 1500)}${gen.generatedContent.length > 1500 ? '...' : ''}
\`\`\`

Обратная связь:
${gen.feedback.map(f => f.text).join('\n')}
`;
      }).join('\n-----\n');
      
      const prompt = `
Проанализируй эти неудачные примеры генерации кода для проекта Biz360 CRM.
Определи общие проблемы и антипаттерны, которые привели к отклонению кода:

${examples}

Выдели:
1. Распространенные ошибки в стиле и форматировании
2. Архитектурные проблемы (неправильная структура, нарушение принципов)
3. Проблемы с библиотеками и функциями
4. Недостатки в обработке ошибок и асинхронных операциях
5. Другие заметные проблемы

Представь результат в виде списка конкретных антипаттернов, которых следует избегать в будущих генерациях.
`;
      
      // Отправляем запрос к LLM для анализа
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для более аналитических ответов
      });
      
      // Обрабатываем ответ и сохраняем выявленные антипаттерны
      this.parseAndStorePatternsFromResponse(response, this.failurePatterns);
      
      // Сохраняем улучшенные шаблоны промптов с учетом выявленных проблем
      await this.updatePromptTemplates();
      
      logger.info(`Успешно проанализированы проблемы из ${worstGenerations.length} неудачных генераций`);
    } catch (error) {
      logger.error(`Ошибка при анализе проблемных паттернов:`, error);
    }
  }

  /**
   * Извлекает паттерны из ответа LLM и сохраняет их
   * @param {string} response - Ответ от LLM
   * @param {Map} patternsMap - Карта для сохранения паттернов
   */
  parseAndStorePatternsFromResponse(response, patternsMap) {
    try {
      // Разбиваем ответ на строки
      const lines = response.split('\n');
      
      // Ищем паттерны в формате списков и подзаголовков
      let currentCategory = 'general';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Определяем категорию (заголовок)
        if (trimmedLine.match(/^#+\s+/) || trimmedLine.match(/^[A-Z][\w\s]+:/)) {
          currentCategory = trimmedLine.replace(/^#+\s+/, '').replace(/:$/, '').toLowerCase();
          continue;
        }
        
        // Ищем элементы списка
        const listItemMatch = trimmedLine.match(/^[-*•]\s+(.+)$/) || 
                              trimmedLine.match(/^\d+\.\s+(.+)$/);
        
        if (listItemMatch) {
          const pattern = listItemMatch[1].trim();
          
          // Добавляем в соответствующую категорию
          if (!patternsMap.has(currentCategory)) {
            patternsMap.set(currentCategory, []);
          }
          
          patternsMap.get(currentCategory).push(pattern);
        }
      }
    } catch (error) {
      logger.error(`Ошибка при обработке ответа с паттернами:`, error);
    }
  }

  /**
   * Обновляет шаблоны промптов на основе выявленных паттернов
   * @returns {Promise<void>}
   */
  async updatePromptTemplates() {
    try {
      // Создаем улучшенные шаблоны для разных типов задач
      const templates = {
        'code-generation': this.createCodeGenerationTemplate(),
        'code-refactoring': this.createRefactoringTemplate(),
        'bug-fix': this.createBugFixTemplate()
      };
      
      // Сохраняем шаблоны в файлы
      for (const [name, content] of Object.entries(templates)) {
        const filePath = path.join(this.promptTemplatesDir, `${name}.txt`);
        await fs.writeFile(filePath, content);
        logger.debug(`Обновлен шаблон промпта: ${name}`);
      }
      
      logger.info('Шаблоны промптов обновлены на основе выявленных паттернов');
    } catch (error) {
      logger.error(`Ошибка при обновлении шаблонов промптов:`, error);
    }
  }

  /**
   * Создает улучшенный шаблон для генерации кода
   * @returns {string} - Шаблон промпта
   */
  createCodeGenerationTemplate() {
    // Добавляем успешные паттерны в шаблон
    let styleGuidelines = '';
    let bestPractices = '';
    
    if (this.successPatterns.has('стилистические паттерны')) {
      styleGuidelines = this.successPatterns.get('стилистические паттерны')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    }
    
    if (this.successPatterns.has('архитектурные подходы')) {
      bestPractices = this.successPatterns.get('архитектурные подходы')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    }
    
    // Добавляем антипаттерны в качестве предупреждений
    let warnings = '';
    
    if (this.failurePatterns.has('распространенные ошибки')) {
      warnings = this.failurePatterns.get('распространенные ошибки')
        .map(pattern => `- Избегай: ${pattern}`)
        .join('\n');
    }
    
    return `
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
Следуй этим правилам стиля и лучшим практикам:

${styleGuidelines || `
- Используй асинхронные функции (async/await) вместо колбэков
- Используй деструктуризацию для параметров и импортов
- Используй template strings для сложных строк
- Документируй функции с использованием JSDoc
- Избегай magic numbers и strings, используй константы
- Обрабатывай ошибки через try/catch и логирование`}

## Архитектурные практики
${bestPractices || `
- Разделяй код на логические модули с четкой ответственностью
- Используй инъекцию зависимостей для упрощения тестирования
- Применяй принципы SOLID, особенно Single Responsibility
- Предпочитай композицию наследованию`}

## Предупреждения - чего избегать
${warnings || `
- Избегай глубокой вложенности условий и циклов
- Не используй синхронные блокирующие операции
- Не смешивай бизнес-логику с обработкой HTTP-запросов
- Не оставляй закомментированный код`}

## Задание
Напиши {fileType} код для реализации указанных требований. 
Твой код должен следовать стилю проекта и интегрироваться с существующей архитектурой.
Код должен быть полным, рабочим и хорошо структурированным.
Используй наилучшие практики программирования, обрабатывай ошибки и документируй код.
`;
  }

  /**
   * Создает улучшенный шаблон для рефакторинга кода
   * @returns {string} - Шаблон промпта
   */
  createRefactoringTemplate() {
    // Добавляем паттерны рефакторинга
    let refactoringPrinciples = '';
    
    if (this.successPatterns.has('архитектурные подходы')) {
      refactoringPrinciples = this.successPatterns.get('архитектурные подходы')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    }
    
    return `
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

## Принципы рефакторинга
${refactoringPrinciples || `
- Упрощай сложные функции путем декомпозиции
- Улучшай читаемость кода ясными именами и комментариями
- Устраняй дублирование кода через абстракции
- Оптимизируй производительность критичных участков
- Повышай надежность добавлением обработки ошибок`}

## Задание
Выполни рефакторинг данного кода, устранив указанные проблемы и улучшив его качество.
Сохрани текущую функциональность, но сделай код более читаемым, эффективным и поддерживаемым.
Следуй принципам SOLID, DRY и другим лучшим практикам.
`;
  }

  /**
   * Создает улучшенный шаблон для исправления ошибок
   * @returns {string} - Шаблон промпта
   */
  createBugFixTemplate() {
    // Добавляем паттерны отладки и исправления ошибок
    let debuggingPrinciples = '';
    
    if (this.successPatterns.has('обработка ошибок')) {
      debuggingPrinciples = this.successPatterns.get('обработка ошибок')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    }
    
    return `
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

## Принципы отладки и исправления
${debuggingPrinciples || `
- Сначала диагностируй главную причину ошибки
- Предложи минимально инвазивное решение
- Добавь проверки для предотвращения подобных ошибок
- Оптимизируй обработку исключительных ситуаций
- Документируй неочевидные решения комментариями`}

## Задание
Проанализируй ошибку и предложи исправление.
Опиши, в чём причина ошибки и почему твое решение ее устраняет.
Предоставь полную версию исправленного кода.
`;
  }

  /**
   * Обрабатывает новую обратную связь и обновляет модель
   * @param {number} generationId - ID генерации кода
   * @param {string} feedbackText - Текст обратной связи
   * @param {number} rating - Оценка (1-5)
   * @returns {Promise<void>}
   */
  async processFeedback(generationId, feedbackText, rating) {
    try {
      logger.info(`Обработка новой обратной связи для генерации #${generationId}`);
      
      // Сохраняем обратную связь в историю
      const connection = await pool.getConnection();
      
      // Получаем информацию о генерации
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        connection.release();
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Добавляем запись в БД
      await connection.query(
        'INSERT INTO feedback (code_generation_id, feedback_text, rating) VALUES (?, ?, ?)',
        [generationId, feedbackText, rating]
      );
      
      connection.release();
      
      // Добавляем в локальную историю
      this.feedbackHistory.push({
        generationId,
        taskId: generation.task_id,
        filePath: generation.file_path,
        status: generation.status,
        wasSuccessful: generation.status === 'approved' || generation.status === 'implemented',
        feedback: [{
          text: feedbackText,
          rating
        }],
        commits: [],
        generatedContent: generation.generated_content,
        originalContent: generation.original_content
      });
      
      // Если накопилось достаточно новой обратной связи, выполняем анализ
      if (this.feedbackHistory.length % 5 === 0) {
        await this.analyzeFeedbackHistory();
      }
      
      logger.info(`Обратная связь для генерации #${generationId} успешно обработана`);
    } catch (error) {
      logger.error(`Ошибка при обработке обратной связи:`, error);
      throw error;
    }
  }

  /**
   * Анализирует проблемную генерацию кода и дает рекомендации по улучшению
   * @param {number} generationId - ID проблемной генерации
   * @returns {Promise<Object>} - Анализ и рекомендации
   */
  async analyzeFailedGeneration(generationId) {
    try {
      logger.info(`Анализ неудачной генерации #${generationId}`);
      
      // Получаем информацию о генерации
      const connection = await pool.getConnection();
      
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        connection.release();
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Получаем обратную связь
      const [feedback] = await connection.query(
        'SELECT * FROM feedback WHERE code_generation_id = ?',
        [generationId]
      );
      
      connection.release();
      
      // Создаем промпт для анализа проблемы
      const prompt = `
Проанализируй эту неудачную генерацию кода и определи проблемы:

Файл: ${generation.file_path}

Сгенерированный код:
\`\`\`javascript
${generation.generated_content}
\`\`\`

Обратная связь от разработчиков:
${feedback.map(f => f.feedback_text).join('\n\n')}

Выполни глубокий анализ:
1. Основные проблемы кода
2. Почему эти проблемы возникли
3. Как их можно было предотвратить
4. Конкретные рекомендации для улучшения подобных генераций в будущем

Дай подробный ответ с конкретными примерами.
`;
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3
      });
      
      logger.info(`Анализ неудачной генерации #${generationId} выполнен`);
      
      return {
        generationId,
        filePath: generation.file_path,
        analysis: response
      };
    } catch (error) {
      logger.error(`Ошибка при анализе неудачной генерации:`, error);
      throw error;
    }
  }

  /**
   * Предоставляет индивидуальные рекомендации для конкретной задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Рекомендации для задачи
   */
  async getRecommendationsForTask(taskId) {
    try {
      logger.info(`Получение рекомендаций для задачи #${taskId}`);
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Получаем похожие задачи на основе описания
      const [similarTasks] = await connection.query(
        `SELECT t.id, t.title, t.description, t.status 
         FROM tasks t
         WHERE t.project_id = ? AND t.id != ? AND t.status = 'completed'
         LIMIT 10`,
        [task.project_id, taskId]
      );
      
      connection.release();
      
      // Если нет похожих задач, возвращаем общие рекомендации
      if (similarTasks.length === 0) {
        return {
          taskId,
          recommendations: this.getGeneralRecommendations()
        };
      }
      
      // Создаем промпт для получения рекомендаций
      const prompt = `
Ты помогаешь генерировать код для проекта Biz360 CRM. Дай рекомендации для реализации этой задачи:

Задача:
Название: ${task.title}
Описание: ${task.description}

Похожие завершенные задачи в проекте:
${similarTasks.map(t => `- ${t.title}: ${t.description.substring(0, 200)}...`).join('\n')}

На основе сходства с предыдущими задачами и лучших практик проекта, дай рекомендации по:
1. Архитектурному подходу (какие компоненты создать/изменить)
2. Основным технологиям и библиотекам для использования
3. Потенциальным сложностям и как их избежать
4. Тестированию реализации

Предоставь конкретные, практические рекомендации.
`;
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.7 // Выше температура для креативных рекомендаций
      });
      
      logger.info(`Рекомендации для задачи #${taskId} получены`);
      
      return {
        taskId,
        recommendations: response
      };
    } catch (error) {
      logger.error(`Ошибка при получении рекомендаций для задачи:`, error);
      // Возвращаем общие рекомендации в случае ошибки
      return {
        taskId,
        recommendations: this.getGeneralRecommendations()
      };
    }
  }

  /**
   * Предоставляет общие рекомендации на основе накопленных паттернов
   * @returns {string} - Общие рекомендации
   */
  getGeneralRecommendations() {
    // Собираем все успешные паттерны в единый список рекомендаций
    let recommendations = "# Общие рекомендации для разработки\n\n";
    
    // Добавляем рекомендации по стилю
    recommendations += "## Стиль кода\n";
    if (this.successPatterns.has('стилистические паттерны')) {
      recommendations += this.successPatterns.get('стилистические паттерны')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    } else {
      recommendations += `
- Используй асинхронные функции (async/await) вместо колбэков
- Используй деструктуризацию для параметров и импортов
- Используй template strings для сложных строк
- Документируй функции с использованием JSDoc
- Следуй camelCase для переменных и функций, PascalCase для классов
`;
    }
    
    // Добавляем рекомендации по архитектуре
    recommendations += "\n\n## Архитектурный подход\n";
    if (this.successPatterns.has('архитектурные подходы')) {
      recommendations += this.successPatterns.get('архитектурные подходы')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    } else {
      recommendations += `
- Разделяй код на логические модули с четкой ответственностью
- Используй инъекцию зависимостей для упрощения тестирования
- Применяй принципы SOLID, особенно Single Responsibility
- Предпочитай композицию наследованию
`;
    }
    
    // Добавляем рекомендации по обработке ошибок
    recommendations += "\n\n## Обработка ошибок\n";
    if (this.successPatterns.has('обработка ошибок')) {
      recommendations += this.successPatterns.get('обработка ошибок')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    } else {
      recommendations += `
- Используй try/catch для обработки исключений в асинхронном коде
- Логируй подробную информацию об ошибках
- Возвращай стандартизированные ответы с ошибками для API
- Используй централизованный обработчик ошибок для Express
`;
    }
    
    // Добавляем предупреждения о типичных проблемах
    recommendations += "\n\n## Чего следует избегать\n";
    if (this.failurePatterns.has('распространенные ошибки')) {
      recommendations += this.failurePatterns.get('распространенные ошибки')
        .map(pattern => `- ${pattern}`)
        .join('\n');
    } else {
      recommendations += `
- Избегай глубокой вложенности условий и циклов
- Не используй синхронные блокирующие операции
- Не смешивай бизнес-логику с обработкой HTTP-запросов
- Не оставляй закомментированный код
`;
    }
    
    return recommendations;
  }

  /**
   * Создает отчет о производительности системы
   * @param {string} timeframe - Временной период ('day', 'week', 'month')
   * @returns {Promise<Object>} - Отчет о производительности
   */
  async generatePerformanceReport(timeframe = 'week') {
    try {
      logger.info(`Создание отчета о производительности за ${timeframe}`);
      
      // Определяем временные рамки
      const now = new Date();
      let startDate = new Date();
      
      switch (timeframe) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7); // По умолчанию неделя
      }
      
      const connection = await pool.getConnection();
      
      // Получаем статистику по задачам
      const [taskStats] = await connection.query(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
         FROM tasks
         WHERE project_id = ? AND created_at >= ?`,
        [this.projectId, startDate]
      );
      
      // Получаем статистику по генерациям кода
      const [codeStats] = await connection.query(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN status = 'approved' OR status = 'implemented' THEN 1 ELSE 0 END) as approved,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
         FROM code_generations cg
         JOIN tasks t ON cg.task_id = t.id
         WHERE t.project_id = ? AND cg.created_at >= ?`,
        [this.projectId, startDate]
      );
      
      // Получаем среднюю оценку обратной связи
      const [feedbackStats] = await connection.query(
        `SELECT AVG(f.rating) as avg_rating
         FROM feedback f
         JOIN code_generations cg ON f.code_generation_id = cg.id
         JOIN tasks t ON cg.task_id = t.id
         WHERE t.project_id = ? AND f.created_at >= ?`,
        [this.projectId, startDate]
      );
      
      connection.release();
      
      // Формируем отчет
      const report = {
        timeframe,
        period: {
          start: startDate,
          end: now
        },
        tasks: {
          total: taskStats[0].total,
          completed: taskStats[0].completed,
          failed: taskStats[0].failed,
          completion_rate: taskStats[0].total > 0 ? 
            (taskStats[0].completed / taskStats[0].total * 100).toFixed(2) + '%' : '0%'
        },
        code_generations: {
          total: codeStats[0].total,
          approved: codeStats[0].approved,
          rejected: codeStats[0].rejected,
          approval_rate: codeStats[0].total > 0 ? 
            (codeStats[0].approved / codeStats[0].total * 100).toFixed(2) + '%' : '0%'
        },
        feedback: {
          average_rating: feedbackStats[0].avg_rating ? 
            parseFloat(feedbackStats[0].avg_rating).toFixed(2) : 'Нет данных'
        },
        token_usage: this.llmClient.getTokenUsageStats()
      };
      
      logger.info(`Отчет о производительности за ${timeframe} создан`);
      
      return report;
    } catch (error) {
      logger.error(`Ошибка при создании отчета о производительности:`, error);
      throw error;
    }
  }
}

module.exports = LearningSystem;
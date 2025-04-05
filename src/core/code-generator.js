// src/core/code-generator.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');
const { getLLMClient } = require('../utils/llm-client');
const codeValidator = require('../utils/code-validator');
const taskLogger = require('../utils/task-logger');

/**
 * Класс для генерации кода с помощью LLM
 */
class CodeGenerator {
  /**
   * Конструктор класса
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.codeValidator = codeValidator;
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * Получает информацию о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Информация о задаче
   */
  async getTaskInfo(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [taskId, this.projectId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена или не относится к указанному проекту`);
      }
      
      return tasks[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о задаче:', error);
      throw error;
    }
  }

  /**
   * Генерирует код для задачи
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} [language] - Язык программирования (определяется автоматически, если не указан)
   * @returns {Promise<Object>} - Результат генерации
   */
  async generateCode(taskId, filePath, language = null) {
    try {
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Получаем подзадачи
      const [subtasks] = await (await pool.getConnection()).query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      // Получаем теги задачи
      const [taskTags] = await (await pool.getConnection()).query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      // Определяем язык по расширению файла, если не указан
      const detectedLanguage = language || this._detectLanguageFromFilePath(filePath);
      
      // Логируем начало генерации кода
      await taskLogger.logInfo(taskId, `Начата генерация кода для файла: ${filePath}`);
      
      // Создаем промпт для генерации кода
      const prompt = await this.promptBuilder.createCodeGenerationPrompt(
        task, 
        subtasks, 
        filePath, 
        detectedLanguage, 
        tags
      );
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Логируем взаимодействие с LLM
      await this.logLLMInteraction(taskId, prompt, response);
      
      // Извлекаем код из ответа
      const extractedCode = this.extractCodeFromResponse(response, detectedLanguage);
      
      if (!extractedCode.code) {
        await taskLogger.logError(taskId, 'Не удалось извлечь код из ответа LLM');
        throw new Error('Не удалось извлечь код из ответа LLM');
      }
      
      // Валидируем код
      const validationResult = await this.codeValidator.validate(
        extractedCode.code, 
        extractedCode.language
      );
      
      if (!validationResult.isValid) {
        logger.warn(`Сгенерированный код не прошел валидацию: ${validationResult.error}`);
        
        // Если код не прошел валидацию, пробуем исправить его
        const fixedCode = await this.fixInvalidCode(
          extractedCode.code, 
          validationResult.error
        );
        
        extractedCode.code = fixedCode;
      }
      
      // Сохраняем сгенерированный код
      const generationId = await this.saveGeneratedCode(
        taskId, 
        filePath, 
        extractedCode.code, 
        extractedCode.language
      );
      
      // Логируем успешную генерацию кода
      await taskLogger.logInfo(taskId, `Код успешно сгенерирован для файла: ${filePath}`);
      
      return {
        generationId,
        taskId,
        filePath,
        code: extractedCode.code,
        language: extractedCode.language,
        summary: extractedCode.summary
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Извлекает код из ответа LLM
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {Object} - Извлеченный код, язык и описание
   */
  extractCodeFromResponse(response, language) {
    try {
      // Определяем язык для поиска блока кода
      const lang = language || '';
      
      // Ищем блок кода в формате ```язык ... ```
      const codeBlockRegex = new RegExp(`\`\`\`(?:${lang})?\\s*([\\s\\S]*?)\\s*\`\`\``, 'i');
      const match = response.match(codeBlockRegex);
      
      if (match && match[1]) {
        // Ищем описание решения после блока кода
        const descriptionMatch = response.match(/Описание решения:([\s\S]*?)$/);
        
        return {
          code: match[1].trim(),
          language: language || this._detectLanguageFromCode(match[1]),
          summary: descriptionMatch ? descriptionMatch[1].trim() : null
        };
      }
      
      // Если блок кода не найден, возвращаем пустой объект
      return {
        code: null,
        language: language,
        summary: null
      };
    } catch (error) {
      logger.error('Ошибка при извлечении кода из ответа:', error);
      return {
        code: null,
        language: language,
        summary: null
      };
    }
  }

  /**
   * Исправляет невалидный код
   * @param {string} code - Невалидный код
   * @param {string} error - Сообщение об ошибке
   * @returns {Promise<string>} - Исправленный код
   */
  async fixInvalidCode(code, error) {
    try {
      // Создаем промпт для исправления кода
      const prompt = `
# Исправление ошибок в коде

## Код с ошибками
\`\`\`
${code}
\`\`\`

## Сообщение об ошибке
\`\`\`
${error}
\`\`\`

## Инструкции
1. Исправь ошибки в коде, основываясь на сообщении об ошибке.
2. Верни ТОЛЬКО исправленный код, без пояснений.
3. Код должен быть рабочим и готовым к использованию.

## Формат ответа
\`\`\`
// Исправленный код здесь
\`\`\`
`;
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)\s*```/;
      const match = response.match(codeBlockRegex);
      
      if (match && match[1]) {
        return match[1].trim();
      }
      
      // Если блок кода не найден, возвращаем исходный код
      return code;
    } catch (error) {
      logger.error('Ошибка при исправлении кода:', error);
      return code;
    }
  }

  /**
   * Сохраняет сгенерированный код в БД
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} code - Сгенерированный код
   * @param {string} language - Язык программирования
   * @returns {Promise<number>} - ID записи о генерации кода
   */
  async saveGeneratedCode(taskId, filePath, code, language) {
    const connection = await pool.getConnection();
    
    try {
      // Сохраняем сгенерированный код
      const [result] = await connection.query(
        `INSERT INTO code_generations 
         (task_id, file_path, language, generated_content, status, created_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [taskId, filePath, language, code, 'pending_review']
      );
      
      return result.insertId;
    } finally {
      connection.release();
    }
  }

  /**
   * Логирует взаимодействие с LLM
   * @param {number} taskId - ID задачи
   * @param {string} prompt - Отправленный промпт
   * @param {string} response - Полученный ответ
   * @returns {Promise<void>}
   */
  async logLLMInteraction(taskId, prompt, response) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        `INSERT INTO llm_interactions 
         (task_id, model_used, prompt, response, tokens_used, created_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          taskId,
          this.llmClient.modelName || 'unknown',
          prompt,
          response,
          this.llmClient.getLastTokenCount() || 0
        ]
      );
      
      connection.release();
    } catch (error) {
      logger.error('Ошибка при логировании взаимодействия с LLM:', error);
    }
  }

  /**
   * Определяет язык программирования по пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Язык программирования
   * @private
   */
  _detectLanguageFromFilePath(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    
    const extensionToLanguage = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'rs': 'rust',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sql': 'sql',
      'sh': 'bash'
    };
    
    return extensionToLanguage[extension] || extension;
  }

  /**
   * Определяет язык программирования по коду
   * @param {string} code - Код
   * @returns {string} - Язык программирования
   * @private
   */
  _detectLanguageFromCode(code) {
    // Простая эвристика для определения языка
    if (code.includes('function') && (code.includes(';') || code.includes('{'))) {
      return 'javascript';
    } else if (code.includes('def ') && code.includes(':')) {
      return 'python';
    } else if (code.includes('public class') || code.includes('private class')) {
      return 'java';
    } else if (code.includes('#include')) {
      return 'cpp';
    } else {
      return 'text';
    }
  }
}

/**
 * Класс для построения промптов
 */
class PromptBuilder {
  /**
   * Создает промпт для генерации кода
   * @param {Object} task - Задача
   * @param {Array<Object>} subtasks - Подзадачи
   * @param {string} filePath - Путь к файлу
   * @param {string} language - Язык программирования
   * @param {Array<string>} tags - Теги задачи
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createCodeGenerationPrompt(task, subtasks, filePath, language, tags) {
    // Создаем базовый промпт
    const prompt = `
# Задача генерации кода

## Контекст
Ты - опытный разработчик, который пишет высококачественный код.

## Файл
Путь: ${filePath}
Язык: ${language}

## Задача
Название: ${task.title}
Описание: ${task.description}

${subtasks.length > 0 ? `
## Подзадачи
${subtasks.map((subtask, index) => `${index + 1}. ${subtask.title}\n   ${subtask.description}`).join('\n\n')}
` : ''}

${tags.length > 0 ? `
## Теги
${tags.join(', ')}
` : ''}

## Инструкции
1. Напиши код для файла ${filePath} на языке ${language}.
2. Код должен быть полным, рабочим и готовым к использованию.
3. Не пропускай важные детали.
4. Включи только код без пояснений внутри кода.
5. Используй лучшие практики для выбранного языка.
6. Следуй стандартам форматирования, типичным для выбранного языка.

## Формат ответа
\`\`\`${language}
// Твой код здесь
\`\`\`

## Описание решения
После кода предоставь краткое описание, начинающееся с "Описание решения:", в котором объясни основные принципы и архитектурные решения.
`;
    
    return prompt;
  }
}

module.exports = CodeGenerator;
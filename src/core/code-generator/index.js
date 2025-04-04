// src/core/code-generator/index.js

const PromptBuilder = require('./prompt-builder');
const CodeValidator = require('./code-validator');
const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const path = require('path');
const fileUtils = require('../../utils/file-utils');

/**
 * Класс для генерации кода на основе задач
 */
class CodeGenerator {
  constructor(projectId) {
    this.projectId = projectId;
    this.promptBuilder = new PromptBuilder(projectId);
    this.codeValidator = new CodeValidator();
    this.llmClient = getLLMClient();
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
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      return tasks[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о задаче:', error);
      throw error;
    }
  }

  /**
   * Получает информацию о проекте
   * @returns {Promise<Object>} - Информация о проекте
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
   * Генерирует код для заданной задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат генерации кода
   */
  async generateCode(taskId) {
    try {
      logger.info(`Начинаем генерацию кода для задачи #${taskId}`);
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Обновляем статус задачи
      await this.updateTaskStatus(taskId, 'in_progress');
      
      // Создаем промпт для генерации кода
      const prompt = await this.promptBuilder.createCodeGenerationPrompt(task);
      
      // Отправляем промпт в LLM
      logger.info(`Отправляем запрос к LLM для задачи #${taskId}`);
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Логируем взаимодействие с LLM
      await this.logLLMInteraction(taskId, prompt, response);
      
      // Извлекаем код из ответа LLM
      const extractedCode = this.extractCodeFromResponse(response);
      
      if (!extractedCode.code) {
        throw new Error('Не удалось извлечь код из ответа LLM');
      }
      
      // Валидируем код
      const validationResult = await this.codeValidator.validate(extractedCode.code, extractedCode.language);
      
      if (!validationResult.isValid) {
        logger.warn(`Сгенерированный код не прошел валидацию: ${validationResult.error}`);
        
        // Если код не прошел валидацию, пробуем исправить его
        const fixedCode = await this.fixInvalidCode(extractedCode.code, validationResult.error);
        
        // Снова валидируем исправленный код
        const fixedValidationResult = await this.codeValidator.validate(fixedCode, extractedCode.language);
        
        if (!fixedValidationResult.isValid) {
          throw new Error(`Не удалось исправить сгенерированный код: ${fixedValidationResult.error}`);
        }
        
        extractedCode.code = fixedCode;
      }
      
      // Определяем путь к файлу на основе ответа или названия задачи
      const filePath = this.determineFilePath(task, extractedCode.fileName, extractedCode.language);
      
      // Сохраняем сгенерированный код в БД
      const generationId = await this.saveGeneratedCode(taskId, filePath, extractedCode.code);
      
      // Возвращаем результат
      return {
        taskId,
        generationId,
        filePath,
        code: extractedCode.code,
        language: extractedCode.language,
        summary: extractedCode.summary
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${taskId}:`, error);
      
      // Обновляем статус задачи на "failed"
      await this.updateTaskStatus(taskId, 'failed');
      
      throw error;
    }
  }

  /**
   * Обновляет статус задачи
   * @param {number} taskId - ID задачи
   * @param {string} status - Новый статус
   * @returns {Promise<void>}
   */
  async updateTaskStatus(taskId, status) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, taskId]
      );
      
      if (status === 'completed') {
        await connection.query(
          'UPDATE tasks SET completed_at = NOW() WHERE id = ?',
          [taskId]
        );
      }
      
      connection.release();
      
      logger.info(`Статус задачи #${taskId} обновлен на "${status}"`);
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Логирует взаимодействие с LLM
   * @param {number} taskId - ID задачи
   * @param {string} prompt - Отправленный промпт
   * @param {string} response - Полученный ответ
   * @returns {Promise<number>} - ID записи взаимодействия
   */
  async logLLMInteraction(taskId, prompt, response) {
    try {
      const connection = await pool.getConnection();
      
      const [result] = await connection.query(
        `INSERT INTO llm_interactions 
         (task_id, prompt, response, model_used, tokens_used) 
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, prompt, response, this.llmClient.model, 0]  // Токены пока не считаем
      );
      
      connection.release();
      
      logger.debug(`Взаимодействие с LLM для задачи #${taskId} сохранено`);
      
      return result.insertId;
    } catch (error) {
      logger.error(`Ошибка при логировании взаимодействия с LLM:`, error);
      return null;
    }
  }

  /**
   * Извлекает код из ответа LLM
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Извлеченный код и метаданные
   */
  extractCodeFromResponse(response) {
    try {
      // Поиск кода в блоках с обратными кавычками
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      const codeBlocks = [];
      
      let match;
      while ((match = codeBlockRegex.exec(response)) !== null) {
        codeBlocks.push({
          language: match[1].toLowerCase() || 'javascript',
          code: match[2]
        });
      }
      
      // Если нет блоков кода, возвращаем пустой результат
      if (codeBlocks.length === 0) {
        return {
          code: null,
          language: null,
          fileName: null,
          summary: response
        };
      }
      
      // Ищем название файла в ответе
      const fileNameRegex = /имя файла[:\s]+([^\n]+)/i;
      const fileNameMatch = response.match(fileNameRegex);
      
      let fileName = null;
      if (fileNameMatch) {
        fileName = fileNameMatch[1].trim();
      }
      
      // Пытаемся найти JavaScript/TypeScript код
      const jsBlock = codeBlocks.find(block => 
        ['javascript', 'js', 'typescript', 'ts'].includes(block.language)
      );
      
      // Если есть JS/TS код, возвращаем его
      if (jsBlock) {
        return {
          code: jsBlock.code,
          language: jsBlock.language.replace('javascript', 'js').replace('typescript', 'ts'),
          fileName,
          summary: this.extractSummary(response)
        };
      }
      
      // Иначе возвращаем первый блок кода
      return {
        code: codeBlocks[0].code,
        language: codeBlocks[0].language,
        fileName,
        summary: this.extractSummary(response)
      };
    } catch (error) {
      logger.error('Ошибка при извлечении кода из ответа LLM:', error);
      return {
        code: null,
        language: null,
        fileName: null,
        summary: response
      };
    }
  }

  /**
   * Извлекает краткое описание из ответа LLM
   * @param {string} response - Ответ от LLM
   * @returns {string} - Краткое описание
   */
  extractSummary(response) {
    try {
      // Удаляем блоки кода
      const withoutCode = response.replace(/```[\s\S]*?```/g, '');
      
      // Ищем первый параграф
      const firstParagraph = withoutCode.split('\n\n')[0].trim();
      
      // Если параграф слишком короткий, берем больше текста
      if (firstParagraph.length < 100) {
        const paragraphs = withoutCode.split('\n\n').filter(p => p.trim().length > 0);
        return paragraphs.slice(0, 2).join('\n\n').trim();
      }
      
      return firstParagraph;
    } catch (error) {
      return 'Не удалось извлечь краткое описание.';
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
      logger.info('Пытаемся исправить невалидный код');
      
      const prompt = `
Исправь ошибки в следующем JavaScript коде. При исправлении сохрани исходную функциональность.

Код:
\`\`\`javascript
${code}
\`\`\`

Ошибка:
${error}

Выдай только исправленный код без объяснений.
`;
      
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const extractedCode = this.extractCodeFromResponse(response);
      
      if (!extractedCode.code) {
        throw new Error('Не удалось извлечь исправленный код из ответа LLM');
      }
      
      return extractedCode.code;
    } catch (error) {
      logger.error('Ошибка при исправлении невалидного кода:', error);
      throw error;
    }
  }

  /**
   * Определяет путь к файлу на основе задачи и типа кода
   * @param {Object} task - Задача
   * @param {string} fileName - Имя файла из ответа LLM
   * @param {string} language - Язык программирования
   * @returns {string} - Путь к файлу
   */
  determineFilePath(task, fileName, language) {
    // Если имя файла уже есть, проверяем его и возвращаем
    if (fileName && fileName.includes('.')) {
      return fileName;
    }
    
    // Базовое имя файла на основе названия задачи
    let baseFileName = fileName || task.title.toLowerCase()
      .replace(/[^a-zа-я0-9\s-]/gi, '')
      .replace(/\s+/g, '-');
    
    // Расширение файла на основе языка
    let extension = '.js';
    if (language === 'ts') {
      extension = '.ts';
    }
    
    // Определяем тип компонента и соответствующую директорию
    let directory = 'src/';
    
    const taskTitle = task.title.toLowerCase();
    if (taskTitle.includes('модель') || taskTitle.includes('model')) {
      directory += 'models/';
    } else if (taskTitle.includes('контроллер') || taskTitle.includes('controller')) {
      directory += 'controllers/';
    } else if (taskTitle.includes('сервис') || taskTitle.includes('service')) {
      directory += 'services/';
    } else if (taskTitle.includes('маршрут') || taskTitle.includes('route')) {
      directory += 'routes/';
    } else if (taskTitle.includes('middleware')) {
      directory += 'middleware/';
    } else if (taskTitle.includes('утилита') || taskTitle.includes('util')) {
      directory += 'utils/';
    }
    
    // Формируем полный путь
    return directory + baseFileName + extension;
  }

  /**
   * Сохраняет сгенерированный код в БД
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} generatedContent - Сгенерированный код
   * @returns {Promise<number>} - ID записи о генерации
   */
  async saveGeneratedCode(taskId, filePath, generatedContent) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем проектную информацию для доступа к файловой системе
      const projectInfo = await this.getProjectInfo();
      const projectPath = projectInfo.repository_url;
      
      // Полный путь к файлу
      const fullPath = path.join(projectPath, filePath);
      
      // Проверяем, существует ли файл
      let originalContent = null;
      try {
        originalContent = await fileUtils.readFile(fullPath);
      } catch (error) {
        // Файл не существует, это нормально
        logger.debug(`Файл ${filePath} не существует, будет создан новый`);
      }
      
      // Сохраняем информацию о генерации в БД
      const [result] = await connection.query(
        `INSERT INTO code_generations 
         (task_id, file_path, original_content, generated_content, status) 
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, filePath, originalContent, generatedContent, 'pending_review']
      );
      
      connection.release();
      
      logger.info(`Сгенерированный код для задачи #${taskId} сохранен в БД, ID: ${result.insertId}`);
      
      return result.insertId;
    } catch (error) {
      logger.error(`Ошибка при сохранении сгенерированного кода:`, error);
      throw error;
    }
  }

  /**
   * Применяет сгенерированный код к проекту
   * @param {number} generationId - ID записи о генерации
   * @returns {Promise<Object>} - Результат применения
   */
  async applyGeneratedCode(generationId) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем информацию о генерации
      const [generations] = await connection.query(
        `SELECT * FROM code_generations WHERE id = ?`,
        [generationId]
      );
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Проверяем статус генерации
      if (generation.status !== 'approved') {
        throw new Error(`Нельзя применить код со статусом "${generation.status}". Требуется одобрение.`);
      }
      
      // Получаем информацию о проекте
      const projectInfo = await this.getProjectInfo();
      const projectPath = projectInfo.repository_url;
      
      // Полный путь к файлу
      const fullPath = path.join(projectPath, generation.file_path);
      
      // Создаем директорию, если её нет
      const dirPath = path.dirname(fullPath);
      await fileUtils.mkdir(dirPath, { recursive: true });
      
      // Записываем сгенерированный код в файл
      await fileUtils.writeFile(fullPath, generation.generated_content);
      
      // Обновляем статус генерации
      await connection.query(
        'UPDATE code_generations SET status = ?, updated_at = NOW() WHERE id = ?',
        ['implemented', generationId]
      );
      
      // Обновляем статус задачи
      const [tasks] = await connection.query(
        'SELECT id FROM tasks WHERE id = ?',
        [generation.task_id]
      );
      
      if (tasks.length > 0) {
        await this.updateTaskStatus(generation.task_id, 'completed');
      }
      
      connection.release();
      
      logger.info(`Сгенерированный код для файла ${generation.file_path} успешно применен`);
      
      return {
        success: true,
        filePath: generation.file_path,
        taskId: generation.task_id
      };
    } catch (error) {
      logger.error(`Ошибка при применении сгенерированного кода:`, error);
      throw error;
    }
  }

  /**
   * Обновляет статус генерации кода
   * @param {number} generationId - ID записи о генерации
   * @param {string} status - Новый статус
   * @param {string} feedback - Обратная связь (опционально)
   * @returns {Promise<boolean>} - Результат обновления
   */
  async updateGenerationStatus(generationId, status, feedback = null) {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем существование генерации
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      // Обновляем статус
      await connection.query(
        'UPDATE code_generations SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, generationId]
      );
      
      // Если есть обратная связь, сохраняем её
      if (feedback) {
        await connection.query(
          'INSERT INTO feedback (code_generation_id, feedback_text) VALUES (?, ?)',
          [generationId, feedback]
        );
      }
      
      connection.release();
      
      logger.info(`Статус генерации #${generationId} обновлен на "${status}"`);
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса генерации:`, error);
      throw error;
    }
  }

  /**
   * Создает юнит-тесты для сгенерированного кода
   * @param {number} generationId - ID записи о генерации
   * @returns {Promise<Object>} - Результат создания тестов
   */
  async createTests(generationId) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем информацию о генерации
      const [generations] = await connection.query(
        `SELECT * FROM code_generations WHERE id = ?`,
        [generationId]
      );
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Создаем промпт для генерации тестов
      const prompt = `
Создай юнит-тесты для следующего кода. Используй Jest в качестве фреймворка для тестирования.

Код:
\`\`\`javascript
${generation.generated_content}
\`\`\`

Тесты должны быть полными и проверять все основные функции и сценарии использования.
Используй моки и стабы где это необходимо.
Включи как позитивные, так и негативные тест-кейсы.
`;
      
      // Отправляем промпт в LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код тестов из ответа
      const extractedCode = this.extractCodeFromResponse(response);
      
      if (!extractedCode.code) {
        throw new Error('Не удалось извлечь код тестов из ответа LLM');
      }
      
      // Определяем имя файла с тестами
      const testFileName = this.generateTestFileName(generation.file_path);
      
      // Сохраняем тесты в БД
      const [result] = await connection.query(
        `INSERT INTO tests 
         (code_generation_id, test_name, test_content, result) 
         VALUES (?, ?, ?, ?)`,
        [generationId, testFileName, extractedCode.code, 'pending']
      );
      
      connection.release();
      
      logger.info(`Созданы тесты для генерации #${generationId}`);
      
      return {
        id: result.insertId,
        testFileName,
        testContent: extractedCode.code
      };
    } catch (error) {
      logger.error(`Ошибка при создании тестов:`, error);
      throw error;
    }
  }

  /**
   * Генерирует имя файла для тестов
   * @param {string} sourcePath - Путь к исходному файлу
   * @returns {string} - Путь к файлу с тестами
   */
  generateTestFileName(sourcePath) {
    const parsedPath = path.parse(sourcePath);
    return path.join('tests', parsedPath.dir, `${parsedPath.name}.test${parsedPath.ext}`);
  }
}
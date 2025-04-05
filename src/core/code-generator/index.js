// src/core/code-generator/index.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const BaseCodeGenerator = require('./base');
const PromptGenerator = require('./prompt-generator');
const FileAnalyzer = require('../project-understanding/file-analyzer');
const taskLogger = require('../../utils/task-logger');
const fs = require('fs');
const path = require('path');

/**
 * Класс для генерации кода для задач
 */
class CodeGenerator extends BaseCodeGenerator {
  /**
   * Конструктор класса
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    super(projectId);
    this.promptGenerator = new PromptGenerator();
    this.fileAnalyzer = new FileAnalyzer(projectId);
  }

  /**
   * Генерирует код для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат генерации
   */
  async generateCode(taskId) {
    try {
      logger.info(`Генерация кода для задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начата генерация кода');
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Получаем подзадачи, если есть
      const connection = await pool.getConnection();
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      connection.release();
      
      // Получаем информацию о проекте
      const project = await this.getProjectInfo();
      
      // Если нет подзадач, генерируем код напрямую для задачи
      if (subtasks.length === 0) {
        const result = await this.generateCodeForTask(task);
        await taskLogger.logInfo(taskId, `Код успешно сгенерирован для задачи`);
        return result;
      }
      
      // Генерируем код для каждой подзадачи
      const results = [];
      
      for (const subtask of subtasks) {
        // Пропускаем уже выполненные подзадачи
        if (subtask.status === 'completed') {
          continue;
        }
        
        const result = await this.generateCodeForSubtask(task, subtask);
        
        if (result && result.generationId) {
          results.push(result);
          await taskLogger.logInfo(taskId, `Код успешно сгенерирован для подзадачи #${subtask.id}: ${subtask.title}`);
        } else {
          await taskLogger.logWarning(taskId, `Не удалось сгенерировать код для подзадачи #${subtask.id}: ${subtask.title}`);
        }
      }
      
      if (results.length === 0) {
        await taskLogger.logWarning(taskId, 'Не удалось сгенерировать код ни для одной подзадачи');
        return null;
      }
      
      await taskLogger.logInfo(taskId, `Успешно сгенерирован код для ${results.length} подзадач`);
      
      return {
        success: true,
        taskId,
        generationCount: results.length,
        generations: results
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${taskId}:`, error);
      await taskLogger.logError(taskId, `Ошибка при генерации кода: ${error.message}`);
      throw error;
    }
  }

  /**
   * Генерирует код для конкретного файла
   * @param {number} taskId - ID задачи
   * @param {number} subtaskId - ID подзадачи (опционально)
   * @param {string} filePath - Путь к файлу
   * @param {string} description - Описание задачи/подзадачи
   * @returns {Promise<Object>} - Результат генерации
   */
  async generateFile(taskId, subtaskId, filePath, description) {
    try {
      logger.info(`Генерация кода для файла ${filePath} (задача #${taskId}, подзадача #${subtaskId})`);
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Получаем информацию о подзадаче, если указана
      let subtask = null;
      if (subtaskId) {
        subtask = await this.getSubtaskInfo(subtaskId);
      }
      
      // Получаем информацию о проекте
      const project = await this.getProjectInfo();
      
      // Определяем язык программирования по расширению файла
      const language = this.detectLanguageFromFilePath(filePath);
      
      // Получаем теги задачи
      const tags = await this.getTaskTags(taskId);
      
      // Получаем структуру файлов проекта
      const projectFiles = await this.fileAnalyzer.getProjectStructure();
      
      // Находим релевантные файлы для данной задачи
      const relevantFiles = await this.fileAnalyzer.findRelevantFiles(
        taskId, 
        subtask ? subtask.description : task.description
      );
      
      // Проверяем существование файла в проекте
      const existingFileContent = await this.getFileContent(filePath);
      
      let generatedContent;
      let prompt;
      
      if (existingFileContent) {
        // Если файл существует, генерируем модификацию
        prompt = await this.promptGenerator.createFileModificationPrompt(
          task,
          subtask,
          filePath,
          existingFileContent,
          language,
          description
        );
        
        // Отправляем запрос к LLM
        const response = await this.llmClient.sendPrompt(prompt);
        
        // Извлекаем код из ответа
        generatedContent = this.extractCodeFromResponse(response, language);
      } else {
        // Если файл не существует, генерируем новый
        prompt = await this.promptGenerator.createFileGenerationPrompt(
          task,
          subtask,
          filePath,
          language,
          tags,
          projectFiles,
          relevantFiles
        );
        
        // Отправляем запрос к LLM
        const response = await this.llmClient.sendPrompt(prompt);
        
        // Извлекаем код из ответа
        generatedContent = this.extractCodeFromResponse(response, language);
      }
      
      if (!generatedContent) {
        logger.warn(`Не удалось сгенерировать код для файла ${filePath}`);
        return null;
      }
      
      // Сохраняем сгенерированный код в БД
      const result = await this.saveGeneratedCode(
        taskId, 
        filePath, 
        language, 
        generatedContent
      );
      
      // Связываем генерацию с подзадачей, если она указана
      if (subtaskId && result.generationId) {
        const connection = await pool.getConnection();
        
        await connection.query(
          'UPDATE code_generations SET subtask_id = ? WHERE id = ?',
          [subtaskId, result.generationId]
        );
        
        connection.release();
      }
      
      // Пытаемся физически создать файл, если указан путь к репозиторию
      if (project.repository_path) {
        try {
          const fullPath = path.join(project.repository_path, filePath);
          const dirPath = path.dirname(fullPath);
          
          // Создаем директорию, если её нет
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
          
          // Записываем файл
          fs.writeFileSync(fullPath, generatedContent);
          
          logger.info(`Файл ${filePath} успешно создан физически`);
        } catch (fsError) {
          logger.warn(`Не удалось физически создать файл ${filePath}:`, fsError);
        }
      }
      
      return {
        ...result,
        taskId,
        subtaskId,
        filePath,
        language
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Генерирует код для задачи без подзадач
   * @param {Object} task - Информация о задаче
   * @returns {Promise<Object>} - Результат генерации
   * @private
   */
  async generateCodeForTask(task) {
    try {
      // Определяем тип файла на основе названия и описания задачи
      const filePathInfo = this.inferFilePath(task.title, task.description);
      
      if (!filePathInfo) {
        logger.warn(`Не удалось определить путь к файлу для задачи #${task.id}`);
        return null;
      }
      
      // Генерируем код для файла
      const result = await this.generateFile(
        task.id,
        null,
        filePathInfo.path,
        task.description
      );
      
      return {
        success: !!result,
        taskId: task.id,
        generationId: result ? result.generationId : null,
        filePath: filePathInfo.path
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${task.id}:`, error);
      return null;
    }
  }

  /**
   * Генерирует код для подзадачи
   * @param {Object} task - Информация о задаче
   * @param {Object} subtask - Информация о подзадаче
   * @returns {Promise<Object>} - Результат генерации
   * @private
   */
  async generateCodeForSubtask(task, subtask) {
    try {
      // Определяем путь к файлу на основе подзадачи
      // В первую очередь ищем явное указание в названии или описании
      const filePathMatch = subtask.description.match(/файл:\s*([^\s]+)/i);
      
      let filePath;
      
      if (filePathMatch && filePathMatch[1]) {
        filePath = filePathMatch[1];
      } else {
        // Если явно не указано, пытаемся определить автоматически
        const filePathInfo = this.inferFilePath(subtask.title, subtask.description);
        
        if (!filePathInfo) {
          logger.warn(`Не удалось определить путь к файлу для подзадачи #${subtask.id}`);
          return null;
        }
        
        filePath = filePathInfo.path;
      }
      
      // Генерируем код для файла
      const result = await this.generateFile(
        task.id,
        subtask.id,
        filePath,
        subtask.description
      );
      
      return {
        success: !!result,
        taskId: task.id,
        subtaskId: subtask.id,
        generationId: result ? result.generationId : null,
        filePath
      };
    } catch (error) {
      logger.error(`Ошибка при генерации кода для подзадачи #${subtask.id}:`, error);
      return null;
    }
  }

  /**
   * Определяет путь к файлу на основе названия и описания
   * @param {string} title - Название задачи/подзадачи
   * @param {string} description - Описание задачи/подзадачи
   * @returns {Object|null} - Информация о файле или null
   * @private
   */
  inferFilePath(title, description) {
    try {
      // Проверяем на явное указание файла в описании
      const filePathMatch = description.match(/файл:\s*([^\s]+)/i);
      
      if (filePathMatch && filePathMatch[1]) {
        const filePath = filePathMatch[1];
        return {
          path: filePath,
          language: this.detectLanguageFromFilePath(filePath)
        };
      }
      
      // Проверяем на наличие ключевых слов, указывающих на тип файла
      const isComponent = /component|компонент/i.test(title) || /component|компонент/i.test(description);
      const isController = /controller|контроллер/i.test(title) || /controller|контроллер/i.test(description);
      const isModel = /model|модель/i.test(title) || /model|модель/i.test(description);
      const isHelper = /helper|util|утилита/i.test(title) || /helper|util|утилита/i.test(description);
      const isTest = /test|тест/i.test(title) || /test|тест/i.test(description);
      
      // Формируем название файла на основе названия задачи
      let fileName = title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')  // Удаляем специальные символы
        .replace(/\s+/g, '-')      // Заменяем пробелы на дефисы
        .replace(/-+/g, '-');      // Убираем повторяющиеся дефисы
      
      // Определяем директорию и расширение на основе типа файла
      let directory = 'src';
      let extension = '.js';
      
      if (isComponent) {
        directory += '/components';
        extension = '.jsx'; // Предполагаем React
      } else if (isController) {
        directory += '/controllers';
      } else if (isModel) {
        directory += '/models';
      } else if (isHelper) {
        directory += '/utils';
      } else if (isTest) {
        directory += '/tests';
        extension = '.test.js';
      }
      
      return {
        path: `${directory}/${fileName}${extension}`,
        language: this.detectLanguageFromFilePath(extension)
      };
    } catch (error) {
      logger.error(`Ошибка при определении пути к файлу для "${title}":`, error);
      return null;
    }
  }

  /**
   * Применяет сгенерированный код
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<boolean>} - Успешно ли применен код
   */
  async applyGeneratedCode(generationId) {
    try {
      logger.info(`Применение сгенерированного кода #${generationId}`);
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о генерации
      const [generations] = await connection.query(
        'SELECT cg.*, t.project_id FROM code_generations cg JOIN tasks t ON cg.task_id = t.id WHERE cg.id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        connection.release();
        logger.warn(`Генерация кода с id=${generationId} не найдена`);
        return false;
      }
      
      const generation = generations[0];
      
      // Проверяем статус генерации
      if (generation.status !== 'approved') {
        connection.release();
        logger.warn(`Генерация кода #${generationId} не одобрена для применения`);
        return false;
      }
      
      // Получаем информацию о проекте
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [generation.project_id]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        logger.warn(`Проект с id=${generation.project_id} не найден`);
        return false;
      }
      
      const project = projects[0];
      
      // Если указан путь к репозиторию, применяем код физически
      if (project.repository_path) {
        try {
          const fullPath = path.join(project.repository_path, generation.file_path);
          const dirPath = path.dirname(fullPath);
          
          // Создаем директорию, если её нет
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
          
          // Записываем файл
          fs.writeFileSync(fullPath, generation.generated_content);
          
          logger.info(`Код успешно применен к файлу ${generation.file_path}`);
          
          // Обновляем статус генерации
          await this.updateGenerationStatus(generationId, 'implemented');
          
          // Если связана с подзадачей, обновляем её статус
          if (generation.subtask_id) {
            const connection = await pool.getConnection();
            
            await connection.query(
              "UPDATE subtasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?",
              [generation.subtask_id]
            );
            
            connection.release();
            
            logger.info(`Подзадача #${generation.subtask_id} отмечена как выполненная`);
            await taskLogger.logInfo(generation.task_id, `Подзадача #${generation.subtask_id} автоматически отмечена как выполненная`);
          }
          
          return true;
        } catch (fsError) {
          logger.error(`Ошибка при применении кода к файлу ${generation.file_path}:`, fsError);
          return false;
        }
      }
      
      logger.warn(`Не указан путь к репозиторию для проекта #${generation.project_id}`);
      return false;
    } catch (error) {
      logger.error(`Ошибка при применении сгенерированного кода #${generationId}:`, error);
      return false;
    }
  }
}

module.exports = CodeGenerator;
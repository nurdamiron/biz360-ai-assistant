// src/core/code-generator/file-based-generator.js

const BaseCodeGenerator = require('./base');
const PromptGenerator = require('./prompt-generator');
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Генератор кода на основе файловой системы
 */
class FileBasedCodeGenerator extends BaseCodeGenerator {
  /**
   * Конструктор класса
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    super(projectId);
    this.promptGenerator = new PromptGenerator();
  }

  /**
   * Генерирует код для файла
   * @param {number} taskId - ID задачи
   * @param {number} subtaskId - ID подзадачи
   * @param {string} filePath - Путь к файлу
   * @param {string} description - Описание требуемого кода
   * @returns {Promise<Object>} - Информация о сгенерированном коде
   */
  async generateFile(taskId, subtaskId, filePath, description) {
    try {
      logger.info(`Генерация кода для файла ${filePath} (Задача #${taskId}, Подзадача #${subtaskId})`);
      
      // Получаем информацию о задаче и подзадаче
      const task = await this.getTaskInfo(taskId);
      const subtask = await this.getSubtaskInfo(subtaskId);
      
      // Получаем теги задачи
      const tags = await this.getTaskTags(taskId);
      
      // Получаем структуру проекта
      const projectFiles = await this.getProjectStructure();
      
      // Определяем язык программирования
      const language = this.detectLanguageFromFilePath(filePath);
      
      // Находим релевантные файлы для контекста
      const relevantFiles = await this._findRelevantFiles(filePath, language);
      
      // Создаем промпт для генерации кода
      const prompt = await this.promptGenerator.createFileGenerationPrompt(
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
      const generatedCode = this.extractCodeFromResponse(response, language);
      
      if (!generatedCode) {
        logger.warn(`Не удалось извлечь код из ответа для ${filePath}`);
        return null;
      }
      
      // Сохраняем сгенерированный код в БД
      const result = await this.saveGeneratedCode(taskId, filePath, language, generatedCode);
      
      // Физически записываем файл, если есть репозиторий
      if (task.project_id) {
        const project = await this.getProjectInfo();
        
        if (project.repository_path) {
          await this._writeFileToRepository(project.repository_path, filePath, generatedCode);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при генерации кода для файла ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Модифицирует существующий файл
   * @param {number} taskId - ID задачи
   * @param {number} subtaskId - ID подзадачи
   * @param {string} filePath - Путь к файлу
   * @param {string} modification - Описание требуемых изменений
   * @returns {Promise<Object>} - Информация о сгенерированном коде
   */
  async modifyFile(taskId, subtaskId, filePath, modification) {
    try {
      logger.info(`Модификация файла ${filePath} (Задача #${taskId}, Подзадача #${subtaskId})`);
      
      // Получаем информацию о задаче и подзадаче
      const task = await this.getTaskInfo(taskId);
      const subtask = await this.getSubtaskInfo(subtaskId);
      
      // Определяем язык программирования
      const language = this.detectLanguageFromFilePath(filePath);
      
      // Получаем содержимое исходного файла
      const originalContent = await this.getFileContent(filePath);
      
      if (!originalContent) {
        logger.warn(`Не удалось получить содержимое файла ${filePath}`);
        return null;
      }
      
      // Создаем промпт для модификации файла
      const prompt = await this.promptGenerator.createFileModificationPrompt(
        task,
        subtask,
        filePath,
        originalContent,
        language,
        modification
      );
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const modifiedCode = this.extractCodeFromResponse(response, language);
      
      if (!modifiedCode) {
        logger.warn(`Не удалось извлечь код из ответа для ${filePath}`);
        return null;
      }
      
      // Сохраняем сгенерированный код в БД
      const result = await this.saveGeneratedCode(taskId, filePath, language, modifiedCode);
      
      // Физически записываем файл, если есть репозиторий
      if (task.project_id) {
        const project = await this.getProjectInfo();
        
        if (project.repository_path) {
          await this._writeFileToRepository(project.repository_path, filePath, modifiedCode);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при модификации файла ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Исправляет ошибку в коде
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} errorDescription - Описание ошибки
   * @returns {Promise<Object>} - Информация о исправленном коде
   */
  async fixBug(taskId, filePath, errorDescription) {
    try {
      logger.info(`Исправление ошибки в файле ${filePath} (Задача #${taskId})`);
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Определяем язык программирования
      const language = this.detectLanguageFromFilePath(filePath);
      
      // Получаем содержимое файла с ошибкой
      const problematicCode = await this.getFileContent(filePath);
      
      if (!problematicCode) {
        logger.warn(`Не удалось получить содержимое файла ${filePath}`);
        return null;
      }
      
      // Создаем промпт для исправления ошибки
      const prompt = await this.promptGenerator.createBugFixPrompt(
        task,
        filePath,
        problematicCode,
        language,
        errorDescription
      );
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const fixedCode = this.extractCodeFromResponse(response, language);
      
      if (!fixedCode) {
        logger.warn(`Не удалось извлечь исправленный код из ответа для ${filePath}`);
        return null;
      }
      
      // Сохраняем исправленный код в БД
      const result = await this.saveGeneratedCode(taskId, filePath, language, fixedCode);
      
      // Физически записываем файл, если есть репозиторий
      if (task.project_id) {
        const project = await this.getProjectInfo();
        
        if (project.repository_path) {
          await this._writeFileToRepository(project.repository_path, filePath, fixedCode);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при исправлении бага в файле ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Генерирует тесты для кода
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу с кодом
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {Promise<Object>} - Информация о сгенерированных тестах
   */
  async generateTests(taskId, filePath, testFramework = 'jest') {
    try {
      logger.info(`Генерация тестов для файла ${filePath} (Задача #${taskId})`);
      
      // Определяем язык программирования
      const language = this.detectLanguageFromFilePath(filePath);
      
      // Получаем содержимое файла
      const codeToTest = await this.getFileContent(filePath);
      
      if (!codeToTest) {
        logger.warn(`Не удалось получить содержимое файла ${filePath}`);
        return null;
      }
      
      // Определяем путь к файлу с тестами
      const testFilePath = this._generateTestFilePath(filePath);
      
      // Создаем промпт для генерации тестов
      const prompt = await this.promptGenerator.createTestGenerationPrompt(
        filePath,
        codeToTest,
        language,
        testFramework
      );
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const testCode = this.extractCodeFromResponse(response, language);
      
      if (!testCode) {
        logger.warn(`Не удалось извлечь код тестов из ответа для ${filePath}`);
        return null;
      }
      
      // Сохраняем сгенерированные тесты в БД
      const result = await this.saveGeneratedCode(taskId, testFilePath, language, testCode);
      
      // Физически записываем файл с тестами, если есть репозиторий
      const task = await this.getTaskInfo(taskId);
      
      if (task.project_id) {
        const project = await this.getProjectInfo();
        
        if (project.repository_path) {
          await this._writeFileToRepository(project.repository_path, testFilePath, testCode);
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при генерации тестов для файла ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Находит релевантные файлы для контекста
   * @param {string} targetFilePath - Путь к целевому файлу
   * @param {string} language - Язык программирования
   * @returns {Promise<Array<Object>>} - Массив релевантных файлов с содержимым
   * @private
   */
  async _findRelevantFiles(targetFilePath, language) {
    try {
      // Получаем все файлы проекта
      const projectFiles = await this.getProjectStructure();
      
      // Определяем директорию целевого файла
      const targetDir = path.dirname(targetFilePath);
      
      // Релевантные файлы - это файлы в той же директории и тем же расширением
      const relevantFilePaths = projectFiles
        .filter(file => {
          const fileDir = path.dirname(file.file_path);
          const fileExt = path.extname(file.file_path);
          const targetExt = path.extname(targetFilePath);
          
          // Файлы в той же директории или с тем же расширением
          return (fileDir === targetDir || fileExt === targetExt);
        })
        .map(file => file.file_path)
        .slice(0, 5); // Ограничиваем количество релевантных файлов
      
      // Получаем содержимое релевантных файлов
      const relevantFiles = [];
      
      for (const filePath of relevantFilePaths) {
        const content = await this.getFileContent(filePath);
        
        if (content) {
          relevantFiles.push({
            path: filePath,
            language: this.detectLanguageFromFilePath(filePath),
            content
          });
        }
      }
      
      return relevantFiles;
    } catch (error) {
      logger.error(`Ошибка при поиске релевантных файлов для ${targetFilePath}:`, error);
      return [];
    }
  }

  /**
   * Записывает файл в репозиторий
   * @param {string} repositoryPath - Путь к репозиторию
   * @param {string} filePath - Относительный путь к файлу
   * @param {string} content - Содержимое файла
   * @returns {Promise<void>}
   * @private
   */
  async _writeFileToRepository(repositoryPath, filePath, content) {
    try {
      // Полный путь к файлу
      const fullPath = path.join(repositoryPath, filePath);
      
      // Создаем директории, если они не существуют
      const directory = path.dirname(fullPath);
      await fs.mkdir(directory, { recursive: true });
      
      // Записываем файл
      await fs.writeFile(fullPath, content);
      
      logger.info(`Файл ${filePath} успешно записан в репозиторий`);
    } catch (error) {
      logger.error(`Ошибка при записи файла ${filePath} в репозиторий:`, error);
      throw error;
    }
  }

  /**
   * Генерирует путь к файлу с тестами
   * @param {string} sourceFilePath - Путь к исходному файлу
   * @returns {string} - Путь к файлу с тестами
   * @private
   */
  _generateTestFilePath(sourceFilePath) {
    const ext = path.extname(sourceFilePath);
    const basename = path.basename(sourceFilePath, ext);
    const dirname = path.dirname(sourceFilePath);
    
    // Распространенные конвенции для тестовых файлов
    if (dirname.includes('__tests__')) {
      // Если файл уже в директории с тестами
      return path.join(dirname, `${basename}.test${ext}`);
    } else if (dirname.includes('src')) {
      // Если файл в src, создаем тест в __tests__
      return path.join(dirname.replace('src', '__tests__'), `${basename}.test${ext}`);
    } else {
      // В противном случае, добавляем .test к имени файла
      return path.join(dirname, `${basename}.test${ext}`);
    }
  }
}

module.exports = FileBasedCodeGenerator;
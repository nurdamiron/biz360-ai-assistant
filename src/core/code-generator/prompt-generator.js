// src/core/code-generator/prompt-generator.js

const logger = require('../../utils/logger');

/**
 * Класс для генерации промптов для создания кода
 */
class PromptGenerator {
  /**
   * Создает промпт для генерации файла
   * @param {Object} task - Информация о задаче
   * @param {Object} subtask - Информация о подзадаче
   * @param {string} filePath - Путь к файлу
   * @param {string} language - Язык программирования
   * @param {Array<string>} tags - Теги задачи
   * @param {Array<Object>} projectFiles - Структура файлов проекта
   * @param {Array<Object>} relevantFiles - Содержимое релевантных файлов
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createFileGenerationPrompt(task, subtask, filePath, language, tags = [], projectFiles = [], relevantFiles = []) {
    try {
      // Создаем базовый промпт
      const prompt = `
# Задача генерации кода

## Контекст
Ты - опытный разработчик, который пишет высококачественный код.

## Файл
Путь: ${filePath}
Язык: ${language}

## Задача
${task ? `Название: ${task.title}
Описание: ${task.description}` : 'Нет информации о задаче'}

## Подзадача
${subtask ? `Название: ${subtask.title}
Описание: ${subtask.description}` : 'Нет информации о подзадаче'}

${tags.length > 0 ? `
## Теги
${tags.join(', ')}
` : ''}

${projectFiles.length > 0 ? `
## Структура проекта
${this._formatProjectStructure(projectFiles)}
` : ''}

${relevantFiles.length > 0 ? `
## Релевантные файлы
${this._formatRelevantFiles(relevantFiles)}
` : ''}

## Инструкции
1. Напиши код для файла ${filePath} на языке ${language}.
2. Код должен быть полным, рабочим и готовым к использованию.
3. Не пропускай важные детали.
4. Включи только код без пояснений внутри кода.
5. Используй лучшие практики для выбранного языка.
6. Следуй стандартам форматирования, типичным для выбранного языка.
7. Учитывай контекст проекта и взаимодействие с другими файлами.

## Формат ответа
\`\`\`${language}
// Твой код здесь
\`\`\`

## Описание решения
После кода предоставь краткое описание, начинающееся с "Описание решения:", в котором объясни основные принципы и архитектурные решения.
`;
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для генерации файла:', error);
      throw error;
    }
  }

  /**
   * Создает промпт для модификации файла
   * @param {Object} task - Информация о задаче
   * @param {Object} subtask - Информация о подзадаче
   * @param {string} filePath - Путь к файлу
   * @param {string} originalContent - Исходное содержимое файла
   * @param {string} language - Язык программирования
   * @param {string} modification - Описание требуемых изменений
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createFileModificationPrompt(task, subtask, filePath, originalContent, language, modification) {
    try {
      // Создаем промпт для модификации файла
      const prompt = `
# Задача модификации файла

## Контекст
Ты - опытный разработчик, который модифицирует существующий код.

## Файл
Путь: ${filePath}
Язык: ${language}

## Исходный код
\`\`\`${language}
${originalContent}
\`\`\`

## Задача
${task ? `Название: ${task.title}
Описание: ${task.description}` : 'Нет информации о задаче'}

## Подзадача
${subtask ? `Название: ${subtask.title}
Описание: ${subtask.description}` : 'Нет информации о подзадаче'}

## Требуемые изменения
${modification}

## Инструкции
1. Модифицируй код файла ${filePath} согласно требуемым изменениям.
2. Сохрани все существующие функциональности, если не указано иное.
3. Будь внимателен к архитектуре и стилю существующего кода.
4. Возвращай полное содержимое файла, а не только изменения.
5. Не добавляй комментарии, которые указывают на изменения (например, "// Добавлено").

## Формат ответа
\`\`\`${language}
// Измененный код здесь
\`\`\`

## Описание изменений
После кода предоставь краткое описание, начинающееся с "Описание изменений:", в котором объясни, что было изменено и почему.
`;
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для модификации файла:', error);
      throw error;
    }
  }

  /**
   * Создает промпт для решения проблемы в коде
   * @param {Object} task - Информация о задаче
   * @param {string} filePath - Путь к файлу
   * @param {string} problematicCode - Проблемный код
   * @param {string} language - Язык программирования
   * @param {string} errorDescription - Описание ошибки
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createBugFixPrompt(task, filePath, problematicCode, language, errorDescription) {
    try {
      // Создаем промпт для исправления ошибки
      const prompt = `
# Задача исправления ошибки

## Контекст
Ты - опытный разработчик, который исправляет ошибки в коде.

## Файл с ошибкой
Путь: ${filePath}
Язык: ${language}

## Проблемный код
\`\`\`${language}
${problematicCode}
\`\`\`

## Описание ошибки
${errorDescription}

## Задача
${task ? `Название: ${task.title}
Описание: ${task.description}` : 'Нет информации о задаче'}

## Инструкции
1. Тщательно проанализируй код и найди причину описанной ошибки.
2. Исправь ошибку с минимальными изменениями в коде.
3. Убедись, что исправленный код не вносит новых проблем.
4. Возвращай полное содержимое исправленного файла.

## Формат ответа
\`\`\`${language}
// Исправленный код здесь
\`\`\`

## Описание исправления
После кода предоставь краткое описание, начинающееся с "Описание исправления:", в котором объясни:
1. Что было причиной ошибки
2. Какие изменения были внесены для её устранения
3. Почему эти изменения решают проблему
`;
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для исправления ошибки:', error);
      throw error;
    }
  }

  /**
   * Создает промпт для написания тестов
   * @param {string} filePath - Путь к файлу с кодом
   * @param {string} codeToTest - Код для тестирования
   * @param {string} language - Язык программирования
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createTestGenerationPrompt(filePath, codeToTest, language, testFramework = 'jest') {
    try {
      // Создаем промпт для генерации тестов
      const prompt = `
# Задача генерации тестов

## Контекст
Ты - опытный разработчик, который пишет качественные тесты.

## Исходный файл
Путь: ${filePath}
Язык: ${language}

## Код для тестирования
\`\`\`${language}
${codeToTest}
\`\`\`

## Фреймворк для тестирования
${testFramework}

## Инструкции
1. Напиши полный набор тестов для данного кода, используя фреймворк ${testFramework}.
2. Обеспечь максимальное покрытие тестами всех функций и методов.
3. Включи тесты для положительных и отрицательных сценариев.
4. Используй моки и стабы, где это необходимо.
5. Следуй лучшим практикам тестирования для выбранного языка и фреймворка.

## Формат ответа
\`\`\`${language}
// Код тестов здесь
\`\`\`

## Описание тестов
После кода предоставь краткое описание, начинающееся с "Описание тестов:", в котором объясни:
1. Какие сценарии покрывают тесты
2. Какая логика тестируется
3. Любые особенности или сложности в тестировании данного кода
`;
      
      return prompt;
    } catch (error) {
      logger.error('Ошибка при создании промпта для генерации тестов:', error);
      throw error;
    }
  }

  /**
   * Форматирует структуру проекта для включения в промпт
   * @param {Array<Object>} projectFiles - Структура файлов проекта
   * @returns {string} - Отформатированная структура проекта
   * @private
   */
  _formatProjectStructure(projectFiles) {
    if (!projectFiles || projectFiles.length === 0) {
      return 'Нет информации о структуре проекта';
    }
    
    // Организуем файлы по директориям
    const filesByDirectory = {};
    
    projectFiles.forEach(file => {
      const directory = file.file_path.split('/').slice(0, -1).join('/');
      
      if (!filesByDirectory[directory]) {
        filesByDirectory[directory] = [];
      }
      
      filesByDirectory[directory].push(file.file_path.split('/').pop());
    });
    
    // Форматируем выводимую структуру
    let result = '';
    
    for (const [directory, files] of Object.entries(filesByDirectory)) {
      result += `${directory ? directory : '(корневая директория)'}:\n`;
      
      files.forEach(file => {
        result += `  - ${file}\n`;
      });
      
      result += '\n';
    }
    
    return result;
  }

  /**
   * Форматирует релевантные файлы для включения в промпт
   * @param {Array<Object>} relevantFiles - Релевантные файлы с содержимым
   * @returns {string} - Отформатированное содержимое релевантных файлов
   * @private
   */
  _formatRelevantFiles(relevantFiles) {
    if (!relevantFiles || relevantFiles.length === 0) {
      return 'Нет релевантных файлов';
    }
    
    let result = '';
    
    relevantFiles.forEach(file => {
      if (!file.content) {
        return;
      }
      
      // Для очень больших файлов показываем только начало
      const content = file.content.length > 1000 
        ? file.content.substring(0, 1000) + '\n... (file truncated)'
        : file.content;
      
      const language = file.language || this._guessLanguageFromFilePath(file.path);
      
      result += `### ${file.path}\n\`\`\`${language}\n${content}\n\`\`\`\n\n`;
    });
    
    return result;
  }

  /**
   * Определяет предполагаемый язык программирования по пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Предполагаемый язык программирования
   * @private
   */
  _guessLanguageFromFilePath(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    
    const extensionToLanguage = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown'
    };
    
    return extensionToLanguage[extension] || extension;
  }
}

module.exports = PromptGenerator;
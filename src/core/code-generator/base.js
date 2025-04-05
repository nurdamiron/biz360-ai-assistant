// src/core/code-generator/base.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const { getLLMClient } = require('../../utils/llm-client');

/**
 * Базовый класс для генерации кода
 */
class BaseCodeGenerator {
  /**
   * Конструктор класса
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
  }

  /**
   * Получает информацию о проекте
   * @returns {Promise<Object>} - Объект с информацией о проекте
   * @protected
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
      logger.error(`Ошибка при получении информации о проекте #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Получает информацию о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Объект с информацией о задаче
   * @protected
   */
  async getTaskInfo(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      return tasks[0];
    } catch (error) {
      logger.error(`Ошибка при получении информации о задаче #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает информацию о подзадаче
   * @param {number} subtaskId - ID подзадачи
   * @returns {Promise<Object>} - Объект с информацией о подзадаче
   * @protected
   */
  async getSubtaskInfo(subtaskId) {
    try {
      const connection = await pool.getConnection();
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ?',
        [subtaskId]
      );
      
      connection.release();
      
      if (subtasks.length === 0) {
        throw new Error(`Подзадача с id=${subtaskId} не найдена`);
      }
      
      return subtasks[0];
    } catch (error) {
      logger.error(`Ошибка при получении информации о подзадаче #${subtaskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает теги задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Array<string>>} - Массив тегов
   * @protected
   */
  async getTaskTags(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      connection.release();
      
      return taskTags.map(tag => tag.tag_name);
    } catch (error) {
      logger.error(`Ошибка при получении тегов задачи #${taskId}:`, error);
      return [];
    }
  }

  /**
   * Получает структуру проекта
   * @returns {Promise<Array<Object>>} - Массив с информацией о файлах проекта
   * @protected
   */
  async getProjectStructure() {
    try {
      const connection = await pool.getConnection();
      
      const [files] = await connection.query(
        'SELECT file_path, file_type FROM project_files WHERE project_id = ?',
        [this.projectId]
      );
      
      connection.release();
      
      return files;
    } catch (error) {
      logger.error(`Ошибка при получении структуры проекта #${this.projectId}:`, error);
      return [];
    }
  }

  /**
   * Получает содержимое файла проекта
   * @param {string} filePath - Путь к файлу
   * @returns {Promise<string|null>} - Содержимое файла или null, если файл не найден
   * @protected
   */
  async getFileContent(filePath) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем ID файла
      const [files] = await connection.query(
        'SELECT id FROM project_files WHERE project_id = ? AND file_path = ?',
        [this.projectId, filePath]
      );
      
      if (files.length === 0) {
        connection.release();
        return null;
      }
      
      const fileId = files[0].id;
      
      // Получаем содержимое файла из векторного хранилища
      const [codeSegments] = await connection.query(
        'SELECT code_segment FROM code_vectors WHERE file_id = ? ORDER BY start_line',
        [fileId]
      );
      
      connection.release();
      
      if (codeSegments.length === 0) {
        return null;
      }
      
      // Объединяем сегменты кода
      return codeSegments.map(segment => segment.code_segment).join('\n');
    } catch (error) {
      logger.error(`Ошибка при получении содержимого файла ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Сохраняет сгенерированный код
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} language - Язык программирования
   * @param {string} content - Сгенерированный код
   * @returns {Promise<Object>} - Информация о сохраненной генерации
   * @protected
   */
  async saveGeneratedCode(taskId, filePath, language, content) {
    try {
      const connection = await pool.getConnection();
      
      // Сохраняем информацию о генерации
      const [result] = await connection.query(
        `INSERT INTO code_generations 
         (task_id, file_path, language, generated_content, status, created_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [taskId, filePath, language, content, 'pending_review']
      );
      
      const generationId = result.insertId;
      
      connection.release();
      
      return {
        generationId,
        filePath,
        language,
        status: 'pending_review'
      };
    } catch (error) {
      logger.error(`Ошибка при сохранении сгенерированного кода для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Обновляет статус генерации кода
   * @param {number} generationId - ID генерации
   * @param {string} status - Новый статус
   * @param {Object} feedback - Обратная связь (опционально)
   * @returns {Promise<boolean>} - Успешно ли обновлен статус
   * @protected
   */
  async updateGenerationStatus(generationId, status, feedback = null) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        `UPDATE code_generations 
         SET status = ?, feedback = ?, updated_at = NOW() 
         WHERE id = ?`,
        [
          status,
          feedback ? JSON.stringify(feedback) : null,
          generationId
        ]
      );
      
      connection.release();
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса генерации #${generationId}:`, error);
      return false;
    }
  }

  /**
   * Определяет язык программирования по пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Язык программирования
   * @protected
   */
  detectLanguageFromFilePath(filePath) {
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
   * Извлекает код из ответа модели
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {string|null} - Извлеченный код или null, если код не найден
   * @protected
   */
  extractCodeFromResponse(response, language) {
    // Определяем язык для поиска блока кода
    const lang = language || '';
    
    // Ищем блок кода в формате ```язык ... ```
    const codeBlockRegex = new RegExp(`\`\`\`(?:${lang})?\\s*([\\s\\S]*?)\\s*\`\`\``, 'i');
    const match = response.match(codeBlockRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Если блок кода не найден, ищем весь текст как код
    // (это менее надежный вариант, но может быть полезен в некоторых случаях)
    return response.trim();
  }
}

module.exports = BaseCodeGenerator;
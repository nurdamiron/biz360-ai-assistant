// src/core/project-understanding/code-parser.js

const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Класс для сканирования и парсинга кодовой базы проекта
 */
class CodeParser {
  /**
   * @param {string} projectPath - Путь к корневой директории проекта
   * @param {number} projectId - ID проекта в БД
   */
  constructor(projectPath, projectId) {
    this.projectPath = projectPath;
    this.projectId = projectId;
    
    // Шаблоны файлов, которые нужно игнорировать
    this.ignorePatterns = [
      /node_modules/,
      /\.git/,
      /\.vscode/,
      /\.idea/,
      /\.DS_Store/,
      /\.env/,
      /dist/,
      /build/,
      /coverage/,
      /\.log$/,
      /package-lock\.json$/,
      /yarn\.lock$/
    ];
    
    // Типы файлов, которые будем индексировать
    this.fileTypes = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'json': 'json',
      'sql': 'sql',
      'md': 'markdown',
      'html': 'html',
      'css': 'css',
      'scss': 'scss'
    };
  }

  /**
   * Сканирует проект и индексирует найденные файлы
   * @returns {Promise<Array>} - Массив проиндексированных файлов
   */
  async scanAndIndexProject() {
    try {
      logger.info(`Начало сканирования проекта ${this.projectId} по пути: ${this.projectPath}`);
      
      // Получаем список всех файлов в проекте
      const allFiles = await this.scanDirectory(this.projectPath);
      
      // Индексируем найденные файлы
      const indexedFiles = await this.indexFiles(allFiles);
      
      logger.info(`Сканирование проекта ${this.projectId} завершено. Проиндексировано ${indexedFiles.length} файлов`);
      
      return indexedFiles;
    } catch (error) {
      logger.error(`Ошибка при сканировании проекта ${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Рекурсивно сканирует директорию и возвращает список файлов
   * @param {string} dirPath - Путь к директории
   * @param {Array} [results=[]] - Массив для накопления результатов
   * @returns {Promise<Array>} - Список путей к файлам
   */
  async scanDirectory(dirPath, results = []) {
    try {
      // Получаем содержимое директории
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      // Обрабатываем каждый элемент
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.projectPath, fullPath);
        
        // Пропускаем файлы и директории, которые нужно игнорировать
        if (this.shouldIgnore(relativePath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Рекурсивно сканируем поддиректорию
          await this.scanDirectory(fullPath, results);
        } else if (entry.isFile()) {
          // Добавляем файл в список
          const extension = path.extname(entry.name).slice(1).toLowerCase();
          
          // Проверяем, поддерживается ли тип файла
          if (this.fileTypes[extension]) {
            results.push({
              fullPath,
              relativePath,
              extension,
              type: this.fileTypes[extension]
            });
          }
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Ошибка при сканировании директории ${dirPath}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет, нужно ли игнорировать файл или директорию
   * @param {string} relativePath - Относительный путь к файлу или директории
   * @returns {boolean} - true, если нужно игнорировать
   */
  shouldIgnore(relativePath) {
    return this.ignorePatterns.some(pattern => pattern.test(relativePath));
  }

  /**
   * Индексирует файлы в базе данных
   * @param {Array} files - Список файлов для индексации
   * @returns {Promise<Array>} - Список проиндексированных файлов с ID
   */
  async indexFiles(files) {
    try {
      logger.info(`Индексация ${files.length} файлов для проекта ${this.projectId}`);
      
      const connection = await pool.getConnection();
      const indexedFiles = [];
      
      try {
        // Начинаем транзакцию
        await connection.beginTransaction();
        
        // Получаем список уже проиндексированных файлов
        const [existingFiles] = await connection.query(
          'SELECT id, file_path, file_hash FROM project_files WHERE project_id = ?',
          [this.projectId]
        );
        
        // Создаем Map для быстрого поиска по относительному пути
        const existingFilesMap = new Map();
        existingFiles.forEach(file => {
          existingFilesMap.set(file.file_path, file);
        });
        
        // Индексируем каждый файл
        for (const file of files) {
          try {
            // Вычисляем хеш файла
            const content = await fs.readFile(file.fullPath, 'utf8');
            const fileHash = this.calculateHash(content);
            
            // Проверяем, есть ли файл уже в БД
            const existingFile = existingFilesMap.get(file.relativePath);
            
            if (existingFile) {
              // Файл уже есть в БД, проверяем, изменился ли он
              if (existingFile.file_hash !== fileHash) {
                // Файл изменился, обновляем информацию
                await connection.query(
                  'UPDATE project_files SET file_hash = ?, updated_at = NOW() WHERE id = ?',
                  [fileHash, existingFile.id]
                );
                
                indexedFiles.push({
                  id: existingFile.id,
                  file_path: file.relativePath,
                  file_type: file.type,
                  updated: true
                });
              } else {
                // Файл не изменился
                indexedFiles.push({
                  id: existingFile.id,
                  file_path: file.relativePath,
                  file_type: file.type,
                  updated: false
                });
              }
            } else {
              // Файл новый, добавляем в БД
              const [result] = await connection.query(
                'INSERT INTO project_files (project_id, file_path, file_type, file_hash) VALUES (?, ?, ?, ?)',
                [this.projectId, file.relativePath, file.type, fileHash]
              );
              
              indexedFiles.push({
                id: result.insertId,
                file_path: file.relativePath,
                file_type: file.type,
                updated: true
              });
            }
          } catch (fileError) {
            // Логируем ошибку, но продолжаем индексацию других файлов
            logger.error(`Ошибка при индексации файла ${file.relativePath}:`, fileError);
          }
        }
        
        // Удаляем файлы, которых больше нет
        const currentFilePaths = files.map(file => file.relativePath);
        const filesToDelete = existingFiles.filter(file => 
          !currentFilePaths.includes(file.file_path)
        );
        
        if (filesToDelete.length > 0) {
          const fileIdsToDelete = filesToDelete.map(file => file.id);
          
          // Удаляем связанные записи
          await connection.query(
            'DELETE FROM code_vectors WHERE file_id IN (?)',
            [fileIdsToDelete]
          );
          
          // Удаляем файлы
          await connection.query(
            'DELETE FROM project_files WHERE id IN (?)',
            [fileIdsToDelete]
          );
          
          logger.info(`Удалено ${filesToDelete.length} устаревших файлов из индекса`);
        }
        
        // Фиксируем транзакцию
        await connection.commit();
        
        return indexedFiles;
      } catch (error) {
        // В случае ошибки отменяем транзакцию
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при индексации файлов:`, error);
      throw error;
    }
  }

  /**
   * Вычисляет хеш содержимого файла
   * @param {string} content - Содержимое файла
   * @returns {string} - Хеш в виде строки
   */
  calculateHash(content) {
    try {
      // Простой хеш, в реальном проекте должен быть более надежный
      const crypto = require('crypto');
      return crypto.createHash('md5').update(content).digest('hex');
    } catch (error) {
      logger.error('Ошибка при вычислении хеша файла:', error);
      // Возвращаем случайный хеш в случае ошибки
      return Math.random().toString(36).substring(2, 15);
    }
  }

  /**
   * Парсит содержимое файла и извлекает структурную информацию
   * @param {number} fileId - ID файла
   * @param {string} filePath - Полный путь к файлу
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} - Структурная информация о файле
   */
  async parseFile(fileId, filePath, fileType) {
    try {
      logger.debug(`Парсинг файла ${filePath}`);
      
      // Читаем содержимое файла
      const content = await fs.readFile(filePath, 'utf8');
      
      // Парсим файл в зависимости от его типа
      switch (fileType) {
        case 'javascript':
        case 'typescript':
          return await this.parseJSFile(fileId, content);
        case 'json':
          return await this.parseJSONFile(fileId, content);
        case 'sql':
          return await this.parseSQLFile(fileId, content);
        default:
          // Для других типов просто возвращаем базовую информацию
          return {
            fileId,
            fileType,
            structure: {}
          };
      }
    } catch (error) {
      logger.error(`Ошибка при парсинге файла ${filePath}:`, error);
      
      // Возвращаем минимальную информацию в случае ошибки
      return {
        fileId,
        fileType,
        structure: {},
        error: error.message
      };
    }
  }

  /**
   * Парсит JavaScript/TypeScript файл и извлекает структурную информацию
   * @param {number} fileId - ID файла
   * @param {string} content - Содержимое файла
   * @returns {Promise<Object>} - Структурная информация о файле
   */
  async parseJSFile(fileId, content) {
    // В реальном проекте здесь должен быть полноценный парсинг с использованием
    // таких библиотек, как acorn, esprima или babel-parser
    
    // Простое извлечение импортов, экспортов, функций и классов через регулярные выражения
    const imports = [];
    const exports = [];
    const functions = [];
    const classes = [];
    
    // Поиск импортов
    const importRegex = /import\s+(?:(?:{[\s\w,]+})|(?:[\w*]+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push({
        source: match[1],
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Поиск экспортов
    const exportRegex = /export\s+(?:default\s+)?(?:function|const|class|let|var)\s+(\w+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push({
        name: match[1],
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Поиск функций
    const functionRegex = /(?:function|const|let|var)\s+(\w+)\s*\(([^)]*)\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      functions.push({
        name: match[1],
        params: match[2],
        line: this.getLineNumber(content, match.index)
      });
    }
    
    // Поиск классов
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?/g;
    while ((match = classRegex.exec(content)) !== null) {
      classes.push({
        name: match[1],
        extends: match[2] || null,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return {
      fileId,
      fileType: 'javascript',
      structure: {
        imports,
        exports,
        functions,
        classes
      }
    };
  }

  /**
   * Парсит JSON файл и извлекает структурную информацию
   * @param {number} fileId - ID файла
   * @param {string} content - Содержимое файла
   * @returns {Promise<Object>} - Структурная информация о файле
   */
  async parseJSONFile(fileId, content) {
    try {
      const json = JSON.parse(content);
      
      return {
        fileId,
        fileType: 'json',
        structure: {
          keys: Object.keys(json),
          isPackageJson: json.name && json.version && json.dependencies
        }
      };
    } catch (error) {
      logger.error(`Ошибка при парсинге JSON файла:`, error);
      
      return {
        fileId,
        fileType: 'json',
        structure: {},
        error: error.message
      };
    }
  }

  /**
   * Парсит SQL файл и извлекает структурную информацию
   * @param {number} fileId - ID файла
   * @param {string} content - Содержимое файла
   * @returns {Promise<Object>} - Структурная информация о файле
   */
  async parseSQLFile(fileId, content) {
    // Простое извлечение SQL-запросов через регулярные выражения
    const queries = [];
    
    // Разделяем файл на запросы по точке с запятой
    const queryRegex = /^\s*(CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE)([^;]*);/gmi;
    let match;
    while ((match = queryRegex.exec(content)) !== null) {
      const queryType = match[1].toUpperCase();
      const queryContent = match[0];
      
      queries.push({
        type: queryType,
        content: queryContent,
        line: this.getLineNumber(content, match.index)
      });
    }
    
    return {
      fileId,
      fileType: 'sql',
      structure: {
        queries
      }
    };
  }

  /**
   * Получает номер строки по позиции в тексте
   * @param {string} content - Содержимое файла
   * @param {number} position - Позиция в тексте
   * @returns {number} - Номер строки
   */
  getLineNumber(content, position) {
    const lines = content.slice(0, position).split('\n');
    return lines.length;
  }
}

module.exports = CodeParser;
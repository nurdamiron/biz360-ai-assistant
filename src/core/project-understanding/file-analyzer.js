// src/core/project-understanding/file-analyzer.js

const fs = require('fs');
const path = require('path');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Класс для анализа файлов проекта и построения карты зависимостей
 */
class FileAnalyzer {
  /**
   * Конструктор класса
   * @param {number} projectId - ID проекта
   */
  constructor(projectId) {
    this.projectId = projectId;
    
    // Расширения файлов для анализа
    this.fileExtensions = {
      code: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.php', '.rb', '.c', '.cpp', '.go', '.cs'],
      config: ['.json', '.yaml', '.yml', '.xml', '.toml', '.ini'],
      markup: ['.html', '.md', '.css', '.scss', '.sass', '.less'],
      data: ['.sql', '.csv', '.tsv']
    };
    
    // Карта импортов/зависимостей между файлами
    this.dependencies = {};
    
    // Карта файлов и их содержимого
    this.files = {};
  }

  /**
   * Анализирует файлы проекта и обновляет информацию в БД
   * @param {string} repositoryPath - Путь к локальному репозиторию
   * @returns {Promise<Object>} - Результаты анализа
   */
  async analyzeProject(repositoryPath) {
    try {
      logger.info(`Начало анализа файлов проекта #${this.projectId}`);
      
      // Получаем список файлов проекта
      const allFiles = await this.scanDirectory(repositoryPath);
      
      // Фильтруем файлы, исключая node_modules, .git и другие служебные директории
      const codebases = allFiles.filter(file => {
        const relativePath = path.relative(repositoryPath, file);
        return !relativePath.includes('node_modules') && 
               !relativePath.includes('.git') &&
               !relativePath.includes('dist') &&
               !relativePath.includes('build') &&
               !relativePath.includes('.vscode');
      });
      
      // Анализируем каждый файл
      const analyzedFiles = [];
      
      for (const file of codebases) {
        const fileInfo = await this.analyzeFile(file, repositoryPath);
        if (fileInfo) {
          analyzedFiles.push(fileInfo);
        }
      }
      
      // Обновляем информацию в базе данных
      await this.updateDatabase(analyzedFiles);
      
      // Анализируем зависимости между файлами
      await this.analyzeDependencies(analyzedFiles);
      
      logger.info(`Анализ проекта #${this.projectId} завершен. Проанализировано ${analyzedFiles.length} файлов`);
      
      return {
        fileCount: analyzedFiles.length,
        fileTypes: this.groupFilesByType(analyzedFiles),
        dependencies: this.dependencies
      };
    } catch (error) {
      logger.error(`Ошибка при анализе проекта #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Сканирует директорию и возвращает список файлов
   * @param {string} dir - Путь к директории
   * @returns {Promise<Array<string>>} - Список файлов
   * @private
   */
  async scanDirectory(dir) {
    try {
      const files = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath);
          files.push(...subFiles);
        } else {
          files.push(fullPath);
        }
      }
      
      return files;
    } catch (error) {
      logger.error(`Ошибка при сканировании директории ${dir}:`, error);
      return [];
    }
  }

  /**
   * Анализирует файл и возвращает информацию о нем
   * @param {string} filePath - Путь к файлу
   * @param {string} repositoryPath - Путь к репозиторию
   * @returns {Promise<Object|null>} - Информация о файле или null в случае ошибки
   * @private
   */
  async analyzeFile(filePath, repositoryPath) {
    try {
      const extension = path.extname(filePath).toLowerCase();
      const relativePath = path.relative(repositoryPath, filePath);
      const stats = fs.statSync(filePath);
      
      // Определяем тип файла
      let fileType = 'other';
      
      for (const [type, extensions] of Object.entries(this.fileExtensions)) {
        if (extensions.includes(extension)) {
          fileType = type;
          break;
        }
      }
      
      // Создаем строковый хеш файла
      const content = fs.readFileSync(filePath, 'utf8');
      const fileHash = require('crypto').createHash('md5').update(content).digest('hex');
      
      // Сохраняем содержимое файла для последующего анализа
      this.files[relativePath] = content;
      
      return {
        path: relativePath,
        type: fileType,
        extension: extension.substring(1), // Без точки
        size: stats.size,
        lastModified: stats.mtime,
        content: content,
        hash: fileHash
      };
    } catch (error) {
      logger.error(`Ошибка при анализе файла ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Обновляет информацию о файлах в базе данных
   * @param {Array<Object>} files - Список проанализированных файлов
   * @returns {Promise<void>}
   * @private
   */
  async updateDatabase(files) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем список существующих файлов проекта
      const [existingFiles] = await connection.query(
        'SELECT file_path, file_hash FROM project_files WHERE project_id = ?',
        [this.projectId]
      );
      
      const existingFilePaths = existingFiles.reduce((map, file) => {
        map[file.file_path] = file.file_hash;
        return map;
      }, {});
      
      await connection.beginTransaction();
      
      try {
        // Обновляем или добавляем файлы
        for (const file of files) {
          if (existingFilePaths[file.path]) {
            // Файл существует, проверяем хеш на изменения
            if (existingFilePaths[file.path] !== file.hash) {
              // Файл изменился, обновляем
              await connection.query(
                `UPDATE project_files 
                 SET file_type = ?, file_hash = ?, file_size = ?, last_modified = ?, last_analyzed = NOW() 
                 WHERE project_id = ? AND file_path = ?`,
                [file.extension, file.hash, file.size, file.lastModified, this.projectId, file.path]
              );
              
              // Обновляем векторное представление
              await this.updateFileVectors(connection, file);
            }
          } else {
            // Файл новый, добавляем
            const [result] = await connection.query(
              `INSERT INTO project_files 
               (project_id, file_path, file_type, file_hash, file_size, created_at, last_modified, last_analyzed) 
               VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW())`,
              [this.projectId, file.path, file.extension, file.hash, file.size, file.lastModified]
            );
            
            // Создаем векторное представление
            await this.createFileVectors(connection, result.insertId, file);
          }
        }
        
        // Находим удаленные файлы
        const analyzedFilePaths = new Set(files.map(file => file.path));
        const deletedFilePaths = Object.keys(existingFilePaths).filter(
          path => !analyzedFilePaths.has(path)
        );
        
        // Удаляем информацию об удаленных файлах
        for (const filePath of deletedFilePaths) {
          await connection.query(
            'DELETE FROM project_files WHERE project_id = ? AND file_path = ?',
            [this.projectId, filePath]
          );
        }
        
        await connection.commit();
        
        logger.info(`Обновлена информация о файлах проекта #${this.projectId} в БД`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при обновлении информации о файлах проекта #${this.projectId} в БД:`, error);
      throw error;
    }
  }

  /**
   * Создает векторное представление файла
   * @param {Object} connection - Соединение с БД
   * @param {number} fileId - ID файла
   * @param {Object} file - Информация о файле
   * @returns {Promise<void>}
   * @private
   */
  async createFileVectors(connection, fileId, file) {
    try {
      // Разбиваем содержимое файла на сегменты (в простом случае - это весь файл)
      const segment = {
        content: file.content,
        startLine: 1,
        endLine: file.content.split('\n').length
      };
      
      // Создаем "пустое" векторное представление (в реальной системе тут был бы вызов к Embedding API)
      const embedding = JSON.stringify([]);
      
      // Сохраняем информацию в БД
      await connection.query(
        `INSERT INTO code_vectors (file_id, code_segment, start_line, end_line, embedding) 
         VALUES (?, ?, ?, ?, ?)`,
        [fileId, segment.content, segment.startLine, segment.endLine, embedding]
      );
    } catch (error) {
      logger.error(`Ошибка при создании векторного представления файла #${fileId}:`, error);
      throw error;
    }
  }

  /**
   * Обновляет векторное представление файла
   * @param {Object} connection - Соединение с БД
   * @param {Object} file - Информация о файле
   * @returns {Promise<void>}
   * @private
   */
  async updateFileVectors(connection, file) {
    try {
      // Получаем ID файла
      const [files] = await connection.query(
        'SELECT id FROM project_files WHERE project_id = ? AND file_path = ?',
        [this.projectId, file.path]
      );
      
      if (files.length === 0) {
        return;
      }
      
      const fileId = files[0].id;
      
      // Удаляем существующие векторы
      await connection.query(
        'DELETE FROM code_vectors WHERE file_id = ?',
        [fileId]
      );
      
      // Создаем новое векторное представление
      await this.createFileVectors(connection, fileId, file);
    } catch (error) {
      logger.error(`Ошибка при обновлении векторного представления файла ${file.path}:`, error);
      throw error;
    }
  }

  /**
   * Анализирует зависимости между файлами
   * @param {Array<Object>} files - Список проанализированных файлов
   * @returns {Promise<void>}
   * @private
   */
  async analyzeDependencies(files) {
    try {
      // Создаем карту файлов для быстрого доступа
      const fileMap = {};
      files.forEach(file => {
        fileMap[file.path] = file;
      });
      
      // Для каждого файла анализируем зависимости
      for (const file of files) {
        const dependencies = await this.findDependencies(file, fileMap);
        this.dependencies[file.path] = dependencies;
      }
      
      // Сохраняем зависимости в БД
      await this.saveDependencies();
      
      logger.info(`Проанализированы зависимости для ${files.length} файлов проекта #${this.projectId}`);
    } catch (error) {
      logger.error(`Ошибка при анализе зависимостей проекта #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Находит зависимости файла
   * @param {Object} file - Информация о файле
   * @param {Object} fileMap - Карта файлов проекта
   * @returns {Promise<Array<string>>} - Список зависимостей
   * @private
   */
  async findDependencies(file, fileMap) {
    try {
      const dependencies = [];
      const extension = file.extension;
      
      // Разные шаблоны импортов для разных языков
      if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
        // JavaScript/TypeScript
        const importRegexes = [
          /import\s+.+\s+from\s+['"]([^'"]+)['"]/g,
          /require\(['"]([^'"]+)['"]\)/g
        ];
        
        for (const regex of importRegexes) {
          let match;
          while ((match = regex.exec(file.content)) !== null) {
            const importPath = match[1];
            
            // Преобразуем относительный путь в абсолютный
            const resolvedPath = this.resolveImportPath(file.path, importPath);
            if (resolvedPath && fileMap[resolvedPath]) {
              dependencies.push(resolvedPath);
            }
          }
        }
      } else if (extension === 'py') {
        // Python
        const importRegexes = [
          /import\s+([^\s]+)/g,
          /from\s+([^\s]+)\s+import/g
        ];
        
        for (const regex of importRegexes) {
          let match;
          while ((match = regex.exec(file.content)) !== null) {
            const importPath = match[1].replace(/\./g, '/') + '.py';
            
            // Преобразуем модуль Python в путь к файлу
            const resolvedPath = this.resolveImportPath(file.path, importPath);
            if (resolvedPath && fileMap[resolvedPath]) {
              dependencies.push(resolvedPath);
            }
          }
        }
      }
      // Можно добавить поддержку других языков
      
      return dependencies;
    } catch (error) {
      logger.error(`Ошибка при определении зависимостей файла ${file.path}:`, error);
      return [];
    }
  }

  /**
   * Преобразует импортируемый путь в абсолютный путь
   * @param {string} filePath - Путь к файлу, содержащему импорт
   * @param {string} importPath - Импортируемый путь
   * @returns {string|null} - Абсолютный путь к импортируемому файлу или null
   * @private
   */
  resolveImportPath(filePath, importPath) {
    try {
      // Проверяем, локальный ли импорт
      if (importPath.startsWith('.')) {
        const basePath = path.dirname(filePath);
        return path.normalize(path.join(basePath, importPath));
      }
      
      // Для нелокальных импортов возвращаем null
      // В реальной системе тут был бы более сложный механизм разрешения путей
      return null;
    } catch (error) {
      logger.error(`Ошибка при разрешении импорта ${importPath} в файле ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Сохраняет информацию о зависимостях в БД
   * @returns {Promise<void>}
   * @private
   */
  async saveDependencies() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем ID-файлов по путям
      const fileIds = {};
      
      const [files] = await connection.query(
        'SELECT id, file_path FROM project_files WHERE project_id = ?',
        [this.projectId]
      );
      
      files.forEach(file => {
        fileIds[file.file_path] = file.id;
      });
      
      await connection.beginTransaction();
      
      try {
        // Удаляем существующие зависимости
        await connection.query(
          'DELETE FROM file_dependencies WHERE project_id = ?',
          [this.projectId]
        );
        
        // Сохраняем новые зависимости
        for (const [sourceFile, dependencies] of Object.entries(this.dependencies)) {
          if (!fileIds[sourceFile] || dependencies.length === 0) {
            continue;
          }
          
          for (const dependencyFile of dependencies) {
            if (!fileIds[dependencyFile]) {
              continue;
            }
            
            await connection.query(
              `INSERT INTO file_dependencies 
               (project_id, source_file_id, dependent_file_id, created_at) 
               VALUES (?, ?, ?, NOW())`,
              [this.projectId, fileIds[sourceFile], fileIds[dependencyFile]]
            );
          }
        }
        
        await connection.commit();
        
        logger.info(`Сохранены зависимости между файлами проекта #${this.projectId}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при сохранении зависимостей проекта #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Группирует файлы по типам
   * @param {Array<Object>} files - Список файлов
   * @returns {Object} - Группировка файлов по типам
   * @private
   */
  groupFilesByType(files) {
    const result = {};
    
    files.forEach(file => {
      if (!result[file.type]) {
        result[file.type] = 0;
      }
      
      result[file.type]++;
    });
    
    return result;
  }

  /**
   * Находит файлы, релевантные указанной задаче
   * @param {number} taskId - ID задачи
   * @param {string} description - Описание задачи
   * @returns {Promise<Array<Object>>} - Список релевантных файлов
   */
  async findRelevantFiles(taskId, description) {
    try {
      logger.info(`Поиск релевантных файлов для задачи #${taskId}`);
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Получаем теги задачи для улучшения поиска
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      // Получаем список файлов проекта
      const [projectFiles] = await connection.query(
        'SELECT id, file_path, file_type FROM project_files WHERE project_id = ?',
        [task.project_id]
      );
      
      connection.release();
      
      // Извлекаем ключевые слова из описания задачи
      const keywords = this.extractKeywords(description, tags);
      
      // Находим файлы, содержащие ключевые слова
      // В реальной системе здесь был бы более сложный алгоритм
      const relevantFiles = [];
      
      for (const file of projectFiles) {
        const filePath = file.file_path.toLowerCase();
        let score = 0;
        
        // Проверяем название файла на соответствие ключевым словам
        keywords.forEach(keyword => {
          if (filePath.includes(keyword.toLowerCase())) {
            score += 1;
          }
        });
        
        // Если набрали минимальный score, добавляем файл в релевантные
        if (score > 0) {
          const content = await this.getFileContent(file.id);
          
          relevantFiles.push({
            id: file.id,
            path: file.file_path,
            type: file.file_type,
            content,
            score
          });
        }
      }
      
      // Сортируем по релевантности и ограничиваем количество
      return relevantFiles
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    } catch (error) {
      logger.error(`Ошибка при поиске релевантных файлов для задачи #${taskId}:`, error);
      return [];
    }
  }

  /**
   * Получает содержимое файла по ID
   * @param {number} fileId - ID файла
   * @returns {Promise<string|null>} - Содержимое файла или null
   * @private
   */
  async getFileContent(fileId) {
    try {
      const connection = await pool.getConnection();
      
      const [segments] = await connection.query(
        'SELECT code_segment FROM code_vectors WHERE file_id = ? ORDER BY start_line',
        [fileId]
      );
      
      connection.release();
      
      if (segments.length === 0) {
        return null;
      }
      
      return segments.map(segment => segment.code_segment).join('\n');
    } catch (error) {
      logger.error(`Ошибка при получении содержимого файла #${fileId}:`, error);
      return null;
    }
  }

  /**
   * Извлекает ключевые слова из текста
   * @param {string} text - Исходный текст
   * @param {Array<string>} additionalKeywords - Дополнительные ключевые слова
   * @returns {Array<string>} - Список ключевых слов
   * @private
   */
  extractKeywords(text, additionalKeywords = []) {
    // В реальной системе здесь был бы более сложный алгоритм
    // Например, с использованием NLP или машинного обучения
    
    // Простая реализация: разбиваем текст на слова, удаляем стоп-слова
    const stopWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'with', 'for', 'to', 'is', 'are'];
    
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.includes(word));
    
    // Добавляем дополнительные ключевые слова
    return [...new Set([...words, ...additionalKeywords])];
  }
}

module.exports = FileAnalyzer;
// src/core/project-understanding/code-indexer.js

const { pool } = require('../../config/db.config');
const { getLLMClient } = require('../../utils/llm-client');
const CodeParser = require('./code-parser');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../../utils/logger');

/**
 * Класс для индексации и создания векторных представлений кода
 */
class CodeIndexer {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.batchSize = 5; // Количество файлов в одной партии для индексации
  }

  /**
   * Разбивает содержимое файла на семантические блоки
   * @param {string} content - Содержимое файла
   * @param {string} fileType - Тип файла
   * @returns {Array} - Массив блоков кода с информацией о строках
   */
  segmentCodeContent(content, fileType) {
    const lines = content.split('\n');
    const segments = [];
    
    // Простой алгоритм сегментации для JavaScript:
    // Объединяем все импорты в один сегмент
    // Каждая функция/класс в отдельный сегмент
    
    if (fileType === 'javascript') {
      let currentSegment = {
        content: '',
        start: 0,
        end: 0
      };
      
      let inFunction = false;
      let bracketCount = 0;
      
      lines.forEach((line, index) => {
        const lineNum = index + 1;
        
        // Импорты группируем вместе
        if (line.trim().startsWith('import ') || line.trim().startsWith('const ') || line.trim().startsWith('let ')) {
          if (inFunction) {
            // Если мы уже внутри функции, строка является частью этой функции
            currentSegment.content += line + '\n';
            currentSegment.end = lineNum;
          } else {
            // Если мы не внутри функции, и предыдущий сегмент не пуст, сохраняем его
            if (currentSegment.content) {
              segments.push({ ...currentSegment });
              currentSegment = { content: line + '\n', start: lineNum, end: lineNum };
            } else {
              // Если текущий сегмент пуст, начинаем новый
              currentSegment.content = line + '\n';
              currentSegment.start = lineNum;
              currentSegment.end = lineNum;
            }
          }
        } 
        // Определение начала функции или класса
        else if (line.includes('function ') || line.includes('=>') || line.includes('class ')) {
          // Завершаем предыдущий сегмент, если он не пуст
          if (currentSegment.content && !inFunction) {
            segments.push({ ...currentSegment });
            currentSegment = { content: line + '\n', start: lineNum, end: lineNum };
          } else {
            currentSegment.content += line + '\n';
            currentSegment.end = lineNum;
          }
          
          inFunction = true;
          
          // Увеличиваем счетчик фигурных скобок
          bracketCount += (line.match(/{/g) || []).length;
          bracketCount -= (line.match(/}/g) || []).length;
        } 
        // Считаем фигурные скобки для определения границы функции
        else {
          currentSegment.content += line + '\n';
          currentSegment.end = lineNum;
          
          if (inFunction) {
            bracketCount += (line.match(/{/g) || []).length;
            bracketCount -= (line.match(/}/g) || []).length;
            
            // Если скобки сбалансированы, функция завершена
            if (bracketCount === 0) {
              inFunction = false;
              segments.push({ ...currentSegment });
              currentSegment = { content: '', start: 0, end: 0 };
            }
          }
        }
      });
      
      // Добавляем последний сегмент, если он не пуст
      if (currentSegment.content) {
        segments.push(currentSegment);
      }
    } else {
      // Для других типов файлов просто берем весь файл как один сегмент
      segments.push({
        content: content,
        start: 1,
        end: lines.length
      });
    }
    
    return segments;
  }

  /**
   * Создает векторное представление для сегмента кода через LLM API
   * @param {string} codeSegment - Сегмент кода
   * @returns {Promise<Array>} - Векторное представление
   */
  async createEmbedding(codeSegment) {
    try {
      // Создаем эмбеддинг через LLM API
      const embedding = await this.llmClient.createEmbedding(codeSegment);
      return embedding;
    } catch (error) {
      logger.error('Ошибка при создании векторного представления:', error);
      // В случае ошибки возвращаем пустой массив
      return [];
    }
  }

  /**
   * Индексирует файл и создает векторные представления его сегментов
   * @param {number} fileId - ID файла
   * @param {string} filePath - Путь к файлу
   * @param {string} content - Содержимое файла
   * @param {string} fileType - Тип файла
   * @returns {Promise<void>}
   */
  async indexFile(fileId, filePath, content, fileType) {
    try {
      logger.info(`Индексация файла: ${filePath}`);
      
      // Разбиваем код на сегменты
      const segments = this.segmentCodeContent(content, fileType);
      
      logger.debug(`Файл ${filePath} разбит на ${segments.length} сегментов`);
      
      const connection = await pool.getConnection();
      
      try {
        await connection.beginTransaction();
        
        // Удаляем существующие сегменты для этого файла
        await connection.query(
          'DELETE FROM code_vectors WHERE file_id = ?',
          [fileId]
        );
        
        // Индексируем каждый сегмент
        for (const segment of segments) {
          const embedding = await this.createEmbedding(segment.content);
          
          if (embedding.length > 0) {
            await connection.query(
              'INSERT INTO code_vectors (file_id, code_segment, start_line, end_line, embedding) VALUES (?, ?, ?, ?, ?)',
              [fileId, segment.content, segment.start, segment.end, JSON.stringify(embedding)]
            );
          }
        }
        
        // Обновляем дату последнего анализа файла
        await connection.query(
          'UPDATE project_files SET last_analyzed = NOW() WHERE id = ?',
          [fileId]
        );
        
        await connection.commit();
        
        logger.info(`Успешно проиндексирован файл ${filePath}`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при индексации файла ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Запуск индексации для проекта
   * @param {string} projectPath - Абсолютный путь к проекту
   * @returns {Promise<void>}
   */
  async indexProject(projectPath) {
    try {
      logger.info(`Начало индексации проекта #${this.projectId}`);
      
      // Сканируем проект и получаем все файлы
      const codeParser = new CodeParser(projectPath, this.projectId);
      const projectFiles = await codeParser.scanAndIndexProject();
      
      // Получаем из БД информацию о файлах
      const connection = await pool.getConnection();
      
      try {
        const [files] = await connection.query(
          'SELECT id, file_path, file_type, last_analyzed FROM project_files WHERE project_id = ?',
          [this.projectId]
        );
        
        connection.release();
        
        // Обрабатываем файлы группами для уменьшения нагрузки на API
        const fileGroups = [];
        for (let i = 0; i < files.length; i += this.batchSize) {
          fileGroups.push(files.slice(i, i + this.batchSize));
        }
        
        // Обрабатываем каждую группу файлов
        for (const group of fileGroups) {
          const indexPromises = group.map(async (file) => {
            const absolutePath = path.join(projectPath, file.file_path);
            
            // Проверяем, существует ли файл
            try {
              // Читаем содержимое файла
              const content = await fs.readFile(absolutePath, 'utf8');
              
              // Индексируем файл
              await this.indexFile(file.id, file.file_path, content, file.file_type);
            } catch (error) {
              logger.error(`Ошибка при обработке файла ${file.file_path}:`, error);
            }
          });
          
          // Ждем завершения индексации текущей группы
          await Promise.all(indexPromises);
        }
        
        logger.info(`Индексация проекта #${this.projectId} завершена`);
      } catch (error) {
        logger.error(`Ошибка при получении информации о файлах:`, error);
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при индексации проекта:`, error);
      throw error;
    }
  }

  /**
   * Поиск похожего кода по векторному представлению
   * @param {string} query - Запрос для поиска
   * @param {number} limit - Максимальное количество результатов
   * @returns {Promise<Array>} - Массив найденных сегментов кода
   */
  async searchSimilarCode(query, limit = 5) {
    try {
      // Создаем эмбеддинг для запроса
      const queryEmbedding = await this.createEmbedding(query);
      
      if (queryEmbedding.length === 0) {
        return [];
      }
      
      const connection = await pool.getConnection();
      
      try {
        // В реальности здесь должен быть сложный запрос для поиска ближайших векторов
        // Для примера используем упрощенный запрос
        const [results] = await connection.query(
          `SELECT cv.*, pf.file_path 
           FROM code_vectors cv 
           JOIN project_files pf ON cv.file_id = pf.id 
           WHERE pf.project_id = ? 
           LIMIT ?`,
          [this.projectId, limit]
        );
        
        connection.release();
        
        // Здесь должен быть код для расчета косинусного сходства
        // между queryEmbedding и каждым embedding из результатов
        // и сортировки результатов по этому показателю
        
        return results.map(result => ({
          file_path: result.file_path,
          code_segment: result.code_segment,
          start_line: result.start_line,
          end_line: result.end_line
        }));
      } catch (error) {
        connection.release();
        throw error;
      }
    } catch (error) {
      logger.error('Ошибка при поиске похожего кода:', error);
      return [];
    }
  }
}

module.exports = CodeIndexer;
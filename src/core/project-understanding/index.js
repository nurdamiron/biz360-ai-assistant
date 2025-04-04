// src/core/project-understanding/index.js

const CodeParser = require('./code-parser');
const CodeIndexer = require('./code-indexer');
const SchemaAnalyzer = require('./schema-analyzer');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

/**
 * Класс для анализа и понимания структуры проекта
 */
class ProjectUnderstanding {
  constructor(projectId) {
    this.projectId = projectId;
    this.workingDir = path.join(os.tmpdir(), 'biz360-analysis', `project-${projectId}`);
  }

  /**
   * Анализирует проект
   * @param {string} repositoryUrl - URL репозитория проекта
   * @returns {Promise<void>}
   */
  async analyzeProject(repositoryUrl) {
    try {
      logger.info(`Начало анализа проекта #${this.projectId}`);
      
      // Создаем рабочую директорию, если она не существует
      await fs.mkdir(this.workingDir, { recursive: true });
      
      // Инициализируем парсер кода
      const codeParser = new CodeParser(this.workingDir, this.projectId);
      
      // Сканируем и индексируем файлы проекта
      const files = await codeParser.scanAndIndexProject();
      
      logger.info(`Найдено ${files.length} файлов в проекте #${this.projectId}`);
      
      // Индексируем код для векторного поиска
      const codeIndexer = new CodeIndexer(this.projectId);
      await codeIndexer.indexProject(this.workingDir);
      
      // Анализируем схему БД проекта
      // В реальной реализации здесь должна быть логика для получения конфигурации БД проекта
      const dbConfig = {
        host: 'localhost',
        user: 'root',
        password: 'password',
        database: 'biz360_crm'
      };
      
      const schemaAnalyzer = new SchemaAnalyzer(dbConfig);
      await schemaAnalyzer.analyzeSchema();
      
      // Обновляем статус анализа проекта
      await this.updateProjectAnalysisStatus();
      
      logger.info(`Проект #${this.projectId} успешно проанализирован`);
    } catch (error) {
      logger.error(`Ошибка при анализе проекта #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Обновляет статус анализа проекта
   * @returns {Promise<void>}
   */
  async updateProjectAnalysisStatus() {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'UPDATE projects SET last_analyzed = NOW() WHERE id = ?',
        [this.projectId]
      );
      
      connection.release();
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса анализа проекта #${this.projectId}:`, error);
    }
  }

  /**
   * Получает информацию о структуре проекта
   * @returns {Promise<Object>} - Структура проекта
   */
  async getProjectStructure() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем список файлов
      const [files] = await connection.query(
        'SELECT * FROM project_files WHERE project_id = ?',
        [this.projectId]
      );
      
      // Группируем файлы по типам
      const filesByType = {};
      
      for (const file of files) {
        if (!filesByType[file.file_type]) {
          filesByType[file.file_type] = [];
        }
        
        filesByType[file.file_type].push(file);
      }
      
      // Получаем информацию о таблицах БД
      const [tables] = await connection.query(
        'SELECT * FROM schema_tables'
      );
      
      // Получаем информацию о связях между таблицами
      const [relations] = await connection.query(
        'SELECT * FROM schema_relations'
      );
      
      connection.release();
      
      return {
        files: filesByType,
        database: {
          tables,
          relations
        }
      };
    } catch (error) {
      logger.error(`Ошибка при получении структуры проекта #${this.projectId}:`, error);
      throw error;
    }
  }

  /**
   * Ищет релевантные файлы по запросу
   * @param {string} query - Запрос для поиска
   * @param {number} limit - Максимальное количество результатов
   * @returns {Promise<Array>} - Массив найденных файлов
   */
  async searchRelevantFiles(query, limit = 5) {
    try {
      const codeIndexer = new CodeIndexer(this.projectId);
      
      // Ищем похожий код по запросу
      const results = await codeIndexer.searchSimilarCode(query, limit);
      
      return results;
    } catch (error) {
      logger.error(`Ошибка при поиске релевантных файлов по запросу "${query}":`, error);
      return [];
    }
  }

  /**
   * Получает граф зависимостей файлов
   * @returns {Promise<Object>} - Граф зависимостей
   */
  async getDependencyGraph() {
    // В реальной системе здесь должна быть сложная логика анализа зависимостей
    // Возвращаем заглушку
    return {
      nodes: [],
      edges: []
    };
  }
}

module.exports = ProjectUnderstanding;
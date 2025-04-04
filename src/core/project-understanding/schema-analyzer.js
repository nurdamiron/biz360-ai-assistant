// src/core/project-understanding/schema-analyzer.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Класс для анализа схемы базы данных проекта
 */
class SchemaAnalyzer {
  /**
   * Конструктор класса SchemaAnalyzer
   * @param {Object} dbConfig - Конфигурация подключения к БД проекта (не ассистента)
   */
  constructor(dbConfig) {
    this.dbConfig = dbConfig;
    this.tables = [];
    this.relations = [];
  }

  /**
   * Устанавливает соединение с БД проекта
   * @returns {Promise<Object>} - Соединение с БД
   */
  async connect() {
    try {
      const connection = await pool.getConnection();
      return connection;
    } catch (error) {
      logger.error('Ошибка при подключении к БД проекта:', error);
      throw error;
    }
  }

  /**
   * Получает список таблиц в БД
   * @param {Object} connection - Соединение с БД
   * @returns {Promise<Array>} - Список таблиц
   */
  async getTables(connection) {
    try {
      const [result] = await connection.query(
        'SHOW TABLES FROM ??',
        [this.dbConfig.database]
      );
      
      return result.map(row => Object.values(row)[0]);
    } catch (error) {
      logger.error('Ошибка при получении списка таблиц:', error);
      throw error;
    }
  }

  /**
   * Получает структуру таблицы
   * @param {Object} connection - Соединение с БД
   * @param {string} tableName - Имя таблицы
   * @returns {Promise<Object>} - Структура таблицы
   */
  async getTableStructure(connection, tableName) {
    try {
      // Получаем структуру таблицы
      const [columns] = await connection.query(
        'SHOW FULL COLUMNS FROM ??',
        [tableName]
      );
      
      // Получаем индексы таблицы
      const [indexes] = await connection.query(
        'SHOW INDEX FROM ??',
        [tableName]
      );
      
      // Получаем информацию о внешних ключах
      const [create] = await connection.query(
        'SHOW CREATE TABLE ??',
        [tableName]
      );
      
      const createStatement = create[0]['Create Table'];
      
      // Извлекаем внешние ключи из CREATE TABLE
      const foreignKeys = [];
      const fkRegex = /FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)`\(`(\w+)`\)(\s+ON DELETE (\w+))?(\s+ON UPDATE (\w+))?/g;
      
      let match;
      while ((match = fkRegex.exec(createStatement)) !== null) {
        foreignKeys.push({
          column: match[1],
          referenced_table: match[2],
          referenced_column: match[3],
          on_delete: match[5] || 'RESTRICT',
          on_update: match[7] || 'RESTRICT'
        });
      }
      
      return {
        name: tableName,
        columns: columns.map(col => ({
          name: col.Field,
          type: col.Type,
          nullable: col.Null === 'YES',
          key: col.Key,
          default: col.Default,
          extra: col.Extra,
          comment: col.Comment
        })),
        indexes: this.groupIndexes(indexes),
        foreign_keys: foreignKeys
      };
    } catch (error) {
      logger.error(`Ошибка при получении структуры таблицы ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Группирует индексы по имени
   * @param {Array} indexes - Массив индексов
   * @returns {Array} - Сгруппированные индексы
   */
  groupIndexes(indexes) {
    const groupedIndexes = {};
    
    indexes.forEach(index => {
      const indexName = index.Key_name;
      
      if (!groupedIndexes[indexName]) {
        groupedIndexes[indexName] = {
          name: indexName,
          columns: [],
          unique: index.Non_unique === 0,
          type: index.Index_type
        };
      }
      
      groupedIndexes[indexName].columns.push({
        name: index.Column_name,
        position: index.Seq_in_index
      });
    });
    
    return Object.values(groupedIndexes);
  }

  /**
   * Анализирует схему БД и строит граф связей
   * @returns {Promise<Object>} - Модель схемы БД
   */
  async analyzeSchema() {
    let connection;
    
    try {
      connection = await this.connect();
      
      // Получаем список таблиц
      const tableNames = await this.getTables(connection);
      logger.info(`Найдено ${tableNames.length} таблиц в БД`);
      
      // Получаем структуру каждой таблицы
      const tablesPromises = tableNames.map(tableName => 
        this.getTableStructure(connection, tableName)
      );
      
      this.tables = await Promise.all(tablesPromises);
      
      // Строим граф отношений между таблицами
      this.buildRelationsGraph();
      
      // Сохраняем результат в нашу БД
      await this.saveSchemaToDb();
      
      logger.info('Анализ схемы БД успешно завершен');
      
      return {
        tables: this.tables,
        relations: this.relations
      };
    } catch (error) {
      logger.error('Ошибка при анализе схемы БД:', error);
      throw error;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  /**
   * Строит граф отношений между таблицами
   * @returns {void}
   */
  buildRelationsGraph() {
    this.relations = [];
    
    this.tables.forEach(table => {
      table.foreign_keys.forEach(fk => {
        this.relations.push({
          source_table: table.name,
          source_column: fk.column,
          target_table: fk.referenced_table,
          target_column: fk.referenced_column,
          on_delete: fk.on_delete,
          on_update: fk.on_update
        });
      });
    });
    
    logger.info(`Построен граф отношений с ${this.relations.length} связями`);
  }

  /**
   * Сохраняет проанализированную схему в БД проекта
   * @returns {Promise<void>}
   */
  async saveSchemaToDb() {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Предполагаем, что у нас есть таблица для хранения схемы БД
      // Эта таблица должна быть добавлена в схему БД ассистента
      
      // Сохраняем информацию о таблицах
      for (const table of this.tables) {
        const [result] = await connection.query(
          `INSERT INTO schema_tables 
           (name, structure) 
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE structure = ?`,
          [table.name, JSON.stringify(table), JSON.stringify(table)]
        );
        
        const tableId = result.insertId || result.id;
        
        // Сохраняем информацию о колонках
        for (const column of table.columns) {
          await connection.query(
            `INSERT INTO schema_columns
             (table_id, name, type, nullable, description)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
             type = ?, nullable = ?, description = ?`,
            [
              tableId, 
              column.name, 
              column.type, 
              column.nullable, 
              column.comment,
              column.type, 
              column.nullable, 
              column.comment
            ]
          );
        }
      }
      
      // Сохраняем информацию о связях
      for (const relation of this.relations) {
        await connection.query(
          `INSERT INTO schema_relations
           (source_table, source_column, target_table, target_column, on_delete, on_update)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           on_delete = ?, on_update = ?`,
          [
            relation.source_table,
            relation.source_column,
            relation.target_table,
            relation.target_column,
            relation.on_delete,
            relation.on_update,
            relation.on_delete,
            relation.on_update
          ]
        );
      }
      
      await connection.commit();
      logger.info('Схема БД успешно сохранена в БД ассистента');
    } catch (error) {
      await connection.rollback();
      logger.error('Ошибка при сохранении схемы БД:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Получает представление схемы БД в формате ER-диаграммы
   * @returns {string} - ER-диаграмма в формате Mermaid
   */
  getERDiagram() {
    let diagram = 'erDiagram\n';
    
    // Добавляем таблицы и их колонки
    this.tables.forEach(table => {
      diagram += `    ${table.name} {\n`;
      
      table.columns.forEach(column => {
        const nullable = column.nullable ? 'NULL' : 'NOT NULL';
        const comment = column.comment ? `"${column.comment}"` : '';
        
        diagram += `        ${column.type} ${column.name} ${nullable} ${comment}\n`;
      });
      
      diagram += '    }\n';
    });
    
    // Добавляем связи между таблицами
    this.relations.forEach(relation => {
      const cardinality = '||--o{';  // Предполагаем связь one-to-many
      
      diagram += `    ${relation.source_table} ${cardinality} ${relation.target_table} : "${relation.source_column} -> ${relation.target_column}"\n`;
    });
    
    return diagram;
  }
}

module.exports = SchemaAnalyzer;
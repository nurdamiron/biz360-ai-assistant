/**
 * Хранилище векторных эмбеддингов для системы обучения
 * Позволяет сохранять и находить похожие задачи и решения
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const config = require('../../config/app.config');
const { Pool } = require('pg'); // Требуется установка: npm install pg

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
    // Настройки векторной БД
    vectorStore: {
        type: 'pg', // 'pg' (PostgreSQL с pgvector), 'memory' (in-memory для тестов)
        pgOptions: null, // Настройки подключения к Postgres
        // Специфичные для выбранного хранилища, по умолчанию null
        embeddingDimension: 1536, // Размерность векторов (1536 для OpenAI, 768 для многих других)
        tableName: 'vector_embeddings',
        indexName: 'vector_idx',
        maxConnections: 10,
        idleTimeoutMillis: 30000
    },
    // Настройки индексирования
    indexing: {
        chunkSize: 1024, // Размер кусков текста для векторизации
        chunkOverlap: 200, // Перекрытие между кусками текста
        maxElementsPerTask: 10000 // Максимальное количество элементов на задачу
    }
};

// Возможные схемы хранения
const SCHEMAS = {
    // Схема для хранения задач и их решений
    taskSolution: {
        name: 'task_solution',
        fields: [
            { name: 'id', type: 'string', primaryKey: true },
            { name: 'task_description', type: 'text', indexed: true },
            { name: 'task_type', type: 'string', indexed: true },
            { name: 'solution', type: 'text' },
            { name: 'context', type: 'jsonb' },
            { name: 'success_rating', type: 'float' },
            { name: 'created_at', type: 'timestamp' },
            { name: 'metadata', type: 'jsonb' },
            { name: 'embedding', type: 'vector' } // Векторное представление task_description
        ]
    },
    // Схема для хранения проектного контекста
    projectContext: {
        name: 'project_context',
        fields: [
            { name: 'id', type: 'string', primaryKey: true },
            { name: 'project_id', type: 'string', indexed: true },
            { name: 'content_chunk', type: 'text' },
            { name: 'source_file', type: 'string', indexed: true },
            { name: 'chunk_type', type: 'string', indexed: true }, // code, comment, doc, etc.
            { name: 'created_at', type: 'timestamp' },
            { name: 'metadata', type: 'jsonb' },
            { name: 'embedding', type: 'vector' } // Векторное представление content_chunk
        ]
    },
    // Схема для хранения промптов
    promptTemplate: {
        name: 'prompt_template',
        fields: [
            { name: 'id', type: 'string', primaryKey: true },
            { name: 'name', type: 'string', indexed: true },
            { name: 'description', type: 'text' },
            { name: 'template', type: 'text' },
            { name: 'tags', type: 'string[]', indexed: true },
            { name: 'success_rating', type: 'float' },
            { name: 'created_at', type: 'timestamp' },
            { name: 'metadata', type: 'jsonb' },
            { name: 'embedding', type: 'vector' } // Векторное представление template + description
        ]
    }
};

// Singleton instance
let instance = null;

/**
 * Класс для работы с векторным хранилищем
 */
class VectorStore {
    /**
     * Конструктор
     * 
     * @param {Object} options - Опции инициализации
     */
    constructor(options = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...options
        };
        
        this.isInitialized = false;
        this.store = null;
        this.metrics = {
            queries: 0,
            insertions: 0,
            deletions: 0,
            updates: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // Кэш для часто используемых запросов
        this.queryCache = new Map();
    }
    
    /**
     * Инициализирует хранилище
     * 
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        
        logger.info('Initializing vector store', { 
            storeType: this.config.vectorStore.type 
        });
        
        try {
            // Выбираем реализацию хранилища
            if (this.config.vectorStore.type === 'pg') {
                await this._initPostgresStore();
            } else if (this.config.vectorStore.type === 'memory') {
                await this._initMemoryStore();
            } else {
                throw new Error(`Unsupported vector store type: ${this.config.vectorStore.type}`);
            }
            
            this.isInitialized = true;
            logger.info('Vector store initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize vector store', { 
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    
    /**
     * Инициализирует хранилище на базе PostgreSQL с расширением pgvector
     * 
     * @private
     * @returns {Promise<void>}
     */
    async _initPostgresStore() {
        try {
            // Получаем параметры подключения к PostgreSQL
            const pgOptions = this.config.vectorStore.pgOptions || 
                              config.database?.postgres || 
                              { 
                                connectionString: process.env.DATABASE_URL,
                                ssl: process.env.NODE_ENV === 'production' ? 
                                    { rejectUnauthorized: false } : false
                              };
            
            // Создаем пул подключений
            this.store = new Pool({
                ...pgOptions,
                max: this.config.vectorStore.maxConnections,
                idleTimeoutMillis: this.config.vectorStore.idleTimeoutMillis
            });
            
            // Проверяем подключение
            const client = await this.store.connect();
            
            // Проверяем наличие расширения pgvector
            try {
                await client.query('CREATE EXTENSION IF NOT EXISTS vector');
                logger.info('pgvector extension is available');
            } catch (error) {
                logger.error('Failed to create pgvector extension', { error: error.message });
                throw new Error('pgvector extension is not available in PostgreSQL');
            }
            
            // Проверяем и создаем таблицы
            await this._ensureTablesExist(client);
            
            client.release();
        } catch (error) {
            logger.error('Failed to initialize PostgreSQL vector store', { error: error.message });
            throw error;
        }
    }
    
    /**
     * Проверяет и создает необходимые таблицы в PostgreSQL
     * 
     * @private
     * @param {Object} client - Клиент PostgreSQL
     * @returns {Promise<void>}
     */
    async _ensureTablesExist(client) {
        // Создаем таблицы для каждой схемы
        for (const [schemaName, schema] of Object.entries(SCHEMAS)) {
            const tableName = schema.name;
            
            try {
                // Проверяем существование таблицы
                const tableExists = await this._checkTableExists(client, tableName);
                
                if (!tableExists) {
                    logger.info(`Creating table ${tableName}`);
                    
                    // Создаем SQL для создания таблицы
                    let fieldsSQL = schema.fields.map(field => {
                        let typeSQL;
                        
                        switch (field.type) {
                            case 'string':
                                typeSQL = 'VARCHAR(255)';
                                break;
                            case 'text':
                                typeSQL = 'TEXT';
                                break;
                            case 'float':
                                typeSQL = 'FLOAT';
                                break;
                            case 'integer':
                                typeSQL = 'INTEGER';
                                break;
                            case 'boolean':
                                typeSQL = 'BOOLEAN';
                                break;
                            case 'timestamp':
                                typeSQL = 'TIMESTAMP';
                                break;
                            case 'jsonb':
                                typeSQL = 'JSONB';
                                break;
                            case 'string[]':
                                typeSQL = 'VARCHAR(255)[]';
                                break;
                            case 'vector':
                                typeSQL = `vector(${this.config.vectorStore.embeddingDimension})`;
                                break;
                            default:
                                typeSQL = 'TEXT';
                        }
                        
                        return `${field.name} ${typeSQL}${field.primaryKey ? ' PRIMARY KEY' : ''}`;
                    }).join(', ');
                    
                    // Создаем таблицу
                    await client.query(`
                        CREATE TABLE ${tableName} (
                            ${fieldsSQL}
                        )
                    `);
                    
                    // Создаем индексы
                    for (const field of schema.fields) {
                        if (field.indexed && !field.primaryKey) {
                            await client.query(`
                                CREATE INDEX ${tableName}_${field.name}_idx 
                                ON ${tableName} (${field.name})
                            `);
                        }
                    }
                    
                    // Создаем индекс для векторного поля
                    const vectorField = schema.fields.find(f => f.type === 'vector');
                    if (vectorField) {
                        await client.query(`
                            CREATE INDEX ${tableName}_${vectorField.name}_idx 
                            ON ${tableName} USING ivfflat (${vectorField.name} vector_cosine_ops) 
                            WITH (lists = 100)
                        `);
                    }
                    
                    logger.info(`Table ${tableName} created successfully`);
                } else {
                    logger.debug(`Table ${tableName} already exists`);
                }
            } catch (error) {
                logger.error(`Failed to create table ${tableName}`, { error: error.message });
                throw error;
            }
        }
    }
    
    /**
     * Проверяет существование таблицы в PostgreSQL
     * 
     * @private
     * @param {Object} client - Клиент PostgreSQL
     * @param {string} tableName - Имя таблицы
     * @returns {Promise<boolean>} - true, если таблица существует
     */
    async _checkTableExists(client, tableName) {
        const result = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = $1
            )
        `, [tableName]);
        
        return result.rows[0].exists;
    }
    
    /**
     * Инициализирует in-memory хранилище (для тестов)
     * 
     * @private
     * @returns {Promise<void>}
     */
    async _initMemoryStore() {
        // Простая структура для in-memory хранилища
        this.store = {};
        
        // Создаем структуры для каждой схемы
        for (const [schemaName, schema] of Object.entries(SCHEMAS)) {
            this.store[schema.name] = {
                items: [],
                indices: {}
            };
            
            // Создаем индексы для полей, которые должны быть индексированными
            for (const field of schema.fields) {
                if (field.indexed || field.primaryKey) {
                    this.store[schema.name].indices[field.name] = new Map();
                }
            }
        }
        
        logger.info('In-memory vector store initialized');
    }
    
    /**
     * Сохраняет элемент в хранилище
     * 
     * @param {string} schemaName - Имя схемы
     * @param {Object} item - Элемент для сохранения
     * @param {Object} embedding - Вектор эмбеддинга
     * @returns {Promise<string>} - ID сохраненного элемента
     */
    async storeItem(schemaName, item, embedding) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const schema = SCHEMAS[schemaName];
            if (!schema) {
                throw new Error(`Unknown schema: ${schemaName}`);
            }
            
            // Проверяем наличие всех обязательных полей
            for (const field of schema.fields) {
                if (field.primaryKey && !item[field.name] && field.name !== 'id') {
                    throw new Error(`Missing required primary key field: ${field.name}`);
                }
            }
            
            // Генерируем ID, если его нет
            if (!item.id) {
                item.id = this._generateId();
            }
            
            // Добавляем timestamp, если его нет
            if (!item.created_at && schema.fields.some(f => f.name === 'created_at')) {
                item.created_at = new Date().toISOString();
            }
            
            // Добавляем эмбеддинг
            if (embedding && schema.fields.some(f => f.name === 'embedding')) {
                item.embedding = embedding;
            }
            
            // Сохраняем в зависимости от типа хранилища
            if (this.config.vectorStore.type === 'pg') {
                await this._storeItemInPostgres(schema.name, item);
            } else if (this.config.vectorStore.type === 'memory') {
                await this._storeItemInMemory(schema.name, item);
            }
            
            // Обновляем метрики
            this.metrics.insertions++;
            
            return item.id;
        } catch (error) {
            logger.error('Failed to store item', { 
                schemaName, 
                error: error.message,
                itemId: item.id
            });
            throw error;
        }
    }
    
    /**
     * Сохраняет элемент в PostgreSQL
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Object} item - Элемент для сохранения
     * @returns {Promise<void>}
     */
    async _storeItemInPostgres(tableName, item) {
        const client = await this.store.connect();
        
        try {
            // Подготавливаем поля и значения
            const fields = Object.keys(item);
            const values = Object.values(item);
            
            // Для векторных полей нужна специальная обработка
            const placeholders = fields.map((field, index) => {
                if (field === 'embedding' && Array.isArray(item[field])) {
                    return `$${index + 1}::vector`;
                }
                return `$${index + 1}`;
            });
            
            // Формируем SQL запрос
            const sql = `
                INSERT INTO ${tableName} (${fields.join(', ')})
                VALUES (${placeholders.join(', ')})
                ON CONFLICT (id) DO UPDATE
                SET ${fields.map((field, index) => `${field} = $${index + 1}`).join(', ')}
            `;
            
            await client.query(sql, values);
        } finally {
            client.release();
        }
    }
    
    /**
     * Сохраняет элемент в in-memory хранилище
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Object} item - Элемент для сохранения
     * @returns {Promise<void>}
     */
    async _storeItemInMemory(tableName, item) {
        // Копируем элемент, чтобы избежать изменений исходного объекта
        const itemCopy = { ...item };
        
        // Ищем существующий элемент с таким же ID
        const existingIndex = this.store[tableName].items.findIndex(i => i.id === item.id);
        
        if (existingIndex >= 0) {
            // Обновляем существующий элемент
            this.store[tableName].items[existingIndex] = itemCopy;
        } else {
            // Добавляем новый элемент
            this.store[tableName].items.push(itemCopy);
        }
        
        // Обновляем индексы
        for (const [fieldName, indexMap] of Object.entries(this.store[tableName].indices)) {
            // Удаляем старые записи из индекса
            if (existingIndex >= 0) {
                const oldItem = this.store[tableName].items[existingIndex];
                const oldValue = oldItem[fieldName];
                
                if (oldValue !== undefined) {
                    const itemsWithValue = indexMap.get(oldValue) || [];
                    const newItems = itemsWithValue.filter(id => id !== item.id);
                    
                    if (newItems.length > 0) {
                        indexMap.set(oldValue, newItems);
                    } else {
                        indexMap.delete(oldValue);
                    }
                }
            }
            
            // Добавляем новые записи в индекс
            const value = item[fieldName];
            
            if (value !== undefined) {
                const itemsWithValue = indexMap.get(value) || [];
                itemsWithValue.push(item.id);
                indexMap.set(value, itemsWithValue);
            }
        }
    }
    
    /**
     * Находит похожие элементы по векторному эмбеддингу
     * 
     * @param {string} schemaName - Имя схемы
     * @param {Array} embedding - Вектор эмбеддинга для поиска похожих
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив похожих элементов
     */
    async findSimilar(schemaName, embedding, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const schema = SCHEMAS[schemaName];
            if (!schema) {
                throw new Error(`Unknown schema: ${schemaName}`);
            }
            
            const {
                limit = 10,
                minSimilarity = 0.7,
                filter = {},
                includeEmbedding = false
            } = options;
            
            // Ищем в зависимости от типа хранилища
            let results;
            if (this.config.vectorStore.type === 'pg') {
                results = await this._findSimilarInPostgres(schema.name, embedding, {
                    limit,
                    minSimilarity,
                    filter,
                    includeEmbedding
                });
            } else if (this.config.vectorStore.type === 'memory') {
                results = await this._findSimilarInMemory(schema.name, embedding, {
                    limit,
                    minSimilarity,
                    filter,
                    includeEmbedding
                });
            }
            
            // Обновляем метрики
            this.metrics.queries++;
            
            return results;
        } catch (error) {
            logger.error('Failed to find similar items', { 
                schemaName, 
                error: error.message 
            });
            throw error;
        }
    }
    
    /**
     * Находит похожие элементы в PostgreSQL
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Array} embedding - Вектор эмбеддинга
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив похожих элементов
     */
    async _findSimilarInPostgres(tableName, embedding, options) {
        const {
            limit,
            minSimilarity,
            filter,
            includeEmbedding
        } = options;
        
        const client = await this.store.connect();
        
        try {
            // Создаем условия фильтрации
            const conditions = [];
            const values = [embedding]; // Первое значение - сам вектор
            let valueCounter = 1;
            
            for (const [field, value] of Object.entries(filter)) {
                valueCounter++;
                conditions.push(`${field} = $${valueCounter}`);
                values.push(value);
            }
            
            // Добавляем условие минимального сходства
            conditions.push(`1 - (embedding <=> $1) >= ${minSimilarity}`);
            
            // Формируем часть WHERE
            const whereClause = conditions.length > 0 
                ? `WHERE ${conditions.join(' AND ')}` 
                : '';
                
            // Выбираем поля, исключая embedding, если не требуется
            const schema = SCHEMAS[tableName.includes('_') ? tableName.split('_').join('') : tableName];
            const selectedFields = schema.fields
                .filter(f => includeEmbedding || f.name !== 'embedding')
                .map(f => f.name)
                .join(', ');
                
            // Добавляем сходство как отдельное поле
            const selectedFieldsWithSimilarity = `${selectedFields}, 1 - (embedding <=> $1) as similarity`;
            
            // Формируем SQL запрос
            const sql = `
                SELECT ${selectedFieldsWithSimilarity}
                FROM ${tableName}
                ${whereClause}
                ORDER BY similarity DESC
                LIMIT ${limit}
            `;
            
            const result = await client.query(sql, values);
            return result.rows;
        } finally {
            client.release();
        }
    }
    
    /**
     * Находит похожие элементы в in-memory хранилище
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Array} embedding - Вектор эмбеддинга
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив похожих элементов
     */
    async _findSimilarInMemory(tableName, embedding, options) {
        const {
            limit,
            minSimilarity,
            filter,
            includeEmbedding
        } = options;
        
        // Фильтруем элементы по заданным критериям
        let filteredItems = [...this.store[tableName].items];
        
        for (const [field, value] of Object.entries(filter)) {
            filteredItems = filteredItems.filter(item => item[field] === value);
        }
        
        // Вычисляем сходство для каждого элемента
        const itemsWithSimilarity = filteredItems.map(item => {
            // Если у элемента нет эмбеддинга, устанавливаем сходство 0
            if (!item.embedding) {
                return { ...item, similarity: 0 };
            }
            
            const similarity = this._calculateCosineSimilarity(embedding, item.embedding);
            return { ...item, similarity };
        });
        
        // Фильтруем по минимальному сходству
        const similarItems = itemsWithSimilarity.filter(item => item.similarity >= minSimilarity);
        
        // Сортируем по убыванию сходства
        similarItems.sort((a, b) => b.similarity - a.similarity);
        
        // Ограничиваем количество результатов
        const limitedItems = similarItems.slice(0, limit);
        
        // Удаляем эмбеддинги, если не требуются
        if (!includeEmbedding) {
            return limitedItems.map(({ embedding, ...rest }) => rest);
        }
        
        return limitedItems;
    }
    
    /**
     * Вычисляет косинусное сходство между двумя векторами
     * 
     * @private
     * @param {Array} vec1 - Первый вектор
     * @param {Array} vec2 - Второй вектор
     * @returns {number} - Значение сходства (от 0 до 1)
     */
    _calculateCosineSimilarity(vec1, vec2) {
        if (vec1.length !== vec2.length) {
            throw new Error('Vectors must have the same dimension');
        }
        
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }
        
        norm1 = Math.sqrt(norm1);
        norm2 = Math.sqrt(norm2);
        
        // Проверка на случай, если один из векторов - нулевой
        if (norm1 === 0 || norm2 === 0) {
            return 0;
        }
        
        return dotProduct / (norm1 * norm2);
    }
    
    /**
     * Получает элемент по ID
     * 
     * @param {string} schemaName - Имя схемы
     * @param {string} id - ID элемента
     * @returns {Promise<Object>} - Найденный элемент или null
     */
    async getItem(schemaName, id) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const schema = SCHEMAS[schemaName];
            if (!schema) {
                throw new Error(`Unknown schema: ${schemaName}`);
            }
            
            // Пытаемся найти в кэше
            const cacheKey = `${schemaName}:${id}`;
            if (this.queryCache.has(cacheKey)) {
                this.metrics.cacheHits++;
                return this.queryCache.get(cacheKey);
            }
            
            // Ищем в зависимости от типа хранилища
            let item;
            if (this.config.vectorStore.type === 'pg') {
                item = await this._getItemFromPostgres(schema.name, id);
            } else if (this.config.vectorStore.type === 'memory') {
                item = await this._getItemFromMemory(schema.name, id);
            }
            
            // Сохраняем в кэш, если найден
            if (item) {
                this.queryCache.set(cacheKey, item);
            }
            
            // Обновляем метрики
            this.metrics.queries++;
            this.metrics.cacheMisses++;
            
            return item;
        } catch (error) {
            logger.error('Failed to get item', { 
                schemaName, 
                id, 
                error: error.message 
            });
            throw error;
        }
    }
    
    /**
     * Получает элемент из PostgreSQL
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {string} id - ID элемента
     * @returns {Promise<Object>} - Найденный элемент или null
     */
    async _getItemFromPostgres(tableName, id) {
        const client = await this.store.connect();
        
        try {
            const result = await client.query(
                `SELECT * FROM ${tableName} WHERE id = $1`,
                [id]
            );
            
            return result.rows.length > 0 ? result.rows[0] : null;
        } finally {
            client.release();
        }
    }
    
    /**
     * Получает элемент из in-memory хранилища
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {string} id - ID элемента
     * @returns {Promise<Object>} - Найденный элемент или null
     */
    async _getItemFromMemory(tableName, id) {
        const item = this.store[tableName].items.find(item => item.id === id);
        return item ? { ...item } : null;
    }
    
    /**
     * Удаляет элемент по ID
     * 
     * @param {string} schemaName - Имя схемы
     * @param {string} id - ID элемента
     * @returns {Promise<boolean>} - true, если элемент был удален
     */
    async deleteItem(schemaName, id) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const schema = SCHEMAS[schemaName];
            if (!schema) {
                throw new Error(`Unknown schema: ${schemaName}`);
            }
            
            // Удаляем из кэша
            const cacheKey = `${schemaName}:${id}`;
            this.queryCache.delete(cacheKey);
            
            // Удаляем в зависимости от типа хранилища
            let deleted;
            if (this.config.vectorStore.type === 'pg') {
                deleted = await this._deleteItemFromPostgres(schema.name, id);
            } else if (this.config.vectorStore.type === 'memory') {
                deleted = await this._deleteItemFromMemory(schema.name, id);
            }
            
            // Обновляем метрики
            if (deleted) {
                this.metrics.deletions++;
            }
            
            return deleted;
        } catch (error) {
            logger.error('Failed to delete item', { 
                schemaName, 
                id, 
                error: error.message 
            });
            throw error;
        }
    }
    
    /**
     * Удаляет элемент из PostgreSQL
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {string} id - ID элемента
     * @returns {Promise<boolean>} - true, если элемент был удален
     */
    async _deleteItemFromPostgres(tableName, id) {
        const client = await this.store.connect();
        
        try {
            const result = await client.query(
                `DELETE FROM ${tableName} WHERE id = $1`,
                [id]
            );
            
            return result.rowCount > 0;
        } finally {
            client.release();
        }
    }
    
    /**
     * Удаляет элемент из in-memory хранилища
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {string} id - ID элемента
     * @returns {Promise<boolean>} - true, если элемент был удален
     */
    async _deleteItemFromMemory(tableName, id) {
        const initialLength = this.store[tableName].items.length;
        
        // Находим элемент для удаления индексов
        const itemToDelete = this.store[tableName].items.find(item => item.id === id);
        
        if (itemToDelete) {
            // Удаляем из индексов
            for (const [fieldName, indexMap] of Object.entries(this.store[tableName].indices)) {
                const value = itemToDelete[fieldName];
                
                if (value !== undefined) {
                    const itemsWithValue = indexMap.get(value) || [];
                    const newItems = itemsWithValue.filter(itemId => itemId !== id);
                    
                    if (newItems.length > 0) {
                        indexMap.set(value, newItems);
                    } else {
                        indexMap.delete(value);
                    }
                }
            }
        }
        
        // Удаляем элемент
        this.store[tableName].items = this.store[tableName].items.filter(item => item.id !== id);
        
        return initialLength !== this.store[tableName].items.length;
    }
    
    /**
     * Находит элементы по заданным критериям
     * 
     * @param {string} schemaName - Имя схемы
     * @param {Object} criteria - Критерии поиска
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив найденных элементов
     */
    async findItems(schemaName, criteria, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            const schema = SCHEMAS[schemaName];
            if (!schema) {
                throw new Error(`Unknown schema: ${schemaName}`);
            }
            
            const {
                limit = 100,
                offset = 0,
                orderBy = { field: 'created_at', direction: 'desc' },
                includeEmbedding = false
            } = options;
            
            // Ищем в зависимости от типа хранилища
            let results;
            if (this.config.vectorStore.type === 'pg') {
                results = await this._findItemsInPostgres(schema.name, criteria, {
                    limit,
                    offset,
                    orderBy,
                    includeEmbedding
                });
            } else if (this.config.vectorStore.type === 'memory') {
                results = await this._findItemsInMemory(schema.name, criteria, {
                    limit,
                    offset,
                    orderBy,
                    includeEmbedding
                });
            }
            
            // Обновляем метрики
            this.metrics.queries++;
            
            return results;
        } catch (error) {
            logger.error('Failed to find items', { 
                schemaName, 
                criteria, 
                error: error.message 
            });
            throw error;
        }
    }
    
    /**
     * Находит элементы в PostgreSQL
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Object} criteria - Критерии поиска
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив найденных элементов
     */
    async _findItemsInPostgres(tableName, criteria, options) {
        const {
            limit,
            offset,
            orderBy,
            includeEmbedding
        } = options;
        
        const client = await this.store.connect();
        
        try {
            // Создаем условия фильтрации
            const conditions = [];
            const values = [];
            let valueCounter = 0;
            
            for (const [field, value] of Object.entries(criteria)) {
                valueCounter++;
                conditions.push(`${field} = $${valueCounter}`);
                values.push(value);
            }
            
            // Формируем часть WHERE
            const whereClause = conditions.length > 0 
                ? `WHERE ${conditions.join(' AND ')}` 
                : '';
                
            // Выбираем поля, исключая embedding, если не требуется
            const schema = SCHEMAS[tableName.includes('_') ? tableName.split('_').join('') : tableName];
            const selectedFields = schema.fields
                .filter(f => includeEmbedding || f.name !== 'embedding')
                .map(f => f.name)
                .join(', ');
                
            // Формируем SQL запрос
            const sql = `
                SELECT ${selectedFields}
                FROM ${tableName}
                ${whereClause}
                ORDER BY ${orderBy.field} ${orderBy.direction.toUpperCase()}
                LIMIT ${limit}
                OFFSET ${offset}
            `;
            
            const result = await client.query(sql, values);
            return result.rows;
        } finally {
            client.release();
        }
    }
    
    /**
     * Находит элементы в in-memory хранилище
     * 
     * @private
     * @param {string} tableName - Имя таблицы
     * @param {Object} criteria - Критерии поиска
     * @param {Object} options - Опции поиска
     * @returns {Promise<Array>} - Массив найденных элементов
     */
    async _findItemsInMemory(tableName, criteria, options) {
        const {
            limit,
            offset,
            orderBy,
            includeEmbedding
        } = options;
        
        // Фильтруем элементы по заданным критериям
        let filteredItems = [...this.store[tableName].items];
        
        for (const [field, value] of Object.entries(criteria)) {
            filteredItems = filteredItems.filter(item => item[field] === value);
        }
        
        // Сортируем элементы
        filteredItems.sort((a, b) => {
            const fieldA = a[orderBy.field];
            const fieldB = b[orderBy.field];
            
            if (fieldA === undefined || fieldB === undefined) {
                return 0;
            }
            
            const comparison = fieldA > fieldB ? 1 : (fieldA < fieldB ? -1 : 0);
            return orderBy.direction.toLowerCase() === 'asc' ? comparison : -comparison;
        });
        
        // Применяем пагинацию
        const paginatedItems = filteredItems.slice(offset, offset + limit);
        
        // Удаляем эмбеддинги, если не требуются
        if (!includeEmbedding) {
            return paginatedItems.map(item => {
                const { embedding, ...rest } = item;
                return rest;
            });
        }
        
        return paginatedItems.map(item => ({ ...item }));
    }
    
    /**
     * Генерирует уникальный ID
     * 
     * @private
     * @returns {string} - Уникальный ID
     */
    _generateId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 10);
        return `${timestamp}-${random}`;
    }
    
    /**
     * Очищает кэш запросов
     * 
     * @returns {void}
     */
    clearCache() {
        this.queryCache.clear();
        logger.debug('Query cache cleared');
    }
    
    /**
     * Получает статистику хранилища
     * 
     * @returns {Promise<Object>} - Статистика хранилища
     */
    async getStats() {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        try {
            let stats = {
                metrics: { ...this.metrics },
                schemas: {}
            };
            
            // Собираем статистику по схемам
            for (const [schemaName, schema] of Object.entries(SCHEMAS)) {
                let count;
                
                if (this.config.vectorStore.type === 'pg') {
                    const client = await this.store.connect();
                    try {
                        const result = await client.query(`SELECT COUNT(*) FROM ${schema.name}`);
                        count = parseInt(result.rows[0].count);
                    } finally {
                        client.release();
                    }
                } else if (this.config.vectorStore.type === 'memory') {
                    count = this.store[schema.name].items.length;
                }
                
                stats.schemas[schemaName] = { count };
            }
            
            return stats;
        } catch (error) {
            logger.error('Failed to get vector store stats', { error: error.message });
            throw error;
        }
    }
}

/**
 * Фабричная функция для получения singleton-экземпляра
 * 
 * @param {Object} options - Опции инициализации
 * @returns {VectorStore} - Экземпляр VectorStore
 */
function getVectorStore(options = {}) {
    if (!instance) {
        instance = new VectorStore(options);
    }
    return instance;
}

module.exports = {
    getVectorStore,
    SCHEMAS
};
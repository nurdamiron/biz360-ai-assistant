/**
 * Генератор векторных эмбеддингов для текста
 * Преобразует текстовые данные в векторные представления для работы с векторным хранилищем
 */

const axios = require('axios');
const logger = require('../../utils/logger');
const config = require('../../config/app.config');
const llmClient = require('../../utils/llm-client');

// Конфигурация по умолчанию
const DEFAULT_CONFIG = {
    // API для создания эмбеддингов
    api: {
        type: 'openai', // 'openai', 'anthropic', 'local', 'cohere', 'hf'
        model: 'text-embedding-ada-002', // Модель по умолчанию для OpenAI
        batchSize: 10, // Размер пакета для обработки большого количества текстов
        retries: 3, // Количество повторных попыток при ошибке
        retryDelay: 1000, // Задержка между повторными попытками (мс)
        timeout: 30000 // Таймаут для запросов (мс)
    },
    // Параметры текста
    text: {
        maxLength: 8000, // Максимальная длина текста для эмбеддинга
        truncationStrategy: 'end', // 'end', 'start', 'middle'
        chunkSize: 1000, // Размер кусков при разбиении длинного текста
        chunkOverlap: 200 // Перекрытие между кусками
    },
    // Кэширование эмбеддингов
    cache: {
        enabled: true, // Включить кэширование
        ttl: 86400000, // Время жизни кэша (мс) - 24 часа
        maxSize: 1000 // Максимальное количество элементов в кэше
    }
};

// Singleton instance
let instance = null;

/**
 * Класс для генерации эмбеддингов
 */
class EmbeddingGenerator {
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
        
        // Переопределяем конфигурацию из общих настроек приложения
        if (config.ai && config.ai.embeddings) {
            this.config = {
                ...this.config,
                api: {
                    ...this.config.api,
                    ...config.ai.embeddings
                }
            };
        }
        
        // Инициализируем кэш, если включен
        this.cache = this.config.cache.enabled ? new Map() : null;
        
        // Метрики
        this.metrics = {
            requests: 0,
            errors: 0,
            cachedRequests: 0,
            totalProcessingTime: 0,
            avgProcessingTime: 0,
            tokensProcessed: 0
        };
        
        logger.debug('Embedding generator initialized', { 
            apiType: this.config.api.type,
            model: this.config.api.model
        });
    }
    
    /**
     * Создает эмбеддинги для текста
     * 
     * @param {string} text - Текст для эмбеддинга
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async generateEmbedding(text, options = {}) {
        const startTime = Date.now();
        
        try {
            // Предобработка текста
            const processedText = this._preprocessText(text, options);
            
            // Проверяем кэш, если включен
            if (this.cache) {
                const cacheKey = this._getCacheKey(processedText);
                if (this.cache.has(cacheKey)) {
                    this.metrics.cachedRequests++;
                    logger.debug('Retrieved embedding from cache');
                    return this.cache.get(cacheKey);
                }
            }
            
            // Выбираем провайдера API на основе конфигурации
            let embedding;
            const { type } = this.config.api;
            
            switch (type.toLowerCase()) {
                case 'openai':
                    embedding = await this._generateOpenAIEmbedding(processedText, options);
                    break;
                case 'anthropic':
                    embedding = await this._generateAnthropicEmbedding(processedText, options);
                    break;
                case 'cohere':
                    embedding = await this._generateCohereEmbedding(processedText, options);
                    break;
                case 'local':
                    embedding = await this._generateLocalEmbedding(processedText, options);
                    break;
                case 'hf':
                case 'huggingface':
                    embedding = await this._generateHuggingFaceEmbedding(processedText, options);
                    break;
                case 'llm':
                    embedding = await this._generateLLMEmbedding(processedText, options);
                    break;
                default:
                    logger.warn(`Unknown embedding API type: ${type}, falling back to OpenAI`);
                    embedding = await this._generateOpenAIEmbedding(processedText, options);
            }
            
            // Сохраняем в кэш, если включен
            if (this.cache) {
                const cacheKey = this._getCacheKey(processedText);
                this.cache.set(cacheKey, embedding);
                
                // Удаляем старые элементы из кэша, если превышен максимальный размер
                if (this.cache.size > this.config.cache.maxSize) {
                    const oldestKey = this.cache.keys().next().value;
                    this.cache.delete(oldestKey);
                }
            }
            
            // Обновляем метрики
            this.metrics.requests++;
            const processingTime = Date.now() - startTime;
            this.metrics.totalProcessingTime += processingTime;
            this.metrics.avgProcessingTime = this.metrics.totalProcessingTime / this.metrics.requests;
            
            // Примерно подсчитываем токены (4 символа ~ 1 токен)
            const approxTokens = Math.ceil(processedText.length / 4);
            this.metrics.tokensProcessed += approxTokens;
            
            return embedding;
        } catch (error) {
            logger.error('Error generating embedding', { 
                error: error.message,
                textLength: text?.length
            });
            
            this.metrics.errors++;
            throw error;
        }
    }
    
    /**
     * Создает эмбеддинги для нескольких текстов
     * 
     * @param {Array<string>} texts - Массив текстов для эмбеддинга
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array<Array>>} - Массив векторов эмбеддинга
     */
    async generateBatchEmbeddings(texts, options = {}) {
        if (!Array.isArray(texts) || texts.length === 0) {
            return [];
        }
        
        // Если количество текстов меньше или равно размеру пакета, выполняем в один запрос
        const batchSize = options.batchSize || this.config.api.batchSize;
        
        if (texts.length <= batchSize) {
            return this._generateEmbeddingsBatch(texts, options);
        }
        
        // Разбиваем тексты на пакеты
        const batches = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            batches.push(texts.slice(i, i + batchSize));
        }
        
        logger.debug(`Processing ${texts.length} texts in ${batches.length} batches`);
        
        // Обрабатываем каждый пакет и объединяем результаты
        const batchResults = await Promise.all(
            batches.map(batch => this._generateEmbeddingsBatch(batch, options))
        );
        
        return batchResults.flat();
    }
    
    /**
     * Создает эмбеддинги для пакета текстов
     * 
     * @private
     * @param {Array<string>} texts - Пакет текстов
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array<Array>>} - Массив векторов эмбеддинга
     */
    async _generateEmbeddingsBatch(texts, options = {}) {
        try {
            // Предобработка текстов
            const processedTexts = texts.map(text => this._preprocessText(text, options));
            
            // Проверяем кэш для каждого текста
            let uncachedTexts = [];
            let uncachedIndices = [];
            let results = new Array(texts.length);
            
            if (this.cache) {
                for (let i = 0; i < processedTexts.length; i++) {
                    const cacheKey = this._getCacheKey(processedTexts[i]);
                    
                    if (this.cache.has(cacheKey)) {
                        results[i] = this.cache.get(cacheKey);
                        this.metrics.cachedRequests++;
                    } else {
                        uncachedTexts.push(processedTexts[i]);
                        uncachedIndices.push(i);
                    }
                }
            } else {
                uncachedTexts = processedTexts;
                uncachedIndices = [...Array(texts.length).keys()];
            }
            
            // Если все тексты в кэше, возвращаем результаты
            if (uncachedTexts.length === 0) {
                logger.debug('All texts found in cache');
                return results;
            }
            
            // Создаем эмбеддинги для некэшированных текстов
            let embeddings;
            const { type } = this.config.api;
            
            switch (type.toLowerCase()) {
                case 'openai':
                    embeddings = await this._generateOpenAIBatchEmbedding(uncachedTexts, options);
                    break;
                case 'cohere':
                    embeddings = await this._generateCohereBatchEmbedding(uncachedTexts, options);
                    break;
                case 'anthropic':
                    // Многие API не поддерживают пакетную обработку, поэтому обрабатываем по одному
                    embeddings = await Promise.all(
                        uncachedTexts.map(text => this._generateAnthropicEmbedding(text, options))
                    );
                    break;
                case 'local':
                    embeddings = await Promise.all(
                        uncachedTexts.map(text => this._generateLocalEmbedding(text, options))
                    );
                    break;
                default:
                    logger.warn(`Batch embedding not optimized for ${type}, processing sequentially`);
                    embeddings = await Promise.all(
                        uncachedTexts.map(text => this.generateEmbedding(text, options))
                    );
            }
            
            // Сохраняем эмбеддинги в кэш и в результаты
            for (let i = 0; i < uncachedTexts.length; i++) {
                const index = uncachedIndices[i];
                results[index] = embeddings[i];
                
                if (this.cache) {
                    const cacheKey = this._getCacheKey(uncachedTexts[i]);
                    this.cache.set(cacheKey, embeddings[i]);
                }
            }
            
            // Обновляем метрики
            this.metrics.requests += uncachedTexts.length;
            
            // Примерно подсчитываем токены (4 символа ~ 1 токен)
            const approxTokens = uncachedTexts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
            this.metrics.tokensProcessed += approxTokens;
            
            return results;
        } catch (error) {
            logger.error('Error generating batch embeddings', { 
                error: error.message,
                batchSize: texts.length
            });
            
            this.metrics.errors++;
            throw error;
        }
    }
    
    /**
     * Выполняет предобработку текста
     * 
     * @private
     * @param {string} text - Исходный текст
     * @param {Object} options - Опции предобработки
     * @returns {string} - Обработанный текст
     */
    _preprocessText(text, options = {}) {
        if (!text) {
            return '';
        }
        
        // Получаем опции предобработки
        const {
            maxLength = this.config.text.maxLength,
            truncationStrategy = this.config.text.truncationStrategy
        } = options;
        
        // Очищаем текст
        let processedText = text.trim();
        
        // Если текст короче максимальной длины, возвращаем как есть
        if (processedText.length <= maxLength) {
            return processedText;
        }
        
        // Усекаем текст в соответствии с выбранной стратегией
        switch (truncationStrategy) {
            case 'start':
                return processedText.substring(processedText.length - maxLength);
            case 'middle':
                const halfLength = Math.floor(maxLength / 2);
                return processedText.substring(0, halfLength) + 
                       processedText.substring(processedText.length - halfLength);
            case 'end':
            default:
                return processedText.substring(0, maxLength);
        }
    }
    
    /**
     * Разбивает длинный текст на куски
     * 
     * @param {string} text - Длинный текст
     * @param {Object} options - Дополнительные опции
     * @returns {Array<string>} - Массив кусков текста
     */
    chunkText(text, options = {}) {
        if (!text) {
            return [];
        }
        
        const {
            chunkSize = this.config.text.chunkSize,
            chunkOverlap = this.config.text.chunkOverlap
        } = options;
        
        // Если текст короче размера куска, возвращаем как есть
        if (text.length <= chunkSize) {
            return [text];
        }
        
        // Разбиваем текст на куски
        const chunks = [];
        let startIndex = 0;
        
        while (startIndex < text.length) {
            // Вычисляем конечный индекс куска
            let endIndex = startIndex + chunkSize;
            
            // Если это не последний кусок, находим более подходящее место для разделения
            if (endIndex < text.length) {
                // Ищем конец предложения или параграфа
                const sentenceEnd = this._findSentenceEnd(text, endIndex);
                if (sentenceEnd > 0) {
                    endIndex = sentenceEnd;
                }
            } else {
                endIndex = text.length;
            }
            
            // Добавляем кусок
            chunks.push(text.substring(startIndex, endIndex));
            
            // Обновляем начальный индекс
            startIndex = endIndex - chunkOverlap;
            
            // Убеждаемся, что мы продвигаемся вперед
            if (startIndex <= 0 || startIndex >= text.length) {
                break;
            }
        }
        
        return chunks;
    }
    
    /**
     * Находит конец предложения или параграфа рядом с указанным индексом
     * 
     * @private
     * @param {string} text - Текст
     * @param {number} index - Индекс
     * @param {number} searchWindow - Размер окна поиска
     * @returns {number} - Индекс конца предложения или 0, если не найден
     */
    _findSentenceEnd(text, index, searchWindow = 100) {
        // Ищем в окне поиска после указанного индекса
        const searchText = text.substring(
            Math.max(0, index - searchWindow),
            Math.min(text.length, index + searchWindow)
        );
        
        // Ищем конец параграфа
        let paragraphEnd = searchText.indexOf('\n\n');
        if (paragraphEnd >= 0) {
            return Math.max(0, index - searchWindow) + paragraphEnd + 2;
        }
        
        // Ищем конец предложения
        const sentenceEnds = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
        
        for (const ending of sentenceEnds) {
            let sentenceEnd = searchText.indexOf(ending);
            if (sentenceEnd >= 0) {
                return Math.max(0, index - searchWindow) + sentenceEnd + ending.length;
            }
        }
        
        // Ищем конец строки
        let lineEnd = searchText.indexOf('\n');
        if (lineEnd >= 0) {
            return Math.max(0, index - searchWindow) + lineEnd + 1;
        }
        
        return 0;
    }
    
    /**
     * Получает ключ для кэша
     * 
     * @private
     * @param {string} text - Текст
     * @returns {string} - Ключ кэша
     */
    _getCacheKey(text) {
        const { type, model } = this.config.api;
        return `${type}:${model}:${this._hashText(text)}`;
    }
    
    /**
     * Создает хэш текста
     * 
     * @private
     * @param {string} text - Текст
     * @returns {string} - Хэш текста
     */
    _hashText(text) {
        let hash = 0;
        if (text.length === 0) return hash.toString();
        
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        return hash.toString();
    }
    
    /**
     * Создает эмбеддинг через OpenAI API
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateOpenAIEmbedding(text, options = {}) {
        const model = options.model || this.config.api.model || 'text-embedding-ada-002';
        
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.openai?.apiKey) || 
                          process.env.OPENAI_API_KEY;
            
            if (!apiKey) {
                throw new Error('OpenAI API key not found');
            }
            
            const response = await axios.post(
                'https://api.openai.com/v1/embeddings',
                {
                    model: model,
                    input: text
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data && response.data.data && response.data.data[0]) {
                return response.data.data[0].embedding;
            }
            
            throw new Error('Invalid response from OpenAI API');
        } catch (error) {
            logger.error('Error generating OpenAI embedding', {
                error: error.message,
                model
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying OpenAI embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateOpenAIEmbedding(text, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает пакетные эмбеддинги через OpenAI API
     * 
     * @private
     * @param {Array<string>} texts - Массив текстов
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array<Array>>} - Массив векторов эмбеддинга
     */
    async _generateOpenAIBatchEmbedding(texts, options = {}) {
        const model = options.model || this.config.api.model || 'text-embedding-ada-002';
        
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.openai?.apiKey) || 
                          process.env.OPENAI_API_KEY;
            
            if (!apiKey) {
                throw new Error('OpenAI API key not found');
            }
            
            const response = await axios.post(
                'https://api.openai.com/v1/embeddings',
                {
                    model: model,
                    input: texts
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data && response.data.data) {
                // Сортируем по индексу, так как OpenAI может вернуть в другом порядке
                return response.data.data
                    .sort((a, b) => a.index - b.index)
                    .map(item => item.embedding);
            }
            
            throw new Error('Invalid response from OpenAI API');
        } catch (error) {
            logger.error('Error generating OpenAI batch embeddings', {
                error: error.message,
                model,
                batchSize: texts.length
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying OpenAI batch embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateOpenAIBatchEmbedding(texts, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает эмбеддинг через Anthropic API (Claude)
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateAnthropicEmbedding(text, options = {}) {
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.anthropic?.apiKey) || 
                          process.env.ANTHROPIC_API_KEY;
            
            if (!apiKey) {
                throw new Error('Anthropic API key not found');
            }
            
            const response = await axios.post(
                'https://api.anthropic.com/v1/embeddings',
                {
                    model: "claude-3-haiku-20240307",
                    input: text,
                    max_tokens: 8000
                },
                {
                    headers: {
                        'anthropic-version': '2023-06-01',
                        'x-api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data && response.data.embedding) {
                return response.data.embedding;
            }
            
            throw new Error('Invalid response from Anthropic API');
        } catch (error) {
            logger.error('Error generating Anthropic embedding', {
                error: error.message
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying Anthropic embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateAnthropicEmbedding(text, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает эмбеддинг через Cohere API
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateCohereEmbedding(text, options = {}) {
        const model = options.model || this.config.api.model || 'embed-english-v3.0';
        
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.cohere?.apiKey) || 
                          process.env.COHERE_API_KEY;
            
            if (!apiKey) {
                throw new Error('Cohere API key not found');
            }
            
            const response = await axios.post(
                'https://api.cohere.ai/v1/embed',
                {
                    model: model,
                    texts: [text],
                    truncate: 'END'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data && response.data.embeddings && response.data.embeddings.length > 0) {
                return response.data.embeddings[0];
            }
            
            throw new Error('Invalid response from Cohere API');
        } catch (error) {
            logger.error('Error generating Cohere embedding', {
                error: error.message,
                model
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying Cohere embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateCohereEmbedding(text, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает пакетные эмбеддинги через Cohere API
     * 
     * @private
     * @param {Array<string>} texts - Массив текстов
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array<Array>>} - Массив векторов эмбеддинга
     */
    async _generateCohereBatchEmbedding(texts, options = {}) {
        const model = options.model || this.config.api.model || 'embed-english-v3.0';
        
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.cohere?.apiKey) || 
                          process.env.COHERE_API_KEY;
            
            if (!apiKey) {
                throw new Error('Cohere API key not found');
            }
            
            const response = await axios.post(
                'https://api.cohere.ai/v1/embed',
                {
                    model: model,
                    texts: texts,
                    truncate: 'END'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data && response.data.embeddings) {
                return response.data.embeddings;
            }
            
            throw new Error('Invalid response from Cohere API');
        } catch (error) {
            logger.error('Error generating Cohere batch embeddings', {
                error: error.message,
                model,
                batchSize: texts.length
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying Cohere batch embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateCohereBatchEmbedding(texts, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает эмбеддинг через локальную модель
     * (Заглушка, требует интеграции с локальной моделью)
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateLocalEmbedding(text, options = {}) {
        logger.warn('Local embedding generation not implemented, generating mock embedding');
        
        // Создаем случайный вектор для тестирования
        const dimension = options.dimension || this.config.api.embeddingDimension || 1536;
        const vector = new Array(dimension).fill(0).map(() => Math.random() * 2 - 1);
        
        // Нормализуем вектор
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(val => val / magnitude);
    }
    
    /**
     * Создает эмбеддинг через Hugging Face API
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateHuggingFaceEmbedding(text, options = {}) {
        const model = options.model || this.config.api.model || 'sentence-transformers/all-MiniLM-L6-v2';
        
        try {
            // Получаем ключ API из конфигурации
            const apiKey = options.apiKey || 
                          (config.ai?.providers?.huggingface?.apiKey) || 
                          process.env.HUGGINGFACE_API_KEY;
            
            if (!apiKey) {
                throw new Error('Hugging Face API key not found');
            }
            
            const response = await axios.post(
                `https://api-inference.huggingface.co/models/${model}`,
                {
                    inputs: text,
                    options: { wait_for_model: true }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.config.api.timeout
                }
            );
            
            if (response.data) {
                if (Array.isArray(response.data)) {
                    if (response.data.length > 0 && Array.isArray(response.data[0])) {
                        return response.data[0];
                    }
                    return response.data;
                }
                
                throw new Error('Invalid response format from Hugging Face API');
            }
            
            throw new Error('Invalid response from Hugging Face API');
        } catch (error) {
            logger.error('Error generating Hugging Face embedding', {
                error: error.message,
                model
            });
            
            // Проверяем, нужно ли повторить запрос
            if (options.retries === undefined) {
                options.retries = this.config.api.retries;
            }
            
            if (options.retries > 0) {
                logger.debug(`Retrying Hugging Face embedding (${options.retries} attempts left)`);
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, this.config.api.retryDelay));
                
                // Повторяем запрос
                return this._generateHuggingFaceEmbedding(text, {
                    ...options,
                    retries: options.retries - 1
                });
            }
            
            throw error;
        }
    }
    
    /**
     * Создает эмбеддинг через существующий LLM-клиент
     * 
     * @private
     * @param {string} text - Текст
     * @param {Object} options - Дополнительные опции
     * @returns {Promise<Array>} - Вектор эмбеддинга
     */
    async _generateLLMEmbedding(text, options = {}) {
        try {
            const result = await llmClient.getEmbedding(text, options);
            
            if (!result || !Array.isArray(result)) {
                throw new Error('Invalid embedding result from LLM client');
            }
            
            return result;
        } catch (error) {
            logger.error('Error generating embedding via LLM client', {
                error: error.message
            });
            
            throw error;
        }
    }
    
    /**
     * Очищает кэш эмбеддингов
     * 
     * @returns {void}
     */
    clearCache() {
        if (this.cache) {
            this.cache.clear();
            logger.debug('Embedding cache cleared');
        }
    }
    
    /**
     * Получает метрики
     * 
     * @returns {Object} - Текущие метрики
     */
    getMetrics() {
        return {
            ...this.metrics,
            cacheSize: this.cache ? this.cache.size : 0,
            cacheEnabled: !!this.cache
        };
    }
}

/**
 * Фабричная функция для получения singleton-экземпляра
 * 
 * @param {Object} options - Опции инициализации
 * @returns {EmbeddingGenerator} - Экземпляр EmbeddingGenerator
 */
function getEmbeddingGenerator(options = {}) {
    if (!instance) {
        instance = new EmbeddingGenerator(options);
    }
    return instance;
}

module.exports = {
    getEmbeddingGenerator
};
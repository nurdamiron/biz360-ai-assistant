/**
 * Система обучения на основе успешных решений
 * Предоставляет возможность сохранять, анализировать и искать похожие задачи и решения
 */

const logger = require('../../utils/logger');
const vectorStore = require('./vector-store');
const embeddingGenerator = require('./embedding-generator');
const solutionAnalyzer = require('./solution-analyzer');

/**
 * Инициализирует систему обучения
 * 
 * @param {Object} options - Опции инициализации
 * @returns {Promise<boolean>} - Успешность инициализации
 */
async function initialize(options = {}) {
    try {
        logger.info('Initializing learning system', { options: Object.keys(options) });
        
        // Инициализируем векторное хранилище
        const vectorStoreInstance = vectorStore.getVectorStore(options.vectorStore);
        await vectorStoreInstance.initialize();
        
        // Инициализируем генератор эмбеддингов
        embeddingGenerator.getEmbeddingGenerator(options.embedding);
        
        return true;
    } catch (error) {
        logger.error('Failed to initialize learning system', { 
            error: error.message,
            stack: error.stack
        });
        
        return false;
    }
}

/**
 * Сохраняет решение задачи для будущего использования
 * 
 * @param {Object} taskData - Данные о задаче
 * @param {string} solution - Решение задачи
 * @param {Object} context - Контекст решения (проект, файлы и т.д.)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат сохранения
 */
async function storeSolution(taskData, solution, context = {}, options = {}) {
    try {
        logger.info('Storing solution', { 
            taskId: taskData.id || options.taskId,
            solutionLength: solution?.length || 0
        });
        
        const result = await solutionAnalyzer.analyzeSolution(
            taskData,
            solution,
            context,
            options
        );
        
        return result;
    } catch (error) {
        logger.error('Error storing solution', { 
            error: error.message, 
            stack: error.stack,
            taskId: taskData.id || options.taskId
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Находит похожие задачи и решения
 * 
 * @param {string} taskDescription - Описание задачи
 * @param {Object} context - Контекст запроса (проект, технологии)
 * @param {Object} options - Дополнительные опции поиска
 * @returns {Promise<Array>} - Массив похожих задач и решений
 */
async function findSimilarTasks(taskDescription, context = {}, options = {}) {
    try {
        logger.info('Finding similar tasks', {
            descriptionLength: taskDescription?.length || 0,
            options: Object.keys(options)
        });
        
        const results = await solutionAnalyzer.findSimilarSolutions(
            taskDescription,
            context,
            options
        );
        
        return results;
    } catch (error) {
        logger.error('Error finding similar tasks', { 
            error: error.message,
            stack: error.stack
        });
        
        return [];
    }
}

/**
 * Расширяет промпт примерами похожих решений
 * 
 * @param {string} prompt - Исходный промпт
 * @param {Object} context - Контекст запроса
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<string>} - Расширенный промпт
 */
async function enhancePromptWithExamples(prompt, context = {}, options = {}) {
    try {
        logger.debug('Enhancing prompt with examples', {
            promptLength: prompt?.length || 0,
            options: Object.keys(options)
        });
        
        const enhancedPrompt = await solutionAnalyzer.enhancePromptWithExamples(
            prompt,
            context,
            options
        );
        
        return enhancedPrompt;
    } catch (error) {
        logger.error('Error enhancing prompt', { 
            error: error.message,
            stack: error.stack
        });
        
        // В случае ошибки возвращаем исходный промпт
        return prompt;
    }
}

/**
 * Создает эмбеддинг для текста
 * 
 * @param {string} text - Текст для эмбеддинга
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Array>} - Вектор эмбеддинга
 */
async function generateEmbedding(text, options = {}) {
    try {
        const generator = embeddingGenerator.getEmbeddingGenerator();
        return await generator.generateEmbedding(text, options);
    } catch (error) {
        logger.error('Error generating embedding', { 
            error: error.message,
            textLength: text?.length || 0
        });
        
        throw error;
    }
}

/**
 * Создает эмбеддинги для нескольких текстов
 * 
 * @param {Array<string>} texts - Массив текстов
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Array<Array>>} - Массив векторов эмбеддингов
 */
async function generateBatchEmbeddings(texts, options = {}) {
    try {
        const generator = embeddingGenerator.getEmbeddingGenerator();
        return await generator.generateBatchEmbeddings(texts, options);
    } catch (error) {
        logger.error('Error generating batch embeddings', { 
            error: error.message,
            textsCount: texts?.length || 0
        });
        
        throw error;
    }
}

/**
 * Получает статистику системы обучения
 * 
 * @returns {Promise<Object>} - Статистика
 */
async function getStats() {
    try {
        const vectorStoreInstance = vectorStore.getVectorStore();
        const generatorInstance = embeddingGenerator.getEmbeddingGenerator();
        const solutionStats = await solutionAnalyzer.getSolutionStats();
        
        const storeStats = await vectorStoreInstance.getStats();
        const embeddingStats = generatorInstance.getMetrics();
        
        return {
            solutions: solutionStats,
            vectorStore: storeStats,
            embeddings: embeddingStats
        };
    } catch (error) {
        logger.error('Error getting stats', { error: error.message });
        
        return {
            error: error.message
        };
    }
}

/**
 * Очищает кэш
 * 
 * @returns {void}
 */
function clearCache() {
    try {
        const vectorStoreInstance = vectorStore.getVectorStore();
        const generatorInstance = embeddingGenerator.getEmbeddingGenerator();
        
        vectorStoreInstance.clearCache();
        generatorInstance.clearCache();
        
        logger.info('Learning system cache cleared');
    } catch (error) {
        logger.error('Error clearing cache', { error: error.message });
        throw error;
    }
}

/**
 * Утилитарные функции для работы с пространством эмбеддингов
 */
const embeddingUtils = {
    /**
     * Вычисляет косинусное сходство между двумя векторами
     * 
     * @param {Array} vec1 - Первый вектор
     * @param {Array} vec2 - Второй вектор
     * @returns {number} - Значение сходства (от 0 до 1)
     */
    cosineSimilarity(vec1, vec2) {
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
        
        if (norm1 === 0 || norm2 === 0) {
            return 0;
        }
        
        return dotProduct / (norm1 * norm2);
    },
    
    /**
     * Разбивает текст на куски
     * 
     * @param {string} text - Текст для разбиения
     * @param {Object} options - Опции разбиения
     * @returns {Array<string>} - Массив кусков текста
     */
    chunkText(text, options = {}) {
        const generator = embeddingGenerator.getEmbeddingGenerator();
        return generator.chunkText(text, options);
    }
};

module.exports = {
    initialize,
    storeSolution,
    findSimilarTasks,
    enhancePromptWithExamples,
    generateEmbedding,
    generateBatchEmbeddings,
    getStats,
    clearCache,
    embeddingUtils,
    SCHEMAS: vectorStore.SCHEMAS
};
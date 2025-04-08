/**
 * Система анализа и исправления ошибок
 * Предоставляет интерфейс для классификации, анализа и исправления ошибок в коде
 */

const logger = require('../../utils/logger');
const errorClassifier = require('./error-classifier');
const autoFixEngine = require('./auto-fix-engine');
const errorPatterns = require('./error-patterns');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');

/**
 * Анализирует ошибку и предлагает решение
 * 
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} code - Код, вызвавший ошибку
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа и решения
 */
async function analyzeError(errorMessage, code, options = {}) {
    try {
        logger.info('Analyzing error', { 
            errorMessageLength: errorMessage?.length || 0,
            codeLength: code?.length || 0,
            options: Object.keys(options)
        });
        
        // Классифицируем ошибку
        const classification = await errorClassifier.classifyError(
            errorMessage,
            code,
            { 
                language: options.language,
                useLLM: options.useLLM !== false,
                details: true
            }
        );
        
        logger.debug('Error classified', { 
            errorType: classification.type,
            severity: classification.severity,
            confidence: classification.confidence
        });
        
        // Если указан контекст проекта, обогащаем классификацию
        if (options.projectContext) {
            await errorClassifier.enrichWithProjectContext(classification, options.projectContext);
        }
        
        // Предлагаем исправление
        const fix = await autoFixEngine.suggestAutoFix(
            classification,
            code,
            options
        );
        
        logger.debug('Fix suggestion generated', { 
            success: fix.success,
            confidence: fix.confidence
        });
        
        // Дополняем ответ более детальной информацией
        const result = {
            errorInfo: classification,
            fix: fix,
            recommendations: classification.solutions || [],
            success: classification.confidence > 0.5 || fix.confidence > 0.5
        };
        
        // Если требуется документация/примеры, добавляем их
        if (options.includeReferences) {
            result.references = await findDocumentation(classification, options);
        }
        
        return result;
    } catch (error) {
        logger.error('Error analyzing error', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            errorInfo: {
                type: 'unknown',
                severity: 'unknown',
                description: 'Не удалось проанализировать ошибку',
                causes: [`Внутренняя ошибка анализатора: ${error.message}`]
            },
            fix: {
                success: false,
                message: 'Не удалось предложить исправление'
            },
            recommendations: [
                'Проверьте сообщение об ошибке вручную',
                'Ищите похожие ошибки в документации или StackOverflow'
            ]
        };
    }
}

/**
 * Применяет исправление к коду
 * 
 * @param {string} code - Исходный код
 * @param {Object} fix - Предложенное исправление
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат применения исправления
 */
async function applyFix(code, fix, options = {}) {
    try {
        logger.info('Applying fix', {
            codeLength: code?.length || 0,
            fixSuccess: fix?.success,
            options: Object.keys(options)
        });
        
        // Применяем исправление с помощью autoFixEngine
        const result = await autoFixEngine.applyFix(code, fix, options);
        
        return result;
    } catch (error) {
        logger.error('Error applying fix', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при применении исправления: ${error.message}`,
            originalCode: code
        };
    }
}

/**
 * Находит документацию и примеры для ошибки
 * 
 * @private
 * @param {Object} errorInfo - Классификация ошибки
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Документация и примеры
 */
async function findDocumentation(errorInfo, options = {}) {
    try {
        const { type, severity, description } = errorInfo;
        const language = options.language || 'unknown';
        
        logger.debug('Finding documentation', { errorType: type, language });
        
        // Проверяем возможность получения документации через LLM
        if (options.useLLM !== false) {
            try {
                // Загружаем промпт для получения документации
                const prompt = await promptManager.getPrompt('error-documentation', {
                    error_type: type,
                    error_description: description,
                    language: language
                });
                
                // Отправляем запрос к LLM
                const response = await llmClient.sendPrompt(prompt, {
                    temperature: 0.3,
                    structuredOutput: true
                });
                
                // Обрабатываем ответ
                let parsedResponse;
                
                if (typeof response === 'string') {
                    // Пытаемся извлечь JSON
                    try {
                        const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                                       response.match(/\{[\s\S]*\}/);
                                       
                        if (jsonMatch) {
                            parsedResponse = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                        }
                    } catch (e) {
                        logger.warn('Failed to parse LLM documentation response', { error: e.message });
                    }
                    
                    // Если не удалось распарсить, возвращаем текст
                    if (!parsedResponse) {
                        return {
                            explanation: response,
                            examples: [],
                            links: []
                        };
                    }
                } else {
                    // Если ответ уже в виде объекта
                    parsedResponse = response;
                }
                
                return {
                    explanation: parsedResponse.explanation || description,
                    examples: parsedResponse.examples || [],
                    links: parsedResponse.links || []
                };
            } catch (llmError) {
                logger.warn('Error getting documentation from LLM', { error: llmError.message });
                // В случае ошибки LLM продолжаем и возвращаем базовую информацию
            }
        }
        
        // Если не удалось получить документацию через LLM, возвращаем базовую информацию
        return {
            explanation: description,
            examples: [],
            links: []
        };
    } catch (error) {
        logger.error('Error finding documentation', { error: error.message });
        return {
            explanation: errorInfo.description || 'Нет объяснения',
            examples: [],
            links: []
        };
    }
}

/**
 * Регистрирует новый шаблон ошибки
 * 
 * @param {string} language - Язык программирования
 * @param {Object} pattern - Шаблон ошибки
 * @returns {boolean} - Успешность регистрации
 */
function registerErrorPattern(language, pattern) {
    return errorPatterns.registerPattern(language, pattern);
}

/**
 * Получает шаблоны ошибок для заданного типа и языка
 * 
 * @param {string} errorType - Тип ошибки
 * @param {string} language - Язык программирования
 * @returns {Array} - Массив шаблонов
 */
function getErrorPatterns(errorType, language) {
    return errorPatterns.getPatterns(errorType, language);
}

module.exports = {
    analyzeError,
    applyFix,
    registerErrorPattern,
    getErrorPatterns
};
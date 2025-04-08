/**
 * Движок автоматического исправления ошибок
 * Предлагает и применяет исправления для распространенных типов ошибок
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const errorClassifier = require('./error-classifier');
const errorPatterns = require('./error-patterns');

/**
 * Предлагает исправление для ошибки
 * 
 * @param {Object} errorInfo - Информация об ошибке
 * @param {string} code - Код с ошибкой
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Предложенное исправление
 */
async function suggestAutoFix(errorInfo, code, options = {}) {
    try {
        logger.info('Suggesting auto-fix', { 
            errorType: errorInfo.type,
            codeLength: code?.length || 0,
            options: Object.keys(options)
        });
        
        // Если не предоставлена классификация ошибки, классифицируем
        let classification = errorInfo;
        if (!errorInfo.type || !errorInfo.severity) {
            logger.debug('Classification not provided, classifying error');
            classification = await errorClassifier.classifyError(
                errorInfo.message || errorInfo.toString(),
                code,
                { language: options.language }
            );
        }
        
        // Получаем тип ошибки и язык
        const errorType = classification.type;
        const language = options.language || detectLanguage(code);
        
        // Если доступны предопределенные шаблоны исправлений, пробуем их
        const patternFix = await suggestFixFromPatterns(errorType, classification.match, code, language);
        
        if (patternFix && patternFix.confidence > 0.7) {
            logger.debug('Found high-confidence pattern-based fix', { 
                errorType,
                confidence: patternFix.confidence
            });
            
            return patternFix;
        }
        
        // Если нет подходящего шаблона или он с низкой уверенностью, используем LLM
        const llmFix = await suggestFixWithLLM(classification, code, {
            ...options,
            patternFix: patternFix // Передаем найденный шаблон для контекста
        });
        
        // Если есть шаблонное исправление, но с низкой уверенностью, 
        // комбинируем его с результатом LLM
        if (patternFix && patternFix.confidence > 0.3) {
            // Предлагаем оба варианта с указанием источника
            return {
                ...llmFix,
                alternatives: [
                    { 
                        ...patternFix,
                        source: 'pattern'
                    },
                    {
                        ...llmFix,
                        source: 'llm'
                    }
                ]
            };
        }
        
        return llmFix;
    } catch (error) {
        logger.error('Error suggesting auto-fix', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Не удалось предложить исправление: ${error.message}`,
            confidence: 0
        };
    }
}

/**
 * Предлагает исправление на основе известных шаблонов ошибок
 * 
 * @private
 * @param {string} errorType - Тип ошибки
 * @param {string} errorMatch - Совпадение с шаблоном ошибки
 * @param {string} code - Код с ошибкой
 * @param {string} language - Язык программирования
 * @returns {Promise<Object|null>} - Предложенное исправление или null
 */
async function suggestFixFromPatterns(errorType, errorMatch, code, language) {
    try {
        // Получаем шаблоны для данного типа ошибки и языка
        const patterns = errorPatterns.getPatterns(errorType, language);
        
        if (!patterns || patterns.length === 0) {
            logger.debug('No patterns found for error type and language', { 
                errorType, 
                language 
            });
            return null;
        }
        
        // Ищем наиболее подходящий шаблон
        let bestPattern = null;
        let bestConfidence = 0;
        
        for (const pattern of patterns) {
            // Проверяем соответствие шаблона
            const match = (typeof pattern.detect === 'function')
                ? pattern.detect(code, errorMatch)
                : (pattern.detectRegex && errorMatch && errorMatch.match(pattern.detectRegex));
            
            if (match) {
                // Вычисляем уверенность на основе специфичности шаблона
                let confidence = 0.5;
                
                // Если шаблон указывает конкретную уверенность, используем ее
                if (pattern.confidence) {
                    confidence = pattern.confidence;
                } else {
                    // Иначе вычисляем на основе полноты совпадения
                    if (typeof pattern.detect === 'function') {
                        // Функциональные детекторы обычно более точны
                        confidence = 0.7;
                    } else if (match.length > 1) {
                        // Если есть группы захвата, повышаем уверенность
                        confidence = 0.6 + (match.length - 1) * 0.05;
                    }
                }
                
                // Если этот шаблон лучше предыдущего, запоминаем его
                if (confidence > bestConfidence) {
                    bestPattern = pattern;
                    bestConfidence = confidence;
                }
            }
        }
        
        // Если не нашли подходящий шаблон, возвращаем null
        if (!bestPattern) {
            return null;
        }
        
        logger.debug('Found matching error pattern', { 
            errorType, 
            patternName: bestPattern.name
        });
        
        // Применяем шаблон для получения исправления
        let fix;
        
        if (typeof bestPattern.fix === 'function') {
            // Если есть функция исправления, вызываем ее
            fix = await bestPattern.fix(code, errorMatch);
        } else if (bestPattern.fixRegex && bestPattern.replacement) {
            // Если есть регулярное выражение и замена, применяем их
            fix = {
                fixedCode: code.replace(bestPattern.fixRegex, bestPattern.replacement),
                description: bestPattern.description,
                explanation: bestPattern.explanation
            };
        } else {
            // Если нет конкретного механизма исправления, используем общее описание
            fix = {
                fixedCode: null,
                description: bestPattern.description,
                explanation: bestPattern.explanation || 'Автоматическое исправление невозможно для этого шаблона'
            };
        }
        
        return {
            success: !!fix.fixedCode,
            fixedCode: fix.fixedCode,
            description: fix.description,
            explanation: fix.explanation,
            confidence: bestConfidence,
            patternName: bestPattern.name
        };
    } catch (error) {
        logger.error('Error suggesting fix from patterns', { 
            error: error.message,
            errorType,
            language
        });
        
        return null;
    }
}

/**
 * Предлагает исправление с использованием LLM
 * 
 * @private
 * @param {Object} classification - Классификация ошибки
 * @param {string} code - Код с ошибкой
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Предложенное исправление
 */
async function suggestFixWithLLM(classification, code, options = {}) {
    try {
        logger.debug('Suggesting fix with LLM', {
            errorType: classification.type,
            codeLength: code?.length || 0
        });
        
        // Загружаем промпт для исправления ошибки
        const prompt = await promptManager.getPrompt('error-fix', {
            error_message: classification.match || classification.description || '',
            error_type: classification.type,
            error_causes: classification.causes ? classification.causes.join('\n') : '',
            code: code || 'Код не предоставлен',
            language: options.language || detectLanguage(code) || 'Не определен',
            pattern_fix: options.patternFix ? 
                JSON.stringify({
                    description: options.patternFix.description,
                    explanation: options.patternFix.explanation
                }, null, 2) : 'Не найдено'
        });
        
        // Отправляем запрос к LLM
        const response = await llmClient.sendPrompt(prompt, {
            temperature: 0.3,
            structuredOutput: true
        });
        
        // Обрабатываем ответ
        let parsedResponse;
        
        if (typeof response === 'string') {
            // Если ответ в виде строки, пытаемся извлечь JSON
            try {
                const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                                response.match(/\{[\s\S]*\}/);
                                
                if (jsonMatch) {
                    parsedResponse = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    // Если не нашли JSON, ищем код исправления
                    const codeMatch = response.match(/```(?:javascript|python|java|cpp|csharp|go|ruby|php|typescript|sql)?\n([\s\S]*?)\n```/);
                    
                    if (codeMatch) {
                        // Создаем базовый объект с исправленным кодом
                        parsedResponse = {
                            fixedCode: codeMatch[1],
                            description: 'Исправление на основе анализа LLM',
                            explanation: 'Код был исправлен с использованием анализа ошибки',
                            changes: ['Полная замена кода']
                        };
                    } else {
                        throw new Error('No JSON or code block found in LLM response');
                    }
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response', { error: e.message });
                
                // Возвращаем базовый объект с сырым ответом
                return {
                    success: false,
                    message: 'Не удалось обработать ответ LLM',
                    rawResponse: response,
                    confidence: 0.3
                };
            }
        } else {
            // Если ответ уже в виде объекта
            parsedResponse = response;
        }
        
        // Убеждаемся, что в ответе есть все необходимые поля
        return {
            success: !!parsedResponse.fixedCode,
            fixedCode: parsedResponse.fixedCode,
            description: parsedResponse.description || 'Исправление на основе LLM',
            explanation: parsedResponse.explanation || 'Нет объяснения',
            changes: parsedResponse.changes || [],
            confidence: parsedResponse.confidence || 0.7,
            analysis: parsedResponse.analysis || null
        };
    } catch (error) {
        logger.error('Error suggesting fix with LLM', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при запросе к LLM: ${error.message}`,
            confidence: 0
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
            fixType: fix.patternName || 'custom',
            codeLength: code?.length || 0
        });
        
        if (!fix.fixedCode) {
            return {
                success: false,
                message: 'Исправление не содержит исправленного кода',
                originalCode: code
            };
        }
        
        // Если fixedCode - это полный код, а не патчи/изменения
        if (typeof fix.fixedCode === 'string') {
            // Проверяем, отличается ли исправленный код от оригинала
            if (fix.fixedCode === code) {
                return {
                    success: false,
                    message: 'Исправленный код идентичен оригиналу',
                    originalCode: code,
                    fixedCode: fix.fixedCode
                };
            }
            
            return {
                success: true,
                message: fix.description || 'Исправление успешно применено',
                originalCode: code,
                fixedCode: fix.fixedCode,
                changes: fix.changes || calculateChanges(code, fix.fixedCode)
            };
        }
        
        // Если fixedCode - это массив патчей/изменений
        if (Array.isArray(fix.fixedCode)) {
            const patchedCode = applyPatches(code, fix.fixedCode);
            
            return {
                success: true,
                message: fix.description || 'Патчи успешно применены',
                originalCode: code,
                fixedCode: patchedCode,
                changes: fix.changes || fix.fixedCode
            };
        }
        
        return {
            success: false,
            message: 'Неподдерживаемый формат исправления',
            originalCode: code
        };
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
 * Вычисляет изменения между исходным и исправленным кодом
 * 
 * @private
 * @param {string} originalCode - Исходный код
 * @param {string} fixedCode - Исправленный код
 * @returns {Array} - Список изменений
 */
function calculateChanges(originalCode, fixedCode) {
    const changes = [];
    
    // Разбиваем код на строки
    const originalLines = originalCode.split('\n');
    const fixedLines = fixedCode.split('\n');
    
    // Алгоритм построчного сравнения (упрощенный)
    for (let i = 0; i < Math.max(originalLines.length, fixedLines.length); i++) {
        const originalLine = i < originalLines.length ? originalLines[i] : null;
        const fixedLine = i < fixedLines.length ? fixedLines[i] : null;
        
        if (originalLine !== fixedLine) {
            changes.push({
                line: i + 1,
                original: originalLine,
                fixed: fixedLine,
                type: !originalLine ? 'add' : (!fixedLine ? 'remove' : 'change')
            });
        }
    }
    
    return changes;
}

/**
 * Применяет патчи к коду
 * 
 * @private
 * @param {string} code - Исходный код
 * @param {Array} patches - Патчи для применения
 * @returns {string} - Код с примененными патчами
 */
function applyPatches(code, patches) {
    let result = code;
    
    // Сортируем патчи в обратном порядке позиций,
    // чтобы индексы не менялись при применении
    const sortedPatches = [...patches].sort((a, b) => {
        if (a.position.start !== b.position.start) {
            return b.position.start - a.position.start;
        }
        return b.position.end - a.position.end;
    });
    
    // Применяем каждый патч
    for (const patch of sortedPatches) {
        const { position, replacement } = patch;
        
        // Проверяем границы
        if (position.start < 0 || position.end > result.length || position.start > position.end) {
            logger.warn('Invalid patch position', { position });
            continue;
        }
        
        // Применяем замену
        result = result.substring(0, position.start) + 
                replacement + 
                result.substring(position.end);
    }
    
    return result;
}

/**
 * Определяет язык программирования по коду
 * 
 * @private
 * @param {string} code - Код
 * @returns {string} - Определенный язык программирования
 */
function detectLanguage(code) {
    if (!code) return null;
    
    // Признаки различных языков
    const codeSignatures = {
        javascript: [
            /const |let |var |function\s+\w+\s*\(|=>/,
            /console\.log|import\s+.*\s+from|require\(|export\s+/,
            /\[\s*\.\.\.\w+\s*\]|\.\.\.\w+/
        ],
        typescript: [
            /interface |type\s+\w+\s*=|<\w+>|:\s*\w+/,
            /implements |extends |public\s+|private\s+|protected\s+/
        ],
        python: [
            /def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/,
            /if\s+__name__\s*==\s*('|")__main__('|")/
        ],
        java: [
            /public\s+class|private\s+static|public\s+static|void\s+main/,
            /System\.out\.println|import\s+java\./
        ],
        csharp: [
            /namespace\s+\w+|using\s+System|public\s+class|private\s+void/,
            /Console\.WriteLine|List<|Dictionary<|IEnumerable<|async\s+Task/
        ],
        sql: [
            /SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM|CREATE\s+TABLE/i
        ],
        php: [
            /<\?php|\$\w+\s*=|echo\s+|function\s+\w+\s*\(/
        ],
        ruby: [
            /def\s+\w+|class\s+\w+\s*<|require\s+('|")|puts\s+/
        ],
        go: [
            /func\s+\w+\s*\(|package\s+main|import\s+\(/,
            /fmt\.Println|go\s+func/
        ]
    };
    
    for (const [language, signatures] of Object.entries(codeSignatures)) {
        for (const signature of signatures) {
            if (signature.test(code)) {
                return language;
            }
        }
    }
    
    return null;
}

/**
 * Проверяет, относится ли ошибка к общей категории
 * 
 * @param {string} errorType - Тип ошибки
 * @param {string} category - Категория ошибок
 * @returns {boolean} - true, если ошибка относится к категории
 */
function isErrorInCategory(errorType, category) {
    const categories = {
        syntax: ['syntax_error', 'unexpected_token', 'missing_bracket', 'missing_semicolon'],
        reference: ['reference_error', 'name_error', 'undefined_variable', 'null_reference'],
        type: ['type_error', 'type_mismatch', 'wrong_argument_type'],
        import: ['import_error', 'module_error', 'dependency_error'],
        database: ['sql_error', 'query_error', 'table_not_found', 'column_not_found']
    };
    
    return categories[category] && categories[category].includes(errorType);
}

module.exports = {
    suggestAutoFix,
    applyFix,
    isErrorInCategory
};
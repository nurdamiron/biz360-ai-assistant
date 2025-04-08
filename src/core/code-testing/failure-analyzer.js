/**
 * Анализатор причин падения тестов
 * Изучает отчеты о сбоях тестов, логи и стек-трейсы для определения корневых причин
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const errorClassifier = require('../error-corrector/error-classifier');
const autoFixEngine = require('../error-corrector/auto-fix-engine');

/**
 * Анализирует причину падения теста
 * 
 * @param {Object} testResult - Результат выполнения теста
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Анализ причины падения теста
 */
async function explainTestFailure(testResult, testCode, sourceCode, options = {}) {
    try {
        logger.info('Analyzing test failure', { 
            testName: testResult.name || options.testName,
            options: Object.keys(options)
        });
        
        // Проверяем входные данные
        if (!testResult) {
            return {
                success: false,
                message: 'Не предоставлены результаты теста'
            };
        }
        
        // Извлекаем сообщение об ошибке и стек-трейс
        const errorMessage = extractErrorMessage(testResult);
        const stackTrace = extractStackTrace(testResult);
        
        if (!errorMessage) {
            return {
                success: false,
                message: 'Не найдено сообщение об ошибке'
            };
        }
        
        // Классифицируем ошибку
        const errorInfo = await classifyTestError(errorMessage, stackTrace, options);
        
        logger.debug('Test error classified', { 
            errorType: errorInfo.type,
            severity: errorInfo.severity,
            confidence: errorInfo.confidence
        });
        
        // Исследуем возможные причины
        let rootCauses = [];
        let suggestionInfo = {};
        
        // Если есть код теста и исходный код, выполняем углубленный анализ
        if (testCode && sourceCode) {
            ({ rootCauses, suggestionInfo } = await analyzeWithCode(
                errorInfo,
                errorMessage,
                stackTrace,
                testCode,
                sourceCode,
                options
            ));
        } else {
            // Иначе выполняем базовый анализ
            ({ rootCauses, suggestionInfo } = await analyzeWithoutCode(
                errorInfo,
                errorMessage,
                stackTrace,
                options
            ));
        }
        
        // Формируем рекомендации
        const recommendations = generateRecommendations(errorInfo, rootCauses, suggestionInfo, options);
        
        // Определяем серьезность проблемы
        const severity = determineSeverity(errorInfo, rootCauses, options);
        
        logger.debug('Test failure analysis completed', { 
            rootCauses: rootCauses.length,
            recommendations: recommendations.length,
            severity
        });
        
        return {
            success: true,
            errorInfo,
            rootCauses,
            recommendations,
            severity,
            suggestionInfo
        };
    } catch (error) {
        logger.error('Error analyzing test failure', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при анализе падения теста: ${error.message}`
        };
    }
}

/**
 * Извлекает сообщение об ошибке из результата теста
 * 
 * @private
 * @param {Object} testResult - Результат выполнения теста
 * @returns {string} - Сообщение об ошибке
 */
function extractErrorMessage(testResult) {
    // Возможные пути к сообщению об ошибке
    const paths = [
        testResult.error?.message,
        testResult.errorMessage,
        testResult.failureMessage,
        testResult.message,
        testResult.error?.toString(),
        testResult.error
    ];
    
    // Возвращаем первое найденное сообщение
    for (const path of paths) {
        if (path && typeof path === 'string') {
            return path;
        }
    }
    
    // Если сообщение не найдено, пробуем извлечь его из вывода
    if (testResult.stdout) {
        const errorLines = testResult.stdout.split('\n')
            .filter(line => line.includes('Error:') || line.includes('AssertionError:'));
            
        if (errorLines.length > 0) {
            return errorLines[0];
        }
    }
    
    // Если ничего не найдено, возвращаем общее сообщение
    return 'Неизвестная ошибка в тесте';
}

/**
 * Извлекает стек-трейс из результата теста
 * 
 * @private
 * @param {Object} testResult - Результат выполнения теста
 * @returns {string} - Стек-трейс
 */
function extractStackTrace(testResult) {
    // Возможные пути к стек-трейсу
    const paths = [
        testResult.error?.stack,
        testResult.stackTrace,
        testResult.error?.stackTrace
    ];
    
    // Возвращаем первый найденный стек-трейс
    for (const path of paths) {
        if (path && typeof path === 'string') {
            return path;
        }
    }
    
    // Если стек-трейс не найден, пробуем извлечь его из вывода
    if (testResult.stdout) {
        const stackLines = testResult.stdout.split('\n')
            .filter(line => line.includes('at ') && line.includes('.js:'));
            
        if (stackLines.length > 0) {
            return stackLines.join('\n');
        }
    }
    
    if (testResult.stderr) {
        const stackLines = testResult.stderr.split('\n')
            .filter(line => line.includes('at ') && line.includes('.js:'));
            
        if (stackLines.length > 0) {
            return stackLines.join('\n');
        }
    }
    
    // Если ничего не найдено, возвращаем пустую строку
    return '';
}

/**
 * Классифицирует ошибку теста
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Классификация ошибки
 */
async function classifyTestError(errorMessage, stackTrace, options = {}) {
    try {
        // Специфические типы ошибок тестов
        const testSpecificErrorTypes = {
            // Ошибки ожиданий
            assertion: /AssertionError|expect\(.*\)\.to|assert\(|expect\(.*\)\s*==|expect\.|\.to\.equal|\.to\.be\.|\.to\.have\./i,
            // Проблемы таймаутов
            timeout: /Timeout|timed out|async callback was not invoked within|exceeded timeout/i,
            // Ошибки асинхронности
            async: /Async callback was not invoked|callback expected|promise rejected|await|async function/i,
            // Проблемы моков/стабов
            mocking: /mock|stub|spy|cannot spy on|to have been called|to be called|was not called|fake function|jest.fn|sinon/i,
            // Ошибки в API HTTP
            http: /status\s+\d+|response|request|api|endpoint|fetch|axios|http|network/i
        };
        
        let errorType = 'unknown';
        let errorDescription = 'Неизвестная ошибка теста';
        let errorSeverity = 'medium';
        let confidence = 0.5;
        
        // Сначала проверяем специфические типы ошибок тестов
        for (const [type, pattern] of Object.entries(testSpecificErrorTypes)) {
            if (pattern.test(errorMessage) || (stackTrace && pattern.test(stackTrace))) {
                errorType = type;
                confidence = 0.7;
                
                // Устанавливаем описание в зависимости от типа
                switch (type) {
                    case 'assertion':
                        errorDescription = 'Ошибка утверждения (assertion failure)';
                        errorSeverity = 'medium';
                        break;
                    case 'timeout':
                        errorDescription = 'Превышение времени ожидания';
                        errorSeverity = 'medium';
                        break;
                    case 'async':
                        errorDescription = 'Ошибка асинхронного выполнения';
                        errorSeverity = 'high';
                        break;
                    case 'mocking':
                        errorDescription = 'Проблема с моками или стабами';
                        errorSeverity = 'medium';
                        break;
                    case 'http':
                        errorDescription = 'Ошибка HTTP или сетевого запроса';
                        errorSeverity = 'high';
                        break;
                }
                
                break;
            }
        }
        
        // Если не нашли специфический тип, используем общую классификацию ошибок
        if (errorType === 'unknown') {
            try {
                // Пытаемся использовать классификатор ошибок (если доступен)
                const classification = await errorClassifier.classifyError(
                    errorMessage,
                    null, // код не предоставляем
                    { 
                        useLLM: options.useLLM !== false,
                        details: true
                    }
                );
                
                // Если классификация успешна, используем ее
                if (classification.type !== 'unknown') {
                    errorType = classification.type;
                    errorDescription = classification.description;
                    errorSeverity = classification.severity;
                    confidence = classification.confidence;
                }
            } catch (e) {
                logger.warn('Error using error classifier', { error: e.message });
            }
        }
        
        return {
            type: errorType,
            description: errorDescription,
            severity: errorSeverity,
            confidence,
            message: errorMessage,
            stackTrace
        };
    } catch (error) {
        logger.error('Error classifying test error', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            type: 'unknown',
            description: 'Не удалось классифицировать ошибку',
            severity: 'medium',
            confidence: 0.3,
            message: errorMessage,
            stackTrace
        };
    }
}

/**
 * Анализирует причины ошибки с использованием кода
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeWithCode(errorInfo, errorMessage, stackTrace, testCode, sourceCode, options) {
    try {
        let rootCauses = [];
        let suggestionInfo = {};
        
        // Для некоторых типов ошибок у нас есть специфические стратегии анализа
        switch (errorInfo.type) {
            case 'assertion':
                ({ rootCauses, suggestionInfo } = await analyzeAssertionError(
                    errorMessage, 
                    testCode, 
                    sourceCode, 
                    options
                ));
                break;
                
            case 'async':
                ({ rootCauses, suggestionInfo } = await analyzeAsyncError(
                    errorMessage, 
                    stackTrace, 
                    testCode, 
                    sourceCode, 
                    options
                ));
                break;
                
            case 'mocking':
                ({ rootCauses, suggestionInfo } = await analyzeMockingError(
                    errorMessage, 
                    testCode, 
                    sourceCode, 
                    options
                ));
                break;
                
            case 'http':
                ({ rootCauses, suggestionInfo } = await analyzeHttpError(
                    errorMessage, 
                    testCode, 
                    sourceCode, 
                    options
                ));
                break;
                
            default:
                // Для других типов ошибок используем общий анализ
                ({ rootCauses, suggestionInfo } = await analyzeGenericError(
                    errorInfo,
                    errorMessage,
                    stackTrace,
                    testCode,
                    sourceCode,
                    options
                ));
                break;
        }
        
        // Если не удалось определить причины, используем LLM (если разрешено)
        if (rootCauses.length === 0 && options.useLLM !== false) {
            const llmAnalysis = await analyzeWithLLM(
                errorInfo,
                errorMessage,
                stackTrace,
                testCode,
                sourceCode,
                options
            );
            
            rootCauses = llmAnalysis.rootCauses;
            
            // Если есть предложения по исправлению, добавляем их
            if (llmAnalysis.fixSuggestion) {
                suggestionInfo = {
                    ...suggestionInfo,
                    llmFixSuggestion: llmAnalysis.fixSuggestion
                };
            }
        }
        
        // Если есть опция autoFixTest, пытаемся автоматически исправить тест
        if (options.autoFixTest && testCode) {
            try {
                const fixSuggestion = await autoFixEngine.suggestAutoFix(
                    { 
                        type: errorInfo.type, 
                        message: errorMessage 
                    },
                    testCode,
                    { 
                        language: 'javascript',
                        sourceCode
                    }
                );
                
                if (fixSuggestion.success && fixSuggestion.fixedCode) {
                    suggestionInfo.fixSuggestion = fixSuggestion;
                }
            } catch (e) {
                logger.warn('Error generating auto-fix for test', { error: e.message });
            }
        }
        
        return { rootCauses, suggestionInfo };
    } catch (error) {
        logger.error('Error analyzing with code', { 
            error: error.message,
            stack: error.stack
        });
        
        return { 
            rootCauses: [{ 
                description: 'Ошибка при анализе кода', 
                confidence: 0.3,
                details: error.message
            }],
            suggestionInfo: {}
        };
    }
}

/**
 * Анализирует причины ошибки без использования кода
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeWithoutCode(errorInfo, errorMessage, stackTrace, options) {
    try {
        let rootCauses = [];
        let suggestionInfo = {};
        
        // Извлекаем возможные причины из сообщения об ошибке
        switch (errorInfo.type) {
            case 'assertion':
                rootCauses = extractAssertionCauses(errorMessage);
                break;
                
            case 'timeout':
                rootCauses = extractTimeoutCauses(errorMessage, stackTrace);
                break;
                
            case 'async':
                rootCauses = extractAsyncCauses(errorMessage, stackTrace);
                break;
                
            case 'mocking':
                rootCauses = extractMockingCauses(errorMessage);
                break;
                
            case 'http':
                rootCauses = extractHttpCauses(errorMessage);
                break;
                
            default:
                // Для других типов ошибок извлекаем информацию из стека и сообщения
                rootCauses = extractGenericCauses(errorMessage, stackTrace, errorInfo.type);
                break;
        }
        
        // Если не удалось определить причины и разрешено использование LLM, используем его
        if (rootCauses.length === 0 && options.useLLM !== false) {
            const llmAnalysis = await analyzeWithLLM(
                errorInfo,
                errorMessage,
                stackTrace,
                null, // без кода теста
                null, // без исходного кода
                options
            );
            
            rootCauses = llmAnalysis.rootCauses;
            
            // Если есть предложения по исправлению, добавляем их
            if (llmAnalysis.fixSuggestion) {
                suggestionInfo = {
                    ...suggestionInfo,
                    llmFixSuggestion: llmAnalysis.fixSuggestion
                };
            }
        }
        
        // Если все еще нет причин, добавляем общую причину
        if (rootCauses.length === 0) {
            rootCauses = [{
                description: `Неизвестная причина ошибки типа "${errorInfo.type}"`,
                confidence: 0.3,
                details: 'Для детального анализа требуется код теста и тестируемого компонента'
            }];
        }
        
        return { rootCauses, suggestionInfo };
    } catch (error) {
        logger.error('Error analyzing without code', { 
            error: error.message,
            stack: error.stack
        });
        
        return { 
            rootCauses: [{ 
                description: 'Ошибка при анализе', 
                confidence: 0.3,
                details: error.message
            }],
            suggestionInfo: {}
        };
    }
}

/**
 * Извлекает причины ошибок утверждений (assertions)
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @returns {Array} - Извлеченные причины
 */
function extractAssertionCauses(errorMessage) {
    const causes = [];
    
    // Проверяем наличие сравнения ожидаемого и актуального значений
    const expectedVsActualRegex = /Expected(?: value)?: (.*) (but |to |Actual|Received|Got).+?(?:Actual|Received|Got): (.*)/is;
    const match = errorMessage.match(expectedVsActualRegex);
    
    if (match) {
        const expected = match[1].trim();
        const actual = match[3].trim();
        
        causes.push({
            description: 'Несоответствие ожидаемого и фактического значений',
            confidence: 0.8,
            details: `Ожидалось: ${expected}, Получено: ${actual}`
        });
        
        // Проверяем наличие типичных проблем
        if (expected === 'true' && actual === 'false' || expected === 'false' && actual === 'true') {
            causes.push({
                description: 'Условие в assert/expect возвращает неверное булево значение',
                confidence: 0.7,
                details: 'Проверьте логику условия или инвертируйте ожидание'
            });
        } else if ((expected === 'undefined' || expected === 'null') && actual !== expected) {
            causes.push({
                description: 'Объект не существует или не инициализирован',
                confidence: 0.7,
                details: 'Проверьте правильность инициализации объекта и времени выполнения теста'
            });
        } else if (expected !== 'undefined' && expected !== 'null' && (actual === 'undefined' || actual === 'null')) {
            causes.push({
                description: 'Объект или значение не определены, хотя должны существовать',
                confidence: 0.7,
                details: 'Проверьте правильность инициализации и наличие возвращаемого значения'
            });
        }
    } else if (errorMessage.includes('to be') || errorMessage.includes('to equal') || 
               errorMessage.includes('to have') || errorMessage.includes('expected')) {
        // Общая ошибка утверждения без четкого формата
        causes.push({
            description: 'Утверждение не выполнено',
            confidence: 0.6,
            details: 'Фактический результат не соответствует ожидаемому'
        });
    }
    
    return causes;
}

/**
 * Извлекает причины ошибок таймаута
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @returns {Array} - Извлеченные причины
 */
function extractTimeoutCauses(errorMessage, stackTrace) {
    const causes = [];
    
    // Проверяем типичные причины таймаутов
    if (errorMessage.includes('async') || stackTrace.includes('async')) {
        causes.push({
            description: 'Асинхронная операция не завершилась в отведенное время',
            confidence: 0.7,
            details: 'Асинхронный код не вызвал callback, не разрешил промис или иным образом не сигнализировал о завершении'
        });
    } else if (errorMessage.includes('done') || stackTrace.includes('done(')) {
        causes.push({
            description: 'Функция done() не была вызвана',
            confidence: 0.8,
            details: 'Асинхронный тест использует callback done(), который не был вызван'
        });
    } else {
        causes.push({
            description: 'Превышение времени ожидания выполнения теста',
            confidence: 0.6,
            details: 'Тест выполнялся дольше, чем позволяет установленный таймаут'
        });
    }
    
    // Добавляем общие рекомендации
    causes.push({
        description: 'Возможное бесконечное ожидание или блокировка',
        confidence: 0.5,
        details: 'Проверьте наличие бесконечных циклов, блокирующих операций или зависших промисов'
    });
    
    return causes;
}

/**
 * Извлекает причины ошибок асинхронности
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @returns {Array} - Извлеченные причины
 */
function extractAsyncCauses(errorMessage, stackTrace) {
    const causes = [];
    
    if (errorMessage.includes('promise') && errorMessage.includes('reject')) {
        causes.push({
            description: 'Промис был отклонен (rejected)',
            confidence: 0.8,
            details: 'Асинхронная операция завершилась с ошибкой, и промис был отклонен'
        });
    } else if (errorMessage.includes('callback') && (errorMessage.includes('not invoked') || errorMessage.includes('not called'))) {
        causes.push({
            description: 'Callback-функция не была вызвана',
            confidence: 0.8,
            details: 'Асинхронная операция не вызвала переданный callback'
        });
    } else if (errorMessage.includes('await') || stackTrace.includes('await')) {
        causes.push({
            description: 'Проблема с использованием await',
            confidence: 0.7,
            details: 'Возможно, await используется вне async-функции или промис был отклонен'
        });
    } else {
        causes.push({
            description: 'Общая ошибка асинхронного выполнения',
            confidence: 0.5,
            details: 'Проблема связана с асинхронным выполнением кода теста или тестируемого компонента'
        });
    }
    
    return causes;
}

/**
 * Извлекает причины ошибок моков/стабов
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @returns {Array} - Извлеченные причины
 */
function extractMockingCauses(errorMessage) {
    const causes = [];
    
    if (errorMessage.includes('to have been called') || 
        errorMessage.includes('was not called') || 
        errorMessage.includes('expected to be called')) {
        
        causes.push({
            description: 'Мок-функция не была вызвана, хотя должна была',
            confidence: 0.8,
            details: 'Ожидалось, что мок-функция будет вызвана, но этого не произошло'
        });
    } else if (errorMessage.includes('called with') || 
              errorMessage.includes('argument') || 
              errorMessage.includes('parameter')) {
        
        causes.push({
            description: 'Мок-функция была вызвана с неправильными аргументами',
            confidence: 0.8,
            details: 'Аргументы, переданные в мок-функцию, не соответствуют ожидаемым'
        });
    } else if (errorMessage.includes('cannot spy') || 
              errorMessage.includes('cannot stub')) {
        
        causes.push({
            description: 'Не удалось создать мок или стаб для объекта или метода',
            confidence: 0.8,
            details: 'Возможно, объект или метод не существует, или нельзя создать мок для данного типа объекта'
        });
    } else if (errorMessage.includes('times') || 
              errorMessage.includes('count')) {
        
        causes.push({
            description: 'Мок-функция была вызвана неправильное количество раз',
            confidence: 0.8,
            details: 'Количество вызовов мок-функции не соответствует ожидаемому'
        });
    } else {
        causes.push({
            description: 'Общая проблема с моками или стабами',
            confidence: 0.5,
            details: 'Проверьте правильность создания и использования моков'
        });
    }
    
    return causes;
}

/**
 * Извлекает причины ошибок HTTP/API
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @returns {Array} - Извлеченные причины
 */
function extractHttpCauses(errorMessage) {
    const causes = [];
    
    // Проверяем типичные HTTP-ошибки
    const statusCodeRegex = /status\s+(\d+)/i;
    const statusCodeMatch = errorMessage.match(statusCodeRegex);
    
    if (statusCodeMatch) {
        const statusCode = parseInt(statusCodeMatch[1], 10);
        
        // В зависимости от кода состояния
        if (statusCode === 401 || statusCode === 403) {
            causes.push({
                description: `Ошибка аутентификации/авторизации (${statusCode})`,
                confidence: 0.8,
                details: 'Недостаточно прав доступа или некорректные учетные данные'
            });
        } else if (statusCode === 404) {
            causes.push({
                description: 'Ресурс не найден (404)',
                confidence: 0.8,
                details: 'Запрашиваемый URL или ресурс не существует'
            });
        } else if (statusCode === 400) {
            causes.push({
                description: 'Некорректный запрос (400)',
                confidence: 0.8,
                details: 'Сервер не смог понять запрос из-за некорректного синтаксиса'
            });
        } else if (statusCode === 500) {
            causes.push({
                description: 'Внутренняя ошибка сервера (500)',
                confidence: 0.8,
                details: 'Сервер столкнулся с неожиданной ошибкой'
            });
        } else if (statusCode >= 400 && statusCode < 500) {
            causes.push({
                description: `Ошибка клиента (${statusCode})`,
                confidence: 0.7,
                details: 'Проблема на стороне клиента при выполнении HTTP-запроса'
            });
        } else if (statusCode >= 500) {
            causes.push({
                description: `Ошибка сервера (${statusCode})`,
                confidence: 0.7,
                details: 'Проблема на стороне сервера при обработке HTTP-запроса'
            });
        }
    } else if (errorMessage.includes('timeout') || 
              errorMessage.includes('timed out')) {
        
        causes.push({
            description: 'Таймаут HTTP-запроса',
            confidence: 0.8,
            details: 'Сервер не ответил на запрос в отведенное время'
        });
    } else if (errorMessage.includes('connection') || 
              errorMessage.includes('network')) {
        
        causes.push({
            description: 'Ошибка сетевого соединения',
            confidence: 0.8,
            details: 'Проблема с установлением соединения с сервером'
        });
    } else if (errorMessage.includes('parse') || 
              errorMessage.includes('JSON')) {
        
        causes.push({
            description: 'Ошибка парсинга ответа',
            confidence: 0.8,
            details: 'Невозможно распарсить ответ сервера, возможно, некорректный JSON'
        });
    } else {
        causes.push({
            description: 'Общая ошибка HTTP/API',
            confidence: 0.5,
            details: 'Проблема при выполнении HTTP-запроса или обработке ответа'
        });
    }
    
    return causes;
}

/**
 * Извлекает причины общих ошибок
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {string} errorType - Тип ошибки
 * @returns {Array} - Извлеченные причины
 */
function extractGenericCauses(errorMessage, stackTrace, errorType) {
    const causes = [];
    
    switch (errorType) {
        case 'syntax_error':
            causes.push({
                description: 'Синтаксическая ошибка в коде',
                confidence: 0.7,
                details: 'Проверьте синтаксис на наличие опечаток, отсутствующих скобок и т.д.'
            });
            break;
            
        case 'reference_error':
            causes.push({
                description: 'Обращение к несуществующей переменной',
                confidence: 0.7,
                details: 'Переменная не объявлена или не доступна в текущей области видимости'
            });
            break;
            
        case 'type_error':
            causes.push({
                description: 'Ошибка типов данных',
                confidence: 0.7,
                details: 'Операция выполняется с неправильным типом данных'
            });
            break;
            
        case 'null_reference':
            causes.push({
                description: 'Обращение к свойству null или undefined',
                confidence: 0.7,
                details: 'Попытка обратиться к свойству объекта, который равен null или undefined'
            });
            break;
            
        default:
            // Если тип неизвестен, пытаемся определить по ключевым словам
            if (errorMessage.includes('undefined') || errorMessage.includes('null')) {
                causes.push({
                    description: 'Обращение к несуществующему объекту или свойству',
                    confidence: 0.6,
                    details: 'Объект или свойство равно null или undefined'
                });
            } else if (stackTrace && (stackTrace.includes('.js:') || stackTrace.includes('.ts:'))) {
                // Извлекаем файл и строку из стека
                const stackMatch = stackTrace.match(/at\s+(?:.*\s+\()?([^:]+):(\d+)(?::(\d+))?\)?/);
                
                if (stackMatch) {
                    const file = stackMatch[1];
                    const line = stackMatch[2];
                    
                    causes.push({
                        description: 'Ошибка в файле',
                        confidence: 0.5,
                        details: `Ошибка возникла в файле ${file}, строка ${line}`
                    });
                }
            }
            
            // Добавляем общую причину
            if (causes.length === 0) {
                causes.push({
                    description: 'Неизвестная причина ошибки',
                    confidence: 0.3,
                    details: 'Для точного определения причины требуется анализ кода'
                });
            }
            break;
    }
    
    return causes;
}

/**
 * Анализирует ошибку утверждения (assertion)
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeAssertionError(errorMessage, testCode, sourceCode, options) {
    let rootCauses = extractAssertionCauses(errorMessage);
    let suggestionInfo = {};
    
    // Если у нас есть коды, выполняем более глубокий анализ
    if (testCode && sourceCode) {
        // Ищем конкретное утверждение, которое не прошло
        const assertionRegex = /expect\([^)]+\)\.\w+|assert\(|assert\.\w+\(/g;
        const assertions = [];
        
        let match;
        while ((match = assertionRegex.exec(testCode)) !== null) {
            assertions.push({
                text: match[0],
                index: match.index
            });
        }
        
        if (assertions.length > 0) {
            // Если в сообщении об ошибке есть строка, ищем соответствующее утверждение
            const lineMatch = errorMessage.match(/line\s+(\d+)/i);
            
            if (lineMatch) {
                const errorLine = parseInt(lineMatch[1], 10);
                
                // Разбиваем код на строки
                const lines = testCode.split('\n');
                
                // Находим утверждение на указанной строке
                if (errorLine > 0 && errorLine <= lines.length) {
                    const lineContent = lines[errorLine - 1];
                    
                    rootCauses.push({
                        description: 'Ошибка в утверждении',
                        confidence: 0.8,
                        details: `Проблемное утверждение (строка ${errorLine}): ${lineContent.trim()}`
                    });
                }
            }
        }
        
        // Проверяем наличие типичных проблем
        if (testCode.includes('toBe(') && errorMessage.includes('equal')) {
            rootCauses.push({
                description: 'Использование toBe() вместо toEqual() для объектов',
                confidence: 0.7,
                details: 'Метод toBe() проверяет идентичность объектов, а не их содержимое. Для проверки содержимого используйте toEqual()'
            });
            
            suggestionInfo.suggestion = 'Замените toBe() на toEqual() для сравнения объектов';
        } else if (testCode.includes('toEqual(') && errorMessage.includes('be the same')) {
            rootCauses.push({
                description: 'Использование toEqual() вместо toBe() для примитивных значений',
                confidence: 0.7,
                details: 'Для примитивных значений предпочтительнее использовать toBe()'
            });
            
            suggestionInfo.suggestion = 'Замените toEqual() на toBe() для примитивных значений';
        }
    }
    
    return { rootCauses, suggestionInfo };
}

/**
 * Анализирует ошибку асинхронности
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeAsyncError(errorMessage, stackTrace, testCode, sourceCode, options) {
    let rootCauses = extractAsyncCauses(errorMessage, stackTrace);
    let suggestionInfo = {};
    
    // Если у нас есть коды, выполняем более глубокий анализ
    if (testCode) {
        // Проверяем использование async/await и промисов
        const hasAsync = testCode.includes('async ');
        const hasAwait = testCode.includes('await ');
        const hasPromise = testCode.includes('Promise') || testCode.includes('.then(') || testCode.includes('.catch(');
        const hasDone = testCode.includes('done') && testCode.includes('function');
        
        if (hasAwait && !hasAsync) {
            rootCauses.push({
                description: 'Использование await без async-функции',
                confidence: 0.9,
                details: 'Ключевое слово await может использоваться только внутри async-функций'
            });
            
            suggestionInfo.suggestion = 'Добавьте ключевое слово async перед определением функции';
        } else if (hasPromise && hasDone) {
            rootCauses.push({
                description: 'Смешивание промисов и колбеков',
                confidence: 0.8,
                details: 'В тесте используются и промисы, и функция done(), что может привести к конфликтам'
            });
            
            suggestionInfo.suggestion = 'Используйте либо промисы/async-await, либо колбеки, но не оба подхода одновременно';
        } else if (hasDone && testCode.includes('return')) {
            // Ищем возврат значения без вызова done()
            const returnRegex = /return\s+[^;]*?(?!done\(\))/g;
            if (returnRegex.test(testCode)) {
                rootCauses.push({
                    description: 'Возврат значения без вызова done()',
                    confidence: 0.8,
                    details: 'В тесте с колбеком done() есть оператор return, который может привести к преждевременному завершению теста'
                });
                
                suggestionInfo.suggestion = 'Убедитесь, что функция done() вызывается после асинхронных операций';
            }
        }
    }
    
    return { rootCauses, suggestionInfo };
}

/**
 * Анализирует ошибку моков/стабов
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeMockingError(errorMessage, testCode, sourceCode, options) {
    let rootCauses = extractMockingCauses(errorMessage);
    let suggestionInfo = {};
    
    // Если у нас есть коды, выполняем более глубокий анализ
    if (testCode && sourceCode) {
        // Определяем используемую библиотеку для моков
        const usesJest = testCode.includes('jest.') || testCode.includes('jest.fn');
        const usesSinon = testCode.includes('sinon.');
        const mockingLibrary = usesJest ? 'Jest' : (usesSinon ? 'Sinon' : 'Unknown');
        
        // Проверяем типичные проблемы с моками
        if (testCode.includes('mock(') || testCode.includes('stub(')) {
            // Ищем объект или метод, который мокается
            const mockRegex = usesJest ? 
                /jest\.fn\(\)|jest\.mock\(['"]([^'"]+)['"]\)/ : 
                /sinon\.stub\(([^,]+),\s*['"]([^'"]+)['"]\)/;
                
            const matches = testCode.match(new RegExp(mockRegex, 'g')) || [];
            
            if (matches.length > 0) {
                // Проверяем, имеет ли мок правильный возвращаемый результат
                if (!testCode.includes('.mockReturnValue') && 
                    !testCode.includes('.mockResolvedValue') && 
                    !testCode.includes('.returns(') && 
                    !testCode.includes('.resolves(')) {
                    
                    rootCauses.push({
                        description: 'Мок не настроен на возврат значения',
                        confidence: 0.7,
                        details: `Мок создан с помощью ${mockingLibrary}, но не настроен на возврат конкретного значения`
                    });
                    
                    suggestionInfo.suggestion = usesJest ?
                        'Добавьте .mockReturnValue() или .mockResolvedValue() к мок-функции' :
                        'Добавьте .returns() или .resolves() к стабу';
                }
            }
        }
        
        // Если ошибка связана с количеством вызовов
        if (errorMessage.includes('times') || errorMessage.includes('called') || errorMessage.includes('count')) {
            rootCauses.push({
                description: 'Неверное количество вызовов мок-функции',
                confidence: 0.7,
                details: 'Проверьте, что функция вызывается ожидаемое количество раз и в правильном порядке'
            });
            
            // Проверяем асинхронность
            if (testCode.includes('async') || testCode.includes('await') || 
                testCode.includes('Promise') || testCode.includes('setTimeout')) {
                
                rootCauses.push({
                    description: 'Асинхронное выполнение может влиять на порядок вызовов',
                    confidence: 0.6,
                    details: 'В асинхронном коде порядок и время вызовов может отличаться от ожидаемого'
                });
                
                suggestionInfo.suggestion = 'Убедитесь, что все асинхронные операции завершены перед проверкой вызовов мок-функций';
            }
        }
    }
    
    return { rootCauses, suggestionInfo };
}

/**
 * Анализирует ошибку HTTP/API
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeHttpError(errorMessage, testCode, sourceCode, options) {
    let rootCauses = extractHttpCauses(errorMessage);
    let suggestionInfo = {};
    
    // Если у нас есть коды, выполняем более глубокий анализ
    if (testCode) {
        // Определяем используемую библиотеку для HTTP-запросов
        const usesAxios = testCode.includes('axios.');
        const usesFetch = testCode.includes('fetch(');
        const usesRequest = testCode.includes('request(');
        const httpLibrary = usesAxios ? 'axios' : (usesFetch ? 'fetch' : (usesRequest ? 'request' : 'unknown'));
        
        // Проверяем наличие моков для HTTP
        const hasMocks = testCode.includes('mock') && 
                        (testCode.includes('http') || testCode.includes('api') || testCode.includes('request'));
        
        if (!hasMocks) {
            rootCauses.push({
                description: 'Отсутствует мок для HTTP-запросов',
                confidence: 0.7,
                details: `Тест использует ${httpLibrary} без моков, что может привести к реальным HTTP-запросам`
            });
            
            suggestionInfo.suggestion = 'Рассмотрите возможность использования моков для HTTP-запросов в тестах';
        }
        
        // Проверяем обработку ошибок
        const hasErrorHandling = testCode.includes('catch') || 
                               testCode.includes('try') || 
                               testCode.includes('error');
                               
        if (!hasErrorHandling) {
            rootCauses.push({
                description: 'Отсутствует обработка ошибок HTTP',
                confidence: 0.6,
                details: 'В тесте не предусмотрена обработка ошибок HTTP-запросов'
            });
            
            suggestionInfo.suggestion = 'Добавьте обработку ошибок для HTTP-запросов (try/catch или .catch())';
        }
    }
    
    return { rootCauses, suggestionInfo };
}

/**
 * Анализирует общую ошибку
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeGenericError(errorInfo, errorMessage, stackTrace, testCode, sourceCode, options) {
    let rootCauses = extractGenericCauses(errorMessage, stackTrace, errorInfo.type);
    let suggestionInfo = {};
    
    // Если есть код, пытаемся найти строку с ошибкой
    if (testCode && stackTrace) {
        // Ищем файл и строку в стеке
        const stackMatch = stackTrace.match(/at\s+(?:.*\s+\()?([^:]+):(\d+)(?::(\d+))?\)?/);
        
        if (stackMatch) {
            const file = stackMatch[1];
            const line = parseInt(stackMatch[2], 10);
            
            // Проверяем, есть ли ошибка в тесте
            if (file.includes('test') || file.includes('spec')) {
                const lines = testCode.split('\n');
                
                if (line > 0 && line <= lines.length) {
                    const errorLine = lines[line - 1];
                    
                    rootCauses.push({
                        description: 'Ошибка в тесте',
                        confidence: 0.7,
                        details: `Проблемная строка (${line}): ${errorLine.trim()}`
                    });
                }
            }
        }
        
        // Для ошибок синтаксиса
        if (errorInfo.type === 'syntax_error') {
            const syntaxErrorLine = errorMessage.match(/line\s+(\d+)/i);
            
            if (syntaxErrorLine) {
                const line = parseInt(syntaxErrorLine[1], 10);
                const lines = testCode.split('\n');
                
                if (line > 0 && line <= lines.length) {
                    rootCauses.push({
                        description: 'Синтаксическая ошибка',
                        confidence: 0.8,
                        details: `Проблемная строка (${line}): ${lines[line - 1].trim()}`
                    });
                }
            }
        }
    }
    
    return { rootCauses, suggestionInfo };
}

/**
 * Анализирует ошибку с помощью LLM
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} stackTrace - Стек-трейс
 * @param {string} testCode - Код теста
 * @param {string} sourceCode - Исходный код тестируемого компонента
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeWithLLM(errorInfo, errorMessage, stackTrace, testCode, sourceCode, options) {
    try {
        logger.debug('Analyzing test failure with LLM');
        
        // Подготавливаем данные для промпта
        const hasTestCode = !!testCode;
        const hasSourceCode = !!sourceCode;
        
        // Загружаем промпт для анализа ошибки теста
        const prompt = await promptManager.getPrompt('test-failure-analysis', {
            error_message: errorMessage,
            error_type: errorInfo.type,
            stack_trace: stackTrace || 'Стек-трейс отсутствует',
            test_code: testCode || 'Код теста не предоставлен',
            source_code: sourceCode || 'Исходный код не предоставлен',
            has_test_code: hasTestCode.toString(),
            has_source_code: hasSourceCode.toString(),
            framework: options.framework || 'unknown'
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
                    // Если не удалось извлечь JSON, создаем простой ответ
                    return {
                        rootCauses: [{
                            description: 'Анализ LLM',
                            confidence: 0.5,
                            details: response
                        }]
                    };
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response as JSON', { error: e.message });
                
                return {
                    rootCauses: [{
                        description: 'Не удалось распарсить ответ LLM',
                        confidence: 0.3,
                        details: 'Произошла ошибка при обработке ответа LLM'
                    }]
                };
            }
        } else {
            // Если ответ уже в виде объекта
            parsedResponse = response;
        }
        
        // Преобразуем результат в нужный формат
        const rootCauses = (parsedResponse.rootCauses || []).map(cause => ({
            description: cause.description || 'Неизвестная причина',
            confidence: cause.confidence || 0.5,
            details: cause.details || 'Без подробностей'
        }));
        
        // Если есть предложение по исправлению, добавляем его
        let fixSuggestion = null;
        
        if (parsedResponse.fixSuggestion && parsedResponse.fixSuggestion.code) {
            fixSuggestion = {
                description: parsedResponse.fixSuggestion.description || 'Предложение по исправлению',
                code: parsedResponse.fixSuggestion.code,
                explanation: parsedResponse.fixSuggestion.explanation || 'Без объяснения'
            };
        }
        
        return {
            rootCauses,
            fixSuggestion
        };
    } catch (error) {
        logger.error('Error analyzing with LLM', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            rootCauses: [{
                description: 'Ошибка при анализе с помощью LLM',
                confidence: 0.3,
                details: error.message
            }]
        };
    }
}

/**
 * Генерирует рекомендации на основе анализа
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {Array} rootCauses - Корневые причины
 * @param {Object} suggestionInfo - Информация о предложениях
 * @param {Object} options - Дополнительные опции
 * @returns {Array} - Рекомендации
 */
function generateRecommendations(errorInfo, rootCauses, suggestionInfo, options) {
    const recommendations = [];
    
    // Если есть конкретное предложение, добавляем его
    if (suggestionInfo.suggestion) {
        recommendations.push({
            type: 'specific',
            priority: 'high',
            description: suggestionInfo.suggestion
        });
    }
    
    // Если есть предложение по исправлению кода, добавляем его
    if (suggestionInfo.fixSuggestion && suggestionInfo.fixSuggestion.fixedCode) {
        recommendations.push({
            type: 'code_fix',
            priority: 'high',
            description: suggestionInfo.fixSuggestion.description,
            fixedCode: suggestionInfo.fixSuggestion.fixedCode
        });
    }
    
    // Если есть предложение от LLM, добавляем его
    if (suggestionInfo.llmFixSuggestion) {
        recommendations.push({
            type: 'llm_suggestion',
            priority: 'medium',
            description: suggestionInfo.llmFixSuggestion.description,
            code: suggestionInfo.llmFixSuggestion.code,
            explanation: suggestionInfo.llmFixSuggestion.explanation
        });
    }
    
    // Добавляем рекомендации на основе корневых причин
    for (const cause of rootCauses) {
        // Рекомендации по типу ошибки
        switch (errorInfo.type) {
            case 'assertion':
                recommendations.push({
                    type: 'general',
                    priority: 'medium',
                    description: 'Проверьте правильность ожидаемого значения и метод сравнения (toBe/toEqual/toStrictEqual)'
                });
                break;
                
            case 'async':
                recommendations.push({
                    type: 'general',
                    priority: 'high',
                    description: 'Убедитесь, что все асинхронные операции завершаются до конца теста'
                });
                
                recommendations.push({
                    type: 'general',
                    priority: 'medium',
                    description: 'Добавьте обработку ошибок (try/catch или .catch()) для асинхронных операций'
                });
                break;
                
            case 'mocking':
                recommendations.push({
                    type: 'general',
                    priority: 'medium',
                    description: 'Проверьте правильность создания и настройки моков/стабов'
                });
                break;
                
            case 'http':
                recommendations.push({
                    type: 'general',
                    priority: 'high',
                    description: 'Используйте моки для HTTP-запросов в тестах'
                });
                
                recommendations.push({
                    type: 'general',
                    priority: 'medium',
                    description: 'Добавьте обработку ошибок для HTTP-запросов'
                });
                break;
                
            case 'timeout':
                recommendations.push({
                    type: 'general',
                    priority: 'medium',
                    description: 'Увеличьте таймаут теста или оптимизируйте асинхронные операции'
                });
                break;
                
            default:
                // Если тип неизвестен, добавляем общие рекомендации
                if (recommendations.length === 0) {
                    recommendations.push({
                        type: 'general',
                        priority: 'medium',
                        description: 'Проверьте соответствие теста и тестируемого кода'
                    });
                }
                break;
        }
        
        // Если у причины высокая уверенность, добавляем конкретную рекомендацию
        if (cause.confidence >= 0.7 && cause.description) {
            recommendations.push({
                type: 'cause_specific',
                priority: 'high',
                description: `Исправьте проблему: ${cause.description}`
            });
        }
    }
    
    // Убираем дубликаты
    const uniqueRecommendations = [];
    const seenDescriptions = new Set();
    
    for (const rec of recommendations) {
        if (!seenDescriptions.has(rec.description)) {
            seenDescriptions.add(rec.description);
            uniqueRecommendations.push(rec);
        }
    }
    
    return uniqueRecommendations;
}

/**
 * Определяет серьезность проблемы
 * 
 * @private
 * @param {Object} errorInfo - Информация об ошибке
 * @param {Array} rootCauses - Корневые причины
 * @param {Object} options - Дополнительные опции
 * @returns {string} - Серьезность проблемы (critical, high, medium, low)
 */
function determineSeverity(errorInfo, rootCauses, options) {
    // Если уже определена серьезность в errorInfo
    if (errorInfo.severity) {
        // Преобразуем в более понятные категории
        switch (errorInfo.severity) {
            case 'high':
                return 'critical';
            case 'medium':
                return 'high';
            case 'low':
                return 'medium';
            default:
                // Используем как есть
                return errorInfo.severity;
        }
    }
    
    // Определяем серьезность на основе типа ошибки
    switch (errorInfo.type) {
        case 'async':
        case 'null_reference':
        case 'syntax_error':
            return 'critical';
            
        case 'assertion':
        case 'mocking':
        case 'reference_error':
        case 'type_error':
            return 'high';
            
        case 'timeout':
        case 'http':
            return 'medium';
            
        default:
            // По умолчанию средняя серьезность
            return 'medium';
    }
}

module.exports = {
    explainTestFailure
};
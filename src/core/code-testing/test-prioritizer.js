/**
 * Приоритизатор тестов
 * Определяет приоритет тестов на основе их важности, влияния на код и истории выполнения
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');

/**
 * Приоритизирует тесты на основе изменений в коде
 * 
 * @param {Array} tests - Список тестов для приоритизации
 * @param {Array} codeChanges - Изменения в коде
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Array>} - Приоритизированный список тестов
 */
async function prioritizeTestsByImpact(tests, codeChanges, options = {}) {
    try {
        logger.info('Prioritizing tests by impact', { 
            testsCount: tests?.length || 0,
            changesCount: codeChanges?.length || 0,
            options: Object.keys(options)
        });
        
        // Проверяем входные данные
        if (!tests || !Array.isArray(tests) || tests.length === 0) {
            return {
                success: false,
                message: 'Не предоставлены тесты для приоритизации'
            };
        }
        
        if (!codeChanges || !Array.isArray(codeChanges) || codeChanges.length === 0) {
            logger.warn('No code changes provided, using default prioritization');
            return await prioritizeTestsByDefault(tests, options);
        }
        
        // Получаем историю выполнения тестов, если доступна
        const testHistory = await getTestExecutionHistory(options.historyPath, options);
        
        // Анализируем связи между тестами и кодом
        const testCodeRelations = await analyzeTestCodeRelations(tests, codeChanges, options);
        
        // Вычисляем оценку влияния для каждого теста
        const testsWithImpact = calculateTestImpactScore(
            tests,
            codeChanges,
            testCodeRelations,
            testHistory,
            options
        );
        
        // Сортируем тесты по оценке влияния (от высокой к низкой)
        const prioritizedTests = testsWithImpact.sort((a, b) => b.impactScore - a.impactScore);
        
        // Если требуется анализ LLM, добавляем его
        if (options.useLLM) {
            await enhanceWithLLMAnalysis(prioritizedTests, codeChanges, options);
        }
        
        logger.debug('Tests prioritized successfully', { 
            topTests: prioritizedTests.slice(0, 3).map(t => t.name) 
        });
        
        return {
            success: true,
            prioritizedTests
        };
    } catch (error) {
        logger.error('Error prioritizing tests', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при приоритизации тестов: ${error.message}`
        };
    }
}

/**
 * Приоритизирует тесты без учета изменений в коде
 * 
 * @private
 * @param {Array} tests - Список тестов
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат приоритизации
 */
async function prioritizeTestsByDefault(tests, options = {}) {
    try {
        // Получаем историю выполнения тестов, если доступна
        const testHistory = await getTestExecutionHistory(options.historyPath, options);
        
        const prioritizedTests = tests.map(test => {
            // Собираем базовую информацию о тесте
            const testInfo = {
                ...test,
                impactScore: 0.5, // По умолчанию средний приоритет
                priority: 'medium',
                reason: 'Стандартная приоритизация'
            };
            
            // Если есть информация в истории, учитываем ее
            if (testHistory && testHistory[test.name || test.path]) {
                const history = testHistory[test.name || test.path];
                
                // Увеличиваем приоритет нестабильных тестов
                if (history.failureRate > 0.2) {
                    testInfo.impactScore += 0.3;
                    testInfo.priority = 'high';
                    testInfo.reason = `Нестабильный тест (частота сбоев: ${Math.round(history.failureRate * 100)}%)`;
                }
                
                // Увеличиваем приоритет недавно добавленных тестов
                if (history.isNew) {
                    testInfo.impactScore += 0.2;
                    if (testInfo.priority !== 'high') testInfo.priority = 'medium-high';
                    testInfo.reason = `${testInfo.reason}. Недавно добавленный тест`;
                }
                
                // Увеличиваем приоритет медленных тестов
                if (history.avgDuration > (options.slowTestThreshold || 1000)) {
                    testInfo.impactScore += 0.1;
                    testInfo.reason = `${testInfo.reason}. Медленный тест`;
                }
            }
            
            // Увеличиваем приоритет интеграционных и e2e тестов
            if ((test.type === 'integration' || test.type === 'e2e') && 
                !options.prioritizeUnitTests) {
                testInfo.impactScore += 0.2;
                testInfo.reason = `${testInfo.reason}. ${test.type === 'integration' ? 'Интеграционный' : 'E2E'} тест`;
            }
            
            // Устанавливаем финальную категорию приоритета
            if (testInfo.impactScore > 0.8) {
                testInfo.priority = 'high';
            } else if (testInfo.impactScore > 0.5) {
                testInfo.priority = 'medium-high';
            } else if (testInfo.impactScore < 0.3) {
                testInfo.priority = 'low';
            } else {
                testInfo.priority = 'medium';
            }
            
            return testInfo;
        });
        
        // Сортируем тесты по оценке влияния
        prioritizedTests.sort((a, b) => b.impactScore - a.impactScore);
        
        return {
            success: true,
            prioritizedTests
        };
    } catch (error) {
        logger.error('Error prioritizing tests by default', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при приоритизации тестов: ${error.message}`
        };
    }
}

/**
 * Получает историю выполнения тестов
 * 
 * @private
 * @param {string} historyPath - Путь к файлу истории
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object|null>} - История выполнения тестов
 */
async function getTestExecutionHistory(historyPath, options = {}) {
    try {
        // Если путь к истории не указан, ищем в стандартных местах
        const paths = [
            historyPath,
            options.testHistoryPath,
            'test-history.json',
            path.join(process.cwd(), 'test-history.json'),
            path.join(process.cwd(), 'tests', 'history.json')
        ].filter(Boolean);
        
        // Проверяем каждый путь
        for (const p of paths) {
            try {
                if (!p) continue;
                
                const historyContent = await fs.readFile(p, 'utf-8');
                return JSON.parse(historyContent);
            } catch (e) {
                // Игнорируем ошибки чтения файлов
            }
        }
        
        // Если не нашли историю, возвращаем null
        return null;
    } catch (error) {
        logger.warn('Error getting test execution history', { 
            error: error.message,
            historyPath
        });
        
        return null;
    }
}

/**
 * Анализирует отношения между тестами и кодом
 * 
 * @private
 * @param {Array} tests - Список тестов
 * @param {Array} codeChanges - Изменения в коде
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Отношения между тестами и кодом
 */
async function analyzeTestCodeRelations(tests, codeChanges, options = {}) {
    try {
        // Если есть уже готовая карта зависимостей
        if (options.dependencyMap) {
            return options.dependencyMap;
        }
        
        // Базовое сопоставление на основе путей файлов
        const relations = {};
        
        for (const test of tests) {
            const testPath = test.path || test.filePath || test.name;
            
            if (!testPath) continue;
            
            // Извлекаем базовое имя файла теста (без 'test', 'spec' и расширения)
            const baseName = path.basename(testPath)
                .replace(/\.test\.|\.spec\.|_test\.|_spec\./, '.')
                .replace(/\.[^.]+$/, '');
            
            // Ищем соответствующие файлы кода
            const matchingCodeFiles = codeChanges
                .filter(change => {
                    const changePath = change.path || change.filePath || change.name;
                    
                    if (!changePath) return false;
                    
                    // Проверяем прямое соответствие имен файлов
                    const changeBaseName = path.basename(changePath).replace(/\.[^.]+$/, '');
                    
                    // Прямое соответствие или соответствие пути
                    return (
                        changeBaseName === baseName ||
                        changePath.includes(baseName) ||
                        testPath.includes(changeBaseName)
                    );
                })
                .map(change => change.path || change.filePath || change.name);
            
            relations[testPath] = matchingCodeFiles;
        }
        
        return relations;
    } catch (error) {
        logger.error('Error analyzing test-code relations', { 
            error: error.message,
            stack: error.stack
        });
        
        return {};
    }
}

/**
 * Вычисляет оценку влияния для каждого теста
 * 
 * @private
 * @param {Array} tests - Список тестов
 * @param {Array} codeChanges - Изменения в коде
 * @param {Object} testCodeRelations - Отношения между тестами и кодом
 * @param {Object} testHistory - История выполнения тестов
 * @param {Object} options - Дополнительные опции
 * @returns {Array} - Тесты с оценкой влияния
 */
function calculateTestImpactScore(tests, codeChanges, testCodeRelations, testHistory, options) {
    return tests.map(test => {
        const testPath = test.path || test.filePath || test.name;
        
        // Базовая оценка влияния
        let impactScore = 0.3; // Начальное значение
        let priorityReason = [];
        
        // Увеличиваем оценку на основе связей с изменённым кодом
        const relatedCodeFiles = testCodeRelations[testPath] || [];
        
        if (relatedCodeFiles.length > 0) {
            impactScore += 0.4 * Math.min(1, relatedCodeFiles.length / 3);
            priorityReason.push(`Связан с ${relatedCodeFiles.length} изменёнными файлами`);
        }
        
        // Учитываем историю выполнения
        if (testHistory && testHistory[testPath]) {
            const history = testHistory[testPath];
            
            // Увеличиваем приоритет нестабильных тестов
            if (history.failureRate > 0.2) {
                impactScore += 0.2;
                priorityReason.push(`Нестабильный тест (частота сбоев: ${Math.round(history.failureRate * 100)}%)`);
            }
            
            // Увеличиваем приоритет недавно добавленных тестов
            if (history.isNew) {
                impactScore += 0.1;
                priorityReason.push('Недавно добавленный тест');
            }
            
            // Учитываем время выполнения
            if (history.avgDuration > (options.slowTestThreshold || 1000)) {
                impactScore += 0.1;
                priorityReason.push('Медленный тест');
            }
        }
        
        // Учитываем тип теста
        if (test.type === 'unit') {
            if (options.prioritizeUnitTests) {
                impactScore += 0.1;
                priorityReason.push('Модульный тест');
            }
        } else if (test.type === 'integration') {
            if (!options.prioritizeUnitTests) {
                impactScore += 0.15;
                priorityReason.push('Интеграционный тест');
            }
        } else if (test.type === 'e2e') {
            if (!options.prioritizeUnitTests) {
                impactScore += 0.2;
                priorityReason.push('End-to-End тест');
            }
        }
        
        // Определяем финальный приоритет
        const priority = impactScore >= 0.7 ? 'high' : 
                         impactScore >= 0.5 ? 'medium' : 'low';
        
        return {
            ...test,
            impactScore: Math.min(1, impactScore), // Ограничиваем максимальное значение
            priority,
            reason: priorityReason.join('. ')
        };
    });
}

/**
 * Улучшает результаты приоритизации с помощью LLM
 * 
 * @private
 * @param {Array} prioritizedTests - Приоритизированные тесты
 * @param {Array} codeChanges - Изменения в коде
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<void>} - Ничего
 */
async function enhanceWithLLMAnalysis(prioritizedTests, codeChanges, options) {
    try {
        logger.debug('Enhancing test prioritization with LLM analysis');
        
        // Выбираем тесты для анализа (не более 5)
        const testsToAnalyze = prioritizedTests.slice(0, 5);
        const changesForAnalysis = codeChanges.slice(0, 5);
        
        // Подготавливаем данные для промпта
        const testData = testsToAnalyze.map(test => ({
            name: test.name || test.path || test.filePath,
            path: test.path || test.filePath,
            type: test.type || 'unknown',
            priority: test.priority,
            impactScore: test.impactScore
        }));
        
        const changeData = changesForAnalysis.map(change => ({
            path: change.path || change.filePath,
            description: change.description || 'Unknown change',
            changeType: change.type || 'unknown'
        }));
        
        // Загружаем промпт для анализа приоритизации
        const prompt = await promptManager.getPrompt('test-prioritization', {
            tests: JSON.stringify(testData, null, 2),
            code_changes: JSON.stringify(changeData, null, 2),
            project_type: options.projectType || 'unknown',
            language: options.language || 'unknown'
        });
        
        // Отправляем запрос к LLM
        const response = await llmClient.sendPrompt(prompt, {
            temperature: 0.3,
            structuredOutput: true
        });
        
        // Обрабатываем ответ
        let llmSuggestions;
        
        if (typeof response === 'string') {
            // Если ответ в виде строки, пытаемся извлечь JSON
            try {
                const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                               response.match(/\{[\s\S]*\}/);
                               
                if (jsonMatch) {
                    llmSuggestions = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    // Если не удалось извлечь JSON, возвращаем
                    logger.warn('Could not extract JSON from LLM response');
                    return;
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response as JSON', { error: e.message });
                return;
            }
        } else {
            // Если ответ уже в виде объекта
            llmSuggestions = response;
        }
        
        // Применяем предложения LLM к тестам
        if (llmSuggestions && llmSuggestions.testPriorities) {
            for (const testPriority of llmSuggestions.testPriorities) {
                const testName = testPriority.name || testPriority.path;
                
                // Находим тест в списке
                const test = prioritizedTests.find(t => 
                    (t.name === testName) || 
                    (t.path === testName) || 
                    (t.filePath === testName)
                );
                
                if (test) {
                    // Обновляем приоритет, если он предложен LLM
                    if (testPriority.suggestedPriority) {
                        test.priority = testPriority.suggestedPriority;
                    }
                    
                    // Обновляем оценку влияния, если она предложена LLM
                    if (testPriority.suggestedImpactScore !== undefined) {
                        test.impactScore = testPriority.suggestedImpactScore;
                    }
                    
                    // Добавляем рекомендацию к причине
                    if (testPriority.reason) {
                        test.reason = test.reason 
                            ? `${test.reason}. LLM: ${testPriority.reason}`
                            : `LLM: ${testPriority.reason}`;
                    }
                }
            }
            
            // Если есть общие рекомендации, добавляем их
            if (llmSuggestions.generalRecommendations) {
                prioritizedTests.llmRecommendations = llmSuggestions.generalRecommendations;
            }
        }
    } catch (error) {
        logger.error('Error enhancing with LLM analysis', { 
            error: error.message,
            stack: error.stack
        });
    }
}

/**
 * Сохраняет информацию о приоритизации тестов
 * 
 * @param {Array} prioritizedTests - Приоритизированные тесты
 * @param {string} outputPath - Путь для сохранения
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<boolean>} - Успешность сохранения
 */
async function saveTestPrioritization(prioritizedTests, outputPath, options = {}) {
    try {
        logger.info('Saving test prioritization', { 
            outputPath,
            testsCount: prioritizedTests?.length || 0
        });
        
        // Проверяем входные данные
        if (!prioritizedTests || !outputPath) {
            return false;
        }
        
        // Создаем директорию, если она не существует
        const outputDir = path.dirname(outputPath);
        await fs.mkdir(outputDir, { recursive: true });
        
        // Сохраняем данные в формате JSON
        const outputData = {
            generatedAt: new Date().toISOString(),
            tests: prioritizedTests,
            metadata: {
                totalTests: prioritizedTests.length,
                highPriorityTests: prioritizedTests.filter(t => t.priority === 'high').length,
                mediumPriorityTests: prioritizedTests.filter(t => t.priority === 'medium').length,
                lowPriorityTests: prioritizedTests.filter(t => t.priority === 'low').length
            }
        };
        
        await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
        
        return true;
    } catch (error) {
        logger.error('Error saving test prioritization', { 
            error: error.message,
            stack: error.stack,
            outputPath
        });
        
        return false;
    }
}

/**
 * Генерирует приоритизированный список запуска тестов
 * 
 * @param {Array} prioritizedTests - Приоритизированные тесты
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Групированный список тестов
 */
async function generateTestRunPlan(prioritizedTests, options = {}) {
    try {
        logger.info('Generating test run plan', { 
            testsCount: prioritizedTests?.length || 0,
            options: Object.keys(options)
        });
        
        // Проверяем входные данные
        if (!prioritizedTests || !Array.isArray(prioritizedTests)) {
            return {
                success: false,
                message: 'Не предоставлены приоритизированные тесты'
            };
        }
        
        // Группируем тесты по приоритету
        const groupedTests = {
            critical: [],
            high: [],
            medium: [],
            low: []
        };
        
        for (const test of prioritizedTests) {
            const priority = test.priority || 'medium';
            
            if (priority === 'critical') {
                groupedTests.critical.push(test);
            } else if (priority === 'high') {
                groupedTests.high.push(test);
            } else if (priority === 'low') {
                groupedTests.low.push(test);
            } else {
                // medium и все остальные
                groupedTests.medium.push(test);
            }
        }
        
        // Создаем план запуска тестов
        const runPlan = {
            // Этап 1: Критические и высокоприоритетные тесты
            stage1: [
                ...groupedTests.critical,
                ...groupedTests.high
            ],
            // Этап 2: Среднеприоритетные тесты
            stage2: groupedTests.medium,
            // Этап 3: Низкоприоритетные тесты
            stage3: groupedTests.low
        };
        
        // Если указана опция maxTestsPerStage, ограничиваем количество тестов в каждом этапе
        if (options.maxTestsPerStage) {
            runPlan.stage1 = runPlan.stage1.slice(0, options.maxTestsPerStage);
            runPlan.stage2 = runPlan.stage2.slice(0, options.maxTestsPerStage);
            runPlan.stage3 = runPlan.stage3.slice(0, options.maxTestsPerStage);
        }
        
        // Если указана опция fastFail, добавляем флаг для остановки при первой ошибке
        const fastFail = options.fastFail !== undefined ? options.fastFail : true;
        
        // Создаем команды для запуска тестов
        const stage1Paths = runPlan.stage1.map(t => t.path || t.filePath || t.name).filter(Boolean);
        const stage2Paths = runPlan.stage2.map(t => t.path || t.filePath || t.name).filter(Boolean);
        const stage3Paths = runPlan.stage3.map(t => t.path || t.filePath || t.name).filter(Boolean);
        
        const testFramework = options.testFramework || 'jest';
        
        const commands = {
            stage1: generateTestCommand(testFramework, stage1Paths, { fastFail }),
            stage2: generateTestCommand(testFramework, stage2Paths, { fastFail }),
            stage3: generateTestCommand(testFramework, stage3Paths, { fastFail }),
            all: generateTestCommand(testFramework, [...stage1Paths, ...stage2Paths, ...stage3Paths], { fastFail })
        };
        
        return {
            success: true,
            runPlan,
            commands,
            metadata: {
                totalTests: prioritizedTests.length,
                criticalTests: groupedTests.critical.length,
                highPriorityTests: groupedTests.high.length,
                mediumPriorityTests: groupedTests.medium.length,
                lowPriorityTests: groupedTests.low.length
            }
        };
    } catch (error) {
        logger.error('Error generating test run plan', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при генерации плана запуска тестов: ${error.message}`
        };
    }
}

/**
 * Генерирует команду для запуска тестов
 * 
 * @private
 * @param {string} framework - Фреймворк тестирования
 * @param {Array} testPaths - Пути к тестам
 * @param {Object} options - Дополнительные опции
 * @returns {string} - Команда для запуска тестов
 */
function generateTestCommand(framework, testPaths, options = {}) {
    if (!testPaths || testPaths.length === 0) {
        return '';
    }
    
    const { fastFail } = options;
    
    switch (framework.toLowerCase()) {
        case 'jest':
            return `jest ${testPaths.join(' ')}${fastFail ? ' --bail' : ''}`;
        case 'mocha':
            return `mocha ${testPaths.join(' ')}${fastFail ? ' --bail' : ''}`;
        case 'jasmine':
            return `jasmine ${testPaths.join(' ')}`;
        case 'ava':
            return `ava ${testPaths.join(' ')}`;
        default:
            return `${framework} ${testPaths.join(' ')}`;
    }
}

module.exports = {
    prioritizeTestsByImpact,
    saveTestPrioritization,
    generateTestRunPlan
};
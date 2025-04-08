/**
 * Анализатор покрытия кода тестами
 * Анализирует результаты тестов и отчеты о покрытии для оценки качества тестирования
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');

/**
 * Анализирует отчет о покрытии кода тестами
 * 
 * @param {Object} coverageData - Данные покрытия
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Анализ покрытия
 */
async function analyzeCoverage(coverageData, options = {}) {
    try {
        logger.info('Analyzing code coverage', { 
            options: Object.keys(options)
        });
        
        // Если нет данных покрытия, возвращаем ошибку
        if (!coverageData) {
            return {
                success: false,
                message: 'Не предоставлены данные о покрытии кода'
            };
        }
        
        // Извлекаем основные метрики из отчета о покрытии
        const summary = extractCoverageSummary(coverageData);
        
        // Определяем проблемные файлы с низким покрытием
        const lowCoverageFiles = findLowCoverageFiles(coverageData, options.lowCoverageThreshold || 70);
        
        // Определяем непокрытые части кода
        const uncoveredCode = extractUncoveredCode(coverageData);
        
        // Анализируем критические пути в коде
        const criticalPaths = analyzeCriticalPaths(coverageData, options);
        
        // Генерируем рекомендации
        const recommendations = generateCoverageRecommendations(
            summary,
            lowCoverageFiles,
            uncoveredCode,
            criticalPaths,
            options
        );
        
        // Если требуется более глубокий анализ с помощью LLM, выполняем его
        let llmAnalysis = null;
        if (options.useLLM) {
            llmAnalysis = await analyzeCoverageWithLLM(
                coverageData,
                uncoveredCode,
                options
            );
        }
        
        return {
            success: true,
            summary,
            lowCoverageFiles,
            uncoveredCode,
            criticalPaths,
            recommendations,
            llmAnalysis
        };
    } catch (error) {
        logger.error('Error analyzing code coverage', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            message: `Ошибка при анализе покрытия: ${error.message}`
        };
    }
}

/**
 * Извлекает сводную информацию о покрытии
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @returns {Object} - Сводная информация
 */
function extractCoverageSummary(coverageData) {
    let summary = {
        lines: { total: 0, covered: 0, percentage: 0 },
        statements: { total: 0, covered: 0, percentage: 0 },
        functions: { total: 0, covered: 0, percentage: 0 },
        branches: { total: 0, covered: 0, percentage: 0 },
        files: { total: 0, fullyCovered: 0, percentage: 0 }
    };
    
    // Если предоставлены уже готовые сводные данные
    if (coverageData.summary) {
        return {
            ...summary,
            ...coverageData.summary
        };
    }
    
    // Если это отчет Istanbul/Jest
    if (coverageData.total) {
        const { lines, statements, functions, branches } = coverageData.total;
        
        return {
            lines: {
                total: lines?.total || 0,
                covered: lines?.covered || 0,
                percentage: lines?.pct || 0
            },
            statements: {
                total: statements?.total || 0,
                covered: statements?.covered || 0,
                percentage: statements?.pct || 0
            },
            functions: {
                total: functions?.total || 0,
                covered: functions?.covered || 0,
                percentage: functions?.pct || 0
            },
            branches: {
                total: branches?.total || 0,
                covered: branches?.covered || 0,
                percentage: branches?.pct || 0
            },
            files: {
                total: Object.keys(coverageData).filter(key => key !== 'total').length,
                fullyCovered: countFullyCoveredFiles(coverageData),
                percentage: countCoveragePercentage(coverageData)
            }
        };
    }
    
    // Если это файл покрытия, обрабатываем все файлы
    if (typeof coverageData === 'object' && !coverageData.summary && !coverageData.total) {
        const files = [];
        
        // Собираем статистику по всем файлам
        for (const [filePath, fileData] of Object.entries(coverageData)) {
            if (filePath === 'total') continue;
            
            files.push(filePath);
            
            // Суммируем покрытие строк
            if (fileData.l || fileData.lines) {
                const lineData = fileData.l || fileData.lines;
                summary.lines.total += lineData.total || Object.keys(lineData).length;
                summary.lines.covered += lineData.covered || Object.values(lineData).filter(hit => hit > 0).length;
            }
            
            // Суммируем покрытие операторов
            if (fileData.s || fileData.statements) {
                const stmtData = fileData.s || fileData.statements;
                summary.statements.total += stmtData.total || Object.keys(stmtData).length;
                summary.statements.covered += stmtData.covered || Object.values(stmtData).filter(hit => hit > 0).length;
            }
            
            // Суммируем покрытие функций
            if (fileData.f || fileData.functions) {
                const funcData = fileData.f || fileData.functions;
                summary.functions.total += funcData.total || Object.keys(funcData).length;
                summary.functions.covered += funcData.covered || Object.values(funcData).filter(hit => hit > 0).length;
            }
            
            // Суммируем покрытие веток
            if (fileData.b || fileData.branches) {
                const branchData = fileData.b || fileData.branches;
                
                if (Array.isArray(branchData)) {
                    // Если ветки представлены в виде массива [условие, истина, ложь]
                    summary.branches.total += branchData.length * 2; // Каждая ветка имеет 2 пути
                    summary.branches.covered += branchData.reduce((sum, [_, t, f]) => sum + (t > 0 ? 1 : 0) + (f > 0 ? 1 : 0), 0);
                } else {
                    // Если ветки представлены в виде объекта
                    summary.branches.total += branchData.total || Object.keys(branchData).length;
                    summary.branches.covered += branchData.covered || Object.values(branchData).filter(hit => hit > 0).length;
                }
            }
        }
        
        // Рассчитываем процентное покрытие
        summary.lines.percentage = summary.lines.total > 0 
            ? Math.round((summary.lines.covered / summary.lines.total) * 100) 
            : 0;
            
        summary.statements.percentage = summary.statements.total > 0 
            ? Math.round((summary.statements.covered / summary.statements.total) * 100) 
            : 0;
            
        summary.functions.percentage = summary.functions.total > 0 
            ? Math.round((summary.functions.covered / summary.functions.total) * 100) 
            : 0;
            
        summary.branches.percentage = summary.branches.total > 0 
            ? Math.round((summary.branches.covered / summary.branches.total) * 100) 
            : 0;
            
        // Информация о файлах
        summary.files.total = files.length;
        summary.files.fullyCovered = countFullyCoveredFiles(coverageData);
        summary.files.percentage = countCoveragePercentage(coverageData);
    }
    
    return summary;
}

/**
 * Подсчитывает количество полностью покрытых файлов
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @returns {number} - Количество полностью покрытых файлов
 */
function countFullyCoveredFiles(coverageData) {
    let fullyCovered = 0;
    
    for (const [filePath, fileData] of Object.entries(coverageData)) {
        if (filePath === 'total') continue;
        
        // Проверяем покрытие линий, операторов, функций и веток
        const lineCoverage = fileData.lines?.pct || fileData.l?.pct || 0;
        const stmtCoverage = fileData.statements?.pct || fileData.s?.pct || 0;
        const funcCoverage = fileData.functions?.pct || fileData.f?.pct || 0;
        const branchCoverage = fileData.branches?.pct || fileData.b?.pct || 0;
        
        // Считаем файл полностью покрытым, если все метрики 100%
        if (lineCoverage === 100 && stmtCoverage === 100 && 
            funcCoverage === 100 && branchCoverage === 100) {
            fullyCovered++;
        }
    }
    
    return fullyCovered;
}

/**
 * Рассчитывает общий процент покрытия файлов
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @returns {number} - Процент покрытия
 */
function countCoveragePercentage(coverageData) {
    const fileCount = Object.keys(coverageData).filter(key => key !== 'total').length;
    if (fileCount === 0) return 0;
    
    const fullyCovered = countFullyCoveredFiles(coverageData);
    return Math.round((fullyCovered / fileCount) * 100);
}

/**
 * Находит файлы с низким покрытием
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @param {number} threshold - Порог низкого покрытия (%)
 * @returns {Array} - Файлы с низким покрытием
 */
function findLowCoverageFiles(coverageData, threshold = 70) {
    const lowCoverageFiles = [];
    
    for (const [filePath, fileData] of Object.entries(coverageData)) {
        if (filePath === 'total') continue;
        
        // Извлекаем метрики покрытия для файла
        const lineCoverage = fileData.lines?.pct || fileData.l?.pct || 0;
        const stmtCoverage = fileData.statements?.pct || fileData.s?.pct || 0;
        const funcCoverage = fileData.functions?.pct || fileData.f?.pct || 0;
        const branchCoverage = fileData.branches?.pct || fileData.b?.pct || 0;
        
        // Вычисляем среднее покрытие
        const avgCoverage = (lineCoverage + stmtCoverage + funcCoverage + branchCoverage) / 4;
        
        // Если среднее покрытие ниже порога, добавляем файл в список
        if (avgCoverage < threshold) {
            lowCoverageFiles.push({
                path: filePath,
                coverage: {
                    lines: lineCoverage,
                    statements: stmtCoverage,
                    functions: funcCoverage,
                    branches: branchCoverage,
                    average: Math.round(avgCoverage)
                }
            });
        }
    }
    
    // Сортируем файлы по возрастанию покрытия
    return lowCoverageFiles.sort((a, b) => a.coverage.average - b.coverage.average);
}

/**
 * Извлекает непокрытые части кода
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @returns {Array} - Непокрытые части кода
 */
function extractUncoveredCode(coverageData) {
    const uncoveredCode = [];
    
    // Если есть информация о непокрытых строках
    if (coverageData.uncoveredLines) {
        return coverageData.uncoveredLines;
    }
    
    // Пытаемся извлечь непокрытые строки из данных покрытия
    for (const [filePath, fileData] of Object.entries(coverageData)) {
        if (filePath === 'total') continue;
        
        // Получаем непокрытые строки
        const uncoveredLines = [];
        
        // Проверяем, в каком формате представлены данные о строках
        if (fileData.l) {
            // Формат: { 1: 1, 2: 0, 3: 1 }, где 0 означает непокрытую строку
            for (const [line, count] of Object.entries(fileData.l)) {
                if (count === 0) {
                    uncoveredLines.push(parseInt(line, 10));
                }
            }
        } else if (fileData.lines && fileData.lines.details) {
            // Другой возможный формат
            for (const detail of fileData.lines.details) {
                if (detail.hit === 0) {
                    uncoveredLines.push(detail.line);
                }
            }
        } else if (fileData.statementMap && fileData.s) {
            // Формат Istanbul/Jest: ищем непокрытые операторы и их строки
            for (const [stmtId, hit] of Object.entries(fileData.s)) {
                if (hit === 0 && fileData.statementMap[stmtId]) {
                    const { start, end } = fileData.statementMap[stmtId];
                    
                    for (let line = start.line; line <= end.line; line++) {
                        if (!uncoveredLines.includes(line)) {
                            uncoveredLines.push(line);
                        }
                    }
                }
            }
        }
        
        // Если есть непокрытые строки, добавляем файл в результат
        if (uncoveredLines.length > 0) {
            uncoveredCode.push({
                path: filePath,
                lines: uncoveredLines.sort((a, b) => a - b)
            });
        }
    }
    
    return uncoveredCode;
}

/**
 * Анализирует критические пути в коде
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @param {Object} options - Дополнительные опции
 * @returns {Array} - Критические пути
 */
function analyzeCriticalPaths(coverageData, options = {}) {
    const criticalPaths = [];
    
    // Если есть уже определенные критические пути, возвращаем их
    if (coverageData.criticalPaths) {
        return coverageData.criticalPaths;
    }
    
    // Определяем критические функции (с непокрытыми ветками)
    for (const [filePath, fileData] of Object.entries(coverageData)) {
        if (filePath === 'total') continue;
        
        // Ищем функции с низким покрытием веток
        const criticalFunctions = [];
        
        // Проверяем ветки в функциях
        if (fileData.b && fileData.fnMap && fileData.f) {
            for (const [fnId, hit] of Object.entries(fileData.f)) {
                if (hit > 0) { // Функция была вызвана
                    const fnInfo = fileData.fnMap[fnId];
                    
                    // Ищем ветки, принадлежащие этой функции
                    const fnBranches = [];
                    
                    for (const [branchId, branchData] of Object.entries(fileData.b)) {
                        const branchInfo = fileData.branchMap[branchId];
                        
                        // Проверяем, принадлежит ли ветка функции
                        if (branchInfo && branchInfo.loc &&
                            branchInfo.loc.start.line >= fnInfo.loc.start.line &&
                            branchInfo.loc.end.line <= fnInfo.loc.end.line) {
                            
                            // Проверяем покрытие ветки
                            if (Array.isArray(branchData)) {
                                const uncoveredPaths = branchData.filter(hit => hit === 0).length;
                                if (uncoveredPaths > 0) {
                                    fnBranches.push({
                                        id: branchId,
                                        loc: branchInfo.loc,
                                        uncoveredPaths
                                    });
                                }
                            }
                        }
                    }
                    
                    // Если у функции есть непокрытые ветки, считаем ее критической
                    if (fnBranches.length > 0) {
                        criticalFunctions.push({
                            name: fnInfo.name,
                            loc: fnInfo.loc,
                            uncoveredBranches: fnBranches
                        });
                    }
                }
            }
        }
        
        // Если есть критические функции, добавляем файл в результат
        if (criticalFunctions.length > 0) {
            criticalPaths.push({
                path: filePath,
                functions: criticalFunctions
            });
        }
    }
    
    return criticalPaths;
}

/**
 * Генерирует рекомендации по улучшению покрытия
 * 
 * @private
 * @param {Object} summary - Сводная информация о покрытии
 * @param {Array} lowCoverageFiles - Файлы с низким покрытием
 * @param {Array} uncoveredCode - Непокрытые части кода
 * @param {Array} criticalPaths - Критические пути
 * @param {Object} options - Дополнительные опции
 * @returns {Array} - Рекомендации
 */
function generateCoverageRecommendations(summary, lowCoverageFiles, uncoveredCode, criticalPaths, options = {}) {
    const recommendations = [];
    
    // Если общее покрытие низкое, рекомендуем увеличить
    if (summary.lines.percentage < 70) {
        recommendations.push({
            type: 'general',
            priority: 'high',
            message: `Общее покрытие строк кода (${summary.lines.percentage}%) ниже рекомендуемого порога в 70%. Увеличьте покрытие тестами.`
        });
    }
    
    // Если покрытие веток низкое, рекомендуем добавить тесты для разных путей выполнения
    if (summary.branches.percentage < 60) {
        recommendations.push({
            type: 'general',
            priority: 'high',
            message: `Покрытие веток кода (${summary.branches.percentage}%) слишком низкое. Добавьте тесты, проверяющие различные пути выполнения.`
        });
    }
    
    // Рекомендации по файлам с низким покрытием (не более 3)
    if (lowCoverageFiles.length > 0) {
        const filesToFocus = lowCoverageFiles.slice(0, 3);
        
        for (const file of filesToFocus) {
            recommendations.push({
                type: 'file',
                priority: 'medium',
                message: `Файл "${file.path}" имеет низкое покрытие (${file.coverage.average}%). Сфокусируйтесь на добавлении тестов для этого файла.`
            });
        }
    }
    
    // Рекомендации по критическим путям
    if (criticalPaths.length > 0) {
        // Выбираем наиболее важные критические пути (не более 3)
        const criticalToFocus = criticalPaths
            .slice(0, 3)
            .flatMap(path => path.functions.map(fn => ({
                file: path.path,
                function: fn.name,
                line: fn.loc.start.line
            })));
        
        for (const critical of criticalToFocus) {
            recommendations.push({
                type: 'critical_path',
                priority: 'high',
                message: `Функция "${critical.function}" в файле "${critical.file}" (строка ${critical.line}) содержит непокрытые ветви выполнения. Добавьте тесты для этих путей.`
            });
        }
    }
    
    // Общие рекомендации
    if (recommendations.length === 0) {
        if (summary.lines.percentage > 80 && summary.branches.percentage > 70) {
            recommendations.push({
                type: 'general',
                priority: 'low',
                message: 'Покрытие кода находится на хорошем уровне. Рассмотрите возможность добавления интеграционных и end-to-end тестов для повышения качества.'
            });
        } else {
            recommendations.push({
                type: 'general',
                priority: 'medium',
                message: 'Увеличьте общее покрытие кода, добавив тесты для наименее покрытых частей.'
            });
        }
    }
    
    return recommendations;
}

/**
 * Анализирует покрытие с помощью LLM
 * 
 * @private
 * @param {Object} coverageData - Данные о покрытии
 * @param {Array} uncoveredCode - Непокрытые части кода
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Анализ LLM
 */
async function analyzeCoverageWithLLM(coverageData, uncoveredCode, options) {
    try {
        logger.debug('Analyzing coverage with LLM');
        
        // Подготавливаем данные для промпта
        const coverageSummary = extractCoverageSummary(coverageData);
        
        // Выбираем наиболее важные непокрытые части кода (не более 5 файлов)
        const topUncoveredFiles = uncoveredCode
            .sort((a, b) => b.lines.length - a.lines.length)
            .slice(0, 5);
            
        // Загружаем промпт для анализа покрытия
        const prompt = await promptManager.getPrompt('coverage-analysis', {
            coverage_summary: JSON.stringify(coverageSummary, null, 2),
            uncovered_code: JSON.stringify(topUncoveredFiles, null, 2),
            project_type: options.projectType || 'unknown',
            language: options.language || 'unknown'
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
                    // Если не нашли JSON, возвращаем текстовый анализ
                    return {
                        analysis: response,
                        recommendations: []
                    };
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response as JSON', { error: e.message });
                
                return {
                    analysis: response,
                    recommendations: []
                };
            }
        } else {
            // Если ответ уже в виде объекта
            parsedResponse = response;
        }
        
        return parsedResponse;
    } catch (error) {
        logger.error('Error analyzing coverage with LLM', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            analysis: `Ошибка при анализе с помощью LLM: ${error.message}`,
            recommendations: []
        };
    }
}

/**
 * Загружает и анализирует отчет о покрытии из файла
 * 
 * @param {string} coverageFilePath - Путь к файлу с отчетом о покрытии
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Анализ покрытия
 */
async function analyzeCoverageFile(coverageFilePath, options = {}) {
    try {
        logger.info('Analyzing coverage file', { 
            coverageFilePath,
            options: Object.keys(options)
        });
        
        // Проверяем существование файла
        try {
            await fs.access(coverageFilePath);
        } catch (e) {
            return {
                success: false,
                message: `Файл отчета о покрытии не найден: ${coverageFilePath}`
            };
        }
        
        // Читаем и парсим файл
        const fileContent = await fs.readFile(coverageFilePath, 'utf-8');
        let coverageData;
        
        try {
            coverageData = JSON.parse(fileContent);
        } catch (e) {
            return {
                success: false,
                message: `Не удалось распарсить файл отчета о покрытии: ${e.message}`
            };
        }
        
        // Анализируем данные покрытия
        return await analyzeCoverage(coverageData, options);
    } catch (error) {
        logger.error('Error analyzing coverage file', { 
            error: error.message,
            stack: error.stack,
            coverageFilePath
        });
        
        return {
            success: false,
            message: `Ошибка при анализе файла покрытия: ${error.message}`
        };
    }
}

/**
 * Генерирует отчет о покрытии в различных форматах
 * 
 * @param {Object} coverageAnalysis - Результат анализа покрытия
 * @param {string} format - Формат отчета (html, markdown, json)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<string>} - Отчет в указанном формате
 */
async function generateCoverageReport(coverageAnalysis, format = 'markdown', options = {}) {
    try {
        if (!coverageAnalysis || !coverageAnalysis.success) {
            return `Ошибка: ${coverageAnalysis?.message || 'Неверные данные анализа покрытия'}`;
        }
        
        switch (format.toLowerCase()) {
            case 'html':
                return generateHtmlReport(coverageAnalysis, options);
            case 'markdown':
                return generateMarkdownReport(coverageAnalysis, options);
            case 'json':
                return JSON.stringify(coverageAnalysis, null, 2);
            default:
                return generateMarkdownReport(coverageAnalysis, options);
        }
    } catch (error) {
        logger.error('Error generating coverage report', { 
            error: error.message,
            stack: error.stack,
            format
        });
        
        return `Ошибка при генерации отчета: ${error.message}`;
    }
}

/**
 * Генерирует отчет в формате Markdown
 * 
 * @private
 * @param {Object} coverageAnalysis - Результат анализа покрытия
 * @param {Object} options - Дополнительные опции
 * @returns {string} - Отчет в формате Markdown
 */
function generateMarkdownReport(coverageAnalysis, options = {}) {
    const { summary, lowCoverageFiles, recommendations, llmAnalysis } = coverageAnalysis;
    
    let report = '# Отчет о покрытии кода тестами\n\n';
    
    // Добавляем сводную информацию
    report += '## Сводная информация\n\n';
    report += '| Метрика | Покрытие | Процент |\n';
    report += '|---------|----------|--------:|\n';
    report += `| Строки | ${summary.lines.covered}/${summary.lines.total} | ${summary.lines.percentage}% |\n`;
    report += `| Операторы | ${summary.statements.covered}/${summary.statements.total} | ${summary.statements.percentage}% |\n`;
    report += `| Функции | ${summary.functions.covered}/${summary.functions.total} | ${summary.functions.percentage}% |\n`;
    report += `| Ветки | ${summary.branches.covered}/${summary.branches.total} | ${summary.branches.percentage}% |\n`;
    report += `| Файлы | ${summary.files.fullyCovered}/${summary.files.total} | ${summary.files.percentage}% |\n\n`;
    
    // Добавляем файлы с низким покрытием
    if (lowCoverageFiles && lowCoverageFiles.length > 0) {
        report += '## Файлы с низким покрытием\n\n';
        report += '| Файл | Строки | Операторы | Функции | Ветки | Среднее |\n';
        report += '|------|-------:|----------:|---------:|------:|-------:|\n';
        
        for (const file of lowCoverageFiles) {
            report += `| ${file.path} | ${file.coverage.lines}% | ${file.coverage.statements}% | ${file.coverage.functions}% | ${file.coverage.branches}% | ${file.coverage.average}% |\n`;
        }
        
        report += '\n';
    }
    
    // Добавляем рекомендации
    if (recommendations && recommendations.length > 0) {
        report += '## Рекомендации\n\n';
        
        // Группируем по приоритету
        const highPriority = recommendations.filter(r => r.priority === 'high');
        const mediumPriority = recommendations.filter(r => r.priority === 'medium');
        const lowPriority = recommendations.filter(r => r.priority === 'low');
        
        if (highPriority.length > 0) {
            report += '### Высокий приоритет\n\n';
            for (const rec of highPriority) {
                report += `- ${rec.message}\n`;
            }
            report += '\n';
        }
        
        if (mediumPriority.length > 0) {
            report += '### Средний приоритет\n\n';
            for (const rec of mediumPriority) {
                report += `- ${rec.message}\n`;
            }
            report += '\n';
        }
        
        if (lowPriority.length > 0) {
            report += '### Низкий приоритет\n\n';
            for (const rec of lowPriority) {
                report += `- ${rec.message}\n`;
            }
            report += '\n';
        }
    }
    
    // Добавляем анализ LLM, если есть
    if (llmAnalysis) {
        report += '## Дополнительный анализ\n\n';
        
        if (llmAnalysis.analysis) {
            report += `${llmAnalysis.analysis}\n\n`;
        }
        
        if (llmAnalysis.recommendations && llmAnalysis.recommendations.length > 0) {
            report += '### Дополнительные рекомендации\n\n';
            for (const rec of llmAnalysis.recommendations) {
                report += `- ${rec}\n`;
            }
            report += '\n';
        }
    }
    
    return report;
}

/**
 * Генерирует отчет в формате HTML
 * 
 * @private
 * @param {Object} coverageAnalysis - Результат анализа покрытия
 * @param {Object} options - Дополнительные опции
 * @returns {string} - Отчет в формате HTML
 */
function generateHtmlReport(coverageAnalysis, options = {}) {
    const { summary, lowCoverageFiles, recommendations, llmAnalysis } = coverageAnalysis;
    
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Отчет о покрытии кода тестами</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1, h2, h3 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th, td { padding: 10px; text-align: left; border: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
        .progress-bar { 
            height: 20px; 
            background-color: #e0e0e0; 
            border-radius: 5px; 
            overflow: hidden; 
        }
        .progress-value { 
            height: 100%; 
            background-color: #4CAF50; 
            border-radius: 5px; 
        }
        .low { background-color: #f44336; }
        .medium { background-color: #ffc107; }
        .high { background-color: #4CAF50; }
        .priority-high { color: #f44336; }
        .priority-medium { color: #ffc107; }
        .priority-low { color: #4CAF50; }
    </style>
</head>
<body>
    <h1>Отчет о покрытии кода тестами</h1>
    
    <h2>Сводная информация</h2>
    <table>
        <tr>
            <th>Метрика</th>
            <th>Покрытие</th>
            <th>Процент</th>
            <th>Визуализация</th>
        </tr>
        <tr>
            <td>Строки</td>
            <td>${summary.lines.covered}/${summary.lines.total}</td>
            <td>${summary.lines.percentage}%</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-value ${getColorClass(summary.lines.percentage)}" style="width: ${summary.lines.percentage}%"></div>
                </div>
            </td>
        </tr>
        <tr>
            <td>Операторы</td>
            <td>${summary.statements.covered}/${summary.statements.total}</td>
            <td>${summary.statements.percentage}%</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-value ${getColorClass(summary.statements.percentage)}" style="width: ${summary.statements.percentage}%"></div>
                </div>
            </td>
        </tr>
        <tr>
            <td>Функции</td>
            <td>${summary.functions.covered}/${summary.functions.total}</td>
            <td>${summary.functions.percentage}%</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-value ${getColorClass(summary.functions.percentage)}" style="width: ${summary.functions.percentage}%"></div>
                </div>
            </td>
        </tr>
        <tr>
            <td>Ветки</td>
            <td>${summary.branches.covered}/${summary.branches.total}</td>
            <td>${summary.branches.percentage}%</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-value ${getColorClass(summary.branches.percentage)}" style="width: ${summary.branches.percentage}%"></div>
                </div>
            </td>
        </tr>
        <tr>
            <td>Файлы</td>
            <td>${summary.files.fullyCovered}/${summary.files.total}</td>
            <td>${summary.files.percentage}%</td>
            <td>
                <div class="progress-bar">
                    <div class="progress-value ${getColorClass(summary.files.percentage)}" style="width: ${summary.files.percentage}%"></div>
                </div>
            </td>
        </tr>
    </table>`;
    
    // Добавляем файлы с низким покрытием
    if (lowCoverageFiles && lowCoverageFiles.length > 0) {
        html += `
    <h2>Файлы с низким покрытием</h2>
    <table>
        <tr>
            <th>Файл</th>
            <th>Строки</th>
            <th>Операторы</th>
            <th>Функции</th>
            <th>Ветки</th>
            <th>Среднее</th>
        </tr>`;
        
        for (const file of lowCoverageFiles) {
            html += `
        <tr>
            <td>${file.path}</td>
            <td>${file.coverage.lines}%</td>
            <td>${file.coverage.statements}%</td>
            <td>${file.coverage.functions}%</td>
            <td>${file.coverage.branches}%</td>
            <td>${file.coverage.average}%</td>
        </tr>`;
        }
        
        html += `
    </table>`;
    }
    
    // Добавляем рекомендации
    if (recommendations && recommendations.length > 0) {
        html += `
    <h2>Рекомендации</h2>`;
        
        // Группируем по приоритету
        const highPriority = recommendations.filter(r => r.priority === 'high');
        const mediumPriority = recommendations.filter(r => r.priority === 'medium');
        const lowPriority = recommendations.filter(r => r.priority === 'low');
        
        if (highPriority.length > 0) {
            html += `
    <h3>Высокий приоритет</h3>
    <ul>`;
            for (const rec of highPriority) {
                html += `
        <li class="priority-high">${rec.message}</li>`;
            }
            html += `
    </ul>`;
        }
        
        if (mediumPriority.length > 0) {
            html += `
    <h3>Средний приоритет</h3>
    <ul>`;
            for (const rec of mediumPriority) {
                html += `
        <li class="priority-medium">${rec.message}</li>`;
            }
            html += `
    </ul>`;
        }
        
        if (lowPriority.length > 0) {
            html += `
    <h3>Низкий приоритет</h3>
    <ul>`;
            for (const rec of lowPriority) {
                html += `
        <li class="priority-low">${rec.message}</li>`;
            }
            html += `
    </ul>`;
        }
    }
    
    // Добавляем анализ LLM, если есть
    if (llmAnalysis) {
        html += `
    <h2>Дополнительный анализ</h2>`;
        
        if (llmAnalysis.analysis) {
            html += `
    <p>${llmAnalysis.analysis.replace(/\n/g, '<br>')}</p>`;
        }
        
        if (llmAnalysis.recommendations && llmAnalysis.recommendations.length > 0) {
            html += `
    <h3>Дополнительные рекомендации</h3>
    <ul>`;
            for (const rec of llmAnalysis.recommendations) {
                html += `
        <li>${rec}</li>`;
            }
            html += `
    </ul>`;
        }
    }
    
    html += `
</body>
</html>`;
    
    return html;
}

/**
 * Получает класс цвета для процентного значения
 * 
 * @private
 * @param {number} percentage - Процентное значение
 * @returns {string} - Класс цвета
 */
function getColorClass(percentage) {
    if (percentage < 50) return 'low';
    if (percentage < 80) return 'medium';
    return 'high';
}

module.exports = {
    analyzeCoverage,
    analyzeCoverageFile,
    generateCoverageReport
};
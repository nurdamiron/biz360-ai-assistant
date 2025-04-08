/**
 * Анализатор решений для системы обучения
 * Анализирует решения задач и сохраняет их в векторное хранилище
 */

const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const { getVectorStore, SCHEMAS } = require('./vector-store');
const { getEmbeddingGenerator } = require('./embedding-generator');

/**
 * Анализирует и сохраняет решение задачи
 * 
 * @param {Object} taskData - Данные о задаче
 * @param {string} solution - Решение задачи
 * @param {Object} context - Контекст решения (проект, файлы и т.д.)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа и сохранения
 */
async function analyzeSolution(taskData, solution, context = {}, options = {}) {
    try {
        logger.info('Analyzing solution', { 
            taskId: taskData.id || options.taskId,
            solutionLength: solution?.length || 0
        });
        
        // Получаем векторное хранилище и генератор эмбеддингов
        const vectorStore = getVectorStore();
        const embeddingGenerator = getEmbeddingGenerator();
        
        // Анализируем решение с помощью LLM (если включено)
        let analysisResult = null;
        if (options.analyzeSolution !== false) {
            logger.debug('Performing solution analysis with LLM');
            analysisResult = await analyzeWithLLM(taskData, solution, context, options);
            
            logger.debug('Solution analysis completed', {
                taskId: taskData.id || options.taskId,
                quality: analysisResult?.quality || 'unknown',
                patterns: analysisResult?.patterns?.length || 0
            });
        }
        
        // Подготавливаем контекст для сохранения
        const contextToStore = prepareContextForStorage(context);
        
        // Создаем эмбеддинг для задачи
        const taskDescription = taskData.description || taskData.title || '';
        const embedding = await embeddingGenerator.generateEmbedding(taskDescription);
        
        // Формируем данные для сохранения
        const solutionData = {
            id: taskData.id || options.taskId || generateId(),
            task_description: taskDescription,
            task_type: taskData.type || analyzeTaskType(taskDescription),
            solution: solution,
            context: contextToStore,
            success_rating: calculateSuccessRating(analysisResult, options),
            created_at: new Date().toISOString(),
            metadata: {
                ...taskData.metadata || {},
                analysis: analysisResult || null,
                source: options.source || 'manual',
                tags: taskData.tags || [],
                language: taskData.language || detectLanguage(solution)
            }
        };
        
        // Сохраняем в векторное хранилище
        const storedId = await vectorStore.storeItem('taskSolution', solutionData, embedding);
        
        // Если задан projectId, сохраняем также фрагменты контекста для проекта
        if (context.projectId && options.storeProjectContext !== false) {
            await storeProjectContext(context, options);
        }
        
        return {
            id: storedId,
            analysis: analysisResult,
            success: true
        };
    } catch (error) {
        logger.error('Error analyzing solution', { 
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
async function findSimilarSolutions(taskDescription, context = {}, options = {}) {
    try {
        logger.info('Finding similar solutions', {
            descriptionLength: taskDescription?.length || 0,
            options: Object.keys(options)
        });
        
        // Получаем векторное хранилище и генератор эмбеддингов
        const vectorStore = getVectorStore();
        const embeddingGenerator = getEmbeddingGenerator();
        
        // Создаем эмбеддинг для задачи
        const embedding = await embeddingGenerator.generateEmbedding(taskDescription);
        
        // Подготавливаем фильтр
        const filter = {};
        
        if (options.taskType) {
            filter.task_type = options.taskType;
        }
        
        if (options.minSuccessRating !== undefined) {
            filter.success_rating = { $gte: options.minSuccessRating };
        }
        
        // Ищем похожие решения
        const similarSolutions = await vectorStore.findSimilar('taskSolution', embedding, {
            limit: options.limit || 5,
            minSimilarity: options.minSimilarity || 0.7,
            filter: filter,
            includeEmbedding: false
        });
        
        // Если нужно найти также контекст проекта
        if (context.projectId && options.includeProjectContext !== false) {
            await enrichWithProjectContext(similarSolutions, context, options);
        }
        
        return similarSolutions;
    } catch (error) {
        logger.error('Error finding similar solutions', { 
            error: error.message,
            stack: error.stack
        });
        
        return [];
    }
}

/**
 * Анализирует решение с помощью LLM
 * 
 * @private
 * @param {Object} taskData - Данные о задаче
 * @param {string} solution - Решение задачи
 * @param {Object} context - Контекст решения
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат анализа
 */
async function analyzeWithLLM(taskData, solution, context, options) {
    try {
        // Загружаем промпт для анализа решения
        const prompt = await promptManager.getPrompt('solution-analysis', {
            task_description: taskData.description || taskData.title || '',
            solution: solution,
            context: JSON.stringify(prepareContextForLLM(context), null, 2)
        });
        
        // Отправляем запрос к LLM с ожиданием структурированного ответа
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
                    throw new Error('No JSON found in LLM response');
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response as JSON', { error: e.message });
                
                // Создаем базовый объект анализа
                parsedResponse = {
                    quality: 'medium',
                    strengths: ['Unable to parse detailed analysis'],
                    weaknesses: ['Analysis parsing failed'],
                    patterns: [],
                    reusability: 'medium'
                };
            }
        } else {
            // Если ответ уже в виде объекта
            parsedResponse = response;
        }
        
        return parsedResponse;
    } catch (error) {
        logger.error('Error analyzing solution with LLM', { error: error.message });
        
        // Возвращаем базовый результат в случае ошибки
        return {
            quality: 'unknown',
            strengths: [],
            weaknesses: ['Analysis failed: ' + error.message],
            patterns: [],
            reusability: 'low'
        };
    }
}

/**
 * Сохраняет контекст проекта в векторное хранилище
 * 
 * @private
 * @param {Object} context - Контекст проекта
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<void>}
 */
async function storeProjectContext(context, options) {
    try {
        if (!context.projectId) {
            logger.warn('Cannot store project context: missing projectId');
            return;
        }
        
        const vectorStore = getVectorStore();
        const embeddingGenerator = getEmbeddingGenerator();
        
        // Обрабатываем файлы проекта
        if (context.files && context.files.length > 0) {
            logger.debug(`Processing ${context.files.length} project files for context storage`);
            
            // Ограничиваем количество файлов, если их слишком много
            const filesToProcess = context.files.slice(0, options.maxFiles || 100);
            
            // Обрабатываем каждый файл
            for (const file of filesToProcess) {
                if (!file.content || !file.path) continue;
                
                // Разбиваем содержимое файла на куски
                const chunks = embeddingGenerator.chunkText(file.content, {
                    chunkSize: options.chunkSize || 1000,
                    chunkOverlap: options.chunkOverlap || 200
                });
                
                // Обрабатываем каждый кусок
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    
                    // Создаем эмбеддинг для куска
                    const embedding = await embeddingGenerator.generateEmbedding(chunk);
                    
                    // Определяем тип файла
                    const fileType = detectFileType(file.path);
                    
                    // Сохраняем кусок в векторное хранилище
                    await vectorStore.storeItem('projectContext', {
                        id: `${context.projectId}-${file.path}-${i}`,
                        project_id: context.projectId,
                        content_chunk: chunk,
                        source_file: file.path,
                        chunk_type: fileType,
                        created_at: new Date().toISOString(),
                        metadata: {
                            index: i,
                            total_chunks: chunks.length,
                            file_size: file.content.length
                        }
                    }, embedding);
                }
            }
            
            logger.debug('Project context files processed and stored');
        }
        
        // Обрабатываем схему БД
        if (context.dbSchema) {
            const dbSchemaText = typeof context.dbSchema === 'string' 
                ? context.dbSchema 
                : JSON.stringify(context.dbSchema, null, 2);
                
            // Создаем эмбеддинг для схемы БД
            const embedding = await embeddingGenerator.generateEmbedding(dbSchemaText);
            
            // Сохраняем схему БД в векторное хранилище
            await vectorStore.storeItem('projectContext', {
                id: `${context.projectId}-dbschema`,
                project_id: context.projectId,
                content_chunk: dbSchemaText,
                source_file: 'database_schema',
                chunk_type: 'database',
                created_at: new Date().toISOString(),
                metadata: {
                    type: 'database_schema'
                }
            }, embedding);
            
            logger.debug('Project database schema stored');
        }
    } catch (error) {
        logger.error('Error storing project context', { 
            error: error.message,
            projectId: context.projectId
        });
    }
}

/**
 * Обогащает найденные решения контекстом проекта
 * 
 * @private
 * @param {Array} solutions - Найденные решения
 * @param {Object} context - Контекст запроса
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<void>}
 */
async function enrichWithProjectContext(solutions, context, options) {
    if (!context.projectId || !solutions.length) {
        return;
    }
    
    try {
        const vectorStore = getVectorStore();
        const embeddingGenerator = getEmbeddingGenerator();
        
        // Для каждого решения ищем похожий контекст проекта
        for (const solution of solutions) {
            if (!solution.task_description) continue;
            
            // Создаем эмбеддинг для описания задачи
            const embedding = await embeddingGenerator.generateEmbedding(solution.task_description);
            
            // Ищем похожий контекст проекта
            const projectContext = await vectorStore.findSimilar('projectContext', embedding, {
                limit: options.contextLimit || 5,
                minSimilarity: options.contextMinSimilarity || 0.6,
                filter: {
                    project_id: context.projectId
                },
                includeEmbedding: false
            });
            
            // Добавляем найденный контекст к решению
            if (projectContext && projectContext.length > 0) {
                solution.related_context = projectContext.map(context => ({
                    content: context.content_chunk,
                    source: context.source_file,
                    type: context.chunk_type,
                    similarity: context.similarity
                }));
            }
        }
        
        logger.debug('Solutions enriched with project context');
    } catch (error) {
        logger.error('Error enriching solutions with project context', { 
            error: error.message,
            projectId: context.projectId
        });
    }
}

/**
 * Подготавливает контекст для сохранения в хранилище
 * 
 * @private
 * @param {Object} context - Исходный контекст
 * @returns {Object} - Подготовленный контекст
 */
function prepareContextForStorage(context) {
    // Базовая структура контекста
    const preparedContext = {
        projectId: context.projectId,
        technologies: context.technologies || [],
        fileReferences: []
    };
    
    // Добавляем ссылки на файлы без их содержимого
    if (context.files && context.files.length > 0) {
        preparedContext.fileReferences = context.files.map(file => ({
            path: file.path,
            type: detectFileType(file.path),
            size: file.content ? file.content.length : 0
        }));
    }
    
    // Добавляем тип базы данных, если есть
    if (context.dbSchema) {
        preparedContext.database = {
            type: detectDatabaseType(context.dbSchema)
        };
    }
    
    return preparedContext;
}

/**
 * Подготавливает контекст для отправки в LLM
 * 
 * @private
 * @param {Object} context - Исходный контекст
 * @returns {Object} - Подготовленный контекст
 */
function prepareContextForLLM(context) {
    // Базовая структура контекста
    const preparedContext = {
        projectId: context.projectId,
        technologies: context.technologies || []
    };
    
    // Добавляем важные части содержимого файлов
    if (context.files && context.files.length > 0) {
        // Ограничим количество файлов для анализа
        const importantFiles = selectImportantFiles(context.files, 5);
        
        preparedContext.files = importantFiles.map(file => ({
            path: file.path,
            content: truncateContent(file.content, 1000)
        }));
    }
    
    // Добавляем схему БД в упрощенном виде
    if (context.dbSchema) {
        if (typeof context.dbSchema === 'string') {
            preparedContext.dbSchema = truncateContent(context.dbSchema, 1000);
        } else {
            preparedContext.dbSchema = context.dbSchema;
        }
    }
    
    return preparedContext;
}

/**
 * Выбирает наиболее важные файлы из списка
 * 
 * @private
 * @param {Array} files - Список файлов
 * @param {number} limit - Максимальное количество файлов
 * @returns {Array} - Список важных файлов
 */
function selectImportantFiles(files, limit = 5) {
    if (!files.length) return [];
    
    // Сортируем файлы по "важности" (расширение, размер и т.д.)
    return files
        .filter(file => file.path && file.content)
        .sort((a, b) => {
            // Приоритет по типу файла
            const aType = detectFileType(a.path);
            const bType = detectFileType(b.path);
            
            const typeOrder = {
                'code': 1,
                'doc': 2,
                'config': 3,
                'other': 4
            };
            
            const aTypeOrder = typeOrder[aType] || 4;
            const bTypeOrder = typeOrder[bType] || 4;
            
            if (aTypeOrder !== bTypeOrder) {
                return aTypeOrder - bTypeOrder;
            }
            
            // При равном типе, приоритет по размеру файла (больше = важнее)
            return (b.content?.length || 0) - (a.content?.length || 0);
        })
        .slice(0, limit);
}

/**
 * Обрезает содержимое до заданной длины
 * 
 * @private
 * @param {string} content - Исходное содержимое
 * @param {number} maxLength - Максимальная длина
 * @returns {string} - Обрезанное содержимое
 */
function truncateContent(content, maxLength = 1000) {
    if (!content) return '';
    
    if (content.length <= maxLength) {
        return content;
    }
    
    const half = Math.floor(maxLength / 2);
    return content.substring(0, half) + '...' + content.substring(content.length - half);
}

/**
 * Определяет тип файла на основе его пути
 * 
 * @private
 * @param {string} filePath - Путь к файлу
 * @returns {string} - Тип файла
 */
function detectFileType(filePath) {
    if (!filePath) return 'other';
    
    const extension = filePath.split('.').pop().toLowerCase();
    
    // Коды файлов
    const codeExtensions = [
        'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'php',
        'swift', 'rs', 'scala', 'kt', 'kts', 'dart', 'sh', 'pl', 'pm'
    ];
    
    // Документация
    const docExtensions = [
        'md', 'txt', 'rst', 'adoc', 'pdf', 'doc', 'docx', 'rtf', 'html', 'htm',
        'ipynb'
    ];
    
    // Конфигурация
    const configExtensions = [
        'json', 'yaml', 'yml', 'xml', 'ini', 'conf', 'config', 'toml', 'properties',
        'env', 'cfg'
    ];
    
    if (codeExtensions.includes(extension)) {
        return 'code';
    } else if (docExtensions.includes(extension)) {
        return 'doc';
    } else if (configExtensions.includes(extension)) {
        return 'config';
    } else {
        return 'other';
    }
}

/**
 * Определяет тип базы данных на основе схемы
 * 
 * @private
 * @param {string|Object} dbSchema - Схема базы данных
 * @returns {string} - Тип базы данных
 */
function detectDatabaseType(dbSchema) {
    if (!dbSchema) return 'unknown';
    
    if (typeof dbSchema === 'string') {
        // Проверяем ключевые слова в строке схемы
        if (dbSchema.includes('CREATE TABLE') || 
            dbSchema.includes('INTEGER') || 
            dbSchema.includes('VARCHAR')) {
            
            // Пытаемся определить конкретный диалект SQL
            if (dbSchema.includes('AUTOINCREMENT')) {
                return 'sqlite';
            } else if (dbSchema.includes('AUTO_INCREMENT')) {
                return 'mysql';
            } else if (dbSchema.includes('SERIAL')) {
                return 'postgresql';
            }
            
            return 'sql';
        } else if (dbSchema.includes('ObjectId') || dbSchema.includes('document')) {
            return 'mongodb';
        }
    } else if (typeof dbSchema === 'object') {
        // Проверяем структуру объекта
        if (dbSchema.type) {
            return dbSchema.type.toLowerCase();
        } else if (dbSchema.dialect) {
            return dbSchema.dialect.toLowerCase();
        } else if (dbSchema.collections || dbSchema.documents) {
            return 'mongodb';
        } else if (dbSchema.tables) {
            return 'sql';
        }
    }
    
    return 'unknown';
}

/**
 * Рассчитывает рейтинг успешности решения
 * 
 * @private
 * @param {Object} analysis - Результат анализа решения
 * @param {Object} options - Дополнительные опции
 * @returns {number} - Рейтинг успешности (от 0 до 1)
 */
function calculateSuccessRating(analysis, options) {
    // Если указан явный рейтинг, используем его
    if (options.successRating !== undefined) {
        return Math.max(0, Math.min(1, options.successRating));
    }
    
    // Если нет анализа, возвращаем средний рейтинг
    if (!analysis) {
        return 0.5;
    }
    
    // Рассчитываем на основе оценки качества
    const qualityMap = {
        'excellent': 1.0,
        'high': 0.8,
        'good': 0.7,
        'medium': 0.5,
        'average': 0.5,
        'low': 0.3,
        'poor': 0.2,
        'unknown': 0.5
    };
    
    const qualityRating = qualityMap[analysis.quality.toLowerCase()] || 0.5;
    
    // Учитываем переиспользуемость
    const reusabilityMap = {
        'high': 0.3,
        'medium': 0.2,
        'low': 0.1,
        'unknown': 0.15
    };
    
    const reusabilityFactor = reusabilityMap[analysis.reusability?.toLowerCase()] || 0.15;
    
    // Учитываем количество сильных и слабых сторон
    const strengthsCount = analysis.strengths?.length || 0;
    const weaknessesCount = analysis.weaknesses?.length || 0;
    
    const strengthWeaknessFactor = Math.min(0.2, Math.max(-0.2, 
        (strengthsCount - weaknessesCount) * 0.05
    ));
    
    // Учитываем количество выявленных паттернов
    const patternsCount = analysis.patterns?.length || 0;
    const patternsFactor = Math.min(0.1, patternsCount * 0.02);
    
    // Итоговый рейтинг
    let rating = qualityRating + reusabilityFactor + strengthWeaknessFactor + patternsFactor;
    
    // Ограничиваем от 0 до 1
    return Math.max(0, Math.min(1, rating));
}

/**
 * Определяет тип задачи на основе ее описания
 * 
 * @private
 * @param {string} description - Описание задачи
 * @returns {string} - Тип задачи
 */
function analyzeTaskType(description) {
    if (!description) return 'unknown';
    
    // Простой анализ на основе ключевых слов
    const lowercaseDesc = description.toLowerCase();
    
    if (lowercaseDesc.includes('bug') || 
        lowercaseDesc.includes('fix') || 
        lowercaseDesc.includes('issue') ||
        lowercaseDesc.includes('ошибк') ||
        lowercaseDesc.includes('исправ')) {
        return 'bug_fix';
    } else if (lowercaseDesc.includes('refactor') || 
              lowercaseDesc.includes('restructure') ||
              lowercaseDesc.includes('рефактор')) {
        return 'refactoring';
    } else if (lowercaseDesc.includes('test') ||
              lowercaseDesc.includes('тест')) {
        return 'testing';
    } else if (lowercaseDesc.includes('api') ||
              lowercaseDesc.includes('endpoint')) {
        return 'api_development';
    } else if (lowercaseDesc.includes('ui') ||
              lowercaseDesc.includes('interface') ||
              lowercaseDesc.includes('интерфейс') ||
              lowercaseDesc.includes('component')) {
        return 'ui_development';
    } else if (lowercaseDesc.includes('database') ||
              lowercaseDesc.includes('db') ||
              lowercaseDesc.includes('sql') ||
              lowercaseDesc.includes('база данных')) {
        return 'database';
    } else if (lowercaseDesc.includes('deploy') ||
              lowercaseDesc.includes('build') ||
              lowercaseDesc.includes('release')) {
        return 'devops';
    } else if (lowercaseDesc.includes('document') ||
              lowercaseDesc.includes('documentation') ||
              lowercaseDesc.includes('докумен')) {
        return 'documentation';
    } else if (lowercaseDesc.includes('data analysis') ||
              lowercaseDesc.includes('analytics') ||
              lowercaseDesc.includes('аналитик')) {
        return 'data_analysis';
    }
    
    // По умолчанию считаем, что это фича
    return 'feature';
}

/**
 * Определяет язык программирования решения
 * 
 * @private
 * @param {string} solution - Решение задачи
 * @returns {string} - Язык программирования
 */
function detectLanguage(solution) {
    if (!solution) return 'unknown';
    
    // Ищем маркеры языков программирования в markdown-блоках
    const languageMatches = solution.match(/```([a-z]+)/g);
    
    if (languageMatches && languageMatches.length > 0) {
        // Берем самый часто встречающийся язык
        const languages = languageMatches.map(match => match.replace('```', ''));
        const languageCount = {};
        
        for (const lang of languages) {
            languageCount[lang] = (languageCount[lang] || 0) + 1;
        }
        
        let maxCount = 0;
        let detectedLanguage = 'unknown';
        
        for (const [lang, count] of Object.entries(languageCount)) {
            if (count > maxCount) {
                maxCount = count;
                detectedLanguage = lang;
            }
        }
        
        return detectedLanguage;
    }
    
    // Если нет маркеров, пытаемся определить по содержимому
    const lowercaseSolution = solution.toLowerCase();
    
    // Проверяем наличие характерных конструкций
    if (lowercaseSolution.includes('def ') && lowercaseSolution.includes('import ')) {
        return 'python';
    } else if (lowercaseSolution.includes('function') && 
               (lowercaseSolution.includes('const ') || lowercaseSolution.includes('let '))) {
        return 'javascript';
    } else if (lowercaseSolution.includes('interface ') || 
               (lowercaseSolution.includes('class ') && lowercaseSolution.includes(': ') && 
                lowercaseSolution.includes('<'))) {
        return 'typescript';
    } else if (lowercaseSolution.includes('public class') || 
               lowercaseSolution.includes('private void')) {
        return 'java';
    } else if (lowercaseSolution.includes('#include') && lowercaseSolution.includes('int main')) {
        return 'cpp';
    } else if (lowercaseSolution.includes('func ') && lowercaseSolution.includes('package ')) {
        return 'go';
    } else if (lowercaseSolution.includes('<?php')) {
        return 'php';
    } else if (lowercaseSolution.includes('require ') && 
               lowercaseSolution.includes('end')) {
        return 'ruby';
    }
    
    return 'unknown';
}

/**
 * Генерирует уникальный ID
 * 
 * @private
 * @returns {string} - Уникальный ID
 */
function generateId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
}

/**
 * Расширяет промпт примерами похожих решений
 * 
 * @param {string} prompt - Исходный промпт
 * @param {Object} context - Контекст запроса
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<string>} - Расширенный промпт
 */
async function enhancePromptWithExamples(prompt, context, options = {}) {
    if (!prompt || options.enhanceWithExamples === false) {
        return prompt;
    }
    
    try {
        logger.debug('Enhancing prompt with similar examples', {
            promptLength: prompt.length,
            options: Object.keys(options)
        });
        
        // Извлекаем описание задачи из промпта (это эвристика, может потребоваться доработка)
        const taskMatch = prompt.match(/task(?:\s+description)?:\s*(.*?)(?:solution|content|context|\n\n)/is);
        const taskDescription = taskMatch ? taskMatch[1].trim() : '';
        
        if (!taskDescription) {
            logger.debug('Could not extract task description from prompt, skipping enhancement');
            return prompt;
        }
        
        // Ищем похожие решения
        const similarSolutions = await findSimilarSolutions(taskDescription, context, {
            limit: options.examplesLimit || 2,
            minSimilarity: options.examplesMinSimilarity || 0.75,
            minSuccessRating: options.examplesMinRating || 0.7
        });
        
        if (!similarSolutions.length) {
            logger.debug('No similar solutions found for enhancement');
            return prompt;
        }
        
        logger.debug(`Found ${similarSolutions.length} similar solutions for prompt enhancement`);
        
        // Формируем примеры для добавления в промпт
        let examplesText = '\n\n## SIMILAR EXAMPLES\n\n';
        
        for (let i = 0; i < similarSolutions.length; i++) {
            const solution = similarSolutions[i];
            
            examplesText += `### Example ${i + 1}:\n\n`;
            examplesText += `Task: ${solution.task_description}\n\n`;
            
            // Ограничиваем размер решения
            const solutionText = truncateContent(solution.solution, 1000);
            examplesText += `Solution:\n${solutionText}\n\n`;
            
            // Добавляем теги и метаданные, если есть
            if (solution.metadata && solution.metadata.tags) {
                examplesText += `Tags: ${solution.metadata.tags.join(', ')}\n`;
            }
            
            if (i < similarSolutions.length - 1) {
                examplesText += '---\n\n';
            }
        }
        
        examplesText += '\n## CURRENT TASK\n\n';
        
        // Определяем, куда вставить примеры
        const insertPosition = options.insertPosition || 'beginning';
        
        if (insertPosition === 'beginning') {
            return examplesText + prompt;
        } else if (insertPosition === 'end') {
            return prompt + examplesText;
        } else {
            // По умолчанию вставляем перед основной задачей
            const firstPart = prompt.split('##')[0];
            const restPart = prompt.substring(firstPart.length);
            return firstPart + examplesText + restPart;
        }
    } catch (error) {
        logger.error('Error enhancing prompt with examples', { 
            error: error.message,
            stack: error.stack
        });
        
        // В случае ошибки возвращаем исходный промпт
        return prompt;
    }
}

/**
 * Получает статистику по сохраненным решениям
 * 
 * @param {Object} options - Опции запроса статистики
 * @returns {Promise<Object>} - Статистика
 */
async function getSolutionStats(options = {}) {
    try {
        logger.debug('Getting solution stats', { options: Object.keys(options) });
        
        const vectorStore = getVectorStore();
        
        // Получаем общую статистику хранилища
        const storeStats = await vectorStore.getStats();
        
        // Находим статистику для каждого типа задач
        const taskTypes = ['feature', 'bug_fix', 'refactoring', 'testing', 'api_development', 
                          'ui_development', 'database', 'devops', 'documentation', 'data_analysis'];
        
        const taskTypeStats = {};
        
        for (const taskType of taskTypes) {
            // Находим решения по типу
            const solutions = await vectorStore.findItems('taskSolution', { task_type: taskType }, {
                limit: 1000 // Большой лимит для получения всех решений
            });
            
            if (solutions.length > 0) {
                // Вычисляем средний рейтинг успешности
                const avgRating = solutions.reduce((sum, solution) => 
                    sum + (solution.success_rating || 0), 0) / solutions.length;
                
                taskTypeStats[taskType] = {
                    count: solutions.length,
                    avgRating: avgRating
                };
            }
        }
        
        return {
            totalSolutions: storeStats.schemas.taskSolution?.count || 0,
            byTaskType: taskTypeStats,
            storeStats: storeStats.metrics
        };
    } catch (error) {
        logger.error('Error getting solution stats', { 
            error: error.message,
            stack: error.stack
        });
        
        return {
            error: error.message,
            totalSolutions: 0,
            byTaskType: {}
        };
    }
}

module.exports = {
    analyzeSolution,
    findSimilarSolutions,
    enhancePromptWithExamples,
    getSolutionStats
};
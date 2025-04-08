/**
 * Движок рекомендаций технологий
 * Генерирует рекомендации технологий на основе задачи и существующего контекста
 */

const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const techDatabase = require('./tech-database');

/**
 * Генерирует рекомендации по технологиям для задачи
 * 
 * @param {string} taskDescription - Описание задачи
 * @param {Object} taskClassification - Классификация задачи
 * @param {Array} existingTech - Существующие технологии проекта
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Объект с рекомендациями
 */
async function generateRecommendations(taskDescription, taskClassification, existingTech, options = {}) {
    try {
        // Определяем, будем ли использовать эвристический подход или LLM
        if (options.useHeuristic) {
            return await generateHeuristicRecommendations(
                taskDescription, 
                taskClassification,
                existingTech,
                options
            );
        }
        
        // Используем LLM для генерации рекомендаций
        return await generateLLMRecommendations(
            taskDescription,
            taskClassification,
            existingTech,
            options
        );
    } catch (error) {
        logger.error('Error generating technology recommendations', { 
            error: error.message,
            taskId: options.taskId 
        });
        
        return {
            recommendations: [],
            reasoning: 'Ошибка при генерации рекомендаций: ' + error.message
        };
    }
}

/**
 * Генерирует рекомендации по технологиям на основе эвристик
 * 
 * @param {string} taskDescription - Описание задачи
 * @param {Object} taskClassification - Классификация задачи
 * @param {Array} existingTech - Существующие технологии проекта
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Объект с рекомендациями
 */
async function generateHeuristicRecommendations(taskDescription, taskClassification, existingTech, options) {
    const result = {
        recommendations: [],
        reasoning: 'Рекомендации на основе эвристик и базы знаний технологий',
        taskDescription: taskDescription
    };
    
    // Извлекаем типы задач из классификации
    const taskTypes = extractTaskTypes(taskClassification);
    
    // Собираем категории технологий на основе типа задачи
    const techCategories = mapTaskTypesToTechCategories(taskTypes);
    
    // Получаем существующие категории технологий в проекте
    const existingCategories = new Set();
    for (const tech of existingTech) {
        if (tech.info && tech.info.category) {
            existingCategories.add(tech.info.category);
        }
    }
    
    // Для каждой категории подбираем рекомендуемые технологии
    for (const category of techCategories) {
        // Получаем топ технологий для категории
        const recommendedTechs = techDatabase.getRecommendedByCategory(category, { 
            sortByTrend: true 
        });
        
        if (recommendedTechs.length === 0) continue;
        
        // Выбираем только технологии, которые еще не используются в проекте
        const existingTechNames = existingTech.map(t => t.name.toLowerCase());
        const newTechs = recommendedTechs.filter(t => 
            !existingTechNames.includes(t.key.toLowerCase())
        );
        
        // Добавляем до 2 технологий из категории
        for (let i = 0; i < Math.min(2, newTechs.length); i++) {
            result.recommendations.push({
                name: newTechs[i].name,
                category: newTechs[i].category,
                description: newTechs[i].description,
                rationale: `Топовая технология в категории ${newTechs[i].category}, подходит для данной задачи`,
                confidence: 0.7 // Эвристические рекомендации имеют среднюю уверенность
            });
        }
    }
    
    return result;
}

/**
 * Генерирует рекомендации по технологиям с использованием LLM
 * 
 * @param {string} taskDescription - Описание задачи
 * @param {Object} taskClassification - Классификация задачи
 * @param {Array} existingTech - Существующие технологии проекта
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Объект с рекомендациями
 */
async function generateLLMRecommendations(taskDescription, taskClassification, existingTech, options) {
    // Подготавливаем данные о существующих технологиях для промпта
    const existingTechData = existingTech.map(tech => {
        const { name, version, info } = tech;
        return {
            name,
            version: version || 'unknown',
            category: info?.category || 'unknown',
            description: info?.description || ''
        };
    });
    
    // Создаём промпт для LLM
    const prompt = await promptManager.getPrompt('technology-recommendation', {
        taskDescription,
        taskClassification: JSON.stringify(taskClassification, null, 2),
        existingTechnologies: JSON.stringify(existingTechData, null, 2),
        customRequirements: options.requirements || '',
        maxRecommendations: options.maxRecommendations || 5
    });
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(prompt, {
        temperature: 0.4, // Немного случайности для разнообразия
        max_tokens: 1500, // Ограничиваем размер ответа
        structuredOutput: true // Запрашиваем структурированный вывод, если поддерживается
    });
    
    // Обрабатываем ответ
    try {
        // Проверяем, получили ли мы уже структурированный ответ
        if (typeof response === 'object' && response.recommendations) {
            return {
                recommendations: response.recommendations,
                reasoning: response.reasoning || 'Рекомендации на основе анализа задачи и существующих технологий',
                taskDescription
            };
        }
        
        // Иначе пытаемся извлечь структурированные данные из текстового ответа
        const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                        response.match(/\{[\s\S]*\}/);
                        
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            return {
                recommendations: parsedData.recommendations || [],
                reasoning: parsedData.reasoning || 'Рекомендации извлечены из ответа LLM',
                taskDescription
            };
        }
        
        // Если не удаётся извлечь JSON, пытаемся извлечь рекомендации из текста
        const recommendations = extractRecommendationsFromText(response);
        
        return {
            recommendations,
            reasoning: 'Рекомендации извлечены из текстового ответа LLM',
            taskDescription,
            rawResponse: response // Сохраняем исходный ответ для отладки
        };
    } catch (error) {
        logger.error('Error parsing LLM technology recommendations', { 
            error: error.message,
            response: typeof response === 'string' ? response.substring(0, 200) : 'Object response'
        });
        
        return {
            recommendations: [],
            reasoning: 'Ошибка при обработке рекомендаций: ' + error.message,
            taskDescription
        };
    }
}

/**
 * Извлекает рекомендации из текстового ответа LLM
 * 
 * @param {string} text - Текстовый ответ
 * @returns {Array} - Массив рекомендаций
 */
function extractRecommendationsFromText(text) {
    const recommendations = [];
    
    // Поиск рекомендаций в формате "1. Technology Name - Description"
    const recommendationRegex = /\d+\.\s+([^-]+)\s+-\s+(.+?)(?=\n\d+\.\s+|\n\n|$)/gs;
    
    let match;
    while ((match = recommendationRegex.exec(text)) !== null) {
        const name = match[1].trim();
        const description = match[2].trim();
        
        recommendations.push({
            name,
            description,
            confidence: 0.6 // Средняя уверенность для извлеченных из текста рекомендаций
        });
    }
    
    // Если регулярное выражение не дало результатов, пробуем другой подход
    if (recommendations.length === 0) {
        // Ищем технологии, выделенные как код или жирным в Markdown
        const techHighlightRegex = /[`*]{1,2}([^`*]+)[`*]{1,2}/g;
        
        const highlightedTechs = new Set();
        while ((match = techHighlightRegex.exec(text)) !== null) {
            highlightedTechs.add(match[1].trim());
        }
        
        // Добавляем найденные технологии без подробностей
        for (const tech of highlightedTechs) {
            recommendations.push({
                name: tech,
                description: 'Рекомендуемая технология',
                confidence: 0.4 // Низкая уверенность из-за отсутствия контекста
            });
        }
    }
    
    return recommendations;
}

/**
 * Извлекает типы задач из классификации
 * 
 * @param {Object} classification - Результат классификации задачи
 * @returns {Array} - Массив типов задач
 */
function extractTaskTypes(classification) {
    if (!classification) return ['unknown'];
    
    const types = [];
    
    // Добавляем основной тип
    if (classification.type) {
        types.push(classification.type.toLowerCase());
    }
    
    // Добавляем подтипы или признаки, если есть
    if (classification.features && Array.isArray(classification.features)) {
        types.push(...classification.features.map(f => f.toLowerCase()));
    }
    
    // Если ничего не найдено, используем тип "unknown"
    return types.length > 0 ? types : ['unknown'];
}

/**
 * Сопоставляет типы задач с категориями технологий
 * 
 * @param {Array} taskTypes - Типы задач
 * @returns {Array} - Массив категорий технологий
 */
function mapTaskTypesToTechCategories(taskTypes) {
    const categoryMap = {
        'frontend': techDatabase.TECH_CATEGORIES.FRONTEND,
        'backend': techDatabase.TECH_CATEGORIES.BACKEND,
        'ui': techDatabase.TECH_CATEGORIES.FRONTEND,
        'api': techDatabase.TECH_CATEGORIES.BACKEND,
        'database': techDatabase.TECH_CATEGORIES.DATABASE,
        'data': techDatabase.TECH_CATEGORIES.DATABASE,
        'ml': techDatabase.TECH_CATEGORIES.AI_ML,
        'ai': techDatabase.TECH_CATEGORIES.AI_ML,
        'machine learning': techDatabase.TECH_CATEGORIES.AI_ML,
        'web': techDatabase.TECH_CATEGORIES.FRONTEND,
        'mobile': techDatabase.TECH_CATEGORIES.MOBILE,
        'desktop': techDatabase.TECH_CATEGORIES.DESKTOP,
        'testing': techDatabase.TECH_CATEGORIES.TESTING,
        'test': techDatabase.TECH_CATEGORIES.TESTING,
        'devops': techDatabase.TECH_CATEGORIES.DEVOPS,
        'deployment': techDatabase.TECH_CATEGORIES.DEVOPS,
        'ci/cd': techDatabase.TECH_CATEGORIES.DEVOPS,
        'security': techDatabase.TECH_CATEGORIES.SECURITY
    };
    
    const categories = new Set();
    
    // Сопоставляем типы задач с категориями
    for (const taskType of taskTypes) {
        for (const [key, value] of Object.entries(categoryMap)) {
            if (taskType.includes(key)) {
                categories.add(value);
            }
        }
    }
    
    // Если не удалось сопоставить, возвращаем две основные категории
    if (categories.size === 0) {
        return [techDatabase.TECH_CATEGORIES.FRONTEND, techDatabase.TECH_CATEGORIES.BACKEND];
    }
    
    return Array.from(categories);
}

/**
 * Генерирует сравнение предложенных технологий
 * 
 * @param {Object} options - Параметры для генерации сравнения
 * @returns {Promise<Object>} - Структурированное сравнение технологий
 */
async function generateTechComparison(options) {
    try {
        const { task, suggested, compatibility, options: comparisonOptions } = options;
        
        // Если нет предложенных технологий, нечего сравнивать
        if (!suggested || !suggested.recommendations || suggested.recommendations.length < 2) {
            return null;
        }
        
        // Собираем данные о технологиях для сравнения
        const techNames = suggested.recommendations.map(rec => rec.name);
        
        // Создаем промпт для сравнения технологий
        const prompt = await promptManager.getPrompt('technology-comparison', {
            taskDescription: task,
            technologiesToCompare: techNames.join(', '),
            compatibilityIssues: JSON.stringify(compatibility?.potentialIssues || []),
            comparisonCriteria: comparisonOptions?.criteria || 'learning curve, performance, community support, maturity'
        });
        
        // Запрашиваем сравнение у LLM
        const response = await llmClient.sendPrompt(prompt, {
            temperature: 0.3,
            max_tokens: 2000,
            structuredOutput: true
        });
        
        // Обрабатываем ответ
        try {
            // Проверяем, получили ли мы уже структурированный ответ
            if (typeof response === 'object' && response.comparison) {
                return response;
            }
            
            // Иначе пытаемся извлечь JSON из текста
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                           response.match(/\{[\s\S]*\}/);
                           
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1] || jsonMatch[0]);
            }
            
            // Если не удалось извлечь JSON, возвращаем текстовое сравнение
            return {
                comparison: response,
                format: 'text'
            };
        } catch (error) {
            logger.error('Error parsing tech comparison response', { error: error.message });
            return {
                comparison: 'Не удалось сгенерировать структурированное сравнение технологий',
                error: error.message
            };
        }
    } catch (error) {
        logger.error('Error generating technology comparison', { error: error.message });
        return null;
    }
}

module.exports = {
    generateRecommendations,
    generateTechComparison
};
/**
 * Анализатор совместимости технологий
 * Оценивает совместимость предлагаемых технологий с существующими в проекте
 */

const logger = require('../../utils/logger');
const techDatabase = require('./tech-database');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');

// Матрица известных совместимостей технологий
// -1: несовместимы, 0: неизвестно, 1: частично совместимы, 2: хорошо совместимы
const COMPATIBILITY_MATRIX = {
    // Frontend совместимости
    'react': {
        'vue': -1, // Несовместимы в одном компоненте
        'angular': -1,
        'svelte': -1,
        'redux': 2,
        'mobx': 2,
        'react-router': 2,
        'next.js': 2,
        'chakra-ui': 2,
        'material-ui': 2,
        'styled-components': 2,
        'typescript': 2,
    },
    'vue': {
        'vuex': 2,
        'vue-router': 2,
        'nuxt.js': 2,
        'vuetify': 2,
        'typescript': 2,
    },
    // Backend совместимости
    'express': {
        'mongoose': 2,
        'sequelize': 2,
        'passport': 2,
        'nest': -1, // Обычно не используются вместе
    },
    'nest': {
        'typeorm': 2,
        'mongoose': 2,
        'passport': 2,
    },
    // Database ORM/ODM совместимости
    'sequelize': {
        'mysql': 2,
        'postgresql': 2,
        'sqlite': 2,
        'mssql': 2,
        'mongodb': -1,
        'mongoose': -1,
    },
    'mongoose': {
        'mongodb': 2,
        'mysql': -1,
        'postgresql': -1,
    },
    // ... другие совместимости можно добавить
};

/**
 * Анализирует совместимость между существующими и предлагаемыми технологиями
 * 
 * @param {Array} existingTech - Массив существующих технологий
 * @param {Object} suggestedTech - Объект с предлагаемыми технологиями и рекомендациями
 * @returns {Promise<Object>} - Объект с результатами анализа совместимости
 */
async function analyzeTechCompatibility(existingTech, suggestedTech) {
    try {
        const result = {
            compatibilityMatrix: {},
            overallCompatibility: 'unknown',
            potentialIssues: [],
            recommendations: []
        };
        
        // Если нет предложенных технологий, возвращаем пустой результат
        if (!suggestedTech.recommendations || !suggestedTech.recommendations.length) {
            return result;
        }
        
        // Извлекаем имена существующих технологий
        const existingTechNames = existingTech.map(t => t.name.toLowerCase());
        
        // Проверяем каждую предложенную технологию
        for (const techItem of suggestedTech.recommendations) {
            const techName = techItem.name.toLowerCase();
            result.compatibilityMatrix[techName] = {};
            
            for (const existingName of existingTechNames) {
                // Проверка по матрице известных совместимостей
                const compatibilityScore = getKnownCompatibility(existingName, techName);
                
                if (compatibilityScore !== 0) { // Если есть известная совместимость
                    result.compatibilityMatrix[techName][existingName] = {
                        score: compatibilityScore,
                        source: 'known_matrix'
                    };
                    
                    // Добавляем потенциальные проблемы, если есть несовместимость
                    if (compatibilityScore === -1) {
                        result.potentialIssues.push({
                            type: 'incompatibility',
                            tech1: techName,
                            tech2: existingName,
                            description: `${techName} обычно несовместим с ${existingName}`
                        });
                    }
                } else {
                    // Неизвестная совместимость - используем эвристики
                    const heuristicScore = calculateHeuristicCompatibility(existingName, techName, existingTech);
                    
                    result.compatibilityMatrix[techName][existingName] = {
                        score: heuristicScore,
                        source: 'heuristic'
                    };
                }
            }
        }
        
        // Вычисляем общую совместимость
        const allScores = [];
        for (const tech in result.compatibilityMatrix) {
            for (const existing in result.compatibilityMatrix[tech]) {
                allScores.push(result.compatibilityMatrix[tech][existing].score);
            }
        }
        
        // Если есть хотя бы одна несовместимость, общая оценка - низкая
        if (allScores.includes(-1)) {
            result.overallCompatibility = 'low';
        } else if (allScores.every(s => s >= 1)) {
            result.overallCompatibility = 'high';
        } else {
            result.overallCompatibility = 'medium';
        }
        
        // Если есть проблемы совместимости, запрашиваем дополнительные рекомендации через LLM
        if (result.potentialIssues.length > 0) {
            const additionalRecommendations = await getAlternativeRecommendations(
                existingTech, 
                suggestedTech,
                result.potentialIssues
            );
            
            if (additionalRecommendations && additionalRecommendations.length) {
                result.recommendations = additionalRecommendations;
            }
        }
        
        return result;
    } catch (error) {
        logger.error('Error analyzing tech compatibility', { error: error.message });
        return {
            compatibilityMatrix: {},
            overallCompatibility: 'unknown',
            potentialIssues: [],
            recommendations: []
        };
    }
}

/**
 * Получает известную совместимость между двумя технологиями из матрицы
 * 
 * @param {string} tech1 - Первая технология
 * @param {string} tech2 - Вторая технология
 * @returns {number} - Оценка совместимости (-1 до 2)
 */
function getKnownCompatibility(tech1, tech2) {
    // Нормализуем названия
    const t1 = tech1.toLowerCase().trim();
    const t2 = tech2.toLowerCase().trim();
    
    // Проверяем в обоих направлениях
    if (COMPATIBILITY_MATRIX[t1] && COMPATIBILITY_MATRIX[t1][t2] !== undefined) {
        return COMPATIBILITY_MATRIX[t1][t2];
    }
    
    if (COMPATIBILITY_MATRIX[t2] && COMPATIBILITY_MATRIX[t2][t1] !== undefined) {
        return COMPATIBILITY_MATRIX[t2][t1];
    }
    
    return 0; // Неизвестная совместимость
}

/**
 * Рассчитывает эвристическую совместимость между технологиями
 * 
 * @param {string} existingTech - Существующая технология
 * @param {string} newTech - Новая технология
 * @param {Array} allExistingTech - Все существующие технологии
 * @returns {number} - Эвристическая оценка совместимости
 */
function calculateHeuristicCompatibility(existingTech, newTech, allExistingTech) {
    // Получаем информацию о технологиях
    const existingInfo = techDatabase.getTechInfo(existingTech);
    const newInfo = techDatabase.getTechInfo(newTech);
    
    // Если нет информации о технологиях, предполагаем среднюю совместимость
    if (!existingInfo || !newInfo) {
        return 1;
    }
    
    // Технологии из одной категории могут конкурировать
    if (existingInfo.category === newInfo.category) {
        // Проверяем, является ли новая технология альтернативой существующей
        if (existingInfo.alternatives && existingInfo.alternatives.includes(newTech.toLowerCase())) {
            return -1; // Несовместимы, так как это альтернативы
        }
        
        // Проверяем, входит ли новая технология в экосистему существующей
        if (existingInfo.ecosystem && existingInfo.ecosystem.includes(newTech.toLowerCase())) {
            return 2; // Отлично совместимы, часть экосистемы
        }
        
        // По умолчанию для технологий одной категории считаем совместимость средней
        return 1;
    }
    
    // Технологии из разных категорий обычно хорошо совместимы
    return 1;
}

/**
 * Получает альтернативные рекомендации при обнаружении проблем совместимости
 * 
 * @param {Array} existingTech - Существующие технологии
 * @param {Object} suggestedTech - Предложенные технологии
 * @param {Array} issues - Выявленные проблемы
 * @returns {Promise<Array>} - Массив рекомендаций
 */
async function getAlternativeRecommendations(existingTech, suggestedTech, issues) {
    try {
        // Подготавливаем данные для промпта
        const existingTechStr = existingTech
            .map(t => `${t.name}${t.version ? ` (v${t.version})` : ''}`)
            .join(', ');
        
        const suggestedTechStr = suggestedTech.recommendations
            .map(t => t.name)
            .join(', ');
            
        const issuesStr = issues
            .map(i => `${i.tech1} и ${i.tech2}: ${i.description}`)
            .join('\n');
        
        // Запрашиваем рекомендации у LLM
        const prompt = await promptManager.getPrompt('tech-compatibility-recommendations', {
            existingTechnologies: existingTechStr,
            suggestedTechnologies: suggestedTechStr,
            compatibilityIssues: issuesStr,
            taskDescription: suggestedTech.taskDescription || ''
        });
        
        const response = await llmClient.sendPrompt(prompt, {
            temperature: 0.3
        });
        
        // Пытаемся извлечь структурированные рекомендации из ответа
        // Ожидаем, что LLM вернет массив рекомендаций в формате JSON
        try {
            // Поиск JSON в ответе
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                            response.match(/\{[\s\S]*\}/);
                            
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                return Array.isArray(parsed) ? parsed : (parsed.recommendations || []);
            }
            
            // Если не удалось распарсить JSON, разбиваем текст на пункты
            const textRecommendations = response
                .split(/\n\s*[\-\*]\s+/) // Разбиваем по маркерам списка
                .filter(item => item.trim().length > 0) // Убираем пустые строки
                .map(item => ({ text: item.trim() }));
                
            return textRecommendations.slice(1); // Пропускаем первый элемент (обычно заголовок)
        } catch (e) {
            logger.warn('Failed to parse LLM recommendations', { error: e.message });
            return [];
        }
    } catch (error) {
        logger.error('Error getting alternative recommendations', { error: error.message });
        return [];
    }
}

module.exports = {
    analyzeTechCompatibility
};
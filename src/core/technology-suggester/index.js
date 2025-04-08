/**
 * Модуль выбора технологий для реализации задач
 * Предоставляет интерфейс для взаимодействия с системой технологических рекомендаций
 */

const logger = require('../../utils/logger');
const promptManager = require('../../utils/prompt-manager');
const llmClient = require('../../utils/llm-client');
const techDatabase = require('./tech-database');
const compatibilityAnalyzer = require('./compatibility-analyzer');
const recommendationEngine = require('./recommendation-engine');

/**
 * Основная функция для получения рекомендаций по технологиям
 * 
 * @param {string} taskDescription - Описание задачи
 * @param {Object} projectContext - Контекст проекта (существующие технологии, зависимости и т.д.)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Объект с рекомендациями по технологиям
 */
async function suggestTechnologies(taskDescription, projectContext, options = {}) {
    try {
        logger.info('Starting technology suggestion process', { taskId: options.taskId });
        
        // 1. Анализ требований и классификация задачи
        const taskClassification = await classifyTask(taskDescription);
        logger.debug('Task classified', { 
            taskId: options.taskId,
            classification: taskClassification 
        });
        
        // 2. Сбор существующих технологий из контекста проекта
        const existingTech = await techDatabase.extractExistingTechnologies(projectContext);
        logger.debug('Extracted existing technologies', { 
            taskId: options.taskId, 
            techCount: existingTech.length 
        });
        
        // 3. Получение рекомендаций через LLM
        const suggestedTech = await recommendationEngine.generateRecommendations(
            taskDescription,
            taskClassification,
            existingTech,
            options
        );
        
        // 4. Анализ совместимости рекомендаций с существующими технологиями
        const compatibilityResults = await compatibilityAnalyzer.analyzeTechCompatibility(
            existingTech,
            suggestedTech
        );
        
        // 5. Формирование сравнения технологий (если необходимо)
        const comparison = options.generateComparison 
            ? await generateTechComparison({
                task: taskDescription,
                suggested: suggestedTech,
                compatibility: compatibilityResults,
                options
            }) 
            : null;
        
        // 6. Формирование итогового результата
        const result = {
            suggestedTechnologies: suggestedTech,
            compatibility: compatibilityResults,
            reasoning: suggestedTech.reasoning || null,
            comparison: comparison,
            existingTechnologies: existingTech
        };
        
        logger.info('Technology suggestion completed', { 
            taskId: options.taskId,
            suggestedCount: suggestedTech.recommendations?.length || 0 
        });
        
        return result;
    } catch (error) {
        logger.error('Error in technology suggestion process', { 
            taskId: options.taskId,
            error: error.message,
            stack: error.stack
        });
        throw new Error(`Failed to suggest technologies: ${error.message}`);
    }
}

/**
 * Классифицирует задачу для более точного подбора технологий
 * 
 * @param {string} taskDescription - Описание задачи
 * @returns {Promise<Object>} - Объект с классификацией задачи
 */
async function classifyTask(taskDescription) {
    const prompt = await promptManager.getPrompt('task-classification', {
        task: taskDescription
    });
    
    const response = await llmClient.sendPrompt(prompt, {
        temperature: 0.3, // Низкая температура для более детерминированных результатов
        structuredOutput: true, // Запрос на структурированный вывод
    });
    
    // Пробуем распарсить JSON из ответа, если LLM не поддерживает structuredOutput
    try {
        if (typeof response === 'string') {
            // Поиск JSON в ответе (если ответ содержит текст и JSON)
            const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                               response.match(/\{[\s\S]*\}/);
                               
            if (jsonMatch) {
                return JSON.parse(jsonMatch[1] || jsonMatch[0]);
            }
            return { type: 'unknown', confidence: 0, features: [] };
        }
        return response;
    } catch (e) {
        logger.warn('Failed to parse LLM response as JSON for task classification', { error: e.message });
        return { type: 'unknown', confidence: 0, features: [] };
    }
}

/**
 * Генерирует детальное сравнение предложенных технологий
 * 
 * @param {Object} options - Параметры для генерации сравнения
 * @returns {Promise<Object>} - Структурированное сравнение технологий
 */
async function generateTechComparison(options) {
    try {
        return await recommendationEngine.generateTechComparison(options);
    } catch (error) {
        logger.error('Error generating technology comparison', { error: error.message });
        return null;
    }
}

module.exports = {
    suggestTechnologies,
    generateTechComparison
};
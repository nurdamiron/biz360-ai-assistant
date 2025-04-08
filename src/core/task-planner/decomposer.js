// src/core/task-planner/decomposer.js
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const { getPromptTemplate } = require('../../utils');
const projectContext = require('../project-understanding');
const taskAnalyzer = require('./task-analyzer');

/**
 * Класс для декомпозиции задач с использованием AI
 */
class TaskDecomposer {
  /**
   * Декомпозиция задачи на подзадачи
   * @param {object} task - Объект задачи
   * @param {object} options - Дополнительные параметры
   * @returns {Promise<Array>} - Массив подзадач
   */
  async decomposeTask(task, options = {}) {
    logger.info(`Decomposing task ID: ${task.id}, title: ${task.title}`);
    
    try {
      // Шаг 1: Анализируем задачу для получения дополнительного контекста
      const taskAnalysis = await taskAnalyzer.analyzeTask(task);
      
      // Шаг 2: Получаем контекст проекта
      const { projectId } = task;
      const projectContextData = await projectContext.getContextForTask(task);
      
      // Шаг 3: Получаем шаблон промпта для декомпозиции
      const promptTemplate = await getPromptTemplate('task-decomposition');
      
      // Шаг 4: Формируем контекст для промпта
      const promptContext = {
        taskId: task.id,
        taskTitle: task.title,
        taskDescription: task.description,
        taskPriority: task.priority,
        projectContext: projectContextData,
        taskAnalysis,
        maxSubtasks: options.maxSubtasks || 10,
        preferredTechnologies: projectContextData.technologies || [],
        codeExamples: projectContextData.codeExamples || [],
        repositoryStructure: projectContextData.repositoryStructure || [],
        testingStrategy: projectContextData.testingStrategy || 'unit'
      };
      
      // Шаг 5: Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Шаг 6: Обрабатываем и валидируем ответ
      let subtasks = [];
      
      try {
        if (typeof response === 'string') {
          subtasks = JSON.parse(response).subtasks;
        } else if (response && response.subtasks) {
          subtasks = response.subtasks;
        } else {
          throw new Error('Invalid response format from LLM');
        }
        
        // Валидация полученных подзадач
        subtasks = subtasks.map((subtask, index) => ({
          title: subtask.title || `Subtask ${index + 1}`,
          description: subtask.description || '',
          estimatedHours: parseFloat(subtask.estimatedHours) || 1,
          priority: subtask.priority || 'medium',
          order: index,
          dependencies: subtask.dependencies || [],
          skills: subtask.skills || [],
          codeFiles: subtask.codeFiles || [],
          testCoverage: subtask.testCoverage || false
        }));
      } catch (parseError) {
        logger.error(`Error parsing LLM response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Если не удалось разобрать ответ, создаем одну общую подзадачу
        subtasks = [{
          title: 'Implement the task',
          description: `Failed to decompose task automatically. Original task: ${task.title}`,
          estimatedHours: 4,
          priority: 'medium',
          order: 0
        }];
      }
      
      logger.info(`Successfully decomposed task ID ${task.id} into ${subtasks.length} subtasks`);
      
      return subtasks;
    } catch (error) {
      logger.error(`Error decomposing task: ${error.message}`, {
        taskId: task.id,
        error: error.stack
      });
      
      // В случае ошибки возвращаем базовую декомпозицию
      return [{
        title: 'Implement the task',
        description: `Failed to decompose task automatically. Original task: ${task.title}. Error: ${error.message}`,
        estimatedHours: 4,
        priority: 'medium',
        order: 0
      }];
    }
  }

  /**
   * Оценка приоритетов и зависимостей между подзадачами
   * @param {Array} subtasks - Массив подзадач
   * @returns {Promise<Array>} - Массив подзадач с обновленными приоритетами
   */
  async prioritizeSubtasks(subtasks) {
    logger.info(`Prioritizing ${subtasks.length} subtasks`);
    
    // Если подзадач мало, возвращаем как есть
    if (subtasks.length <= 3) {
      return subtasks.map((subtask, index) => ({
        ...subtask,
        order: index
      }));
    }
    
    try {
      // Получаем шаблон промпта для приоритизации
      const promptTemplate = await getPromptTemplate('subtask-prioritization');
      
      // Формируем контекст для промпта
      const promptContext = {
        subtasks: subtasks.map(s => ({
          title: s.title,
          description: s.description,
          estimatedHours: s.estimatedHours,
          priority: s.priority,
          dependencies: s.dependencies,
          skills: s.skills
        }))
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let prioritizedSubtasks = [];
      
      try {
        if (typeof response === 'string') {
          prioritizedSubtasks = JSON.parse(response).subtasks;
        } else if (response && response.subtasks) {
          prioritizedSubtasks = response.subtasks;
        } else {
          throw new Error('Invalid response format from LLM');
        }
        
        // Объединяем результаты с оригинальными подзадачами
        const result = subtasks.map(original => {
          const prioritized = prioritizedSubtasks.find(p => p.title === original.title) || {};
          
          return {
            ...original,
            order: prioritized.order !== undefined ? prioritized.order : original.order,
            priority: prioritized.priority || original.priority,
            dependencies: prioritized.dependencies || original.dependencies
          };
        });
        
        // Сортируем по порядку
        return result.sort((a, b) => a.order - b.order);
      } catch (parseError) {
        logger.error(`Error parsing LLM prioritization response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Возвращаем оригинальные подзадачи
        return subtasks;
      }
    } catch (error) {
      logger.error(`Error prioritizing subtasks: ${error.message}`, {
        error: error.stack
      });
      
      // В случае ошибки возвращаем оригинальные подзадачи
      return subtasks;
    }
  }
}

module.exports = new TaskDecomposer();
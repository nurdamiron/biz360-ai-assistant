// src/core/task-planner/task-analyzer.js
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const { getPromptTemplate } = require('../../utils/prompt-utils');
const { Task, Comment } = require('../../models');

/**
 * Класс для анализа задач с использованием AI
 */
class TaskAnalyzer {
  /**
   * Анализ задачи для извлечения дополнительного контекста
   * @param {object} task - Объект задачи
   * @returns {Promise<object>} - Результат анализа
   */
  async analyzeTask(task) {
    logger.info(`Analyzing task ID: ${task.id}, title: ${task.title}`);
    
    try {
      // Получаем дополнительные данные о задаче
      const fullTask = await Task.findByPk(task.id, {
        include: [
          { 
            model: Comment,
            as: 'comments',
            attributes: ['content', 'created_at'],
            order: [['created_at', 'ASC']]
          }
        ]
      });
      
      if (!fullTask) {
        throw new Error(`Task with ID ${task.id} not found`);
      }
      
      // Получаем шаблон промпта для анализа задачи
      const promptTemplate = await getPromptTemplate('task-analysis');
      
      // Формируем контекст для промпта
      const promptContext = {
        taskId: fullTask.id,
        taskTitle: fullTask.title,
        taskDescription: fullTask.description,
        taskPriority: fullTask.priority,
        taskStatus: fullTask.status,
        taskCreatedAt: fullTask.created_at,
        comments: fullTask.comments.map(c => ({
          content: c.content,
          createdAt: c.created_at
        }))
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let analysis = {};
      
      try {
        if (typeof response === 'string') {
          analysis = JSON.parse(response);
        } else {
          analysis = response;
        }
      } catch (parseError) {
        logger.error(`Error parsing LLM task analysis response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Базовый анализ в случае ошибки
        analysis = {
          complexity: 'medium',
          requiredSkills: ['programming'],
          potentialChallenges: ['Understanding requirements'],
          estimatedEffort: 'medium',
          summary: task.description
        };
      }
      
      logger.info(`Successfully analyzed task ID ${task.id}`);
      
      return analysis;
    } catch (error) {
      logger.error(`Error analyzing task: ${error.message}`, {
        taskId: task.id,
        error: error.stack
      });
      
      // Базовый анализ в случае ошибки
      return {
        complexity: 'medium',
        requiredSkills: ['programming'],
        potentialChallenges: ['Understanding requirements'],
        estimatedEffort: 'medium',
        summary: task.description,
        error: error.message
      };
    }
  }

  /**
   * Определение требуемых технологий для задачи
   * @param {object} task - Объект задачи
   * @param {object} projectContext - Контекст проекта
   * @returns {Promise<Array>} - Список требуемых технологий
   */
  async identifyRequiredTechnologies(task, projectContext) {
    logger.info(`Identifying required technologies for task ID: ${task.id}`);
    
    try {
      // Получаем шаблон промпта
      const promptTemplate = await getPromptTemplate('technology-identification');
      
      // Формируем контекст для промпта
      const promptContext = {
        taskTitle: task.title,
        taskDescription: task.description,
        projectTechnologies: projectContext.technologies || [],
        repositoryStructure: projectContext.repositoryStructure || []
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let technologies = [];
      
      try {
        if (typeof response === 'string') {
          technologies = JSON.parse(response).technologies;
        } else if (response && response.technologies) {
          technologies = response.technologies;
        } else {
          throw new Error('Invalid response format from LLM');
        }
      } catch (parseError) {
        logger.error(`Error parsing LLM technology identification response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Возвращаем технологии проекта в случае ошибки
        technologies = projectContext.technologies || [];
      }
      
      logger.info(`Identified ${technologies.length} technologies for task ID ${task.id}`);
      
      return technologies;
    } catch (error) {
      logger.error(`Error identifying technologies: ${error.message}`, {
        taskId: task.id,
        error: error.stack
      });
      
      // Возвращаем технологии проекта в случае ошибки
      return projectContext.technologies || [];
    }
  }

  /**
   * Извлечение требований из описания задачи
   * @param {object} task - Объект задачи
   * @returns {Promise<object>} - Структурированные требования
   */
  async extractRequirements(task) {
    logger.info(`Extracting requirements for task ID: ${task.id}`);
    
    try {
      // Получаем шаблон промпта
      const promptTemplate = await getPromptTemplate('requirements-extraction');
      
      // Формируем контекст для промпта
      const promptContext = {
        taskTitle: task.title,
        taskDescription: task.description
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate, 
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let requirements = {
        functional: [],
        nonFunctional: [],
        constraints: []
      };
      
      try {
        if (typeof response === 'string') {
          requirements = JSON.parse(response);
        } else {
          requirements = response;
        }
      } catch (parseError) {
        logger.error(`Error parsing LLM requirements extraction response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Базовые требования в случае ошибки
        requirements = {
          functional: [task.description],
          nonFunctional: [],
          constraints: []
        };
      }
      
      logger.info(`Extracted requirements for task ID ${task.id}`);
      
      return requirements;
    } catch (error) {
      logger.error(`Error extracting requirements: ${error.message}`, {
        taskId: task.id,
        error: error.stack
      });
      
      // Базовые требования в случае ошибки
      return {
        functional: [task.description],
        nonFunctional: [],
        constraints: [],
        error: error.message
      };
    }
  }
}

module.exports = new TaskAnalyzer();
/**
 * @fileoverview Исполнитель шага "Понимание задачи" (Task Understanding).
 * Анализирует описание задачи, выделяет ключевые требования, определяет
 * тип задачи и выявляет возможные неоднозначности, используя LLM.
 */

const { StepExecutor } = require('../step-executor');
const logger = require('../../../utils/logger');
const { TaskUnderstandingResultSchema, StepInputSchema } = require('../contracts');

/**
 * Исполнитель шага "Понимание задачи".
 * @extends StepExecutor
 */
class TaskUnderstandingExecutor extends StepExecutor {
  /**
   * Получает метаданные шага.
   * @returns {Object} - Метаданные шага.
   */
  getMetadata() {
    return {
      name: 'taskUnderstanding',
      description: 'Analyzes task description, identifies requirements, and classifies task type',
      timeout: 60000, // 1 минута
      maxRetries: 3,
      requiresLLM: true,
      requiresGit: false,
      requiresExecution: false,
      inputSchema: StepInputSchema,
      outputSchema: TaskUnderstandingResultSchema
    };
  }

  /**
   * Выполняет шаг "Понимание задачи".
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} input - Входные данные для шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<Object>} - Результат выполнения шага.
   */
  async execute(taskId, input, context) {
    const startTime = Date.now();
    
    // Логируем начало выполнения шага
    this.logStepStart(taskId, input);
    
    try {
      // Валидируем входные данные
      const validationResult = this.validateInput(input);
      if (!validationResult.valid) {
        const error = `Invalid input: ${validationResult.errors.join(', ')}`;
        logger.error(`Step taskUnderstanding for task ${taskId} failed:`, error);
        
        return this.prepareBaseResult(false, error);
      }
      
      // Отправляем уведомление о начале анализа задачи
      await this.sendProgressNotification(
        taskId,
        25,
        'Analyzing task description'
      );
      
      // Получаем описание задачи из входных данных
      const taskDescription = input.task.description || '';
      const taskTitle = input.task.title || '';
      
      // Если нет описания задачи, возвращаем ошибку
      if (!taskDescription && !taskTitle) {
        const error = 'Task description and title are empty';
        logger.error(`Step taskUnderstanding for task ${taskId} failed:`, error);
        
        return this.prepareBaseResult(false, error);
      }
      
      // Выполняем анализ задачи с помощью LLM
      const taskAnalysis = await this._analyzeTask(taskTitle, taskDescription);
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        50,
        'Task analyzed, proceeding to classification'
      );
      
      // Классифицируем задачу с помощью LLM
      const taskClassification = await this._classifyTask(taskTitle, taskDescription, taskAnalysis);
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        75,
        'Task classified, preparing result'
      );
      
      // Подготавливаем результат
      const result = {
        ...this.prepareBaseResult(true),
        taskAnalysis,
        taskClassification,
        summary: {
          taskType: taskAnalysis.taskType,
          requirements: taskAnalysis.requirements.length,
          ambiguities: taskAnalysis.ambiguities ? taskAnalysis.ambiguities.length : 0,
          complexity: taskClassification.complexity,
          domain: taskClassification.domain
        }
      };
      
      // Валидируем результат
      const outputValidation = this.validateOutput(result);
      if (!outputValidation.valid) {
        const warning = `Output validation warnings: ${outputValidation.errors.join(', ')}`;
        logger.warn(`Step taskUnderstanding for task ${taskId} output validation:`, warning);
        
        result.warnings = result.warnings || [];
        result.warnings.push(warning);
      }
      
      // Добавляем длительность выполнения
      result.duration = Date.now() - startTime;
      
      // Логируем завершение выполнения шага
      this.logStepCompletion(taskId, result, result.duration);
      
      return result;
    } catch (error) {
      logger.error(`Step taskUnderstanding for task ${taskId} failed:`, error);
      
      const result = this.prepareBaseResult(false, error.message);
      result.duration = Date.now() - startTime;
      
      return result;
    }
  }

  /**
   * Анализирует задачу с помощью LLM.
   * @private
   * @param {string} taskTitle - Заголовок задачи.
   * @param {string} taskDescription - Описание задачи.
   * @returns {Promise<Object>} - Результат анализа задачи.
   */
  async _analyzeTask(taskTitle, taskDescription) {
    logger.debug('Analyzing task with LLM');
    
    try {
      // Проверяем, доступен ли клиент LLM
      if (!this.llmClient) {
        throw new Error('LLM client not available');
      }
      
      // Проверяем, доступен ли менеджер промптов
      if (!this.promptManager) {
        throw new Error('Prompt manager not available');
      }
      
      // Получаем промпт для анализа задачи
      const prompt = await this.promptManager.getPrompt('task-analysis.txt');
      
      if (!prompt) {
        throw new Error('Task analysis prompt not found');
      }
      
      // Подставляем данные в промпт
      const filledPrompt = prompt
        .replace('{task_title}', taskTitle)
        .replace('{task_description}', taskDescription);
      
      // Вызываем LLM для анализа задачи
      const response = await this.llmClient.generate({
        prompt: filledPrompt,
        max_tokens: 2000,
        temperature: 0.2,
        responseFormat: 'json'
      });
      
      // Обрабатываем ответ LLM
      let analysisResult;
      
      try {
        // Пытаемся распарсить JSON из ответа
        if (typeof response === 'string') {
          analysisResult = JSON.parse(response);
        } else if (response.text) {
          analysisResult = JSON.parse(response.text);
        } else if (response.choices && response.choices[0] && response.choices[0].text) {
          analysisResult = JSON.parse(response.choices[0].text);
        } else {
          throw new Error('Unexpected LLM response format');
        }
      } catch (parseError) {
        logger.error('Error parsing LLM response:', parseError);
        
        // Если не удалось распарсить JSON, пытаемся создать структуру вручную
        // Это может произойти, если LLM вернул неправильный формат
        
        // Ищем секцию с требованиями
        const requirementsMatch = response.match(/requirements:\s*\[(.*?)\]/is);
        const requirements = requirementsMatch
          ? requirementsMatch[1].split(',').map(r => r.trim().replace(/"/g, ''))
          : [];
        
        // Ищем тип задачи
        const taskTypeMatch = response.match(/taskType:\s*"([^"]*)"/i);
        const taskType = taskTypeMatch ? taskTypeMatch[1] : 'Unknown';
        
        // Ищем описание задачи
        const taskDescMatch = response.match(/taskDescription:\s*"([^"]*)"/i);
        const taskDescParsed = taskDescMatch ? taskDescMatch[1] : taskDescription;
        
        // Создаем структуру вручную
        analysisResult = {
          taskType,
          taskDescription: taskDescParsed,
          requirements
        };
      }
      
      // Проверяем, что все необходимые поля присутствуют
      if (!analysisResult.taskType) {
        analysisResult.taskType = 'Unknown';
      }
      
      if (!analysisResult.taskDescription) {
        analysisResult.taskDescription = taskDescription;
      }
      
      if (!analysisResult.requirements || !Array.isArray(analysisResult.requirements)) {
        analysisResult.requirements = [];
      }
      
      if (!analysisResult.acceptanceCriteria) {
        analysisResult.acceptanceCriteria = [];
      }
      
      if (!analysisResult.ambiguities) {
        analysisResult.ambiguities = [];
      }
      
      if (!analysisResult.clarificationQuestions) {
        analysisResult.clarificationQuestions = [];
      }
      
      return analysisResult;
    } catch (error) {
      logger.error('Error analyzing task with LLM:', error);
      
      // Возвращаем базовую структуру в случае ошибки
      return {
        taskType: 'Unknown',
        taskDescription: taskDescription,
        requirements: [],
        acceptanceCriteria: [],
        ambiguities: [],
        clarificationQuestions: []
      };
    }
  }

  /**
   * Классифицирует задачу с помощью LLM.
   * @private
   * @param {string} taskTitle - Заголовок задачи.
   * @param {string} taskDescription - Описание задачи.
   * @param {Object} taskAnalysis - Результат анализа задачи.
   * @returns {Promise<Object>} - Результат классификации задачи.
   */
  async _classifyTask(taskTitle, taskDescription, taskAnalysis) {
    logger.debug('Classifying task with LLM');
    
    try {
      // Проверяем, доступен ли клиент LLM
      if (!this.llmClient) {
        throw new Error('LLM client not available');
      }
      
      // Проверяем, доступен ли менеджер промптов
      if (!this.promptManager) {
        throw new Error('Prompt manager not available');
      }
      
      // Получаем промпт для классификации задачи
      const prompt = await this.promptManager.getPrompt('task-classification.txt');
      
      if (!prompt) {
        throw new Error('Task classification prompt not found');
      }
      
      // Подготавливаем данные для промпта
      const requirements = taskAnalysis.requirements.join('\n- ');
      
      // Подставляем данные в промпт
      const filledPrompt = prompt
        .replace('{task_title}', taskTitle)
        .replace('{task_description}', taskDescription)
        .replace('{task_type}', taskAnalysis.taskType)
        .replace('{requirements}', requirements);
      
      // Вызываем LLM для классификации задачи
      const response = await this.llmClient.generate({
        prompt: filledPrompt,
        max_tokens: 1000,
        temperature: 0.3,
        responseFormat: 'json'
      });
      
      // Обрабатываем ответ LLM
      let classificationResult;
      
      try {
        // Пытаемся распарсить JSON из ответа
        if (typeof response === 'string') {
          classificationResult = JSON.parse(response);
        } else if (response.text) {
          classificationResult = JSON.parse(response.text);
        } else if (response.choices && response.choices[0] && response.choices[0].text) {
          classificationResult = JSON.parse(response.choices[0].text);
        } else {
          throw new Error('Unexpected LLM response format');
        }
      } catch (parseError) {
        logger.error('Error parsing LLM response:', parseError);
        
        // Если не удалось распарсить JSON, пытаемся создать структуру вручную
        // Это может произойти, если LLM вернул неправильный формат
        
        // Ищем сложность задачи
        const complexityMatch = response.match(/complexity:\s*"([^"]*)"/i);
        const complexity = complexityMatch ? complexityMatch[1] : 'medium';
        
        // Ищем домен задачи
        const domainMatch = response.match(/domain:\s*"([^"]*)"/i);
        const domain = domainMatch ? domainMatch[1] : 'general';
        
        // Ищем технический стек
        const techStackMatch = response.match(/techStack:\s*\[(.*?)\]/is);
        const techStack = techStackMatch
          ? techStackMatch[1].split(',').map(t => t.trim().replace(/"/g, ''))
          : [];
        
        // Создаем структуру вручную
        classificationResult = {
          complexity,
          domain,
          techStack
        };
      }
      
      // Проверяем, что все необходимые поля присутствуют
      if (!classificationResult.complexity) {
        classificationResult.complexity = 'medium';
      }
      
      if (!classificationResult.domain) {
        classificationResult.domain = 'general';
      }
      
      if (!classificationResult.techStack || !Array.isArray(classificationResult.techStack)) {
        classificationResult.techStack = [];
      }
      
      return classificationResult;
    } catch (error) {
      logger.error('Error classifying task with LLM:', error);
      
      // Возвращаем базовую структуру в случае ошибки
      return {
        complexity: 'medium',
        domain: 'general',
        techStack: []
      };
    }
  }
}

module.exports = TaskUnderstandingExecutor;
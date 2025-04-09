/**
 * @fileoverview Context Manager отвечает за управление контекстом выполнения задачи.
 * Контекст включает в себя все данные, необходимые для выполнения шагов методологии,
 * такие как информация о задаче, проекте, сгенерированном коде, результатах тестов и т.д.
 * ContextManager обеспечивает доступ к этим данным для всех компонентов системы,
 * в частности для StepExecutor.
 */

const { ValidationManager } = require('./validation-manager');
const logger = require('../../utils/logger');
const { ContextSchema } = require('./contracts');

/**
 * Класс управления контекстом выполнения задачи.
 */
class ContextManager {
  /**
   * Создает экземпляр ContextManager.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.db - Интерфейс к базе данных (для персистентного хранения).
   * @param {Object} options.cache - Интерфейс к кэшу (для временного хранения).
   */
  constructor({ db, cache } = {}) {
    this.db = db;
    this.cache = cache;
    this.validator = new ValidationManager();
    this.inMemoryContexts = new Map(); // Для временного хранения контекстов в памяти
  }

  /**
   * Инициализирует новый контекст для задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} initialData - Начальные данные для контекста.
   * @returns {Promise<Object>} - Созданный контекст.
   */
  async initializeContext(taskId, initialData = {}) {
    logger.info(`Initializing context for task: ${taskId}`);
    
    // Базовая структура контекста
    const context = {
      taskId,
      projectId: initialData.projectId,
      createdAt: new Date(),
      updatedAt: new Date(),
      // Метаданные задачи
      task: {
        title: initialData.task?.title || '',
        description: initialData.task?.description || '',
        type: initialData.task?.type || '',
        priority: initialData.task?.priority || 'medium',
      },
      // Результаты по шагам
      stepResults: {},
      // Текущий статус выполнения
      currentState: 'initialized',
      // История выполнения
      history: [
        {
          timestamp: new Date(),
          state: 'initialized',
          message: 'Context initialized',
        },
      ],
      // Данные для передачи между шагами
      data: initialData.data || {},
    };

    // Валидация контекста
    const validationResult = this.validator.validate(context, ContextSchema);
    if (!validationResult.valid) {
      logger.error(`Invalid context for task ${taskId}:`, validationResult.errors);
      throw new Error(`Failed to initialize context: ${validationResult.errors.join(', ')}`);
    }

    // Сохраняем контекст
    await this._saveContext(taskId, context);
    
    return context;
  }

  /**
   * Получает контекст задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Object>} - Контекст задачи.
   */
  async getContext(taskId) {
    logger.debug(`Getting context for task: ${taskId}`);
    
    // Сначала проверяем в памяти
    if (this.inMemoryContexts.has(taskId)) {
      return this.inMemoryContexts.get(taskId);
    }
    
    // Затем проверяем в кэше, если он доступен
    if (this.cache) {
      const cachedContext = await this.cache.get(`context:${taskId}`);
      if (cachedContext) {
        this.inMemoryContexts.set(taskId, cachedContext);
        return cachedContext;
      }
    }
    
    // Наконец, загружаем из БД
    if (this.db) {
      const dbContext = await this.db.TaskContext.findOne({
        where: { taskId }
      });
      
      if (dbContext) {
        const context = typeof dbContext.context === 'string' 
          ? JSON.parse(dbContext.context) 
          : dbContext.context;
        
        this.inMemoryContexts.set(taskId, context);
        
        // Обновляем кэш, если он доступен
        if (this.cache) {
          await this.cache.set(`context:${taskId}`, context);
        }
        
        return context;
      }
    }
    
    logger.error(`Context not found for task: ${taskId}`);
    throw new Error(`Context not found for task: ${taskId}`);
  }

  /**
   * Обновляет часть контекста задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} path - Путь к обновляемому свойству (например, 'task.title' или 'stepResults.taskUnderstanding').
   * @param {*} value - Новое значение.
   * @returns {Promise<Object>} - Обновленный контекст.
   */
  async updateContext(taskId, path, value) {
    logger.debug(`Updating context for task: ${taskId}, path: ${path}`);
    
    const context = await this.getContext(taskId);
    if (!context) {
      throw new Error(`Context not found for task: ${taskId}`);
    }
    
    // Обновляем контекст по указанному пути
    const pathParts = path.split('.');
    let current = context;
    
    // Проходим по всем частям пути кроме последней
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }
    
    // Устанавливаем значение для последней части пути
    const lastPart = pathParts[pathParts.length - 1];
    current[lastPart] = value;
    
    // Обновляем timestamp
    context.updatedAt = new Date();
    
    // Валидация контекста
    const validationResult = this.validator.validate(context, ContextSchema);
    if (!validationResult.valid) {
      logger.error(`Invalid context after update for task ${taskId}:`, validationResult.errors);
      throw new Error(`Failed to update context: ${validationResult.errors.join(', ')}`);
    }
    
    // Сохраняем обновленный контекст
    await this._saveContext(taskId, context);
    
    return context;
  }

  /**
   * Добавляет результат выполнения шага в контекст.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Object} result - Результат выполнения шага.
   * @returns {Promise<Object>} - Обновленный контекст.
   */
  async addStepResult(taskId, stepName, result) {
    logger.info(`Adding result for step ${stepName} to task ${taskId}`);
    
    // Получаем текущий контекст
    const context = await this.getContext(taskId);
    
    // Добавляем результат шага
    context.stepResults = {
      ...context.stepResults,
      [stepName]: result
    };
    
    // Обновляем timestamp
    context.updatedAt = new Date();
    
    // Добавляем запись в историю
    context.history.push({
      timestamp: new Date(),
      state: `completed_${stepName}`,
      message: `Step ${stepName} completed`,
    });
    
    // Валидация контекста
    const validationResult = this.validator.validate(context, ContextSchema);
    if (!validationResult.valid) {
      logger.error(`Invalid context after adding step result for task ${taskId}:`, validationResult.errors);
      throw new Error(`Failed to add step result: ${validationResult.errors.join(', ')}`);
    }
    
    // Сохраняем обновленный контекст
    await this._saveContext(taskId, context);
    
    return context;
  }

  /**
   * Обновляет состояние задачи в контексте.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} state - Новое состояние.
   * @param {string} message - Сообщение о смене состояния.
   * @returns {Promise<Object>} - Обновленный контекст.
   */
  async updateState(taskId, state, message = '') {
    logger.info(`Updating state for task ${taskId} to ${state}`);
    
    // Получаем текущий контекст
    const context = await this.getContext(taskId);
    
    // Обновляем состояние
    context.currentState = state;
    
    // Добавляем запись в историю
    context.history.push({
      timestamp: new Date(),
      state,
      message: message || `State changed to ${state}`,
    });
    
    // Обновляем timestamp
    context.updatedAt = new Date();
    
    // Валидация контекста
    const validationResult = this.validator.validate(context, ContextSchema);
    if (!validationResult.valid) {
      logger.error(`Invalid context after state update for task ${taskId}:`, validationResult.errors);
      throw new Error(`Failed to update state: ${validationResult.errors.join(', ')}`);
    }
    
    // Сохраняем обновленный контекст
    await this._saveContext(taskId, context);
    
    return context;
  }

  /**
   * Сохраняет контекст задачи в хранилище.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<void>}
   */
  async _saveContext(taskId, context) {
    // Обновляем в памяти
    this.inMemoryContexts.set(taskId, context);
    
    // Обновляем в кэше, если он доступен
    if (this.cache) {
      await this.cache.set(`context:${taskId}`, context);
    }
    
    // Сохраняем в БД, если она доступна
    if (this.db) {
      await this.db.TaskContext.upsert({
        taskId,
        context: JSON.stringify(context),
        updatedAt: new Date()
      });
    }
  }

  /**
   * Очищает контекст задачи из памяти (но не из БД).
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<boolean>} - Результат операции.
   */
  async clearFromMemory(taskId) {
    logger.debug(`Clearing context from memory for task: ${taskId}`);
    
    this.inMemoryContexts.delete(taskId);
    
    // Очищаем из кэша, если он доступен
    if (this.cache) {
      await this.cache.delete(`context:${taskId}`);
    }
    
    return true;
  }
}

module.exports = { ContextManager };
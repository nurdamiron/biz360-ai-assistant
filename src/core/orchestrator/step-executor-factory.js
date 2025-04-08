// src/core/orchestrator/step-executor-factory.js

const logger = require('../../utils/logger');

/**
 * Фабрика для создания исполнителей шагов
 */
class StepExecutorFactory {
  constructor() {
    // Кэш для хранения инстансов исполнителей
    this.executorCache = new Map();
    
    // Маппинг номеров шагов на классы исполнителей
    this.executorMapping = {
      1: () => require('./step-executors/task-understanding-executor'),
      2: () => require('./step-executors/project-context-executor'),
      3: () => require('./step-executors/planning-executor'),
      4: () => require('./step-executors/technology-selection-executor'),
      5: () => require('./step-executors/code-generation-executor'),
      6: () => require('./step-executors/code-refinement-executor'),
      7: () => require('./step-executors/code-review-executor'),
      8: () => require('./step-executors/error-correction-executor'),
      9: () => require('./step-executors/test-generation-executor'),
      10: () => require('./step-executors/code-execution-executor'),
      11: () => require('./step-executors/test-analysis-executor'),
      12: () => require('./step-executors/documentation-executor'),
      13: () => require('./step-executors/knowledge-update-executor'),
      14: () => require('./step-executors/pull-request-executor'),
      15: () => require('./step-executors/feedback-integration-executor'),
      16: () => require('./step-executors/user-interaction-executor')
    };
  }

  /**
   * Создание исполнителя для указанного шага
   * @param {number} stepNumber - Номер шага (1-16)
   * @returns {StepExecutor} - Исполнитель шага
   * @throws {Error} - Если шаг не найден
   */
  createExecutor(stepNumber) {
    // Проверяем наличие в кэше
    if (this.executorCache.has(stepNumber)) {
      return this.executorCache.get(stepNumber);
    }
    
    // Проверяем существование исполнителя для шага
    if (!this.executorMapping[stepNumber]) {
      throw new Error(`No executor found for step ${stepNumber}`);
    }
    
    try {
      // Загружаем класс исполнителя
      const ExecutorClass = this.executorMapping[stepNumber]();
      
      // Создаем экземпляр
      const executor = new ExecutorClass();
      
      // Кэшируем для будущего использования
      this.executorCache.set(stepNumber, executor);
      
      return executor;
    } catch (error) {
      logger.error(`Error creating executor for step ${stepNumber}: ${error.message}`, {
        stepNumber,
        error
      });
      throw new Error(`Failed to create executor for step ${stepNumber}: ${error.message}`);
    }
  }

  /**
   * Получение списка всех исполнителей
   * @returns {Array<StepExecutor>} - Массив исполнителей
   */
  getAllExecutors() {
    const executors = [];
    
    for (let step = 1; step <= 16; step++) {
      try {
        executors.push(this.createExecutor(step));
      } catch (error) {
        logger.warn(`Could not create executor for step ${step}: ${error.message}`);
      }
    }
    
    return executors;
  }

  /**
   * Получение информации о зависимостях между шагами
   * @returns {Object} - Граф зависимостей
   */
  getDependencyGraph() {
    const graph = {};
    
    // Получаем все исполнители
    const executors = this.getAllExecutors();
    
    // Строим граф зависимостей
    for (const executor of executors) {
      const stepNumber = executor.constructor.stepNumber;
      const dependencies = executor.getDependencies();
      
      graph[stepNumber] = dependencies;
    }
    
    return graph;
  }

  /**
   * Очистка кэша исполнителей
   */
  clearCache() {
    this.executorCache.clear();
  }
}

module.exports = StepExecutorFactory;


// src/core/orchestrator/transition-manager.js

const logger = require('../../utils/logger');
const { Transition } = require('../../models');
const StepExecutorFactory = require('./step-executor-factory');

/**
 * Менеджер переходов между шагами
 * Отвечает за определение следующего шага и запись истории переходов
 */
class TransitionManager {
  constructor() {
    this.stepExecutorFactory = new StepExecutorFactory();
  }

  /**
   * Определение следующего шага на основе текущего шага, контекста и результата
   * @param {number} currentStep - Текущий шаг
   * @param {object} context - Контекст задачи
   * @param {object} result - Результат выполнения текущего шага
   * @returns {Promise<number|null>} - Номер следующего шага или null, если это последний шаг
   */
  async getNextStep(currentStep, context, result) {
    // Простая реализация: переход к следующему шагу
    // В реальности здесь может быть сложная логика принятия решений
    
    // Если это последний шаг, возвращаем null
    if (currentStep >= 16) {
      return null;
    }
    
    // Проверяем, может ли быть выполнен следующий шаг
    const nextStep = currentStep + 1;
    const executor = this.stepExecutorFactory.createExecutor(nextStep);
    
    if (await executor.canExecute(context)) {
      return nextStep;
    }
    
    // Если следующий шаг не может быть выполнен, ищем альтернативный путь
    return this.findAlternativeStep(nextStep, context);
  }

  /**
   * Поиск альтернативного шага, если текущий не может быть выполнен
   * @param {number} currentStep - Текущий шаг
   * @param {object} context - Контекст задачи
   * @returns {Promise<number|null>} - Номер альтернативного шага или null
   */
  async findAlternativeStep(currentStep, context) {
    // Начинаем поиск с шага после текущего
    for (let step = currentStep + 1; step <= 16; step++) {
      const executor = this.stepExecutorFactory.createExecutor(step);
      
      if (await executor.canExecute(context)) {
        logger.info(`Found alternative step ${step} for step ${currentStep}`);
        return step;
      }
    }
    
    // Если не нашли шаг после текущего, проверяем завершение задачи
    if (this._canCompleteTask(context)) {
      logger.info(`No alternative steps found, but task can be completed`);
      return null; // null означает завершение задачи
    }
    
    // Если не можем ни продолжить, ни завершить задачу
    logger.warn(`No valid next steps found for step ${currentStep}`);
    return null;
  }

  /**
   * Проверка возможности завершения задачи (пропуск оставшихся шагов)
   * @param {object} context - Контекст задачи
   * @returns {boolean} - true, если задача может быть завершена
   * @private
   */
  _canCompleteTask(context) {
    // Здесь логика определения, можно ли считать задачу завершенной
    // даже если некоторые шаги не выполнены
    
    // Пример: если есть сгенерированный код и он прошел тесты,
    // то можно пропустить документацию, обучение и т.д.
    
    const hasGeneratedCode = !!(context.generatedCode || context.refinedCode);
    const hasPassedTests = context.testResults && context.testResults.passed;
    
    return hasGeneratedCode && hasPassedTests;
  }

  /**
   * Запись перехода между шагами
   * @param {string} taskId - ID задачи
   * @param {number} fromStep - Исходный шаг
   * @param {number|null} toStep - Целевой шаг (null означает завершение задачи)
   * @param {string} trigger - Причина перехода ('auto', 'manual', 'error', 'retry', 'rollback', 'alternative_path', 'alternative_on_error')
   * @returns {Promise<object>} - Созданный объект перехода
   */
  async recordTransition(taskId, fromStep, toStep, trigger) {
    try {
      const transition = await Transition.create({
        taskId,
        fromStep,
        toStep,
        trigger,
        timestamp: new Date(),
        metadata: {} // Можно добавить дополнительные метаданные
      });
      
      logger.debug(`Recorded transition for task ${taskId}: ${fromStep} -> ${toStep} (${trigger})`);
      return transition;
    } catch (error) {
      logger.error(`Error recording transition: ${error.message}`, {
        taskId,
        fromStep,
        toStep,
        trigger,
        error
      });
      
      // Не выбрасываем ошибку, чтобы не прерывать основной процесс
      return null;
    }
  }

  /**
   * Получение истории переходов для задачи
   * @param {string} taskId - ID задачи
   * @returns {Promise<Array>} - История переходов
   */
  async getTransitionHistory(taskId) {
    try {
      const transitions = await Transition.findAll({
        where: { taskId },
        order: [['timestamp', 'ASC']]
      });
      
      return transitions;
    } catch (error) {
      logger.error(`Error getting transition history: ${error.message}`, {
        taskId,
        error
      });
      return [];
    }
  }

  /**
   * Проверка допустимости перехода между шагами
   * @param {number} fromStep - Исходный шаг
   * @param {number} toStep - Целевой шаг
   * @returns {boolean} - true, если переход допустим
   */
  isValidTransition(fromStep, toStep) {
    // Простая проверка: шаги должны быть в допустимом диапазоне
    if (fromStep < 1 || fromStep > 16 || toStep < 1 || toStep > 16) {
      return false;
    }
    
    // Можно добавить дополнительные правила:
    // - Некоторые шаги могут иметь зависимости
    // - Некоторые переходы могут быть запрещены
    
    // Пример: запрет перехода от генерации кода сразу к PR
    if (fromStep === 5 && toStep === 14) {
      return false;
    }
    
    return true;
  }
}

module.exports = TransitionManager;


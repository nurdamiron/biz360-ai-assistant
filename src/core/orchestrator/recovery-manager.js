// src/core/orchestrator/recovery-manager.js

const logger = require('../../utils/logger');

/**
 * Менеджер восстановления после сбоев
 * Отвечает за стратегии обработки ошибок и восстановления выполнения
 */
class RecoveryManager {
  /**
   * Создание менеджера восстановления
   * @param {object} options - Опции
   * @param {number} options.maxRetries - Максимальное количество повторных попыток
   */
  constructor(options = {}) {
    this.options = {
      maxRetries: 3,
      ...options
    };
    
    // Хранение информации о повторных попытках
    this.retryAttempts = new Map();
  }

  /**
   * Обработка ошибки выполнения шага
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @param {Error} error - Ошибка
   * @param {object} context - Контекст задачи
   * @returns {Promise<object>} - Стратегия восстановления
   *   {
   *     action: 'retry' | 'rollback' | 'alternative' | 'abort',
   *     targetStep: number, // Для rollback и alternative
   *     attempts: number // Для retry
   *   }
   */
  async handleStepFailure(taskId, stepNumber, error, context) {
    try {
      logger.info(`Handling failure for step ${stepNumber} of task ${taskId}`, {
        error: error.message
      });
      
      // Получение ключа для отслеживания попыток
      const retryKey = `${taskId}:${stepNumber}`;
      
      // Инкрементируем счетчик попыток или инициализируем его
      const attempts = (this.retryAttempts.get(retryKey) || 0) + 1;
      this.retryAttempts.set(retryKey, attempts);
      
      // Анализируем ошибку для определения стратегии восстановления
      const errorType = this._categorizeError(error);
      
      // Определяем стратегию на основе типа ошибки и количества попыток
      switch (errorType) {
        case 'retryable': 
          // Ошибка, которую можно исправить повторной попыткой
          if (attempts <= this.options.maxRetries) {
            logger.info(`Retrying step ${stepNumber} (attempt ${attempts}/${this.options.maxRetries})`);
            return {
              action: 'retry',
              attempts
            };
          }
          // Если превысили количество попыток, пробуем откатиться
          logger.warn(`Max retry attempts (${this.options.maxRetries}) exceeded for step ${stepNumber}`);
          return this._determineRollbackStrategy(stepNumber, error, context);
          
        case 'contextual':
          // Ошибка, связанная с контекстом (недостаточно данных)
          // Пробуем альтернативный путь или откат
          return this._determineAlternativeStrategy(taskId, stepNumber, context);
          
        case 'logical':
          // Логическая ошибка в выполнении шага
          // Откатываемся к предыдущему шагу
          return this._determineRollbackStrategy(stepNumber, error, context);
          
        case 'fatal':
        default:
          // Критическая ошибка, которую нельзя исправить
          logger.error(`Fatal error in step ${stepNumber}: ${error.message}`);
          return {
            action: 'abort'
          };
      }
    } catch (recoveryError) {
      // Если произошла ошибка в самом механизме восстановления
      logger.error(`Error in recovery process: ${recoveryError.message}`, {
        taskId,
        stepNumber,
        originalError: error.message,
        recoveryError
      });
      
      // В случае ошибки восстановления прерываем выполнение
      return {
        action: 'abort'
      };
    }
  }

  /**
   * Категоризация ошибки для определения стратегии восстановления
   * @param {Error} error - Ошибка
   * @returns {string} - Тип ошибки ('retryable', 'contextual', 'logical', 'fatal')
   * @private
   */
  _categorizeError(error) {
    // Анализируем сообщение об ошибке и стек вызовов
    const errorMessage = error.message.toLowerCase();
    
    // Ошибки, которые можно исправить повторной попыткой
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('temporarily unavailable') ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    ) {
      return 'retryable';
    }
    
    // Ошибки, связанные с контекстом
    if (
      errorMessage.includes('missing context') ||
      errorMessage.includes('insufficient data') ||
      errorMessage.includes('not found') ||
      errorMessage.includes('undefined')
    ) {
      return 'contextual';
    }
    
    // Логические ошибки
    if (
      errorMessage.includes('validation failed') ||
      errorMessage.includes('invalid input') ||
      errorMessage.includes('syntax error') ||
      errorMessage.includes('cannot parse')
    ) {
      return 'logical';
    }
    
    // По умолчанию считаем ошибку фатальной
    return 'fatal';
  }

  /**
   * Определение стратегии отката
   * @param {number} stepNumber - Номер шага
   * @param {Error} error - Ошибка
   * @param {object} context - Контекст задачи
   * @returns {object} - Стратегия отката
   * @private
   */
  _determineRollbackStrategy(stepNumber, error, context) {
    // Если это первый шаг, некуда откатываться
    if (stepNumber <= 1) {
      logger.error(`Cannot rollback from step 1, aborting task`);
      return {
        action: 'abort'
      };
    }
    
    // По умолчанию откатываемся на шаг назад
    const targetStep = stepNumber - 1;
    
    logger.info(`Rolling back from step ${stepNumber} to step ${targetStep}`);
    
    return {
      action: 'rollback',
      targetStep
    };
  }

  /**
   * Определение альтернативного пути выполнения
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @param {object} context - Контекст задачи
   * @returns {object} - Стратегия альтернативного пути
   * @private
   */
  async _determineAlternativeStrategy(taskId, stepNumber, context) {
    // Пытаемся найти альтернативный шаг после текущего
    for (let step = stepNumber + 1; step <= 16; step++) {
      // Здесь должна быть логика проверки возможности выполнения шага
      // Используем заглушку для примера
      const canExecuteStep = await this._canExecuteStep(step, context);
      
      if (canExecuteStep) {
        logger.info(`Found alternative path: step ${stepNumber} -> step ${step}`);
        return {
          action: 'alternative',
          targetStep: step
        };
      }
    }
    
    // Если альтернативы нет, пробуем откатиться
    return this._determineRollbackStrategy(stepNumber, new Error('No alternative path found'), context);
  }

  /**
   * Проверка возможности выполнения шага (заглушка)
   * @param {number} stepNumber - Номер шага
   * @param {object} context - Контекст задачи
   * @returns {Promise<boolean>} - true, если шаг может быть выполнен
   * @private
   */
  async _canExecuteStep(stepNumber, context) {
    // Заглушка для примера
    // В реальной реализации здесь должно быть обращение к соответствующему исполнителю
    const StepExecutorFactory = require('./step-executor-factory');
    const factory = new StepExecutorFactory();
    const executor = factory.createExecutor(stepNumber);
    
    return executor.canExecute(context);
  }

  /**
   * Сброс счетчика попыток для шага
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   */
  resetRetryAttempts(taskId, stepNumber) {
    const retryKey = `${taskId}:${stepNumber}`;
    this.retryAttempts.delete(retryKey);
  }

  /**
   * Получение количества попыток для шага
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @returns {number} - Количество попыток
   */
  getRetryAttempts(taskId, stepNumber) {
    const retryKey = `${taskId}:${stepNumber}`;
    return this.retryAttempts.get(retryKey) || 0;
  }
}

module.exports = RecoveryManager;
/**
 * @fileoverview Определяет базовый абстрактный класс для всех исполнителей шагов
 * методологии. Все конкретные исполнители должны наследоваться от этого класса
 * и реализовывать метод execute().
 */

const logger = require('../../utils/logger');
const { ValidationManager } = require('./validation-manager');

/**
 * Базовый абстрактный класс для всех исполнителей шагов.
 */
class StepExecutor {
  /**
   * Создает экземпляр StepExecutor.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.contextManager - Экземпляр ContextManager.
   * @param {Object} options.stateManager - Экземпляр StateManager.
   * @param {Object} options.notificationManager - Экземпляр NotificationManager.
   * @param {Object} options.db - Интерфейс к базе данных.
   * @param {Object} options.llmClient - Клиент для взаимодействия с LLM.
   * @param {Object} options.promptManager - Менеджер промптов.
   */
  constructor({
    contextManager,
    stateManager,
    notificationManager,
    db,
    llmClient,
    promptManager
  } = {}) {
    // Проверяем, что класс не инстанцируется напрямую
    if (new.target === StepExecutor) {
      throw new TypeError('Cannot construct StepExecutor instances directly');
    }
    
    this.contextManager = contextManager;
    this.stateManager = stateManager;
    this.notificationManager = notificationManager;
    this.db = db;
    this.llmClient = llmClient;
    this.promptManager = promptManager;
    
    // Создаем валидатор
    this.validator = new ValidationManager();
    
    // Инициализируем метаданные шага
    this.metadata = this.getMetadata();
  }

  /**
   * Получает метаданные шага.
   * @returns {Object} - Метаданные шага.
   */
  getMetadata() {
    return {
      name: 'abstract',
      description: 'Abstract step executor',
      timeout: 60000, // 1 минута по умолчанию
      maxRetries: 3,
      requiresLLM: false,
      requiresGit: false,
      requiresExecution: false,
      inputSchema: null,
      outputSchema: null
    };
  }

  /**
   * Выполняет шаг методологии.
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} input - Входные данные для шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<Object>} - Результат выполнения шага.
   */
  async execute(taskId, input, context) {
    throw new Error('Method execute() must be implemented by derived classes');
  }

  /**
   * Валидирует входные данные шага.
   * @param {Object} input - Входные данные для шага.
   * @returns {Object} - Результат валидации.
   */
  validateInput(input) {
    if (!this.metadata.inputSchema) {
      return { valid: true };
    }
    
    return this.validator.validate(input, this.metadata.inputSchema);
  }

  /**
   * Валидирует результат выполнения шага.
   * @param {Object} result - Результат выполнения шага.
   * @returns {Object} - Результат валидации.
   */
  validateOutput(result) {
    if (!this.metadata.outputSchema) {
      return { valid: true };
    }
    
    return this.validator.validate(result, this.metadata.outputSchema);
  }

  /**
   * Подготавливает базовый результат выполнения шага.
   * @param {boolean} success - Флаг успешности выполнения.
   * @param {string} [error=null] - Сообщение об ошибке (если есть).
   * @param {Array<string>} [warnings=[]] - Предупреждения.
   * @returns {Object} - Базовый результат.
   */
  prepareBaseResult(success, error = null, warnings = []) {
    return {
      success,
      error,
      warnings,
      timestamp: new Date(),
      duration: 0 // Будет заполнено позже
    };
  }

  /**
   * Логирует начало выполнения шага.
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} input - Входные данные для шага.
   */
  logStepStart(taskId, input) {
    logger.info(`Starting step ${this.metadata.name} for task ${taskId}`);
    logger.debug(`Step ${this.metadata.name} input:`, JSON.stringify(input));
  }

  /**
   * Логирует завершение выполнения шага.
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} result - Результат выполнения шага.
   * @param {number} duration - Длительность выполнения в миллисекундах.
   */
  logStepCompletion(taskId, result, duration) {
    if (result.success) {
      logger.info(`Step ${this.metadata.name} completed successfully for task ${taskId} in ${duration}ms`);
    } else {
      logger.error(`Step ${this.metadata.name} failed for task ${taskId}: ${result.error}`);
    }
    
    if (result.warnings && result.warnings.length > 0) {
      logger.warn(`Step ${this.metadata.name} warnings for task ${taskId}:`, result.warnings);
    }
  }

  /**
   * Отправляет уведомление о прогрессе выполнения шага.
   * @param {string} taskId - Идентификатор задачи.
   * @param {number} progress - Процент выполнения (0-100).
   * @param {string} message - Сообщение о прогрессе.
   * @returns {Promise<void>}
   */
  async sendProgressNotification(taskId, progress, message) {
    if (this.notificationManager) {
      await this.notificationManager.sendProgress(
        taskId,
        progress,
        message,
        {
          data: {
            step: this.metadata.name
          }
        }
      );
    }
  }
}

module.exports = { StepExecutor };
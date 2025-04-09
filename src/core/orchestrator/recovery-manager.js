/**
 * @fileoverview Recovery Manager отвечает за обработку ошибок и восстановление
 * после сбоев в процессе выполнения задачи. Он определяет стратегии повторных попыток
 * для различных типов ошибок, выполняет компенсирующие действия и управляет процессом
 * восстановления состояния задачи.
 */

const logger = require('../../utils/logger');
const { TASK_STATES } = require('./state-manager');

// Определение типов ошибок
const ERROR_TYPES = {
  // Ошибки ввода/вывода
  VALIDATION_ERROR: 'validation_error', // Некорректные данные
  SCHEMA_ERROR: 'schema_error',         // Несоответствие схеме данных
  
  // Ошибки внешних систем
  LLM_ERROR: 'llm_error',               // Ошибка LLM API
  DB_ERROR: 'db_error',                 // Ошибка базы данных
  GIT_ERROR: 'git_error',               // Ошибка Git
  NETWORK_ERROR: 'network_error',       // Ошибка сети
  
  // Ошибки выполнения
  TIMEOUT_ERROR: 'timeout_error',       // Превышение времени выполнения
  EXECUTION_ERROR: 'execution_error',   // Ошибка выполнения кода
  RESOURCE_ERROR: 'resource_error',     // Нехватка ресурсов
  
  // Другие ошибки
  ORCHESTRATION_ERROR: 'orchestration_error', // Ошибка оркестрации
  UNKNOWN_ERROR: 'unknown_error',             // Неизвестная ошибка
};

// Стратегии восстановления
const RECOVERY_STRATEGIES = {
  RETRY: 'retry',                 // Повторная попытка с теми же параметрами
  RETRY_WITH_BACKOFF: 'backoff',  // Повторная попытка с увеличивающейся задержкой
  ALTERNATIVE_APPROACH: 'alternative', // Использование альтернативного подхода
  HUMAN_INTERVENTION: 'human',    // Требуется вмешательство человека
  COMPENSATING_ACTION: 'compensate', // Компенсирующее действие
  SKIP_STEP: 'skip',              // Пропуск шага
  ABORT: 'abort',                 // Прерывание выполнения задачи
};

// Определение стратегий восстановления для различных типов ошибок
const DEFAULT_RECOVERY_STRATEGIES = {
  [ERROR_TYPES.VALIDATION_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY,
    maxRetries: 3,
    description: 'Retry with corrected input'
  },
  [ERROR_TYPES.SCHEMA_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY,
    maxRetries: 3,
    description: 'Retry with corrected schema'
  },
  [ERROR_TYPES.LLM_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF,
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 60000,
    backoffFactor: 2,
    description: 'Retry LLM call with exponential backoff'
  },
  [ERROR_TYPES.DB_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF,
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 15000,
    backoffFactor: 2,
    description: 'Retry database operation with exponential backoff'
  },
  [ERROR_TYPES.GIT_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY,
    maxRetries: 3,
    description: 'Retry Git operation'
  },
  [ERROR_TYPES.NETWORK_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF,
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    description: 'Retry network operation with exponential backoff'
  },
  [ERROR_TYPES.TIMEOUT_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY,
    maxRetries: 2,
    description: 'Retry with increased timeout'
  },
  [ERROR_TYPES.EXECUTION_ERROR]: {
    strategy: RECOVERY_STRATEGIES.ALTERNATIVE_APPROACH,
    description: 'Try an alternative approach'
  },
  [ERROR_TYPES.RESOURCE_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF,
    maxRetries: 3,
    initialDelay: 5000,
    maxDelay: 60000,
    backoffFactor: 2,
    description: 'Retry with exponential backoff to allow resources to free up'
  },
  [ERROR_TYPES.ORCHESTRATION_ERROR]: {
    strategy: RECOVERY_STRATEGIES.RETRY,
    maxRetries: 3,
    description: 'Retry orchestration operation'
  },
  [ERROR_TYPES.UNKNOWN_ERROR]: {
    strategy: RECOVERY_STRATEGIES.HUMAN_INTERVENTION,
    description: 'Requires human intervention'
  }
};

/**
 * Класс управления восстановлением после ошибок.
 */
class RecoveryManager {
  /**
   * Создает экземпляр RecoveryManager.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.stateManager - Экземпляр StateManager.
   * @param {Object} options.contextManager - Экземпляр ContextManager.
   * @param {Object} options.db - Интерфейс к базе данных.
   * @param {Object} options.notificationManager - Экземпляр NotificationManager.
   */
  constructor({ stateManager, contextManager, db, notificationManager } = {}) {
    this.stateManager = stateManager;
    this.contextManager = contextManager;
    this.db = db;
    this.notificationManager = notificationManager;
    
    // Счетчики повторных попыток для задач
    this.retryCounters = new Map();
  }

  /**
   * Классифицирует ошибку и определяет тип ошибки.
   * @param {Error} error - Объект ошибки.
   * @returns {string} - Тип ошибки.
   */
  classifyError(error) {
    // Логируем ошибку для анализа
    logger.debug('Classifying error:', error);
    
    // Определяем тип ошибки на основе сообщения и стека
    if (!error) {
      return ERROR_TYPES.UNKNOWN_ERROR;
    }
    
    const errorMessage = error.message || '';
    const errorStack = error.stack || '';
    
    // Проверяем тип ошибки на основе сообщения и свойств
    if (error.name === 'ValidationError' || errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      return ERROR_TYPES.VALIDATION_ERROR;
    }
    
    if (error.name === 'SchemaError' || errorMessage.includes('schema')) {
      return ERROR_TYPES.SCHEMA_ERROR;
    }
    
    if (error.name === 'LLMError' || 
        errorMessage.includes('llm') || 
        errorMessage.includes('openai') || 
        errorMessage.includes('anthropic') || 
        errorMessage.includes('claude')) {
      return ERROR_TYPES.LLM_ERROR;
    }
    
    if (error.name === 'SequelizeError' || 
        errorMessage.includes('database') || 
        errorMessage.includes('sql') || 
        errorMessage.includes('db')) {
      return ERROR_TYPES.DB_ERROR;
    }
    
    if (error.name === 'GitError' || 
        errorMessage.includes('git') || 
        errorMessage.includes('repository')) {
      return ERROR_TYPES.GIT_ERROR;
    }
    
    if (error.name === 'NetworkError' || 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ECONNRESET' || 
        errorMessage.includes('network') || 
        errorMessage.includes('connection')) {
      return ERROR_TYPES.NETWORK_ERROR;
    }
    
    if (error.name === 'TimeoutError' || 
        error.code === 'ETIMEDOUT' || 
        errorMessage.includes('timeout')) {
      return ERROR_TYPES.TIMEOUT_ERROR;
    }
    
    if (errorMessage.includes('execution') || 
        errorMessage.includes('runtime') || 
        errorStack.includes('eval')) {
      return ERROR_TYPES.EXECUTION_ERROR;
    }
    
    if (errorMessage.includes('memory') || 
        errorMessage.includes('resource') || 
        error.code === 'ENOMEM') {
      return ERROR_TYPES.RESOURCE_ERROR;
    }
    
    if (errorMessage.includes('orchestration') || 
        errorMessage.includes('state transition') || 
        errorMessage.includes('workflow')) {
      return ERROR_TYPES.ORCHESTRATION_ERROR;
    }
    
    // Если не удалось определить тип ошибки, возвращаем UNKNOWN_ERROR
    return ERROR_TYPES.UNKNOWN_ERROR;
  }

  /**
   * Определяет стратегию восстановления для заданного типа ошибки и шага.
   * @param {string} errorType - Тип ошибки.
   * @param {string} stepName - Название шага.
   * @param {Object} stepContext - Контекст шага.
   * @returns {Object} - Стратегия восстановления.
   */
  determineRecoveryStrategy(errorType, stepName, stepContext) {
    logger.debug(`Determining recovery strategy for error type ${errorType} in step ${stepName}`);
    
    // Создаем ключ для задачи и шага
    const taskStepKey = `${stepContext.taskId}:${stepName}`;
    
    // Получаем счетчик повторных попыток для задачи и шага
    let retryCount = this.retryCounters.get(taskStepKey) || 0;
    
    // Получаем стратегию восстановления для данного типа ошибки
    const defaultStrategy = DEFAULT_RECOVERY_STRATEGIES[errorType] || DEFAULT_RECOVERY_STRATEGIES[ERROR_TYPES.UNKNOWN_ERROR];
    
    // Проверяем, не превышено ли максимальное количество попыток
    if (defaultStrategy.strategy === RECOVERY_STRATEGIES.RETRY || 
        defaultStrategy.strategy === RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF) {
      if (retryCount >= defaultStrategy.maxRetries) {
        // Если превышено, выбираем альтернативную стратегию
        if (errorType === ERROR_TYPES.LLM_ERROR) {
          // Для ошибок LLM пытаемся использовать альтернативный подход
          return {
            strategy: RECOVERY_STRATEGIES.ALTERNATIVE_APPROACH,
            description: 'Using alternative approach after max retries for LLM'
          };
        } else if (errorType === ERROR_TYPES.NETWORK_ERROR || 
                  errorType === ERROR_TYPES.DB_ERROR || 
                  errorType === ERROR_TYPES.GIT_ERROR) {
          // Для сетевых и DB ошибок требуется вмешательство человека после исчерпания попыток
          return {
            strategy: RECOVERY_STRATEGIES.HUMAN_INTERVENTION,
            description: `Requires human intervention after ${retryCount} failed retries for ${errorType}`
          };
        } else {
          // Для остальных типов ошибок просто прерываем выполнение задачи
          return {
            strategy: RECOVERY_STRATEGIES.ABORT,
            description: `Aborting after ${retryCount} failed retries for ${errorType}`
          };
        }
      }
    }
    
    // Возвращаем выбранную стратегию
    return {
      ...defaultStrategy,
      retryCount
    };
  }

  /**
   * Обновляет счетчик повторных попыток для задачи и шага.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @returns {number} - Новое значение счетчика.
   */
  incrementRetryCounter(taskId, stepName) {
    const taskStepKey = `${taskId}:${stepName}`;
    const currentCount = this.retryCounters.get(taskStepKey) || 0;
    const newCount = currentCount + 1;
    this.retryCounters.set(taskStepKey, newCount);
    return newCount;
  }

  /**
   * Сбрасывает счетчик повторных попыток для задачи и шага.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   */
  resetRetryCounter(taskId, stepName) {
    const taskStepKey = `${taskId}:${stepName}`;
    this.retryCounters.delete(taskStepKey);
  }

  /**
   * Вычисляет задержку для стратегии RETRY_WITH_BACKOFF.
   * @param {Object} strategy - Стратегия восстановления.
   * @returns {number} - Время задержки в миллисекундах.
   */
  calculateBackoffDelay(strategy) {
    const { initialDelay, maxDelay, backoffFactor, retryCount } = strategy;
    
    // Вычисляем задержку с экспоненциальным ростом
    const delay = initialDelay * Math.pow(backoffFactor, retryCount);
    
    // Ограничиваем максимальной задержкой
    return Math.min(delay, maxDelay);
  }

  /**
   * Выполняет восстановление после ошибки.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Error} error - Объект ошибки.
   * @param {Object} stepInput - Входные данные шага.
   * @param {Object} stepContext - Контекст шага.
   * @returns {Promise<Object>} - Результат восстановления.
   */
  async recover(taskId, stepName, error, stepInput, stepContext) {
    logger.info(`Attempting to recover from error in step ${stepName} for task ${taskId}`);
    
    try {
      // Классифицируем ошибку
      const errorType = this.classifyError(error);
      logger.info(`Classified error as ${errorType}`);
      
      // Определяем стратегию восстановления
      const recoveryStrategy = this.determineRecoveryStrategy(errorType, stepName, stepContext);
      logger.info(`Recovery strategy: ${recoveryStrategy.strategy}, description: ${recoveryStrategy.description}`);
      
      // Логируем информацию о восстановлении
      const recoveryInfo = {
        taskId,
        stepName,
        errorType,
        error: {
          message: error.message,
          stack: error.stack
        },
        recoveryStrategy,
        timestamp: new Date()
      };
      
      // Сохраняем информацию о восстановлении в БД (если доступна)
      if (this.db) {
        await this.db.TaskRecovery.create(recoveryInfo);
      }
      
      // Обновляем контекст задачи
      if (this.contextManager) {
        await this.contextManager.updateContext(
          taskId,
          `stepResults.${stepName}.recovery`,
          {
            ...recoveryInfo,
            attempts: (stepContext.recovery?.attempts || 0) + 1
          }
        );
      }
      
      // Выполняем действия в зависимости от стратегии
      switch (recoveryStrategy.strategy) {
        case RECOVERY_STRATEGIES.RETRY:
          // Увеличиваем счетчик попыток
          this.incrementRetryCounter(taskId, stepName);
          
          // Возвращаем результат для повторного выполнения шага
          return {
            action: 'retry',
            delay: 0,
            stepInput,
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.RETRY_WITH_BACKOFF:
          // Увеличиваем счетчик попыток
          this.incrementRetryCounter(taskId, stepName);
          
          // Вычисляем задержку
          const delay = this.calculateBackoffDelay(recoveryStrategy);
          
          // Возвращаем результат для повторного выполнения шага с задержкой
          return {
            action: 'retry',
            delay,
            stepInput,
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.ALTERNATIVE_APPROACH:
          // Увеличиваем счетчик попыток
          this.incrementRetryCounter(taskId, stepName);
          
          // Модифицируем входные данные для альтернативного подхода
          const alternativeInput = this._prepareAlternativeInput(stepName, stepInput, errorType);
          
          // Возвращаем результат для повторного выполнения шага с модифицированными входными данными
          return {
            action: 'retry',
            delay: 0,
            stepInput: alternativeInput,
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.HUMAN_INTERVENTION:
          // Отправляем уведомление пользователю
          if (this.notificationManager) {
            await this.notificationManager.sendNotification({
              type: 'error',
              taskId,
              title: `Human intervention required for task ${taskId}`,
              message: `Error in step ${stepName}: ${error.message}`,
              data: {
                errorType,
                stepName,
                error: error.message,
                recovery: recoveryInfo
              }
            });
          }
          
          // Переводим задачу в состояние ожидания ввода пользователя
          if (this.stateManager) {
            await this.stateManager.updateState(
              taskId,
              TASK_STATES.WAITING_FOR_INPUT,
              `Human intervention required for error in step ${stepName}: ${error.message}`,
              { errorType, stepName, recoveryInfo }
            );
          }
          
          // Возвращаем результат для прерывания выполнения шага
          return {
            action: 'abort',
            reason: 'human_intervention_required',
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.COMPENSATING_ACTION:
          // Выполняем компенсирующее действие
          await this._performCompensatingAction(taskId, stepName, errorType, stepInput, stepContext);
          
          // Возвращаем результат для продолжения выполнения
          return {
            action: 'continue',
            result: {
              success: false,
              compensationApplied: true,
              error: error.message
            },
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.SKIP_STEP:
          // Отмечаем шаг как пропущенный в контексте
          if (this.contextManager) {
            await this.contextManager.updateContext(
              taskId,
              `stepResults.${stepName}`,
              {
                success: false,
                skipped: true,
                error: error.message,
                recovery: recoveryInfo
              }
            );
          }
          
          // Возвращаем результат для перехода к следующему шагу
          return {
            action: 'skip',
            recoveryInfo
          };
          
        case RECOVERY_STRATEGIES.ABORT:
          // Переводим задачу в состояние ошибки
          if (this.stateManager) {
            await this.stateManager.updateState(
              taskId,
              TASK_STATES.FAILED,
              `Task failed due to error in step ${stepName}: ${error.message}`,
              { errorType, stepName, recoveryInfo }
            );
          }
          
          // Отправляем уведомление пользователю
          if (this.notificationManager) {
            await this.notificationManager.sendNotification({
              type: 'error',
              taskId,
              title: `Task ${taskId} failed`,
              message: `Task failed due to error in step ${stepName}: ${error.message}`,
              data: {
                errorType,
                stepName,
                error: error.message,
                recovery: recoveryInfo
              }
            });
          }
          
          // Возвращаем результат для прерывания выполнения задачи
          return {
            action: 'abort',
            reason: 'task_failed',
            recoveryInfo
          };
          
        default:
          // Для неизвестной стратегии по умолчанию прерываем выполнение
          logger.error(`Unknown recovery strategy: ${recoveryStrategy.strategy}`);
          
          return {
            action: 'abort',
            reason: 'unknown_recovery_strategy',
            recoveryInfo
          };
      }
    } catch (recoveryError) {
      // В случае ошибки в самом процессе восстановления
      logger.error(`Error during recovery for task ${taskId} in step ${stepName}:`, recoveryError);
      
      // Переводим задачу в состояние ошибки
      if (this.stateManager) {
        await this.stateManager.updateState(
          taskId,
          TASK_STATES.FAILED,
          `Task failed due to recovery error in step ${stepName}: ${recoveryError.message}`,
          { originalError: error.message, recoveryError: recoveryError.message }
        );
      }
      
      // Возвращаем результат для прерывания выполнения задачи
      return {
        action: 'abort',
        reason: 'recovery_failed',
        error: recoveryError.message
      };
    }
  }

  /**
   * Подготавливает входные данные для альтернативного подхода.
   * @private
   * @param {string} stepName - Название шага.
   * @param {Object} stepInput - Входные данные шага.
   * @param {string} errorType - Тип ошибки.
   * @returns {Object} - Модифицированные входные данные.
   */
  _prepareAlternativeInput(stepName, stepInput, errorType) {
    logger.debug(`Preparing alternative input for step ${stepName} due to error type ${errorType}`);
    
    // Клонируем входные данные
    const alternativeInput = JSON.parse(JSON.stringify(stepInput));
    
    // Модифицируем входные данные в зависимости от шага и типа ошибки
    switch (stepName) {
      case 'codeGenerator':
        // Для генератора кода
        if (errorType === ERROR_TYPES.LLM_ERROR) {
          // Уменьшаем сложность запроса, разбиваем на части
          alternativeInput.simplifyRequest = true;
          alternativeInput.splitIntoChunks = true;
        }
        break;
        
      case 'taskUnderstanding':
        // Для понимания задачи
        if (errorType === ERROR_TYPES.LLM_ERROR) {
          // Упрощаем промпт
          alternativeInput.useSimplePrompt = true;
        }
        break;
        
      case 'projectUnderstanding':
        // Для анализа контекста проекта
        if (errorType === ERROR_TYPES.RESOURCE_ERROR) {
          // Ограничиваем объем анализируемого контекста
          alternativeInput.limitContextSize = true;
          alternativeInput.maxFilesToAnalyze = 10;
        }
        break;
        
      case 'codeExecutor':
        // Для запуска кода и тестов
        if (errorType === ERROR_TYPES.TIMEOUT_ERROR) {
          // Увеличиваем таймаут
          alternativeInput.timeout = (alternativeInput.timeout || 30) * 2;
        } else if (errorType === ERROR_TYPES.EXECUTION_ERROR) {
          // Изменяем параметры запуска
          alternativeInput.useAlternativeRunner = true;
        }
        break;
        
      // Другие шаги...
    }
    
    // Добавляем информацию о восстановлении
    alternativeInput.recovery = {
      isRecoveryAttempt: true,
      errorType,
      alternativeApproach: true
    };
    
    return alternativeInput;
  }

  /**
   * Выполняет компенсирующее действие.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {string} errorType - Тип ошибки.
   * @param {Object} stepInput - Входные данные шага.
   * @param {Object} stepContext - Контекст шага.
   * @returns {Promise<void>}
   */
  async _performCompensatingAction(taskId, stepName, errorType, stepInput, stepContext) {
    logger.debug(`Performing compensating action for step ${stepName} due to error type ${errorType}`);
    
    // Выполняем компенсирующее действие в зависимости от шага и типа ошибки
    switch (stepName) {
      case 'prManager':
        // Если ошибка при создании PR, удаляем созданный PR (если был)
        if (errorType === ERROR_TYPES.GIT_ERROR && stepContext.prCreated) {
          // Логика удаления PR...
          logger.info(`Compensating action: Deleting PR for task ${taskId}`);
        }
        break;
        
      case 'codeExecutor':
        // Если ошибка при запуске Docker, освобождаем ресурсы
        if (errorType === ERROR_TYPES.EXECUTION_ERROR || errorType === ERROR_TYPES.RESOURCE_ERROR) {
          // Логика освобождения ресурсов...
          logger.info(`Compensating action: Cleaning up Docker resources for task ${taskId}`);
        }
        break;
        
      // Другие шаги...
    }
  }

  /**
   * Отмечает шаг как успешно выполненный и сбрасывает счетчик повторных попыток.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   */
  markStepAsSuccessful(taskId, stepName) {
    logger.debug(`Marking step ${stepName} as successful for task ${taskId}`);
    
    // Сбрасываем счетчик повторных попыток
    this.resetRetryCounter(taskId, stepName);
  }
}

module.exports = {
  RecoveryManager,
  ERROR_TYPES,
  RECOVERY_STRATEGIES
};
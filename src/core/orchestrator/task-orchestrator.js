/**
 * @fileoverview Task Orchestrator является главным компонентом системы оркестрации,
 * который координирует выполнение задачи согласно 16-шаговой методологии.
 * Он взаимодействует с StateManager, ContextManager, TransitionManager,
 * RecoveryManager и StepExecutorFactory для обеспечения правильного порядка
 * выполнения шагов, обработки ошибок и управления контекстом.
 */

const logger = require('../../utils/logger');
const { TASK_STATES } = require('./state-manager');
const { StepExecutorFactory } = require('./step-executor-factory');

/**
 * Класс оркестрации задач, управляющий выполнением задачи по 16-шаговой методологии.
 */
class TaskOrchestrator {
  /**
   * Создает экземпляр TaskOrchestrator.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.stateManager - Экземпляр StateManager.
   * @param {Object} options.contextManager - Экземпляр ContextManager.
   * @param {Object} options.transitionManager - Экземпляр TransitionManager.
   * @param {Object} options.recoveryManager - Экземпляр RecoveryManager.
   * @param {Object} options.notificationManager - Экземпляр NotificationManager.
   * @param {Object} options.queue - Интерфейс к очереди задач.
   * @param {Object} options.db - Интерфейс к базе данных.
   */
  constructor({
    stateManager,
    contextManager,
    transitionManager,
    recoveryManager,
    notificationManager,
    queue,
    db
  } = {}) {
    this.stateManager = stateManager;
    this.contextManager = contextManager;
    this.transitionManager = transitionManager;
    this.recoveryManager = recoveryManager;
    this.notificationManager = notificationManager;
    this.queue = queue;
    this.db = db;
    
    // Фабрика для создания исполнителей шагов
    this.stepExecutorFactory = new StepExecutorFactory({
      contextManager,
      stateManager,
      notificationManager,
      db
    });
    
    // Очередь ожидающих задач
    this.taskQueue = new Map();
    
    // Индикатор для активных задач
    this.activeTasksCount = 0;
    
    // Максимальное количество одновременно выполняемых задач
    this.maxConcurrentTasks = 5;
  }

  /**
   * Инициализирует задачу и начинает процесс выполнения.
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} initialData - Начальные данные задачи.
   * @returns {Promise<Object>} - Результат инициализации.
   */
  async initializeTask(taskId, initialData = {}) {
    logger.info(`Initializing task: ${taskId}`);
    
    try {
      // Инициализируем контекст задачи
      const context = await this.contextManager.initializeContext(taskId, initialData);
      
      // Переводим задачу в состояние INITIALIZED
      await this.stateManager.updateState(
        taskId,
        TASK_STATES.INITIALIZED,
        'Task initialized',
        { initialData }
      );
      
      // Отправляем уведомление об инициализации задачи
      if (this.notificationManager) {
        await this.notificationManager.sendInfo(
          'Task initialized',
          `Task ${taskId} has been initialized and queued for execution.`,
          { taskId }
        );
      }
      
      // Запускаем выполнение задачи
      return this.executeTask(taskId);
    } catch (error) {
      logger.error(`Error initializing task ${taskId}:`, error);
      
      // Отправляем уведомление об ошибке
      if (this.notificationManager) {
        await this.notificationManager.sendError(
          'Task initialization failed',
          `Failed to initialize task ${taskId}: ${error.message}`,
          { taskId }
        );
      }
      
      throw error;
    }
  }

  /**
   * Запускает или ставит в очередь выполнение задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Object>} - Результат операции.
   */
  async executeTask(taskId) {
    logger.info(`Starting execution for task: ${taskId}`);
    
    try {
      // Проверяем, не превышено ли максимальное количество одновременно выполняемых задач
      if (this.activeTasksCount >= this.maxConcurrentTasks) {
        // Если превышено, ставим задачу в очередь
        logger.info(`Max concurrent tasks limit reached, queuing task: ${taskId}`);
        this.taskQueue.set(taskId, Date.now());
        
        return {
          success: true,
          status: 'queued',
          taskId,
          message: 'Task has been queued for execution'
        };
      }
      
      // Увеличиваем счетчик активных задач
      this.activeTasksCount++;
      
      // Запускаем процесс выполнения
      this._processTask(taskId).catch(error => {
        logger.error(`Uncaught error in _processTask for ${taskId}:`, error);
      });
      
      return {
        success: true,
        status: 'started',
        taskId,
        message: 'Task execution has started'
      };
    } catch (error) {
      logger.error(`Error starting task execution ${taskId}:`, error);
      
      // Отправляем уведомление об ошибке
      if (this.notificationManager) {
        await this.notificationManager.sendError(
          'Task execution failed',
          `Failed to start execution for task ${taskId}: ${error.message}`,
          { taskId }
        );
      }
      
      throw error;
    }
  }

  /**
   * Обрабатывает выполнение задачи.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<void>}
   */
  async _processTask(taskId) {
    logger.debug(`Processing task: ${taskId}`);
    
    try {
      // Получаем текущее состояние задачи
      const currentState = await this.stateManager.getCurrentState(taskId);
      
      // Если задача уже завершена или в ошибке, прекращаем выполнение
      if (currentState === TASK_STATES.COMPLETED || currentState === TASK_STATES.FAILED) {
        logger.info(`Task ${taskId} is already in final state: ${currentState}`);
        this._finishTaskProcessing(taskId);
        return;
      }
      
      // Определяем следующий шаг для выполнения
      const nextStep = await this.transitionManager.getNextStep(taskId);
      
      // Если нет следующего шага, завершаем задачу
      if (!nextStep) {
        logger.warn(`No next step found for task ${taskId} in state ${currentState}`);
        await this.transitionManager.transitionToNextState(
          taskId,
          TASK_STATES.COMPLETED,
          'Task completed (no more steps to execute)'
        );
        this._finishTaskProcessing(taskId);
        return;
      }
      
      logger.info(`Executing step ${nextStep} for task ${taskId}`);
      
      // Получаем исполнителя для шага
      const executor = this.stepExecutorFactory.createExecutor(nextStep);
      
      if (!executor) {
        logger.error(`Executor not found for step ${nextStep}`);
        
        // Если это критический шаг, переводим задачу в состояние ошибки
        await this.transitionManager.transitionToError(
          taskId,
          `Executor not found for step ${nextStep}`
        );
        
        this._finishTaskProcessing(taskId);
        return;
      }
      
      // Получаем контекст задачи
      const context = await this.contextManager.getContext(taskId);
      
      // Переводим задачу в состояние выполнения шага
      const transitionResult = await this.transitionManager.transitionToNextState(
        taskId,
        null, // Определяется автоматически
        `Starting execution of step ${nextStep}`
      );
      
      // Отправляем уведомление о начале выполнения шага
      if (this.notificationManager) {
        await this.notificationManager.sendProgress(
          taskId,
          this._calculateProgressPercentage(nextStep),
          `Starting execution of step ${nextStep}`,
          {
            data: {
              step: nextStep,
              state: transitionResult.currentState
            }
          }
        );
      }
      
      // Проверяем, нужно ли выполнить шаг асинхронно через очередь
      const isLongRunningStep = this._isLongRunningStep(nextStep);
      
      if (isLongRunningStep && this.queue) {
        // Добавляем задачу в очередь
        await this._enqueueStepExecution(taskId, nextStep, context);
      } else {
        // Выполняем шаг напрямую
        await this._executeStep(taskId, nextStep, executor, context);
      }
    } catch (error) {
      logger.error(`Error in _processTask for ${taskId}:`, error);
      
      try {
        // Пытаемся обработать ошибку
        await this.transitionManager.transitionToError(
          taskId,
          `Error in task processing: ${error.message}`,
          { error: error.stack }
        );
        
        // Отправляем уведомление об ошибке
        if (this.notificationManager) {
          await this.notificationManager.sendError(
            'Task processing error',
            `Error in task processing: ${error.message}`,
            { taskId }
          );
        }
      } catch (notificationError) {
        logger.error(`Error sending error notification for ${taskId}:`, notificationError);
      }
      
      this._finishTaskProcessing(taskId);
    }
  }

  /**
   * Выполняет шаг и обрабатывает результат.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Object} executor - Экземпляр исполнителя шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<void>}
   */
  async _executeStep(taskId, stepName, executor, context) {
    logger.debug(`Executing step ${stepName} for task ${taskId}`);
    
    try {
      // Подготавливаем входные данные для шага
      const input = this._prepareStepInput(stepName, context);
      
      // Выполняем шаг
      const result = await executor.execute(taskId, input, context);
      
      // Обрабатываем результат
      await this._processStepResult(taskId, stepName, result);
    } catch (error) {
      logger.error(`Error executing step ${stepName} for task ${taskId}:`, error);
      
      // Пытаемся восстановиться после ошибки
      await this._handleStepError(taskId, stepName, error, context);
    }
  }

  /**
   * Добавляет выполнение шага в очередь задач.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<void>}
   */
  async _enqueueStepExecution(taskId, stepName, context) {
    logger.debug(`Enqueuing step ${stepName} for task ${taskId}`);
    
    try {
      // Подготавливаем входные данные для шага
      const input = this._prepareStepInput(stepName, context);
      
      // Определяем тип очереди для шага
      const queueType = this._getQueueTypeForStep(stepName);
      
      // Добавляем задачу в очередь
      const job = await this.queue.add(queueType, {
        taskId,
        stepName,
        input,
        contextId: context.id
      });
      
      logger.info(`Step ${stepName} for task ${taskId} added to queue, job ID: ${job.id}`);
      
      // Добавляем информацию о задаче в очереди в контекст
      await this.contextManager.updateContext(
        taskId,
        `stepResults.${stepName}.queueInfo`,
        {
          jobId: job.id,
          queueType,
          status: 'queued',
          timestamp: new Date()
        }
      );
      
      // Настраиваем обработчик завершения задачи
      job.finished().then(
        async (result) => {
          // Обрабатываем результат выполнения шага
          await this._processStepResult(taskId, stepName, result);
        },
        async (error) => {
          // Обрабатываем ошибку выполнения шага
          logger.error(`Queue job error for step ${stepName}, task ${taskId}:`, error);
          
          try {
            // Получаем актуальный контекст
            const updatedContext = await this.contextManager.getContext(taskId);
            
            // Пытаемся восстановиться после ошибки
            await this._handleStepError(taskId, stepName, error, updatedContext);
          } catch (handlingError) {
            logger.error(`Error handling queue job error for ${taskId}:`, handlingError);
            
            // В случае ошибки обработки, переводим задачу в состояние ошибки
            await this.transitionManager.transitionToError(
              taskId,
              `Error in queued step ${stepName}: ${error.message}`,
              { error: error.stack, handlingError: handlingError.stack }
            );
            
            // Продолжаем выполнение следующей задачи из очереди
            this._finishTaskProcessing(taskId);
          }
        }
      );
    } catch (error) {
      logger.error(`Error enqueuing step ${stepName} for task ${taskId}:`, error);
      
      // Пытаемся восстановиться после ошибки
      await this._handleStepError(taskId, stepName, error, context);
    }
  }

  /**
   * Обрабатывает результат выполнения шага.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Object} result - Результат выполнения шага.
   * @returns {Promise<void>}
   */
  async _processStepResult(taskId, stepName, result) {
    logger.debug(`Processing result of step ${stepName} for task ${taskId}`);
    
    try {
      // Проверяем успешность выполнения шага
      if (!result || !result.success) {
        const error = new Error(result?.error || `Step ${stepName} failed without specific error`);
        logger.error(`Step ${stepName} for task ${taskId} failed:`, error);
        
        // Получаем контекст задачи
        const context = await this.contextManager.getContext(taskId);
        
        // Пытаемся восстановиться после ошибки
        await this._handleStepError(taskId, stepName, error, context);
        return;
      }
      
      // Добавляем результат шага в контекст
      await this.contextManager.addStepResult(taskId, stepName, result);
      
      // Отмечаем шаг как успешно выполненный в RecoveryManager
      if (this.recoveryManager) {
        this.recoveryManager.markStepAsSuccessful(taskId, stepName);
      }
      
      // Переводим задачу в состояние завершения шага
      const transitionResult = await this.transitionManager.transitionToNextState(
        taskId,
        null, // Определяется автоматически
        `Step ${stepName} completed successfully`
      );
      
      // Отправляем уведомление о завершении шага
      if (this.notificationManager) {
        await this.notificationManager.sendProgress(
          taskId,
          this._calculateProgressPercentage(stepName, true),
          `Step ${stepName} completed successfully`,
          {
            data: {
              step: stepName,
              state: transitionResult.currentState,
              result: result.summary || result
            }
          }
        );
      }
      
      // Проверяем, не является ли текущее состояние финальным
      if (transitionResult.currentState === TASK_STATES.COMPLETED) {
        logger.info(`Task ${taskId} completed successfully`);
        
        // Отправляем уведомление о завершении задачи
        if (this.notificationManager) {
          await this.notificationManager.sendSuccess(
            'Task completed',
            `Task ${taskId} has been completed successfully`,
            { taskId }
          );
        }
        
        this._finishTaskProcessing(taskId);
        return;
      }
      
      // Продолжаем выполнение задачи
      await this._processTask(taskId);
    } catch (error) {
      logger.error(`Error processing step result for ${taskId}:`, error);
      
      try {
        // Пытаемся перевести задачу в состояние ошибки
        await this.transitionManager.transitionToError(
          taskId,
          `Error processing step result: ${error.message}`,
          { error: error.stack }
        );
        
        // Отправляем уведомление об ошибке
        if (this.notificationManager) {
          await this.notificationManager.sendError(
            'Error processing step result',
            `Error processing result of step ${stepName}: ${error.message}`,
            { taskId }
          );
        }
      } catch (notificationError) {
        logger.error(`Error sending error notification for ${taskId}:`, notificationError);
      }
      
      this._finishTaskProcessing(taskId);
    }
  }

  /**
   * Обрабатывает ошибку выполнения шага.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} stepName - Название шага.
   * @param {Error} error - Объект ошибки.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<void>}
   */
  async _handleStepError(taskId, stepName, error, context) {
    logger.debug(`Handling error in step ${stepName} for task ${taskId}`);
    
    try {
      // Если доступен RecoveryManager, пытаемся восстановиться после ошибки
      if (this.recoveryManager) {
        // Подготавливаем входные данные для шага
        const input = this._prepareStepInput(stepName, context);
        
        // Пытаемся восстановиться после ошибки
        const recoveryResult = await this.recoveryManager.recover(
          taskId,
          stepName,
          error,
          input,
          context
        );
        
        logger.info(`Recovery result for step ${stepName} in task ${taskId}:`, recoveryResult);
        
        // Обрабатываем результат восстановления
        switch (recoveryResult.action) {
          case 'retry':
            // Повторяем выполнение шага
            logger.info(`Retrying step ${stepName} for task ${taskId} after recovery`);
            
            // Если указана задержка, ждем
            if (recoveryResult.delay > 0) {
              await new Promise(resolve => setTimeout(resolve, recoveryResult.delay));
            }
            
            // Получаем исполнителя для шага
            const executor = this.stepExecutorFactory.createExecutor(stepName);
            
            if (!executor) {
              throw new Error(`Executor not found for step ${stepName} during retry`);
            }
            
            // Выполняем шаг повторно
            return this._executeStep(
              taskId,
              stepName,
              executor,
              await this.contextManager.getContext(taskId) // Получаем актуальный контекст
            );
            
          case 'skip':
            // Пропускаем шаг и переходим к следующему
            logger.info(`Skipping step ${stepName} for task ${taskId} after recovery`);
            
            // Переводим задачу в состояние завершения шага (пропуск)
            await this.transitionManager.transitionToNextState(
              taskId,
              null, // Определяется автоматически
              `Step ${stepName} skipped due to error: ${error.message}`
            );
            
            // Продолжаем выполнение задачи
            return this._processTask(taskId);
            
          case 'continue':
            // Продолжаем выполнение с результатом, сгенерированным RecoveryManager
            logger.info(`Continuing after step ${stepName} for task ${taskId} with recovery-generated result`);
            
            // Обрабатываем результат, как если бы шаг выполнился успешно
            return this._processStepResult(taskId, stepName, recoveryResult.result);
            
          case 'abort':
          default:
            // Прерываем выполнение задачи
            logger.info(`Aborting task ${taskId} after recovery from step ${stepName} error`);
            
            // Переводим задачу в состояние ошибки
            await this.transitionManager.transitionToError(
              taskId,
              `Task aborted due to error in step ${stepName}: ${error.message}`,
              { error: error.stack, recoveryResult }
            );
            
            // Отправляем уведомление об ошибке
            if (this.notificationManager) {
              await this.notificationManager.sendError(
                'Task aborted',
                `Task ${taskId} has been aborted due to error in step ${stepName}: ${error.message}`,
                { taskId, data: { recoveryResult } }
              );
            }
            
            this._finishTaskProcessing(taskId);
            return;
        }
      } else {
        // Если RecoveryManager недоступен, переводим задачу в состояние ошибки
        logger.warn(`RecoveryManager not available for task ${taskId}, transitioning to error state`);
        
        await this.transitionManager.transitionToError(
          taskId,
          `Error in step ${stepName}: ${error.message}`,
          { error: error.stack }
        );
        
        // Отправляем уведомление об ошибке
        if (this.notificationManager) {
          await this.notificationManager.sendError(
            'Step error',
            `Error in step ${stepName}: ${error.message}`,
            { taskId }
          );
        }
        
        this._finishTaskProcessing(taskId);
      }
    } catch (handlingError) {
      logger.error(`Error handling step error for ${taskId}:`, handlingError);
      
      try {
        // Переводим задачу в состояние ошибки
        await this.transitionManager.transitionToError(
          taskId,
          `Error handling step error: ${handlingError.message} (original error: ${error.message})`,
          { originalError: error.stack, handlingError: handlingError.stack }
        );
        
        // Отправляем уведомление об ошибке
        if (this.notificationManager) {
          await this.notificationManager.sendError(
            'Error handling step error',
            `Error handling step error: ${handlingError.message} (original error: ${error.message})`,
            { taskId }
          );
        }
      } catch (notificationError) {
        logger.error(`Error sending error notification for ${taskId}:`, notificationError);
      }
      
      this._finishTaskProcessing(taskId);
    }
  }

  /**
   * Завершает обработку задачи и запускает следующую из очереди.
   * @private
   * @param {string} taskId - Идентификатор задачи.
   * @returns {void}
   */
  _finishTaskProcessing(taskId) {
    logger.debug(`Finishing task processing for ${taskId}`);
    
    // Уменьшаем счетчик активных задач
    this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    
    // Проверяем очередь ожидающих задач
    if (this.taskQueue.size > 0) {
      // Получаем идентификатор задачи, ожидающей дольше всех
      let oldestTaskId = null;
      let oldestTaskTime = Infinity;
      
      this.taskQueue.forEach((time, id) => {
        if (time < oldestTaskTime) {
          oldestTaskId = id;
          oldestTaskTime = time;
        }
      });
      
      if (oldestTaskId) {
        // Удаляем задачу из очереди
        this.taskQueue.delete(oldestTaskId);
        
        // Запускаем задачу
        this.executeTask(oldestTaskId).catch(error => {
          logger.error(`Error starting queued task ${oldestTaskId}:`, error);
        });
      }
    }
  }

  /**
   * Подготавливает входные данные для шага на основе контекста.
   * @private
   * @param {string} stepName - Название шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Object} - Входные данные для шага.
   */
  _prepareStepInput(stepName, context) {
    // Базовый набор входных данных
    const input = {
      taskId: context.taskId,
      projectId: context.projectId,
      task: context.task,
    };
    
    // Добавляем специфичные данные в зависимости от шага
    switch (stepName) {
      case 'taskUnderstanding':
        // Для понимания задачи достаточно базовой информации
        return input;
        
      case 'projectUnderstanding':
        // Для анализа контекста проекта нужны результаты понимания задачи
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding
        };
        
      case 'taskPlanner':
        // Для планирования нужны результаты понимания задачи и контекста проекта
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding
        };
        
      case 'technologySuggester':
        // Для выбора технологий нужны результаты понимания задачи, контекста проекта и план
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          taskPlanner: context.stepResults.taskPlanner
        };
        
      case 'codeGenerator':
        // Для генерации кода нужны результаты предыдущих шагов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          taskPlanner: context.stepResults.taskPlanner,
          technologySuggester: context.stepResults.technologySuggester
        };
        
      case 'codeRefiner':
        // Для уточнения кода нужны результаты генерации кода
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator
        };
        
      case 'selfReflection':
        // Для саморефлексии нужны результаты генерации и уточнения кода
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner
        };
        
      case 'errorCorrector':
        // Для исправления ошибок нужны результаты саморефлексии
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          selfReflection: context.stepResults.selfReflection
        };
        
      case 'testGenerator':
        // Для генерации тестов нужны результаты генерации и уточнения кода
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          selfReflection: context.stepResults.selfReflection,
          errorCorrector: context.stepResults.errorCorrector
        };
        
      case 'codeExecutor':
        // Для запуска кода и тестов нужны результаты генерации кода и тестов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          testGenerator: context.stepResults.testGenerator
        };
        
      case 'testAnalyzer':
        // Для анализа результатов тестов нужны результаты запуска кода и тестов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          testGenerator: context.stepResults.testGenerator,
          codeExecutor: context.stepResults.codeExecutor
        };
        
      case 'documentationUpdater':
        // Для обновления документации нужны результаты всех предыдущих шагов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          testGenerator: context.stepResults.testGenerator,
          testAnalyzer: context.stepResults.testAnalyzer
        };
        
      case 'learningSystem':
        // Для обучения системы нужны результаты всех предыдущих шагов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          testGenerator: context.stepResults.testGenerator,
          testAnalyzer: context.stepResults.testAnalyzer,
          documentationUpdater: context.stepResults.documentationUpdater
        };
        
      case 'prManager':
        // Для подготовки PR нужны результаты всех предыдущих шагов
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          codeRefiner: context.stepResults.codeRefiner,
          testGenerator: context.stepResults.testGenerator,
          testAnalyzer: context.stepResults.testAnalyzer,
          documentationUpdater: context.stepResults.documentationUpdater,
          learningSystem: context.stepResults.learningSystem
        };
        
      case 'feedbackIntegrator':
        // Для интеграции обратной связи нужны результаты подготовки PR
        return {
          ...input,
          taskUnderstanding: context.stepResults.taskUnderstanding,
          projectUnderstanding: context.stepResults.projectUnderstanding,
          codeGenerator: context.stepResults.codeGenerator,
          prManager: context.stepResults.prManager
        };
        
      default:
        // Для неизвестных шагов возвращаем базовый набор
        return input;
    }
  }

  /**
   * Определяет, является ли шаг долгим и требующим выполнения через очередь.
   * @private
   * @param {string} stepName - Название шага.
   * @returns {boolean} - true, если шаг является долгим.
   */
  _isLongRunningStep(stepName) {
    // Список шагов, которые выполняются через очередь
    const longRunningSteps = [
      'codeGenerator',
      'codeExecutor',
      'testGenerator',
      'projectUnderstanding',
      'learningSystem',
      'prManager'
    ];
    
    return longRunningSteps.includes(stepName);
  }

  /**
   * Определяет тип очереди для шага.
   * @private
   * @param {string} stepName - Название шага.
   * @returns {string} - Тип очереди.
   */
  _getQueueTypeForStep(stepName) {
    // Сопоставление шагов с типами очередей
    const queueTypes = {
      'codeGenerator': 'code-generation',
      'codeExecutor': 'code-execution',
      'testGenerator': 'test-generation',
      'projectUnderstanding': 'project-analysis',
      'learningSystem': 'learning',
      'prManager': 'git-operations'
    };
    
    return queueTypes[stepName] || 'default';
  }

  /**
   * Вычисляет процент выполнения задачи на основе текущего шага.
   * @private
   * @param {string} stepName - Название шага.
   * @param {boolean} completed - Флаг завершения шага.
   * @returns {number} - Процент выполнения (0-100).
   */
  _calculateProgressPercentage(stepName, completed = false) {
    // Веса шагов в общем прогрессе (в сумме 100%)
    const stepWeights = {
      'taskUnderstanding': 5,
      'projectUnderstanding': 10,
      'taskPlanner': 5,
      'technologySuggester': 5,
      'codeGenerator': 20,
      'codeRefiner': 10,
      'selfReflection': 5,
      'errorCorrector': 5,
      'testGenerator': 10,
      'codeExecutor': 5,
      'testAnalyzer': 5,
      'documentationUpdater': 5,
      'learningSystem': 3,
      'prManager': 5,
      'feedbackIntegrator': 2
    };
    
    // Порядок шагов
    const stepOrder = [
      'taskUnderstanding',
      'projectUnderstanding',
      'taskPlanner',
      'technologySuggester',
      'codeGenerator',
      'codeRefiner',
      'selfReflection',
      'errorCorrector',
      'testGenerator',
      'codeExecutor',
      'testAnalyzer',
      'documentationUpdater',
      'learningSystem',
      'prManager',
      'feedbackIntegrator'
    ];
    
    const stepIndex = stepOrder.indexOf(stepName);
    
    if (stepIndex === -1) {
      return 0;
    }
    
    // Сумма весов всех предыдущих шагов
    let progressSum = 0;
    
    for (let i = 0; i < stepIndex; i++) {
      progressSum += stepWeights[stepOrder[i]];
    }
    
    // Если текущий шаг завершен, добавляем его вес
    if (completed) {
      progressSum += stepWeights[stepName];
    } else {
      // Если не завершен, добавляем половину его веса
      progressSum += stepWeights[stepName] / 2;
    }
    
    return Math.min(100, Math.round(progressSum));
  }
}

module.exports = { TaskOrchestrator };
// src/core/orchestrator/task-orchestrator.js

const { EventEmitter } = require('events');
const StateManager = require('./state-manager');
const TransitionManager = require('./transition-manager');
const ContextManager = require('./context-manager');
const RecoveryManager = require('./recovery-manager');
const NotificationManager = require('./notification-manager');
const MetricsCollector = require('./metrics-collector');
const StepExecutorFactory = require('./step-executor-factory');
const logger = require('../../utils/logger');

/**
 * Основной класс оркестратора, управляющий жизненным циклом задачи
 * через все шаги AI-ассистированной разработки
 */
class TaskOrchestrator extends EventEmitter {
  /**
   * Создание оркестратора для управления задачей
   * @param {string|object} taskOrTaskId - ID задачи или объект задачи
   * @param {object} options - Опции оркестратора
   */
  constructor(taskOrTaskId, options = {}) {
    super();
    
    this.options = {
      autoStart: false,
      resumeFromLastStep: true,
      maxRetries: 3,
      ...options
    };

    this.stateManager = new StateManager();
    this.transitionManager = new TransitionManager();
    this.contextManager = new ContextManager();
    this.recoveryManager = new RecoveryManager({
      maxRetries: this.options.maxRetries
    });
    this.notificationManager = new NotificationManager();
    this.metricsCollector = new MetricsCollector();
    this.stepExecutorFactory = new StepExecutorFactory();
    
    this.taskId = typeof taskOrTaskId === 'string' ? taskOrTaskId : taskOrTaskId.id;
    this.task = typeof taskOrTaskId === 'object' ? taskOrTaskId : null;
    
    this.isRunning = false;
    this.isPaused = false;
    this.isCompleted = false;
    
    this._init();
  }
  
  /**
   * Инициализация оркестратора
   * @private
   */
  async _init() {
    try {
      // Загрузка задачи, если передан только ID
      if (!this.task) {
        this.task = await this.stateManager.loadTask(this.taskId);
      }
      
      // Инициализация менеджеров с контекстом задачи
      await this.contextManager.initialize(this.task);
      await this.stateManager.initialize(this.task);
      await this.notificationManager.initialize(this.task);
      await this.metricsCollector.initialize(this.task);
      
      // Автозапуск, если указано в опциях
      if (this.options.autoStart) {
        await this.start();
      }
      
      this.emit('initialized', { taskId: this.taskId });
      logger.info(`TaskOrchestrator initialized for task: ${this.taskId}`);
    } catch (error) {
      logger.error(`Error initializing TaskOrchestrator: ${error.message}`, {
        taskId: this.taskId,
        error
      });
      this.emit('error', { error, taskId: this.taskId });
      throw error;
    }
  }
  
  /**
   * Запуск процесса выполнения задачи
   * @param {number} [startStep=1] - Номер шага, с которого начать выполнение
   * @returns {Promise<void>}
   */
  async start(startStep) {
    if (this.isRunning) {
      throw new Error('Orchestrator is already running');
    }
    
    try {
      this.isRunning = true;
      this.isPaused = false;
      
      // Определяем начальный шаг
      let currentStep;
      if (startStep) {
        currentStep = startStep;
      } else if (this.options.resumeFromLastStep && this.task.currentStep) {
        currentStep = this.task.currentStep;
      } else {
        currentStep = 1; // Начинаем с первого шага по умолчанию
      }
      
      await this.stateManager.updateTaskStatus(this.taskId, 'in_progress');
      logger.info(`Starting task execution from step ${currentStep}`, {
        taskId: this.taskId
      });
      
      this.emit('started', { taskId: this.taskId, startStep: currentStep });
      await this.notificationManager.sendNotification('task_started', {
        taskId: this.taskId,
        step: currentStep
      });
      
      // Запускаем выполнение с указанного шага
      await this._executeStep(currentStep);
    } catch (error) {
      this.isRunning = false;
      logger.error(`Error starting task execution: ${error.message}`, {
        taskId: this.taskId,
        error
      });
      this.emit('error', { error, taskId: this.taskId });
      throw error;
    }
  }
  
  /**
   * Выполнение конкретного шага
   * @param {number} stepNumber - Номер шага для выполнения
   * @private
   */
  async _executeStep(stepNumber) {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    
    try {
      logger.info(`Executing step ${stepNumber}`, { taskId: this.taskId });
      
      // Обновляем статус шага на "in_progress"
      await this.stateManager.updateStepStatus(this.taskId, stepNumber, 'in_progress');
      
      // Отправляем уведомление о начале шага
      await this.notificationManager.sendNotification('step_started', {
        taskId: this.taskId,
        step: stepNumber
      });
      
      // Получаем контекст задачи для передачи исполнителю
      const context = await this.contextManager.getContext(this.taskId);
      
      // Создаем исполнителя для текущего шага
      const executor = this.stepExecutorFactory.createExecutor(stepNumber);
      
      // Проверяем, можно ли выполнить шаг с текущим контекстом
      if (!await executor.canExecute(context)) {
        logger.warn(`Step ${stepNumber} cannot be executed with current context`, {
          taskId: this.taskId
        });
        
        // Пытаемся определить альтернативный путь
        const alternativeStep = await this.transitionManager.findAlternativeStep(
          stepNumber, 
          context
        );
        
        if (alternativeStep) {
          logger.info(`Redirecting to alternative step ${alternativeStep}`, {
            taskId: this.taskId,
            fromStep: stepNumber
          });
          
          await this.stateManager.updateStepStatus(
            this.taskId, 
            stepNumber, 
            'skipped'
          );
          
          await this.transitionManager.recordTransition(
            this.taskId,
            stepNumber,
            alternativeStep,
            'alternative_path'
          );
          
          return this._executeStep(alternativeStep);
        }
        
        // Если альтернативного пути нет, помечаем шаг как проваленный
        await this.stateManager.updateStepStatus(
          this.taskId, 
          stepNumber, 
          'failed',
          'Cannot execute step with current context'
        );
        
        throw new Error(`Cannot execute step ${stepNumber} and no alternative path found`);
      }
      
      // Запускаем метрики для шага
      const metricsId = await this.metricsCollector.startStepExecution(this.taskId, stepNumber);
      
      try {
        // Выполняем шаг
        const result = await executor.execute(context);
        
        // Обновляем контекст результатами выполнения шага
        await this.contextManager.updateContext(this.taskId, stepNumber, result);
        
        // Обновляем статус шага на "completed"
        await this.stateManager.updateStepStatus(
          this.taskId, 
          stepNumber, 
          'completed',
          null,
          result
        );
        
        // Завершаем метрики для шага
        await this.metricsCollector.finishStepExecution(metricsId, 'success');
        
        // Отправляем уведомление о завершении шага
        await this.notificationManager.sendNotification('step_completed', {
          taskId: this.taskId,
          step: stepNumber,
          result
        });
        
        // Определяем следующий шаг
        const nextStep = await this.transitionManager.getNextStep(stepNumber, context, result);
        
        // Записываем переход
        await this.transitionManager.recordTransition(
          this.taskId,
          stepNumber,
          nextStep,
          'auto'
        );
        
        if (nextStep === null) {
          // Если следующего шага нет, завершаем задачу
          await this._completeTask();
        } else {
          // Выполняем следующий шаг
          await this._executeStep(nextStep);
        }
      } catch (error) {
        // Завершаем метрики с ошибкой
        await this.metricsCollector.finishStepExecution(metricsId, 'failure', error);
        
        // Обрабатываем ошибку выполнения шага
        logger.error(`Error executing step ${stepNumber}: ${error.message}`, {
          taskId: this.taskId,
          step: stepNumber,
          error
        });
        
        // Отправляем уведомление об ошибке
        await this.notificationManager.sendNotification('step_failed', {
          taskId: this.taskId,
          step: stepNumber,
          error: error.message
        });
        
        // Пытаемся восстановиться после ошибки
        const recovery = await this.recoveryManager.handleStepFailure(
          this.taskId,
          stepNumber,
          error,
          context
        );
        
        switch (recovery.action) {
          case 'retry':
            // Повторяем текущий шаг
            logger.info(`Retrying step ${stepNumber}`, {
              taskId: this.taskId,
              attempts: recovery.attempts
            });
            
            await this.transitionManager.recordTransition(
              this.taskId,
              stepNumber,
              stepNumber,
              'retry'
            );
            
            return this._executeStep(stepNumber);
            
          case 'rollback':
            // Откатываемся к предыдущему шагу
            logger.info(`Rolling back to step ${recovery.targetStep}`, {
              taskId: this.taskId,
              fromStep: stepNumber
            });
            
            // Выполняем откат текущего шага
            await executor.rollback(context);
            
            await this.stateManager.updateStepStatus(
              this.taskId, 
              stepNumber, 
              'failed',
              error.message
            );
            
            await this.transitionManager.recordTransition(
              this.taskId,
              stepNumber,
              recovery.targetStep,
              'rollback'
            );
            
            return this._executeStep(recovery.targetStep);
            
          case 'abort':
            // Прерываем выполнение задачи
            logger.error(`Aborting task execution due to unrecoverable error in step ${stepNumber}`, {
              taskId: this.taskId,
              error
            });
            
            await this.stateManager.updateStepStatus(
              this.taskId, 
              stepNumber, 
              'failed',
              error.message
            );
            
            await this.stateManager.updateTaskStatus(this.taskId, 'failed');
            
            this.isRunning = false;
            this.emit('failed', {
              taskId: this.taskId,
              step: stepNumber,
              error
            });
            
            break;
            
          case 'alternative':
            // Используем альтернативный путь
            logger.info(`Taking alternative path to step ${recovery.targetStep}`, {
              taskId: this.taskId,
              fromStep: stepNumber
            });
            
            await this.stateManager.updateStepStatus(
              this.taskId, 
              stepNumber, 
              'failed',
              error.message
            );
            
            await this.transitionManager.recordTransition(
              this.taskId,
              stepNumber,
              recovery.targetStep,
              'alternative_on_error'
            );
            
            return this._executeStep(recovery.targetStep);
        }
      }
    } catch (orchestratorError) {
      // Обрабатываем ошибки самого оркестратора
      logger.error(`Orchestrator error during step ${stepNumber}: ${orchestratorError.message}`, {
        taskId: this.taskId,
        step: stepNumber,
        error: orchestratorError
      });
      
      this.emit('error', {
        error: orchestratorError,
        taskId: this.taskId,
        step: stepNumber
      });
      
      // Прерываем выполнение в случае ошибки оркестратора
      this.isRunning = false;
    }
  }
  
  /**
   * Завершение задачи
   * @private
   */
  async _completeTask() {
    try {
      await this.stateManager.updateTaskStatus(this.taskId, 'completed');
      this.isRunning = false;
      this.isCompleted = true;
      
      logger.info(`Task execution completed successfully`, {
        taskId: this.taskId
      });
      
      this.emit('completed', { taskId: this.taskId });
      
      await this.notificationManager.sendNotification('task_completed', {
        taskId: this.taskId
      });
      
      // Собираем итоговые метрики по задаче
      const metrics = await this.metricsCollector.collectTaskMetrics(this.taskId);
      logger.debug('Task metrics collected', {
        taskId: this.taskId,
        metrics
      });
    } catch (error) {
      logger.error(`Error completing task: ${error.message}`, {
        taskId: this.taskId,
        error
      });
      this.emit('error', { error, taskId: this.taskId });
    }
  }
  
  /**
   * Пауза выполнения задачи
   * @returns {Promise<void>}
   */
  async pause() {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    
    this.isPaused = true;
    await this.stateManager.updateTaskStatus(this.taskId, 'paused');
    
    logger.info(`Task execution paused`, {
      taskId: this.taskId
    });
    
    this.emit('paused', { taskId: this.taskId });
    
    await this.notificationManager.sendNotification('task_paused', {
      taskId: this.taskId
    });
  }
  
  /**
   * Возобновление выполнения задачи
   * @returns {Promise<void>}
   */
  async resume() {
    if (!this.isPaused) {
      return;
    }
    
    this.isPaused = false;
    await this.stateManager.updateTaskStatus(this.taskId, 'in_progress');
    
    logger.info(`Task execution resumed from step ${this.task.currentStep}`, {
      taskId: this.taskId
    });
    
    this.emit('resumed', { taskId: this.taskId, step: this.task.currentStep });
    
    await this.notificationManager.sendNotification('task_resumed', {
      taskId: this.taskId,
      step: this.task.currentStep
    });
    
    // Продолжаем выполнение с текущего шага
    await this._executeStep(this.task.currentStep);
  }
  
  /**
   * Отмена выполнения задачи
   * @returns {Promise<void>}
   */
  async cancel() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    this.isPaused = false;
    
    await this.stateManager.updateTaskStatus(this.taskId, 'cancelled');
    
    logger.info(`Task execution cancelled`, {
      taskId: this.taskId
    });
    
    this.emit('cancelled', { taskId: this.taskId });
    
    await this.notificationManager.sendNotification('task_cancelled', {
      taskId: this.taskId
    });
  }
  
  /**
   * Переход к определенному шагу
   * @param {number} stepNumber - Номер шага
   * @param {string} [reason='manual'] - Причина перехода
   * @returns {Promise<void>}
   */
  async goToStep(stepNumber, reason = 'manual') {
    if (stepNumber < 1 || stepNumber > 16) {
      throw new Error(`Invalid step number: ${stepNumber}. Must be between 1 and 16.`);
    }
    
    const currentStep = this.task.currentStep;
    
    logger.info(`Manual transition from step ${currentStep} to step ${stepNumber}`, {
      taskId: this.taskId,
      reason
    });
    
    // Записываем переход
    await this.transitionManager.recordTransition(
      this.taskId,
      currentStep,
      stepNumber,
      reason
    );
    
    // Обновляем текущий шаг
    this.task.currentStep = stepNumber;
    await this.stateManager.saveTask(this.task);
    
    // Если оркестратор запущен и не на паузе, выполняем шаг
    if (this.isRunning && !this.isPaused) {
      await this._executeStep(stepNumber);
    }
  }
  
  /**
   * Получение текущего состояния задачи
   * @returns {Promise<object>} Состояние задачи
   */
  async getState() {
    // Обновляем задачу из БД, чтобы получить актуальное состояние
    this.task = await this.stateManager.loadTask(this.taskId);
    
    return {
      taskId: this.taskId,
      status: this.task.status,
      currentStep: this.task.currentStep,
      stepStatuses: this.task.stepStatuses,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isCompleted: this.isCompleted,
      context: await this.contextManager.getContext(this.taskId)
    };
  }
}

module.exports = TaskOrchestrator;
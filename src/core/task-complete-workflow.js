// src/core/task-complete-workflow.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');
const taskLogger = require('../utils/task-logger');
const TaskAnalyzer = require('./task-understanding/task-analyzer');
const TaskDecomposer = require('./task-planner/decomposer');
const { getLLMClient } = require('../utils/llm-client');
const websocket = require('../websocket');

/**
 * Класс для управления полным 16-шаговым рабочим процессом ИИ-ассистента
 */
class TaskCompleteWorkflow {
  constructor() {
    this.llmClient = getLLMClient();
    
    // Определение полного рабочего процесса с 16 шагами
    this.steps = [
      {
        id: 'MORNING_PLANNING',
        name: 'Утреннее планирование',
        description: 'Начальное планирование задачи',
        handler: this.handleMorningPlanning.bind(this),
        isManual: true, // Требует участия человека
        nextStep: 'TASK_ANALYSIS'
      },
      {
        id: 'TASK_ANALYSIS',
        name: 'Анализ задачи',
        description: 'Анализ задачи с помощью ИИ',
        handler: this.handleTaskAnalysis.bind(this),
        isManual: false, // Автоматический шаг
        nextStep: 'TASK_DECOMPOSITION'
      },
      {
        id: 'TASK_DECOMPOSITION',
        name: 'Разбивка на подзадачи',
        description: 'Декомпозиция задачи на подзадачи',
        handler: this.handleTaskDecomposition.bind(this),
        isManual: false,
        nextStep: 'ISSUE_CREATION'
      },
      {
        id: 'ISSUE_CREATION',
        name: 'Создание Issues/задач',
        description: 'Создание внешних задач в систем управления проектами',
        handler: this.handleIssueCreation.bind(this),
        isManual: false,
        nextStep: 'CODE_SCAFFOLDING'
      },
      {
        id: 'CODE_SCAFFOLDING',
        name: 'Автоматическая разработка',
        description: 'Создание шаблонов кода',
        handler: this.handleCodeScaffolding.bind(this),
        isManual: false,
        nextStep: 'CODE_GENERATION'
      },
      {
        id: 'CODE_GENERATION',
        name: 'Генерация кода',
        description: 'Полная генерация кода для подзадач',
        handler: this.handleCodeGeneration.bind(this),
        isManual: false,
        nextStep: 'SELF_CHECK'
      },
      {
        id: 'SELF_CHECK',
        name: 'Самопроверка ИИ',
        description: 'Автоматическая проверка сгенерированного кода',
        handler: this.handleSelfCheck.bind(this),
        isManual: false,
        nextStep: 'PR_CREATION'
      },
      {
        id: 'PR_CREATION',
        name: 'Создание pull request',
        description: 'Создание PR в системе контроля версий',
        handler: this.handlePRCreation.bind(this),
        isManual: false,
        nextStep: 'DEVELOPER_REVIEW'
      },
      {
        id: 'DEVELOPER_REVIEW',
        name: 'Проверка разработчиком',
        description: 'Код-ревью от разработчика',
        handler: this.handleDeveloperReview.bind(this),
        isManual: true, // Требует участия человека
        nextStep: 'AI_FEEDBACK'
      },
      {
        id: 'AI_FEEDBACK',
        name: 'Обратная связь для ИИ',
        description: 'Обработка фидбека от разработчика',
        handler: this.handleAIFeedback.bind(this),
        isManual: false,
        nextStep: 'ERROR_CORRECTION'
      },
      {
        id: 'ERROR_CORRECTION',
        name: 'Исправление ошибок',
        description: 'Исправление замечаний, выявленных в ходе ревью',
        handler: this.handleErrorCorrection.bind(this),
        isManual: false,
        nextStep: 'FINAL_APPROVAL'
      },
      {
        id: 'FINAL_APPROVAL',
        name: 'Финальное утверждение',
        description: 'Окончательное одобрение изменений',
        handler: this.handleFinalApproval.bind(this),
        isManual: true, // Требует участия человека
        nextStep: 'MERGE'
      },
      {
        id: 'MERGE',
        name: 'Слияние с основной веткой',
        description: 'Мерж PR в основную ветку',
        handler: this.handleMerge.bind(this),
        isManual: false,
        nextStep: 'DOCUMENTATION_UPDATE'
      },
      {
        id: 'DOCUMENTATION_UPDATE',
        name: 'Обновление документации',
        description: 'Обновление документации на основе внесенных изменений',
        handler: this.handleDocUpdate.bind(this),
        isManual: false,
        nextStep: 'PROGRESS_REPORT'
      },
      {
        id: 'PROGRESS_REPORT',
        name: 'Отчет о прогрессе',
        description: 'Генерация отчета о выполненной работе',
        handler: this.handleProgressReport.bind(this),
        isManual: false,
        nextStep: 'EVENING_ANALYSIS'
      },
      {
        id: 'EVENING_ANALYSIS',
        name: 'Вечерний анализ',
        description: 'Финальный анализ выполненной работы',
        handler: this.handleEveningAnalysis.bind(this),
        isManual: true, // Требует участия человека
        nextStep: null // Конец процесса
      }
    ];
  }

  /**
   * Запускает полный рабочий процесс для задачи
   * @param {number} taskId - ID задачи
   * @param {number} userId - ID пользователя, запустившего процесс
   * @returns {Promise<Object>} - Результат запуска процесса
   */
  async startWorkflow(taskId, userId) {
    try {
      logger.info(`Запуск полного рабочего процесса для задачи #${taskId} пользователем #${userId}`);
      
      // Проверяем существование задачи
      const task = await this.getTaskInfo(taskId);
      
      if (!task) {
        throw new Error(`Задача #${taskId} не найдена`);
      }
      
      // Проверяем, не запущен ли уже процесс
      const existingWorkflow = await this.getWorkflowState(taskId);
      
      if (existingWorkflow && existingWorkflow.status === 'in_progress') {
        logger.warn(`Рабочий процесс для задачи #${taskId} уже запущен. Текущий шаг: ${existingWorkflow.currentStepId}`);
        return {
          success: false,
          message: `Рабочий процесс уже запущен. Текущий шаг: ${existingWorkflow.currentStepName}`,
          currentStep: existingWorkflow.currentStepId,
          workflowState: existingWorkflow
        };
      }
      
      // Инициализируем процесс
      const initialState = {
        taskId,
        startedBy: userId,
        startedAt: new Date(),
        currentStepId: 'MORNING_PLANNING',
        currentStepName: 'Утреннее планирование',
        status: 'in_progress',
        completedSteps: [],
        stepResults: {},
        lastUpdated: new Date()
      };
      
      // Сохраняем начальное состояние
      await this.saveWorkflowState(taskId, initialState);
      
      // Логируем начало процесса
      await taskLogger.logInfo(taskId, `Начат полный рабочий процесс. Первый шаг: ${initialState.currentStepName}`);
      
      // Отправляем уведомление через WebSockets
      this.notifyWorkflowUpdate(taskId, 'workflow_started', initialState);
      
      // Если первый шаг ручной, просто возвращаем статус
      const firstStep = this.steps.find(step => step.id === 'MORNING_PLANNING');
      
      if (firstStep.isManual) {
        return {
          success: true,
          message: `Рабочий процесс запущен. Ожидание выполнения шага: ${firstStep.name}`,
          currentStep: firstStep.id,
          requiresManualAction: true,
          workflowState: initialState
        };
      }
      
      // Если первый шаг автоматический, запускаем его
      return await this.executeCurrentStep(taskId);
      
    } catch (error) {
      logger.error(`Ошибка при запуске рабочего процесса для задачи #${taskId}:`, error);
      
      // Логируем ошибку в задаче
      await taskLogger.logError(taskId, `Ошибка при запуске рабочего процесса: ${error.message}`);
      
      return {
        success: false,
        message: `Ошибка при запуске рабочего процесса: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Выполняет текущий шаг рабочего процесса
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат выполнения шага
   */
  async executeCurrentStep(taskId) {
    try {
      logger.info(`Выполнение текущего шага для задачи #${taskId}`);
      
      // Получаем текущее состояние процесса
      const workflowState = await this.getWorkflowState(taskId);
      
      if (!workflowState) {
        throw new Error(`Рабочий процесс для задачи #${taskId} не найден`);
      }
      
      if (workflowState.status !== 'in_progress') {
        throw new Error(`Рабочий процесс для задачи #${taskId} имеет статус ${workflowState.status} и не может быть продолжен`);
      }
      
      // Находим информацию о текущем шаге
      const currentStepId = workflowState.currentStepId;
      const currentStep = this.steps.find(step => step.id === currentStepId);
      
      if (!currentStep) {
        throw new Error(`Шаг ${currentStepId} не найден в рабочем процессе`);
      }
      
      // Проверяем, не пытаемся ли выполнить ручной шаг автоматически
      if (currentStep.isManual) {
        return {
          success: false,
          message: `Шаг ${currentStep.name} требует ручного выполнения`,
          requiresManualAction: true,
          currentStep: currentStepId,
          workflowState
        };
      }
      
      // Логируем начало выполнения шага
      await taskLogger.logInfo(taskId, `Начато выполнение шага: ${currentStep.name}`);
      
      // Отправляем уведомление о начале шага
      this.notifyWorkflowUpdate(taskId, 'step_started', {
        ...workflowState,
        stepStatus: 'executing'
      });
      
      // Выполняем шаг
      const stepResult = await currentStep.handler(taskId, workflowState);
      
      // Обновляем состояние процесса
      const updatedState = {
        ...workflowState,
        stepResults: {
          ...workflowState.stepResults,
          [currentStepId]: stepResult
        },
        completedSteps: [...workflowState.completedSteps, currentStepId],
        lastUpdated: new Date()
      };
      
      // Если есть следующий шаг, переходим к нему
      if (currentStep.nextStep) {
        const nextStep = this.steps.find(step => step.id === currentStep.nextStep);
        
        updatedState.currentStepId = nextStep.id;
        updatedState.currentStepName = nextStep.name;
        
        await this.saveWorkflowState(taskId, updatedState);
        
        // Логируем завершение шага и переход к следующему
        await taskLogger.logInfo(taskId, `Шаг "${currentStep.name}" успешно выполнен. Следующий шаг: "${nextStep.name}"`);
        
        // Отправляем уведомление о завершении шага
        this.notifyWorkflowUpdate(taskId, 'step_completed', updatedState);
        
        // Если следующий шаг автоматический, выполняем его
        if (!nextStep.isManual) {
          return await this.executeCurrentStep(taskId);
        }
        
        return {
          success: true,
          message: `Шаг "${currentStep.name}" успешно выполнен. Следующий шаг "${nextStep.name}" требует ручного выполнения`,
          requiresManualAction: true,
          previousStep: currentStepId,
          currentStep: nextStep.id,
          workflowState: updatedState
        };
      }
      
      // Если следующего шага нет, завершаем процесс
      updatedState.status = 'completed';
      updatedState.completedAt = new Date();
      
      await this.saveWorkflowState(taskId, updatedState);
      
      // Логируем завершение процесса
      await taskLogger.logInfo(taskId, `Рабочий процесс успешно завершен. Последний выполненный шаг: "${currentStep.name}"`);
      
      // Отправляем уведомление о завершении процесса
      this.notifyWorkflowUpdate(taskId, 'workflow_completed', updatedState);
      
      return {
        success: true,
        message: `Рабочий процесс успешно завершен. Последний выполненный шаг: "${currentStep.name}"`,
        workflowState: updatedState
      };
      
    } catch (error) {
      logger.error(`Ошибка при выполнении текущего шага для задачи #${taskId}:`, error);
      
      // Получаем текущее состояние для обновления
      const workflowState = await this.getWorkflowState(taskId);
      
      if (workflowState) {
        // Обновляем состояние с информацией об ошибке
        const updatedState = {
          ...workflowState,
          lastError: {
            message: error.message,
            step: workflowState.currentStepId,
            timestamp: new Date()
          },
          lastUpdated: new Date()
        };
        
        await this.saveWorkflowState(taskId, updatedState);
        
        // Логируем ошибку
        await taskLogger.logError(taskId, `Ошибка при выполнении шага "${workflowState.currentStepName}": ${error.message}`);
        
        // Отправляем уведомление об ошибке
        this.notifyWorkflowUpdate(taskId, 'step_error', updatedState);
      }
      
      return {
        success: false,
        message: `Ошибка при выполнении текущего шага: ${error.message}`,
        currentStep: workflowState ? workflowState.currentStepId : null,
        error: error.message
      };
    }
  }

  /**
   * Переходит к следующему шагу рабочего процесса
   * @param {number} taskId - ID задачи
   * @param {Object} manualStepData - Данные, полученные от ручного выполнения шага (опционально)
   * @returns {Promise<Object>} - Результат перехода
   */
  async moveToNextStep(taskId, manualStepData = {}) {
    try {
      logger.info(`Переход к следующему шагу для задачи #${taskId}`);
      
      // Получаем текущее состояние процесса
      const workflowState = await this.getWorkflowState(taskId);
      
      if (!workflowState) {
        throw new Error(`Рабочий процесс для задачи #${taskId} не найден`);
      }
      
      if (workflowState.status !== 'in_progress') {
        throw new Error(`Рабочий процесс для задачи #${taskId} имеет статус ${workflowState.status} и не может быть продолжен`);
      }
      
      // Находим информацию о текущем шаге
      const currentStepId = workflowState.currentStepId;
      const currentStep = this.steps.find(step => step.id === currentStepId);
      
      if (!currentStep) {
        throw new Error(`Шаг ${currentStepId} не найден в рабочем процессе`);
      }
      
      // Проверяем, есть ли следующий шаг
      if (!currentStep.nextStep) {
        // Завершаем процесс
        const updatedState = {
          ...workflowState,
          status: 'completed',
          completedAt: new Date(),
          stepResults: {
            ...workflowState.stepResults,
            [currentStepId]: manualStepData
          },
          completedSteps: [...workflowState.completedSteps, currentStepId],
          lastUpdated: new Date()
        };
        
        await this.saveWorkflowState(taskId, updatedState);
        
        // Логируем завершение процесса
        await taskLogger.logInfo(taskId, `Рабочий процесс успешно завершен. Последний выполненный шаг: "${currentStep.name}"`);
        
        // Отправляем уведомление о завершении процесса
        this.notifyWorkflowUpdate(taskId, 'workflow_completed', updatedState);
        
        return {
          success: true,
          message: `Рабочий процесс успешно завершен. Последний выполненный шаг: "${currentStep.name}"`,
          workflowState: updatedState
        };
      }
      
      // Переходим к следующему шагу
      const nextStepId = currentStep.nextStep;
      const nextStep = this.steps.find(step => step.id === nextStepId);
      
      // Обновляем состояние процесса
      const updatedState = {
        ...workflowState,
        currentStepId: nextStepId,
        currentStepName: nextStep.name,
        stepResults: {
          ...workflowState.stepResults,
          [currentStepId]: manualStepData
        },
        completedSteps: [...workflowState.completedSteps, currentStepId],
        lastUpdated: new Date()
      };
      
      await this.saveWorkflowState(taskId, updatedState);
      
      // Логируем завершение шага и переход к следующему
      await taskLogger.logInfo(taskId, `Шаг "${currentStep.name}" отмечен как выполненный. Следующий шаг: "${nextStep.name}"`);
      
      // Отправляем уведомление о переходе
      this.notifyWorkflowUpdate(taskId, 'step_changed', updatedState);
      
      // Если следующий шаг автоматический, выполняем его
      if (!nextStep.isManual) {
        return await this.executeCurrentStep(taskId);
      }
      
      return {
        success: true,
        message: `Переход к шагу "${nextStep.name}" успешно выполнен. Этот шаг требует ручного выполнения`,
        requiresManualAction: true,
        previousStep: currentStepId,
        currentStep: nextStepId,
        workflowState: updatedState
      };
      
    } catch (error) {
      logger.error(`Ошибка при переходе к следующему шагу для задачи #${taskId}:`, error);
      
      // Логируем ошибку
      await taskLogger.logError(taskId, `Ошибка при переходе к следующему шагу: ${error.message}`);
      
      return {
        success: false,
        message: `Ошибка при переходе к следующему шагу: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Получает информацию о состоянии рабочего процесса
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Информация о состоянии процесса
   */
  async getWorkflowStatus(taskId) {
    try {
      logger.debug(`Получение статуса рабочего процесса для задачи #${taskId}`);
      
      // Получаем текущее состояние процесса
      const workflowState = await this.getWorkflowState(taskId);
      
      if (!workflowState) {
        return {
          success: false,
          message: `Рабочий процесс для задачи #${taskId} не найден`,
          exists: false
        };
      }
      
      // Дополняем информацию о текущем шаге
      const currentStepId = workflowState.currentStepId;
      const currentStep = this.steps.find(step => step.id === currentStepId);
      
      if (currentStep) {
        return {
          success: true,
          exists: true,
          currentStep: {
            id: currentStep.id,
            name: currentStep.name,
            description: currentStep.description,
            isManual: currentStep.isManual,
            hasNextStep: !!currentStep.nextStep
          },
          status: workflowState.status,
          completedSteps: workflowState.completedSteps,
          startedAt: workflowState.startedAt,
          completedAt: workflowState.completedAt,
          lastUpdated: workflowState.lastUpdated,
          requiresManualAction: currentStep.isManual,
          workflowState
        };
      }
      
      return {
        success: true,
        exists: true,
        status: workflowState.status,
        message: 'Информация о текущем шаге недоступна',
        workflowState
      };
      
    } catch (error) {
      logger.error(`Ошибка при получении статуса рабочего процесса для задачи #${taskId}:`, error);
      
      return {
        success: false,
        message: `Ошибка при получении статуса рабочего процесса: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Получает информацию о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object|null>} - Информация о задаче или null
   * @private
   */
  async getTaskInfo(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      return tasks.length > 0 ? tasks[0] : null;
    } catch (error) {
      logger.error(`Ошибка при получении информации о задаче #${taskId}:`, error);
      return null;
    }
  }

  /**
   * Получает текущее состояние рабочего процесса
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object|null>} - Состояние процесса или null
   * @private
   */
  async getWorkflowState(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [metaResults] = await connection.query(
        'SELECT meta_value FROM task_meta WHERE task_id = ? AND meta_key = ?',
        [taskId, 'complete_workflow_state']
      );
      
      connection.release();
      
      if (metaResults.length === 0) {
        return null;
      }
      
      return JSON.parse(metaResults[0].meta_value);
    } catch (error) {
      logger.error(`Ошибка при получении состояния рабочего процесса для задачи #${taskId}:`, error);
      return null;
    }
  }

  /**
   * Сохраняет состояние рабочего процесса
   * @param {number} taskId - ID задачи
   * @param {Object} state - Состояние процесса
   * @returns {Promise<void>}
   * @private
   */
  async saveWorkflowState(taskId, state) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'INSERT INTO task_meta (task_id, meta_key, meta_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE meta_value = ?',
        [taskId, 'complete_workflow_state', JSON.stringify(state), JSON.stringify(state)]
      );
      
      connection.release();
      
      logger.debug(`Состояние рабочего процесса для задачи #${taskId} сохранено`);
    } catch (error) {
      logger.error(`Ошибка при сохранении состояния рабочего процесса для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Отправляет уведомление об изменении состояния рабочего процесса
   * @param {number} taskId - ID задачи
   * @param {string} eventType - Тип события
   * @param {Object} data - Данные для уведомления
   * @private
   */
  notifyWorkflowUpdate(taskId, eventType, data) {
    try {
      const wsServer = websocket.getInstance();
      
      if (!wsServer) {
        return;
      }
      
      wsServer.notifySubscribers('task', taskId, {
        type: eventType,
        data
      });
    } catch (error) {
      logger.error(`Ошибка при отправке уведомления о рабочем процессе для задачи #${taskId}:`, error);
    }
  }

  /**
   * Сбрасывает рабочий процесс к начальному состоянию
   * @param {number} taskId - ID задачи
   * @param {number} userId - ID пользователя
   * @returns {Promise<Object>} - Результат сброса
   */
  async resetWorkflow(taskId, userId) {
    try {
      logger.info(`Сброс рабочего процесса для задачи #${taskId} пользователем #${userId}`);
      
      // Проверяем существование задачи
      const task = await this.getTaskInfo(taskId);
      
      if (!task) {
        throw new Error(`Задача #${taskId} не найдена`);
      }
      
      // Получаем текущее состояние
      const existingWorkflow = await this.getWorkflowState(taskId);
      
      // Инициализируем новый процесс
      const resetState = {
        taskId,
        startedBy: userId,
        startedAt: new Date(),
        currentStepId: 'MORNING_PLANNING',
        currentStepName: 'Утреннее планирование',
        status: 'in_progress',
        completedSteps: [],
        stepResults: {},
        previousState: existingWorkflow ? {
          status: existingWorkflow.status,
          currentStepId: existingWorkflow.currentStepId,
          completedSteps: existingWorkflow.completedSteps
        } : null,
        resetAt: new Date(),
        resetBy: userId,
        lastUpdated: new Date()
      };
      
      // Сохраняем новое состояние
      await this.saveWorkflowState(taskId, resetState);
      
      // Логируем сброс процесса
      await taskLogger.logInfo(taskId, `Рабочий процесс сброшен пользователем #${userId}. Новый шаг: ${resetState.currentStepName}`);
      
      // Отправляем уведомление о сбросе
      this.notifyWorkflowUpdate(taskId, 'workflow_reset', resetState);
      
      return {
        success: true,
        message: `Рабочий процесс сброшен. Текущий шаг: ${resetState.currentStepName}`,
        currentStep: resetState.currentStepId,
        workflowState: resetState
      };
      
    } catch (error) {
      logger.error(`Ошибка при сбросе рабочего процесса для задачи #${taskId}:`, error);
      
      // Логируем ошибку
      await taskLogger.logError(taskId, `Ошибка при сбросе рабочего процесса: ${error.message}`);
      
      return {
        success: false,
        message: `Ошибка при сбросе рабочего процесса: ${error.message}`,
        error: error.message
      };
    }
  }

  // Обработчики для отдельных шагов процесса

  /**
   * Обрабатывает шаг утреннего планирования
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат обработки шага
   * @private
   */
  async handleMorningPlanning(taskId, workflowState) {
    // Этот шаг в основном ручной, поэтому просто логируем информацию
    logger.info(`Выполнение шага "Утреннее планирование" для задачи #${taskId}`);
    
    // Здесь может быть логика подготовки задачи к рабочему процессу
    // Например, обновление статуса задачи
    
    return {
      success: true,
      message: 'Шаг "Утреннее планирование" выполнен успешно',
      note: 'Этот шаг предназначен для ручного выполнения'
    };
  }

  /**
   * Обрабатывает шаг анализа задачи
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат анализа
   * @private
   */
  async handleTaskAnalysis(taskId, workflowState) {
    logger.info(`Выполнение шага "Анализ задачи" для задачи #${taskId}`);
    
    // Используем существующий TaskAnalyzer
    const analysis = await TaskAnalyzer.analyzeTask(taskId);
    
    // В случае успеха возвращаем результаты анализа
    if (analysis) {
      return {
        success: true,
        message: 'Анализ задачи успешно выполнен',
        analysis
      };
    }
    
    throw new Error('Не удалось выполнить анализ задачи');
  }

  /**
   * Обрабатывает шаг декомпозиции задачи
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат декомпозиции
   * @private
   */
  async handleTaskDecomposition(taskId, workflowState) {
    logger.info(`Выполнение шага "Разбивка на подзадачи" для задачи #${taskId}`);
    
    // Используем существующий TaskDecomposer
    const decompositionResult = await TaskDecomposer.decomposeTask(taskId);
    
    if (!decompositionResult.success) {
      throw new Error(`Ошибка при декомпозиции задачи: ${decompositionResult.message}`);
    }
    
    return {
      success: true,
      message: `Декомпозиция задачи успешно выполнена: ${decompositionResult.message}`,
      subtasks: decompositionResult.subtasks.length,
      estimatedHours: decompositionResult.estimatedHours,
      decompositionResult
    };
  }

  /**
   * Обрабатывает шаг создания внешних задач
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат создания задач
   * @private
   */
  async handleIssueCreation(taskId, workflowState) {
    logger.info(`Выполнение шага "Создание Issues/задач" для задачи #${taskId}`);
    
    // TODO: В будущем нужно реализовать интеграцию с внешними системами (GitHub, Jira)
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Задачи созданы внутри системы (без внешней интеграции)',
      note: 'Интеграция с внешними системами будет реализована в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг создания шаблонов кода
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат создания шаблонов
   * @private
   */
  async handleCodeScaffolding(taskId, workflowState) {
    logger.info(`Выполнение шага "Автоматическая разработка" для задачи #${taskId}`);
    
    // Получаем данные о задаче и подзадачах
    const connection = await pool.getConnection();
    
    const [task] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    const [subtasks] = await connection.query(
      'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
      [taskId]
    );
    
    connection.release();
    
    if (task.length === 0) {
      throw new Error(`Задача #${taskId} не найдена`);
    }
    
    if (subtasks.length === 0) {
      throw new Error(`Подзадачи для задачи #${taskId} не найдены. Необходимо выполнить шаг декомпозиции`);
    }
    
    // TODO: В будущем нужно реализовать полноценный генератор шаблонов кода
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: `Созданы шаблоны кода для ${subtasks.length} подзадач`,
      subtasksProcessed: subtasks.length,
      note: 'Полноценный генератор шаблонов кода будет реализован в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг генерации кода
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат генерации кода
   * @private
   */
  async handleCodeGeneration(taskId, workflowState) {
    logger.info(`Выполнение шага "Генерация кода" для задачи #${taskId}`);
    
    // Этот шаг требует реализации модуля CodeGenerator.
    // Пока возвращаем заглушку, которая будет заменена на реальную реализацию
    
    return {
      success: true,
      message: 'Генерация кода выполнена (заглушка)',
      note: 'Полноценный генератор кода будет реализован в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг самопроверки сгенерированного кода
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат самопроверки
   * @private
   */
  async handleSelfCheck(taskId, workflowState) {
    logger.info(`Выполнение шага "Самопроверка ИИ" для задачи #${taskId}`);
    
    // Требуется реализация модуля SelfCheck
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Самопроверка кода выполнена (заглушка)',
      note: 'Полноценная самопроверка будет реализована в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг создания pull request
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат создания PR
   * @private
   */
  async handlePRCreation(taskId, workflowState) {
    logger.info(`Выполнение шага "Создание pull request" для задачи #${taskId}`);
    
    // Требуется реализация модуля VCSManager
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Pull request создан (заглушка)',
      note: 'Полноценное создание pull request будет реализовано в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг проверки разработчиком
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат проверки
   * @private
   */
  async handleDeveloperReview(taskId, workflowState) {
    // Этот шаг ручной, поэтому просто логируем информацию
    logger.info(`Подготовка шага "Проверка разработчиком" для задачи #${taskId}`);
    
    return {
      success: true,
      message: 'Шаг "Проверка разработчиком" подготовлен',
      note: 'Этот шаг требует ручного выполнения разработчиком'
    };
  }

  /**
   * Обрабатывает шаг обработки обратной связи
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат обработки обратной связи
   * @private
   */
  async handleAIFeedback(taskId, workflowState) {
    logger.info(`Выполнение шага "Обратная связь для ИИ" для задачи #${taskId}`);
    
    // Требуется реализация модуля для обработки обратной связи
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Обратная связь обработана (заглушка)',
      note: 'Полноценная обработка обратной связи будет реализована в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг исправления ошибок
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат исправления ошибок
   * @private
   */
  async handleErrorCorrection(taskId, workflowState) {
    logger.info(`Выполнение шага "Исправление ошибок" для задачи #${taskId}`);
    
    // Требуется реализация модуля ErrorCorrector
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Исправления внесены (заглушка)',
      note: 'Полноценное исправление ошибок будет реализовано в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг финального утверждения
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат утверждения
   * @private
   */
  async handleFinalApproval(taskId, workflowState) {
    // Этот шаг ручной, поэтому просто логируем информацию
    logger.info(`Подготовка шага "Финальное утверждение" для задачи #${taskId}`);
    
    return {
      success: true,
      message: 'Шаг "Финальное утверждение" подготовлен',
      note: 'Этот шаг требует ручного выполнения разработчиком или менеджером'
    };
  }

  /**
   * Обрабатывает шаг слияния с основной веткой
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат слияния
   * @private
   */
  async handleMerge(taskId, workflowState) {
    logger.info(`Выполнение шага "Слияние с основной веткой" для задачи #${taskId}`);
    
    // Требуется реализация модуля VCSManager
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Изменения слиты с основной веткой (заглушка)',
      note: 'Полноценное слияние будет реализовано в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг обновления документации
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат обновления документации
   * @private
   */
  async handleDocUpdate(taskId, workflowState) {
    logger.info(`Выполнение шага "Обновление документации" для задачи #${taskId}`);
    
    // Требуется реализация модуля DocumentationUpdater
    // Пока возвращаем заглушку
    
    return {
      success: true,
      message: 'Документация обновлена (заглушка)',
      note: 'Полноценное обновление документации будет реализовано в следующих версиях'
    };
  }

  /**
   * Обрабатывает шаг создания отчета о прогрессе
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат создания отчета
   * @private
   */
  async handleProgressReport(taskId, workflowState) {
    logger.info(`Выполнение шага "Отчет о прогрессе" для задачи #${taskId}`);
    
    // Генерация отчета на основе истории выполнения шагов
    try {
      // Получаем все результаты выполненных шагов
      const stepResults = workflowState.stepResults || {};
      const completedSteps = workflowState.completedSteps || [];
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      if (!task) {
        throw new Error(`Задача #${taskId} не найдена`);
      }
      
      // Формируем отчет
      const report = {
        taskId,
        taskTitle: task.title,
        taskDescription: task.description,
        workflowStartedAt: workflowState.startedAt,
        workflowLastUpdated: workflowState.lastUpdated,
        completedSteps: completedSteps.map(stepId => {
          const step = this.steps.find(s => s.id === stepId);
          return {
            id: stepId,
            name: step ? step.name : stepId,
            result: stepResults[stepId] ? (stepResults[stepId].message || 'Выполнено') : 'Нет данных'
          };
        }),
        currentStep: workflowState.currentStepName,
        totalSteps: this.steps.length,
        completedStepsCount: completedSteps.length,
        progress: Math.round((completedSteps.length / this.steps.length) * 100),
        status: workflowState.status
      };
      
      // Сохраняем отчет в meta
      const connection = await pool.getConnection();
      
      await connection.query(
        'INSERT INTO task_meta (task_id, meta_key, meta_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE meta_value = ?',
        [taskId, 'progress_report', JSON.stringify(report), JSON.stringify(report)]
      );
      
      connection.release();
      
      return {
        success: true,
        message: 'Отчет о прогрессе сформирован',
        report
      };
    } catch (error) {
      logger.error(`Ошибка при формировании отчета о прогрессе для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Обрабатывает шаг вечернего анализа
   * @param {number} taskId - ID задачи
   * @param {Object} workflowState - Текущее состояние процесса
   * @returns {Promise<Object>} - Результат анализа
   * @private
   */
  async handleEveningAnalysis(taskId, workflowState) {
    // Этот шаг в основном ручной, поэтому просто логируем информацию
    logger.info(`Подготовка шага "Вечерний анализ" для задачи #${taskId}`);
    
    return {
      success: true,
      message: 'Шаг "Вечерний анализ" подготовлен',
      note: 'Этот шаг требует ручного выполнения'
    };
  }
}

module.exports = new TaskCompleteWorkflow();
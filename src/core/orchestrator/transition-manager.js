/**
 * @fileoverview Transition Manager отвечает за определение порядка выполнения шагов
 * и правил перехода между ними. Он работает в тесной связке с StateManager
 * и предоставляет информацию о том, какой шаг должен выполняться следующим
 * на основе текущего состояния задачи, результатов предыдущих шагов и внешних факторов.
 */

const logger = require('../../utils/logger');
const { TASK_STATES } = require('./state-manager');

/**
 * Определение маппинга между состояниями задачи и шагами методологии.
 * Это маппинг используется для определения, какой StepExecutor должен быть вызван для каждого состояния.
 */
const STATE_TO_STEP_MAPPING = {
  // Шаг 1: Понимание задачи
  [TASK_STATES.TASK_UNDERSTANDING]: 'taskUnderstanding',
  
  // Шаг 2: Анализ контекста проекта
  [TASK_STATES.PROJECT_UNDERSTANDING]: 'projectUnderstanding',
  
  // Шаг 3: Планирование и декомпозиция
  [TASK_STATES.TASK_PLANNING]: 'taskPlanner',
  
  // Шаг 4: Выбор подхода и технологий
  [TASK_STATES.TECHNOLOGY_SELECTION]: 'technologySuggester',
  
  // Шаг 5: Генерация кода
  [TASK_STATES.CODE_GENERATION]: 'codeGenerator',
  
  // Шаг 6: Итеративное уточнение кода
  [TASK_STATES.CODE_REFINEMENT]: 'codeRefiner',
  
  // Шаг 7: Саморефлексия и ревью кода
  [TASK_STATES.SELF_REVIEW]: 'selfReflection',
  
  // Шаг 8: Исправление ошибок
  [TASK_STATES.ERROR_CORRECTION]: 'errorCorrector',
  
  // Шаг 9: Генерация тестов
  [TASK_STATES.TEST_GENERATION]: 'testGenerator',
  
  // Шаг 10: Запуск кода и тестов
  [TASK_STATES.CODE_EXECUTION]: 'codeExecutor',
  
  // Шаг 11: Анализ результатов тестов
  [TASK_STATES.TEST_ANALYSIS]: 'testAnalyzer',
  
  // Шаг 12: Генерация/обновление документации
  [TASK_STATES.DOCUMENTATION_UPDATE]: 'documentationUpdater',
  
  // Шаг 13: Обучение и обновление знаний
  [TASK_STATES.LEARNING_UPDATE]: 'learningSystem',
  
  // Шаг 14: Подготовка к мержу (PR)
  [TASK_STATES.PR_PREPARATION]: 'prManager',
  
  // Шаг 15: Интеграция обратной связи
  [TASK_STATES.FEEDBACK_INTEGRATION]: 'feedbackIntegrator',
};

/**
 * Определение следующего состояния для каждого состояния "completed"
 */
const COMPLETED_STATE_TRANSITIONS = {
  [TASK_STATES.TASK_UNDERSTANDING_COMPLETED]: TASK_STATES.PROJECT_UNDERSTANDING,
  [TASK_STATES.PROJECT_UNDERSTANDING_COMPLETED]: TASK_STATES.TASK_PLANNING,
  [TASK_STATES.TASK_PLANNING_COMPLETED]: TASK_STATES.TECHNOLOGY_SELECTION,
  [TASK_STATES.TECHNOLOGY_SELECTION_COMPLETED]: TASK_STATES.CODE_GENERATION,
  [TASK_STATES.CODE_GENERATION_COMPLETED]: TASK_STATES.CODE_REFINEMENT,
  [TASK_STATES.CODE_REFINEMENT_COMPLETED]: TASK_STATES.SELF_REVIEW,
  // Для SELF_REVIEW_COMPLETED есть два пути - ERROR_CORRECTION или TEST_GENERATION, 
  // решение принимается динамически
  // Для ERROR_CORRECTION_COMPLETED есть два пути - SELF_REVIEW или TEST_GENERATION,
  // решение принимается динамически
  [TASK_STATES.TEST_GENERATION_COMPLETED]: TASK_STATES.CODE_EXECUTION,
  [TASK_STATES.CODE_EXECUTION_COMPLETED]: TASK_STATES.TEST_ANALYSIS,
  // Для TEST_ANALYSIS_COMPLETED есть два пути - ERROR_CORRECTION или DOCUMENTATION_UPDATE,
  // решение принимается динамически
  [TASK_STATES.DOCUMENTATION_UPDATE_COMPLETED]: TASK_STATES.LEARNING_UPDATE,
  [TASK_STATES.LEARNING_UPDATE_COMPLETED]: TASK_STATES.PR_PREPARATION,
  // Для PR_PREPARATION_COMPLETED есть два пути - FEEDBACK_INTEGRATION или COMPLETED,
  // решение принимается динамически
  // Для FEEDBACK_INTEGRATION_COMPLETED есть несколько путей, решение принимается динамически
};

/**
 * Класс управления переходами между шагами методологии.
 */
class TransitionManager {
  /**
   * Создает экземпляр TransitionManager.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.stateManager - Экземпляр StateManager.
   * @param {Object} options.contextManager - Экземпляр ContextManager.
   */
  constructor({ stateManager, contextManager } = {}) {
    this.stateManager = stateManager;
    this.contextManager = contextManager;
  }

  /**
   * Получает имя шага для выполнения в заданном состоянии.
   * @param {string} state - Состояние задачи.
   * @returns {string|null} - Имя шага или null, если для состояния нет соответствующего шага.
   */
  getStepForState(state) {
    return STATE_TO_STEP_MAPPING[state] || null;
  }

  /**
   * Определяет следующее состояние на основе текущего состояния и результатов предыдущих шагов.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} currentState - Текущее состояние задачи.
   * @returns {Promise<string>} - Следующее состояние.
   */
  async determineNextState(taskId, currentState) {
    logger.debug(`Determining next state for task ${taskId} from current state ${currentState}`);
    
    try {
      // Для состояний "completed" используем предопределенное следующее состояние
      if (COMPLETED_STATE_TRANSITIONS[currentState]) {
        return COMPLETED_STATE_TRANSITIONS[currentState];
      }
      
      // Для остальных состояний используем логику, зависящую от контекста и результатов
      
      // Получаем контекст задачи
      const context = this.contextManager ? await this.contextManager.getContext(taskId) : null;
      
      // Если контекст недоступен, выбрасываем ошибку
      if (!context) {
        throw new Error(`Context not available for task ${taskId}`);
      }
      
      // Специальная логика для определения пути после завершения Self Review
      if (currentState === TASK_STATES.SELF_REVIEW_COMPLETED) {
        const selfReviewResult = context.stepResults.selfReflection;
        
        // Если в результате ревью найдены ошибки, отправляем на исправление
        if (selfReviewResult && (
          selfReviewResult.issuesFound || 
          selfReviewResult.errorsFound || 
          (selfReviewResult.score && selfReviewResult.score < 0.7)
        )) {
          return TASK_STATES.ERROR_CORRECTION;
        }
        
        // Иначе переходим к генерации тестов
        return TASK_STATES.TEST_GENERATION;
      }
      
      // Специальная логика для определения пути после завершения Error Correction
      if (currentState === TASK_STATES.ERROR_CORRECTION_COMPLETED) {
        const errorCorrectionResult = context.stepResults.errorCorrector;
        
        // Если исправления были значительными, отправляем на повторное ревью
        if (errorCorrectionResult && (
          errorCorrectionResult.significantChanges || 
          errorCorrectionResult.needsReview
        )) {
          return TASK_STATES.SELF_REVIEW;
        }
        
        // Иначе переходим к генерации тестов
        return TASK_STATES.TEST_GENERATION;
      }
      
      // Специальная логика для определения пути после завершения Test Analysis
      if (currentState === TASK_STATES.TEST_ANALYSIS_COMPLETED) {
        const testAnalysisResult = context.stepResults.testAnalyzer;
        
        // Если тесты выявили ошибки, отправляем на исправление
        if (testAnalysisResult && (
          testAnalysisResult.failedTests || 
          testAnalysisResult.errorsFound
        )) {
          return TASK_STATES.ERROR_CORRECTION;
        }
        
        // Иначе переходим к обновлению документации
        return TASK_STATES.DOCUMENTATION_UPDATE;
      }
      
      // Специальная логика для определения пути после завершения PR Preparation
      if (currentState === TASK_STATES.PR_PREPARATION_COMPLETED) {
        const prResult = context.stepResults.prManager;
        
        // Если PR был создан и требуется обработка обратной связи
        if (prResult && prResult.prCreated && prResult.waitForReview) {
          return TASK_STATES.FEEDBACK_INTEGRATION;
        }
        
        // Иначе задача считается завершенной
        return TASK_STATES.COMPLETED;
      }
      
      // Специальная логика для определения пути после завершения Feedback Integration
      if (currentState === TASK_STATES.FEEDBACK_INTEGRATION_COMPLETED) {
        const feedbackResult = context.stepResults.feedbackIntegrator;
        
        // Если обратная связь требует существенных изменений в коде
        if (feedbackResult && feedbackResult.requiresCodeChanges) {
          return TASK_STATES.CODE_GENERATION;
        }
        
        // Если требуется обновить PR
        if (feedbackResult && feedbackResult.requiresPrUpdate) {
          return TASK_STATES.PR_PREPARATION;
        }
        
        // Иначе задача считается завершенной
        return TASK_STATES.COMPLETED;
      }
      
      // Для обработки возврата из PAUSED состояния
      if (currentState === TASK_STATES.PAUSED) {
        // Если в контексте есть информация о предыдущем состоянии
        const lastTransition = await this.stateManager.getLastTransition(taskId);
        if (lastTransition && lastTransition.fromState && 
            lastTransition.fromState !== TASK_STATES.PAUSED) {
          return lastTransition.fromState;
        }
        
        // Если нет информации, возвращаемся в начало
        return TASK_STATES.INITIALIZED;
      }
      
      // Для обработки возврата из WAITING_FOR_INPUT состояния
      if (currentState === TASK_STATES.WAITING_FOR_INPUT) {
        // Если в контексте есть информация о следующем состоянии
        if (context.data && context.data.nextStateAfterInput) {
          return context.data.nextStateAfterInput;
        }
        
        // Если нет информации, возвращаемся к текущему активному шагу
        const lastActiveState = context.history
          .filter(h => h.state !== TASK_STATES.WAITING_FOR_INPUT && h.state !== TASK_STATES.PAUSED)
          .pop();
          
        return lastActiveState ? lastActiveState.state : TASK_STATES.INITIALIZED;
      }
      
      // Для неизвестных состояний возвращаем INITIALIZED
      logger.warn(`No transition rule defined for state ${currentState}, returning to INITIALIZED`);
      return TASK_STATES.INITIALIZED;
    } catch (error) {
      logger.error(`Error determining next state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Выполняет переход к следующему состоянию.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} [customNextState=null] - Кастомное следующее состояние (если null, определяется автоматически).
   * @param {string} [message=''] - Сообщение о переходе.
   * @param {Object} [metadata={}] - Дополнительные данные о переходе.
   * @returns {Promise<Object>} - Результат операции.
   */
  async transitionToNextState(taskId, customNextState = null, message = '', metadata = {}) {
    logger.info(`Transitioning to next state for task ${taskId}`);
    
    try {
      // Получаем текущее состояние
      const currentState = await this.stateManager.getCurrentState(taskId);
      
      // Определяем следующее состояние (если не задано явно)
      const nextState = customNextState || await this.determineNextState(taskId, currentState);
      
      // Обновляем состояние
      const result = await this.stateManager.updateState(taskId, nextState, message, metadata);
      
      logger.info(`Transitioned task ${taskId} from ${currentState} to ${nextState}`);
      
      return {
        ...result,
        step: this.getStepForState(nextState)
      };
    } catch (error) {
      logger.error(`Error transitioning to next state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Форсирует переход в состояние ошибки.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} errorMessage - Сообщение об ошибке.
   * @param {Object} errorDetails - Детали ошибки.
   * @returns {Promise<Object>} - Результат операции.
   */
  async transitionToError(taskId, errorMessage, errorDetails = {}) {
    logger.error(`Transitioning task ${taskId} to error state: ${errorMessage}`);
    
    try {
      // Обновляем состояние на FAILED
      const result = await this.stateManager.updateState(
        taskId, 
        TASK_STATES.FAILED, 
        errorMessage, 
        { error: errorDetails }
      );
      
      return result;
    } catch (error) {
      logger.error(`Error transitioning to error state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Форсирует переход в состояние ожидания ввода пользователя.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} message - Сообщение для пользователя.
   * @param {string} nextStateAfterInput - Состояние, в которое нужно перейти после получения ввода.
   * @returns {Promise<Object>} - Результат операции.
   */
  async transitionToWaitingForInput(taskId, message, nextStateAfterInput) {
    logger.info(`Transitioning task ${taskId} to waiting for input state`);
    
    try {
      // Сохраняем информацию о следующем состоянии в контексте
      if (this.contextManager) {
        await this.contextManager.updateContext(
          taskId, 
          'data.nextStateAfterInput', 
          nextStateAfterInput
        );
      }
      
      // Обновляем состояние на WAITING_FOR_INPUT
      const result = await this.stateManager.updateState(
        taskId, 
        TASK_STATES.WAITING_FOR_INPUT, 
        message, 
        { nextStateAfterInput }
      );
      
      return result;
    } catch (error) {
      logger.error(`Error transitioning to waiting for input state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает имя шага, который должен выполняться следующим.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<string>} - Имя шага.
   */
  async getNextStep(taskId) {
    logger.debug(`Getting next step for task ${taskId}`);
    
    try {
      // Получаем текущее состояние
      const currentState = await this.stateManager.getCurrentState(taskId);
      
      // Если текущее состояние уже соответствует шагу, возвращаем его
      const currentStep = this.getStepForState(currentState);
      if (currentStep) {
        return currentStep;
      }
      
      // Иначе определяем следующее состояние и соответствующий ему шаг
      const nextState = await this.determineNextState(taskId, currentState);
      return this.getStepForState(nextState);
    } catch (error) {
      logger.error(`Error getting next step for task ${taskId}:`, error);
      throw error;
    }
  }
}

module.exports = {
  TransitionManager,
  STATE_TO_STEP_MAPPING,
  COMPLETED_STATE_TRANSITIONS
};
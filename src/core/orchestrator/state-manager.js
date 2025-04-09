/**
 * @fileoverview State Manager отвечает за управление состоянием выполнения задачи.
 * Он определяет допустимые состояния, переходы между ними и обеспечивает атомарное
 * обновление состояния в базе данных. StateManager тесно связан с ContextManager
 * и TransitionManager для обеспечения целостности процесса выполнения.
 */

const logger = require('../../utils/logger');
const { ValidationManager } = require('./validation-manager');
const { StateTransitionSchema } = require('./contracts');

// Определение возможных состояний выполнения задачи
const TASK_STATES = {
  // Начальные состояния
  INITIALIZED: 'initialized',
  
  // Состояния по шагам методологии
  TASK_UNDERSTANDING: 'task_understanding',
  TASK_UNDERSTANDING_COMPLETED: 'task_understanding_completed',
  
  PROJECT_UNDERSTANDING: 'project_understanding',
  PROJECT_UNDERSTANDING_COMPLETED: 'project_understanding_completed',
  
  TASK_PLANNING: 'task_planning',
  TASK_PLANNING_COMPLETED: 'task_planning_completed',
  
  TECHNOLOGY_SELECTION: 'technology_selection',
  TECHNOLOGY_SELECTION_COMPLETED: 'technology_selection_completed',
  
  CODE_GENERATION: 'code_generation',
  CODE_GENERATION_COMPLETED: 'code_generation_completed',
  
  CODE_REFINEMENT: 'code_refinement',
  CODE_REFINEMENT_COMPLETED: 'code_refinement_completed',
  
  SELF_REVIEW: 'self_review',
  SELF_REVIEW_COMPLETED: 'self_review_completed',
  
  ERROR_CORRECTION: 'error_correction',
  ERROR_CORRECTION_COMPLETED: 'error_correction_completed',
  
  TEST_GENERATION: 'test_generation',
  TEST_GENERATION_COMPLETED: 'test_generation_completed',
  
  CODE_EXECUTION: 'code_execution',
  CODE_EXECUTION_COMPLETED: 'code_execution_completed',
  
  TEST_ANALYSIS: 'test_analysis',
  TEST_ANALYSIS_COMPLETED: 'test_analysis_completed',
  
  DOCUMENTATION_UPDATE: 'documentation_update',
  DOCUMENTATION_UPDATE_COMPLETED: 'documentation_update_completed',
  
  LEARNING_UPDATE: 'learning_update',
  LEARNING_UPDATE_COMPLETED: 'learning_update_completed',
  
  PR_PREPARATION: 'pr_preparation',
  PR_PREPARATION_COMPLETED: 'pr_preparation_completed',
  
  FEEDBACK_INTEGRATION: 'feedback_integration',
  FEEDBACK_INTEGRATION_COMPLETED: 'feedback_integration_completed',
  
  // Финальные состояния
  COMPLETED: 'completed',
  FAILED: 'failed',
  
  // Специальные состояния
  PAUSED: 'paused',
  WAITING_FOR_INPUT: 'waiting_for_input',
  RECOVERING: 'recovering',
};

/**
 * Класс управления состоянием выполнения задачи.
 */
class StateManager {
  /**
   * Создает экземпляр StateManager.
   * @param {Object} options - Опции для инициализации.
   * @param {Object} options.db - Интерфейс к базе данных.
   * @param {Object} options.contextManager - Экземпляр ContextManager.
   */
  constructor({ db, contextManager } = {}) {
    this.db = db;
    this.contextManager = contextManager;
    this.validator = new ValidationManager();
  }

  /**
   * Получает текущее состояние задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<string>} - Текущее состояние.
   */
  async getCurrentState(taskId) {
    logger.debug(`Getting current state for task: ${taskId}`);
    
    try {
      // Пытаемся получить состояние из контекста
      if (this.contextManager) {
        const context = await this.contextManager.getContext(taskId);
        return context.currentState;
      }
      
      // Если contextManager недоступен, получаем состояние из БД
      if (this.db) {
        const taskState = await this.db.TaskState.findOne({
          where: { taskId },
          order: [['createdAt', 'DESC']]
        });
        
        if (taskState) {
          return taskState.state;
        }
      }
      
      logger.error(`State not found for task: ${taskId}`);
      throw new Error(`State not found for task: ${taskId}`);
    } catch (error) {
      logger.error(`Error getting current state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Проверяет, является ли переход состояния допустимым.
   * @param {string} currentState - Текущее состояние.
   * @param {string} nextState - Следующее состояние.
   * @returns {boolean} - true если переход допустим.
   */
  isValidTransition(currentState, nextState) {
    // Базовые проверки
    if (!currentState || !nextState) {
      return false;
    }
    
    // Можно перейти в состояние FAILED из любого состояния
    if (nextState === TASK_STATES.FAILED) {
      return true;
    }
    
    // Можно перейти в состояние PAUSED из любого состояния, кроме финальных
    if (nextState === TASK_STATES.PAUSED && 
        currentState !== TASK_STATES.COMPLETED && 
        currentState !== TASK_STATES.FAILED) {
      return true;
    }
    
    // Можно перейти в состояние WAITING_FOR_INPUT из любого состояния, кроме финальных
    if (nextState === TASK_STATES.WAITING_FOR_INPUT && 
        currentState !== TASK_STATES.COMPLETED && 
        currentState !== TASK_STATES.FAILED) {
      return true;
    }
    
    // Проверяем валидные переходы между состояниями шагов
    const validTransitions = {
      [TASK_STATES.INITIALIZED]: [TASK_STATES.TASK_UNDERSTANDING],
      
      [TASK_STATES.TASK_UNDERSTANDING]: [TASK_STATES.TASK_UNDERSTANDING_COMPLETED],
      [TASK_STATES.TASK_UNDERSTANDING_COMPLETED]: [TASK_STATES.PROJECT_UNDERSTANDING],
      
      [TASK_STATES.PROJECT_UNDERSTANDING]: [TASK_STATES.PROJECT_UNDERSTANDING_COMPLETED],
      [TASK_STATES.PROJECT_UNDERSTANDING_COMPLETED]: [TASK_STATES.TASK_PLANNING],
      
      [TASK_STATES.TASK_PLANNING]: [TASK_STATES.TASK_PLANNING_COMPLETED],
      [TASK_STATES.TASK_PLANNING_COMPLETED]: [TASK_STATES.TECHNOLOGY_SELECTION],
      
      [TASK_STATES.TECHNOLOGY_SELECTION]: [TASK_STATES.TECHNOLOGY_SELECTION_COMPLETED],
      [TASK_STATES.TECHNOLOGY_SELECTION_COMPLETED]: [TASK_STATES.CODE_GENERATION],
      
      [TASK_STATES.CODE_GENERATION]: [TASK_STATES.CODE_GENERATION_COMPLETED],
      [TASK_STATES.CODE_GENERATION_COMPLETED]: [TASK_STATES.CODE_REFINEMENT],
      
      [TASK_STATES.CODE_REFINEMENT]: [TASK_STATES.CODE_REFINEMENT_COMPLETED],
      [TASK_STATES.CODE_REFINEMENT_COMPLETED]: [TASK_STATES.SELF_REVIEW],
      
      [TASK_STATES.SELF_REVIEW]: [TASK_STATES.SELF_REVIEW_COMPLETED],
      [TASK_STATES.SELF_REVIEW_COMPLETED]: [TASK_STATES.ERROR_CORRECTION, TASK_STATES.TEST_GENERATION],
      
      [TASK_STATES.ERROR_CORRECTION]: [TASK_STATES.ERROR_CORRECTION_COMPLETED],
      [TASK_STATES.ERROR_CORRECTION_COMPLETED]: [
        TASK_STATES.SELF_REVIEW, 
        TASK_STATES.TEST_GENERATION
      ],
      
      [TASK_STATES.TEST_GENERATION]: [TASK_STATES.TEST_GENERATION_COMPLETED],
      [TASK_STATES.TEST_GENERATION_COMPLETED]: [TASK_STATES.CODE_EXECUTION],
      
      [TASK_STATES.CODE_EXECUTION]: [TASK_STATES.CODE_EXECUTION_COMPLETED],
      [TASK_STATES.CODE_EXECUTION_COMPLETED]: [TASK_STATES.TEST_ANALYSIS],
      
      [TASK_STATES.TEST_ANALYSIS]: [TASK_STATES.TEST_ANALYSIS_COMPLETED],
      [TASK_STATES.TEST_ANALYSIS_COMPLETED]: [
        TASK_STATES.ERROR_CORRECTION, 
        TASK_STATES.DOCUMENTATION_UPDATE
      ],
      
      [TASK_STATES.DOCUMENTATION_UPDATE]: [TASK_STATES.DOCUMENTATION_UPDATE_COMPLETED],
      [TASK_STATES.DOCUMENTATION_UPDATE_COMPLETED]: [TASK_STATES.LEARNING_UPDATE],
      
      [TASK_STATES.LEARNING_UPDATE]: [TASK_STATES.LEARNING_UPDATE_COMPLETED],
      [TASK_STATES.LEARNING_UPDATE_COMPLETED]: [TASK_STATES.PR_PREPARATION],
      
      [TASK_STATES.PR_PREPARATION]: [TASK_STATES.PR_PREPARATION_COMPLETED],
      [TASK_STATES.PR_PREPARATION_COMPLETED]: [TASK_STATES.FEEDBACK_INTEGRATION, TASK_STATES.COMPLETED],
      
      [TASK_STATES.FEEDBACK_INTEGRATION]: [TASK_STATES.FEEDBACK_INTEGRATION_COMPLETED],
      [TASK_STATES.FEEDBACK_INTEGRATION_COMPLETED]: [
        TASK_STATES.CODE_GENERATION, 
        TASK_STATES.PR_PREPARATION,
        TASK_STATES.COMPLETED
      ],
      
      // Возврат из PAUSED в предыдущее состояние (будет проверяться динамически)
      [TASK_STATES.PAUSED]: Object.values(TASK_STATES).filter(
        state => state !== TASK_STATES.PAUSED && 
                state !== TASK_STATES.COMPLETED && 
                state !== TASK_STATES.FAILED
      ),
      
      // Возврат из WAITING_FOR_INPUT в следующее состояние (будет проверяться динамически)
      [TASK_STATES.WAITING_FOR_INPUT]: Object.values(TASK_STATES).filter(
        state => state !== TASK_STATES.WAITING_FOR_INPUT && 
                state !== TASK_STATES.COMPLETED && 
                state !== TASK_STATES.FAILED
      ),
      
      // Восстановление после сбоя
      [TASK_STATES.RECOVERING]: Object.values(TASK_STATES).filter(
        state => state !== TASK_STATES.RECOVERING && 
                state !== TASK_STATES.FAILED
      ),
    };
    
    // Проверяем, есть ли текущее состояние в списке валидных переходов
    if (!validTransitions[currentState]) {
      logger.warn(`No valid transitions defined for state: ${currentState}`);
      return false;
    }
    
    // Проверяем, есть ли следующее состояние в списке валидных переходов для текущего состояния
    return validTransitions[currentState].includes(nextState);
  }

  /**
   * Обновляет состояние задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @param {string} nextState - Новое состояние.
   * @param {string} message - Сообщение о смене состояния.
   * @param {Object} metadata - Дополнительные данные о смене состояния.
   * @returns {Promise<Object>} - Результат операции.
   */
  async updateState(taskId, nextState, message = '', metadata = {}) {
    logger.info(`Updating state for task ${taskId} to ${nextState}`);
    
    try {
      // Получаем текущее состояние
      const currentState = await this.getCurrentState(taskId);
      
      // Проверяем допустимость перехода
      if (!this.isValidTransition(currentState, nextState)) {
        const error = `Invalid state transition from ${currentState} to ${nextState} for task ${taskId}`;
        logger.error(error);
        throw new Error(error);
      }
      
      // Подготавливаем данные о переходе состояния
      const transition = {
        taskId,
        fromState: currentState,
        toState: nextState,
        message,
        metadata: JSON.stringify(metadata),
        timestamp: new Date()
      };
      
      // Валидация перехода
      const validationResult = this.validator.validate(transition, StateTransitionSchema);
      if (!validationResult.valid) {
        logger.error(`Invalid state transition for task ${taskId}:`, validationResult.errors);
        throw new Error(`Failed to update state: ${validationResult.errors.join(', ')}`);
      }
      
      // Начинаем транзакцию БД для атомарного обновления
      let transaction;
      if (this.db) {
        transaction = await this.db.sequelize.transaction();
      }
      
      try {
        // Обновляем состояние в БД (если доступно)
        if (this.db) {
          // Записываем новое состояние
          await this.db.TaskState.create({
            taskId,
            state: nextState,
            previousState: currentState,
            message,
            metadata: JSON.stringify(metadata),
            createdAt: new Date()
          }, { transaction });
          
          // Записываем историю переходов
          await this.db.TaskStateTransition.create(transition, { transaction });
          
          // Обновляем текущее состояние в таблице задач
          await this.db.Task.update(
            { 
              currentState: nextState,
              updatedAt: new Date()
            },
            { 
              where: { id: taskId },
              transaction
            }
          );
          
          // Фиксируем транзакцию
          await transaction.commit();
        }
        
        // Обновляем состояние в контексте (если contextManager доступен)
        if (this.contextManager) {
          await this.contextManager.updateState(taskId, nextState, message);
        }
        
        logger.info(`Successfully updated state for task ${taskId} to ${nextState}`);
        
        return {
          success: true,
          taskId,
          previousState: currentState,
          currentState: nextState,
          timestamp: new Date()
        };
      } catch (error) {
        // Откатываем транзакцию в случае ошибки
        if (transaction) {
          await transaction.rollback();
        }
        
        logger.error(`Error during state update transaction for task ${taskId}:`, error);
        throw error;
      }
    } catch (error) {
      logger.error(`Failed to update state for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает историю состояний задачи.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Array>} - История состояний.
   */
  async getStateHistory(taskId) {
    logger.debug(`Getting state history for task: ${taskId}`);
    
    try {
      // Пытаемся получить историю из контекста
      if (this.contextManager) {
        const context = await this.contextManager.getContext(taskId);
        return context.history || [];
      }
      
      // Если contextManager недоступен, получаем историю из БД
      if (this.db) {
        const stateTransitions = await this.db.TaskStateTransition.findAll({
          where: { taskId },
          order: [['timestamp', 'ASC']]
        });
        
        return stateTransitions.map(transition => ({
          timestamp: transition.timestamp,
          fromState: transition.fromState,
          toState: transition.toState,
          message: transition.message,
          metadata: JSON.parse(transition.metadata || '{}')
        }));
      }
      
      logger.error(`State history not found for task: ${taskId}`);
      throw new Error(`State history not found for task: ${taskId}`);
    } catch (error) {
      logger.error(`Error getting state history for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает данные о последнем переходе состояния.
   * @param {string} taskId - Идентификатор задачи.
   * @returns {Promise<Object>} - Данные о последнем переходе.
   */
  async getLastTransition(taskId) {
    logger.debug(`Getting last transition for task: ${taskId}`);
    
    try {
      // Получаем историю состояний
      const history = await this.getStateHistory(taskId);
      
      // Возвращаем последний переход
      return history[history.length - 1] || null;
    } catch (error) {
      logger.error(`Error getting last transition for task ${taskId}:`, error);
      throw error;
    }
  }
}

module.exports = { 
  StateManager,
  TASK_STATES
};
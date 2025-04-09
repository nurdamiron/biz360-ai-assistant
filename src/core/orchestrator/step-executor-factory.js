/**
 * @fileoverview Фабрика для создания экземпляров исполнителей шагов методологии.
 * Она инстанцирует соответствующий класс StepExecutor в зависимости от названия шага
 * и предоставляет ему необходимые зависимости.
 */

const logger = require('../../utils/logger');
const { StepExecutor } = require('./step-executor');

/**
 * Фабрика для создания исполнителей шагов.
 */
class StepExecutorFactory {
  /**
   * Создает экземпляр StepExecutorFactory.
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
    this.contextManager = contextManager;
    this.stateManager = stateManager;
    this.notificationManager = notificationManager;
    this.db = db;
    this.llmClient = llmClient;
    this.promptManager = promptManager;
    
    // Регистрируем исполнителей шагов
    this.executors = {};
    this._registerExecutors();
  }

  /**
   * Регистрирует исполнителей шагов.
   * @private
   */
  _registerExecutors() {
    try {
      // Здесь регистрируются все доступные исполнители шагов
      this.executors = {
        // Шаг 1: Понимание задачи
        'taskUnderstanding': require('./step-executors/task-understanding-executor'),
        
        // Шаг 2: Анализ контекста проекта
        'projectUnderstanding': require('./step-executors/project-understanding-executor'),
        
        // Шаг 3: Планирование и декомпозиция
        'taskPlanner': require('./step-executors/task-planner-executor'),
        
        // Шаг 4: Выбор подхода и технологий
        'technologySuggester': require('./step-executors/technology-suggester-executor'),
        
        // Шаг 5: Генерация кода
        'codeGenerator': require('./step-executors/code-generator-executor'),
        
        // Шаг 6: Итеративное уточнение кода
        'codeRefiner': require('./step-executors/code-refiner-executor'),
        
        // Шаг 7: Саморефлексия и ревью кода
        'selfReflection': require('./step-executors/self-reflection-executor'),
        
        // Шаг 8: Исправление ошибок
        'errorCorrector': require('./step-executors/error-corrector-executor'),
        
        // Шаг 9: Генерация тестов
        'testGenerator': require('./step-executors/test-generator-executor'),
        
        // Шаг 10: Запуск кода и тестов
        'codeExecutor': require('./step-executors/code-executor-executor'),
        
        // Шаг 11: Анализ результатов тестов
        'testAnalyzer': require('./step-executors/test-analyzer-executor'),
        
        // Шаг 12: Генерация/обновление документации
        'documentationUpdater': require('./step-executors/documentation-updater-executor'),
        
        // Шаг 13: Обучение и обновление знаний
        'learningSystem': require('./step-executors/learning-system-executor'),
        
        // Шаг 14: Подготовка к мержу (PR)
        'prManager': require('./step-executors/pr-manager-executor'),
        
        // Шаг 15: Интеграция обратной связи
        'feedbackIntegrator': require('./step-executors/feedback-integrator-executor')
      };
    } catch (error) {
      // Логируем ошибку, но не прерываем инициализацию
      logger.error('Error registering step executors:', error);
    }
  }

  /**
   * Создает исполнителя для заданного шага.
   * @param {string} stepName - Название шага.
   * @returns {StepExecutor|null} - Экземпляр исполнителя шага или null, если исполнитель не найден.
   */
  createExecutor(stepName) {
    logger.debug(`Creating executor for step: ${stepName}`);
    
    // Получаем класс исполнителя для шага
    const ExecutorClass = this.executors[stepName];
    
    if (!ExecutorClass) {
      logger.error(`Executor not found for step: ${stepName}`);
      return null;
    }
    
    try {
      // Создаем экземпляр исполнителя
      const executor = new ExecutorClass({
        contextManager: this.contextManager,
        stateManager: this.stateManager,
        notificationManager: this.notificationManager,
        db: this.db,
        llmClient: this.llmClient,
        promptManager: this.promptManager
      });
      
      // Проверяем, что исполнитель является наследником StepExecutor
      if (!(executor instanceof StepExecutor)) {
        logger.error(`Executor for step ${stepName} is not an instance of StepExecutor`);
        return null;
      }
      
      return executor;
    } catch (error) {
      logger.error(`Error creating executor for step ${stepName}:`, error);
      return null;
    }
  }

  /**
   * Получает метаданные всех зарегистрированных исполнителей.
   * @returns {Object} - Метаданные исполнителей.
   */
  getExecutorsMetadata() {
    const metadata = {};
    
    for (const stepName in this.executors) {
      try {
        const ExecutorClass = this.executors[stepName];
        const executor = new ExecutorClass({
          contextManager: this.contextManager,
          stateManager: this.stateManager,
          notificationManager: this.notificationManager,
          db: this.db,
          llmClient: this.llmClient,
          promptManager: this.promptManager
        });
        
        metadata[stepName] = executor.getMetadata();
      } catch (error) {
        logger.error(`Error getting metadata for step ${stepName}:`, error);
        metadata[stepName] = {
          name: stepName,
          description: 'Error getting metadata',
          error: error.message
        };
      }
    }
    
    return metadata;
  }
}

module.exports = { StepExecutorFactory };
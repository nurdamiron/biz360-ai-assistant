// src/core/orchestrator/context-manager.js

const logger = require('../../utils/logger');

/**
 * Менеджер контекста задачи
 * Отвечает за управление и обновление контекста задачи на всех этапах
 */
class ContextManager {
  constructor() {
    this.contextCache = new Map();
  }

  /**
   * Инициализация менеджера контекста
   * @param {object} task - Объект задачи
   * @returns {Promise<void>}
   */
  async initialize(task) {
    // Инициализируем кэш контекста для данной задачи
    const initialContext = {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        projectId: task.projectId,
        userId: task.userId,
        priority: task.priority,
        createdAt: task.createdAt
      },
      // Добавляем существующий контекст из задачи, если есть
      ...(task.context || {})
    };
    
    this.contextCache.set(task.id, initialContext);
    logger.debug('ContextManager initialized', { taskId: task.id });
  }

  /**
   * Получение контекста задачи
   * @param {string} taskId - ID задачи
   * @returns {Promise<object>} - Контекст задачи
   */
  async getContext(taskId) {
    // Если контекст уже в кэше, возвращаем его
    if (this.contextCache.has(taskId)) {
      return this.contextCache.get(taskId);
    }
    
    // Иначе загружаем задачу и инициализируем контекст
    try {
      const { Task } = require('../../models');
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      await this.initialize(task);
      return this.contextCache.get(taskId);
    } catch (error) {
      logger.error(`Error getting context for task ${taskId}: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Обновление контекста задачи после выполнения шага
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @param {object} stepResult - Результат выполнения шага
   * @returns {Promise<object>} - Обновленный контекст
   */
  async updateContext(taskId, stepNumber, stepResult) {
    try {
      const context = await this.getContext(taskId);
      
      // Обновляем контекст в зависимости от шага
      switch (stepNumber) {
        case 1: // Понимание задачи
          context.taskAnalysis = stepResult.analysis;
          context.requirements = stepResult.requirements;
          context.taskType = stepResult.taskType;
          context.estimatedComplexity = stepResult.estimatedComplexity;
          context.relatedFiles = stepResult.relatedFiles;
          break;
          
        case 2: // Анализ контекста проекта
          context.projectContext = stepResult.projectContext;
          context.codebase = stepResult.codebase;
          context.dependencies = stepResult.dependencies;
          context.architecture = stepResult.architecture;
          break;
          
        case 3: // Планирование и декомпозиция
          context.plan = stepResult.plan;
          context.subtasks = stepResult.subtasks;
          context.estimatedEffort = stepResult.estimatedEffort;
          break;
          
        case 4: // Выбор подхода и технологий
          context.approachRecommendation = stepResult.approach;
          context.technologies = stepResult.technologies;
          context.libraries = stepResult.libraries;
          break;
          
        case 5: // Генерация кода
          context.generatedCode = stepResult.code;
          context.generatedFiles = stepResult.files;
          break;
          
        case 6: // Итеративное уточнение кода
          context.refinedCode = stepResult.code;
          context.refinedFiles = stepResult.files;
          context.refinementChanges = stepResult.changes;
          break;
          
        case 7: // Саморефлексия и ревью кода
          context.codeReview = stepResult.review;
          context.reviewComments = stepResult.comments;
          context.reviewSuggestions = stepResult.suggestions;
          break;
          
        case 8: // Исправление ошибок
          context.errorCorrections = stepResult.corrections;
          context.correctedFiles = stepResult.files;
          break;
          
        case 9: // Генерация тестов
          context.generatedTests = stepResult.tests;
          context.testFiles = stepResult.testFiles;
          context.testCoverage = stepResult.coverage;
          break;
          
        case 10: // Запуск кода и тестов
          context.executionResults = stepResult.results;
          context.testResults = stepResult.testResults;
          context.issues = stepResult.issues;
          break;
          
        case 11: // Анализ результатов тестов
          context.testAnalysis = stepResult.analysis;
          context.testIssues = stepResult.issues;
          context.testRecommendations = stepResult.recommendations;
          break;
          
        case 12: // Генерация/Обновление документации
          context.documentation = stepResult.documentation;
          context.docFiles = stepResult.files;
          context.apiDocs = stepResult.apiDocs;
          break;
          
        case 13: // Обучение и обновление знаний
          context.learnings = stepResult.learnings;
          context.knowledgeUpdates = stepResult.updates;
          break;
          
        case 14: // Подготовка к мержу (PR)
          context.prTitle = stepResult.title;
          context.prDescription = stepResult.description;
          context.prUrl = stepResult.url;
          context.prChecklist = stepResult.checklist;
          break;
          
        case 15: // Интеграция обратной связи
          context.feedbackAnalysis = stepResult.analysis;
          context.feedbackChanges = stepResult.changes;
          context.feedbackResponses = stepResult.responses;
          break;
          
        case 16: // Взаимодействие с пользователем
          context.userInteractions = stepResult.interactions;
          context.userFeedback = stepResult.feedback;
          context.finalStatus = stepResult.status;
          break;
          
        default:
          logger.warn(`Unknown step number: ${stepNumber}, skipping context update`);
          break;
      }
      
      // Обновляем кэш контекста
      this.contextCache.set(taskId, context);
      
      // Сохраняем контекст в БД
      await this._persistContext(taskId, context);
      
      logger.debug(`Context updated for task ${taskId} after step ${stepNumber}`);
      return context;
    } catch (error) {
      logger.error(`Error updating context: ${error.message}`, {
        taskId,
        stepNumber,
        error
      });
      throw error;
    }
  }

  /**
   * Сохранение контекста в БД
   * @param {string} taskId - ID задачи
   * @param {object} context - Контекст для сохранения
   * @returns {Promise<void>}
   * @private
   */
  async _persistContext(taskId, context) {
    try {
      const { Task } = require('../../models');
      
      // Получаем задачу из БД
      const task = await Task.findByPk(taskId);
      
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Обновляем контекст задачи
      task.context = context;
      await task.save();
    } catch (error) {
      logger.error(`Error persisting context: ${error.message}`, { taskId, error });
      // Не выбрасываем ошибку, чтобы не прерывать основной процесс
      // Кэш все равно обновлен и может быть использован
    }
  }

  /**
   * Получение специфичной части контекста
   * @param {string} taskId - ID задачи
   * @param {string} path - Путь к части контекста (например, 'projectContext.dependencies')
   * @returns {Promise<any>} - Часть контекста
   */
  async getContextPart(taskId, path) {
    try {
      const context = await this.getContext(taskId);
      
      // Разбиваем путь на части
      const parts = path.split('.');
      
      // Проходим по частям пути
      let result = context;
      for (const part of parts) {
        if (result == null || typeof result !== 'object') {
          return null;
        }
        result = result[part];
      }
      
      return result;
    } catch (error) {
      logger.error(`Error getting context part: ${error.message}`, {
        taskId,
        path,
        error
      });
      return null;
    }
  }

  /**
   * Сохранение артефакта в контекст
   * @param {string} taskId - ID задачи
   * @param {string} artifactType - Тип артефакта ('code', 'test', 'doc', etc.)
   * @param {string} artifactPath - Путь к артефакту
   * @param {any} artifactContent - Содержимое артефакта
   * @returns {Promise<object>} - Обновленный контекст
   */
  async saveArtifact(taskId, artifactType, artifactPath, artifactContent) {
    try {
      const context = await this.getContext(taskId);
      
      // Инициализируем хранилище артефактов, если его нет
      if (!context.artifacts) {
        context.artifacts = {};
      }
      
      // Инициализируем хранилище артефактов данного типа, если его нет
      if (!context.artifacts[artifactType]) {
        context.artifacts[artifactType] = {};
      }
      
      // Сохраняем артефакт
      context.artifacts[artifactType][artifactPath] = artifactContent;
      
      // Обновляем кэш контекста
      this.contextCache.set(taskId, context);
      
      // Сохраняем контекст в БД
      await this._persistContext(taskId, context);
      
      logger.debug(`Artifact saved for task ${taskId}: ${artifactType}/${artifactPath}`);
      return context;
    } catch (error) {
      logger.error(`Error saving artifact: ${error.message}`, {
        taskId,
        artifactType,
        artifactPath,
        error
      });
      throw error;
    }
  }
}

module.exports = ContextManager;
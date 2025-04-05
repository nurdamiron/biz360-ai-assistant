// src/models/task.model.js

const validationMiddleware = require('../api/middleware/validation');

/**
 * Модель данных задачи с валидацией
 */
class TaskModel {
  /**
   * Валидирует данные для создания новой задачи
   * @param {Object} taskData - Данные задачи
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateCreate(taskData) {
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Проверка обязательных полей
      validationMiddleware.required(['project_id', 'title', 'description']),
      
      // Валидация числовых полей
      validationMiddleware.numeric({
        'project_id': { min: 1 },
        'parent_task_id': { min: 1 },
        'assigned_to': { min: 1 }
      }),
      
      // Валидация строковых полей
      validationMiddleware.string({
        'title': { minLength: 3, maxLength: 255 },
        'description': { minLength: 10 }
      }),
      
      // Валидация перечислений
      validationMiddleware.enum({
        'priority': ['critical', 'high', 'medium', 'low']
      })
    ]);
    
    return validator(taskData);
  }
  
  /**
   * Валидирует данные для обновления задачи
   * @param {Object} taskData - Данные задачи
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateUpdate(taskData) {
    // Проверяем, есть ли хотя бы одно поле для обновления
    if (Object.keys(taskData).length === 0) {
      return {
        isValid: false,
        errors: ['Необходимо указать хотя бы одно поле для обновления']
      };
    }
    
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'parent_task_id': { min: 1 },
        'assigned_to': { min: 1 }
      }),
      
      // Валидация строковых полей
      validationMiddleware.string({
        'title': { minLength: 3, maxLength: 255 },
        'description': { minLength: 10 }
      }),
      
      // Валидация перечислений
      validationMiddleware.enum({
        'priority': ['critical', 'high', 'medium', 'low'],
        'status': ['pending', 'in_progress', 'blocked', 'completed', 'failed']
      })
    ]);
    
    return validator(taskData);
  }
  
  /**
   * Валидирует параметры для изменения статуса задачи
   * @param {Object} statusData - Данные статуса
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateStatusChange(statusData) {
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Проверка обязательных полей
      validationMiddleware.required(['status']),
      
      // Валидация перечислений
      validationMiddleware.enum({
        'status': ['pending', 'in_progress', 'blocked', 'completed', 'failed']
      })
    ]);
    
    return validator(statusData);
  }
  
  /**
   * Валидирует параметры для поиска/фильтрации задач
   * @param {Object} queryParams - Параметры запроса
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateSearchQuery(queryParams) {
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'page': { min: 1 },
        'limit': { min: 1, max: 100 },
        'project_id': { min: 1 },
        'assignee': { min: 1 }
      }),
      
      // Валидация перечислений
      validationMiddleware.enum({
        'sortOrder': ['asc', 'desc']
      })
    ]);
    
    return validator(queryParams);
  }
  
  /**
   * Валидирует параметры для назначения задачи
   * @param {Object} assignmentData - Данные назначения
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateAssignment(assignmentData) {
    // Проверка, что userId либо null, либо положительное число
    if (assignmentData.userId !== null && 
        (typeof assignmentData.userId !== 'number' || assignmentData.userId < 1)) {
      return {
        isValid: false,
        errors: ['userId должен быть null или положительным числом']
      };
    }
    
    return {
      isValid: true,
      errors: []
    };
  }
  
  /**
   * Преобразует объект задачи в формат для базы данных
   * @param {Object} taskData - Данные задачи
   * @returns {Object} - Данные для базы данных
   */
  static toDatabase(taskData) {
    // Формируем объект с данными для вставки/обновления в БД
    const dbData = {};
    
    // Копируем только допустимые поля
    const allowedFields = [
      'project_id', 'title', 'description', 'status', 
      'priority', 'parent_task_id', 'assigned_to'
    ];
    
    allowedFields.forEach(field => {
      if (taskData[field] !== undefined) {
        dbData[field] = taskData[field];
      }
    });
    
    return dbData;
  }
  
  /**
   * Нормализует параметры для поиска/фильтрации задач
   * @param {Object} queryParams - Исходные параметры запроса
   * @returns {Object} - Нормализованные параметры
   */
  static normalizeSearchQuery(queryParams) {
    const normalized = {
      page: parseInt(queryParams.page) || 1,
      limit: parseInt(queryParams.limit) || 10,
      sortBy: queryParams.sortBy || 'created_at',
      sortOrder: (queryParams.sortOrder || 'desc').toLowerCase()
    };
    
    // Добавляем числовые параметры, если они заданы
    ['project_id', 'assignee', 'parent_task_id'].forEach(param => {
      if (queryParams[param] !== undefined) {
        if (queryParams[param] === 'null') {
          normalized[param] = null;
        } else {
          normalized[param] = parseInt(queryParams[param]) || null;
        }
      }
    });
    
    // Добавляем строковые параметры, если они заданы
    ['status', 'priority', 'search', 'from_date', 'to_date'].forEach(param => {
      if (queryParams[param]) {
        normalized[param] = queryParams[param];
      }
    });
    
    // Обработка тегов
    if (queryParams.tags) {
      if (Array.isArray(queryParams.tags)) {
        normalized.tags = queryParams.tags;
      } else {
        normalized.tags = queryParams.tags.split(',').map(tag => tag.trim());
      }
    }
    
    return normalized;
  }
}

module.exports = TaskModel;
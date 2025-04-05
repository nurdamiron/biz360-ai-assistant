// src/models/time-entry.model.js

const validationMiddleware = require('../api/middleware/validation');

/**
 * Модель данных записи о затраченном времени с валидацией
 */
class TimeEntryModel {
  /**
   * Валидирует данные для создания новой записи о времени
   * @param {Object} timeEntryData - Данные записи
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateCreate(timeEntryData) {
    // Проверка обязательных полей в зависимости от сценария
    const errors = [];
    
    // Проверяем, что указана либо задача, либо подзадача
    if (!timeEntryData.task_id && !timeEntryData.subtask_id) {
      errors.push('Необходимо указать либо task_id, либо subtask_id');
    }
    
    // Проверяем остальные обязательные поля (при ручном добавлении записи)
    if (!timeEntryData.started_at) {
      errors.push('Необходимо указать started_at');
    }
    
    if (!timeEntryData.ended_at) {
      // Проверяем только при ручном добавлении записи, а не при запуске таймера
      if (timeEntryData.hours) {
        errors.push('Необходимо указать ended_at');
      }
    } else if (timeEntryData.started_at) {
      // Проверяем, что дата начала меньше даты окончания
      const startDate = new Date(timeEntryData.started_at);
      const endDate = new Date(timeEntryData.ended_at);
      
      if (startDate >= endDate) {
        errors.push('Дата начала должна быть меньше даты окончания');
      }
    }
    
    if (timeEntryData.hours !== undefined) {
      // Проверяем, что часы положительны
      if (typeof timeEntryData.hours !== 'number' || timeEntryData.hours <= 0) {
        errors.push('Количество часов должно быть положительным числом');
      }
    }
    
    // Если есть ошибки, возвращаем их
    if (errors.length > 0) {
      return {
        isValid: false,
        errors
      };
    }
    
    // Если нет ошибок, используем дополнительные валидаторы
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'task_id': { min: 1 },
        'subtask_id': { min: 1 },
        'hours': { min: 0.01 }
      })
    ]);
    
    return validator(timeEntryData);
  }
  
  /**
   * Валидирует данные для обновления записи о времени
   * @param {Object} timeEntryData - Данные для обновления
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateUpdate(timeEntryData) {
    // Проверяем, есть ли хотя бы одно поле для обновления
    if (Object.keys(timeEntryData).length === 0) {
      return {
        isValid: false,
        errors: ['Необходимо указать хотя бы одно поле для обновления']
      };
    }
    
    const errors = [];
    
    // Проверяем корректность часов
    if (timeEntryData.hours !== undefined) {
      if (typeof timeEntryData.hours !== 'number' || timeEntryData.hours <= 0) {
        errors.push('Количество часов должно быть положительным числом');
      }
    }
    
    // Проверяем соотношение дат
    if (timeEntryData.started_at && timeEntryData.ended_at) {
      const startDate = new Date(timeEntryData.started_at);
      const endDate = new Date(timeEntryData.ended_at);
      
      if (startDate >= endDate) {
        errors.push('Дата начала должна быть меньше даты окончания');
      }
    }
    
    // Если есть ошибки, возвращаем их
    if (errors.length > 0) {
      return {
        isValid: false,
        errors
      };
    }
    
    // Если нет ошибок, используем дополнительные валидаторы
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'hours': { min: 0.01 }
      })
    ]);
    
    return validator(timeEntryData);
  }
  
  /**
   * Валидирует параметры для запуска отслеживания времени
   * @param {Object} startData - Данные для запуска
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateStart(startData) {
    // Проверяем, что указана либо задача, либо подзадача
    if (!startData.task_id && !startData.subtask_id) {
      return {
        isValid: false,
        errors: ['Необходимо указать либо task_id, либо subtask_id']
      };
    }
    
    // Дополнительная валидация
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'task_id': { min: 1 },
        'subtask_id': { min: 1 }
      })
    ]);
    
    return validator(startData);
  }
  
  /**
   * Валидирует параметры для получения записей о времени
   * @param {Object} queryParams - Параметры запроса
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateQuery(queryParams) {
    // Проверяем, что указан хотя бы один параметр фильтрации
    if (!queryParams.task_id && !queryParams.subtask_id && !queryParams.user_id) {
      return {
        isValid: false,
        errors: ['Необходимо указать хотя бы один параметр: task_id, subtask_id или user_id']
      };
    }
    
    // Дополнительная валидация
    const validator = validationMiddleware.combine([
      // Валидация числовых полей
      validationMiddleware.numeric({
        'task_id': { min: 1 },
        'subtask_id': { min: 1 },
        'user_id': { min: 1 }
      })
    ]);
    
    return validator(queryParams);
  }
  
  /**
   * Преобразует объект записи о времени в формат для базы данных
   * @param {Object} timeEntryData - Данные записи
   * @returns {Object} - Данные для базы данных
   */
  static toDatabase(timeEntryData) {
    // Формируем объект с данными для вставки/обновления в БД
    const dbData = {};
    
    // Копируем только допустимые поля
    const allowedFields = [
      'user_id', 'task_id', 'subtask_id', 'description', 
      'hours', 'started_at', 'ended_at'
    ];
    
    allowedFields.forEach(field => {
      if (timeEntryData[field] !== undefined) {
        dbData[field] = timeEntryData[field];
      }
    });
    
    return dbData;
  }
  
  /**
   * Вычисляет затраченные часы на основе временного интервала
   * @param {Date|string} startDate - Дата начала
   * @param {Date|string} endDate - Дата окончания
   * @returns {number} - Количество часов
   */
  static calculateHours(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Проверяем корректность дат
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Некорректные даты');
    }
    
    if (start >= end) {
      throw new Error('Дата начала должна быть меньше даты окончания');
    }
    
    // Вычисляем разницу в миллисекундах и переводим в часы
    const diffMs = end.getTime() - start.getTime();
    const hours = diffMs / (1000 * 60 * 60);
    
    // Округляем до 2 знаков после запятой
    return Math.round(hours * 100) / 100;
  }
}

module.exports = TimeEntryModel;
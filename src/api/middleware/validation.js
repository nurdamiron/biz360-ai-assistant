// src/api/middleware/validation.js

const logger = require('../../utils/logger');

/**
 * Middleware для валидации запросов с использованием моделей
 */

/**
 * Универсальный валидатор для запросов
 * @param {Object} schema - Схема валидации с ключами body, params, query
 * @returns {Function} Express middleware
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    
    if (schema.body) {
      // Валидация тела запроса
      for (const [field, rules] of Object.entries(schema.body)) {
        if (rules.required && (req.body[field] === undefined || req.body[field] === null || req.body[field] === '')) {
          errors.push(`Поле '${field}' обязательно`);
          continue;
        }
        
        if (req.body[field] !== undefined) {
          // Проверка типа
          if (rules.type === 'string' && typeof req.body[field] !== 'string') {
            errors.push(`Поле '${field}' должно быть строкой`);
          } else if (rules.type === 'number' && typeof req.body[field] !== 'number' && isNaN(Number(req.body[field]))) {
            errors.push(`Поле '${field}' должно быть числом`);
          } else if (rules.type === 'boolean' && typeof req.body[field] !== 'boolean') {
            errors.push(`Поле '${field}' должно быть boolean`);
          } else if (rules.type === 'array' && !Array.isArray(req.body[field])) {
            errors.push(`Поле '${field}' должно быть массивом`);
          } else if (rules.type === 'object' && (typeof req.body[field] !== 'object' || Array.isArray(req.body[field]))) {
            errors.push(`Поле '${field}' должно быть объектом`);
          }
          
          // Проверка enum
          if (rules.enum && !rules.enum.includes(req.body[field])) {
            errors.push(`Поле '${field}' должно быть одним из значений: ${rules.enum.join(', ')}`);
          }
        }
      }
    }
    
    // Аналогично для query и params
    // ... (добавьте код для валидации req.query и req.params)
    
    if (errors.length > 0) {
      logger.warn(`Ошибка валидации: ${errors.join(', ')}`);
      return res.status(400).json({
        success: false,
        error: 'Ошибка валидации',
        details: errors
      });
    }
    
    next();
  };
}

const validationMiddleware = {
  /**
   * Validates request body against a model
   * @param {Function} modelValidator - Функция валидации модели
   * @param {Object} options - Дополнительные опции
   * @returns {Function} Express middleware
   */
  validateBody(modelValidator, options = {}) {
    return (req, res, next) => {
      try {
        const { isValid, errors } = modelValidator(req.body);
        
        if (!isValid) {
          logger.warn(`Ошибка валидации: ${errors.join(', ')}`);
          
          return res.status(400).json({
            success: false,
            error: 'Ошибка валидации',
            details: errors
          });
        }
        
        next();
      } catch (error) {
        logger.error('Ошибка при валидации данных:', error);
        
        return res.status(500).json({
          success: false,
          error: 'Внутренняя ошибка сервера при валидации данных'
        });
      }
    };
  },
  
  /**
   * Validates request params against a model
   * @param {Function} modelValidator - Функция валидации модели
   * @param {Object} options - Дополнительные опции
   * @returns {Function} Express middleware
   */
  validateParams(modelValidator, options = {}) {
    return (req, res, next) => {
      try {
        const { isValid, errors } = modelValidator(req.params);
        
        if (!isValid) {
          logger.warn(`Ошибка валидации параметров: ${errors.join(', ')}`);
          
          return res.status(400).json({
            success: false,
            error: 'Ошибка валидации параметров',
            details: errors
          });
        }
        
        next();
      } catch (error) {
        logger.error('Ошибка при валидации параметров:', error);
        
        return res.status(500).json({
          success: false,
          error: 'Внутренняя ошибка сервера при валидации параметров'
        });
      }
    };
  },
  
  /**
   * Validates request query against a model
   * @param {Function} modelValidator - Функция валидации модели
   * @param {Object} options - Дополнительные опции
   * @returns {Function} Express middleware
   */
  validateQuery(modelValidator, options = {}) {
    return (req, res, next) => {
      try {
        const { isValid, errors } = modelValidator(req.query);
        
        if (!isValid) {
          logger.warn(`Ошибка валидации параметров запроса: ${errors.join(', ')}`);
          
          return res.status(400).json({
            success: false,
            error: 'Ошибка валидации параметров запроса',
            details: errors
          });
        }
        
        next();
      } catch (error) {
        logger.error('Ошибка при валидации параметров запроса:', error);
        
        return res.status(500).json({
          success: false,
          error: 'Внутренняя ошибка сервера при валидации параметров запроса'
        });
      }
    };
  },
  
  /**
   * Генерирует валидатор для проверки обязательных полей
   * @param {Array<string>} requiredFields - Список обязательных полей
   * @returns {Function} Функция валидации
   */
  required(requiredFields) {
    return (data) => {
      const errors = [];
      
      for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          errors.push(`Поле ${field} обязательно`);
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };
  },
  
  /**
   * Генерирует валидатор для числовых полей
   * @param {Object} fieldConstraints - Ограничения для полей { field: { min, max } }
   * @returns {Function} Функция валидации
   */
  numeric(fieldConstraints) {
    return (data) => {
      const errors = [];
      
      for (const [field, constraints] of Object.entries(fieldConstraints)) {
        if (data[field] !== undefined) {
          const value = Number(data[field]);
          
          if (isNaN(value)) {
            errors.push(`Поле ${field} должно быть числом`);
            continue;
          }
          
          if (constraints.min !== undefined && value < constraints.min) {
            errors.push(`Поле ${field} должно быть не меньше ${constraints.min}`);
          }
          
          if (constraints.max !== undefined && value > constraints.max) {
            errors.push(`Поле ${field} должно быть не больше ${constraints.max}`);
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };
  },
  
  /**
   * Генерирует валидатор для строковых полей
   * @param {Object} fieldConstraints - Ограничения для полей { field: { minLength, maxLength, pattern } }
   * @returns {Function} Функция валидации
   */
  string(fieldConstraints) {
    return (data) => {
      const errors = [];
      
      for (const [field, constraints] of Object.entries(fieldConstraints)) {
        if (data[field] !== undefined) {
          if (typeof data[field] !== 'string') {
            errors.push(`Поле ${field} должно быть строкой`);
            continue;
          }
          
          if (constraints.minLength !== undefined && data[field].length < constraints.minLength) {
            errors.push(`Поле ${field} должно содержать не менее ${constraints.minLength} символов`);
          }
          
          if (constraints.maxLength !== undefined && data[field].length > constraints.maxLength) {
            errors.push(`Поле ${field} должно содержать не более ${constraints.maxLength} символов`);
          }
          
          if (constraints.pattern !== undefined && !constraints.pattern.test(data[field])) {
            errors.push(`Поле ${field} имеет неверный формат`);
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };
  },
  
  /**
   * Генерирует валидатор для проверки перечисления
   * @param {Object} fieldValues - Допустимые значения для полей { field: [...values] }
   * @returns {Function} Функция валидации
   */
  enum(fieldValues) {
    return (data) => {
      const errors = [];
      
      for (const [field, values] of Object.entries(fieldValues)) {
        if (data[field] !== undefined && !values.includes(data[field])) {
          errors.push(`Поле ${field} должно быть одним из значений: ${values.join(', ')}`);
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };
  },
  
  /**
   * Комбинирует несколько валидаторов в один
   * @param {Array<Function>} validators - Массив функций валидации
   * @returns {Function} Комбинированная функция валидации
   */
  combine(validators) {
    return (data) => {
      const errors = [];
      
      for (const validator of validators) {
        const result = validator(data);
        
        if (!result.isValid) {
          errors.push(...result.errors);
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    };
  }
};

module.exports = {
  ...validationMiddleware,
  validate
};
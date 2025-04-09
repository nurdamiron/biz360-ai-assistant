/**
 * @fileoverview Менеджер валидации данных на основе JSON Schema.
 * Используется для проверки входных и выходных данных компонентов системы
 * на соответствие определенным структурам.
 */

const logger = require('../../utils/logger');

// Импортируем библиотеку Ajv для валидации JSON Schema
// Примечание: если библиотека не установлена, нужно будет выполнить:
// npm install ajv
let Ajv;
try {
  Ajv = require('ajv');
} catch (e) {
  logger.warn('AJV not installed, validation will not work properly');
}

/**
 * Класс для валидации данных на основе JSON Schema.
 */
class ValidationManager {
  /**
   * Создает экземпляр ValidationManager.
   */
  constructor() {
    // Инициализируем валидатор
    if (Ajv) {
      this.ajv = new Ajv({
        allErrors: true,
        verbose: true,
        $data: true,
        coerceTypes: true
      });
      
      // Добавляем форматы для валидации даты/времени и т.д.
      try {
        require('ajv-formats')(this.ajv);
      } catch (e) {
        logger.warn('ajv-formats not installed, some format validations may not work properly');
      }
      
      // Кэш скомпилированных схем валидации
      this.validationCache = new Map();
    } else {
      logger.error('AJV not available, validation will be skipped');
    }
  }

  /**
   * Валидирует данные по JSON Schema.
   * @param {Object} data - Проверяемые данные.
   * @param {Object} schema - JSON Schema для валидации.
   * @returns {Object} - Результат валидации { valid: boolean, errors: Array }.
   */
  validate(data, schema) {
    // Если валидатор не доступен, считаем данные валидными
    if (!this.ajv) {
      logger.warn('Validation skipped: AJV not available');
      return { valid: true, errors: [] };
    }
    
    try {
      // Проверяем, что схема представлена объектом
      if (!schema || typeof schema !== 'object') {
        logger.warn('Invalid schema provided for validation');
        return { valid: false, errors: ['Invalid schema'] };
      }
      
      // Получаем или компилируем валидатор для схемы
      let validate;
      const schemaKey = JSON.stringify(schema);
      
      if (this.validationCache.has(schemaKey)) {
        validate = this.validationCache.get(schemaKey);
      } else {
        validate = this.ajv.compile(schema);
        this.validationCache.set(schemaKey, validate);
      }
      
      // Выполняем валидацию
      const valid = validate(data);
      
      // Если данные невалидны, собираем ошибки
      if (!valid) {
        const errors = (validate.errors || []).map(error => {
          return `${error.instancePath} ${error.message}`;
        });
        
        logger.debug('Validation failed:', errors);
        
        return {
          valid: false,
          errors,
          rawErrors: validate.errors
        };
      }
      
      return { valid: true, errors: [] };
    } catch (error) {
      logger.error('Error during validation:', error);
      
      return {
        valid: false,
        errors: [error.message],
        error
      };
    }
  }

  /**
   * Создает функцию валидации для конкретной схемы.
   * @param {Object} schema - JSON Schema для валидации.
   * @returns {Function} - Функция валидации (data) => { valid, errors }.
   */
  createValidator(schema) {
    return (data) => this.validate(data, schema);
  }

  /**
   * Очищает кэш скомпилированных схем.
   */
  clearCache() {
    if (this.validationCache) {
      this.validationCache.clear();
    }
  }
}

module.exports = { ValidationManager };
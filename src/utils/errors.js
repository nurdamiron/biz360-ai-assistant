// src/utils/errors.js
/**
 * Класс ошибки валидации
 */
class ValidationError extends Error {
    /**
     * @param {string} message - Сообщение об ошибке
     * @param {Array|Object} details - Детали ошибки валидации
     */
    constructor(message, details = []) {
      super(message);
      this.name = 'ValidationError';
      this.details = details;
    }
  }
  
  module.exports = {
    ValidationError
  };
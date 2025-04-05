// src/models/comment.model.js

const validationMiddleware = require('../api/middleware/validation');

/**
 * Модель данных комментария с валидацией
 */
class CommentModel {
  /**
   * Валидирует данные для создания нового комментария
   * @param {Object} commentData - Данные комментария
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateCreate(commentData) {
    // Проверяем обязательные поля
    if (!commentData.content || commentData.content.trim().length === 0) {
      return {
        isValid: false,
        errors: ['Содержимое комментария не может быть пустым']
      };
    }
    
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Валидация строковых полей
      validationMiddleware.string({
        'content': { minLength: 1, maxLength: 5000 }
      })
    ]);
    
    return validator(commentData);
  }
  
  /**
   * Валидирует данные для обновления комментария
   * @param {Object} commentData - Данные комментария
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateUpdate(commentData) {
    // Проверяем обязательные поля
    if (!commentData.content || commentData.content.trim().length === 0) {
      return {
        isValid: false,
        errors: ['Содержимое комментария не может быть пустым']
      };
    }
    
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Валидация строковых полей
      validationMiddleware.string({
        'content': { minLength: 1, maxLength: 5000 }
      })
    ]);
    
    return validator(commentData);
  }
  
  /**
   * Валидирует параметры для получения комментариев
   * @param {Object} queryParams - Параметры запроса
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateQuery(queryParams) {
    // Проверка не требуется для обычных запросов комментариев
    return {
      isValid: true,
      errors: []
    };
  }
  
  /**
   * Преобразует объект комментария в формат для базы данных
   * @param {Object} commentData - Данные комментария
   * @returns {Object} - Данные для базы данных
   */
  static toDatabase(commentData) {
    // Формируем объект с данными для вставки/обновления в БД
    const dbData = {};
    
    // Копируем только допустимые поля
    const allowedFields = [
      'task_id', 'subtask_id', 'user_id', 'content'
    ];
    
    allowedFields.forEach(field => {
      if (commentData[field] !== undefined) {
        dbData[field] = commentData[field];
      }
    });
    
    return dbData;
  }
  
  /**
   * Преобразует объект комментария в безопасный формат для API
   * @param {Object} comment - Объект комментария из БД
   * @param {boolean} includeHtml - Включать ли HTML-версию содержимого
   * @returns {Object} - Безопасный объект комментария
   */
  static toSafeObject(comment, includeHtml = true) {
    // Формируем безопасный объект
    const safeComment = {
      id: comment.id,
      task_id: comment.task_id,
      subtask_id: comment.subtask_id,
      user_id: comment.user_id,
      content: comment.content,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      username: comment.username,
      user_role: comment.user_role
    };
    
    // Добавляем HTML-содержимое, если требуется
    if (includeHtml && comment.content_html) {
      safeComment.content_html = comment.content_html;
    }
    
    return safeComment;
  }
}

module.exports = CommentModel;
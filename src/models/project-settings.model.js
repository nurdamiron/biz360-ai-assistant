// src/models/project-settings.model.js

/**
 * Модель для валидации настроек проекта
 */
class ProjectSettings {
    /**
     * Валидирует настройки проекта
     * @param {string} key - Ключ настройки
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации { isValid: boolean, errors: string[] }
     */
    static validate(key, value) {
      // Определяем допустимые ключи и правила валидации
      const validators = {
        'code_analysis': ProjectSettings.validateCodeAnalysis,
        'git_integration': ProjectSettings.validateGitIntegration,
        'ai_assistant': ProjectSettings.validateAIAssistant,
        'notifications': ProjectSettings.validateNotifications,
        'team_settings': ProjectSettings.validateTeamSettings
      };
      
      // Проверяем, поддерживается ли данный ключ настройки
      if (!validators[key]) {
        return {
          isValid: false,
          errors: [`Неподдерживаемый ключ настройки: ${key}`]
        };
      }
      
      // Применяем соответствующий валидатор
      return validators[key](value);
    }
    
    /**
     * Валидирует настройки анализа кода
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации
     */
    static validateCodeAnalysis(value) {
      const errors = [];
      
      // Проверяем тип значения
      if (!value || typeof value !== 'object') {
        return { isValid: false, errors: ['Значение должно быть объектом'] };
      }
      
      // Проверяем обязательные поля
      if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
        errors.push('Поле enabled должно быть boolean');
      }
      
      if (value.auto_index !== undefined && typeof value.auto_index !== 'boolean') {
        errors.push('Поле auto_index должно быть boolean');
      }
      
      if (value.exclude_patterns !== undefined) {
        if (!Array.isArray(value.exclude_patterns)) {
          errors.push('Поле exclude_patterns должно быть массивом');
        } else {
          // Проверяем, что все элементы массива - строки
          const nonStringItems = value.exclude_patterns.filter(item => typeof item !== 'string');
          if (nonStringItems.length > 0) {
            errors.push('Все элементы exclude_patterns должны быть строками');
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Валидирует настройки интеграции с Git
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации
     */
    static validateGitIntegration(value) {
      const errors = [];
      
      // Проверяем тип значения
      if (!value || typeof value !== 'object') {
        return { isValid: false, errors: ['Значение должно быть объектом'] };
      }
      
      // Проверяем поля
      if (value.auto_commit !== undefined && typeof value.auto_commit !== 'boolean') {
        errors.push('Поле auto_commit должно быть boolean');
      }
      
      if (value.auto_pr !== undefined && typeof value.auto_pr !== 'boolean') {
        errors.push('Поле auto_pr должно быть boolean');
      }
      
      if (value.branch_prefix !== undefined && typeof value.branch_prefix !== 'string') {
        errors.push('Поле branch_prefix должно быть строкой');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Валидирует настройки AI-ассистента
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации
     */
    static validateAIAssistant(value) {
      const errors = [];
      
      // Проверяем тип значения
      if (!value || typeof value !== 'object') {
        return { isValid: false, errors: ['Значение должно быть объектом'] };
      }
      
      // Проверяем поля
      if (value.code_generation_enabled !== undefined && typeof value.code_generation_enabled !== 'boolean') {
        errors.push('Поле code_generation_enabled должно быть boolean');
      }
      
      if (value.code_review_enabled !== undefined && typeof value.code_review_enabled !== 'boolean') {
        errors.push('Поле code_review_enabled должно быть boolean');
      }
      
      if (value.max_tokens_per_request !== undefined) {
        if (typeof value.max_tokens_per_request !== 'number' || value.max_tokens_per_request <= 0) {
          errors.push('Поле max_tokens_per_request должно быть положительным числом');
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Валидирует настройки уведомлений
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации
     */
    static validateNotifications(value) {
      const errors = [];
      
      // Проверяем тип значения
      if (!value || typeof value !== 'object') {
        return { isValid: false, errors: ['Значение должно быть объектом'] };
      }
      
      // Проверяем поля
      if (value.email_notifications !== undefined && typeof value.email_notifications !== 'boolean') {
        errors.push('Поле email_notifications должно быть boolean');
      }
      
      if (value.slack_notifications !== undefined && typeof value.slack_notifications !== 'boolean') {
        errors.push('Поле slack_notifications должно быть boolean');
      }
      
      if (value.slack_webhook !== undefined && typeof value.slack_webhook !== 'string') {
        errors.push('Поле slack_webhook должно быть строкой');
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Валидирует настройки команды
     * @param {Object} value - Значение настройки
     * @returns {Object} - Результат валидации
     */
    static validateTeamSettings(value) {
      const errors = [];
      
      // Проверяем тип значения
      if (!value || typeof value !== 'object') {
        return { isValid: false, errors: ['Значение должно быть объектом'] };
      }
      
      // Проверяем поля
      if (value.default_assignee !== undefined && typeof value.default_assignee !== 'string') {
        errors.push('Поле default_assignee должно быть строкой');
      }
      
      if (value.require_review !== undefined && typeof value.require_review !== 'boolean') {
        errors.push('Поле require_review должно быть boolean');
      }
      
      if (value.team_members !== undefined) {
        if (!Array.isArray(value.team_members)) {
          errors.push('Поле team_members должно быть массивом');
        } else {
          // Проверяем, что все элементы массива - строки
          const nonStringItems = value.team_members.filter(item => typeof item !== 'string');
          if (nonStringItems.length > 0) {
            errors.push('Все элементы team_members должны быть строками');
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Создает настройку по умолчанию для указанного ключа
     * @param {string} key - Ключ настройки
     * @returns {Object|null} - Настройка по умолчанию или null, если ключ неизвестен
     */
    static getDefaultSettings(key) {
      const defaults = {
        'code_analysis': {
          enabled: true,
          auto_index: true,
          exclude_patterns: ['node_modules', 'dist', '.git', 'build', 'coverage']
        },
        'git_integration': {
          auto_commit: false,
          branch_prefix: 'ai-task-',
          auto_pr: true
        },
        'ai_assistant': {
          code_generation_enabled: true,
          code_review_enabled: true,
          max_tokens_per_request: 8000
        },
        'notifications': {
          email_notifications: false,
          slack_notifications: false,
          slack_webhook: ''
        },
        'team_settings': {
          default_assignee: '',
          require_review: true,
          team_members: []
        }
      };
      
      return defaults[key] || null;
    }
  }
  
  module.exports = ProjectSettings;
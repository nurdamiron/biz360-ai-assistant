// src/models/subtask.model.js
const validationMiddleware = require('../api/middleware/validation');

/**
 * Класс для валидации данных подзадачи
 */
class SubtaskValidator {
  /**
   * Валидирует данные для создания новой подзадачи
   * @param {Object} subtaskData - Данные подзадачи
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateCreate(subtaskData) {
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Проверка обязательных полей
      validationMiddleware.required(['title', 'description']),
      
      // Валидация строковых полей
      validationMiddleware.string({
        'title': { minLength: 3, maxLength: 255 },
        'description': { minLength: 10 }
      }),
      
      // Валидация числовых полей
      validationMiddleware.numeric({
        'sequence_number': { min: 1 }
      })
    ]);
    
    // Проверка зависимостей, если они указаны
    if (subtaskData.dependencies && !Array.isArray(subtaskData.dependencies)) {
      return {
        isValid: false,
        errors: ['Зависимости должны быть массивом ID подзадач']
      };
    }
    
    return validator(subtaskData);
  }
  
  /**
   * Валидирует данные для обновления подзадачи
   * @param {Object} subtaskData - Данные подзадачи
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateUpdate(subtaskData) {
    // Проверяем, есть ли хотя бы одно поле для обновления
    if (Object.keys(subtaskData).length === 0) {
      return {
        isValid: false,
        errors: ['Необходимо указать хотя бы одно поле для обновления']
      };
    }
    
    // Комбинированный валидатор
    const validator = validationMiddleware.combine([
      // Валидация строковых полей
      validationMiddleware.string({
        'title': { minLength: 3, maxLength: 255 },
        'description': { minLength: 10 }
      }),
      
      // Валидация числовых полей
      validationMiddleware.numeric({
        'sequence_number': { min: 1 }
      }),
      
      // Валидация перечислений
      validationMiddleware.enum({
        'status': ['pending', 'in_progress', 'completed', 'failed']
      })
    ]);
    
    // Проверка зависимостей, если они указаны
    if (subtaskData.dependencies !== undefined && !Array.isArray(subtaskData.dependencies)) {
      return {
        isValid: false,
        errors: ['Зависимости должны быть массивом ID подзадач']
      };
    }
    
    return validator(subtaskData);
  }
  
  /**
   * Валидирует параметры для изменения статуса подзадачи
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
        'status': ['pending', 'in_progress', 'completed', 'failed']
      })
    ]);
    
    return validator(statusData);
  }
  
  /**
   * Валидирует параметры для изменения порядка подзадач
   * @param {Object} reorderData - Данные для изменения порядка
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  static validateReorder(reorderData) {
    // Проверка наличия и корректности массива порядка
    if (!reorderData.order || !Array.isArray(reorderData.order) || reorderData.order.length === 0) {
      return {
        isValid: false,
        errors: ['Необходимо указать непустой массив ID подзадач в новом порядке']
      };
    }
    
    // Проверка, что все элементы массива - положительные числа
    for (const id of reorderData.order) {
      if (typeof id !== 'number' || id < 1) {
        return {
          isValid: false,
          errors: ['Все элементы массива order должны быть положительными числами']
        };
      }
    }
    
    return {
      isValid: true,
      errors: []
    };
  }
  
  /**
   * Преобразует объект подзадачи в формат для базы данных
   * @param {Object} subtaskData - Данные подзадачи
   * @returns {Object} - Данные для базы данных
   */
  static toDatabase(subtaskData) {
    // Формируем объект с данными для вставки/обновления в БД
    const dbData = {};
    
    // Копируем только допустимые поля
    const allowedFields = [
      'task_id', 'title', 'description', 'status', 'sequence_number'
    ];
    
    allowedFields.forEach(field => {
      if (subtaskData[field] !== undefined) {
        dbData[field] = subtaskData[field];
      }
    });
    
    return dbData;
  }
}

/**
 * Функция для создания модели Subtask с Sequelize
 * @param {Object} sequelize - Экземпляр Sequelize
 * @param {Object} DataTypes - Типы данных Sequelize
 * @returns {Object} - Модель Sequelize
 */
module.exports = (sequelize, DataTypes) => {
  const Subtask = sequelize.define('subtask', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    task_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'tasks',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'failed'),
      defaultValue: 'pending'
    },
    sequence_number: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    dependencies: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const value = this.getDataValue('dependencies');
        return value ? JSON.parse(value) : [];
      },
      set(value) {
        this.setDataValue('dependencies', 
          Array.isArray(value) ? JSON.stringify(value) : JSON.stringify([]));
      }
    },
    estimated_hours: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    ai_generated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'subtasks',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['task_id'] },
      { fields: ['status'] }
    ]
  });

  // Добавляем статические методы валидации к модели
  Subtask.validateCreate = SubtaskValidator.validateCreate;
  Subtask.validateUpdate = SubtaskValidator.validateUpdate;
  Subtask.validateStatusChange = SubtaskValidator.validateStatusChange;
  Subtask.validateReorder = SubtaskValidator.validateReorder;
  Subtask.toDatabase = SubtaskValidator.toDatabase;

  return Subtask;
};
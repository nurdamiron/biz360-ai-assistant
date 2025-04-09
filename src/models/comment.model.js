/**
 * Модель комментариев для задач и подзадач
 */
/**
 * Создание модели Comment
 * @param {Object} sequelize - Экземпляр Sequelize
 * @param {Object} DataTypes - Типы данных Sequelize
 * @returns {Object} - Модель Sequelize
 */
module.exports = (sequelize, DataTypes) => {
  const Comment = sequelize.define('comment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    task_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tasks',
        key: 'id'
      },
      comment: 'ID задачи, к которой относится комментарий'
    },
    subtask_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subtasks',
        key: 'id'
      },
      comment: 'ID подзадачи, к которой относится комментарий'
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID пользователя, оставившего комментарий'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Содержание комментария'
    },
    is_ai_generated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Флаг, указывающий, что комментарий создан AI'
    },
    parent_comment_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'comments',
        key: 'id'
      },
      comment: 'ID родительского комментария для цепочек ответов'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Дата удаления (soft delete)'
    }
  }, {
    tableName: 'comments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    paranoid: true, // Включаем soft delete
    indexes: [
      { fields: ['task_id'] },
      { fields: ['subtask_id'] },
      { fields: ['user_id'] },
      { fields: ['parent_comment_id'] },
      { fields: ['created_at'] }
    ]
  });

  /**
   * Устанавливаем ассоциации в самой модели для большей инкапсуляции
   * ВАЖНО: Не дублируйте эти ассоциации в index.js
   */
  Comment.associate = function(models) {
    // Связи уже определены в index.js, поэтому здесь их определять не нужно
    // Оставляем этот метод пустым или удалите его совсем
  };

  /**
   * Валидирует данные перед созданием комментария
   * @param {Object} commentData - Данные комментария
   * @returns {Object} - Результат валидации: { isValid: boolean, errors: string[] }
   */
  Comment.validateCreate = function(commentData) {
    const errors = [];
    
    // Проверка наличия обязательных полей
    if (!commentData.content || commentData.content.trim() === '') {
      errors.push('Содержание комментария не может быть пустым');
    }
    
    // Проверка, что указан либо task_id, либо subtask_id
    if (!commentData.task_id && !commentData.subtask_id) {
      errors.push('Необходимо указать ID задачи или подзадачи');
    }
    
    // Проверка, что не указаны оба поля одновременно
    if (commentData.task_id && commentData.subtask_id) {
      errors.push('Комментарий должен относиться либо к задаче, либо к подзадаче, но не к обоим');
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  };

  return Comment;
};
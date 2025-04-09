/**
 * Модель обратной связи
 * @param {Object} sequelize - экземпляр Sequelize
 * @param {Object} DataTypes - типы данных Sequelize
 * @returns {Object} модель Feedback
 */
module.exports = (sequelize, DataTypes) => {
  const Feedback = sequelize.define('Feedback', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    task_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tasks',
        key: 'id'
      }
    },
    subtask_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subtasks',
        key: 'id'
      }
    },
    code_generation_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'code_generations',
        key: 'id'
      }
    },
    feedback_type: {
      type: DataTypes.ENUM('code_quality', 'code_correctness', 'task_decomposition', 'bug_fixing', 'refactoring', 'general'),
      allowNull: false
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      },
      comment: 'Rating from 1 to 5'
    },
    comments: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    specific_issues: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'JSON string with specific issues found'
    },
    suggestions: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ai_response_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID of the AI response this feedback is about'
    },
    context: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional context for the feedback in JSON format'
    },
    processed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    processing_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'feedbacks',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  // НЕ определяем ассоциации здесь, так как они уже определены в index.js
  // Чтобы избежать конфликтов, удаляем или оставляем пустым метод associate
  Feedback.associate = function(models) {
    // Пустой метод - все ассоциации должны быть определены в index.js
  };

  return Feedback;
};
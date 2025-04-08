// src/models/code-testing.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();
const Task = require('./task.model');
const Subtask = require('./subtask.model');
const User = require('./user.model');

/**
 * Модель для хранения информации о тестировании кода
 */
class CodeTesting extends Model {}

CodeTesting.init({
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
  subtask_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'subtasks',
      key: 'id'
    }
  },
  repository_url: {
    type: DataTypes.STRING,
    allowNull: false
  },
  branch: {
    type: DataTypes.STRING,
    allowNull: false
  },
  test_branch: {
    type: DataTypes.STRING,
    allowNull: true
  },
  project_type: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'node, python, java, etc.'
  },
  test_scope: {
    type: DataTypes.ENUM('unit', 'integration', 'comprehensive'),
    allowNull: false,
    defaultValue: 'unit'
  },
  status: {
    type: DataTypes.ENUM('queued', 'processing', 'completed', 'failed'),
    allowNull: false,
    defaultValue: 'queued'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  results: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON string with test results'
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  initiated_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
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
  sequelize,
  tableName: 'code_testings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Связи
CodeTesting.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
CodeTesting.belongsTo(Subtask, { foreignKey: 'subtask_id', as: 'subtask' });
CodeTesting.belongsTo(User, { foreignKey: 'initiated_by', as: 'initiator' });

module.exports = CodeTesting;
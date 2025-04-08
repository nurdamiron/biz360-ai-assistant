// src/models/test-report.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();
const Task = require('./task.model');
const Subtask = require('./subtask.model');
const CodeGeneration = require('./code-generation.model');

/**
 * Модель отчета о тестировании
 */
class TestReport extends Model {}

TestReport.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  code_generation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'code_generations',
      key: 'id'
    }
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
  status: {
    type: DataTypes.ENUM('in_progress', 'passed', 'failed', 'error'),
    allowNull: false,
    defaultValue: 'in_progress'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  validation_results: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-строка с результатами валидации кода'
  },
  generated_tests: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-строка с информацией о сгенерированных тестах'
  },
  test_results: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-строка с результатами выполнения тестов'
  },
  code_metrics: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-строка с метриками кода'
  },
  success_rate: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Процент успешных тестов (0-100)'
  },
  summary: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Краткое описание результатов тестирования'
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
  tableName: 'test_reports',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Связи
TestReport.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
TestReport.belongsTo(Subtask, { foreignKey: 'subtask_id', as: 'subtask' });
TestReport.belongsTo(CodeGeneration, { foreignKey: 'code_generation_id', as: 'codeGeneration' });

module.exports = TestReport;
// src/models/task-external-link.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();
const Task = require('./task.model');
const IntegrationType = require('./integration-type.model');

/**
 * Модель связи задачи с внешней системой
 */
class TaskExternalLink extends Model {}

TaskExternalLink.init({
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
  integration_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'integration_types',
      key: 'id'
    }
  },
  external_id: {
    type: DataTypes.STRING,
    allowNull: false
  },
  external_url: {
    type: DataTypes.STRING,
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
  sequelize,
  tableName: 'task_external_links',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Связи
TaskExternalLink.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
TaskExternalLink.belongsTo(IntegrationType, { foreignKey: 'integration_type_id', as: 'integrationType' });

module.exports = TaskExternalLink;

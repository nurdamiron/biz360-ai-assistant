// src/models/integration-link.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();
const IntegrationType = require('./integration-type.model');
const Project = require('./project.model');

/**
 * Модель связи интеграции с проектом
 */
class IntegrationLink extends Model {}

IntegrationLink.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'projects',
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
  config: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-строка с конфигурацией интеграции'
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
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
  tableName: 'integration_links',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Связи
IntegrationLink.belongsTo(IntegrationType, { foreignKey: 'integration_type_id', as: 'integrationType' });
IntegrationLink.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });

module.exports = IntegrationLink;
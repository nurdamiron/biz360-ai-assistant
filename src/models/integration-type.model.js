// src/models/integration-type.model.js
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/db.initialize').getSequelize();

/**
 * Модель типа интеграции
 */
class IntegrationType extends Model {}

IntegrationType.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  provider_name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  config_schema: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'JSON-схема для валидации конфигурации интеграции'
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
  tableName: 'integration_types',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = IntegrationType;
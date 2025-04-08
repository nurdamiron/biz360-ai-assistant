// src/api/routes/integration/validation.js
const Joi = require('joi');

// Схема валидации для создания интеграции
const createIntegrationSchema = Joi.object({
  provider: Joi.string().required(),
  config: Joi.object().required()
});

// Схема валидации для обновления интеграции
const updateIntegrationSchema = Joi.object({
  config: Joi.object().optional(),
  active: Joi.boolean().optional()
}).min(1);

// Схема валидации для синхронизации задачи
const synchronizeTaskSchema = Joi.object({
  direction: Joi.string().valid('to-external', 'from-external', 'bidirectional').default('bidirectional'),
  provider: Joi.string().optional()
});

// Схема валидации для импорта задач
const importTasksSchema = Joi.object({
  provider: Joi.string().required(),
  options: Joi.object({
    state: Joi.string().optional(),
    labels: Joi.string().optional(),
    since: Joi.string().isoDate().optional(),
    maxResults: Joi.number().integer().positive().optional(),
    startAt: Joi.number().integer().min(0).optional(),
    page: Joi.number().integer().positive().optional(),
    perPage: Joi.number().integer().positive().optional(),
    jiraProject: Joi.string().optional(),
    status: Joi.string().optional()
  }).optional()
});

module.exports = {
  createIntegrationSchema,
  updateIntegrationSchema,
  synchronizeTaskSchema,
  importTasksSchema
};

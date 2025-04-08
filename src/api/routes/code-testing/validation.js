// src/api/routes/code-testing/validation.js
const Joi = require('joi');

// Схема валидации для тестирования существующего кода
const testExistingCodeSchema = Joi.object({
    filePaths: Joi.array().items(Joi.string()).min(1).required()
});
  

// Схема валидации для запуска тестирования кода
const testCodeValidationSchema = Joi.object({
  taskId: Joi.number().integer().required(),
  subtaskId: Joi.number().integer().allow(null),
  generatedCode: Joi.string().allow(null),
  generatedFiles: Joi.array().items(
    Joi.object({
      path: Joi.string().required(),
      content: Joi.string().required()
    })
  ).allow(null),
  repositoryUrl: Joi.string().required(),
  branch: Joi.string().required(),
  testBranch: Joi.string().allow(null),
  projectType: Joi.string().required(),
  testScope: Joi.string().valid('unit', 'integration', 'comprehensive').default('unit')
});

// Схема валидации для проверки кода
const validateCodeValidationSchema = Joi.object({
  taskId: Joi.number().integer().required(),
  subtaskId: Joi.number().integer().allow(null),
  generatedCode: Joi.string().allow(null),
  generatedFiles: Joi.array().items(
    Joi.object({
      path: Joi.string().required(),
      content: Joi.string().required()
    })
  ).allow(null),
  projectType: Joi.string().required()
});

module.exports = {
  testCodeValidationSchema,
  validateCodeValidationSchema,
  testExistingCodeSchema
};

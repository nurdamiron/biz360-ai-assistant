// src/api/routes/documentation.routes.js

const express = require('express');
const router = express.Router();
const documentationController = require('../../controller/documentation/documentation.controller');
const authMiddleware = require('../middleware/auth');
const { validate } = require('../middleware/validation');

/**
 * @route POST /api/documentation/generate
 * @description Генерирует документацию для проекта или указанных модулей
 * @access Private
 */
router.post(
  '/generate',
  authMiddleware,
  validate({
    body: {
      modules: { type: 'array', optional: true },
      api: { type: 'object', optional: true }
    }
  }),
  documentationController.generateDocumentation
);

/**
 * @route POST /api/documentation/update
 * @description Обновляет документацию для изменившихся файлов
 * @access Private
 */
router.post(
  '/update',
  authMiddleware,
  validate({
    body: {
      since: { type: 'string', optional: true },
      outputDir: { type: 'string', optional: true },
      format: { type: 'string', optional: true }
    }
  }),
  documentationController.updateDocumentation
);

/**
 * @route POST /api/documentation/file
 * @description Генерирует документацию для конкретного файла
 * @access Private
 */
router.post(
  '/file',
  authMiddleware,
  validate({
    body: {
      filePath: { type: 'string', required: true },
      format: { type: 'string', optional: true }
    }
  }),
  documentationController.generateFileDocumentation
);

/**
 * @route POST /api/documentation/swagger
 * @description Генерирует Swagger документацию для API
 * @access Private
 */
router.post(
  '/swagger',
  authMiddleware,
  validate({
    body: {
      routesDir: { type: 'string', optional: true },
      outputDir: { type: 'string', optional: true },
      apiTitle: { type: 'string', optional: true },
      apiVersion: { type: 'string', optional: true }
    }
  }),
  documentationController.generateSwagger
);

/**
 * @route POST /api/documentation/readme
 * @description Генерирует README.md для проекта или модуля
 * @access Private
 */
router.post(
  '/readme',
  authMiddleware,
  validate({
    body: {
      modulePath: { type: 'string', optional: true },
      description: { type: 'string', optional: true }
    }
  }),
  documentationController.generateReadme
);

module.exports = router;
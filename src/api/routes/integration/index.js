// src/api/routes/integration/index.js
const express = require('express');
const router = express.Router();
const integrationController = require('../../../controller/integration/integration.controller');
const authMiddleware = require('../../middleware/auth');
const validationMiddleware = require('../../middleware/validation');
const { 
  createIntegrationSchema, 
  updateIntegrationSchema, 
  synchronizeTaskSchema,
  importTasksSchema
} = require('./validation');

// Все эндпоинты требуют аутентификации
router.use(authMiddleware);

// Получение списка доступных типов интеграций
router.get('/types', integrationController.getIntegrationTypes);

// Получение активных интеграций для проекта
router.get('/project/:projectId', integrationController.getProjectIntegrations);

// Создание интеграции для проекта
router.post('/project/:projectId',
  validationMiddleware(createIntegrationSchema),
  integrationController.createIntegration
);

// Обновление интеграции
router.put('/:integrationId',
  validationMiddleware(updateIntegrationSchema),
  integrationController.updateIntegration
);

// Удаление интеграции
router.delete('/:integrationId', integrationController.deleteIntegration);

// Получение внешних ссылок для задачи
router.get('/task/:taskId/links', integrationController.getTaskExternalLinks);

// Синхронизация задачи с внешней системой
router.post('/task/:taskId/sync',
  validationMiddleware(synchronizeTaskSchema),
  integrationController.synchronizeTask
);

// Импорт задач из внешней системы
router.post('/project/:projectId/import-tasks',
  validationMiddleware(importTasksSchema),
  integrationController.importTasksFromExternalSystem
);

module.exports = router;
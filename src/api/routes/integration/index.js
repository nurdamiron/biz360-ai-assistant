// src/api/routes/integration/index.js
const express = require('express');
const router = express.Router();
const integrationController = require('../../../controller/integration/integration.controller');
const { authenticateCombined } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');
const {
  createIntegrationSchema,
  updateIntegrationSchema,
  synchronizeTaskSchema,
  importTasksSchema
} = require('./validation');

// Apply authentication to all routes in this router
router.use(authenticateCombined);

// Get list of available integration types
router.get('/types', integrationController.getIntegrationTypes);

// Get active integrations for a project
router.get('/project/:projectId', integrationController.getProjectIntegrations);

// Create integration for a project
router.post(
  '/project/:projectId',
  validate(createIntegrationSchema),
  integrationController.createIntegration
);

// Update integration
router.put(
  '/:integrationId',
  validate(updateIntegrationSchema),
  integrationController.updateIntegration
);

// Delete integration
router.delete('/:integrationId', integrationController.deleteIntegration);

// Get external links for a task
router.get('/task/:taskId/links', integrationController.getTaskExternalLinks);

// Synchronize task with external system
router.post(
  '/task/:taskId/sync',
  validate(synchronizeTaskSchema),
  integrationController.synchronizeTask
);

// Import tasks from external system
router.post(
  '/project/:projectId/import-tasks',
  validate(importTasksSchema),
  integrationController.importTasksFromExternalSystem
);

module.exports = router;
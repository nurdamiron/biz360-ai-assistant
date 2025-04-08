// src/api/routes/task/workflow.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const WorkflowController = require('../../../controller/task/workflow.controller');

// Получение информации о рабочем процессе
router.get('/:taskId/workflow', authenticateCombined, WorkflowController.getWorkflowStatus);

// Запуск рабочего процесса
router.post('/:taskId/workflow/start', authenticateCombined, WorkflowController.startWorkflow);

// Выполнение текущего шага (для автоматических шагов)
router.post('/:taskId/workflow/execute', authenticateCombined, WorkflowController.executeCurrentStep);

// Переход к следующему шагу (с возможностью передачи данных ручного шага)
router.post('/:taskId/workflow/next', authenticateCombined, WorkflowController.moveToNextStep);

// Сброс рабочего процесса
router.post('/:taskId/workflow/reset', authenticateCombined, WorkflowController.resetWorkflow);

module.exports = router;
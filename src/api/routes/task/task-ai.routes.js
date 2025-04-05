// src/api/routes/task/task-ai.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskAIController = require('../../../controller/task/task-ai.controller');

/**
 * @route   POST /api/tasks/ai/:id/decompose
 * @desc    Декомпозировать задачу на подзадачи с помощью AI
 * @access  Private
 */
router.post('/:id/decompose', authenticateCombined, taskAIController.decomposeTask);

/**
 * @route   POST /api/tasks/ai/:id/generate-code
 * @desc    Генерировать код для задачи с помощью AI
 * @access  Private
 */
router.post('/:id/generate-code', authenticateCombined, taskAIController.generateCode);

/**
 * @route   GET /api/tasks/ai/:id/generated-code
 * @desc    Получить сгенерированный код для задачи
 * @access  Private
 */
router.get('/:id/generated-code', authenticateCombined, taskAIController.getGeneratedCode);

/**
 * @route   PUT /api/tasks/ai/code/:generationId/status
 * @desc    Обновить статус сгенерированного кода
 * @access  Private
 */
router.put('/code/:generationId/status', authenticateCombined, taskAIController.updateCodeStatus);

/**
 * @route   POST /api/tasks/ai/:id/estimate-complexity
 * @desc    Получить оценку сложности задачи с помощью AI
 * @access  Private
 */
router.post('/:id/estimate-complexity', authenticateCombined, taskAIController.estimateTaskComplexity);

/**
 * @route   POST /api/tasks/ai/:id/generate-plan
 * @desc    Сгенерировать план работы над задачей
 * @access  Private
 */
router.post('/:id/generate-plan', authenticateCombined, taskAIController.generateWorkPlan);

module.exports = router;
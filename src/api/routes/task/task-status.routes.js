// src/api/routes/task/task-status.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskStatusController = require('../../../controller/task/task-status.controller');

/**
 * @route   PUT /api/tasks/status/:id
 * @desc    Изменить статус задачи
 * @access  Private
 */
router.put('/:id', authenticateCombined, taskStatusController.changeTaskStatus);

/**
 * @route   GET /api/tasks/status/:id/history
 * @desc    Получить историю изменений статуса задачи
 * @access  Private
 */
router.get('/:id/history', authenticateCombined, taskStatusController.getStatusHistory);

/**
 * @route   GET /api/tasks/status/statistics
 * @desc    Получить статистику по статусам задач
 * @access  Private
 */
router.get('/statistics', authenticateCombined, taskStatusController.getStatusStatistics);

module.exports = router;
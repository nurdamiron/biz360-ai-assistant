// src/api/routes/task/subtask.routes.js

const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams для доступа к :taskId из родительского маршрута
const { authenticateCombined } = require('../../middleware/auth');
const subtaskController = require('../../../controller/subtask/subtask.controller');

/**
 * @route   GET /api/tasks/:taskId/subtasks
 * @desc    Получить список подзадач для задачи
 * @access  Private
 */
router.get('/', authenticateCombined, subtaskController.getSubtasks);

/**
 * @route   GET /api/tasks/:taskId/subtasks/:subtaskId
 * @desc    Получить подзадачу по ID
 * @access  Private
 */
router.get('/:subtaskId', authenticateCombined, subtaskController.getSubtaskById);

/**
 * @route   POST /api/tasks/:taskId/subtasks
 * @desc    Создать новую подзадачу
 * @access  Private
 */
router.post('/', authenticateCombined, subtaskController.createSubtask);

/**
 * @route   PUT /api/tasks/:taskId/subtasks/:subtaskId
 * @desc    Обновить подзадачу
 * @access  Private
 */
router.put('/:subtaskId', authenticateCombined, subtaskController.updateSubtask);

/**
 * @route   DELETE /api/tasks/:taskId/subtasks/:subtaskId
 * @desc    Удалить подзадачу
 * @access  Private
 */
router.delete('/:subtaskId', authenticateCombined, subtaskController.deleteSubtask);

/**
 * @route   PUT /api/tasks/:taskId/subtasks/:subtaskId/status
 * @desc    Изменить статус подзадачи
 * @access  Private
 */
router.put('/:subtaskId/status', authenticateCombined, subtaskController.changeSubtaskStatus);

/**
 * @route   POST /api/tasks/:taskId/subtasks/reorder
 * @desc    Изменить порядок подзадач
 * @access  Private
 */
router.post('/reorder', authenticateCombined, subtaskController.reorderSubtasks);

module.exports = router;
// src/api/routes/task/task-assignment.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskAssignmentController = require('../../../controller/task/task-assignment.controller');

/**
 * @route   PUT /api/tasks/assignment/:id
 * @desc    Назначить задачу пользователю
 * @access  Private
 */
router.put('/:id', authenticateCombined, taskAssignmentController.assignTask);

/**
 * @route   GET /api/tasks/assignment/users
 * @desc    Получить список пользователей для назначения задачи
 * @access  Private
 */
router.get('/users', authenticateCombined, taskAssignmentController.getAssignableUsers);

/**
 * @route   POST /api/tasks/assignment/:id/auto
 * @desc    Автоматическое назначение задачи оптимальному исполнителю
 * @access  Private
 */
router.post('/:id/auto', authenticateCombined, taskAssignmentController.autoAssignTask);

/**
 * @route   GET /api/tasks/assignment/workload
 * @desc    Получить загруженность пользователей
 * @access  Private
 */
router.get('/workload', authenticateCombined, taskAssignmentController.getUsersWorkload);

module.exports = router;
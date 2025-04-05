// src/api/routes/task/task-filter.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskFilterController = require('../../../controller/task/task-filter.controller');

/**
 * @route   GET /api/tasks/filter
 * @desc    Получить список задач с фильтрацией, сортировкой и пагинацией
 * @access  Private
 */
router.get('/', authenticateCombined, taskFilterController.getTasks);

/**
 * @route   GET /api/tasks/filter/project/:projectId
 * @desc    Получить задачи, принадлежащие проекту
 * @access  Private
 */
router.get('/project/:projectId', authenticateCombined, taskFilterController.getTasksByProject);

/**
 * @route   GET /api/tasks/filter/user/:userId
 * @desc    Получить задачи, назначенные пользователю
 * @access  Private
 */
router.get('/user/:userId', authenticateCombined, taskFilterController.getTasksByUser);

/**
 * @route   GET /api/tasks/filter/:id/similar
 * @desc    Поиск похожих задач
 * @access  Private
 */
router.get('/:id/similar', authenticateCombined, taskFilterController.findSimilarTasks);

/**
 * @route   GET /api/tasks/filter/tree
 * @desc    Получить дерево задач (задачи с подзадачами)
 * @access  Private
 */
router.get('/tree', authenticateCombined, taskFilterController.getTaskTree);

module.exports = router;
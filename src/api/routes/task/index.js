// src/api/routes/task/index.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskController = require('../../../controller/task/task.controller');

// Импорт специализированных маршрутов
const taskStatusRoutes = require('./task-status.routes');
const taskTagsRoutes = require('./task-tags.routes');
const taskAssignmentRoutes = require('./task-assignment.routes');
const taskFilterRoutes = require('./task-filter.routes');
const subtaskRoutes = require('./subtask.routes');

// Базовые CRUD операции
/**
 * @route   GET /api/tasks/:id
 * @desc    Получить детальную информацию о задаче
 * @access  Private
 */
router.get('/:id', authenticateCombined, taskController.getTaskById);

/**
 * @route   POST /api/tasks
 * @desc    Создать новую задачу
 * @access  Private
 */
router.post('/', authenticateCombined, taskController.createTask);

/**
 * @route   PUT /api/tasks/:id
 * @desc    Обновить существующую задачу
 * @access  Private
 */
router.put('/:id', authenticateCombined, taskController.updateTask);

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Удалить задачу
 * @access  Private
 */
router.delete('/:id', authenticateCombined, taskController.deleteTask);

// Подключение специализированных маршрутов
router.use('/status', taskStatusRoutes);
router.use('/tags', taskTagsRoutes);
router.use('/assignment', taskAssignmentRoutes);
router.use('/filter', taskFilterRoutes);
router.use('/:taskId/subtasks', subtaskRoutes);

module.exports = router;
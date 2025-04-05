// src/api/routes/task/task-tags.routes.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../../middleware/auth');
const taskTagsController = require('../../../controller/task/task-tags.controller');

/**
 * @route   GET /api/tasks/tags/all
 * @desc    Получить все доступные теги системы
 * @access  Private
 */
router.get('/all', authenticateCombined, taskTagsController.getAllTags);

/**
 * @route   GET /api/tasks/tags/popular
 * @desc    Получить популярные теги
 * @access  Private
 */
router.get('/popular', authenticateCombined, taskTagsController.getPopularTags);

/**
 * @route   GET /api/tasks/tags/:id
 * @desc    Получить теги задачи
 * @access  Private
 */
router.get('/:id', authenticateCombined, taskTagsController.getTaskTags);

/**
 * @route   POST /api/tasks/tags/:id
 * @desc    Добавить теги к задаче
 * @access  Private
 */
router.post('/:id', authenticateCombined, taskTagsController.addTaskTags);

/**
 * @route   DELETE /api/tasks/tags/:id
 * @desc    Удалить теги у задачи
 * @access  Private
 */
router.delete('/:id', authenticateCombined, taskTagsController.removeTaskTags);

module.exports = router;
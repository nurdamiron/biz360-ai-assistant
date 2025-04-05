// src/api/routes/projects.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const projectController = require('../../controllers/project.controller');
const projectFilesRoutes = require('./project-files.routes');
const projectStatsRoutes = require('./project-stats.routes');
const projectSettingsRoutes = require('./project-settings.routes');
const projectTagsRoutes = require('./project-tags.routes');

// Базовые CRUD операции с проектами
/**
 * @route   GET /api/projects
 * @desc    Получить список проектов
 * @access  Private
 */
router.get('/', authenticateCombined, projectController.getProjects);

/**
 * @route   GET /api/projects/:id
 * @desc    Получить детальную информацию о проекте
 * @access  Private
 */
router.get('/:id', authenticateCombined, projectController.getProjectById);

/**
 * @route   POST /api/projects
 * @desc    Создать новый проект
 * @access  Private
 */
router.post('/', authenticateCombined, projectController.createProject);

/**
 * @route   PUT /api/projects/:id
 * @desc    Обновить проект
 * @access  Private
 */
router.put('/:id', authenticateCombined, projectController.updateProject);

/**
 * @route   DELETE /api/projects/:id
 * @desc    Удалить проект
 * @access  Private
 */
router.delete('/:id', authenticateCombined, projectController.deleteProject);

// Вложенные маршруты - использует mergeParams: true в этих роутерах для доступа к :id
router.use('/:id/files', projectFilesRoutes);
router.use('/:id/stats', projectStatsRoutes);
router.use('/:id/settings', projectSettingsRoutes);
router.use('/:id/tags', projectTagsRoutes);

module.exports = router;
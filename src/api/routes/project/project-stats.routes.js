// src/api/routes/project-stats.routes.js

const express = require('express');
const router = express.Router({ mergeParams: true }); // Для доступа к req.params.id из родительского роутера
const { authenticateCombined } = require('../middleware/auth');
const projectStatsController = require('../../controllers/project-stats.controller');

/**
 * @route   GET /api/projects/:id/stats
 * @desc    Получить статистику по проекту
 * @access  Private
 */
router.get('/', authenticateCombined, projectStatsController.getProjectStats);

module.exports = router;
// src/api/routes/git-integration.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const gitController = require('../../controller/git-integration/git-controller');

/**
 * @route   POST /api/git/projects/:projectId/init
 * @desc    Инициализировать Git-репозиторий для проекта
 * @access  Private
 */
router.post('/projects/:projectId/init', authenticateCombined, gitController.initializeRepository);

/**
 * @route   POST /api/git/tasks/:taskId/branch
 * @desc    Создать ветку для задачи
 * @access  Private
 */
router.post('/tasks/:taskId/branch', authenticateCombined, gitController.createTaskBranch);

/**
 * @route   POST /api/git/tasks/:taskId/commit
 * @desc    Создать коммит для задачи
 * @access  Private
 */
router.post('/tasks/:taskId/commit', authenticateCombined, gitController.commitTaskChanges);

/**
 * @route   POST /api/git/tasks/:taskId/pr
 * @desc    Создать Pull Request для задачи
 * @access  Private
 */
router.post('/tasks/:taskId/pr', authenticateCombined, gitController.createPullRequest);

/**
 * @route   GET /api/git/tasks/:taskId/status
 * @desc    Получить Git-статус задачи
 * @access  Private
 */
router.get('/tasks/:taskId/status', authenticateCombined, gitController.getTaskGitStatus);

module.exports = router;
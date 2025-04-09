// src/api/routes/git-integration.js

const express = require('express');
const router = express.Router();

// Подключаем маршруты PR
const prRoutes = require('./git-integration/pr.routes');

// Импортируем существующие контроллеры
const gitController = require('../../controller/git-integration/git-controller');
const { authenticateCombined } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// Регистрируем маршруты для PR
router.use('/pr', prRoutes);

/**
 * @route POST /api/git/clone
 * @description Клонирует репозиторий
 * @access Private
 */
router.post(
  '/clone',
  authenticateCombined,
  validate({
    body: {
      repositoryUrl: { type: 'string', required: true },
      branch: { type: 'string', optional: true },
      destination: { type: 'string', optional: true }
    }
  }),
  gitController.cloneRepository
);

/**
 * @route POST /api/git/pull
 * @description Выполняет git pull
 * @access Private
 */
router.post(
  '/pull',
  authenticateCombined,
  validate({
    body: {
      projectId: { type: 'string', required: true },
      branch: { type: 'string', optional: true }
    }
  }),
  gitController.pullRepository
);

/**
 * @route POST /api/git/branch
 * @description Создает новую ветку
 * @access Private
 */
router.post(
  '/branch',
  authenticateCombined,
  validate({
    body: {
      projectId: { type: 'string', required: true },
      name: { type: 'string', required: true },
      baseBranch: { type: 'string', optional: true }
    }
  }),
  gitController.createBranch
);

/**
 * @route GET /api/git/branches
 * @description Получает список веток
 * @access Private
 */
router.get(
  '/branches',
  authenticateCombined,
  validate({
    query: {
      projectId: { type: 'string', required: true }
    }
  }),
  gitController.getBranches
);

/**
 * @route POST /api/git/checkout
 * @description Выполняет checkout ветки
 * @access Private
 */
router.post(
  '/checkout',
  authenticateCombined,
  validate({
    body: {
      projectId: { type: 'string', required: true },
      branch: { type: 'string', required: true }
    }
  }),
  gitController.checkoutBranch
);

/**
 * @route POST /api/git/commit
 * @description Создает коммит
 * @access Private
 */
router.post(
  '/commit',
  authenticateCombined,
  validate({
    body: {
      projectId: { type: 'string', required: true },
      message: { type: 'string', required: true },
      files: { type: 'array', optional: true }
    }
  }),
  gitController.createCommit
);

/**
 * @route POST /api/git/push
 * @description Выполняет git push
 * @access Private
 */
router.post(
  '/push',
  authenticateCombined,
  validate({
    body: {
      projectId: { type: 'string', required: true },
      branch: { type: 'string', optional: true }
    }
  }),
  gitController.pushBranch
);

/**
 * @route GET /api/git/status
 * @description Получает статус репозитория
 * @access Private
 */
router.get(
  '/status',
  authenticateCombined,
  validate({
    query: {
      projectId: { type: 'string', required: true }
    }
  }),
  gitController.getStatus
);

/**
 * @route GET /api/git/commits
 * @description Получает историю коммитов
 * @access Private
 */
router.get(
  '/commits',
  authenticateCombined,
  validate({
    query: {
      projectId: { type: 'string', required: true },
      branch: { type: 'string', optional: true },
      limit: { type: 'number', optional: true }
    }
  }),
  gitController.getCommits
);

module.exports = router;
// src/api/routes/git-integration/pr.routes.js

const express = require('express');
const router = express.Router();
const prController = require('../../../controller/git-integration/pr-controller');
const authMiddleware = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');

/**
 * @route POST /api/git/pr/create
 * @description Создает новый Pull Request
 * @access Private
 */
router.post(
  '/create',
  authMiddleware,
  validate({
    body: {
      baseBranch: { type: 'string', required: true },
      headBranch: { type: 'string', required: true },
      title: { type: 'string', required: true },
      body: { type: 'string', optional: true },
      draft: { type: 'boolean', optional: true },
      taskId: { type: 'string', optional: true },
      taskTitle: { type: 'string', optional: true },
      repositoryUrl: { type: 'string', optional: true }
    }
  }),
  prController.createPR
);

/**
 * @route POST /api/git/pr/conflicts
 * @description Проверяет наличие конфликтов перед созданием PR
 * @access Private
 */
router.post(
  '/conflicts',
  authMiddleware,
  validate({
    body: {
      baseBranch: { type: 'string', required: true },
      headBranch: { type: 'string', required: true },
      analyzeConflicts: { type: 'boolean', optional: true }
    }
  }),
  prController.checkConflicts
);

/**
 * @route POST /api/git/pr/description
 * @description Генерирует описание для PR
 * @access Private
 */
router.post(
  '/description',
  authMiddleware,
  validate({
    body: {
      baseBranch: { type: 'string', required: true },
      headBranch: { type: 'string', required: true },
      repositoryUrl: { type: 'string', optional: true },
      taskId: { type: 'string', optional: true },
      taskTitle: { type: 'string', optional: true },
      taskDescription: { type: 'string', optional: true },
      includeChangeList: { type: 'boolean', optional: true }
    }
  }),
  prController.generateDescription
);

/**
 * @route POST /api/git/pr/checklist
 * @description Генерирует чеклист для ревью PR
 * @access Private
 */
router.post(
  '/checklist',
  authMiddleware,
  validate({
    body: {
      baseBranch: { type: 'string', required: true },
      headBranch: { type: 'string', required: true },
      repositoryUrl: { type: 'string', optional: true },
      taskId: { type: 'string', optional: true },
      fileExtensions: { type: 'array', optional: true },
      detailedChecklist: { type: 'boolean', optional: true }
    }
  }),
  prController.generateChecklist
);

/**
 * @route POST /api/git/pr/evaluate
 * @description Оценивает PR на основе чеклиста
 * @access Private
 */
router.post(
  '/evaluate',
  authMiddleware,
  validate({
    body: {
      baseBranch: { type: 'string', required: true },
      headBranch: { type: 'string', required: true },
      prDescription: { type: 'string', required: true },
      checklist: { type: 'object', required: true }
    }
  }),
  prController.evaluatePR
);

/**
 * @route GET /api/git/pr/:prId
 * @description Получает информацию о PR
 * @access Private
 */
router.get(
  '/:prId',
  authMiddleware,
  prController.getPRInfo
);

/**
 * @route POST /api/git/pr/info
 * @description Получает информацию о PR (альтернативный метод)
 * @access Private
 */
router.post(
  '/info',
  authMiddleware,
  validate({
    body: {
      prId: { type: 'string', required: true },
      repositoryUrl: { type: 'string', optional: true }
    }
  }),
  prController.getPRInfo
);

/**
 * @route PUT /api/git/pr/:prId
 * @description Обновляет PR
 * @access Private
 */
router.put(
  '/:prId',
  authMiddleware,
  validate({
    body: {
      title: { type: 'string', optional: true },
      body: { type: 'string', optional: true },
      state: { type: 'string', optional: true, enum: ['open', 'closed'] }
    }
  }),
  prController.updatePR
);

/**
 * @route POST /api/git/pr/:prId/comment
 * @description Добавляет комментарий к PR
 * @access Private
 */
router.post(
  '/:prId/comment',
  authMiddleware,
  validate({
    body: {
      comment: { type: 'string', required: true }
    }
  }),
  prController.addComment
);

/**
 * @route POST /api/git/pr/:prId/merge
 * @description Мерджит PR
 * @access Private
 */
router.post(
  '/:prId/merge',
  authMiddleware,
  validate({
    body: {
      mergeMethod: { type: 'string', optional: true, enum: ['merge', 'squash', 'rebase'] },
      commitTitle: { type: 'string', optional: true },
      commitMessage: { type: 'string', optional: true }
    }
  }),
  prController.mergePR
);

module.exports = router;
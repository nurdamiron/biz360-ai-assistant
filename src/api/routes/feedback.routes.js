// src/api/routes/feedback.routes.js

const express = require('express');
const router = express.Router();
const feedbackController = require('../../controller/feedback/feedback.controller');
const authMiddleware = require('../middleware/auth');
const { validate } = require('../middleware/validation');

/**
 * @route POST /api/feedback
 * @description Создает новую обратную связь
 * @access Private
 */
router.post(
  '/',
  authMiddleware,
  validate({
    body: {
      text: { type: 'string', required: true },
      rating: { type: 'number', min: 1, max: 5, required: true },
      taskId: { type: 'string', optional: true },
      category: { type: 'string', optional: true }
    }
  }),
  feedbackController.createFeedback
);

/**
 * @route GET /api/feedback
 * @description Получает список обратной связи с фильтрацией
 * @access Private
 */
router.get(
  '/',
  authMiddleware,
  feedbackController.getFeedbackList
);

/**
 * @route POST /api/feedback/summary
 * @description Получает сводный анализ обратной связи
 * @access Private
 */
router.post(
  '/summary',
  authMiddleware,
  validate({
    body: {
      startDate: { type: 'string', required: true },
      endDate: { type: 'string', required: true },
      category: { type: 'string', optional: true },
      userId: { type: 'string', optional: true }
    }
  }),
  feedbackController.getFeedbackSummary
);

/**
 * @route POST /api/feedback/prioritize
 * @description Получает приоритизированные изменения на основе обратной связи
 * @access Private
 */
router.post(
  '/prioritize',
  authMiddleware,
  validate({
    body: {
      startDate: { type: 'string', optional: true },
      endDate: { type: 'string', optional: true },
      category: { type: 'string', optional: true },
      limit: { type: 'number', optional: true },
      projectId: { type: 'string', optional: true },
      minRating: { type: 'number', optional: true }
    }
  }),
  feedbackController.getPrioritizedChanges
);

/**
 * @route POST /api/feedback/create-tasks
 * @description Создает задачи на основе приоритизированных изменений
 * @access Private
 */
router.post(
  '/create-tasks',
  authMiddleware,
  validate({
    body: {
      changes: { type: 'array', required: true },
      projectId: { type: 'string', required: true }
    }
  }),
  feedbackController.createTasksFromChanges
);

/**
 * @route POST /api/feedback/comments/process
 * @description Обрабатывает комментарии к коду
 * @access Private
 */
router.post(
  '/comments/process',
  authMiddleware,
  validate({
    body: {
      commentIds: { type: 'array', required: true },
      filePath: { type: 'string', optional: true },
      fileContent: { type: 'string', optional: true },
      pullRequestId: { type: 'string', optional: true }
    }
  }),
  feedbackController.processCodeComments
);

/**
 * @route POST /api/feedback/comments/create-tasks
 * @description Создает задачи из комментариев к коду
 * @access Private
 */
router.post(
  '/comments/create-tasks',
  authMiddleware,
  validate({
    body: {
      commentIds: { type: 'array', required: true },
      projectId: { type: 'string', required: true }
    }
  }),
  feedbackController.createTasksFromComments
);

module.exports = router;
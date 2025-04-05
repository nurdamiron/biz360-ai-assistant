// src/api/routes/comments.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');
const commentController = require('../../controller/comment/comment.controller');
const CommentModel = require('../../models/comment.model');

/**
 * Маршруты для комментариев к задачам
 */

/**
 * @route   GET /api/comments/tasks/:taskId
 * @desc    Получить комментарии к задаче
 * @access  Private
 */
router.get('/tasks/:taskId', 
  authenticateCombined, 
  commentController.getTaskComments
);

/**
 * @route   POST /api/comments/tasks/:taskId
 * @desc    Создать комментарий к задаче
 * @access  Private
 */
router.post('/tasks/:taskId', 
  authenticateCombined, 
  validationMiddleware.validateBody(CommentModel.validateCreate),
  commentController.createTaskComment
);

/**
 * @route   PUT /api/comments/tasks/:taskId/:commentId
 * @desc    Обновить комментарий к задаче
 * @access  Private
 */
router.put('/tasks/:taskId/:commentId', 
  authenticateCombined, 
  validationMiddleware.validateBody(CommentModel.validateUpdate),
  commentController.updateTaskComment
);

/**
 * @route   DELETE /api/comments/tasks/:taskId/:commentId
 * @desc    Удалить комментарий к задаче
 * @access  Private
 */
router.delete('/tasks/:taskId/:commentId', 
  authenticateCombined, 
  commentController.deleteTaskComment
);

/**
 * Маршруты для комментариев к подзадачам
 */

/**
 * @route   GET /api/comments/subtasks/:subtaskId
 * @desc    Получить комментарии к подзадаче
 * @access  Private
 */
router.get('/subtasks/:subtaskId', 
  authenticateCombined, 
  commentController.getSubtaskComments
);

/**
 * @route   POST /api/comments/subtasks/:subtaskId
 * @desc    Создать комментарий к подзадаче
 * @access  Private
 */
router.post('/subtasks/:subtaskId', 
  authenticateCombined, 
  validationMiddleware.validateBody(CommentModel.validateCreate),
  commentController.createSubtaskComment
);

/**
 * @route   PUT /api/comments/subtasks/:subtaskId/:commentId
 * @desc    Обновить комментарий к подзадаче
 * @access  Private
 */
router.put('/subtasks/:subtaskId/:commentId', 
  authenticateCombined, 
  validationMiddleware.validateBody(CommentModel.validateUpdate),
  commentController.updateSubtaskComment
);

/**
 * @route   DELETE /api/comments/subtasks/:subtaskId/:commentId
 * @desc    Удалить комментарий к подзадаче
 * @access  Private
 */
router.delete('/subtasks/:subtaskId/:commentId', 
  authenticateCombined, 
  commentController.deleteSubtaskComment
);

module.exports = router;
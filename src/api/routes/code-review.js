// src/api/routes/code-review.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const codeReviewController = require('../../controller/code-review/code-review.controller');

/**
 * @route   POST /api/code-review/request
 * @desc    Запросить AI-проверку кода
 * @access  Private
 */
router.post('/request', authenticateCombined, codeReviewController.requestReview);

/**
 * @route   GET /api/code-review/:id
 * @desc    Получить результаты проверки кода
 * @access  Private
 */
router.get('/:id', authenticateCombined, codeReviewController.getReview);

/**
 * @route   GET /api/code-review/task/:taskId
 * @desc    Получить историю проверок кода для задачи
 * @access  Private
 */
router.get('/task/:taskId', authenticateCombined, codeReviewController.getTaskReviews);

module.exports = router;
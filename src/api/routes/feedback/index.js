// src/api/routes/feedback/index.js
const express = require('express');
const router = express.Router();
const feedbackController = require('../../../controller/feedback/feedback.controller');
const { authenticateCombined } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');
const { feedbackValidationSchema } = require('./validation');

// Apply authentication to all routes in this router
router.use(authenticateCombined);

// Create new feedback
router.post(
  '/',
  validate(feedbackValidationSchema),
  feedbackController.createFeedback
);

// Get feedback list with filtering
router.get('/', feedbackController.getFeedbackList);

// Get feedback summary
router.post('/summary', feedbackController.getFeedbackSummary);

// Get prioritized changes
router.post('/prioritized-changes', feedbackController.getPrioritizedChanges);

// Create tasks from changes
router.post('/create-tasks', feedbackController.createTasksFromChanges);

// Process code comments
router.post('/process-comments', feedbackController.processCodeComments);

// Create tasks from comments
router.post('/create-tasks-from-comments', feedbackController.createTasksFromComments);

module.exports = router;
const express = require('express');
const router = express.Router();
const queueController = require('../../../controller/queue/queue.controller');
const { authenticateCombined } = require('../../middleware/auth');

// Apply authenticateCombined to all routes in this router
router.use(authenticateCombined);

// Routes without admin restrictions
router.get('/', queueController.getQueuesStatus);
router.get('/:queueType', queueController.getQueueStatus);
router.delete('/:queueType', queueController.clearQueue);
router.get('/:queueType/jobs/:jobId', queueController.getJobDetails);
router.post('/:queueType/jobs/:jobId/retry', queueController.retryJob);

module.exports = router;
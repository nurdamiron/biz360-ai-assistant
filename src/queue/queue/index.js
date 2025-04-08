// src/api/routes/queue/index.js
const express = require('express');
const router = express.Router();
const queueController = require('../../../controller/queue/queue.controller');
const authMiddleware = require('../../middleware/auth');
const adminMiddleware = require('../../middleware/admin');

// Все эндпоинты для управления очередями требуют аутентификации
router.use(authMiddleware);

// Получение статуса всех очередей (только для админов)
router.get('/', adminMiddleware, queueController.getQueuesStatus);

// Получение статуса конкретной очереди (только для админов)
router.get('/:queueType', adminMiddleware, queueController.getQueueStatus);

// Очистка конкретной очереди (только для админов)
router.delete('/:queueType', adminMiddleware, queueController.clearQueue);

// Получение деталей конкретного задания (только для админов)
router.get('/:queueType/jobs/:jobId', adminMiddleware, queueController.getJobDetails);

// Повторное выполнение задания (только для админов)
router.post('/:queueType/jobs/:jobId/retry', adminMiddleware, queueController.retryJob);

module.exports = router;


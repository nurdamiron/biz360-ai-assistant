// src/api/routes/task/task-ai.routes.js (обновленная версия)
const express = require('express');
const router = express.Router({ mergeParams: true }); // Для доступа к параметрам из родительского роутера
const taskAIController = require('../../../controller/task/task-ai.controller');
const authMiddleware = require('../../middleware/auth');

// Все эндпоинты требуют аутентификации
router.use(authMiddleware);

// Запуск декомпозиции задачи на подзадачи
router.post('/decompose', taskAIController.decomposeTask);

// Получение предварительного анализа задачи
router.get('/analyze', taskAIController.analyzeTask);

// Проверка статуса выполнения AI-задач для задачи
router.get('/status', taskAIController.checkTaskAIStatus);

// Получение рекомендаций по задаче
router.get('/recommendations', taskAIController.getTaskRecommendations);

module.exports = router;
// src/api/routes/analytics.routes.js

const express = require('express');
const router = express.Router();
const analyticsController = require('../../controller/analytics/analytics.controller');
const authMiddleware = require('../middleware/auth.middleware');

/**
 * Маршруты для аналитики
 */

// Middleware для авторизации
router.use(authMiddleware);

// Получение глобальной статистики (для администраторов и менеджеров)
router.get('/global', 
  authMiddleware.checkRole(['admin', 'manager']), 
  analyticsController.getGlobalStats
);

// Получение аналитики по проекту
router.get('/projects/:id', 
  authMiddleware.checkProjectAccess, 
  analyticsController.getProjectAnalytics
);

// Получение аналитики пользователя
router.get('/users/:id?', 
  authMiddleware.checkUserAccessOrSelf, 
  analyticsController.getUserAnalytics
);

// Получение аналитики AI-компонентов
router.get('/ai', 
  analyticsController.getAiAnalytics
);

// Получение аналитики команды проекта
router.get('/team', 
  authMiddleware.checkProjectAccess, 
  analyticsController.getTeamAnalytics
);

// Получение прогнозов по проекту
router.get('/projects/:id/predictions', 
  authMiddleware.checkProjectAccess, 
  analyticsController.getProjectPredictions
);

/**
 * Экспортируем маршруты
 */
module.exports = router;
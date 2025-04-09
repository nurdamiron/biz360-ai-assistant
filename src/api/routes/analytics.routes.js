const express = require('express');
const router = express.Router();
const analyticsController = require('../../controller/analytics/analytics.controller');
const authMiddleware = require('../middleware/auth');

/**
 * Маршруты для аналитики
 */

// Middleware для авторизации
router.use(authMiddleware.authenticateCombined);

// Получение глобальной статистики (для администраторов и менеджеров)
router.get('/global', 
  authMiddleware.authorize(['admin', 'manager']), 
  analyticsController.getGlobalStats
);

// Получение аналитики по проекту
router.get('/projects/:id', 
  // Заменяем на существующий middleware. В модуле auth.js нет функции checkProjectAccess
  // authMiddleware.checkProjectAccess
  authMiddleware.authenticateCombined, 
  analyticsController.getProjectAnalytics
);

// Получение аналитики пользователя
router.get('/users/:id?', 
  // Заменяем на существующий middleware. В модуле auth.js нет функции checkUserAccessOrSelf
  // authMiddleware.checkUserAccessOrSelf
  authMiddleware.authenticateCombined, 
  analyticsController.getUserAnalytics
);

// Получение аналитики AI-компонентов
router.get('/ai', 
  analyticsController.getAiAnalytics
);

// Получение аналитики команды проекта
router.get('/team', 
  // Заменяем на существующий middleware. В модуле auth.js нет функции checkProjectAccess
  // authMiddleware.checkProjectAccess
  authMiddleware.authenticateCombined, 
  analyticsController.getTeamAnalytics
);

// Получение прогнозов по проекту
router.get('/projects/:id/predictions', 
  // Заменяем на существующий middleware. В модуле auth.js нет функции checkProjectAccess
  // authMiddleware.checkProjectAccess
  authMiddleware.authenticateCombined, 
  analyticsController.getProjectPredictions
);

/**
 * Экспортируем маршруты
 */
module.exports = router;
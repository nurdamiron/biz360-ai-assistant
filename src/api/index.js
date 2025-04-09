// src/api/index.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateCombined } = require('./middleware/auth');

// Импортируем маршруты
const authRoutes = require('./routes/auth');  // Маршруты аутентификации
const tasksRoutes = require('./routes/tasks');  // Маршруты задач
const taskRoutes = require('./routes/task');  // Новые маршруты задач
const aiAssistantRoutes = require('./routes/ai-assistant');  // Маршруты AI-ассистента
const monitoringRoutes = require('./routes/monitoring');  // Маршруты мониторинга
const logsRoutes = require('./routes/logs');  // Маршруты логов
const projectsRouter = require('./routes/projects');
const timeEntriesRoutes = require('./routes/time-entries'); // Маршруты учета времени
const commentsRoutes = require('./routes/comments'); // Маршруты комментариев
const codeReviewRoutes = require('./routes/code-review'); // Маршруты проверки кода
const gitIntegrationRoutes = require('./routes/git-integration'); // Маршруты Git-интеграции
const notificationsRoutes = require('./routes/notifications'); // Маршруты уведомлений
const queueRoutes = require('./routes/queue');
const feedbackRoutes = require('./routes/feedback');
const integrationRoutes = require('./routes/integration');
const { router: orchestrationRoutes, initRoutes: initOrchestrationRoutes } = require('./routes/orchestration.routes');




// Открытые маршруты
router.get('/status', (req, res) => {
  res.json({
    status: 'API работает',
    version: '0.1.0',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.get('/monitoring/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Подключаем маршруты аутентификации БЕЗ аутентификации
router.use('/auth', authRoutes);

// ПОСЛЕ этой строки все маршруты требуют аутентификации
router.use(authenticateCombined);

// Защищенные маршруты
router.use('/tasks', tasksRoutes);  // Старые маршруты задач
router.use('/task', taskRoutes);  // Новые маршруты задач
router.use('/ai-assistant', aiAssistantRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/logs', logsRoutes);
router.use('/projects', projectsRouter);
router.use('/time-entries', timeEntriesRoutes);
router.use('/comments', commentsRoutes);
router.use('/code-review', codeReviewRoutes);
router.use('/git', gitIntegrationRoutes); // Маршруты Git-интеграции
router.use('/notifications', notificationsRoutes); // Новые маршруты уведомлений
router.use('/queues', queueRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/integrations', integrationRoutes);
router.use('/orchestration', orchestrationRoutes);

// Обработчик для несуществующих маршрутов
router.use('*', (req, res) => {
  logger.warn(`Запрос к несуществующему маршруту: ${req.originalUrl}`);
  res.status(404).json({
    error: 'Маршрут не найден',
    path: req.originalUrl
  });
});

/**
 * Инициализирует API с заданными настройками.
 * @param {Object} app - Экземпляр Express приложения.
 * @param {Object} options - Настройки для инициализации.
 * @returns {Object} - Инициализированный маршрутизатор.
 */
const initApi = (app, options = {}) => {
  // Инициализируем маршруты оркестрации и получаем маршрутизатор
  const initializedOrchestrationRouter = initOrchestrationRoutes(options.orchestration || {});
  
  // Используем инициализированный маршрутизатор вместо предварительно импортированного
  router.use('/orchestration', initializedOrchestrationRouter);
  
  // Добавляем маршрут состояния системы
  router.get('/status', async (req, res) => {
    try {
      // Проверяем состояние БД
      const pool = app.locals.db || options.db;
      const connection = await pool.getConnection();
      connection.release();
      
      res.json({
        status: 'ok',
        version: '0.1.0',
        controller: options.controller?.running ? 'running' : 'stopped',
        database: 'connected',
        websocket: options.websocket ? 'running' : 'stopped',
        orchestration: 'enabled'
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message
      });
    }
  });
  
  // Регистрируем маршрутизатор в приложении
  app.use('/api', router);
  
  return router;
};

module.exports = {
  router,
  initApi
};
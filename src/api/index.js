// src/api/index.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateCombined } = require('./middleware/auth');

// Импортируем маршруты
const authRoutes = require('./routes/auth');  // Маршруты аутентификации
const tasksRoutes = require('./routes/tasks');  // Маршруты задач
const aiAssistantRoutes = require('./routes/ai-assistant');  // Маршруты AI-ассистента
const monitoringRoutes = require('./routes/monitoring');  // Маршруты мониторинга
const logsRoutes = require('./routes/logs');  // Маршруты логов
const projectsRoutes = require('./routes/projects');
const projectSettingsRoutes = require('./routes/project-settings');  // Маршруты настроек проектов


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
router.use('/tasks', tasksRoutes);
router.use('/ai-assistant', aiAssistantRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/logs', logsRoutes);
router.use('/projects', projectsRoutes);
router.use('/project-settings', projectSettingsRoutes);

// Обработчик для несуществующих маршрутов
router.use('*', (req, res) => {
  logger.warn(`Запрос к несуществующему маршруту: ${req.originalUrl}`);
  res.status(404).json({
    error: 'Маршрут не найден',
    path: req.originalUrl
  });
});

module.exports = router;
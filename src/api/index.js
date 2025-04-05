// src/api/index.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateCombined } = require('./middleware/auth');


// Подключение открытых маршрутов (не требующих аутентификации)
router.get('/status', (req, res) => {
  res.json({
    status: 'API работает',
    version: '0.1.0',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Открытые маршруты мониторинга
router.get('/monitoring/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Подключаем маршруты аутентификации ДО middleware аутентификации
// Это позволит пользователям входить в систему без аутентификации

const authRoutes = require('./routes/auth');
router.use('/auth', authRoutes);

// Промежуточное ПО для защищенных маршрутов - всё после этой строки требует аутентификации
router.use(authenticateCombined);

// Подключение защищенных маршрутов
const tasksRouter = express.Router();
router.use('/tasks', tasksRouter);

const aiAssistantRouter = express.Router();
router.use('/ai-assistant', aiAssistantRouter);

const monitoringRouter = express.Router();
router.use('/monitoring', monitoringRouter);

const logsRouter = express.Router();
router.use('/logs', logsRouter);

// Подготовка дополнительных маршрутов (будут реализованы позже)
// const projectsRouter = express.Router();
// router.use('/projects', projectsRouter);
// const codeRouter = express.Router();
// router.use('/code', codeRouter);

// Обработчик для несуществующих маршрутов
router.use('*', (req, res) => {
  logger.warn(`Запрос к несуществующему маршруту: ${req.originalUrl}`);
  res.status(404).json({
    error: 'Маршрут не найден',
    path: req.originalUrl
  });
});

module.exports = router;
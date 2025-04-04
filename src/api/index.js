// src/api/index.js

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateCombined } = require('../middleware/auth');

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
router.get('/monitoring/health', require('./routes/monitoring').find(route => 
  route.path === '/health' || route.name === '/health'
));

// Открытые маршруты аутентификации (логин)
router.post('/auth/login', require('./routes/auth').find(route => 
  route.path === '/login' || route.name === '/login'
));

// Промежуточное ПО для защищенных маршрутов
router.use(authenticateCombined);

// Подключение защищенных маршрутов
router.use('/tasks', require('./routes/tasks'));
router.use('/ai-assistant', require('./routes/ai-assistant'));
router.use('/monitoring', require('./routes/monitoring'));
router.use('/auth', require('./routes/auth'));

// Подготовка дополнительных маршрутов (будут реализованы позже)
// router.use('/projects', require('./routes/projects'));
// router.use('/code', require('./routes/code'));

// Обработчик для несуществующих маршрутов
router.use('*', (req, res) => {
  logger.warn(`Запрос к несуществующему маршруту: ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Маршрут не найден',
    path: req.originalUrl
  });
});

module.exports = router;
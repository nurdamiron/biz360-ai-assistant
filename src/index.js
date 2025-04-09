// src/index.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const { pool } = require('./config/db.config');
const { initializeDatabase } = require('./config/db.initialize');
const logger = require('./utils/logger');
const controller = require('./controller');
const websocket = require('./websocket');
const initializeMetrics = require('./core/metrics-init');
const analyticsRoutes = require('./api/routes/analytics.routes');
require('dotenv').config();


// Инициализация приложения
const app = express();
const port = process.env.PORT || 3000;

// Создаем HTTP-сервер (для Express и WebSocket)
const server = http.createServer(app);

// Подключаем WebSocket-сервер
websocket.initialize(server);

// Инициализируем пул соединений с БД и сохраняем его в app.locals
app.locals.db = pool;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'], // Ваш фронтенд URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Подключение основного API-маршрутизатора
// app.use('/api', require('./api'));

// Маршрут состояния системы
app.get('/api/status', async (req, res) => {
  try {
    // Проверяем состояние БД
    const connection = await pool.getConnection();
    connection.release();
    
    res.json({
      status: 'ok',
      version: '0.1.0',
      controller: controller.running ? 'running' : 'stopped',
      database: 'connected',
      websocket: websocket.getInstance() ? 'running' : 'stopped'
    });
  } catch (error) {
    logger.error('Ошибка при проверке состояния системы:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Маршруты для управления контроллером
app.post('/api/controller/start', async (req, res) => {
  try {
    await controller.start();
    res.json({ success: true, message: 'Контроллер запущен' });
  } catch (error) {
    logger.error('Ошибка при запуске контроллера:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/controller/stop', async (req, res) => {
  try {
    await controller.stop();
    res.json({ success: true, message: 'Контроллер остановлен' });
  } catch (error) {
    logger.error('Ошибка при остановке контроллера:', error);
    res.status(500).json({ error: error.message });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  logger.error('Необработанная ошибка:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Инициализация базы данных и запуск сервера
async function start() {
  try {
    // Инициализируем базу данных (создаем таблицы, если их нет)
    await initializeDatabase();
    
    // Запускаем HTTP-сервер
    server.listen(port, () => {
      logger.info(`Сервер запущен на порту ${port}`);
      
      // Автоматически запускаем контроллер при старте сервера
      controller.start().catch(error => {
        logger.error('Ошибка при автоматическом запуске контроллера:', error);
      });
    });
  } catch (error) {
    logger.error('Ошибка при запуске сервера:', error);
    process.exit(1);
  }
}

// Запускаем сервер
start();

// Обработка сигналов завершения процесса
process.on('SIGTERM', () => {
  logger.info('Получен сигнал SIGTERM. Завершение работы...');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  logger.info('Получен сигнал SIGINT. Завершение работы...');
  gracefulShutdown();
});

// Функция для корректного завершения работы
async function gracefulShutdown() {
  try {
    // Останавливаем контроллер
    await controller.stop();
    
    // Останавливаем WebSocket-сервер
    await websocket.shutdown();
    
    // Закрываем HTTP-сервер
    server.close(() => {
      logger.info('HTTP-сервер остановлен');
      
      // Закрываем соединения с БД
      pool.end(() => {
        logger.info('Соединения с базой данных закрыты');
        process.exit(0);
      });
    });
    
    // Если сервер не закрылся за 5 секунд, принудительно завершаем процесс
    setTimeout(() => {
      logger.warn('Принудительное завершение процесса после таймаута');
      process.exit(1);
    }, 5000);
  } catch (error) {
    logger.error('Ошибка при корректном завершении работы:', error);
    process.exit(1);
  }
}

module.exports = app; // Экспортируем для тестирования
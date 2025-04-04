// src/index.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./config/db.config');
const logger = require('./utils/logger');
const controller = require('./controller');

// Инициализация приложения
const app = express();
const port = process.env.PORT || 3000;

// Инициализируем пул соединений с БД и сохраняем его в app.locals
app.locals.db = pool;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Подключение маршрутов API
app.use('/api/tasks', require('./api/routes/tasks'));
// Здесь можно подключить другие маршруты
// app.use('/api/projects', require('./api/routes/projects'));
// app.use('/api/code', require('./api/routes/code'));

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
      database: 'connected'
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

// Запуск сервера
const server = app.listen(port, () => {
  logger.info(`Сервер запущен на порту ${port}`);
  
  // Автоматически запускаем контроллер при старте сервера
  controller.start().catch(error => {
    logger.error('Ошибка при автоматическом запуске контроллера:', error);
  });
});

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
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection } = require('./config/db.config');
const logger = require('./utils/logger');

// Инициализация приложения
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Проверка соединения с базой данных
testConnection()
  .then(connected => {
    if (!connected) {
      logger.error('Не удалось подключиться к базе данных. Завершение работы.');
      process.exit(1);
    }
  })
  .catch(err => {
    logger.error('Ошибка при проверке соединения с базой данных:', err);
    process.exit(1);
  });

// Подключение API маршрутов
app.use('/api', require('./api'));

// Базовый маршрут
app.get('/', (req, res) => {
  res.send('Biz360 ИИ-ассистент разработчика API');
});

// Обработка ошибок
app.use((err, req, res, next) => {
  logger.error('Необработанная ошибка:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера
app.listen(port, () => {
  logger.info(`Сервер запущен на порту ${port}`);
});

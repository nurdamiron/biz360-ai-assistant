require('dotenv').config();

// Основная конфигурация приложения
const appConfig = {
  environment: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  port: process.env.PORT || 3000,
  
  // Конфигурация для работы с Git
  git: {
    username: process.env.GIT_USERNAME,
    token: process.env.GIT_TOKEN
  }
};

module.exports = appConfig;

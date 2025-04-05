// src/core/metrics-init.js

const metricsCollector = require('../utils/metrics-collector');
const logger = require('../utils/logger');

/**
 * Инициализация системы метрик
 */
async function initializeMetrics() {
  try {
    logger.info('Инициализация системы метрик...');
    
    // Инициализация коллектора метрик
    await metricsCollector.initialize();
    
    // Запуск сбора системных метрик
    await metricsCollector.recordSystemMetrics();
    
    // Планирование регулярного сбора метрик (каждые 15 минут)
    setInterval(async () => {
      try {
        await metricsCollector.recordSystemMetrics();
      } catch (error) {
        logger.error('Ошибка при сборе системных метрик:', error);
      }
    }, 15 * 60 * 1000);
    
    logger.info('Система метрик успешно инициализирована');
    
    return true;
  } catch (error) {
    logger.error('Ошибка при инициализации системы метрик:', error);
    return false;
  }
}

module.exports = initializeMetrics;
// src/core/orchestrator/metrics-collector.js

const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Сборщик метрик производительности
 * Отвечает за сбор и анализ метрик производительности шагов и задач
 */
class MetricsCollector {
  constructor() {
    // Хранение метрик в памяти
    this.metrics = new Map();
    
    // Хранение запущенных метрик
    this.runningMetrics = new Map();
  }

  /**
   * Инициализация сборщика метрик
   * @param {object} task - Объект задачи
   * @returns {Promise<void>}
   */
  async initialize(task) {
    logger.debug('MetricsCollector initialized', { taskId: task.id });
  }

  /**
   * Начало выполнения шага (старт метрик)
   * @param {string} taskId - ID задачи
   * @param {number} stepNumber - Номер шага
   * @returns {Promise<string>} - ID метрики
   */
  async startStepExecution(taskId, stepNumber) {
    const metricId = uuidv4();
    
    const metricData = {
      taskId,
      stepNumber,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      status: 'running',
      error: null,
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0
      },
      memoryUsage: process.memoryUsage(),
      metrics: {}
    };
    
    // Сохраняем метрику в памяти
    this.runningMetrics.set(metricId, metricData);
    
    // Запускаем мониторинг потребления ресурсов
    this._startResourceMonitoring(metricId);
    
    logger.debug(`Started metrics collection for step ${stepNumber}`, {
      taskId,
      metricId
    });
    
    return metricId;
  }

  /**
   * Завершение выполнения шага (завершение метрик)
   * @param {string} metricId - ID метрики
   * @param {string} status - Статус выполнения ('success', 'failure')
   * @param {Error} [error=null] - Ошибка (если статус 'failure')
   * @returns {Promise<object>} - Собранные метрики
   */
  async finishStepExecution(metricId, status, error = null) {
    if (!this.runningMetrics.has(metricId)) {
      logger.warn(`No running metrics found for ID ${metricId}`);
      return null;
    }
    
    // Получаем данные метрики
    const metricData = this.runningMetrics.get(metricId);
    
    // Останавливаем мониторинг ресурсов
    this._stopResourceMonitoring(metricId);
    
    // Обновляем данные метрики
    metricData.endTime = Date.now();
    metricData.duration = metricData.endTime - metricData.startTime;
    metricData.status = status;
    
    if (error) {
      metricData.error = {
        message: error.message,
        stack: error.stack,
        code: error.code || null
      };
    }
    
    // Добавляем финальные метрики использования ресурсов
    metricData.finalMemoryUsage = process.memoryUsage();
    
    // Удаляем из списка запущенных и добавляем в общий список
    this.runningMetrics.delete(metricId);
    
    // Формируем ключ для хранения метрик
    const metricsKey = `${metricData.taskId}:${metricData.stepNumber}`;
    
    // Если для этого шага уже есть метрики, добавляем к ним
    if (this.metrics.has(metricsKey)) {
      const existingMetrics = this.metrics.get(metricsKey);
      existingMetrics.push(metricData);
    } else {
      this.metrics.set(metricsKey, [metricData]);
    }
    
    // Сохраняем метрики в БД
    await this._persistMetrics(metricData);
    
    logger.debug(`Finished metrics collection for step ${metricData.stepNumber}`, {
      taskId: metricData.taskId,
      metricId,
      duration: metricData.duration,
      status
    });
    
    return metricData;
  }

  /**
   * Запуск мониторинга ресурсов
   * @param {string} metricId - ID метрики
   * @private
   */
  _startResourceMonitoring(metricId) {
    // В реальной реализации здесь может быть более сложная логика
    // мониторинга использования ресурсов (CPU, память, I/O и т.д.)
  }

  /**
   * Остановка мониторинга ресурсов
   * @param {string} metricId - ID метрики
   * @private
   */
  _stopResourceMonitoring(metricId) {
    // Остановка мониторинга
  }

  /**
   * Обновление использованных токенов LLM
   * @param {string} metricId - ID метрики
   * @param {object} tokenUsage - Использование токенов {prompt, completion, total}
   * @returns {Promise<void>}
   */
  async updateTokenUsage(metricId, tokenUsage) {
    if (!this.runningMetrics.has(metricId)) {
      logger.warn(`No running metrics found for ID ${metricId}`);
      return;
    }
    
    const metricData = this.runningMetrics.get(metricId);
    
    // Обновляем данные об использовании токенов
    metricData.tokenUsage.prompt += tokenUsage.prompt || 0;
    metricData.tokenUsage.completion += tokenUsage.completion || 0;
    metricData.tokenUsage.total += tokenUsage.total || 0;
  }

  /**
   * Добавление произвольной метрики
   * @param {string} metricId - ID метрики
   * @param {string} metricName - Название метрики
   * @param {any} metricValue - Значение метрики
   * @returns {Promise<void>}
   */
  async addCustomMetric(metricId, metricName, metricValue) {
    if (!this.runningMetrics.has(metricId)) {
      logger.warn(`No running metrics found for ID ${metricId}`);
      return;
    }
    
    const metricData = this.runningMetrics.get(metricId);
    
    // Добавляем произвольную метрику
    metricData.metrics[metricName] = metricValue;
  }

  /**
   * Сохранение метрик в БД
   * @param {object} metricData - Данные метрики
   * @returns {Promise<void>}
   * @private
   */
  async _persistMetrics(metricData) {
    try {
      // В реальной реализации здесь может быть сохранение в БД
      // Например, через модель Metrics
      /*
      const { Metrics } = require('../../models');
      await Metrics.create({
        taskId: metricData.taskId,
        stepNumber: metricData.stepNumber,
        startTime: new Date(metricData.startTime),
        endTime: new Date(metricData.endTime),
        duration: metricData.duration,
        status: metricData.status,
        error: metricData.error ? JSON.stringify(metricData.error) : null,
        tokenUsage: JSON.stringify(metricData.tokenUsage),
        memoryUsage: JSON.stringify(metricData.memoryUsage),
        finalMemoryUsage: JSON.stringify(metricData.finalMemoryUsage),
        metrics: JSON.stringify(metricData.metrics)
      });
      */
      
      // Для примера просто логируем
      logger.debug('Would persist metrics to DB', {
        taskId: metricData.taskId,
        stepNumber: metricData.stepNumber,
        duration: metricData.duration,
        status: metricData.status
      });
    } catch (error) {
      logger.error(`Error persisting metrics: ${error.message}`, {
        taskId: metricData.taskId,
        stepNumber: metricData.stepNumber,
        error
      });
      // Не выбрасываем ошибку, чтобы не прерывать основной процесс
    }
  }

  /**
   * Сбор метрик по задаче
   * @param {string} taskId - ID задачи
   * @returns {Promise<object>} - Агрегированные метрики по задаче
   */
  async collectTaskMetrics(taskId) {
    // Собираем все метрики для задачи
    const taskMetrics = [];
    
    for (const [key, metricsArray] of this.metrics.entries()) {
      if (key.startsWith(`${taskId}:`)) {
        taskMetrics.push(...metricsArray);
      }
    }
    
    // Сортируем по номеру шага и времени начала
    taskMetrics.sort((a, b) => {
      if (a.stepNumber !== b.stepNumber) {
        return a.stepNumber - b.stepNumber;
      }
      return a.startTime - b.startTime;
    });
    
    // Агрегируем метрики
    const aggregatedMetrics = {
      taskId,
      totalDuration: 0,
      stepsExecuted: new Set(),
      tokenUsage: {
        prompt: 0,
        completion: 0,
        total: 0
      },
      stepMetrics: {},
      errors: []
    };
    
    // Суммируем метрики по всем шагам
    for (const metric of taskMetrics) {
      aggregatedMetrics.totalDuration += metric.duration || 0;
      aggregatedMetrics.stepsExecuted.add(metric.stepNumber);
      
      aggregatedMetrics.tokenUsage.prompt += metric.tokenUsage.prompt || 0;
      aggregatedMetrics.tokenUsage.completion += metric.tokenUsage.completion || 0;
      aggregatedMetrics.tokenUsage.total += metric.tokenUsage.total || 0;
      
      // Добавляем метрики по шагу
      if (!aggregatedMetrics.stepMetrics[metric.stepNumber]) {
        aggregatedMetrics.stepMetrics[metric.stepNumber] = {
          attempts: 0,
          totalDuration: 0,
          successCount: 0,
          failureCount: 0,
          avgDuration: 0
        };
      }
      
      const stepMetric = aggregatedMetrics.stepMetrics[metric.stepNumber];
      stepMetric.attempts++;
      stepMetric.totalDuration += metric.duration || 0;
      
      if (metric.status === 'success') {
        stepMetric.successCount++;
      } else if (metric.status === 'failure') {
        stepMetric.failureCount++;
        
        // Добавляем ошибку в список
        if (metric.error) {
          aggregatedMetrics.errors.push({
            stepNumber: metric.stepNumber,
            message: metric.error.message,
            time: new Date(metric.endTime)
          });
        }
      }
      
      // Рассчитываем среднюю продолжительность
      stepMetric.avgDuration = stepMetric.totalDuration / stepMetric.attempts;
    }
    
    // Преобразуем Set в Array для возвращаемого объекта
    aggregatedMetrics.stepsExecuted = Array.from(aggregatedMetrics.stepsExecuted);
    
    // Сохраняем агрегированные метрики
    await this._persistAggregatedMetrics(aggregatedMetrics);
    
    return aggregatedMetrics;
  }

  /**
   * Сохранение агрегированных метрик
   * @param {object} aggregatedMetrics - Агрегированные метрики
   * @returns {Promise<void>}
   * @private
   */
  async _persistAggregatedMetrics(aggregatedMetrics) {
    try {
      // В реальной реализации здесь может быть сохранение в БД
      // Например, через модель TaskMetrics
      
      // Для примера просто логируем
      logger.debug('Would persist aggregated metrics to DB', {
        taskId: aggregatedMetrics.taskId,
        totalDuration: aggregatedMetrics.totalDuration,
        stepsExecuted: aggregatedMetrics.stepsExecuted.length
      });
    } catch (error) {
      logger.error(`Error persisting aggregated metrics: ${error.message}`, {
        taskId: aggregatedMetrics.taskId,
        error
      });
    }
  }
}

module.exports = MetricsCollector;
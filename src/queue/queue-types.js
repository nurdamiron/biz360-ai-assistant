// src/queue/queue-types.js
/**
 * Типы очередей в системе
 * Используются для создания и обращения к очередям
 */
module.exports = {
    // Основные типы задач
    TASK_DECOMPOSITION: 'task-decomposition',
    CODE_GENERATION: 'code-generation',
    CODE_REVIEW: 'code-review',
    BUG_FIXING: 'bug-fixing',
    CODE_REFACTORING: 'code-refactoring',
    TEST_GENERATION: 'test-generation',
    PR_CREATION: 'pr-creation',
    
    // Аналитика и мониторинг
    AI_PERFORMANCE_ANALYSIS: 'ai-performance-analysis',
    TASK_PROGRESS_ANALYSIS: 'task-progress-analysis',
    
    // Уведомления
    NOTIFICATION_SENDING: 'notification-sending',
    
    // Документация
    DOCUMENTATION_UPDATE: 'documentation-update',
    
    // Планирование
    DAY_PLANNING: 'day-planning',
    DAY_SUMMARY: 'day-summary'
  };
  
  // src/queue/redis-queue.js
  const { Queue, Worker } = require('bullmq');
  const Redis = require('ioredis');
  const logger = require('../utils/logger');
  const queueTypes = require('./queue-types');
  const config = require('../config/redis.config');
  
  // Создаем подключение к Redis
  const redisConnection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  
  /**
   * Класс для работы с очередями на Redis
   */
  class RedisQueueManager {
    constructor() {
      // Хранилище для всех активных очередей
      this.queues = new Map();
      this.workers = new Map();
      this.initialized = false;
    }
  
    /**
     * Инициализация всех очередей
     */
    async initialize() {
      if (this.initialized) return;
      
      // Создаем все необходимые очереди
      for (const queueType of Object.values(queueTypes)) {
        this.getQueue(queueType);
      }
      
      this.initialized = true;
      logger.info('Redis Queue Manager initialized successfully');
    }
  
    /**
     * Получение или создание очереди по типу
     * @param {string} queueType - Тип очереди из queue-types.js
     * @returns {Queue} - Объект очереди BullMQ
     */
    getQueue(queueType) {
      if (!this.queues.has(queueType)) {
        const queue = new Queue(queueType, {
          connection: redisConnection,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000
            },
            removeOnComplete: {
              age: 24 * 3600, // Хранить завершенные задачи 1 день
              count: 1000     // Хранить не более 1000 завершенных задач
            },
            removeOnFail: {
              age: 7 * 24 * 3600 // Хранить неудачные задачи 7 дней
            }
          }
        });
        
        this.queues.set(queueType, queue);
        logger.info(`Queue [${queueType}] initialized`);
      }
      
      return this.queues.get(queueType);
    }
  
    /**
     * Регистрация обработчика для очереди
     * @param {string} queueType - Тип очереди
     * @param {Function} processor - Функция-обработчик
     * @param {object} options - Дополнительные опции для Worker
     */
    registerProcessor(queueType, processor, options = {}) {
      if (this.workers.has(queueType)) {
        logger.warn(`Worker for queue [${queueType}] already exists. Closing existing worker.`);
        const existingWorker = this.workers.get(queueType);
        existingWorker.close();
      }
      
      const worker = new Worker(queueType, processor, {
        connection: redisConnection,
        concurrency: options.concurrency || 5,
        ...options
      });
      
      worker.on('completed', job => {
        logger.info(`Job [${job.id}] in queue [${queueType}] completed successfully`);
      });
      
      worker.on('failed', (job, err) => {
        logger.error(`Job [${job.id}] in queue [${queueType}] failed: ${err.message}`, {
          jobId: job.id,
          queueType,
          error: err.stack
        });
      });
      
      this.workers.set(queueType, worker);
      logger.info(`Worker for queue [${queueType}] registered`);
      
      return worker;
    }
  
    /**
     * Добавление задания в очередь
     * @param {string} queueType - Тип очереди
     * @param {object} data - Данные задания
     * @param {object} options - Дополнительные опции для задания
     * @returns {Promise<Job>} - Созданное задание
     */
    async addJob(queueType, data, options = {}) {
      const queue = this.getQueue(queueType);
      
      const job = await queue.add(
        options.name || 'default',
        {
          ...data,
          createdAt: new Date().toISOString()
        },
        {
          priority: options.priority,
          delay: options.delay,
          attempts: options.attempts,
          jobId: options.jobId,
          ...options
        }
      );
      
      logger.info(`Job [${job.id}] added to queue [${queueType}]`);
      return job;
    }
  
    /**
     * Получение состояния очереди
     * @param {string} queueType - Тип очереди
     * @returns {Promise<object>} - Статистика очереди
     */
    async getQueueStatus(queueType) {
      const queue = this.getQueue(queueType);
      
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
      ]);
      
      return {
        queueType,
        counts: {
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + completed + failed + delayed
        }
      };
    }
  
    /**
     * Получение статистики по всем очередям
     * @returns {Promise<object[]>} - Массив со статистикой по каждой очереди
     */
    async getAllQueuesStatus() {
      const statuses = [];
      for (const queueType of this.queues.keys()) {
        const status = await this.getQueueStatus(queueType);
        statuses.push(status);
      }
      return statuses;
    }
  
    /**
     * Закрытие всех очередей и воркеров
     */
    async close() {
      const closePromises = [];
      
      // Закрываем все воркеры
      for (const worker of this.workers.values()) {
        closePromises.push(worker.close());
      }
      
      // Закрываем все очереди
      for (const queue of this.queues.values()) {
        closePromises.push(queue.close());
      }
      
      await Promise.all(closePromises);
      await redisConnection.quit();
      
      this.queues.clear();
      this.workers.clear();
      this.initialized = false;
      
      logger.info('Redis Queue Manager closed');
    }
  }
  
  // Создаем синглтон менеджера очередей
  const queueManager = new RedisQueueManager();
  
  module.exports = queueManager;
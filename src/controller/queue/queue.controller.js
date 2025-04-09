// src/controller/queue/queue.controller.js
const queueManager = require('../../queue/redis-queue');
const logger = require('../../utils/logger');
const queueTypes = require('../../queue/queue-types');

/**
 * Контроллер для управления очередями
 */
class QueueController {
  /**
   * Получение статуса всех очередей
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getQueuesStatus(req, res) {
    try {
      const status = await queueManager.getAllQueuesStatus();
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error(`Error getting queues status: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get queues status',
        message: error.message
      });
    }
  }

  /**
   * Получение статуса конкретной очереди
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getQueueStatus(req, res) {
    try {
      const { queueType } = req.params;
      
      // Проверяем, что тип очереди валидный
      if (!Object.values(queueTypes).includes(queueType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid queue type',
          validTypes: Object.values(queueTypes)
        });
      }
      
      const status = await queueManager.getQueueStatus(queueType);
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      logger.error(`Error getting queue status: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get queue status',
        message: error.message
      });
    }
  }

  /**
   * Очистка конкретной очереди
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async clearQueue(req, res) {
    try {
      const { queueType } = req.params;
      
      // Проверяем, что тип очереди валидный
      if (!Object.values(queueTypes).includes(queueType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid queue type',
          validTypes: Object.values(queueTypes)
        });
      }
      
      const queue = queueManager.getQueue(queueType);
      await queue.obliterate();
      
      res.json({
        success: true,
        message: `Queue ${queueType} cleared successfully`
      });
    } catch (error) {
      logger.error(`Error clearing queue: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to clear queue',
        message: error.message
      });
    }
  }

  /**
   * Получение деталей конкретного задания
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getJobDetails(req, res) {
    try {
      const { queueType, jobId } = req.params;
      
      // Проверяем, что тип очереди валидный
      if (!Object.values(queueTypes).includes(queueType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid queue type',
          validTypes: Object.values(queueTypes)
        });
      }
      
      const queue = queueManager.getQueue(queueType);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }
      
      const [jobState, jobLogs] = await Promise.all([
        job.getState(),
        job.getChildrenValues()
      ]);
      
      res.json({
        success: true,
        data: {
          id: job.id,
          name: job.name,
          data: job.data,
          state: jobState,
          progress: job.progress,
          returnvalue: job.returnvalue,
          logs: jobLogs,
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          processedOn: job.processedOn,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason
        }
      });
    } catch (error) {
      logger.error(`Error getting job details: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to get job details',
        message: error.message
      });
    }
  }

  /**
   * Повторное выполнение задания
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async retryJob(req, res) {
    try {
      const { queueType, jobId } = req.params;
      
      // Проверяем, что тип очереди валидный
      if (!Object.values(queueTypes).includes(queueType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid queue type',
          validTypes: Object.values(queueTypes)
        });
      }
      
      const queue = queueManager.getQueue(queueType);
      const job = await queue.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'Job not found'
        });
      }
      
      await job.retry();
      
      res.json({
        success: true,
        message: `Job ${jobId} in queue ${queueType} retried successfully`
      });
    } catch (error) {
      logger.error(`Error retrying job: ${error.message}`, { error: error.stack });
      res.status(500).json({
        success: false,
        error: 'Failed to retry job',
        message: error.message
      });
    }
  }
}

module.exports = new QueueController();
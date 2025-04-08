// src/queue/redis-queue.js
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Redis-based implementation of task queue for improved scalability
 */
class RedisTaskQueue {
  /**
   * Create a new RedisTaskQueue instance
   * @param {Object} options - Queue options
   * @param {string} options.redisUrl - Redis connection URL
   * @param {string} options.prefix - Key prefix for Redis
   * @param {number} options.visibilityTimeout - Task lock timeout in seconds
   */
  constructor(options = {}) {
    this.options = {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      prefix: 'biz360:queue:',
      visibilityTimeout: 60, // 1 minute
      ...options
    };
    
    this.redis = new Redis(this.options.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    });
    
    this.processing = new Map();
    this.stopped = false;
  }
  
  /**
   * Initialize the queue
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await this.redis.ping();
      logger.info('Redis task queue initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Redis task queue:', error);
      throw error;
    }
  }
  
  /**
   * Add a task to the queue
   * @param {string} type - Task type
   * @param {Object} data - Task data
   * @param {Object} options - Task options
   * @param {number} options.priority - Priority (1-10, higher is more important)
   * @param {number} options.delay - Delay in seconds before the task becomes available
   * @param {string} options.idempotencyKey - Key for idempotent task execution
   * @returns {Promise<Object>} - Added task
   */
  async addTask(type, data, options = {}) {
    try {
      const taskId = uuidv4();
      const priority = options.priority || 5;
      const now = Date.now();
      
      // Check for idempotency
      if (options.idempotencyKey) {
        const existingId = await this.redis.get(
          `${this.options.prefix}idempotency:${options.idempotencyKey}`
        );
        
        if (existingId) {
          logger.info(`Skipping duplicate task with idempotency key: ${options.idempotencyKey}`);
          return this.getTaskById(existingId);
        }
      }
      
      const task = {
        id: taskId,
        type,
        data,
        priority,
        status: 'pending',
        created_at: now,
        updated_at: now,
        completed_at: null,
        attempts: 0,
        max_attempts: options.maxAttempts || 3,
        available_at: options.delay ? now + (options.delay * 1000) : now
      };
      
      // Store the task
      await this.redis.set(
        `${this.options.prefix}tasks:${taskId}`,
        JSON.stringify(task)
      );
      
      // Add to queue sorted by priority and availability time
      const score = now - (priority * 10000); // Higher priority = lower score
      await this.redis.zadd(
        `${this.options.prefix}pending`,
        options.delay ? score + (options.delay * 1000) : score,
        taskId
      );
      
      // Set idempotency key if provided
      if (options.idempotencyKey) {
        await this.redis.set(
          `${this.options.prefix}idempotency:${options.idempotencyKey}`,
          taskId,
          'EX',
          86400 // 24 hours
        );
      }
      
      logger.info(`Task type "${type}" added to queue with id=${taskId}`);
      return task;
    } catch (error) {
      logger.error(`Error adding task type "${type}" to queue:`, error);
      throw error;
    }
  }
  
  /**
   * Get a task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object|null>} - Task or null if not found
   */
  async getTaskById(taskId) {
    try {
      const taskJson = await this.redis.get(`${this.options.prefix}tasks:${taskId}`);
      if (!taskJson) return null;
      return JSON.parse(taskJson);
    } catch (error) {
      logger.error(`Error getting task ${taskId}:`, error);
      return null;
    }
  }
  
  /**
   * Get the next available task from the queue
   * @returns {Promise<Object|null>} - Next task or null if queue is empty
   */
  async getNextTask() {
    if (this.stopped) return null;
    
    try {
      // Get current time
      const now = Date.now();
      
      // Atomic operation to claim a task
      const result = await this.redis.eval(`
        -- Find the next available task based on score (priority + delay)
        local tasks = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
        if #tasks == 0 then
          return nil
        end
        
        local taskId = tasks[1]
        
        -- Remove from pending queue
        redis.call('ZREM', KEYS[1], taskId)
        
        -- Add to processing queue with expiration
        redis.call('ZADD', KEYS[2], ARGV[2], taskId)
        
        -- Get the task data
        local taskData = redis.call('GET', KEYS[3] .. taskId)
        
        return {taskId, taskData}
      `, 
      3, // Number of keys
      `${this.options.prefix}pending`, // KEYS[1]
      `${this.options.prefix}processing`, // KEYS[2]
      `${this.options.prefix}tasks:`, // KEYS[3]
      now, // ARGV[1] - current time for score comparison
      now + (this.options.visibilityTimeout * 1000) // ARGV[2] - processing expiration
      );
      
      if (!result) {
        return null; // No task available
      }
      
      const [taskId, taskJson] = result;
      const task = JSON.parse(taskJson);
      
      // Update task status and attempts
      task.status = 'processing';
      task.updated_at = now;
      task.attempts += 1;
      
      await this.redis.set(
        `${this.options.prefix}tasks:${taskId}`,
        JSON.stringify(task)
      );
      
      // Keep track of processing task
      this.processing.set(taskId, {
        timeoutId: setTimeout(() => {
          this._handleTaskTimeout(taskId);
        }, this.options.visibilityTimeout * 1000)
      });
      
      logger.info(`Got next task from queue: ${taskId} (${task.type})`);
      return task;
    } catch (error) {
      logger.error('Error getting next task from queue:', error);
      return null;
    }
  }
  
  /**
   * Mark a task as completed
   * @param {string} taskId - Task ID
   * @returns {Promise<boolean>} - Success status
   */
  async completeTask(taskId) {
    try {
      const taskJson = await this.redis.get(`${this.options.prefix}tasks:${taskId}`);
      if (!taskJson) {
        logger.warn(`Cannot complete task ${taskId} as it doesn't exist`);
        return false;
      }
      
      const task = JSON.parse(taskJson);
      task.status = 'completed';
      task.completed_at = Date.now();
      task.updated_at = Date.now();
      
      // Update task data
      await this.redis.set(
        `${this.options.prefix}tasks:${taskId}`,
        JSON.stringify(task)
      );
      
      // Remove from processing queue
      await this.redis.zrem(`${this.options.prefix}processing`, taskId);
      
      // Add to completed queue
      await this.redis.zadd(
        `${this.options.prefix}completed`,
        Date.now(),
        taskId
      );
      
      // Cleanup timeout
      this._cleanupProcessingTask(taskId);
      
      logger.info(`Task #${taskId} marked as completed`);
      return true;
    } catch (error) {
      logger.error(`Error completing task #${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * Mark a task as failed
   * @param {string} taskId - Task ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<boolean>} - Success status
   */
  async failTask(taskId, errorMessage) {
    try {
      const taskJson = await this.redis.get(`${this.options.prefix}tasks:${taskId}`);
      if (!taskJson) {
        logger.warn(`Cannot fail task ${taskId} as it doesn't exist`);
        return false;
      }
      
      const task = JSON.parse(taskJson);
      const now = Date.now();
      
      // Check if we should retry
      if (task.attempts < task.max_attempts) {
        // Calculate exponential backoff delay
        const backoffDelay = Math.pow(2, task.attempts) * 1000; // 2^attempts seconds
        
        task.status = 'pending';
        task.updated_at = now;
        task.last_error = errorMessage;
        task.available_at = now + backoffDelay;
        
        // Update task data
        await this.redis.set(
          `${this.options.prefix}tasks:${taskId}`,
          JSON.stringify(task)
        );
        
        // Remove from processing queue
        await this.redis.zrem(`${this.options.prefix}processing`, taskId);
        
        // Add back to pending queue with delay
        const score = now - (task.priority * 10000) + backoffDelay;
        await this.redis.zadd(
          `${this.options.prefix}pending`,
          score,
          taskId
        );
        
        logger.info(`Task #${taskId} failed but will be retried. Attempt ${task.attempts}/${task.max_attempts}`);
      } else {
        // Mark as permanently failed
        task.status = 'failed';
        task.updated_at = now;
        task.last_error = errorMessage;
        
        // Update task data
        await this.redis.set(
          `${this.options.prefix}tasks:${taskId}`,
          JSON.stringify(task)
        );
        
        // Remove from processing queue
        await this.redis.zrem(`${this.options.prefix}processing`, taskId);
        
        // Add to failed queue
        await this.redis.zadd(
          `${this.options.prefix}failed`,
          now,
          taskId
        );
        
        logger.warn(`Task #${taskId} permanently failed after ${task.attempts} attempts: ${errorMessage}`);
      }
      
      // Cleanup timeout
      this._cleanupProcessingTask(taskId);
      
      return true;
    } catch (error) {
      logger.error(`Error failing task #${taskId}:`, error);
      return false;
    }
  }
  
  /**
   * Clean up resources when a task is done processing
   * @param {string} taskId - Task ID
   * @private
   */
  _cleanupProcessingTask(taskId) {
    const processingInfo = this.processing.get(taskId);
    if (processingInfo) {
      if (processingInfo.timeoutId) {
        clearTimeout(processingInfo.timeoutId);
      }
      this.processing.delete(taskId);
    }
  }
  
  /**
   * Handle a task that has timed out during processing
   * @param {string} taskId - Task ID
   * @private
   */
  async _handleTaskTimeout(taskId) {
    try {
      logger.warn(`Task #${taskId} timed out during processing`);
      this.processing.delete(taskId);
      
      // Check if the task is still in the processing queue
      const score = await this.redis.zscore(`${this.options.prefix}processing`, taskId);
      if (!score) {
        // Task was already handled
        return;
      }
      
      // Fail the task with a timeout error
      await this.failTask(taskId, 'Task processing timed out');
    } catch (error) {
      logger.error(`Error handling timeout for task #${taskId}:`, error);
    }
  }
  
  /**
   * Get queue statistics
   * @returns {Promise<Object>} - Queue stats
   */
  async getQueueStats() {
    try {
      const now = Date.now();
      
      // Get counts for each queue
      const pendingCount = await this.redis.zcount(`${this.options.prefix}pending`, '-inf', '+inf');
      const processingCount = await this.redis.zcount(`${this.options.prefix}processing`, '-inf', '+inf');
      const completedCount = await this.redis.zcount(`${this.options.prefix}completed`, now - 86400000, '+inf'); // Last 24h
      const failedCount = await this.redis.zcount(`${this.options.prefix}failed`, now - 86400000, '+inf'); // Last 24h
      
      // Get type distribution
      const typeDistribution = {};
      
      // Sample tasks to determine type distribution
      const pendingSample = await this.redis.zrange(`${this.options.prefix}pending`, 0, 100);
      
      for (const taskId of pendingSample) {
        const taskJson = await this.redis.get(`${this.options.prefix}tasks:${taskId}`);
        if (taskJson) {
          const task = JSON.parse(taskJson);
          typeDistribution[task.type] = (typeDistribution[task.type] || 0) + 1;
        }
      }
      
      return {
        counts: {
          pending: pendingCount,
          processing: processingCount,
          completed: completedCount,
          failed: failedCount,
          total: pendingCount + processingCount
        },
        typeDistribution,
        timestamp: now
      };
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      throw error;
    }
  }
  
  /**
   * Stop the queue
   * @returns {Promise<void>}
   */
  async stop() {
    this.stopped = true;
    
    // Cancel all timeouts
    for (const [taskId, info] of this.processing.entries()) {
      if (info.timeoutId) {
        clearTimeout(info.timeoutId);
      }
    }
    
    this.processing.clear();
    
    // Close Redis connection
    await this.redis.quit();
    
    logger.info('Redis task queue stopped');
  }
  
  /**
   * Start the queue
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.stopped) return;
    
    this.stopped = false;
    
    // Reconnect to Redis if needed
    if (this.redis.status !== 'ready') {
      this.redis = new Redis(this.options.redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true
      });
    }
    
    logger.info('Redis task queue started');
  }
  
  /**
   * Recover tasks that were being processed when the server crashed
   * @returns {Promise<number>} - Number of recovered tasks
   */
  async recoverOrphanedTasks() {
    try {
      const now = Date.now();
      
      // Find tasks in the processing queue that are past their visibility timeout
      const orphanedTasks = await this.redis.zrangebyscore(
        `${this.options.prefix}processing`,
        '-inf',
        now
      );
      
      logger.info(`Found ${orphanedTasks.length} orphaned tasks to recover`);
      
      let recoveredCount = 0;
      
      for (const taskId of orphanedTasks) {
        const taskJson = await this.redis.get(`${this.options.prefix}tasks:${taskId}`);
        if (!taskJson) continue;
        
        const task = JSON.parse(taskJson);
        
        // Re-queue the task
        await this.failTask(taskId, 'Task recovered after server crash');
        recoveredCount++;
      }
      
      logger.info(`Recovered ${recoveredCount} orphaned tasks`);
      return recoveredCount;
    } catch (error) {
      logger.error('Error recovering orphaned tasks:', error);
      return 0;
    }
  }
}

module.exports = RedisTaskQueue;
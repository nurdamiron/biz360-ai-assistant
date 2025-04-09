/**
 * Configuration for Redis connection
 * Used by the queue system and other Redis-dependent services
 */
module.exports = {
    // Redis connection URL (format: redis[s]://[[username][:password]@][host][:port][/db-number])
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    
    // Optional additional configuration
    options: {
      // Maximum number of retries to connect to Redis
      maxRetriesPerRequest: null,
      
      // Enable ready check (verifies Redis is ready before operations)
      enableReadyCheck: false,
      
      // Connection timeout in milliseconds
      connectTimeout: 10000,
      
      // If true, client will resend failed commands (within the same connection) once
      autoResubscribe: true,
      
      // Reconnect on error if true
      autoResendUnfulfilledCommands: true,
      
      // Retry if disconnected
      retryStrategy: function(times) {
        // Exponential backoff with a cap at 30 seconds
        const delay = Math.min(Math.pow(2, times) * 1000, 30000);
        return delay;
      }
    },
    
    // BullMQ specific configurations
    bullmq: {
      // Default options for all queues
      defaultJobOptions: {
        // Default number of retry attempts
        attempts: 3,
        
        // Backoff strategy
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        
        // Removal policy for completed jobs
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 1 day
          count: 1000     // Keep at most 1000 completed jobs
        },
        
        // Removal policy for failed jobs
        removeOnFail: {
          age: 7 * 24 * 3600 // Keep failed jobs for 7 days
        }
      }
    }
  };
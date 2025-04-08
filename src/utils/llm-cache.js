/**
 * Улучшенный кэш для LLM запросов
 * Поддерживает как in-memory кэширование, так и Redis
 */

const crypto = require('crypto');
const logger = require('./logger');
const config = require('../config/llm.config');
const NodeCache = require('node-cache');
const redis = require('redis');
const util = require('util');

class LLMCache {
  /**
   * Создает экземпляр LLMCache
   */
  constructor() {
    // Загружаем настройки кэша
    this.cacheTTL = config.cache?.ttl || 3600; // Время жизни кэша в секундах (1 час)
    this.cacheType = config.cache?.type || 'memory'; // Тип кэша: 'memory' или 'redis'
    
    // Настройки Redis
    this.redisConfig = config.cache?.redis || {
      host: 'localhost',
      port: 6379,
      password: null,
      db: 0
    };
    
    // Метрики кэша
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      totalSize: 0, // Примерный размер кэша в байтах
      createdAt: new Date()
    };
    
    // Инициализируем кэш в зависимости от типа
    this._initializeCache();
    
    logger.info(`LLMCache инициализирован (тип: ${this.cacheType})`);
  }

  /**
   * Инициализирует кэш в зависимости от выбранного типа
   * @private
   */
  async _initializeCache() {
    if (this.cacheType === 'redis') {
      // Инициализация Redis клиента
      try {
        this.redisClient = redis.createClient({
          url: `redis://${this.redisConfig.host}:${this.redisConfig.port}`,
          password: this.redisConfig.password
        });
        
        this.redisClient.on('error', (error) => {
          logger.error('Ошибка Redis:', error);
          
          // Переключаемся на in-memory кэш в случае ошибки
          logger.warn('Переключение на in-memory кэш из-за ошибки Redis');
          this.cacheType = 'memory';
          this._initializeCache();
        });
        
        await this.redisClient.connect();
        
        // Выбираем базу данных
        if (this.redisConfig.db) {
          await this.redisClient.select(this.redisConfig.db);
        }
        
        // Проверка соединения
        const pingResult = await this.redisClient.ping();
        
        if (pingResult === 'PONG') {
          logger.info('Подключение к Redis установлено успешно');
          
          // Инициализируем промисы для Redis команд
          this.redisGet = this.redisClient.get.bind(this.redisClient);
          this.redisSet = this.redisClient.set.bind(this.redisClient);
          this.redisDel = this.redisClient.del.bind(this.redisClient);
          this.redisKeys = this.redisClient.keys.bind(this.redisClient);
          
          // Загружаем статистику из Redis
          const statsJson = await this.redisGet('llm_cache_stats');
          
          if (statsJson) {
            try {
              this.stats = JSON.parse(statsJson);
              logger.debug('Статистика кэша загружена из Redis');
            } catch (error) {
              logger.warn('Ошибка при загрузке статистики кэша из Redis:', error.message);
            }
          }
        } else {
          throw new Error('Ошибка подключения к Redis');
        }
      } catch (error) {
        logger.error('Ошибка при инициализации Redis:', error);
        
        // Переключаемся на in-memory кэш в случае ошибки
        logger.warn('Переключение на in-memory кэш из-за ошибки Redis');
        this.cacheType = 'memory';
        this._initializeCache();
      }
    } else {
      // Инициализация in-memory кэша
      this.memoryCache = new NodeCache({
        stdTTL: this.cacheTTL,
        checkperiod: 300, // Проверять устаревшие записи каждые 5 минут
        maxKeys: config.cache?.maxKeys || 10000,
        useClones: false
      });
      
      // Слушаем событие удаления из кэша
      this.memoryCache.on('del', (key, value) => {
        if (key === 'llm_cache_stats') return; // Игнорируем ключ статистики
        
        this.stats.evictions++;
        
        if (value) {
          // Примерная оценка размера значения
          const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
          this.stats.totalSize -= valueSize;
        }
      });
      
      logger.info('In-memory кэш инициализирован успешно');
    }
  }

  /**
   * Обновляет статистику кэша
   * @private
   */
  async _updateStats() {
    // Для in-memory кэша обновляем размер
    if (this.cacheType === 'memory') {
      const keys = this.memoryCache.keys();
      
      // Исключаем ключ статистики
      const dataKeys = keys.filter(key => key !== 'llm_cache_stats');
      
      // Рассчитываем размер кэша
      this.stats.totalSize = 0;
      
      for (const key of dataKeys) {
        const value = this.memoryCache.get(key);
        
        if (value) {
          // Примерная оценка размера значения
          const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
          this.stats.totalSize += valueSize;
        }
      }
    } else if (this.cacheType === 'redis' && this.redisClient.isReady) {
      // Для Redis сохраняем статистику
      try {
        await this.redisSet('llm_cache_stats', JSON.stringify(this.stats), {
          EX: 86400 // Сохраняем на 24 часа
        });
      } catch (error) {
        logger.warn('Ошибка при сохранении статистики кэша в Redis:', error.message);
      }
    }
  }

  /**
   * Получает ключ кэша на основе пути
   * @param {string} key - Ключ кэша
   * @returns {string} Хеш ключа
   * @private
   */
  _getCacheKey(key) {
    // Если ключ уже похож на хеш, возвращаем его
    if (/^[a-f0-9]{32}$/.test(key)) {
      return key;
    }
    
    // Иначе создаем хеш
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * Получает данные из кэша
   * @param {string} key - Ключ кэша
   * @returns {Promise<any>} Данные из кэша или null, если не найдены
   */
  async get(key) {
    const cacheKey = this._getCacheKey(key);
    
    try {
      let value = null;
      
      if (this.cacheType === 'redis' && this.redisClient?.isReady) {
        const data = await this.redisGet(cacheKey);
        
        if (data) {
          value = JSON.parse(data);
        }
      } else {
        value = this.memoryCache.get(cacheKey);
      }
      
      // Обновляем статистику
      if (value) {
        this.stats.hits++;
        logger.debug(`Попадание в кэш для ключа: ${cacheKey.substring(0, 8)}...`);
      } else {
        this.stats.misses++;
        logger.debug(`Промах кэша для ключа: ${cacheKey.substring(0, 8)}...`);
      }
      
      // Периодически обновляем статистику
      if ((this.stats.hits + this.stats.misses) % 100 === 0) {
        await this._updateStats();
      }
      
      return value;
    } catch (error) {
      logger.error(`Ошибка при получении данных из кэша (ключ: ${cacheKey}):`, error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Сохраняет данные в кэш
   * @param {string} key - Ключ кэша
   * @param {any} value - Данные для сохранения
   * @param {number} ttl - Время жизни в секундах (опционально)
   * @returns {Promise<boolean>} Успешно ли сохранение
   */
  async set(key, value, ttl = null) {
    const cacheKey = this._getCacheKey(key);
    const effectiveTTL = ttl || this.cacheTTL;
    
    try {
      if (this.cacheType === 'redis' && this.redisClient?.isReady) {
        const valueStr = JSON.stringify(value);
        await this.redisSet(cacheKey, valueStr, {
          EX: effectiveTTL
        });
      } else {
        this.memoryCache.set(cacheKey, value, effectiveTTL);
        
        // Оцениваем размер значения
        const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
        this.stats.totalSize += valueSize;
      }
      
      this.stats.sets++;
      logger.debug(`Данные сохранены в кэш (ключ: ${cacheKey.substring(0, 8)}...)`);
      
      // Периодически обновляем статистику
      if (this.stats.sets % 100 === 0) {
        await this._updateStats();
      }
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при сохранении данных в кэш (ключ: ${cacheKey}):`, error);
      return false;
    }
  }

  /**
   * Удаляет данные из кэша
   * @param {string} key - Ключ кэша
   * @returns {Promise<boolean>} Успешно ли удаление
   */
  async delete(key) {
    const cacheKey = this._getCacheKey(key);
    
    try {
      if (this.cacheType === 'redis' && this.redisClient?.isReady) {
        await this.redisDel(cacheKey);
      } else {
        // Получаем значение перед удалением для обновления статистики размера
        const value = this.memoryCache.get(cacheKey);
        
        if (value) {
          const valueSize = Buffer.byteLength(JSON.stringify(value), 'utf8');
          this.stats.totalSize -= valueSize;
        }
        
        this.memoryCache.del(cacheKey);
      }
      
      logger.debug(`Данные удалены из кэша (ключ: ${cacheKey.substring(0, 8)}...)`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при удалении данных из кэша (ключ: ${cacheKey}):`, error);
      return false;
    }
  }

  /**
   * Очищает весь кэш
   * @returns {Promise<boolean>} Успешно ли очистка
   */
  async clear() {
    try {
      if (this.cacheType === 'redis' && this.redisClient?.isReady) {
        // Получаем все ключи с префиксом LLM кэша
        const keys = await this.redisKeys('llm:*');
        
        if (keys.length > 0) {
          await this.redisDel(keys);
        }
      } else {
        this.memoryCache.flushAll();
      }
      
      // Сбрасываем статистику
      this.stats = {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        totalSize: 0,
        createdAt: new Date()
      };
      
      await this._updateStats();
      
      logger.info('Кэш LLM очищен');
      return true;
    } catch (error) {
      logger.error('Ошибка при очистке кэша LLM:', error);
      return false;
    }
  }

  /**
   * Получает статистику использования кэша
   * @returns {Object} Статистика кэша
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    return {
      type: this.cacheType,
      hitRate: hitRate.toFixed(2) + '%',
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      evictions: this.stats.evictions,
      totalItems: this.cacheType === 'memory' ? this.memoryCache.keys().length : 'N/A',
      sizeInMB: (this.stats.totalSize / (1024 * 1024)).toFixed(2) + ' MB',
      uptime: this._getUptimeString(this.stats.createdAt)
    };
  }

  /**
   * Форматирует время работы в человекочитаемый формат
   * @param {Date} startDate - Дата начала работы
   * @returns {string} Время работы в формате дд:чч:мм:сс
   * @private
   */
  _getUptimeString(startDate) {
    const uptime = new Date() - startDate;
    
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
    const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
    
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
}

// Создаем и экспортируем экземпляр
const llmCache = new LLMCache();
module.exports = llmCache;
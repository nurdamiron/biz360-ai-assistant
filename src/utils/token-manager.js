// src/utils/token-manager.js

/**
 * Менеджер токенов для отслеживания и оптимизации расхода токенов LLM
 * Позволяет устанавливать лимиты расхода и следить за статистикой
 */

const NodeCache = require('node-cache');
const logger = require('./logger');
const { pool } = require('../config/db.config');

class TokenManager {
  constructor() {
    // Инициализация кэша для хранения статистики
    this.cache = new NodeCache({ stdTTL: 86400 }); // 24 часа
    
    // Установка лимитов (можно загружать из конфига)
    this.limits = {
      daily: parseInt(process.env.LLM_DAILY_TOKEN_LIMIT || '1000000', 10),
      hourly: parseInt(process.env.LLM_HOURLY_TOKEN_LIMIT || '100000', 10),
      perRequest: parseInt(process.env.LLM_REQUEST_TOKEN_LIMIT || '8000', 10)
    };
    
    // Счетчики расхода
    this.resetCounters();
    
    // Загружаем исторические данные
    this.loadHistoricalData();
    
    // Запускаем периодическое сохранение статистики
    this.statsInterval = setInterval(() => this.saveStats(), 3600000); // каждый час
  }
  
  /**
   * Сброс счетчиков токенов
   */
  resetCounters() {
    this.usage = {
      daily: {
        date: new Date().toISOString().split('T')[0],
        promptTokens: 0,
        completionTokens: 0,
        total: 0
      },
      hourly: {
        hour: new Date().getHours(),
        promptTokens: 0,
        completionTokens: 0,
        total: 0
      },
      models: {} // статистика по моделям
    };
  }
  
  /**
   * Проверяет, не превышен ли лимит токенов
   * @param {number} estimatedTokens - Предполагаемое количество токенов для запроса
   * @returns {boolean} - true, если запрос можно выполнить
   */
  canProcessRequest(estimatedTokens) {
    // Проверяем дневной лимит
    if (this.usage.daily.total + estimatedTokens > this.limits.daily) {
      logger.warn(`Превышен дневной лимит токенов (${this.usage.daily.total}/${this.limits.daily})`);
      return false;
    }
    
    // Проверяем часовой лимит
    if (this.usage.hourly.total + estimatedTokens > this.limits.hourly) {
      logger.warn(`Превышен часовой лимит токенов (${this.usage.hourly.total}/${this.limits.hourly})`);
      return false;
    }
    
    // Проверяем лимит на запрос
    if (estimatedTokens > this.limits.perRequest) {
      logger.warn(`Запрос превышает лимит токенов на запрос (${estimatedTokens}/${this.limits.perRequest})`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Регистрирует использование токенов
   * @param {string} model - Название модели
   * @param {number} promptTokens - Количество токенов в запросе
   * @param {number} completionTokens - Количество токенов в ответе
   */
  trackUsage(model, promptTokens, completionTokens) {
    const totalTokens = promptTokens + completionTokens;
    
    // Проверяем, не сменился ли день
    const currentDate = new Date().toISOString().split('T')[0];
    if (currentDate !== this.usage.daily.date) {
      // Сохраняем статистику за предыдущий день
      this.saveStats();
      this.resetCounters();
    }
    
    // Проверяем, не сменился ли час
    const currentHour = new Date().getHours();
    if (currentHour !== this.usage.hourly.hour) {
      this.usage.hourly = {
        hour: currentHour,
        promptTokens: 0,
        completionTokens: 0,
        total: 0
      };
    }
    
    // Обновляем счетчики
    this.usage.daily.promptTokens += promptTokens;
    this.usage.daily.completionTokens += completionTokens;
    this.usage.daily.total += totalTokens;
    
    this.usage.hourly.promptTokens += promptTokens;
    this.usage.hourly.completionTokens += completionTokens;
    this.usage.hourly.total += totalTokens;
    
    // Обновляем статистику по модели
    if (!this.usage.models[model]) {
      this.usage.models[model] = {
        promptTokens: 0,
        completionTokens: 0,
        total: 0,
        requests: 0
      };
    }
    
    this.usage.models[model].promptTokens += promptTokens;
    this.usage.models[model].completionTokens += completionTokens;
    this.usage.models[model].total += totalTokens;
    this.usage.models[model].requests += 1;
    
    // Сохраняем текущие данные в кэш для быстрого доступа
    this.cache.set('current_usage', this.usage);
    
    // Логируем использование
    logger.debug(`Использовано токенов: ${totalTokens} (${promptTokens}+${completionTokens}) для модели ${model}`);
  }
  
  /**
   * Загружает исторические данные из БД
   * @returns {Promise<void>}
   */
  async loadHistoricalData() {
    try {
      const connection = await pool.getConnection();
      
      // Загружаем данные за текущий день
      const currentDate = new Date().toISOString().split('T')[0];
      const [rows] = await connection.query(
        'SELECT * FROM llm_token_usage WHERE date = ?',
        [currentDate]
      );
      
      connection.release();
      
      if (rows.length > 0) {
        const data = rows[0];
        this.usage.daily = {
          date: currentDate,
          promptTokens: data.prompt_tokens,
          completionTokens: data.completion_tokens,
          total: data.total_tokens
        };
        
        // Восстанавливаем статистику по моделям, если есть
        if (data.models_usage) {
          try {
            this.usage.models = JSON.parse(data.models_usage);
          } catch (e) {
            logger.error('Ошибка при парсинге статистики моделей:', e);
          }
        }
        
        logger.info(`Загружена статистика использования токенов за ${currentDate}`);
      }
    } catch (error) {
      logger.error('Ошибка при загрузке исторической статистики токенов:', error);
    }
  }
  
  /**
   * Сохраняет статистику использования токенов в БД
   * @returns {Promise<void>}
   */
  async saveStats() {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем, существует ли таблица
      const [tables] = await connection.query(
        'SHOW TABLES LIKE "llm_token_usage"'
      );
      
      // Создаем таблицу, если она не существует
      if (tables.length === 0) {
        await connection.query(`
          CREATE TABLE llm_token_usage (
            id INT PRIMARY KEY AUTO_INCREMENT,
            date DATE NOT NULL,
            prompt_tokens INT NOT NULL,
            completion_tokens INT NOT NULL,
            total_tokens INT NOT NULL,
            models_usage JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY (date)
          )
        `);
      }
      
      // Вставляем или обновляем статистику
      await connection.query(`
        INSERT INTO llm_token_usage 
        (date, prompt_tokens, completion_tokens, total_tokens, models_usage)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        prompt_tokens = VALUES(prompt_tokens),
        completion_tokens = VALUES(completion_tokens),
        total_tokens = VALUES(total_tokens),
        models_usage = VALUES(models_usage),
        updated_at = NOW()
      `, [
        this.usage.daily.date,
        this.usage.daily.promptTokens,
        this.usage.daily.completionTokens,
        this.usage.daily.total,
        JSON.stringify(this.usage.models)
      ]);
      
      connection.release();
      
      logger.info(`Статистика использования токенов за ${this.usage.daily.date} сохранена`);
    } catch (error) {
      logger.error('Ошибка при сохранении статистики токенов:', error);
    }
  }
  
  /**
   * Получает текущую статистику использования токенов
   * @returns {Object} - Статистика использования
   */
  getStats() {
    return {
      usage: this.usage,
      limits: this.limits,
      estimatedCost: this.calculateCost()
    };
  }
  
  /**
   * Рассчитывает примерную стоимость использованных токенов
   * @returns {Object} - Стоимость по разным тарифам
   */
  calculateCost() {
    // Примерные тарифы ($/1000 токенов) различных моделей
    const rates = {
      'claude-3-opus': {
        prompt: 0.015,
        completion: 0.075
      },
      'claude-3-sonnet': {
        prompt: 0.003,
        completion: 0.015
      },
      'claude-3-haiku': {
        prompt: 0.00025,
        completion: 0.00125
      },
      'default': {
        prompt: 0.01,
        completion: 0.03
      }
    };
    
    const costs = {};
    let totalCost = 0;
    
    // Рассчитываем стоимость по моделям
    for (const [model, usage] of Object.entries(this.usage.models)) {
      const rate = rates[model] || rates.default;
      
      const promptCost = (usage.promptTokens / 1000) * rate.prompt;
      const completionCost = (usage.completionTokens / 1000) * rate.completion;
      const cost = promptCost + completionCost;
      
      costs[model] = {
        promptCost: promptCost.toFixed(4),
        completionCost: completionCost.toFixed(4),
        totalCost: cost.toFixed(4)
      };
      
      totalCost += cost;
    }
    
    return {
      byModel: costs,
      total: totalCost.toFixed(4)
    };
  }
  
  /**
   * Оценивает размер предполагаемого запроса
   * @param {string} text - Текст для оценки
   * @returns {number} - Приблизительное количество токенов
   */
  estimateTokenCount(text) {
    if (!text) return 0;
    
    // Очень грубая оценка: 1 токен ~ 4 символа для латиницы, 
    // для кириллицы и других алфавитов ~ 2-3 символа на токен
    
    // Подсчитываем символы разного типа
    const latinChars = (text.match(/[a-zA-Z0-9]/g) || []).length;
    const totalChars = text.length;
    const nonLatinChars = totalChars - latinChars;
    
    // Используем разные коэффициенты для разных типов символов
    return Math.ceil(latinChars / 4 + nonLatinChars / 2.5);
  }
  
  /**
   * Предлагает способы оптимизации запроса для уменьшения токенов
   * @param {string} prompt - Промпт для оптимизации
   * @returns {Object} - Рекомендации по оптимизации
   */
  optimizePrompt(prompt) {
    const originalTokens = this.estimateTokenCount(prompt);
    let recommendations = [];
    
    // Проверяем длину промпта
    if (originalTokens > 1000) {
      recommendations.push('Промпт слишком длинный, рекомендуется сократить');
    }
    
    // Проверяем на повторы инструкций
    if (prompt.includes('Please') && prompt.split('Please').length > 3) {
      recommendations.push('Слишком много повторений слова "Please", сократите вежливые формы');
    }
    
    // Проверяем на избыточные примеры
    if (prompt.split('Example:').length > 3 || prompt.split('For example').length > 3) {
      recommendations.push('Слишком много примеров, сократите до 1-2 самых ключевых');
    }
    
    // Проверяем на многословность
    if (prompt.split(' ').length > 300) {
      recommendations.push('Промпт многословен, сократите и упростите формулировки');
    }
    
    return {
      originalTokenCount: originalTokens,
      recommendations: recommendations.length > 0 ? recommendations : ['Промпт оптимален']
    };
  }
  
  /**
   * Очистка ресурсов при завершении работы
   */
  shutdown() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    // Сохраняем статистику
    this.saveStats().catch(error => {
      logger.error('Ошибка при сохранении статистики при завершении работы:', error);
    });
  }
}

// Создаем и экспортируем экземпляр менеджера токенов
const tokenManager = new TokenManager();

// Обработка завершения процесса
process.on('exit', () => {
  tokenManager.shutdown();
});

module.exports = tokenManager;
/**
 * Модуль для управления токенами LLM
 * Отслеживает использование, выполняет подсчет и оптимизацию токенов
 */

const logger = require('./logger');
const config = require('../config/llm.config');
const { pool } = require('../config/db.config');

class TokenManager {
  /**
   * Создает экземпляр TokenManager
   */
  constructor() {
    // Загружаем конфигурацию лимитов токенов
    this.dailyLimit = config.tokenLimits?.daily || 1000000;
    this.monthlyLimit = config.tokenLimits?.monthly || 10000000;
    
    // Загружаем конфигурацию стоимости токенов
    this.tokenCost = config.tokenCosts || {
      'claude-3-opus-20240229': { prompt: 15, completion: 75 }, // $ за миллион токенов
      'claude-3-sonnet-20240229': { prompt: 3, completion: 15 },
      'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },
      'claude-2.1': { prompt: 8, completion: 24 },
      'claude-2.0': { prompt: 8, completion: 24 },
      'claude-instant-1.2': { prompt: 1.63, completion: 5.51 },
      'gpt-4-turbo': { prompt: 10, completion: 30 },
      'gpt-4': { prompt: 30, completion: 60 },
      'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
      'default': { prompt: 5, completion: 15 }
    };
    
    // Инициализация счетчиков
    this.stats = {
      daily: {
        date: this._getCurrentDate(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      },
      monthly: {
        month: this._getCurrentMonth(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      },
      models: {},
      estimatedCost: 0
    };
    
    // Загружаем статистику из базы данных
    this._loadStats();
    
    logger.info('TokenManager инициализирован');
  }

  /**
   * Загружает статистику использования токенов из базы данных
   * @private
   */
  async _loadStats() {
    try {
      const connection = await pool.getConnection();
      
      // Загружаем дневную статистику
      const [dailyRows] = await connection.query(
        'SELECT * FROM token_usage WHERE date = ? LIMIT 1',
        [this._getCurrentDate()]
      );
      
      if (dailyRows.length > 0) {
        this.stats.daily = {
          date: dailyRows[0].date,
          promptTokens: dailyRows[0].prompt_tokens,
          completionTokens: dailyRows[0].completion_tokens,
          totalTokens: dailyRows[0].total_tokens
        };
      }
      
      // Загружаем месячную статистику
      const [monthlyRows] = await connection.query(
        'SELECT SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens, ' +
        'SUM(total_tokens) as total_tokens FROM token_usage WHERE DATE_FORMAT(date, "%Y-%m") = ?',
        [this._getCurrentMonth()]
      );
      
      if (monthlyRows.length > 0 && monthlyRows[0].total_tokens) {
        this.stats.monthly = {
          month: this._getCurrentMonth(),
          promptTokens: monthlyRows[0].prompt_tokens,
          completionTokens: monthlyRows[0].completion_tokens,
          totalTokens: monthlyRows[0].total_tokens
        };
      }
      
      // Загружаем статистику по моделям
      const [modelRows] = await connection.query(
        'SELECT model, SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens, ' +
        'SUM(total_tokens) as total_tokens FROM token_usage_models ' +
        'WHERE DATE_FORMAT(date, "%Y-%m") = ? GROUP BY model',
        [this._getCurrentMonth()]
      );
      
      modelRows.forEach(row => {
        this.stats.models[row.model] = {
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens,
          totalTokens: row.total_tokens
        };
      });
      
      // Рассчитываем примерную стоимость
      this._calculateEstimatedCost();
      
      connection.release();
      logger.debug('Статистика токенов загружена из БД');
    } catch (error) {
      logger.error('Ошибка при загрузке статистики токенов:', error);
    }
  }

  /**
   * Сохраняет текущую статистику в базу данных
   * @private
   */
  async _saveStats() {
    try {
      const connection = await pool.getConnection();
      
      // Сохраняем дневную статистику
      await connection.query(
        'INSERT INTO token_usage (date, prompt_tokens, completion_tokens, total_tokens) ' +
        'VALUES (?, ?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE prompt_tokens = ?, completion_tokens = ?, total_tokens = ?',
        [
          this.stats.daily.date,
          this.stats.daily.promptTokens,
          this.stats.daily.completionTokens,
          this.stats.daily.totalTokens,
          this.stats.daily.promptTokens,
          this.stats.daily.completionTokens,
          this.stats.daily.totalTokens
        ]
      );
      
      // Сохраняем статистику по моделям
      for (const [model, stats] of Object.entries(this.stats.models)) {
        await connection.query(
          'INSERT INTO token_usage_models (date, model, prompt_tokens, completion_tokens, total_tokens) ' +
          'VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE prompt_tokens = ?, completion_tokens = ?, total_tokens = ?',
          [
            this.stats.daily.date,
            model,
            stats.promptTokens,
            stats.completionTokens,
            stats.totalTokens,
            stats.promptTokens,
            stats.completionTokens,
            stats.totalTokens
          ]
        );
      }
      
      connection.release();
      logger.debug('Статистика токенов сохранена в БД');
    } catch (error) {
      logger.error('Ошибка при сохранении статистики токенов:', error);
    }
  }

  /**
   * Получает текущую дату в формате YYYY-MM-DD
   * @returns {string} Текущая дата
   * @private
   */
  _getCurrentDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * Получает текущий месяц в формате YYYY-MM
   * @returns {string} Текущий месяц
   * @private
   */
  _getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Рассчитывает примерную стоимость использованных токенов
   * @private
   */
  _calculateEstimatedCost() {
    let totalCost = 0;
    
    for (const [model, stats] of Object.entries(this.stats.models)) {
      let modelCost = this.tokenCost.default;
      
      // Находим наиболее подходящую модель для расчета стоимости
      for (const [costModel, cost] of Object.entries(this.tokenCost)) {
        if (model.includes(costModel)) {
          modelCost = cost;
          break;
        }
      }
      
      // Рассчитываем стоимость ($ за миллион токенов)
      const promptCost = (stats.promptTokens / 1000000) * modelCost.prompt;
      const completionCost = (stats.completionTokens / 1000000) * modelCost.completion;
      
      totalCost += promptCost + completionCost;
    }
    
    this.stats.estimatedCost = totalCost;
  }

  /**
   * Отслеживает использование токенов
   * @param {string} model - Модель LLM
   * @param {number} promptTokens - Количество токенов промпта
   * @param {number} completionTokens - Количество токенов ответа
   */
  async trackUsage(model, promptTokens, completionTokens) {
    // Проверяем, не изменился ли день/месяц
    const currentDate = this._getCurrentDate();
    const currentMonth = this._getCurrentMonth();
    
    // Если день изменился, сбрасываем дневную статистику
    if (currentDate !== this.stats.daily.date) {
      this.stats.daily = {
        date: currentDate,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
    }
    
    // Если месяц изменился, сбрасываем месячную статистику
    if (currentMonth !== this.stats.monthly.month) {
      this.stats.monthly = {
        month: currentMonth,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
      
      // Сбрасываем статистику по моделям
      this.stats.models = {};
    }
    
    // Обновляем дневную статистику
    this.stats.daily.promptTokens += promptTokens;
    this.stats.daily.completionTokens += completionTokens;
    this.stats.daily.totalTokens += promptTokens + completionTokens;
    
    // Обновляем месячную статистику
    this.stats.monthly.promptTokens += promptTokens;
    this.stats.monthly.completionTokens += completionTokens;
    this.stats.monthly.totalTokens += promptTokens + completionTokens;
    
    // Обновляем статистику по моделям
    if (!this.stats.models[model]) {
      this.stats.models[model] = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
    }
    
    this.stats.models[model].promptTokens += promptTokens;
    this.stats.models[model].completionTokens += completionTokens;
    this.stats.models[model].totalTokens += promptTokens + completionTokens;
    
    // Пересчитываем стоимость
    this._calculateEstimatedCost();
    
    // Если токенов достаточно много, сохраняем в БД
    if (promptTokens + completionTokens > 1000) {
      await this._saveStats();
    }
    
    logger.debug(`Использовано ${promptTokens + completionTokens} токенов (${model})`);
  }

  /**
   * Оценивает количество токенов в тексте
   * @param {string} text - Текст для оценки
   * @returns {number} Примерное количество токенов
   */
  estimateTokenCount(text) {
    if (!text) return 0;
    
    const encoding = this._detectEncoding(text);
    
    switch (encoding) {
      case 'utf8':
        // Примерно 4 символа на токен для обычного текста
        return Math.ceil(text.length / 4);
      
      case 'code':
        // Код более эффективен в токенизации
        return Math.ceil(text.length / 5);
      
      case 'whitespace':
        // Пробелы очень эффективны
        return Math.ceil(text.length / 10);
      
      default:
        return Math.ceil(text.length / 4);
    }
  }

  /**
   * Определяет тип кодировки/содержимого текста
   * @param {string} text - Текст для анализа
   * @returns {string} Тип кодировки
   * @private
   */
  _detectEncoding(text) {
    // Если текст содержит много кодовых символов, вероятно это код
    const codePatterns = /[{}[\]()<>:;=!+\-*/%]|function|class|const|let|var|if|else|for|while|return/g;
    const codeMatches = (text.match(codePatterns) || []).length;
    
    if (codeMatches > text.length / 20) { // Более 5% кодовых символов
      return 'code';
    }
    
    // Если текст содержит много пробелов, отступов
    const whitespacePatterns = /\s+/g;
    const whitespaceMatches = (text.match(whitespacePatterns) || []).join('').length;
    
    if (whitespaceMatches > text.length / 2) { // Более 50% пробелов
      return 'whitespace';
    }
    
    // По умолчанию считаем utf8
    return 'utf8';
  }

  /**
   * Проверяет, можно ли обработать запрос с указанным количеством токенов
   * @param {number} estimatedTokens - Примерное количество токенов
   * @returns {boolean} Можно ли обработать запрос
   */
  canProcessRequest(estimatedTokens) {
    // Проверяем дневной лимит
    if (this.stats.daily.totalTokens + estimatedTokens > this.dailyLimit) {
      logger.warn(`Превышен дневной лимит токенов (${this.stats.daily.totalTokens}/${this.dailyLimit})`);
      return false;
    }
    
    // Проверяем месячный лимит
    if (this.stats.monthly.totalTokens + estimatedTokens > this.monthlyLimit) {
      logger.warn(`Превышен месячный лимит токенов (${this.stats.monthly.totalTokens}/${this.monthlyLimit})`);
      return false;
    }
    
    return true;
  }

  /**
   * Предлагает оптимизации для промпта для снижения использования токенов
   * @param {string} prompt - Промпт для оптимизации
   * @returns {Object} Рекомендации по оптимизации
   */
  optimizePrompt(prompt) {
    const recommendations = [];
    const estimatedTokens = this.estimateTokenCount(prompt);
    
    // Если промпт короткий, оптимизация не требуется
    if (estimatedTokens < 1000) {
      return {
        originalTokens: estimatedTokens,
        recommendations: ['Промпт оптимален']
      };
    }
    
    // Ищем повторяющиеся части
    const lines = prompt.split('\n');
    const uniqueLines = new Set(lines);
    
    if (uniqueLines.size < lines.length * 0.8) {
      recommendations.push('Обнаружены повторяющиеся строки. Рекомендуется устранить дубликаты.');
    }
    
    // Ищем длинные блоки кода или большие JSON объекты
    const codeBlocks = prompt.match(/```[\s\S]*?```/g) || [];
    const jsonObjects = prompt.match(/{[\s\S]*?}/g) || [];
    
    if (codeBlocks.length > 0) {
      const totalCodeSize = codeBlocks.reduce((sum, block) => sum + block.length, 0);
      
      if (totalCodeSize > prompt.length * 0.3) {
        recommendations.push('Большие блоки кода занимают значительную часть промпта. Рекомендуется сократить или упростить код.');
      }
    }
    
    if (jsonObjects.length > 0) {
      const largeJsonObjects = jsonObjects.filter(obj => obj.length > 500);
      
      if (largeJsonObjects.length > 0) {
        recommendations.push('Обнаружены большие JSON объекты. Рекомендуется удалить ненужные поля или сократить структуру.');
      }
    }
    
    // Ищем длинные списки
    const listItems = prompt.match(/^[*-] .+$/gm) || [];
    
    if (listItems.length > 15) {
      recommendations.push('Обнаружен длинный список. Рекомендуется сократить количество элементов или выбрать только ключевые.');
    }
    
    // Ищем лишние пробелы и форматирование
    const whitespace = prompt.match(/\n\s*\n\s*\n/g) || [];
    
    if (whitespace.length > 10) {
      recommendations.push('Обнаружено избыточное форматирование с лишними пустыми строками. Рекомендуется удалить лишние разрывы строк.');
    }
    
    return {
      originalTokens: estimatedTokens,
      recommendations: recommendations.length > 0 ? recommendations : ['Промпт оптимален']
    };
  }

  /**
   * Получает текущую статистику использования токенов
   * @returns {Object} Статистика использования
   */
  getStats() {
    return {
      daily: {
        date: this.stats.daily.date,
        used: this.stats.daily.totalTokens,
        limit: this.dailyLimit,
        percentage: ((this.stats.daily.totalTokens / this.dailyLimit) * 100).toFixed(2) + '%'
      },
      monthly: {
        month: this.stats.monthly.month,
        used: this.stats.monthly.totalTokens,
        limit: this.monthlyLimit,
        percentage: ((this.stats.monthly.totalTokens / this.monthlyLimit) * 100).toFixed(2) + '%'
      },
      models: Object.entries(this.stats.models).map(([model, stats]) => ({
        model,
        promptTokens: stats.promptTokens,
        completionTokens: stats.completionTokens,
        totalTokens: stats.totalTokens
      })),
      estimatedCost: `$${this.stats.estimatedCost.toFixed(2)}`
    };
  }

  /**
   * Сбрасывает статистику использования токенов
   * @param {string} period - Период для сброса ('daily', 'monthly', 'all')
   */
  async resetStats(period = 'all') {
    if (period === 'daily' || period === 'all') {
      this.stats.daily = {
        date: this._getCurrentDate(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
    }
    
    if (period === 'monthly' || period === 'all') {
      this.stats.monthly = {
        month: this._getCurrentMonth(),
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
      
      this.stats.models = {};
      this.stats.estimatedCost = 0;
    }
    
    await this._saveStats();
    logger.info(`Статистика токенов сброшена (период: ${period})`);
  }
}

// Создаем и экспортируем экземпляр
const tokenManager = new TokenManager();
module.exports = tokenManager;
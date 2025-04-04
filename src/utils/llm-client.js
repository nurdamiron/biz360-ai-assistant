// src/utils/llm-client.js

const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const config = require('../config/llm.config');
const logger = require('./logger');
const tokenManager = require('./token-manager');

/**
 * Улучшенный клиент для взаимодействия с LLM API
 * Интегрирован с системой учета токенов и имеет дополнительные оптимизации
 */
class LLMClient {
  constructor() {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiUrl = config.apiUrl;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    
    // Настройки повторных попыток при ошибках
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000; // 1 секунда
    
    // Инициализация кэша
    this.cache = new NodeCache({ 
      stdTTL: config.cacheTTL || 1800, 
      checkperiod: 300 
    });
    
    // Активирован ли кэш
    this.cacheEnabled = config.cacheEnabled !== false;
    
    // Счетчик успешных и неудачных запросов
    this.requestStats = {
      sent: 0,
      successful: 0,
      failed: 0,
      cached: 0
    };
    
    // Метрики времени отклика API
    this.responseTimeStats = {
      totalTime: 0,
      requestCount: 0,
      minTime: Number.MAX_SAFE_INTEGER,
      maxTime: 0
    };
    
    logger.info(`LLMClient инициализирован с моделью ${this.model}`);
  }

  /**
   * Создает хэш для кэширования запросов
   * @param {string} prompt - Промпт для LLM
   * @param {Object} options - Опции запроса
   * @returns {string} - Хэш для кэширования
   */
  createCacheKey(prompt, options) {
    const dataToHash = JSON.stringify({
      prompt,
      model: options.model || this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature || this.temperature
    });
    
    return crypto.createHash('md5').update(dataToHash).digest('hex');
  }

  /**
   * Обрабатывает ограничения контекста, усекая промпт если необходимо
   * @param {string} prompt - Исходный промпт
   * @param {number} [maxContextTokens=16000] - Максимальный размер контекста
   * @returns {string} - Обработанный промпт
   */
  processContextLimitations(prompt, maxContextTokens = 16000) {
    // Оцениваем размер промпта в токенах
    const estimatedTokens = tokenManager.estimateTokenCount(prompt);
    
    if (estimatedTokens <= maxContextTokens) {
      return prompt; // Промпт в пределах лимита
    }
    
    logger.warn(`Промпт превышает лимит в ${maxContextTokens} токенов (примерно ${estimatedTokens}). Выполняется сокращение.`);
    
    // Разбиваем текст на смысловые блоки
    const sections = this.extractSections(prompt);
    
    // Присваиваем приоритеты разным типам секций
    const prioritizedSections = this.prioritizeSections(sections);
    
    // Собираем промпт в порядке приоритета, пока не достигнем лимита
    let truncatedPrompt = '';
    let currentTokenCount = 0;
    
    for (const section of prioritizedSections) {
      const sectionTokens = tokenManager.estimateTokenCount(section.content);
      
      if (currentTokenCount + sectionTokens > maxContextTokens) {
        if (section.priority >= 8) { // Высокий приоритет - важные инструкции
          // Пытаемся включить хотя бы часть важной секции
          const availableTokens = maxContextTokens - currentTokenCount;
          const ratio = availableTokens / sectionTokens;
          const truncatedSection = this.truncateSection(section.content, ratio);
          
          truncatedPrompt += truncatedSection;
          break;
        } else {
          // Менее важные секции просто пропускаем
          continue;
        }
      }
      
      truncatedPrompt += section.content;
      currentTokenCount += sectionTokens;
    }
    
    // Добавляем примечание о сокращении
    const note = '\n\n[Примечание: некоторые части контекста были сокращены из-за ограничений размера.]\n\n';
    truncatedPrompt = note + truncatedPrompt;
    
    logger.info(`Промпт сокращен с ~${estimatedTokens} до ~${tokenManager.estimateTokenCount(truncatedPrompt)} токенов`);
    
    return truncatedPrompt;
  }

  /**
   * Извлекает смысловые секции из промпта
   * @param {string} prompt - Промпт для разбора
   * @returns {Array<string>} - Массив секций
   */
  extractSections(prompt) {
    // Разбиваем по заголовкам, блокам кода и пустым строкам
    const sectionRegexes = [
      /^#+\s+.+$/gm, // Заголовки Markdown
      /^```[\s\S]*?```$/gm, // Блоки кода
      /\n\s*\n/g // Пустые строки для разделения абзацев
    ];
    
    let sections = [];
    let lastIndex = 0;
    
    // Используем регулярные выражения для выделения секций
    for (const regex of sectionRegexes) {
      const matches = prompt.matchAll(regex);
      
      for (const match of matches) {
        const startIndex = match.index;
        
        if (startIndex > lastIndex) {
          // Добавляем текст до совпадения
          sections.push(prompt.substring(lastIndex, startIndex));
        }
        
        // Добавляем совпадение
        sections.push(match[0]);
        lastIndex = startIndex + match[0].length;
      }
    }
    
    // Добавляем оставшуюся часть промпта
    if (lastIndex < prompt.length) {
      sections.push(prompt.substring(lastIndex));
    }
    
    // Фильтруем пустые секции
    return sections.filter(section => section.trim().length > 0);
  }

  /**
   * Присваивает приоритеты секциям промпта
   * @param {Array<string>} sections - Секции промпта
   * @returns {Array<Object>} - Секции с приоритетами
   */
  prioritizeSections(sections) {
    return sections.map(content => {
      let priority = 5; // Средний приоритет по умолчанию
      
      // Инструкции и задание имеют наивысший приоритет
      if (/^#+\s+(Задание|Инструкции|Task|Instructions)/i.test(content)) {
        priority = 10;
      } 
      // Пользовательский запрос
      else if (/^#+\s+(Запрос|Query|Question)/i.test(content)) {
        priority = 9;
      }
      // Код и примеры кода важны
      else if (/^```/.test(content)) {
        priority = 8;
      }
      // Релевантные файлы и важные секции
      else if (/^#+\s+(Релевантные файлы|Relevant files|Контекст|Context)/i.test(content)) {
        priority = 7;
      }
      // Общие инструкции
      else if (/^#+\s+/.test(content)) {
        priority = 6;
      }
      // Прочий текст
      else {
        priority = 4;
      }
      
      return { content, priority };
    }).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Усекает секцию до указанной доли от исходного размера
   * @param {string} section - Исходная секция
   * @param {number} ratio - Доля для сохранения (0-1)
   * @returns {string} - Усеченная секция
   */
  truncateSection(section, ratio) {
    if (ratio >= 1) return section;
    if (ratio <= 0) return '';
    
    const lines = section.split('\n');
    const keepLines = Math.max(1, Math.floor(lines.length * ratio));
    
    // Для коротких секций сохраняем начало и конец
    if (lines.length <= 10) {
      return lines.slice(0, keepLines).join('\n');
    }
    
    // Для длинных секций сохраняем начало и конец
    const headLines = Math.floor(keepLines * 0.7);
    const tailLines = keepLines - headLines;
    
    return [
      ...lines.slice(0, headLines),
      '\n[...сокращено...]\n',
      ...lines.slice(lines.length - tailLines)
    ].join('\n');
  }

  /**
   * Отправка запроса к LLM API с улучшенными возможностями
   * @param {string} prompt - Промпт для LLM
   * @param {Object} options - Опции запроса
   * @returns {Promise<string>} - Ответ от LLM
   */
  async sendPrompt(prompt, options = {}) {
    this.requestStats.sent++;
    
    try {
      // Применяем оптимизации промпта
      const optimizationSuggestions = tokenManager.optimizePrompt(prompt);
      
      if (optimizationSuggestions.recommendations.length > 0 && 
          optimizationSuggestions.recommendations[0] !== 'Промпт оптимален') {
        logger.debug('Рекомендации по оптимизации промпта:', optimizationSuggestions.recommendations);
      }
      
      // Проверяем кэш если он включен
      if (this.cacheEnabled) {
        const cacheKey = this.createCacheKey(prompt, options);
        const cachedResponse = this.cache.get(cacheKey);
        
        if (cachedResponse) {
          logger.debug('Использован кэшированный ответ LLM');
          this.requestStats.cached++;
          return cachedResponse;
        }
      }
      
      // Оцениваем количество токенов в запросе
      const estimatedPromptTokens = tokenManager.estimateTokenCount(prompt);
      const estimatedCompletionTokens = (options.maxTokens || this.maxTokens);
      const estimatedTotalTokens = estimatedPromptTokens + estimatedCompletionTokens;
      
      // Проверяем, не превышен ли лимит токенов
      if (!tokenManager.canProcessRequest(estimatedTotalTokens)) {
        throw new Error('Превышен лимит токенов. Запрос отклонен.');
      }
      
      // Обрабатываем ограничения контекста
      const maxContextTokens = config.maxContextTokens || 16000;
      const processedPrompt = this.processContextLimitations(prompt, maxContextTokens);
      
      const requestOptions = {
        model: options.model || this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature || this.temperature,
        messages: [
          { role: "user", content: processedPrompt }
        ]
      };

      logger.debug(`Отправка запроса к LLM API: ${JSON.stringify({
        model: requestOptions.model,
        max_tokens: requestOptions.max_tokens,
        temperature: requestOptions.temperature,
        prompt_length: processedPrompt.length,
        estimated_tokens: estimatedPromptTokens
      })}`);

      // Реализуем механизм повторных попыток
      let retries = 0;
      let lastError = null;
      
      while (retries <= this.maxRetries) {
        try {
          const startTime = Date.now();
          
          const response = await axios.post(
            `${this.apiUrl}/v1/messages`,  // Обновленный эндпоинт для Claude API
            requestOptions,
            {
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'  // Актуальная версия на момент написания
              }
            }
          );
          
          const endTime = Date.now();
          const responseTime = endTime - startTime;
          
          // Обновляем статистику времени отклика
          this.updateResponseTimeStats(responseTime);
          
          // Обновляем счетчик использования токенов
          if (response.data.usage) {
            const promptTokens = response.data.usage.prompt_tokens || estimatedPromptTokens;
            const completionTokens = response.data.usage.completion_tokens || 
                                     (response.data.content[0].text.length / 4); // грубая оценка
            
            tokenManager.trackUsage(
              requestOptions.model,
              promptTokens,
              completionTokens
            );
          } else {
            // Если API не вернуло статистику токенов, используем оценку
            tokenManager.trackUsage(
              requestOptions.model,
              estimatedPromptTokens,
              response.data.content[0].text.length / 4 // грубая оценка
            );
          }

          logger.debug(`Получен ответ от LLM API за ${responseTime}ms`);
          this.requestStats.successful++;
          
          // Извлекаем содержимое ответа
          const content = response.data.content[0].text;
          
          // Сохраняем ответ в кэш если он включен
          if (this.cacheEnabled) {
            const cacheKey = this.createCacheKey(prompt, options);
            this.cache.set(cacheKey, content);
          }
          
          return content;
        } catch (error) {
          lastError = error;
          
          // Если ошибка связана с превышением лимита токенов
          if (error.response && error.response.status === 400 && 
              (error.response.data.error.type === 'context_length_exceeded' || 
               error.response.data.error.type === 'rate_limit_exceeded')) {
            
            logger.warn(`Ошибка LLM API: ${error.response.data.error.type}`);
            
            // Для ошибки превышения контекста - усекаем еще сильнее
            if (error.response.data.error.type === 'context_length_exceeded') {
              const reducedMaxTokens = maxContextTokens * 0.8;
              prompt = this.processContextLimitations(prompt, reducedMaxTokens);
              continue;
            }
            
            // Для превышения рейт-лимита - увеличиваем задержку
            if (error.response.data.error.type === 'rate_limit_exceeded') {
              const delay = this.retryDelay * Math.pow(2, retries);
              logger.info(`Ожидание ${delay}ms из-за rate limit...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              retries++;
              continue;
            }
          }
          
          // Временные ошибки сети или сервера
          if (!error.response || error.response.status >= 500 || error.code === 'ECONNRESET') {
            logger.warn(`Временная ошибка LLM API (попытка ${retries+1}/${this.maxRetries+1}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retries)));
            retries++;
            continue;
          }
          
          // Другие ошибки - выбрасываем исключение
          throw error;
        }
      }
      
      // Если все попытки исчерпаны
      this.requestStats.failed++;
      throw lastError || new Error('Превышено количество попыток запроса к LLM API');
    } catch (error) {
      this.requestStats.failed++;
      logger.error('Ошибка при отправке запроса к LLM API:', error);
      throw new Error(`Ошибка LLM API: ${error.message}`);
    }
  }

  /**
   * Обновляет статистику времени отклика
   * @param {number} responseTime - Время отклика в миллисекундах
   */
  updateResponseTimeStats(responseTime) {
    this.responseTimeStats.totalTime += responseTime;
    this.responseTimeStats.requestCount++;
    
    if (responseTime < this.responseTimeStats.minTime) {
      this.responseTimeStats.minTime = responseTime;
    }
    
    if (responseTime > this.responseTimeStats.maxTime) {
      this.responseTimeStats.maxTime = responseTime;
    }
  }

  /**
   * Получает статистику производительности и использования
   * @returns {Object} - Статистика производительности
   */
  getPerformanceStats() {
    const avgResponseTime = this.responseTimeStats.requestCount > 0 ? 
      this.responseTimeStats.totalTime / this.responseTimeStats.requestCount : 0;
    
    return {
      requests: {
        ...this.requestStats,
        successRate: this.requestStats.sent > 0 ? 
          (this.requestStats.successful / this.requestStats.sent * 100).toFixed(2) + '%' : '0%',
        cacheHitRate: this.requestStats.sent > 0 ? 
          (this.requestStats.cached / this.requestStats.sent * 100).toFixed(2) + '%' : '0%'
      },
      responseTimes: {
        average: avgResponseTime.toFixed(2) + 'ms',
        min: this.responseTimeStats.minTime === Number.MAX_SAFE_INTEGER ? 
          'N/A' : this.responseTimeStats.minTime + 'ms',
        max: this.responseTimeStats.maxTime + 'ms'
      },
      tokens: tokenManager.getStats()
    };
  }

  /**
   * Создание векторного представления (эмбеддинга) текста
   * @param {string} text - Текст для векторизации
   * @returns {Promise<Array>} - Векторное представление
   */
  async createEmbedding(text) {
    try {
      // Проверяем кэш
      const cacheKey = `embedding_${crypto.createHash('md5').update(text).digest('hex')}`;
      
      if (this.cacheEnabled) {
        const cachedEmbedding = this.cache.get(cacheKey);
        
        if (cachedEmbedding) {
          logger.debug('Использован кэшированный эмбеддинг');
          return cachedEmbedding;
        }
      }
      
      // Anthropic не предоставляет API эмбеддингов, используем OpenAI
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: text,
          model: 'text-embedding-ada-002'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY || this.apiKey}`
          }
        }
      );

      const embedding = response.data.data[0].embedding;
      
      // Сохраняем в кэш
      if (this.cacheEnabled) {
        this.cache.set(cacheKey, embedding);
      }
      
      return embedding;
    } catch (error) {
      logger.error('Ошибка при создании эмбеддинга:', error);
      
      // Реализация повторных попыток для эмбеддингов
      if (error.response && error.response.status >= 500) {
        logger.info('Повторная попытка создания эмбеддинга...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.createEmbedding(text);
      }
      
      return [];
    }
  }

  /**
   * Получение статистики использования токенов
   * @returns {Object} - Статистика использования
   */
  getTokenUsageStats() {
    return tokenManager.getStats();
  }

  /**
   * Очистка кэша
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('Кэш LLM клиента очищен');
  }
}

// Создание и экспорт экземпляра клиента
let llmClient = null;

const getLLMClient = () => {
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  return llmClient;
};

module.exports = { getLLMClient };
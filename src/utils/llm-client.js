// src/utils/llm-client.js

const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const config = require('../config/llm.config');
const logger = require('./logger');
const tokenManager = require('./token-manager');
const promptManager = require('./prompt-manager');
const llmCache = require('./llm-cache');
const { pool } = require('../config/db.config');

/**
 * Улучшенный клиент для взаимодействия с LLM API
 * Интегрирован с системой учета токенов, шаблонами и улучшенным кэшированием
 */
class LLMClient {
  /**
   * Создает экземпляр LLM клиента
   * @param {Object} customConfig - Пользовательские настройки для переопределения конфигурации
   */
  constructor(customConfig = {}) {
    // Объединяем настройки по умолчанию с пользовательскими
    this.config = { ...config, ...customConfig };
    
    this.apiKey = this.config.apiKey;
    this.model = this.config.model;
    this.apiUrl = this.config.apiUrl;
    this.maxTokens = this.config.maxTokens;
    this.temperature = this.config.temperature;
    
    // Настройки провайдера LLM (по умолчанию anthropic)
    this.provider = this.config.provider || 'anthropic';
    
    // Настройки повторных попыток при ошибках
    this.maxRetries = this.config.maxRetries || 3;
    this.retryDelay = this.config.retryDelay || 1000; // 1 секунда
    
    // Инициализация локального кэша для совместимости
    this.cache = new NodeCache({ 
      stdTTL: this.config.cacheTTL || 1800, 
      checkperiod: 300 
    });
    
    // Активирован ли встроенный кэш (для совместимости)
    this.cacheEnabled = this.config.cacheEnabled !== false;
    
    // Активировано ли улучшенное кэширование через llm-cache
    this.enhancedCacheEnabled = this.config.enhancedCacheEnabled !== false;
    
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
    
    // Идентификатор для логирования запросов
    this.trackingLLMInteractions = this.config.trackLLMInteractions !== false;
    
    // Инициализируем promptManager, если не инициализирован
    this._initializePromptManager();
    
    logger.info(`LLMClient инициализирован с моделью ${this.model} (провайдер: ${this.provider})`);
  }

  /**
   * Инициализирует менеджер промптов
   * @private
   */
  async _initializePromptManager() {
    try {
      if (!promptManager.initialized) {
        await promptManager.initialize();
      }
    } catch (error) {
      logger.warn('Не удалось инициализировать менеджер промптов:', error.message);
    }
  }

  /**
   * Логирует взаимодействие с LLM в базу данных
   * @param {string} prompt - Текст промпта
   * @param {string} response - Ответ от LLM
   * @param {number} tokensUsed - Количество использованных токенов
   * @param {string} modelUsed - Использованная модель
   * @param {number} taskId - ID задачи (опционально)
   * @private
   */
  async _logLLMInteraction(prompt, response, tokensUsed, modelUsed, taskId = null) {
    if (!this.trackingLLMInteractions) return;
    
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'INSERT INTO llm_interactions (task_id, prompt, response, model_used, tokens_used) VALUES (?, ?, ?, ?, ?)',
        [taskId, prompt, response, modelUsed, tokensUsed]
      );
      
      connection.release();
      logger.debug('Взаимодействие с LLM успешно записано в БД');
    } catch (error) {
      logger.error('Ошибка при логировании взаимодействия с LLM:', error);
    }
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
   * Подготавливает запрос к API в зависимости от провайдера
   * @param {string} prompt - Текст промпта
   * @param {Object} options - Параметры запроса
   * @returns {Object} - Подготовленный запрос
   * @private
   */
  _prepareRequest(prompt, options) {
    const model = options.model || this.model;
    const maxTokens = options.maxTokens || this.maxTokens;
    const temperature = options.temperature || this.temperature;
    
    // В зависимости от провайдера формируем разные структуры запроса
    switch (this.provider) {
      case 'anthropic':
        return {
          url: `${this.apiUrl}/v1/messages`,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          },
          data: {
            model,
            max_tokens: maxTokens,
            temperature,
            messages: [
              { role: "user", content: prompt }
            ]
          }
        };
        
      case 'openai':
        return {
          url: `${this.apiUrl}/v1/chat/completions`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          data: {
            model,
            max_tokens: maxTokens,
            temperature,
            messages: [
              { role: "user", content: prompt }
            ]
          }
        };
        
      default:
        throw new Error(`Неподдерживаемый провайдер LLM: ${this.provider}`);
    }
  }

  /**
   * Обрабатывает ответ API в зависимости от провайдера
   * @param {Object} response - Ответ от API
   * @returns {Object} - Обработанный ответ
   * @private
   */
  _processResponse(response) {
    switch (this.provider) {
      case 'anthropic':
        return {
          content: response.data.content[0].text,
          usage: response.data.usage || {
            prompt_tokens: 0,
            completion_tokens: Math.ceil(response.data.content[0].text.length / 4),
            total_tokens: Math.ceil(response.data.content[0].text.length / 4)
          },
          model: response.data.model
        };
        
      case 'openai':
        return {
          content: response.data.choices[0].message.content,
          usage: response.data.usage,
          model: response.data.model
        };
        
      default:
        throw new Error(`Неподдерживаемый провайдер LLM: ${this.provider}`);
    }
  }

  /**
   * Отправка запроса к LLM API с улучшенными возможностями
   * @param {string} prompt - Промпт для LLM
   * @param {Object} options - Опции запроса
   * @param {Object} metadata - Метаданные запроса (например, taskId)
   * @returns {Promise<string|Object>} - Ответ от LLM
   */
  async sendPrompt(prompt, options = {}, metadata = {}) {
    this.requestStats.sent++;
    
    // Параметр returnFull определяет формат возврата (только текст или полный объект)
    const returnFull = options.returnFull === true;
    delete options.returnFull;
    
    try {
      // Применяем оптимизации промпта
      const optimizationSuggestions = tokenManager.optimizePrompt(prompt);
      
      if (optimizationSuggestions.recommendations.length > 0 && 
          optimizationSuggestions.recommendations[0] !== 'Промпт оптимален') {
        logger.debug('Рекомендации по оптимизации промпта:', optimizationSuggestions.recommendations);
      }
      
      // Проверяем улучшенный кэш, если он включен
      if (this.enhancedCacheEnabled) {
        try {
          const cacheKey = this.createCacheKey(prompt, options);
          const cachedResponse = await llmCache.get(cacheKey);
          
          if (cachedResponse) {
            logger.debug('Использован улучшенный кэшированный ответ LLM');
            this.requestStats.cached++;
            
            return returnFull ? cachedResponse : cachedResponse.content;
          }
        } catch (error) {
          logger.warn('Ошибка при проверке улучшенного кэша:', error.message);
        }
      }
      
      // Проверяем встроенный кэш для совместимости, если он включен
      if (this.cacheEnabled) {
        const cacheKey = this.createCacheKey(prompt, options);
        const cachedResponse = this.cache.get(cacheKey);
        
        if (cachedResponse) {
          logger.debug('Использован встроенный кэшированный ответ LLM');
          this.requestStats.cached++;
          
          return returnFull ? { content: cachedResponse, cached: true } : cachedResponse;
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
      const maxContextTokens = this.config.maxContextTokens || 16000;
      const processedPrompt = this.processContextLimitations(prompt, maxContextTokens);
      
      // Подготавливаем запрос
      const request = this._prepareRequest(processedPrompt, options);
      
      logger.debug(`Отправка запроса к ${this.provider} API: ${JSON.stringify({
        model: request.data.model,
        max_tokens: request.data.max_tokens,
        temperature: request.data.temperature,
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
            request.url,
            request.data,
            { headers: request.headers }
          );
          
          const endTime = Date.now();
          const responseTime = endTime - startTime;
          
          // Обновляем статистику времени отклика
          this.updateResponseTimeStats(responseTime);
          
          // Обрабатываем ответ
          const processedResponse = this._processResponse(response);
          
          // Обновляем счетчик использования токенов
          if (processedResponse.usage) {
            tokenManager.trackUsage(
              request.data.model,
              processedResponse.usage.prompt_tokens || estimatedPromptTokens,
              processedResponse.usage.completion_tokens || Math.ceil(processedResponse.content.length / 4)
            );
          } else {
            // Если API не вернуло статистику токенов, используем оценку
            tokenManager.trackUsage(
              request.data.model,
              estimatedPromptTokens,
              Math.ceil(processedResponse.content.length / 4)
            );
          }
          
          logger.debug(`Получен ответ от ${this.provider} API за ${responseTime}ms`);
          this.requestStats.successful++;
          
          // Логируем взаимодействие с LLM в БД
          if (this.trackingLLMInteractions) {
            await this._logLLMInteraction(
              processedPrompt,
              processedResponse.content,
              processedResponse.usage?.total_tokens || estimatedTotalTokens,
              processedResponse.model || request.data.model,
              metadata.taskId
            );
          }
          
          // Сохраняем ответ в улучшенном кэше
          if (this.enhancedCacheEnabled) {
            try {
              await llmCache.set(this.createCacheKey(prompt, options), processedResponse);
            } catch (error) {
              logger.warn('Ошибка при сохранении в улучшенный кэш:', error.message);
            }
          }
          
          // Сохраняем ответ в встроенном кэше для совместимости
          if (this.cacheEnabled) {
            const cacheKey = this.createCacheKey(prompt, options);
            this.cache.set(cacheKey, processedResponse.content);
          }
          
          return returnFull ? processedResponse : processedResponse.content;
        } catch (error) {
          lastError = error;
          
          // Если ошибка связана с превышением лимита токенов
          if (error.response && error.response.status === 400 && 
              error.response.data.error && 
              (error.response.data.error.type === 'context_length_exceeded' || 
               error.response.data.error.type === 'rate_limit_exceeded')) {
            
            logger.warn(`Ошибка ${this.provider} API: ${error.response.data.error.type}`);
            
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
            logger.warn(`Временная ошибка ${this.provider} API (попытка ${retries+1}/${this.maxRetries+1}): ${error.message}`);
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
      throw lastError || new Error(`Превышено количество попыток запроса к ${this.provider} API`);
    } catch (error) {
      this.requestStats.failed++;
      logger.error(`Ошибка при отправке запроса к ${this.provider} API:`, error);
      throw new Error(`Ошибка ${this.provider} API: ${error.message}`);
    }
  }

  /**
   * Отправляет запрос с использованием шаблона
   * @param {string} templateName - Имя шаблона
   * @param {Object} templateData - Данные для шаблона
   * @param {Object} options - Параметры запроса
   * @param {Object} metadata - Метаданные запроса
   * @returns {Promise<string|Object>} - Ответ от LLM
   */
  async sendPromptTemplate(templateName, templateData = {}, options = {}, metadata = {}) {
    try {
      // Проверяем инициализацию promptManager
      await this._initializePromptManager();
      
      // Заполняем шаблон данными
      const prompt = await promptManager.fillPrompt(templateName, templateData);
      
      // Добавляем метку к метаданным для отслеживания
      const enhancedMetadata = {
        ...metadata,
        templateName,
        templateData: JSON.stringify(templateData).substring(0, 100) + '...'
      };
      
      // Отправляем запрос
      return await this.sendPrompt(prompt, options, enhancedMetadata);
    } catch (error) {
      logger.error(`Ошибка при отправке запроса по шаблону ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Отправляет цепочку промптов
   * @param {Array<Object>} chain - Цепочка промптов
   * @param {Object} options - Параметры запроса
   * @param {Object} metadata - Метаданные запроса
   * @returns {Promise<string|Object>} - Ответ от LLM
   */
  async sendPromptChain(chain, options = {}, metadata = {}) {
    try {
      // Проверяем инициализацию promptManager
      await this._initializePromptManager();
      
      // Создаем цепочку промптов
      const prompt = await promptManager.createPromptChain(chain);
      
      // Добавляем метку к метаданным для отслеживания
      const enhancedMetadata = {
        ...metadata,
        chainLength: chain.length,
        chainTemplates: chain.map(item => item.template).join(',')
      };
      
      // Отправляем запрос
      return await this.sendPrompt(prompt, options, enhancedMetadata);
    } catch (error) {
      logger.error(`Ошибка при отправке цепочки промптов:`, error);
      throw error;
    }
  }

  /**
   * Выполняет диалог с LLM, передавая контекст из предыдущих сообщений
   * @param {Array<Object>} messages - Массив сообщений {role, content}
   * @param {Object} options - Параметры запроса
   * @param {Object} metadata - Метаданные запроса
   * @returns {Promise<Object>} - Ответ от LLM
   */
  async chat(messages, options = {}, metadata = {}) {
    try {
      // Формируем один промпт из всех сообщений
      let combinedPrompt = '';
      
      for (const message of messages) {
        const role = message.role === 'user' ? 'Human' : 'Assistant';
        combinedPrompt += `${role}: ${message.content}\n\n`;
      }
      
      combinedPrompt += 'Assistant: ';
      
      // Отправляем запрос
      return await this.sendPrompt(combinedPrompt, { ...options, returnFull: true }, metadata);
    } catch (error) {
      logger.error('Ошибка при выполнении диалога с LLM:', error);
      throw error;
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
    
    const stats = {
      provider: this.provider,
      model: this.model,
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
    
    // Добавляем статистику улучшенного кэша, если он включен
    if (this.enhancedCacheEnabled) {
      try {
        stats.enhancedCache = llmCache.getStats();
      } catch (error) {
        logger.warn('Не удалось получить статистику улучшенного кэша:', error.message);
      }
    }
    
    return stats;
  }

  /**
   * Создание векторного представления (эмбеддинга) текста
   * @param {string} text - Текст для векторизации
   * @param {Object} options - Параметры запроса
   * @returns {Promise<Array>} - Векторное представление
   */
  async createEmbedding(text, options = {}) {
    try {
      // Проверяем кэш для эмбеддингов
      const embeddingCacheKey = `embedding_${crypto.createHash('md5').update(text).digest('hex')}`;
      
      // Проверяем улучшенный кэш, если он включен
      if (this.enhancedCacheEnabled) {
        try {
          const cachedEmbedding = await llmCache.get(embeddingCacheKey);
          
          if (cachedEmbedding && Array.isArray(cachedEmbedding.embedding)) {
            logger.debug('Использован улучшенный кэшированный эмбеддинг');
            return cachedEmbedding.embedding;
          }
        } catch (error) {
          logger.warn('Ошибка при проверке улучшенного кэша для эмбеддинга:', error.message);
        }
      }
      
      // Проверяем встроенный кэш для совместимости
      if (this.cacheEnabled) {
        const cachedEmbedding = this.cache.get(embeddingCacheKey);
        
        if (cachedEmbedding) {
          logger.debug('Использован кэшированный эмбеддинг');
          return cachedEmbedding;
        }
      }
      
      // Выбираем провайдера эмбеддингов
      const embeddingProvider = options.embeddingProvider || 'openai';
      const embeddingModel = options.embeddingModel || 'text-embedding-ada-002';
      const embeddingApiKey = options.embeddingApiKey || process.env.OPENAI_API_KEY || this.apiKey;
      
      let embedding = [];
      
      // Запрос эмбеддингов в зависимости от провайдера
      if (embeddingProvider === 'openai') {
        const response = await axios.post(
          'https://api.openai.com/v1/embeddings',
          {
            input: text,
            model: embeddingModel
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${embeddingApiKey}`
            }
          }
        );
        
        embedding = response.data.data[0].embedding;
      } else {
        throw new Error(`Неподдерживаемый провайдер эмбеддингов: ${embeddingProvider}`);
      }
      
      // Сохраняем в улучшенном кэше
      if (this.enhancedCacheEnabled) {
        try {
          await llmCache.set(embeddingCacheKey, { embedding });
        } catch (error) {
          logger.warn('Ошибка при сохранении эмбеддинга в улучшенный кэш:', error.message);
        }
      }
      
      // Сохраняем в встроенном кэше для совместимости
      if (this.cacheEnabled) {
        this.cache.set(embeddingCacheKey, embedding);
      }
      
      return embedding;
    } catch (error) {
      logger.error('Ошибка при создании эмбеддинга:', error);
      
      // Реализация повторных попыток для эмбеддингов
      if (error.response && error.response.status >= 500) {
        logger.info('Повторная попытка создания эмбеддинга...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.createEmbedding(text, options);
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
   * Очистка встроенного кэша
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('Кэш LLM клиента очищен');
  }

  /**
   * Очистка всех кэшей (встроенного и улучшенного)
   */
  async clearAllCaches() {
    // Очищаем встроенный кэш
    this.clearCache();
    
    // Очищаем улучшенный кэш, если он включен
    if (this.enhancedCacheEnabled) {
      try {
        await llmCache.clear();
        logger.info('Улучшенный кэш LLM клиента очищен');
      } catch (error) {
        logger.error('Ошибка при очистке улучшенного кэша:', error);
      }
    }
  }

  /**
   * Добавляет или обновляет шаблон промпта
   * @param {string} templateName - Имя шаблона
   * @param {string} templateContent - Содержимое шаблона
   * @returns {Promise<void>}
   */
  async addTemplate(templateName, templateContent) {
    await this._initializePromptManager();
    await promptManager.addTemplate(templateName, templateContent);
  }

  /**
   * Получает список всех доступных шаблонов
   * @param {string} category - Категория шаблонов (опционально)
   * @returns {Promise<Array<string>>} - Список имен шаблонов
   */
  async listTemplates(category = null) {
    await this._initializePromptManager();
    return await promptManager.listTemplates(category);
  }
}

// Создание и экспорт экземпляра клиента
let llmClient = null;

const getLLMClient = (config = {}) => {
  if (!llmClient || Object.keys(config).length > 0) {
    llmClient = new LLMClient(config);
  }
  return llmClient;
};

module.exports = { getLLMClient, LLMClient };
// src/utils/llm-client.js

const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const config = require('../config/llm.config');
const logger = require('./logger');

/**
 * Улучшенный клиент для взаимодействия с LLM API
 * Поддерживает кэширование запросов, повторные попытки и оптимизацию контекста
 */
class LLMClient {
  constructor() {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiUrl = config.apiUrl;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
    
    // Настройки повторных попыток при ошибках
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 секунда
    
    // Инициализация кэша
    // TTL: 30 минут, проверка на устаревшие записи каждые 5 минут
    this.cache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });
    
    // Счетчик использования токенов
    this.tokenUsage = {
      total: 0,
      promptTokens: 0,
      completionTokens: 0
    };
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
   * Оценивает количество токенов в тексте
   * Примечание: это приблизительная оценка, не точный подсчет
   * @param {string} text - Текст для оценки
   * @returns {number} - Приблизительное количество токенов
   */
  estimateTokenCount(text) {
    // Очень приблизительная оценка: 1 токен ~= 4 символа для английского текста
    // и ~= 2-3 символа для кириллицы и других не-латинских алфавитов
    // В реальности следует использовать tokenizer, соответствующий используемой модели
    
    // Подсчитываем количество латинских и нелатинских символов
    const latinChars = (text.match(/[a-zA-Z0-9.,?!;:()[\]{}<>'"\/\\-_+=*&^%$#@]/g) || []).length;
    const totalChars = text.length;
    const nonLatinChars = totalChars - latinChars;
    
    // Применяем разные коэффициенты для разных типов символов
    return Math.ceil(latinChars / 4 + nonLatinChars / 2.5);
  }

  /**
   * Ограничивает размер контекста, удаляя наименее релевантные части
   * @param {string} text - Исходный текст
   * @param {number} maxTokens - Максимальное количество токенов
   * @returns {string} - Ограниченный текст
   */
  limitContextSize(text, maxTokens = 16000) {
    const estimatedTokens = this.estimateTokenCount(text);
    
    if (estimatedTokens <= maxTokens) {
      return text; // Контекст в пределах лимита
    }
    
    logger.warn(`Контекст превышает лимит в ${maxTokens} токенов (примерно ${estimatedTokens}). Выполняется сокращение.`);
    
    // Разбиваем текст на смысловые блоки (параграфы, функции кода и т.д.)
    const blocks = text.split(/(\n\s*\n|\n```)/);
    
    // Сортируем блоки по предполагаемой важности
    // Приоритет: код, заголовки, пользовательские запросы, и т.д.
    const prioritizedBlocks = this.prioritizeContextBlocks(blocks);
    
    // Собираем контекст из блоков в порядке приоритета
    let limitedContext = "";
    let currentTokens = 0;
    
    for (const block of prioritizedBlocks) {
      const blockTokens = this.estimateTokenCount(block);
      
      if (currentTokens + blockTokens > maxTokens) {
        // Если блок не помещается целиком, можно добавить логику частичного включения
        // Например, для кода - включать только сигнатуры функций
        continue;
      }
      
      limitedContext += block;
      currentTokens += blockTokens;
    }
    
    logger.info(`Контекст сокращен до ~${currentTokens} токенов`);
    
    return limitedContext;
  }

  /**
   * Сортирует блоки контекста по важности
   * @param {Array<string>} blocks - Блоки текста
   * @returns {Array<string>} - Отсортированные блоки
   */
  prioritizeContextBlocks(blocks) {
    // Определяем важность каждого блока
    const scoredBlocks = blocks.map(block => {
      let score = 0;
      
      // Код получает высокий приоритет
      if (block.includes('```') || block.match(/function\s+\w+\s*\(/) || 
          block.match(/class\s+\w+/) || block.match(/const\s+\w+\s*=/)) {
        score += 100;
      }
      
      // Заголовки и описания задач
      if (block.match(/^#+\s+/) || block.includes('TASK:') || block.includes('SUBTASK:')) {
        score += 80;
      }
      
      // Пользовательские запросы
      if (block.includes('USER:') || block.includes('HUMAN:')) {
        score += 90;
      }
      
      // Системные сообщения
      if (block.includes('SYSTEM:')) {
        score += 70;
      }
      
      // Свежая информация ценнее старой
      if (block.includes('last modified') || block.includes('updated') || 
          block.includes('recent')) {
        score += 30;
      }
      
      // Более короткие блоки получают небольшой бонус (эффективность)
      score += Math.max(0, 10 - Math.floor(block.length / 100));
      
      return { block, score };
    });
    
    // Сортируем по убыванию важности
    return scoredBlocks
      .sort((a, b) => b.score - a.score)
      .map(item => item.block);
  }

  /**
   * Отправка запроса к LLM API с поддержкой повторных попыток и кэширования
   * @param {string} prompt - Промпт для LLM
   * @param {Object} options - Опции запроса
   * @returns {Promise<string>} - Ответ от LLM
   */
  async sendPrompt(prompt, options = {}) {
    try {
      // Проверяем кэш
      const cacheKey = this.createCacheKey(prompt, options);
      const cachedResponse = this.cache.get(cacheKey);
      
      if (cachedResponse) {
        logger.debug('Использован кэшированный ответ LLM');
        return cachedResponse;
      }
      
      // Ограничиваем размер контекста
      const limitedPrompt = this.limitContextSize(prompt, 16000);
      
      const requestOptions = {
        model: options.model || this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature || this.temperature,
        messages: [
          { role: "user", content: limitedPrompt }
        ]
      };

      logger.debug(`Отправка запроса к LLM API: ${JSON.stringify({
        model: requestOptions.model,
        max_tokens: requestOptions.max_tokens,
        temperature: requestOptions.temperature,
        prompt_length: limitedPrompt.length
      })}`);

      // Реализуем механизм повторных попыток
      let retries = 0;
      let lastError = null;
      
      while (retries <= this.maxRetries) {
        try {
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
          
          // Обновляем счетчик использования токенов
          if (response.data.usage) {
            this.tokenUsage.promptTokens += response.data.usage.prompt_tokens || 0;
            this.tokenUsage.completionTokens += response.data.usage.completion_tokens || 0;
            this.tokenUsage.total += response.data.usage.total_tokens || 0;
          }

          logger.debug('Получен ответ от LLM API');
          
          // Сохраняем ответ в кэш
          const content = response.data.content[0].text;
          this.cache.set(cacheKey, content);
          
          return content;
        } catch (error) {
          lastError = error;
          
          // Если ошибка связана с превышением лимита токенов или другими лимитами ресурсов
          if (error.response && error.response.status === 400 && 
              (error.response.data.error.type === 'context_length_exceeded' || 
               error.response.data.error.type === 'rate_limit_exceeded')) {
            
            logger.warn(`Ошибка LLM API: ${error.response.data.error.type}`);
            
            // Для ошибки превышения контекста - уменьшаем размер
            if (error.response.data.error.type === 'context_length_exceeded') {
              prompt = this.limitContextSize(prompt, Math.floor(this.estimateTokenCount(prompt) * 0.8));
              continue;
            }
            
            // Для превышения рейт-лимита - увеличиваем задержку
            if (error.response.data.error.type === 'rate_limit_exceeded') {
              await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retries)));
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
      throw lastError || new Error('Превышено количество попыток запроса к LLM API');
    } catch (error) {
      logger.error('Ошибка при отправке запроса к LLM API:', error);
      throw new Error(`Ошибка LLM API: ${error.message}`);
    }
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
      const cachedEmbedding = this.cache.get(cacheKey);
      
      if (cachedEmbedding) {
        logger.debug('Использован кэшированный эмбеддинг');
        return cachedEmbedding;
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
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      const embedding = response.data.data[0].embedding;
      
      // Сохраняем в кэш
      this.cache.set(cacheKey, embedding);
      
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
    return {
      ...this.tokenUsage,
      estimatedCost: (this.tokenUsage.promptTokens * 0.0000025 + 
                      this.tokenUsage.completionTokens * 0.0000075).toFixed(4)
    };
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
/**
 * Конфигурация для LLM-клиента и связанных компонентов
 */

const path = require('path');
require('dotenv').config();

/**
 * Загружает API-ключи из переменных окружения
 * @returns {Object} Объект с API-ключами
 */
function loadApiKeys() {
  return {
    anthropic: process.env.ANTHROPIC_API_KEY || null,
    openai: process.env.OPENAI_API_KEY || null,
    cohere: process.env.COHERE_API_KEY || null,
    generic: process.env.LLM_API_KEY || null
  };
}

const apiKeys = loadApiKeys();

/**
 * Конфигурация для LLM-клиента
 */
module.exports = {
  // Основные настройки API
  provider: process.env.LLM_PROVIDER || 'anthropic', // 'anthropic', 'openai', 'cohere'
  model: process.env.LLM_MODEL || 'claude-3-sonnet-20240229', // модель по умолчанию
  apiKey: apiKeys[process.env.LLM_PROVIDER || 'anthropic'] || apiKeys.generic,
  apiUrl: process.env.LLM_API_URL || 'https://api.anthropic.com',
  
  // Настройки для каждого провайдера
  anthropic: {
    apiKey: apiKeys.anthropic,
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      'claude-3-opus-20240229', 
      'claude-3-sonnet-20240229', 
      'claude-3-haiku-20240307',
      'claude-2.1',
      'claude-2.0',
      'claude-instant-1.2'
    ]
  },
  
  openai: {
    apiKey: apiKeys.openai,
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      'gpt-4-turbo', 
      'gpt-4', 
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct'
    ]
  },
  
  cohere: {
    apiKey: apiKeys.cohere,
    apiEndpoint: 'https://api.cohere.ai/v1/generate',
    models: [
      'command', 
      'command-light', 
      'command-nightly'
    ]
  },
  
  // Дефолтные параметры генерации
  maxTokens: 4096,
  temperature: 0.7,
  defaultSystemPrompt: "Ты - AI-ассистент для разработки ПО. Ты помогаешь программистам анализировать код, решать проблемы, генерировать код, создавать тесты и т.д. Твои ответы должны быть точными, информативными и следовать лучшим практикам разработки.",
  
  // Настройки запросов
  timeout: 60000, // 60 секунд
  maxRetries: 3,
  retryDelay: 1000, // начальная задержка между повторами в мс
  maxContextTokens: 16000, // макс. размер контекста в токенах
  
  // Настройки кэширования
  cacheEnabled: true,
  enhancedCacheEnabled: true,
  cacheTTL: 1800, // время жизни кэша в секундах (30 минут)
  
  // Расширенные настройки кэша
  cache: {
    type: process.env.LLM_CACHE_TYPE || 'memory', // 'memory' или 'redis'
    ttl: 3600, // 1 час
    maxKeys: 10000,
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || null,
      db: parseInt(process.env.REDIS_DB) || 0
    }
  },
  
  // Настройки лимитов токенов
  tokenLimits: {
    daily: parseInt(process.env.LLM_DAILY_TOKEN_LIMIT) || 1000000, // 1 млн токенов в день
    monthly: parseInt(process.env.LLM_MONTHLY_TOKEN_LIMIT) || 10000000 // 10 млн токенов в месяц
  },
  
  // Стоимость токенов (долларов за миллион токенов)
  tokenCosts: {
    'claude-3-opus-20240229': { prompt: 15, completion: 75 },
    'claude-3-sonnet-20240229': { prompt: 3, completion: 15 },
    'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25 },
    'claude-2.1': { prompt: 8, completion: 24 },
    'claude-2.0': { prompt: 8, completion: 24 },
    'claude-instant-1.2': { prompt: 1.63, completion: 5.51 },
    'gpt-4-turbo': { prompt: 10, completion: 30 },
    'gpt-4': { prompt: 30, completion: 60 },
    'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
    'default': { prompt: 5, completion: 15 }
  },
  
  // Ограничения контекста (максимальное количество токенов)
  contextLimits: {
    'claude-3-opus-20240229': 200000,
    'claude-3-sonnet-20240229': 200000,
    'claude-3-haiku-20240307': 180000,
    'claude-2.1': 100000,
    'claude-2.0': 100000,
    'claude-instant-1.2': 100000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16385,
    'default': 8000
  },
  
  // Настройки для шаблонов промптов
  templates: {
    path: path.join(process.cwd(), 'templates', 'prompts'),
    customPath: path.join(process.cwd(), 'templates', 'custom'),
    variables: {
      APP_NAME: 'BIZ360 AI',
      APP_VERSION: '1.0.0',
      COMPANY_NAME: 'BIZ360',
      APP_DOMAIN: 'Development'
    }
  },
  
  // Настройки для логирования взаимодействий с LLM
  trackLLMInteractions: true,
  
  // Настройки для векторных эмбеддингов
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-ada-002',
    dimensions: 1536
  },
  
  // Дополнительные настройки
  generic: {
    // Для нестандартных провайдеров LLM
    requestTemplate: {
      model: "{{model}}",
      temperature: "{{temperature}}",
      max_tokens: "{{max_tokens}}",
      prompt: "{{prompt}}"
    },
    headers: {
      // Дополнительные заголовки для нестандартных API
    },
    responseExtractor: (response) => {
      // Функция для извлечения текста из нестандартного ответа API
      return response.text || response.output || response.completion || '';
    }
  }
};
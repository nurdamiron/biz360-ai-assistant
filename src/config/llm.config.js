// src/config/llm.config.js

require('dotenv').config();

// Расширенная конфигурация LLM API
const llmConfig = {
  // Основные настройки API
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL || 'claude-3-opus-20240229',
  apiUrl: process.env.LLM_API_URL || 'https://api.anthropic.com',
  
  // Параметры генерации
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '4000', 10),
  temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
  topP: parseFloat(process.env.LLM_TOP_P || '0.95'),
  topK: parseInt(process.env.LLM_TOP_K || '40', 10),
  
  // Управление контекстом
  maxContextTokens: parseInt(process.env.LLM_MAX_CONTEXT_TOKENS || '16000', 10),
  
  // Настройки кэширования
  cacheEnabled: process.env.LLM_CACHE_ENABLED !== 'false',
  cacheTTL: parseInt(process.env.LLM_CACHE_TTL || '1800', 10), // в секундах
  
  // Повторные попытки при ошибках
  maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '3', 10),
  retryDelay: parseInt(process.env.LLM_RETRY_DELAY || '1000', 10), // в миллисекундах
  
  // Моделирование персонажа ассистента
  systemMessage: process.env.LLM_SYSTEM_MESSAGE || 
    "Ты - опытный AI-ассистент разработчика для проекта Biz360 CRM. " +
    "Твоя задача - помогать в разработке высококачественного, хорошо структурированного и документированного кода. " +
    "Ты предпочитаешь современные паттерны программирования, асинхронные функции и придерживаешься принципов SOLID.",
  
  // Настройки для конкретных задач
  tasks: {
    codeGeneration: {
      model: process.env.CODE_GEN_MODEL || 'claude-3-opus-20240229',
      temperature: parseFloat(process.env.CODE_GEN_TEMPERATURE || '0.5')
    },
    taskDecomposition: {
      model: process.env.TASK_DECOMP_MODEL || 'claude-3-sonnet-20240229', 
      temperature: parseFloat(process.env.TASK_DECOMP_TEMPERATURE || '0.7')
    },
    bugFixes: {
      model: process.env.BUG_FIX_MODEL || 'claude-3-opus-20240229',
      temperature: parseFloat(process.env.BUG_FIX_TEMPERATURE || '0.2')
    }
  },
  
  // Настройки безопасности и мониторинга
  rateLimit: {
    requestsPerMinute: parseInt(process.env.LLM_RATE_LIMIT_RPM || '50', 10),
    tokensPerDay: parseInt(process.env.LLM_RATE_LIMIT_TPD || '1000000', 10)
  },
  
  // Настройки эмбеддингов
  embeddings: {
    model: process.env.EMBEDDINGS_MODEL || 'text-embedding-ada-002',
    apiUrl: process.env.EMBEDDINGS_API_URL || 'https://api.openai.com/v1'
  }
};

module.exports = llmConfig;
require('dotenv').config();

// Конфигурация LLM API
const llmConfig = {
  apiKey: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL || 'claude-3',
  apiUrl: process.env.LLM_API_URL || 'https://api.anthropic.com/v1',
  maxTokens: 4000,
  temperature: 0.7
};

module.exports = llmConfig;

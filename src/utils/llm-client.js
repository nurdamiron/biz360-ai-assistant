const axios = require('axios');
const config = require('../config/llm.config');
const logger = require('./logger');

/**
 * Клиент для взаимодействия с LLM API
 */
class LLMClient {
  constructor() {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiUrl = config.apiUrl;
    this.maxTokens = config.maxTokens;
    this.temperature = config.temperature;
  }

  /**
   * Отправка запроса к LLM API
   * @param {string} prompt - Промпт для LLM
   * @param {Object} options - Опции запроса
   * @returns {Promise<string>} - Ответ от LLM
   */
  async sendPrompt(prompt, options = {}) {
    try {
      const requestOptions = {
        model: options.model || this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature || this.temperature,
        messages: [
          { role: "user", content: prompt }
        ]
      };

      logger.debug(`Отправка запроса к LLM API: ${JSON.stringify(requestOptions)}`);

      const response = await axios.post(
        `${this.apiUrl}/chat/completions`,
        requestOptions,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
          }
        }
      );

      logger.debug('Получен ответ от LLM API');
      
      return response.data.choices[0].message.content;
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
      // Примечание: Для Claude может потребоваться другой эндпоинт или API
      // Здесь представлен примерный код для OpenAI API как пример
      
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

      return response.data.data[0].embedding;
    } catch (error) {
      logger.error('Ошибка при создании эмбеддинга:', error);
      return [];
    }
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

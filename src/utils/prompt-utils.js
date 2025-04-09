/**
 * Утилиты для работы с промптами
 */
const promptManager = require('./prompt-manager');
const logger = require('./logger');

/**
 * Получает шаблон промпта по имени
 * @param {string} templateName - Имя шаблона
 * @returns {Promise<string>} - Содержимое шаблона
 */
const getPromptTemplate = async (templateName) => {
  try {
    logger.debug(`Получение шаблона промпта: ${templateName}`);
    
    // Используем метод PromptManager для получения шаблона без заполнения переменных
    return await promptManager.getRawTemplate(templateName);
  } catch (error) {
    logger.error(`Ошибка при получении шаблона промпта ${templateName}: ${error.message}`, {
      error: error.stack
    });
    
    // В случае ошибки возвращаем базовый шаблон
    return `# Шаблон ${templateName} не найден\n\nПожалуйста, выполните анализ на основе предоставленных данных.`;
  }
};

/**
 * Заполняет шаблон промпта переменными
 * @param {string} templateName - Имя шаблона
 * @param {Object} variables - Переменные для заполнения
 * @returns {Promise<string>} - Заполненный шаблон
 */
const fillPromptTemplate = async (templateName, variables = {}) => {
  try {
    logger.debug(`Заполнение шаблона промпта: ${templateName}`);
    
    // Используем метод PromptManager для получения и заполнения шаблона
    return await promptManager.getPrompt(templateName, variables);
  } catch (error) {
    logger.error(`Ошибка при заполнении шаблона промпта ${templateName}: ${error.message}`, {
      error: error.stack
    });
    
    // В случае ошибки возвращаем базовый шаблон с переменными
    return `# Шаблон ${templateName} не найден\n\nПожалуйста, выполните анализ на основе предоставленных данных:\n${JSON.stringify(variables, null, 2)}`;
  }
};

/**
 * Создает цепочку промптов
 * @param {Array<Object>} chain - Цепочка шаблонов
 * @returns {Promise<string>} - Объединенный промпт
 */
const createPromptChain = async (chain) => {
  try {
    logger.debug(`Создание цепочки промптов из ${chain.length} шаблонов`);
    
    // Используем метод PromptManager для создания цепочки промптов
    return await promptManager.createPromptChain(chain);
  } catch (error) {
    logger.error(`Ошибка при создании цепочки промптов: ${error.message}`, {
      error: error.stack
    });
    
    // В случае ошибки возвращаем базовый шаблон
    return `# Ошибка при создании цепочки промптов\n\nПожалуйста, выполните анализ на основе предоставленных данных.`;
  }
};

module.exports = {
  getPromptTemplate,
  fillPromptTemplate,
  createPromptChain,
  promptManager // Экспортируем менеджер для расширенного использования
};
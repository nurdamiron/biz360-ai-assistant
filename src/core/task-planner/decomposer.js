// src/core/task-planner/decomposer.js

const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');

/**
 * Класс для декомпозиции высокоуровневых задач на подзадачи
 */
class TaskDecomposer {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
  }

  /**
   * Получает информацию о проекте
   * @returns {Promise<Object>} - Информация о проекте
   */
  async getProjectInfo() {
    try {
      const connection = await pool.getConnection();
      
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [this.projectId]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        throw new Error(`Проект с id=${this.projectId} не найден`);
      }
      
      return projects[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о проекте:', error);
      throw error;
    }
  }

  /**
   * Декомпозирует высокоуровневую задачу на подзадачи
   * @param {Object} task - Высокоуровневая задача
   * @returns {Promise<Array>} - Массив подзадач
   */
  async decompose(task) {
    try {
      logger.info(`Начинаем декомпозицию задачи "${task.title}"`);
      
      // Получаем информацию о проекте
      const projectInfo = await this.getProjectInfo();
      
      // Создаем промпт для декомпозиции
      const prompt = await this.createDecompositionPrompt(task, projectInfo);
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Парсим ответ и извлекаем подзадачи
      const subtasks = this.parseSubtasksFromResponse(response);
      
      logger.info(`Задача "${task.title}" декомпозирована на ${subtasks.length} подзадач`);
      
      return subtasks;
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи:`, error);
      throw error;
    }
  }

  /**
   * Создает промпт для декомпозиции задачи
   * @param {Object} task - Задача для декомпозиции
   * @param {Object} projectInfo - Информация о проекте
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createDecompositionPrompt(task, projectInfo) {
    return `
# Декомпозиция задачи разработки

Ты - опытный разработчик и архитектор, который помогает разбивать сложные задачи на подзадачи.

## Проект
Название: ${projectInfo.name}
Описание: ${projectInfo.description}

## Задача для декомпозиции
Название: ${task.title}
Описание: ${task.description}

## Инструкции
1. Разбей эту задачу на 3-7 последовательных подзадач, каждая из которых представляет четкий шаг в реализации общей задачи.
2. Подзадачи должны быть конкретными, выполнимыми и логически связанными.
3. Подзадачи должны следовать в порядке, необходимом для выполнения общей задачи.
4. Каждая подзадача должна иметь четкий заголовок и подробное описание того, что нужно сделать.

## Формат ответа
Выдай подзадачи в формате:

SUBTASK: [Заголовок подзадачи 1]
DESCRIPTION: [Подробное описание подзадачи 1]

SUBTASK: [Заголовок подзадачи 2]
DESCRIPTION: [Подробное описание подзадачи 2]

И так далее для каждой подзадачи.
`;
  }

  /**
   * Парсит ответ LLM и извлекает подзадачи
   * @param {string} response - Ответ от LLM
   * @returns {Array} - Массив подзадач
   */
  parseSubtasksFromResponse(response) {
    try {
      const subtasks = [];
      
      // Регулярное выражение для извлечения подзадач и их описаний
      const regex = /SUBTASK:\s*(.+?)[\r\n]+DESCRIPTION:\s*([\s\S]+?)(?=\n\s*SUBTASK:|$)/g;
      
      let match;
      while ((match = regex.exec(response)) !== null) {
        subtasks.push({
          title: match[1].trim(),
          description: match[2].trim()
        });
      }
      
      // Проверяем, что удалось извлечь подзадачи
      if (subtasks.length === 0) {
        logger.warn('Не удалось извлечь подзадачи из ответа LLM:', response);
        
        // Пытаемся использовать альтернативный формат (маркированный список)
        const lines = response.split('\n');
        let currentSubtask = null;
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          
          if (trimmedLine.match(/^\d+\.\s+/) || trimmedLine.match(/^-\s+/) || trimmedLine.match(/^\*\s+/)) {
            // Новая подзадача
            if (currentSubtask) {
              subtasks.push(currentSubtask);
            }
            
            currentSubtask = {
              title: trimmedLine.replace(/^(\d+\.|[-*])\s+/, ''),
              description: ''
            };
          } else if (currentSubtask && trimmedLine.length > 0) {
            // Дополнение к описанию текущей подзадачи
            currentSubtask.description += (currentSubtask.description ? '\n' : '') + trimmedLine;
          }
        }
        
        // Добавляем последнюю подзадачу
        if (currentSubtask) {
          subtasks.push(currentSubtask);
        }
      }
      
      return subtasks;
    } catch (error) {
      logger.error('Ошибка при парсинге подзадач из ответа LLM:', error);
      return [];
    }
  }
}

module.exports = TaskDecomposer;
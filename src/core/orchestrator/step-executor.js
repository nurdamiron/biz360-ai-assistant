// src/core/orchestrator/step-executor.js

/**
 * Базовый интерфейс для исполнителя шагов методологии
 * Все исполнители конкретных шагов должны наследоваться от этого класса
 */
class StepExecutor {
    /**
     * Название шага
     * @type {string}
     */
    static stepName = 'Abstract Step';
  
    /**
     * Номер шага в методологии (от 1 до 16)
     * @type {number}
     */
    static stepNumber = 0;
  
    /**
     * Проверяет, может ли шаг быть выполнен с текущим контекстом
     * @param {object} context - Контекст задачи
     * @returns {Promise<boolean>} - true если шаг может быть выполнен, иначе false
     */
    async canExecute(context) {
      // Базовая реализация всегда возвращает true
      // Переопределяется в конкретных исполнителях
      return true;
    }
  
    /**
     * Выполняет шаг с текущим контекстом
     * @param {object} context - Контекст задачи
     * @returns {Promise<object>} - Результат выполнения шага
     * @throws {Error} - В случае ошибки выполнения
     */
    async execute(context) {
      throw new Error('Method execute() must be implemented by subclass');
    }
  
    /**
     * Откатывает изменения, внесенные шагом, в случае ошибки
     * @param {object} context - Контекст задачи
     * @returns {Promise<void>}
     */
    async rollback(context) {
      // Базовая реализация ничего не делает
      // Переопределяется в конкретных исполнителях при необходимости
      return;
    }
  
    /**
     * Оценивает необходимые ресурсы и время для выполнения шага
     * @param {object} context - Контекст задачи
     * @returns {Promise<object>} - Оценка ресурсов {timeEstimate, memoryEstimate, cpuEstimate}
     */
    async estimateResources(context) {
      // Базовая реализация возвращает default оценки
      return {
        timeEstimate: '1m', // Оценка времени (строка в формате 1m, 30s, 2h)
        memoryEstimate: '100MB', // Оценка памяти
        cpuEstimate: 'low', // Оценка CPU (low, medium, high)
        tokens: 1000 // Оценка количества токенов для LLM
      };
    }
  
    /**
     * Возвращает информацию о зависимостях для шага
     * @returns {Array<number>} - Массив номеров шагов, от которых зависит текущий
     */
    getDependencies() {
      // Базовая реализация не имеет зависимостей
      return [];
    }
  }
  
  module.exports = StepExecutor;
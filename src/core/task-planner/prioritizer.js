// src/core/task-planner/prioritizer.js

const logger = require('../../utils/logger');

/**
 * Класс для приоритизации задач
 */
class TaskPrioritizer {
  constructor() {
    // Веса для различных факторов приоритизации
    this.weights = {
      priority: 5,      // Вес заданного приоритета задачи
      age: 2,           // Вес возраста задачи
      dependencies: 3,  // Вес зависимостей (блокирует ли задача другие задачи)
      complexity: 1     // Вес сложности задачи
    };
    
    // Значения для приоритетов
    this.priorityValues = {
      'critical': 10,
      'high': 7,
      'medium': 5,
      'low': 2
    };
  }

  /**
   * Приоритизирует список задач
   * @param {Array} tasks - Список задач для приоритизации
   * @returns {Promise<Array>} - Отсортированный по приоритету список задач
   */
  async prioritize(tasks) {
    try {
      logger.debug(`Приоритизация ${tasks.length} задач`);
      
      // Вычисляем оценки для каждой задачи
      const scoredTasks = tasks.map(task => {
        const score = this.calculateTaskScore(task);
        return { ...task, score };
      });
      
      // Сортируем задачи по убыванию оценки
      const sortedTasks = scoredTasks.sort((a, b) => b.score - a.score);
      
      return sortedTasks;
    } catch (error) {
      logger.error('Ошибка при приоритизации задач:', error);
      return tasks; // В случае ошибки возвращаем исходный список
    }
  }

  /**
   * Вычисляет оценку приоритета для задачи
   * @param {Object} task - Задача для оценки
   * @returns {number} - Оценка приоритета
   */
  calculateTaskScore(task) {
    // Оценка по заданному приоритету
    const priorityScore = this.getPriorityScore(task.priority);
    
    // Оценка по возрасту задачи (давно созданные задачи имеют более высокий приоритет)
    const ageScore = this.getAgeScore(task.created_at);
    
    // Оценка по зависимостям (если эта задача блокирует другие)
    // В реальной системе здесь должна быть логика проверки зависимостей
    const dependencyScore = 0;
    
    // Оценка по сложности (предполагаем, что сложность можно определить по длине описания)
    const complexityScore = this.getComplexityScore(task.description);
    
    // Вычисляем взвешенную сумму всех оценок
    const totalScore = 
      priorityScore * this.weights.priority +
      ageScore * this.weights.age +
      dependencyScore * this.weights.dependencies +
      complexityScore * this.weights.complexity;
    
    return totalScore;
  }

  /**
   * Получает оценку по заданному приоритету
   * @param {string} priority - Приоритет задачи
   * @returns {number} - Оценка приоритета
   */
  getPriorityScore(priority) {
    return this.priorityValues[priority.toLowerCase()] || this.priorityValues.medium;
  }

  /**
   * Получает оценку по возрасту задачи
   * @param {string} createdAt - Дата создания задачи
   * @returns {number} - Оценка возраста
   */
  getAgeScore(createdAt) {
    const creationDate = new Date(createdAt);
    const now = new Date();
    
    // Вычисляем разницу в днях
    const diffTime = Math.abs(now - creationDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Нормализуем оценку (максимум 10)
    return Math.min(diffDays / 3, 10);
  }

  /**
   * Получает оценку по сложности задачи
   * @param {string} description - Описание задачи
   * @returns {number} - Оценка сложности
   */
  getComplexityScore(description) {
    if (!description) {
      return 5; // Средняя сложность по умолчанию
    }
    
    // Оцениваем сложность по длине описания (очень простой подход)
    const length = description.length;
    
    if (length < 100) {
      return 3; // Простая задача
    } else if (length < 300) {
      return 5; // Средняя сложность
    } else if (length < 600) {
      return 7; // Сложная задача
    } else {
      return 10; // Очень сложная задача
    }
  }
}

module.exports = TaskPrioritizer;
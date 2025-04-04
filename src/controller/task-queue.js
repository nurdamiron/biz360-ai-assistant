// src/controller/task-queue.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');

/**
 * Класс для управления очередью задач системы
 */
class TaskQueue {
  constructor() {
    // Инициализация таблицы очереди при создании экземпляра
    this.initializeQueue().catch(error => {
      logger.error('Ошибка при инициализации очереди задач:', error);
    });
  }

  /**
   * Инициализирует таблицу очереди задач, если она не существует
   * @returns {Promise<void>}
   */
  async initializeQueue() {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем, существует ли таблица
      const [tables] = await connection.query(
        'SHOW TABLES LIKE "task_queue"'
      );
      
      if (tables.length === 0) {
        // Таблица не существует, создаем её
        await connection.query(`
          CREATE TABLE task_queue (
            id INT PRIMARY KEY AUTO_INCREMENT,
            type VARCHAR(50) NOT NULL,
            data JSON NOT NULL,
            priority INT DEFAULT 5,
            status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL
          )
        `);
        
        logger.info('Таблица очереди задач успешно создана');
      }
      
      connection.release();
    } catch (error) {
      logger.error('Ошибка при инициализации таблицы очереди задач:', error);
      throw error;
    }
  }

  /**
   * Добавляет задачу в очередь
   * @param {string} type - Тип задачи
   * @param {Object} data - Данные задачи
   * @param {number} priority - Приоритет (1-10)
   * @returns {Promise<Object>} - Добавленная задача
   */
  async addTask(type, data, priority = 5) {
    try {
      const connection = await pool.getConnection();
      
      const [result] = await connection.query(
        'INSERT INTO task_queue (type, data, priority) VALUES (?, ?, ?)',
        [type, JSON.stringify(data), priority]
      );
      
      // Получаем созданную задачу
      const [tasks] = await connection.query(
        'SELECT * FROM task_queue WHERE id = ?',
        [result.insertId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error('Не удалось получить созданную задачу');
      }
      
      // Преобразуем data из строки JSON в объект
      const task = tasks[0];
      task.data = JSON.parse(task.data);
      
      logger.info(`Задача типа "${type}" добавлена в очередь с id=${task.id}`);
      
      return task;
    } catch (error) {
      logger.error(`Ошибка при добавлении задачи типа "${type}" в очередь:`, error);
      throw error;
    }
  }

  /**
   * Получает следующую задачу из очереди
   * @returns {Promise<Object|null>} - Следующая задача или null, если очередь пуста
   */
  async getNextTask() {
    try {
      const connection = await pool.getConnection();
      
      // Начинаем транзакцию
      await connection.beginTransaction();
      
      try {
        // Находим следующую задачу с наивысшим приоритетом
        const [tasks] = await connection.query(
          `SELECT * FROM task_queue 
           WHERE status = 'pending' 
           ORDER BY priority DESC, created_at ASC 
           LIMIT 1`
        );
        
        if (tasks.length === 0) {
          // Очередь пуста
          await connection.commit();
          connection.release();
          return null;
        }
        
        const task = tasks[0];
        
        // Обновляем статус задачи
        await connection.query(
          "UPDATE task_queue SET status = 'processing', updated_at = NOW() WHERE id = ?",
          [task.id]
        );
        
        // Завершаем транзакцию
        await connection.commit();
        
        // Преобразуем data из строки JSON в объект
        task.data = JSON.parse(task.data);
        
        connection.release();
        
        logger.info(`Получена следующая задача из очереди: ${task.id} (${task.type})`);
        
        return task;
      } catch (error) {
        // В случае ошибки откатываем транзакцию
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error('Ошибка при получении следующей задачи из очереди:', error);
      return null;
    }
  }

  /**
   * Помечает задачу как выполненную
   * @param {number} taskId - ID задачи
   * @returns {Promise<boolean>} - Результат операции
   */
  async completeTask(taskId) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        "UPDATE task_queue SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?",
        [taskId]
      );
      
      connection.release();
      
      logger.info(`Задача #${taskId} помечена как выполненная`);
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при пометке задачи #${taskId} как выполненной:`, error);
      return false;
    }
  }

  /**
   * Помечает задачу как неудачную
   * @param {number} taskId - ID задачи
   * @param {string} errorMessage - Сообщение об ошибке
   * @returns {Promise<boolean>} - Результат операции
   */
  async failTask(taskId, errorMessage) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        "UPDATE task_queue SET status = 'failed', updated_at = NOW() WHERE id = ?",
        [taskId]
      );
      
      // Можно также сохранить сообщение об ошибке, если нужно
      
      connection.release();
      
      logger.warn(`Задача #${taskId} помечена как неудачная: ${errorMessage}`);
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при пометке задачи #${taskId} как неудачной:`, error);
      return false;
    }
  }

  /**
   * Получает статистику по задачам в очереди
   * @returns {Promise<Object>} - Статистика
   */
  async getQueueStats() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем количество задач по статусам
      const [stats] = await connection.query(
        `SELECT status, COUNT(*) as count FROM task_queue GROUP BY status`
      );
      
      // Получаем количество задач по типам
      const [typeStats] = await connection.query(
        `SELECT type, COUNT(*) as count FROM task_queue GROUP BY type`
      );
      
      connection.release();
      
      // Формируем объект статистики
      const result = {
        statuses: {},
        types: {}
      };
      
      // Заполняем статистику по статусам
      for (const row of stats) {
        result.statuses[row.status] = row.count;
      }
      
      // Заполняем статистику по типам
      for (const row of typeStats) {
        result.types[row.type] = row.count;
      }
      
      return result;
    } catch (error) {
      logger.error('Ошибка при получении статистики очереди:', error);
      throw error;
    }
  }

  /**
   * Получает список задач в очереди
   * @param {string} status - Статус для фильтрации (опционально)
   * @param {number} limit - Максимальное количество задач
   * @param {number} offset - Смещение для пагинации
   * @returns {Promise<Array>} - Список задач
   */
  async getTasks(status = null, limit = 10, offset = 0) {
    try {
      const connection = await pool.getConnection();
      
      let query = 'SELECT * FROM task_queue';
      const params = [];
      
      if (status) {
        query += ' WHERE status = ?';
        params.push(status);
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const [tasks] = await connection.query(query, params);
      
      connection.release();
      
      // Преобразуем data из строки JSON в объект для каждой задачи
      return tasks.map(task => ({
        ...task,
        data: JSON.parse(task.data)
      }));
    } catch (error) {
      logger.error('Ошибка при получении списка задач из очереди:', error);
      throw error;
    }
  }
}

module.exports = TaskQueue;
// src/core/task-planner/index.js

const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const TaskDecomposer = require('./decomposer');
const TaskPrioritizer = require('./prioritizer');

/**
 * Класс для планирования и декомпозиции задач
 */
class TaskPlanner {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.decomposer = new TaskDecomposer(projectId);
    this.prioritizer = new TaskPrioritizer();
  }

  /**
   * Получает информацию о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Информация о задаче
   */
  async getTaskInfo(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ? AND project_id = ?',
        [taskId, this.projectId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      return tasks[0];
    } catch (error) {
      logger.error('Ошибка при получении информации о задаче:', error);
      throw error;
    }
  }

  /**
   * Декомпозирует высокоуровневую задачу на подзадачи
   * @param {number} taskId - ID высокоуровневой задачи
   * @returns {Promise<Array>} - Массив созданных подзадач
   */
  async decomposeTask(taskId) {
    try {
      logger.info(`Начинаем декомпозицию задачи #${taskId}`);
      
      // Получаем информацию о задаче
      const task = await this.getTaskInfo(taskId);
      
      // Проверяем статус задачи
      if (task.status !== 'pending') {
        throw new Error(`Невозможно декомпозировать задачу со статусом "${task.status}"`);
      }
      
      // Декомпозируем задачу на подзадачи
      const subtasks = await this.decomposer.decompose(task);
      
      if (!subtasks || subtasks.length === 0) {
        throw new Error('Не удалось декомпозировать задачу на подзадачи');
      }
      
      // Сохраняем подзадачи в БД
      const savedSubtasks = await this.saveSubtasks(taskId, subtasks);
      
      // Обновляем статус основной задачи
      await this.updateTaskStatus(taskId, 'in_progress');
      
      logger.info(`Задача #${taskId} успешно декомпозирована на ${savedSubtasks.length} подзадач`);
      
      return savedSubtasks;
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Сохраняет подзадачи в базе данных
   * @param {number} parentTaskId - ID родительской задачи
   * @param {Array} subtasks - Массив подзадач для сохранения
   * @returns {Promise<Array>} - Массив сохраненных подзадач с ID
   */
  async saveSubtasks(parentTaskId, subtasks) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const savedSubtasks = [];
      
      // Сохраняем каждую подзадачу
      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];
        
        const [result] = await connection.query(
          `INSERT INTO subtasks 
           (task_id, title, description, status, sequence_number) 
           VALUES (?, ?, ?, ?, ?)`,
          [parentTaskId, subtask.title, subtask.description, 'pending', i + 1]
        );
        
        savedSubtasks.push({
          id: result.insertId,
          task_id: parentTaskId,
          title: subtask.title,
          description: subtask.description,
          status: 'pending',
          sequence_number: i + 1
        });
      }
      
      await connection.commit();
      
      return savedSubtasks;
    } catch (error) {
      await connection.rollback();
      logger.error('Ошибка при сохранении подзадач:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Обновляет статус задачи
   * @param {number} taskId - ID задачи
   * @param {string} status - Новый статус
   * @returns {Promise<void>}
   */
  async updateTaskStatus(taskId, status) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, taskId]
      );
      
      if (status === 'completed') {
        await connection.query(
          'UPDATE tasks SET completed_at = NOW() WHERE id = ?',
          [taskId]
        );
      }
      
      connection.release();
      
      logger.info(`Статус задачи #${taskId} обновлен на "${status}"`);
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает список всех подзадач для задачи
   * @param {number} taskId - ID родительской задачи
   * @returns {Promise<Array>} - Список подзадач
   */
  async getSubtasks(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      connection.release();
      
      return subtasks;
    } catch (error) {
      logger.error(`Ошибка при получении подзадач для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает следующую подзадачу для выполнения
   * @param {number} taskId - ID родительской задачи
   * @returns {Promise<Object|null>} - Следующая подзадача или null, если все выполнены
   */
  async getNextSubtask(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? AND status = "pending" ORDER BY sequence_number LIMIT 1',
        [taskId]
      );
      
      connection.release();
      
      return subtasks.length > 0 ? subtasks[0] : null;
    } catch (error) {
      logger.error(`Ошибка при получении следующей подзадачи для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Обновляет статус подзадачи
   * @param {number} subtaskId - ID подзадачи
   * @param {string} status - Новый статус
   * @returns {Promise<void>}
   */
  async updateSubtaskStatus(subtaskId, status) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'UPDATE subtasks SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, subtaskId]
      );
      
      if (status === 'completed') {
        await connection.query(
          'UPDATE subtasks SET completed_at = NOW() WHERE id = ?',
          [subtaskId]
        );
        
        // Проверяем, все ли подзадачи выполнены
        const [subtask] = await connection.query(
          'SELECT task_id FROM subtasks WHERE id = ?',
          [subtaskId]
        );
        
        if (subtask.length > 0) {
          const taskId = subtask[0].task_id;
          
          const [pendingSubtasks] = await connection.query(
            'SELECT COUNT(*) as count FROM subtasks WHERE task_id = ? AND status != "completed"',
            [taskId]
          );
          
          // Если все подзадачи выполнены, обновляем статус родительской задачи
          if (pendingSubtasks[0].count === 0) {
            await this.updateTaskStatus(taskId, 'completed');
          }
        }
      }
      
      connection.release();
      
      logger.info(`Статус подзадачи #${subtaskId} обновлен на "${status}"`);
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса подзадачи #${subtaskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает список задач с высоким приоритетом для выполнения
   * @param {number} limit - Максимальное количество задач
   * @returns {Promise<Array>} - Список приоритетных задач
   */
  async getPriorityTasks(limit = 5) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем все активные задачи
      const [tasks] = await connection.query(
        `SELECT * FROM tasks 
         WHERE project_id = ? AND status IN ('pending', 'in_progress') 
         ORDER BY priority DESC, created_at ASC`,
        [this.projectId]
      );
      
      connection.release();
      
      // Если задач нет, возвращаем пустой массив
      if (tasks.length === 0) {
        return [];
      }
      
      // Приоритизируем задачи с учетом различных факторов
      const prioritizedTasks = await this.prioritizer.prioritize(tasks);
      
      // Возвращаем ограниченное количество задач
      return prioritizedTasks.slice(0, limit);
    } catch (error) {
      logger.error('Ошибка при получении приоритетных задач:', error);
      throw error;
    }
  }

  /**
   * Создает новую задачу
   * @param {Object} taskData - Данные для создания задачи
   * @returns {Promise<Object>} - Созданная задача
   */
  async createTask(taskData) {
    try {
      // Проверяем обязательные поля
      if (!taskData.title || !taskData.description) {
        throw new Error('Необходимо указать заголовок и описание задачи');
      }
      
      const connection = await pool.getConnection();
      
      // Вставляем задачу в БД
      const [result] = await connection.query(
        `INSERT INTO tasks 
         (project_id, title, description, status, priority, parent_task_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          this.projectId,
          taskData.title,
          taskData.description,
          taskData.status || 'pending',
          taskData.priority || 'medium',
          taskData.parent_task_id || null
        ]
      );
      
      // Получаем созданную задачу
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [result.insertId]
      );
      
      connection.release();
      
      logger.info(`Создана новая задача #${result.insertId}: ${taskData.title}`);
      
      return tasks[0];
    } catch (error) {
      logger.error('Ошибка при создании задачи:', error);
      throw error;
    }
  }
}

module.exports = TaskPlanner;
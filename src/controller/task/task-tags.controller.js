// src/controller/task/task-tags.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');

/**
 * Контроллер для управления тегами задач
 */
const taskTagsController = {
  /**
   * Добавить теги к задаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async addTaskTags(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать массив тегов' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Получаем текущие теги задачи
        const [currentTags] = await connection.query(
          'SELECT tag_name FROM task_tags WHERE task_id = ?',
          [taskId]
        );
        
        const currentTagNames = currentTags.map(tag => tag.tag_name);
        
        // Добавляем только новые теги
        for (const tag of tags) {
          // Пропускаем, если тег уже есть у задачи
          if (currentTagNames.includes(tag)) {
            continue;
          }
          
          // Проверяем существование тега
          const [existingTags] = await connection.query(
            'SELECT name FROM tags WHERE name = ?',
            [tag]
          );
          
          // Если тег не существует, создаем его
          if (existingTags.length === 0) {
            await connection.query(
              'INSERT INTO tags (name) VALUES (?)',
              [tag]
            );
          }
          
          // Добавляем связь тега с задачей
          await connection.query(
            'INSERT INTO task_tags (task_id, tag_name) VALUES (?, ?)',
            [taskId, tag]
          );
        }
        
        // Логируем добавление тегов
        await taskLogger.logInfo(taskId, `Добавлены теги: ${tags.join(', ')}`);
        
        // Получаем обновленные теги задачи
        const [taskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color, t.description
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [taskId]
        );
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_tags_updated',
            taskId,
            tags: taskTags
          });
        }
        
        res.json({
          success: true,
          message: 'Теги успешно добавлены',
          tags: taskTags
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при добавлении тегов к задаче #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при добавлении тегов к задаче' });
    }
  },

  /**
   * Удалить теги у задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async removeTaskTags(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать массив тегов' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Удаляем указанные теги
        for (const tag of tags) {
          await connection.query(
            'DELETE FROM task_tags WHERE task_id = ? AND tag_name = ?',
            [taskId, tag]
          );
        }
        
        // Логируем удаление тегов
        await taskLogger.logInfo(taskId, `Удалены теги: ${tags.join(', ')}`);
        
        // Получаем оставшиеся теги задачи
        const [taskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color, t.description
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [taskId]
        );
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_tags_updated',
            taskId,
            tags: taskTags
          });
        }
        
        res.json({
          success: true,
          message: 'Теги успешно удалены',
          tags: taskTags
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при удалении тегов у задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении тегов у задачи' });
    }
  },
  
  /**
   * Получить все доступные теги системы
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getAllTags(req, res) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем все теги с информацией об использовании
      const [tags] = await connection.query(`
        SELECT 
          t.name,
          t.color,
          t.description,
          t.created_at,
          COUNT(tt.task_id) as usage_count
        FROM tags t
        LEFT JOIN task_tags tt ON t.name = tt.tag_name
        GROUP BY t.name
        ORDER BY usage_count DESC, t.name ASC
      `);
      
      connection.release();
      
      res.json(tags);
    } catch (error) {
      logger.error('Ошибка при получении списка тегов:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении списка тегов' });
    }
  },
  
  /**
   * Получить популярные теги
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getPopularTags(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 10;
      const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
      
      const connection = await pool.getConnection();
      
      // Формируем запрос для получения популярных тегов
      let query = `
        SELECT 
          tt.tag_name as name,
          t.color,
          t.description,
          COUNT(tt.task_id) as usage_count
        FROM task_tags tt
        JOIN tags t ON tt.tag_name = t.name
      `;
      
      const params = [];
      
      // Если указан проект, фильтруем теги по нему
      if (projectId) {
        query += ' JOIN tasks task ON tt.task_id = task.id WHERE task.project_id = ?';
        params.push(projectId);
      }
      
      query += ' GROUP BY tt.tag_name ORDER BY usage_count DESC, tt.tag_name ASC LIMIT ?';
      params.push(limit);
      
      const [tags] = await connection.query(query, params);
      
      connection.release();
      
      res.json(tags);
    } catch (error) {
      logger.error('Ошибка при получении популярных тегов:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении популярных тегов' });
    }
  },
  
  /**
   * Получить теги задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskTags(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT id FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        `SELECT tt.tag_name as name, t.color, t.description
         FROM task_tags tt
         LEFT JOIN tags t ON tt.tag_name = t.name
         WHERE tt.task_id = ?`,
        [taskId]
      );
      
      connection.release();
      
      res.json(taskTags);
    } catch (error) {
      logger.error(`Ошибка при получении тегов задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении тегов задачи' });
    }
  }
};

module.exports = taskTagsController;
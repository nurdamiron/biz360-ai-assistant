// src/controller/task/task-assignment.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');

/**
 * Контроллер для назначения задач исполнителям
 */
const taskAssignmentController = {
  /**
   * Назначить задачу пользователю
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async assignTask(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { userId } = req.body;
      
      if (userId === undefined) {
        return res.status(400).json({ error: 'Необходимо указать userId' });
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
      
      // Если userId === null, то снимаем назначение
      if (userId === null) {
        await connection.query(
          'UPDATE tasks SET assigned_to = NULL, updated_at = NOW() WHERE id = ?',
          [taskId]
        );
        
        // Логируем снятие назначения
        await taskLogger.logInfo(taskId, 'Задача снята с исполнителя');
      } else {
        // Проверяем существование пользователя
        const [users] = await connection.query(
          'SELECT * FROM users WHERE id = ?',
          [userId]
        );
        
        if (users.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Обновляем задачу
        await connection.query(
          'UPDATE tasks SET assigned_to = ?, updated_at = NOW() WHERE id = ?',
          [userId, taskId]
        );
        
        // Логируем назначение
        await taskLogger.logInfo(taskId, `Задача назначена пользователю ${users[0].username}`);
      }
      
      // Получаем обновленную задачу
      const [updatedTasks] = await connection.query(
        `SELECT t.*, u.username as assignee_name, p.name as project_name
         FROM tasks t
         LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.id = ?`,
        [taskId]
      );
      
      connection.release();
      
      const updatedTask = updatedTasks[0];
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_assigned',
          task: updatedTask
        });
        
        wsServer.notifySubscribers('project', updatedTask.project_id, {
          type: 'task_assigned',
          task: updatedTask
        });
        
        // Если задача назначена пользователю, отправляем ему уведомление
        if (userId) {
          wsServer.notifySubscribers('user', userId, {
            type: 'task_assigned_to_you',
            task: updatedTask
          });
        }
      }
      
      res.json(updatedTask);
    } catch (error) {
      logger.error(`Ошибка при назначении задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при назначении задачи' });
    }
  },
  
  /**
   * Получить список пользователей для назначения задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getAssignableUsers(req, res) {
    try {
      const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
      
      const connection = await pool.getConnection();
      
      let query = `
        SELECT 
          u.id,
          u.username,
          u.email,
          u.role,
          COUNT(t.id) as assigned_tasks_count
        FROM users u
        LEFT JOIN tasks t ON u.id = t.assigned_to AND t.status != 'completed'
      `;
      
      const params = [];
      
      // Если указан проект, дополнительно фильтруем по проекту
      if (projectId) {
        // Проверяем существование проекта
        const [projects] = await connection.query(
          'SELECT id FROM projects WHERE id = ?',
          [projectId]
        );
        
        if (projects.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Проект не найден' });
        }
        
        // Фильтруем по связи с проектом
        // В реальном проекте тут может быть связь с участниками проекта
      }
      
      query += ' GROUP BY u.id ORDER BY u.username';
      
      const [users] = await connection.query(query, params);
      
      connection.release();
      
      res.json(users);
    } catch (error) {
      logger.error('Ошибка при получении списка пользователей для назначения задачи:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении списка пользователей' });
    }
  },
  
  /**
   * Автоматическое назначение задачи оптимальному исполнителю
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async autoAssignTask(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
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
      
      const task = tasks[0];
      
      // Находим подходящего исполнителя
      // 1. Получаем исполнителей, которые уже работали с подобными задачами (по тегам)
      // 2. Оцениваем текущую загруженность исполнителей
      // 3. Выбираем наименее загруженного исполнителя с опытом в данной области
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      let bestUserId = null;
      
      if (tags.length > 0) {
        // Находим пользователей, работавших с задачами с похожими тегами
        const [usersByTags] = await connection.query(`
          SELECT 
            u.id,
            u.username,
            COUNT(DISTINCT t.id) as similar_tasks_count,
            COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id ELSE NULL END) as completed_similar_tasks,
            COUNT(DISTINCT CASE WHEN t.status != 'completed' THEN t.id ELSE NULL END) as active_tasks
          FROM users u
          JOIN tasks t ON u.id = t.assigned_to
          JOIN task_tags tt ON t.id = tt.task_id
          WHERE tt.tag_name IN (?)
          GROUP BY u.id
          ORDER BY completed_similar_tasks DESC, active_tasks ASC
          LIMIT 1
        `, [tags]);
        
        if (usersByTags.length > 0) {
          bestUserId = usersByTags[0].id;
        }
      }
      
      // Если не нашли по тегам, выбираем наименее загруженного пользователя
      if (!bestUserId) {
        const [leastBusyUser] = await connection.query(`
          SELECT 
            u.id,
            u.username,
            COUNT(t.id) as active_tasks
          FROM users u
          LEFT JOIN tasks t ON u.id = t.assigned_to AND t.status != 'completed'
          WHERE u.active = 1 AND u.role != 'admin'
          GROUP BY u.id
          ORDER BY active_tasks ASC
          LIMIT 1
        `);
        
        if (leastBusyUser.length > 0) {
          bestUserId = leastBusyUser[0].id;
        }
      }
      
      // Если не нашли подходящего исполнителя, возвращаем ошибку
      if (!bestUserId) {
        connection.release();
        return res.status(400).json({ error: 'Не удалось найти подходящего исполнителя' });
      }
      
      // Назначаем задачу выбранному исполнителю
      await connection.query(
        'UPDATE tasks SET assigned_to = ?, updated_at = NOW() WHERE id = ?',
        [bestUserId, taskId]
      );
      
      // Получаем информацию о пользователе
      const [users] = await connection.query(
        'SELECT username FROM users WHERE id = ?',
        [bestUserId]
      );
      
      // Логируем назначение
      await taskLogger.logInfo(taskId, `Задача автоматически назначена пользователю ${users[0].username}`);
      
      // Получаем обновленную задачу
      const [updatedTasks] = await connection.query(
        `SELECT t.*, u.username as assignee_name, p.name as project_name
         FROM tasks t
         LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.id = ?`,
        [taskId]
      );
      
      connection.release();
      
      const updatedTask = updatedTasks[0];
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_assigned',
          task: updatedTask,
          auto_assigned: true
        });
        
        wsServer.notifySubscribers('project', updatedTask.project_id, {
          type: 'task_assigned',
          task: updatedTask,
          auto_assigned: true
        });
        
        // Отправляем уведомление назначенному пользователю
        wsServer.notifySubscribers('user', bestUserId, {
          type: 'task_assigned_to_you',
          task: updatedTask,
          auto_assigned: true
        });
      }
      
      res.json({
        success: true,
        message: `Задача автоматически назначена пользователю ${users[0].username}`,
        task: updatedTask
      });
    } catch (error) {
      logger.error(`Ошибка при автоматическом назначении задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при автоматическом назначении задачи' });
    }
  },
  
  /**
   * Получить загруженность пользователей
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getUsersWorkload(req, res) {
    try {
      const connection = await pool.getConnection();
      
      const [usersWorkload] = await connection.query(`
        SELECT 
          u.id,
          u.username,
          u.role,
          COUNT(t.id) as total_tasks,
          SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending_tasks,
          SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
          SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) as blocked_tasks,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
        FROM users u
        LEFT JOIN tasks t ON u.id = t.assigned_to
        WHERE u.active = 1
        GROUP BY u.id
        ORDER BY pending_tasks + in_progress_tasks DESC
      `);
      
      connection.release();
      
      res.json(usersWorkload);
    } catch (error) {
      logger.error('Ошибка при получении загруженности пользователей:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении загруженности пользователей' });
    }
  }
};

module.exports = taskAssignmentController;
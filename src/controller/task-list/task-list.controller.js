// src/controller/task-list/task-list.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const websocket = require('../../websocket');

/**
 * Контроллер для управления списками задач (бэклоги, спринты и т.д.)
 */
const taskListController = {
  /**
   * Получить все списки задач проекта
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskLists(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT id FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Проект не найден' });
      }
      
      // Получаем списки задач проекта
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE project_id = ? 
         ORDER BY type, name`,
        [projectId]
      );
      
      // Для каждого списка получаем количество задач
      for (const list of taskLists) {
        const [countsResult] = await connection.query(
          `SELECT COUNT(*) as total_tasks
           FROM task_list_items
           WHERE task_list_id = ?`,
          [list.id]
        );
        
        list.task_count = countsResult[0].total_tasks;
      }
      
      connection.release();
      
      res.json(taskLists);
    } catch (error) {
      logger.error(`Ошибка при получении списков задач проекта #${req.params.projectId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении списков задач' });
    }
  },

  /**
   * Получить список задач по ID
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskListById(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      const taskList = taskLists[0];
      
      // Получаем задачи из списка с их информацией
      const [taskItems] = await connection.query(
        `SELECT 
          tli.id as item_id,
          tli.position,
          t.id as task_id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.progress,
          t.estimated_hours,
          t.actual_hours,
          t.due_date,
          t.created_at,
          t.updated_at,
          t.completed_at,
          u.username as assignee_name
        FROM task_list_items tli
        JOIN tasks t ON tli.task_id = t.id
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE tli.task_list_id = ?
        ORDER BY tli.position`,
        [listId]
      );
      
      connection.release();
      
      // Формируем полный ответ
      const response = {
        ...taskList,
        tasks: taskItems
      };
      
      res.json(response);
    } catch (error) {
      logger.error(`Ошибка при получении списка задач #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении списка задач' });
    }
  },

  /**
   * Создать новый список задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createTaskList(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { name, description, type, start_date, end_date } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Необходимо указать название списка задач' });
      }
      
      // Валидация типа списка
      const validTypes = ['backlog', 'sprint', 'custom'];
      if (type && !validTypes.includes(type)) {
        return res.status(400).json({ 
          error: `Недопустимый тип списка. Разрешены: ${validTypes.join(', ')}` 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT id FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Проект не найден' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Проверяем уникальность имени списка в рамках проекта
        const [existingLists] = await connection.query(
          'SELECT id FROM task_lists WHERE project_id = ? AND name = ?',
          [projectId, name]
        );
        
        if (existingLists.length > 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ error: 'Список задач с таким названием уже существует в этом проекте' });
        }
        
        // Создаем новый список задач
        const [result] = await connection.query(
          `INSERT INTO task_lists 
           (project_id, name, description, type, start_date, end_date) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            projectId, 
            name, 
            description || null, 
            type || 'custom',
            start_date || null,
            end_date || null
          ]
        );
        
        // Получаем созданный список
        const [taskLists] = await connection.query(
          'SELECT * FROM task_lists WHERE id = ?',
          [result.insertId]
        );
        
        await connection.commit();
        
        const taskList = taskLists[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('project', projectId, {
            type: 'task_list_created',
            taskList
          });
        }
        
        connection.release();
        
        res.status(201).json(taskList);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при создании списка задач для проекта #${req.params.projectId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при создании списка задач' });
    }
  },

  /**
   * Обновить список задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateTaskList(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      const { name, description, type, start_date, end_date } = req.body;
      
      // Проверяем, что хотя бы одно поле для обновления указано
      if (!name && !description && !type && start_date === undefined && end_date === undefined) {
        return res.status(400).json({ error: 'Необходимо указать хотя бы одно поле для обновления' });
      }
      
      // Валидация типа списка
      const validTypes = ['backlog', 'sprint', 'custom'];
      if (type && !validTypes.includes(type)) {
        return res.status(400).json({ 
          error: `Недопустимый тип списка. Разрешены: ${validTypes.join(', ')}` 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Проверяем уникальность имени списка в рамках проекта
        if (name && name !== taskLists[0].name) {
          const [existingLists] = await connection.query(
            'SELECT id FROM task_lists WHERE project_id = ? AND name = ? AND id != ?',
            [projectId, name, listId]
          );
          
          if (existingLists.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ error: 'Список задач с таким названием уже существует в этом проекте' });
          }
        }
        
        // Формируем запрос на обновление
        const updateFields = [];
        const params = [];
        
        if (name !== undefined) {
          updateFields.push('name = ?');
          params.push(name);
        }
        
        if (description !== undefined) {
          updateFields.push('description = ?');
          params.push(description);
        }
        
        if (type !== undefined) {
          updateFields.push('type = ?');
          params.push(type);
        }
        
        if (start_date !== undefined) {
          updateFields.push('start_date = ?');
          params.push(start_date);
        }
        
        if (end_date !== undefined) {
          updateFields.push('end_date = ?');
          params.push(end_date);
        }
        
        if (updateFields.length === 0) {
          // Нечего обновлять
          await connection.rollback();
          connection.release();
          return res.status(400).json({ error: 'Нет данных для обновления' });
        }
        
        // Обновляем список задач
        await connection.query(
          `UPDATE task_lists 
           SET ${updateFields.join(', ')} 
           WHERE id = ?`,
          [...params, listId]
        );
        
        // Получаем обновленный список
        const [updatedLists] = await connection.query(
          'SELECT * FROM task_lists WHERE id = ?',
          [listId]
        );
        
        await connection.commit();
        
        const updatedList = updatedLists[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('project', projectId, {
            type: 'task_list_updated',
            taskList: updatedList
          });
        }
        
        connection.release();
        
        res.json(updatedList);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при обновлении списка задач #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении списка задач' });
    }
  },

  /**
   * Удалить список задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteTaskList(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      // Удаляем список задач (каскадно удаляются связи с задачами)
      await connection.query(
        'DELETE FROM task_lists WHERE id = ?',
        [listId]
      );
      
      connection.release();
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('project', projectId, {
          type: 'task_list_deleted',
          listId,
          listName: taskLists[0].name
        });
      }
      
      res.json({
        success: true,
        message: 'Список задач успешно удален'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении списка задач #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении списка задач' });
    }
  },

  /**
   * Добавить задачи в список
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async addTasksToList(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      const { task_ids } = req.body;
      
      if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать массив ID задач' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Проверяем существование всех задач и принадлежность их к проекту
        const placeHolders = task_ids.map(() => '?').join(',');
        const [tasksResult] = await connection.query(
          `SELECT id FROM tasks 
           WHERE id IN (${placeHolders}) AND project_id = ?`,
          [...task_ids, projectId]
        );
        
        if (tasksResult.length !== task_ids.length) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            error: 'Некоторые задачи не найдены или не принадлежат указанному проекту' 
          });
        }
        
        // Получаем текущее максимальное значение position
        const [maxPosition] = await connection.query(
          'SELECT MAX(position) as max_position FROM task_list_items WHERE task_list_id = ?',
          [listId]
        );
        
        let position = maxPosition[0].max_position || 0;
        
        // Добавляем задачи в список
        for (const taskId of task_ids) {
          // Проверяем, нет ли уже этой задачи в списке
          const [existingItems] = await connection.query(
            'SELECT id FROM task_list_items WHERE task_list_id = ? AND task_id = ?',
            [listId, taskId]
          );
          
          if (existingItems.length === 0) {
            // Задачи нет в списке, добавляем
            position++;
            
            await connection.query(
              'INSERT INTO task_list_items (task_list_id, task_id, position) VALUES (?, ?, ?)',
              [listId, taskId, position]
            );
          }
        }
        
        // Получаем добавленные задачи
        const [taskItems] = await connection.query(
          `SELECT 
            tli.id as item_id,
            tli.position,
            t.id as task_id,
            t.title,
            t.description,
            t.status,
            t.priority,
            t.progress,
            t.due_date
          FROM task_list_items tli
          JOIN tasks t ON tli.task_id = t.id
          WHERE tli.task_list_id = ?
          ORDER BY tli.position`,
          [listId]
        );
        
        await connection.commit();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task_list', listId, {
            type: 'tasks_added_to_list',
            listId,
            addedTaskIds: task_ids,
            tasks: taskItems
          });
          
          wsServer.notifySubscribers('project', projectId, {
            type: 'task_list_updated',
            listId,
            taskCount: taskItems.length
          });
        }
        
        connection.release();
        
        res.json({
          success: true,
          message: 'Задачи успешно добавлены в список',
          tasks: taskItems
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при добавлении задач в список #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при добавлении задач в список' });
    }
  },

  /**
   * Удалить задачу из списка
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async removeTaskFromList(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      const taskId = parseInt(req.params.taskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      // Проверяем наличие задачи в списке
      const [taskItems] = await connection.query(
        'SELECT id FROM task_list_items WHERE task_list_id = ? AND task_id = ?',
        [listId, taskId]
      );
      
      if (taskItems.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена в указанном списке' });
      }
      
      // Удаляем задачу из списка
      await connection.query(
        'DELETE FROM task_list_items WHERE task_list_id = ? AND task_id = ?',
        [listId, taskId]
      );
      
      // Пересчитываем порядковые номера
      await connection.query(
        `SET @pos := 0;
         UPDATE task_list_items 
         SET position = (@pos := @pos + 1)
         WHERE task_list_id = ?
         ORDER BY position`,
        [listId]
      );
      
      connection.release();
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task_list', listId, {
          type: 'task_removed_from_list',
          listId,
          taskId
        });
        
        wsServer.notifySubscribers('project', projectId, {
          type: 'task_list_updated',
          listId
        });
      }
      
      res.json({
        success: true,
        message: 'Задача успешно удалена из списка'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении задачи #${req.params.taskId} из списка #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении задачи из списка' });
    }
  },

  /**
   * Изменить порядок задач в списке
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async reorderTasks(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const listId = parseInt(req.params.listId);
      const { task_ids } = req.body;
      
      if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать массив ID задач в новом порядке' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование списка задач
      const [taskLists] = await connection.query(
        `SELECT * FROM task_lists 
         WHERE id = ? AND project_id = ?`,
        [listId, projectId]
      );
      
      if (taskLists.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Список задач не найден' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Получаем существующие задачи в списке
        const [existingItems] = await connection.query(
          'SELECT task_id FROM task_list_items WHERE task_list_id = ?',
          [listId]
        );
        
        const existingTaskIds = existingItems.map(item => item.task_id);
        
        // Проверяем, что все задачи из запроса существуют в списке
        for (const taskId of task_ids) {
          if (!existingTaskIds.includes(taskId)) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ 
              error: `Задача с ID ${taskId} не найдена в указанном списке` 
            });
          }
        }
        
        // Проверяем, что в запросе указаны все задачи из списка
        if (task_ids.length !== existingTaskIds.length) {
          // Находим недостающие задачи
          const missingTaskIds = existingTaskIds.filter(id => !task_ids.includes(id));
          
          await connection.rollback();
          connection.release();
          return res.status(400).json({ 
            error: 'Должны быть указаны все задачи из списка',
            missing_task_ids: missingTaskIds
          });
        }
        
        // Обновляем порядок задач
        for (let i = 0; i < task_ids.length; i++) {
          await connection.query(
            'UPDATE task_list_items SET position = ? WHERE task_list_id = ? AND task_id = ?',
            [i + 1, listId, task_ids[i]]
          );
        }
        
        // Получаем обновленный список задач
        const [updatedItems] = await connection.query(
          `SELECT 
            tli.id as item_id,
            tli.position,
            t.id as task_id,
            t.title,
            t.status,
            t.priority,
            t.progress
          FROM task_list_items tli
          JOIN tasks t ON tli.task_id = t.id
          WHERE tli.task_list_id = ?
          ORDER BY tli.position`,
          [listId]
        );
        
        await connection.commit();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task_list', listId, {
            type: 'tasks_reordered',
            listId,
            taskOrder: task_ids
          });
        }
        
        connection.release();
        
        res.json({
          success: true,
          message: 'Порядок задач успешно обновлен',
          tasks: updatedItems
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при изменении порядка задач в списке #${req.params.listId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при изменении порядка задач' });
    }
  }
};

module.exports = taskListController;
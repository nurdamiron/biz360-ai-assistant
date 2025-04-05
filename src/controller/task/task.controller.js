// src/controller/task/task.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');
const notificationManager = require('../../utils/notification-manager');

/**
 * Контроллер для базовых CRUD операций с задачами
 */
const taskController = {
  /**
   * Получить задачу по ID с полной информацией
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskById(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const connection = await pool.getConnection();
      
      // Получаем основную информацию о задаче
      const [tasks] = await connection.query(
        `SELECT t.*, u.username as assignee_name, p.name as project_name
         FROM tasks t
         LEFT JOIN users u ON t.assigned_to = u.id
         LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.id = ?`,
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const task = tasks[0];
      
      // Получаем подзадачи
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        `SELECT tt.tag_name as name, t.color, t.description
         FROM task_tags tt
         LEFT JOIN tags t ON tt.tag_name = t.name
         WHERE tt.task_id = ?`,
        [taskId]
      );
      
      // Получаем последние логи задачи
      const [taskLogs] = await connection.query(
        `SELECT * FROM task_logs 
         WHERE task_id = ? 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [taskId]
      );
      
      // Получаем сгенерированный код, если есть
      const [codeGenerations] = await connection.query(
        `SELECT * FROM code_generations 
         WHERE task_id = ?
         ORDER BY created_at DESC`,
        [taskId]
      );
      
      // Формируем полный ответ
      const response = {
        ...task,
        subtasks,
        tags: taskTags,
        logs: taskLogs,
        code_generations: codeGenerations
      };
      
      connection.release();
      
      res.json(response);
    } catch (error) {
      logger.error(`Ошибка при получении задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении задачи' });
    }
  },

  /**
   * Создать новую задачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createTask(req, res) {
    try {
      const { 
        project_id, 
        title, 
        description, 
        priority = 'medium', 
        parent_task_id,
        assigned_to,
        tags = []
      } = req.body;
      
      // Проверяем обязательные поля
      if (!project_id || !title || !description) {
        return res.status(400).json({ 
          error: 'Необходимо указать project_id, title и description' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT id FROM projects WHERE id = ?',
        [project_id]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Проект не найден' });
      }
      
      // Проверяем существование родительской задачи, если указана
      if (parent_task_id) {
        const [parentTasks] = await connection.query(
          'SELECT id FROM tasks WHERE id = ?',
          [parent_task_id]
        );
        
        if (parentTasks.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Родительская задача не найдена' });
        }
      }
      
      // Проверяем существование пользователя, если указан
      if (assigned_to) {
        const [users] = await connection.query(
          'SELECT id FROM users WHERE id = ?',
          [assigned_to]
        );
        
        if (users.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Пользователь не найден' });
        }
      }
      
      await connection.beginTransaction();
      
      try {
        // Создаем новую задачу
        const [result] = await connection.query(
          `INSERT INTO tasks 
           (project_id, title, description, status, priority, parent_task_id, assigned_to) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            project_id,
            title,
            description,
            'pending',
            priority,
            parent_task_id || null,
            assigned_to || null
          ]
        );
        
        const taskId = result.insertId;
        
        // Добавляем теги, если они указаны
        if (tags.length > 0) {
          for (const tag of tags) {
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
        }
        
        // Логируем создание задачи
        await taskLogger.logInfo(taskId, 'Задача создана');
        
        // Получаем созданную задачу
        const [tasks] = await connection.query(
          `SELECT t.*, u.username as assignee_name, p.name as project_name
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           LEFT JOIN projects p ON t.project_id = p.id
           WHERE t.id = ?`,
          [taskId]
        );
        
        // Получаем теги задачи
        const [taskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color, t.description
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [taskId]
        );
        
        const newTask = tasks[0];
        newTask.tags = taskTags;
        
        await connection.commit();
        connection.release();
        
        if (newTask.assigned_to) {
          await notificationManager.sendNotification({
            type: 'task_assigned',
            userId: newTask.assigned_to,
            title: 'Вам назначена новая задача',
            message: `Вам назначена новая задача "${newTask.title}".`,
            projectId: newTask.project_id,
            taskId: newTask.id,
            data: {
              taskId: newTask.id,
              taskTitle: newTask.title,
              taskDescription: newTask.description,
              taskPriority: newTask.priority,
              taskDueDate: newTask.due_date,
              createdBy: req.user.username
            }
          });
        }
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('project', project_id, {
            type: 'task_created',
            task: newTask
          });
        }
        
        // Возвращаем результат
        res.status(201).json(newTask);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error('Ошибка при создании задачи:', error);
      res.status(500).json({ error: 'Ошибка сервера при создании задачи' });
    }
  },

  /**
   * Обновить существующую задачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateTask(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { 
        title, 
        description, 
        status, 
        priority, 
        assigned_to,
        tags
      } = req.body;
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [existingTasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (existingTasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const existingTask = existingTasks[0];
      
      // Проверяем существование пользователя, если указан
      if (assigned_to) {
        const [users] = await connection.query(
          'SELECT id FROM users WHERE id = ?',
          [assigned_to]
        );
        
        if (users.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Пользователь не найден' });
        }
      }
      
      await connection.beginTransaction();
      
      try {
        // Формируем поля для обновления
        const updateFields = [];
        const params = [];
        
        if (title !== undefined) {
          updateFields.push('title = ?');
          params.push(title);
        }
        
        if (description !== undefined) {
          updateFields.push('description = ?');
          params.push(description);
        }
        
        if (status !== undefined) {
          updateFields.push('status = ?');
          params.push(status);
          
          // Если статус изменился на "completed", устанавливаем completed_at
          if (status === 'completed' && existingTask.status !== 'completed') {
            updateFields.push('completed_at = NOW()');
          }
          
          // Если статус изменился с "completed", сбрасываем completed_at
          if (status !== 'completed' && existingTask.status === 'completed') {
            updateFields.push('completed_at = NULL');
          }
        }
        
        if (priority !== undefined) {
          updateFields.push('priority = ?');
          params.push(priority);
        }
        
        if (assigned_to !== undefined) {
          updateFields.push('assigned_to = ?');
          params.push(assigned_to);
        }
        
        // Если есть поля для обновления
        if (updateFields.length > 0) {
          updateFields.push('updated_at = NOW()');
          
          // Создаем запрос на обновление
          const updateQuery = `
            UPDATE tasks 
            SET ${updateFields.join(', ')} 
            WHERE id = ?
          `;
          
          params.push(taskId);
          
          // Выполняем запрос
          await connection.query(updateQuery, params);
          
          // Логируем обновление
          await taskLogger.logInfo(taskId, `Задача обновлена: ${updateFields.join(', ')}`);
          
          // Если статус изменился на "completed", отмечаем время выполнения
          if (status === 'completed' && existingTask.status !== 'completed') {
            await taskLogger.logProgress(taskId, 'Задача выполнена', 100);
          }
        }
        
        // Обновляем теги, если они указаны
        if (tags !== undefined) {
          // Удаляем существующие теги
          await connection.query(
            'DELETE FROM task_tags WHERE task_id = ?',
            [taskId]
          );
          
          // Добавляем новые теги
          if (tags.length > 0) {
            for (const tag of tags) {
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
          }
        }
        
        // Получаем обновленную задачу
        const [tasks] = await connection.query(
          `SELECT t.*, u.username as assignee_name, p.name as project_name
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           LEFT JOIN projects p ON t.project_id = p.id
           WHERE t.id = ?`,
          [taskId]
        );
        
        // Получаем теги задачи
        const [taskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color, t.description
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [taskId]
        );
        
        const updatedTask = tasks[0];
        updatedTask.tags = taskTags;
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомления, если изменились важные поля
if (status !== undefined && status !== existingTask.status) {
  // Если задача завершена
  if (status === 'completed') {
    // Отправляем уведомление о завершении задачи
    await notificationManager.sendNotification({
      type: 'task_completed',
      userId: existingTask.assigned_to, // Отправляем исполнителю
      title: 'Задача выполнена',
      message: `Задача "${updatedTask.title}" была отмечена как выполненная.`,
      projectId: updatedTask.project_id,
      taskId: updatedTask.id,
      data: {
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        completedBy: req.user.username
      }
    });
  } 
  // Если задача заблокирована
  else if (status === 'blocked') {
    // Отправляем уведомление о блокировке задачи
    await notificationManager.sendNotification({
      type: 'task_blocked',
      userId: existingTask.assigned_to, // Отправляем исполнителю
      title: 'Задача заблокирована',
      message: `Задача "${updatedTask.title}" была заблокирована.`,
      projectId: updatedTask.project_id,
      taskId: updatedTask.id,
      data: {
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        blockedBy: req.user.username
      }
    });
  }
}

// Если сменился исполнитель
if (assigned_to !== undefined && assigned_to !== existingTask.assigned_to) {
  // Отправляем уведомление новому исполнителю
  if (assigned_to) {
    await notificationManager.sendNotification({
      type: 'task_assigned',
      userId: assigned_to,
      title: 'Вам назначена задача',
      message: `Вам назначена задача "${updatedTask.title}".`,
      projectId: updatedTask.project_id,
      taskId: updatedTask.id,
      data: {
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        taskDescription: updatedTask.description,
        taskPriority: updatedTask.priority,
        taskDueDate: updatedTask.due_date,
        assignedBy: req.user.username
      }
    });
  }
  
  // Отправляем уведомление предыдущему исполнителю, если он был
  if (existingTask.assigned_to) {
    await notificationManager.sendNotification({
      type: 'task_unassigned',
      userId: existingTask.assigned_to,
      title: 'Вы больше не назначены на задачу',
      message: `Вы больше не назначены на задачу "${updatedTask.title}".`,
      projectId: updatedTask.project_id,
      taskId: updatedTask.id,
      data: {
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        reassignedBy: req.user.username,
        newAssignee: assigned_to ? updatedTask.assignee_name : 'Никто'
      }
    });
  }
}


        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_updated',
            task: updatedTask
          });
          
          wsServer.notifySubscribers('project', updatedTask.project_id, {
            type: 'task_updated',
            task: updatedTask
          });
        }
        
        // Возвращаем результат
        res.json(updatedTask);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при обновлении задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении задачи' });
    }
  },

  /**
   * Удалить задачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteTask(req, res) {
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
      
      await connection.beginTransaction();
      
      try {
        // Удаляем теги задачи
        await connection.query(
          'DELETE FROM task_tags WHERE task_id = ?',
          [taskId]
        );
        
        // Удаляем логи задачи
        await connection.query(
          'DELETE FROM task_logs WHERE task_id = ?',
          [taskId]
        );
        
        // Удаляем подзадачи
        await connection.query(
          'DELETE FROM subtasks WHERE task_id = ?',
          [taskId]
        );
        
        // Удаляем генерации кода
        await connection.query(
          'DELETE FROM code_generations WHERE task_id = ?',
          [taskId]
        );
        
        // Удаляем саму задачу
        await connection.query(
          'DELETE FROM tasks WHERE id = ?',
          [taskId]
        );
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('project', task.project_id, {
            type: 'task_deleted',
            taskId
          });
        }
        
        res.json({ 
          success: true, 
          message: 'Задача успешно удалена' 
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при удалении задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении задачи' });
    }
  }
};

module.exports = taskController;
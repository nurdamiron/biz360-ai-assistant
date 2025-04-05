// src/controller/task/task-status.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');
const GitClient = require('../../utils/git-client');

/**
 * Контроллер для управления статусами задач
 */
const taskStatusController = {
  /**
   * Изменить статус задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async changeTaskStatus(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: 'Необходимо указать status' });
      }
      
      // Проверяем, что статус допустимый
      const validStatuses = ['pending', 'in_progress', 'blocked', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Недопустимый статус. Допустимые значения: ${validStatuses.join(', ')}` 
        });
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
      
      const oldStatus = tasks[0].status;
      const task = tasks[0];
      
      // Если статус не изменился, просто возвращаем задачу
      if (oldStatus === status) {
        connection.release();
        return res.json(task);
      }
      
      await connection.beginTransaction();
      
      try {
        // Обновляем статус
        if (status === 'completed') {
          // Если задача выполнена, устанавливаем completed_at
          await connection.query(
            'UPDATE tasks SET status = ?, updated_at = NOW(), completed_at = NOW() WHERE id = ?',
            [status, taskId]
          );
        } else {
          // Для других статусов
          await connection.query(
            'UPDATE tasks SET status = ?, updated_at = NOW(), completed_at = NULL WHERE id = ?',
            [status, taskId]
          );
        }
        
        // Логируем изменение статуса
        await taskLogger.logInfo(taskId, `Статус изменен: ${oldStatus} -> ${status}`);
        
        // Если статус изменился на "completed", отмечаем время выполнения
        if (status === 'completed') {
          await taskLogger.logProgress(taskId, 'Задача выполнена', 100);
          
          // Проверяем, все ли подзадачи выполнены
          await this._checkSubtasksCompletion(connection, taskId);
          
          // Интеграция с Git: Предлагаем создать Pull Request, если у задачи есть Git-ветка
          if (task.git_branch) {
            // Отправляем уведомление через WebSockets
            const wsServer = websocket.getInstance();
            if (wsServer) {
              wsServer.notifySubscribers('task', taskId, {
                type: 'task_completed_with_git',
                taskId,
                message: 'Задача выполнена. Создать Pull Request?',
                suggestPR: true,
                branchName: task.git_branch
              });
            }
          }
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
        
        await connection.commit();
        connection.release();
        
        const updatedTask = updatedTasks[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'task_status_changed',
            task: updatedTask,
            oldStatus,
            newStatus: status
          });
          
          wsServer.notifySubscribers('project', updatedTask.project_id, {
            type: 'task_status_changed',
            task: updatedTask,
            oldStatus,
            newStatus: status
          });
        }
        
        res.json(updatedTask);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при изменении статуса задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при изменении статуса задачи' });
    }
  },
  
  /**
   * Проверяет, все ли подзадачи выполнены
   * @param {Object} connection - Соединение с БД
   * @param {number} taskId - ID задачи
   * @returns {Promise<void>}
   * @private
   */
  async _checkSubtasksCompletion(connection, taskId) {
    // Получаем количество невыполненных подзадач
    const [subtaskCount] = await connection.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM subtasks
      WHERE task_id = ?`,
      [taskId]
    );
    
    // Если есть подзадачи и все они выполнены, обновляем прогресс
    if (subtaskCount[0].total > 0 && subtaskCount[0].total === subtaskCount[0].completed) {
      await taskLogger.logProgress(taskId, 'Все подзадачи выполнены', 100);
    }
  },
  
  /**
   * Получить историю изменений статуса задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getStatusHistory(req, res) {
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
      
      // Получаем историю изменений статуса из логов
      const [statusLogs] = await connection.query(
        `SELECT * FROM task_logs 
         WHERE task_id = ? AND message LIKE 'Статус изменен%'
         ORDER BY created_at DESC`,
        [taskId]
      );
      
      connection.release();
      
      // Парсим статусы из сообщений логов
      const statusHistory = statusLogs.map(log => {
        const matches = log.message.match(/Статус изменен: (\w+) -> (\w+)/);
        if (matches && matches.length === 3) {
          return {
            id: log.id,
            from: matches[1],
            to: matches[2],
            timestamp: log.created_at
          };
        }
        return null;
      }).filter(Boolean);
      
      res.json(statusHistory);
    } catch (error) {
      logger.error(`Ошибка при получении истории статусов задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении истории статусов задачи' });
    }
  },
  
  /**
   * Получить статистику по статусам задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getStatusStatistics(req, res) {
    try {
      const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
      
      const connection = await pool.getConnection();
      
      let query = `
        SELECT 
          status,
          COUNT(*) as count
        FROM tasks
        WHERE 1=1
      `;
      
      const params = [];
      
      // Если указан проект, фильтруем задачи по нему
      if (projectId) {
        query += ' AND project_id = ?';
        params.push(projectId);
      }
      
      query += ' GROUP BY status';
      
      const [statusStats] = await connection.query(query, params);
      
      connection.release();
      
      // Формируем полную статистику со всеми статусами (даже если нет задач с таким статусом)
      const allStatuses = ['pending', 'in_progress', 'blocked', 'completed', 'failed'];
      const fullStats = allStatuses.map(status => {
        const found = statusStats.find(stat => stat.status === status);
        return {
          status,
          count: found ? found.count : 0
        };
      });
      
      res.json(fullStats);
    } catch (error) {
      logger.error('Ошибка при получении статистики по статусам задач:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении статистики по статусам задач' });
    }
  }
};

module.exports = taskStatusController;
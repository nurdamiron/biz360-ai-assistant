// src/controller/time-entry/time-entry.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');

/**
 * Контроллер для управления записями о затраченном времени на задачи
 */
const timeEntryController = {
  /**
   * Получить все записи о времени для задачи или подзадачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTimeEntries(req, res) {
    try {
      const { task_id, subtask_id, user_id } = req.query;
      
      if (!task_id && !subtask_id && !user_id) {
        return res.status(400).json({ 
          error: 'Необходимо указать хотя бы один параметр: task_id, subtask_id или user_id' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Строим запрос в зависимости от параметров
      let query = `
        SELECT 
          te.*, 
          u.username as user_name,
          t.title as task_title,
          s.title as subtask_title
        FROM time_entries te
        LEFT JOIN users u ON te.user_id = u.id
        LEFT JOIN tasks t ON te.task_id = t.id
        LEFT JOIN subtasks s ON te.subtask_id = s.id
        WHERE 1=1
      `;
      const params = [];
      
      if (task_id) {
        query += ' AND te.task_id = ?';
        params.push(parseInt(task_id));
      }
      
      if (subtask_id) {
        query += ' AND te.subtask_id = ?';
        params.push(parseInt(subtask_id));
      }
      
      if (user_id) {
        query += ' AND te.user_id = ?';
        params.push(parseInt(user_id));
      }
      
      query += ' ORDER BY te.started_at DESC';
      
      const [timeEntries] = await connection.query(query, params);
      
      connection.release();
      
      res.json(timeEntries);
    } catch (error) {
      logger.error('Ошибка при получении записей о времени:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении записей о времени' });
    }
  },

  /**
   * Создать новую запись о затраченном времени
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createTimeEntry(req, res) {
    try {
      const { task_id, subtask_id, description, hours, started_at, ended_at } = req.body;
      
      // Проверяем обязательные поля
      if ((!task_id && !subtask_id) || !hours || !started_at || !ended_at) {
        return res.status(400).json({ 
          error: 'Необходимо указать task_id или subtask_id, hours, started_at и ended_at' 
        });
      }
      
      // Проверяем, что часы положительны
      if (hours <= 0) {
        return res.status(400).json({ error: 'Количество часов должно быть положительным числом' });
      }
      
      // Проверяем, что дата начала меньше даты окончания
      const startDate = new Date(started_at);
      const endDate = new Date(ended_at);
      
      if (startDate >= endDate) {
        return res.status(400).json({ error: 'Дата начала должна быть меньше даты окончания' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи или подзадачи
      if (task_id) {
        const [tasks] = await connection.query('SELECT id FROM tasks WHERE id = ?', [task_id]);
        
        if (tasks.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Задача не найдена' });
        }
      }
      
      if (subtask_id) {
        const [subtasks] = await connection.query('SELECT id FROM subtasks WHERE id = ?', [subtask_id]);
        
        if (subtasks.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Подзадача не найдена' });
        }
      }
      
      await connection.beginTransaction();
      
      try {
        // Получаем ID пользователя из запроса (после аутентификации)
        const user_id = req.user.id;
        
        // Создаем запись о времени
        const [result] = await connection.query(
          `INSERT INTO time_entries 
           (user_id, task_id, subtask_id, description, hours, started_at, ended_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [user_id, task_id || null, subtask_id || null, description || null, hours, started_at, ended_at]
        );
        
        // Обновляем фактически затраченное время на задаче или подзадаче
        if (task_id) {
          await connection.query(
            `UPDATE tasks 
             SET actual_hours = COALESCE(actual_hours, 0) + ? 
             WHERE id = ?`,
            [hours, task_id]
          );
          
          // Логируем добавление времени в задачу
          await taskLogger.logInfo(task_id, `Добавлено ${hours} часов работы пользователем ${req.user.username}`);
        }
        
        if (subtask_id) {
          // Обновляем время подзадачи
          await connection.query(
            `UPDATE subtasks 
             SET actual_hours = COALESCE(actual_hours, 0) + ? 
             WHERE id = ?`,
            [hours, subtask_id]
          );
          
          // Получаем ID задачи для подзадачи, чтобы обновить общее время задачи
          const [subtaskInfo] = await connection.query(
            'SELECT task_id FROM subtasks WHERE id = ?',
            [subtask_id]
          );
          
          if (subtaskInfo.length > 0 && subtaskInfo[0].task_id) {
            const parentTaskId = subtaskInfo[0].task_id;
            
            // Обновляем время родительской задачи, если подзадача не связана напрямую с задачей
            if (!task_id || task_id != parentTaskId) {
              await connection.query(
                `UPDATE tasks 
                 SET actual_hours = COALESCE(actual_hours, 0) + ? 
                 WHERE id = ?`,
                [hours, parentTaskId]
              );
              
              // Логируем добавление времени в задачу
              await taskLogger.logInfo(
                parentTaskId, 
                `Добавлено ${hours} часов работы в подзадаче #${subtask_id} пользователем ${req.user.username}`
              );
            }
          }
        }
        
        // Получаем созданную запись
        const [timeEntries] = await connection.query(
          `SELECT 
            te.*, 
            u.username as user_name,
            t.title as task_title,
            s.title as subtask_title
          FROM time_entries te
          LEFT JOIN users u ON te.user_id = u.id
          LEFT JOIN tasks t ON te.task_id = t.id
          LEFT JOIN subtasks s ON te.subtask_id = s.id
          WHERE te.id = ?`,
          [result.insertId]
        );
        
        await connection.commit();
        
        const timeEntry = timeEntries[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          if (task_id) {
            wsServer.notifySubscribers('task', task_id, {
              type: 'time_entry_added',
              timeEntry
            });
          }
          
          if (subtask_id) {
            wsServer.notifySubscribers('subtask', subtask_id, {
              type: 'time_entry_added',
              timeEntry
            });
          }
        }
        
        connection.release();
        
        res.status(201).json(timeEntry);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error('Ошибка при создании записи о времени:', error);
      res.status(500).json({ error: 'Ошибка сервера при создании записи о времени' });
    }
  },

  /**
   * Обновить запись о затраченном времени
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateTimeEntry(req, res) {
    try {
      const timeEntryId = parseInt(req.params.id);
      const { description, hours, started_at, ended_at } = req.body;
      
      // Проверяем, что часы положительны, если они указаны
      if (hours !== undefined && hours <= 0) {
        return res.status(400).json({ error: 'Количество часов должно быть положительным числом' });
      }
      
      // Проверяем, что дата начала меньше даты окончания, если обе указаны
      if (started_at && ended_at) {
        const startDate = new Date(started_at);
        const endDate = new Date(ended_at);
        
        if (startDate >= endDate) {
          return res.status(400).json({ error: 'Дата начала должна быть меньше даты окончания' });
        }
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование записи
      const [timeEntries] = await connection.query(
        'SELECT * FROM time_entries WHERE id = ?',
        [timeEntryId]
      );
      
      if (timeEntries.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Запись о времени не найдена' });
      }
      
      const timeEntry = timeEntries[0];
      
      // Проверяем права - только создатель записи или администратор может ее обновить
      if (timeEntry.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на обновление этой записи о времени' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Если часы изменились, обновляем фактически затраченное время на задаче/подзадаче
        if (hours !== undefined && hours !== timeEntry.hours) {
          const hoursDiff = hours - timeEntry.hours;
          
          if (timeEntry.task_id) {
            await connection.query(
              `UPDATE tasks 
               SET actual_hours = COALESCE(actual_hours, 0) + ? 
               WHERE id = ?`,
              [hoursDiff, timeEntry.task_id]
            );
            
            // Логируем изменение времени
            await taskLogger.logInfo(
              timeEntry.task_id, 
              `Изменено количество часов работы на ${hoursDiff > 0 ? '+' : ''}${hoursDiff} пользователем ${req.user.username}`
            );
          }
          
          if (timeEntry.subtask_id) {
            // Обновляем время подзадачи
            await connection.query(
              `UPDATE subtasks 
               SET actual_hours = COALESCE(actual_hours, 0) + ? 
               WHERE id = ?`,
              [hoursDiff, timeEntry.subtask_id]
            );
            
            // Получаем ID задачи для подзадачи
            const [subtaskInfo] = await connection.query(
              'SELECT task_id FROM subtasks WHERE id = ?',
              [timeEntry.subtask_id]
            );
            
            if (subtaskInfo.length > 0 && subtaskInfo[0].task_id) {
              const parentTaskId = subtaskInfo[0].task_id;
              
              // Обновляем время родительской задачи, если подзадача не связана напрямую с задачей
              if (!timeEntry.task_id || timeEntry.task_id != parentTaskId) {
                await connection.query(
                  `UPDATE tasks 
                   SET actual_hours = COALESCE(actual_hours, 0) + ? 
                   WHERE id = ?`,
                  [hoursDiff, parentTaskId]
                );
                
                // Логируем изменение времени
                await taskLogger.logInfo(
                  parentTaskId, 
                  `Изменено количество часов работы в подзадаче #${timeEntry.subtask_id} на ${hoursDiff > 0 ? '+' : ''}${hoursDiff}`
                );
              }
            }
          }
        }
        
        // Формируем запрос на обновление
        const updateFields = [];
        const params = [];
        
        if (description !== undefined) {
          updateFields.push('description = ?');
          params.push(description);
        }
        
        if (hours !== undefined) {
          updateFields.push('hours = ?');
          params.push(hours);
        }
        
        if (started_at !== undefined) {
          updateFields.push('started_at = ?');
          params.push(started_at);
        }
        
        if (ended_at !== undefined) {
          updateFields.push('ended_at = ?');
          params.push(ended_at);
        }
        
        if (updateFields.length === 0) {
          // Нечего обновлять
          await connection.rollback();
          connection.release();
          return res.status(400).json({ error: 'Нет данных для обновления' });
        }
        
        // Обновляем запись
        await connection.query(
          `UPDATE time_entries 
           SET ${updateFields.join(', ')} 
           WHERE id = ?`,
          [...params, timeEntryId]
        );
        
        // Получаем обновленную запись
        const [updatedTimeEntries] = await connection.query(
          `SELECT 
            te.*, 
            u.username as user_name,
            t.title as task_title,
            s.title as subtask_title
          FROM time_entries te
          LEFT JOIN users u ON te.user_id = u.id
          LEFT JOIN tasks t ON te.task_id = t.id
          LEFT JOIN subtasks s ON te.subtask_id = s.id
          WHERE te.id = ?`,
          [timeEntryId]
        );
        
        await connection.commit();
        
        const updatedTimeEntry = updatedTimeEntries[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          if (timeEntry.task_id) {
            wsServer.notifySubscribers('task', timeEntry.task_id, {
              type: 'time_entry_updated',
              timeEntry: updatedTimeEntry
            });
          }
          
          if (timeEntry.subtask_id) {
            wsServer.notifySubscribers('subtask', timeEntry.subtask_id, {
              type: 'time_entry_updated',
              timeEntry: updatedTimeEntry
            });
          }
        }
        
        connection.release();
        
        res.json(updatedTimeEntry);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при обновлении записи о времени #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении записи о времени' });
    }
  },

  /**
   * Удалить запись о затраченном времени
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteTimeEntry(req, res) {
    try {
      const timeEntryId = parseInt(req.params.id);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование записи
      const [timeEntries] = await connection.query(
        'SELECT * FROM time_entries WHERE id = ?',
        [timeEntryId]
      );
      
      if (timeEntries.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Запись о времени не найдена' });
      }
      
      const timeEntry = timeEntries[0];
      
      // Проверяем права - только создатель записи или администратор может ее удалить
      if (timeEntry.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на удаление этой записи о времени' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Уменьшаем фактически затраченное время на задаче/подзадаче
        if (timeEntry.task_id) {
          await connection.query(
            `UPDATE tasks 
             SET actual_hours = GREATEST(0, COALESCE(actual_hours, 0) - ?) 
             WHERE id = ?`,
            [timeEntry.hours, timeEntry.task_id]
          );
          
          // Логируем уменьшение времени
          await taskLogger.logInfo(
            timeEntry.task_id, 
            `Удалена запись о времени: -${timeEntry.hours} часов работы пользователем ${req.user.username}`
          );
        }
        
        if (timeEntry.subtask_id) {
          // Обновляем время подзадачи
          await connection.query(
            `UPDATE subtasks 
             SET actual_hours = GREATEST(0, COALESCE(actual_hours, 0) - ?) 
             WHERE id = ?`,
            [timeEntry.hours, timeEntry.subtask_id]
          );
          
          // Получаем ID задачи для подзадачи
          const [subtaskInfo] = await connection.query(
            'SELECT task_id FROM subtasks WHERE id = ?',
            [timeEntry.subtask_id]
          );
          
          if (subtaskInfo.length > 0 && subtaskInfo[0].task_id) {
            const parentTaskId = subtaskInfo[0].task_id;
            
            // Обновляем время родительской задачи, если подзадача не связана напрямую с задачей
            if (!timeEntry.task_id || timeEntry.task_id != parentTaskId) {
              await connection.query(
                `UPDATE tasks 
                 SET actual_hours = GREATEST(0, COALESCE(actual_hours, 0) - ?) 
                 WHERE id = ?`,
                [timeEntry.hours, parentTaskId]
              );
              
              // Логируем уменьшение времени
              await taskLogger.logInfo(
                parentTaskId, 
                `Удалена запись о времени в подзадаче #${timeEntry.subtask_id}: -${timeEntry.hours} часов`
              );
            }
          }
        }
        
        // Удаляем запись
        await connection.query(
          'DELETE FROM time_entries WHERE id = ?',
          [timeEntryId]
        );
        
        await connection.commit();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          if (timeEntry.task_id) {
            wsServer.notifySubscribers('task', timeEntry.task_id, {
              type: 'time_entry_deleted',
              timeEntryId,
              timeEntry
            });
          }
          
          if (timeEntry.subtask_id) {
            wsServer.notifySubscribers('subtask', timeEntry.subtask_id, {
              type: 'time_entry_deleted',
              timeEntryId,
              timeEntry
            });
          }
        }
        
        connection.release();
        
        res.json({
          success: true,
          message: 'Запись о времени успешно удалена'
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при удалении записи о времени #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении записи о времени' });
    }
  },

  /**
   * Получить статистику по затраченному времени
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTimeStatistics(req, res) {
    try {
      const { project_id, user_id, from_date, to_date } = req.query;
      
      const connection = await pool.getConnection();
      
      // Базовый запрос для фильтрации записей
      let filterQuery = '1=1';
      const filterParams = [];
      
      if (project_id) {
        filterQuery += ' AND t.project_id = ?';
        filterParams.push(parseInt(project_id));
      }
      
      if (user_id) {
        filterQuery += ' AND te.user_id = ?';
        filterParams.push(parseInt(user_id));
      }
      
      if (from_date) {
        filterQuery += ' AND te.started_at >= ?';
        filterParams.push(from_date);
      }
      
      if (to_date) {
        filterQuery += ' AND te.ended_at <= ?';
        filterParams.push(to_date);
      }
      
      // Получаем общую статистику
      const [totalStats] = await connection.query(
        `SELECT 
          COUNT(*) as total_entries,
          SUM(hours) as total_hours
        FROM time_entries te
        LEFT JOIN tasks t ON te.task_id = t.id
        LEFT JOIN subtasks s ON te.subtask_id = s.id AND s.task_id = t.id
        WHERE ${filterQuery}`,
        filterParams
      );
      
      // Получаем статистику по пользователям
      const [userStats] = await connection.query(
        `SELECT 
          u.id as user_id,
          u.username,
          COUNT(*) as entries_count,
          SUM(te.hours) as total_hours
        FROM time_entries te
        JOIN users u ON te.user_id = u.id
        LEFT JOIN tasks t ON te.task_id = t.id
        LEFT JOIN subtasks s ON te.subtask_id = s.id AND s.task_id = t.id
        WHERE ${filterQuery}
        GROUP BY u.id
        ORDER BY total_hours DESC`,
        filterParams
      );
      
      // Получаем статистику по задачам
      const [taskStats] = await connection.query(
        `SELECT 
          t.id as task_id,
          t.title,
          COUNT(*) as entries_count,
          SUM(te.hours) as total_hours
        FROM time_entries te
        JOIN tasks t ON te.task_id = t.id OR (te.subtask_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM subtasks s WHERE s.id = te.subtask_id AND s.task_id = t.id
        ))
        WHERE ${filterQuery}
        GROUP BY t.id
        ORDER BY total_hours DESC
        LIMIT 10`,
        filterParams
      );
      
      // Если указан период, получаем статистику по датам
      let dateStats = [];
      if (from_date && to_date) {
        [dateStats] = await connection.query(
          `SELECT 
            DATE(te.started_at) as date,
            SUM(te.hours) as total_hours
          FROM time_entries te
          LEFT JOIN tasks t ON te.task_id = t.id
          LEFT JOIN subtasks s ON te.subtask_id = s.id AND s.task_id = t.id
          WHERE ${filterQuery}
          GROUP BY DATE(te.started_at)
          ORDER BY date ASC`,
          filterParams
        );
      }
      
      connection.release();
      
      res.json({
        summary: totalStats[0],
        by_user: userStats,
        by_task: taskStats,
        by_date: dateStats
      });
    } catch (error) {
      logger.error('Ошибка при получении статистики по времени:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении статистики по времени' });
    }
  },

  /**
   * Начать отслеживание времени (создает запись с started_at = now())
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async startTimeTracking(req, res) {
    try {
      const { task_id, subtask_id, description } = req.body;
      
      if (!task_id && !subtask_id) {
        return res.status(400).json({ 
          error: 'Необходимо указать task_id или subtask_id' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи или подзадачи
      if (task_id) {
        const [tasks] = await connection.query('SELECT id FROM tasks WHERE id = ?', [task_id]);
        
        if (tasks.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Задача не найдена' });
        }
      }
      
      if (subtask_id) {
        const [subtasks] = await connection.query('SELECT id FROM subtasks WHERE id = ?', [subtask_id]);
        
        if (subtasks.length === 0) {
          connection.release();
          return res.status(404).json({ error: 'Подзадача не найдена' });
        }
      }
      
      // Получаем пользователя из запроса (после аутентификации)
      const user_id = req.user.id;
      
      // Проверяем, нет ли у пользователя уже запущенных таймеров
      const [activeTimers] = await connection.query(
        `SELECT id FROM time_entries 
         WHERE user_id = ? AND ended_at IS NULL`,
        [user_id]
      );
      
      if (activeTimers.length > 0) {
        connection.release();
        return res.status(400).json({ 
          error: 'У вас уже есть активный таймер. Остановите его перед запуском нового.' 
        });
      }
      
      // Создаем запись с пустым ended_at
      const [result] = await connection.query(
        `INSERT INTO time_entries 
         (user_id, task_id, subtask_id, description, hours, started_at, ended_at) 
         VALUES (?, ?, ?, ?, ?, NOW(), NULL)`,
        [user_id, task_id || null, subtask_id || null, description || null, 0]
      );
      
      // Получаем созданную запись
      const [timeEntries] = await connection.query(
        `SELECT 
          te.*, 
          u.username as user_name,
          t.title as task_title,
          s.title as subtask_title
        FROM time_entries te
        LEFT JOIN users u ON te.user_id = u.id
        LEFT JOIN tasks t ON te.task_id = t.id
        LEFT JOIN subtasks s ON te.subtask_id = s.id
        WHERE te.id = ?`,
        [result.insertId]
      );
      
      connection.release();
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        if (task_id) {
          wsServer.notifySubscribers('task', task_id, {
            type: 'time_tracking_started',
            timeEntry: timeEntries[0]
          });
        }
        
        if (subtask_id) {
          wsServer.notifySubscribers('subtask', subtask_id, {
            type: 'time_tracking_started',
            timeEntry: timeEntries[0]
          });
        }
      }
      
      res.status(201).json(timeEntries[0]);
    } catch (error) {
      logger.error('Ошибка при запуске отслеживания времени:', error);
      res.status(500).json({ error: 'Ошибка сервера при запуске отслеживания времени' });
    }
  },

  /**
   * Остановить отслеживание времени (обновляет запись, устанавливая ended_at и hours)
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async stopTimeTracking(req, res) {
    try {
      const timeEntryId = parseInt(req.params.id);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование записи
      const [timeEntries] = await connection.query(
        'SELECT * FROM time_entries WHERE id = ?',
        [timeEntryId]
      );
      
      if (timeEntries.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Запись о времени не найдена' });
      }
      
      const timeEntry = timeEntries[0];
      
      // Проверяем, принадлежит ли запись пользователю
      if (timeEntry.user_id !== req.user.id) {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на управление этим таймером' });
      }
      
      // Проверяем, не остановлен ли уже таймер
      if (timeEntry.ended_at) {
        connection.release();
        return res.status(400).json({ error: 'Таймер уже остановлен' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Получаем текущее время и вычисляем затраченные часы
        const startTime = new Date(timeEntry.started_at).getTime();
        const endTime = new Date().getTime();
        const hours = (endTime - startTime) / (1000 * 60 * 60); // Переводим миллисекунды в часы
        
        // Обновляем запись
        await connection.query(
          `UPDATE time_entries 
           SET ended_at = NOW(), hours = ? 
           WHERE id = ?`,
          [hours, timeEntryId]
        );
        
        // Обновляем фактически затраченное время на задаче/подзадаче
        if (timeEntry.task_id) {
          await connection.query(
            `UPDATE tasks 
             SET actual_hours = COALESCE(actual_hours, 0) + ? 
             WHERE id = ?`,
            [hours, timeEntry.task_id]
          );
          
          // Логируем добавление времени в задачу
          await taskLogger.logInfo(
            timeEntry.task_id, 
            `Добавлено ${hours.toFixed(2)} часов работы пользователем ${req.user.username}`
          );
        }
        
        if (timeEntry.subtask_id) {
          // Обновляем время подзадачи
          await connection.query(
            `UPDATE subtasks 
             SET actual_hours = COALESCE(actual_hours, 0) + ? 
             WHERE id = ?`,
            [hours, timeEntry.subtask_id]
          );
          
          // Получаем ID задачи для подзадачи
          const [subtaskInfo] = await connection.query(
            'SELECT task_id FROM subtasks WHERE id = ?',
            [timeEntry.subtask_id]
          );
          
          if (subtaskInfo.length > 0 && subtaskInfo[0].task_id) {
            const parentTaskId = subtaskInfo[0].task_id;
            
            // Обновляем время родительской задачи, если подзадача не связана напрямую с задачей
            if (!timeEntry.task_id || timeEntry.task_id != parentTaskId) {
              await connection.query(
                `UPDATE tasks 
                 SET actual_hours = COALESCE(actual_hours, 0) + ? 
                 WHERE id = ?`,
                [hours, parentTaskId]
              );
              
              // Логируем добавление времени в задачу
              await taskLogger.logInfo(
                parentTaskId, 
                `Добавлено ${hours.toFixed(2)} часов работы в подзадаче #${timeEntry.subtask_id} пользователем ${req.user.username}`
              );
            }
          }
        }
        
        // Получаем обновленную запись
        const [updatedTimeEntries] = await connection.query(
          `SELECT 
            te.*, 
            u.username as user_name,
            t.title as task_title,
            s.title as subtask_title
          FROM time_entries te
          LEFT JOIN users u ON te.user_id = u.id
          LEFT JOIN tasks t ON te.task_id = t.id
          LEFT JOIN subtasks s ON te.subtask_id = s.id
          WHERE te.id = ?`,
          [timeEntryId]
        );
        
        await connection.commit();
        
        const updatedTimeEntry = updatedTimeEntries[0];
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          if (timeEntry.task_id) {
            wsServer.notifySubscribers('task', timeEntry.task_id, {
              type: 'time_tracking_stopped',
              timeEntry: updatedTimeEntry
            });
          }
          
          if (timeEntry.subtask_id) {
            wsServer.notifySubscribers('subtask', timeEntry.subtask_id, {
              type: 'time_tracking_stopped',
              timeEntry: updatedTimeEntry
            });
          }
        }
        
        connection.release();
        
        res.json(updatedTimeEntry);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при остановке отслеживания времени #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при остановке отслеживания времени' });
    }
  }
};

module.exports = timeEntryController;
// src/controller/subtask/subtask.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');

/**
 * Контроллер для управления подзадачами
 */
const subtaskController = {
  /**
   * Получить список подзадач для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getSubtasks(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      
      // Проверяем существование задачи
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Получаем подзадачи
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      connection.release();
      
      res.json(subtasks);
    } catch (error) {
      logger.error(`Ошибка при получении подзадач для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении подзадач' });
    }
  },

  /**
   * Получить подзадачу по ID
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getSubtaskById(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const subtaskId = parseInt(req.params.subtaskId);
      
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
      
      // Получаем подзадачу
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ? AND task_id = ?',
        [subtaskId, taskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      connection.release();
      
      res.json(subtasks[0]);
    } catch (error) {
      logger.error(`Ошибка при получении подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении подзадачи' });
    }
  },

  /**
   * Создать новую подзадачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createSubtask(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const { 
        title, 
        description, 
        sequence_number,
        dependencies = [] 
      } = req.body;
      
      // Проверяем обязательные поля
      if (!title || !description) {
        return res.status(400).json({ 
          error: 'Необходимо указать title и description' 
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
      
      await connection.beginTransaction();
      
      try {
        // Если номер последовательности не указан, получаем максимальный + 1
        let seqNum = sequence_number;
        
        if (!seqNum) {
          const [maxSeq] = await connection.query(
            'SELECT MAX(sequence_number) as max_seq FROM subtasks WHERE task_id = ?',
            [taskId]
          );
          
          seqNum = (maxSeq[0].max_seq || 0) + 1;
        }
        
        // Создаем подзадачу
        const [result] = await connection.query(
          'INSERT INTO subtasks (task_id, title, description, status, sequence_number) VALUES (?, ?, ?, ?, ?)',
          [taskId, title, description, 'pending', seqNum]
        );
        
        const subtaskId = result.insertId;
        
        // Добавляем зависимости, если они указаны
        if (dependencies.length > 0) {
          // Проверяем существование всех подзадач, от которых зависит новая
          for (const depId of dependencies) {
            const [depSubtask] = await connection.query(
              'SELECT id FROM subtasks WHERE id = ? AND task_id = ?',
              [depId, taskId]
            );
            
            if (depSubtask.length === 0) {
              throw new Error(`Подзадача с ID ${depId} не найдена`);
            }
            
            // Добавляем связь зависимости
            await connection.query(
              'INSERT INTO subtask_dependencies (subtask_id, depends_on_subtask_id) VALUES (?, ?)',
              [subtaskId, depId]
            );
          }
        }
        
        // Получаем созданную подзадачу
        const [subtasks] = await connection.query(
          'SELECT * FROM subtasks WHERE id = ?',
          [subtaskId]
        );
        
        // Логируем создание подзадачи
        await taskLogger.logInfo(taskId, `Создана подзадача: ${title}`);
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'subtask_created',
            subtask: subtasks[0]
          });
        }
        
        res.status(201).json(subtasks[0]);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при создании подзадачи для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: `Ошибка сервера при создании подзадачи: ${error.message}` });
    }
  },

  /**
   * Обновить подзадачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateSubtask(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const subtaskId = parseInt(req.params.subtaskId);
      const { 
        title, 
        description, 
        status, 
        sequence_number,
        dependencies
      } = req.body;
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи и подзадачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ? AND task_id = ?',
        [subtaskId, taskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      const existingSubtask = subtasks[0];
      
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
          if (status === 'completed' && existingSubtask.status !== 'completed') {
            updateFields.push('completed_at = NOW()');
          }
          
          // Если статус изменился с "completed", сбрасываем completed_at
          if (status !== 'completed' && existingSubtask.status === 'completed') {
            updateFields.push('completed_at = NULL');
          }
        }
        
        if (sequence_number !== undefined) {
          updateFields.push('sequence_number = ?');
          params.push(sequence_number);
        }
        
        if (updateFields.length > 0) {
          updateFields.push('updated_at = NOW()');
          
          // Создаем запрос на обновление
          const updateQuery = `
            UPDATE subtasks 
            SET ${updateFields.join(', ')} 
            WHERE id = ? AND task_id = ?
          `;
          
          params.push(subtaskId, taskId);
          
          // Выполняем запрос
          await connection.query(updateQuery, params);
          
          // Логируем обновление
          await taskLogger.logInfo(taskId, `Обновлена подзадача #${subtaskId}: ${updateFields.join(', ')}`);
          
          // Если статус изменился на "completed", проверяем, все ли подзадачи выполнены
          if (status === 'completed' && existingSubtask.status !== 'completed') {
            await this._checkAllSubtasksCompleted(connection, taskId);
          }
        }
        
        // Если указаны зависимости, обновляем их
        if (dependencies !== undefined) {
          // Удаляем существующие зависимости
          await connection.query(
            'DELETE FROM subtask_dependencies WHERE subtask_id = ?',
            [subtaskId]
          );
          
          // Добавляем новые зависимости
          if (dependencies.length > 0) {
            for (const depId of dependencies) {
              // Проверяем существование подзадачи, от которой зависит
              const [depSubtask] = await connection.query(
                'SELECT id FROM subtasks WHERE id = ? AND task_id = ?',
                [depId, taskId]
              );
              
              if (depSubtask.length === 0) {
                throw new Error(`Подзадача с ID ${depId} не найдена`);
              }
              
              // Проверяем, что нет циклических зависимостей
              if (await this._hasCircularDependency(connection, depId, subtaskId)) {
                throw new Error(`Добавление зависимости от подзадачи ${depId} создаст циклическую зависимость`);
              }
              
              // Добавляем связь зависимости
              await connection.query(
                'INSERT INTO subtask_dependencies WHERE subtask_id = ? AND depends_on_subtask_id = ?',
                [subtaskId, depId]
              );
            }
          }
        }
        
        // Получаем обновленную подзадачу
        const [updatedSubtasks] = await connection.query(
          'SELECT * FROM subtasks WHERE id = ?',
          [subtaskId]
        );
        
        // Получаем зависимости подзадачи
        const [subtaskDeps] = await connection.query(
          'SELECT depends_on_subtask_id FROM subtask_dependencies WHERE subtask_id = ?',
          [subtaskId]
        );
        
        const updatedSubtask = updatedSubtasks[0];
        updatedSubtask.dependencies = subtaskDeps.map(dep => dep.depends_on_subtask_id);
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'subtask_updated',
            subtask: updatedSubtask
          });
        }
        
        res.json(updatedSubtask);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при обновлении подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: `Ошибка сервера при обновлении подзадачи: ${error.message}` });
    }
  },

  /**
   * Удалить подзадачу
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteSubtask(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const subtaskId = parseInt(req.params.subtaskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи и подзадачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ? AND task_id = ?',
        [subtaskId, taskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Удаляем зависимости подзадачи
        await connection.query(
          'DELETE FROM subtask_dependencies WHERE subtask_id = ? OR depends_on_subtask_id = ?',
          [subtaskId, subtaskId]
        );
        
        // Удаляем подзадачу
        await connection.query(
          'DELETE FROM subtasks WHERE id = ?',
          [subtaskId]
        );
        
        // Обновляем порядковые номера оставшихся подзадач
        await connection.query(`
          SET @row_number = 0;
          UPDATE subtasks
          SET sequence_number = (@row_number:=@row_number+1)
          WHERE task_id = ?
          ORDER BY sequence_number;
        `, [taskId]);
        
        // Логируем удаление подзадачи
        await taskLogger.logInfo(taskId, `Удалена подзадача #${subtaskId}`);
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'subtask_deleted',
            subtaskId
          });
        }
        
        res.json({ 
          success: true, 
          message: 'Подзадача успешно удалена' 
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при удалении подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении подзадачи' });
    }
  },

  /**
   * Изменить статус подзадачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async changeSubtaskStatus(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const subtaskId = parseInt(req.params.subtaskId);
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: 'Необходимо указать status' });
      }
      
      // Проверяем, что статус допустимый
      const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Недопустимый статус. Допустимые значения: ${validStatuses.join(', ')}` 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи и подзадачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ? AND task_id = ?',
        [subtaskId, taskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      const oldStatus = subtasks[0].status;
      
      // Если статус не изменился, просто возвращаем подзадачу
      if (oldStatus === status) {
        connection.release();
        return res.json(subtasks[0]);
      }
      
      await connection.beginTransaction();
      
      try {
        // Проверяем зависимости подзадачи, если статус изменился на "completed"
        if (status === 'completed') {
          const [dependencies] = await connection.query(
            `SELECT d.depends_on_subtask_id, s.status
             FROM subtask_dependencies d
             JOIN subtasks s ON d.depends_on_subtask_id = s.id
             WHERE d.subtask_id = ?`,
            [subtaskId]
          );
          
          // Проверяем, все ли зависимости выполнены
          const uncompletedDeps = dependencies.filter(dep => dep.status !== 'completed');
          
          if (uncompletedDeps.length > 0) {
            await connection.rollback();
            connection.release();
            
            return res.status(400).json({ 
              error: 'Невозможно отметить подзадачу как выполненную, пока не выполнены все зависимости',
              uncompleted_dependencies: uncompletedDeps.map(dep => dep.depends_on_subtask_id)
            });
          }
          
          // Обновляем статус
          await connection.query(
            'UPDATE subtasks SET status = ?, updated_at = NOW(), completed_at = NOW() WHERE id = ?',
            [status, subtaskId]
          );
        } else {
          // Для других статусов просто обновляем
          await connection.query(
            'UPDATE subtasks SET status = ?, updated_at = NOW(), completed_at = NULL WHERE id = ?',
            [status, subtaskId]
          );
        }
        
        // Логируем изменение статуса
        await taskLogger.logInfo(taskId, `Статус подзадачи #${subtaskId} изменен: ${oldStatus} -> ${status}`);
        
        // Проверяем, все ли подзадачи выполнены
        if (status === 'completed') {
          await this._checkAllSubtasksCompleted(connection, taskId);
        }
        
        // Получаем обновленную подзадачу
        const [updatedSubtasks] = await connection.query(
          'SELECT * FROM subtasks WHERE id = ?',
          [subtaskId]
        );
        
        await connection.commit();
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'subtask_status_changed',
            subtaskId,
            oldStatus,
            newStatus: status
          });
        }
        
        res.json(updatedSubtasks[0]);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при изменении статуса подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при изменении статуса подзадачи' });
    }
  },

  /**
   * Изменить порядок подзадач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async reorderSubtasks(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const { order } = req.body;
      
      if (!order || !Array.isArray(order) || order.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать массив ID подзадач в новом порядке' });
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
      
      // Проверяем, что все указанные подзадачи существуют и принадлежат задаче
      const [subtasks] = await connection.query(
        'SELECT id FROM subtasks WHERE task_id = ?',
        [taskId]
      );
      
      const subtaskIds = subtasks.map(subtask => subtask.id);
      
      // Проверяем, что каждый ID в order существует в subtaskIds
      for (const id of order) {
        if (!subtaskIds.includes(id)) {
          connection.release();
          return res.status(400).json({ error: `Подзадача с ID ${id} не найдена или не принадлежит указанной задаче` });
        }
      }
      
      // Проверяем, что все подзадачи задачи указаны в order
      if (order.length !== subtaskIds.length) {
        connection.release();
        return res.status(400).json({ error: 'Необходимо указать все подзадачи задачи в новом порядке' });
      }
      
      await connection.beginTransaction();
      
      try {
        // Обновляем порядковые номера подзадач
        for (let i = 0; i < order.length; i++) {
          await connection.query(
            'UPDATE subtasks SET sequence_number = ? WHERE id = ?',
            [i + 1, order[i]]
          );
        }
        
        // Логируем изменение порядка подзадач
        await taskLogger.logInfo(taskId, 'Изменен порядок подзадач');
        
        await connection.commit();
        
        // Получаем обновленный список подзадач
        const [updatedSubtasks] = await connection.query(
          'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
          [taskId]
        );
        
        connection.release();
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'subtasks_reordered',
            subtasks: updatedSubtasks
          });
        }
        
        res.json(updatedSubtasks);
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Ошибка при изменении порядка подзадач для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при изменении порядка подзадач' });
    }
  },

  /**
   * Проверяет, все ли подзадачи выполнены, и обновляет прогресс задачи
   * @param {Object} connection - Соединение с БД
   * @param {number} taskId - ID задачи
   * @returns {Promise<void>}
   * @private
   */
  async _checkAllSubtasksCompleted(connection, taskId) {
    // Получаем количество подзадач и количество выполненных подзадач
    const [subtaskStats] = await connection.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM subtasks
      WHERE task_id = ?`,
      [taskId]
    );
    
    if (subtaskStats[0].total === 0) {
      return; // Нет подзадач
    }
    
    // Вычисляем процент выполнения
    const completionPercentage = Math.round((subtaskStats[0].completed / subtaskStats[0].total) * 100);
    
    // Логируем прогресс
    await taskLogger.logProgress(taskId, `Выполнено ${subtaskStats[0].completed} из ${subtaskStats[0].total} подзадач`, completionPercentage);
    
    // Если все подзадачи выполнены, автоматически отмечаем задачу как выполненную
    if (subtaskStats[0].completed === subtaskStats[0].total) {
      await taskLogger.logInfo(taskId, 'Все подзадачи выполнены');
      
      // Проверяем текущий статус задачи
      const [taskStatus] = await connection.query(
        'SELECT status FROM tasks WHERE id = ?',
        [taskId]
      );
      
      // Если задача еще не отмечена как выполненная, отмечаем
      if (taskStatus[0].status !== 'completed') {
        await connection.query(
          "UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?",
          [taskId]
        );
        
        await taskLogger.logInfo(taskId, 'Задача автоматически отмечена как выполненная');
      }
    }
  },

  /**
   * Проверяет наличие циклических зависимостей
   * @param {Object} connection - Соединение с БД
   * @param {number} sourceId - ID исходной подзадачи
   * @param {number} targetId - ID целевой подзадачи
   * @returns {Promise<boolean>} - true, если есть циклическая зависимость
   * @private
   */
  async _hasCircularDependency(connection, sourceId, targetId) {
    // Проверяем, зависит ли sourceId от targetId (прямо или косвенно)
    const visited = new Set();
    
    const checkDependency = async (currentId) => {
      if (currentId === targetId) {
        return true; // Найдена циклическая зависимость
      }
      
      if (visited.has(currentId)) {
        return false; // Уже проверяли этот узел
      }
      
      visited.add(currentId);
      
      // Получаем подзадачи, от которых зависит текущая
      const [dependencies] = await connection.query(
        'SELECT depends_on_subtask_id FROM subtask_dependencies WHERE subtask_id = ?',
        [currentId]
      );
      
      for (const dep of dependencies) {
        if (await checkDependency(dep.depends_on_subtask_id)) {
          return true;
        }
      }
      
      return false;
    };
    
    return await checkDependency(sourceId);
  }
};

module.exports = subtaskController;
// src/controller/task/task-filter.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Контроллер для фильтрации и получения списков задач
 */
const taskFilterController = {
  /**
   * Получить список задач с фильтрацией, сортировкой и пагинацией
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTasks(req, res) {
    try {
      // Извлекаем параметры запроса
      const { 
        project_id,
        page = 1, 
        limit = 10, 
        sortBy = 'created_at',
        sortOrder = 'desc',
        status,
        priority,
        assignee,
        search,
        tags,
        parent_task_id,
        from_date,
        to_date
      } = req.query;
      
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const connection = await pool.getConnection();
      
      // Строим базовый запрос
      let query = `
        SELECT t.*, 
               u.username as assignee_name,
               p.name as project_name
        FROM tasks t
        LEFT JOIN users u ON t.assigned_to = u.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE 1=1
      `;
      const params = [];
      
      // Добавляем фильтры, если они есть
      if (project_id) {
        query += ' AND t.project_id = ?';
        params.push(parseInt(project_id));
      }
      
      if (status) {
        // Можно передать несколько статусов через запятую
        const statuses = status.split(',');
        query += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
      
      if (priority) {
        // Можно передать несколько приоритетов через запятую
        const priorities = priority.split(',');
        query += ` AND t.priority IN (${priorities.map(() => '?').join(',')})`;
        params.push(...priorities);
      }
      
      if (assignee) {
        query += ' AND t.assigned_to = ?';
        params.push(parseInt(assignee));
      }
      
      if (search) {
        query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      
      // Фильтрация по родительской задаче
      if (parent_task_id !== undefined) {
        if (parent_task_id === null || parent_task_id === 'null') {
          query += ' AND t.parent_task_id IS NULL';
        } else {
          query += ' AND t.parent_task_id = ?';
          params.push(parseInt(parent_task_id));
        }
      }
      
      // Фильтрация по дате создания
      if (from_date) {
        query += ' AND t.created_at >= ?';
        params.push(from_date);
      }
      
      if (to_date) {
        query += ' AND t.created_at <= ?';
        params.push(to_date);
      }
      
      // Если есть фильтр по тегам, добавляем JOIN с таблицей task_tags
      if (tags) {
        // Преобразуем tags в массив, если это строка
        const tagsArray = Array.isArray(tags) ? tags : tags.split(',');
        
        // Для каждого тега требуем соответствия (AND) - задача должна иметь все указанные теги
        tagsArray.forEach((tag, index) => {
          query += `
            AND EXISTS (
              SELECT 1 FROM task_tags tt${index} 
              WHERE tt${index}.task_id = t.id 
              AND tt${index}.tag_name = ?
            )
          `;
          params.push(tag);
        });
      }
      
      // Добавляем сортировку
      // Преобразуем camelCase в snake_case
      let actualSortBy = sortBy;
      if (sortBy === 'createdAt') actualSortBy = 'created_at';
      if (sortBy === 'updatedAt') actualSortBy = 'updated_at';
      if (sortBy === 'completedAt') actualSortBy = 'completed_at';
      
      // Допустимые поля для сортировки
      const allowedSortFields = ['created_at', 'updated_at', 'completed_at', 'priority', 'status', 'title'];
      if (!allowedSortFields.includes(actualSortBy)) {
        actualSortBy = 'created_at';
      }
      
      // Направление сортировки
      const actualSortOrder = (sortOrder === 'asc') ? 'ASC' : 'DESC';
      
      query += ` ORDER BY t.${actualSortBy} ${actualSortOrder}`;
      
      // Добавляем пагинацию
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
      
      // Выполняем запрос
      const [tasks] = await connection.query(query, params);
      
      // Запрос для получения общего количества записей (для пагинации)
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM tasks t
        WHERE 1=1
      `;
      const countParams = [];
      
      // Добавляем те же фильтры для подсчета общего количества
      if (project_id) {
        countQuery += ' AND t.project_id = ?';
        countParams.push(parseInt(project_id));
      }
      
      if (status) {
        const statuses = status.split(',');
        countQuery += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
        countParams.push(...statuses);
      }
      
      if (priority) {
        const priorities = priority.split(',');
        countQuery += ` AND t.priority IN (${priorities.map(() => '?').join(',')})`;
        countParams.push(...priorities);
      }
      
      if (assignee) {
        countQuery += ' AND t.assigned_to = ?';
        countParams.push(parseInt(assignee));
      }
      
      if (search) {
        countQuery += ' AND (t.title LIKE ? OR t.description LIKE ?)';
        countParams.push(`%${search}%`, `%${search}%`);
      }
      
      if (parent_task_id !== undefined) {
        if (parent_task_id === null || parent_task_id === 'null') {
          countQuery += ' AND t.parent_task_id IS NULL';
        } else {
          countQuery += ' AND t.parent_task_id = ?';
          countParams.push(parseInt(parent_task_id));
        }
      }
      
      if (from_date) {
        countQuery += ' AND t.created_at >= ?';
        countParams.push(from_date);
      }
      
      if (to_date) {
        countQuery += ' AND t.created_at <= ?';
        countParams.push(to_date);
      }
      
      // Фильтрация по тегам
      if (tags) {
        const tagsArray = Array.isArray(tags) ? tags : tags.split(',');
        
        tagsArray.forEach((tag, index) => {
          countQuery += `
            AND EXISTS (
              SELECT 1 FROM task_tags tt${index} 
              WHERE tt${index}.task_id = t.id 
              AND tt${index}.tag_name = ?
            )
          `;
          countParams.push(tag);
        });
      }
      
      const [countResult] = await connection.query(countQuery, countParams);
      const totalTasks = countResult[0].total;
      
      // Для каждой задачи получаем дополнительную информацию
      const enrichedTasks = await Promise.all(tasks.map(async (task) => {
        // Получаем количество подзадач
        const [subtaskStats] = await connection.query(
          `SELECT 
            COUNT(*) as total, 
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
          FROM subtasks 
          WHERE task_id = ?`,
          [task.id]
        );
        
        // Получаем теги задачи
        const [taskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color, t.description
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [task.id]
        );
        
        return {
          ...task,
          subtasks: {
            total: subtaskStats[0].total,
            completed: subtaskStats[0].completed
          },
          tags: taskTags
        };
      }));
      
      connection.release();
      
      // Формируем ответ с метаданными пагинации
      res.json({
        items: enrichedTasks,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalItems: totalTasks,
          totalPages: Math.ceil(totalTasks / parseInt(limit))
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении списка задач:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении списка задач' 
      });
    }
  },

  /**
   * Получить задачи, принадлежащие проекту
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTasksByProject(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      
      // Добавляем project_id к запросу и используем getTasks
      req.query.project_id = projectId;
      
      return this.getTasks(req, res);
    } catch (error) {
      logger.error(`Ошибка при получении задач проекта #${req.params.projectId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении задач проекта' });
    }
  },

  /**
   * Получить задачи, назначенные пользователю
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTasksByUser(req, res) {
    try {
      const userId = parseInt(req.params.userId);
      
      // Проверяем существование пользователя
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT id FROM users WHERE id = ?',
        [userId]
      );
      
      connection.release();
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      // Добавляем assignee к запросу и используем getTasks
      req.query.assignee = userId;
      
      return this.getTasks(req, res);
    } catch (error) {
      logger.error(`Ошибка при получении задач пользователя #${req.params.userId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении задач пользователя' });
    }
  },
  
  /**
   * Поиск похожих задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async findSimilarTasks(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { limit = 5 } = req.query;
      
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
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      // Если у задачи есть теги, ищем по тегам
      let similarTasks = [];
      
      if (tags.length > 0) {
        // Находим задачи с похожими тегами
        const [taggedTasks] = await connection.query(`
          SELECT 
            t.id,
            t.title,
            t.description,
            t.status,
            t.created_at,
            COUNT(DISTINCT tt.tag_name) as matching_tags,
            (SELECT COUNT(*) FROM task_tags WHERE task_id = t.id) as total_tags
          FROM tasks t
          JOIN task_tags tt ON t.id = tt.task_id
          WHERE t.id != ? AND tt.tag_name IN (?)
          GROUP BY t.id
          ORDER BY matching_tags DESC, total_tags ASC, t.created_at DESC
          LIMIT ?
        `, [taskId, tags, parseInt(limit)]);
        
        similarTasks = taggedTasks;
      }
      
      // Если не нашли достаточно задач по тегам, дополняем по текстовому поиску
      if (similarTasks.length < parseInt(limit)) {
        const remainingLimit = parseInt(limit) - similarTasks.length;
        const existingIds = similarTasks.map(t => t.id);
        
        // Подготавливаем запрос, исключая уже найденные задачи
        let excludeClause = '';
        const excludeParams = [taskId];
        
        if (existingIds.length > 0) {
          excludeClause = ` AND t.id NOT IN (${existingIds.map(() => '?').join(',')})`;
          excludeParams.push(...existingIds);
        }
        
        // Поиск по заголовку и описанию
        const [textSimilarTasks] = await connection.query(`
          SELECT 
            t.id,
            t.title,
            t.description,
            t.status,
            t.created_at,
            0 as matching_tags,
            0 as total_tags
          FROM tasks t
          WHERE t.id != ?${excludeClause}
          AND (
            t.title LIKE ? OR 
            t.description LIKE ? OR
            t.project_id = ?
          )
          ORDER BY t.created_at DESC
          LIMIT ?
        `, [
          ...excludeParams,
          `%${task.title.split(' ').filter(word => word.length > 3).join('%')}%`,
          `%${task.title.split(' ').filter(word => word.length > 3).join('%')}%`,
          task.project_id,
          remainingLimit
        ]);
        
        similarTasks = [...similarTasks, ...textSimilarTasks];
      }
      
      // Добавляем подробную информацию о задачах
      const detailedTasks = await Promise.all(similarTasks.map(async (similarTask) => {
        // Получаем теги
        const [taskTagsInfo] = await connection.query(
          `SELECT tt.tag_name as name, t.color
           FROM task_tags tt
           JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [similarTask.id]
        );
        
        // Получаем исполнителя
        const [taskInfo] = await connection.query(
          `SELECT u.username as assignee_name
           FROM tasks t
           LEFT JOIN users u ON t.assigned_to = u.id
           WHERE t.id = ?`,
          [similarTask.id]
        );
        
        return {
          ...similarTask,
          tags: taskTagsInfo,
          assignee_name: taskInfo.length > 0 ? taskInfo[0].assignee_name : null
        };
      }));
      
      connection.release();
      
      res.json(detailedTasks);
    } catch (error) {
      logger.error(`Ошибка при поиске похожих задач для #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при поиске похожих задач' });
    }
  },
  
  /**
   * Получить дерево задач (задачи с подзадачами)
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskTree(req, res) {
    try {
      const { project_id } = req.query;
      
      if (!project_id) {
        return res.status(400).json({ error: 'Необходимо указать project_id' });
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
      
      // Получаем родительские задачи (без parent_task_id)
      const [parentTasks] = await connection.query(
        `SELECT 
          t.id, 
          t.title, 
          t.status, 
          t.priority,
          t.created_at,
          t.completed_at,
          u.username as assignee_name
        FROM tasks t
        LEFT JOIN users u ON t.assigned_to = u.id
        WHERE t.project_id = ? AND t.parent_task_id IS NULL
        ORDER BY t.created_at DESC`,
        [project_id]
      );
      
      // Для каждой родительской задачи получаем её дочерние задачи
      const taskTree = await Promise.all(parentTasks.map(async (parentTask) => {
        // Получаем дочерние задачи
        const [childTasks] = await connection.query(
          `SELECT 
            t.id, 
            t.title, 
            t.status, 
            t.priority,
            t.created_at,
            t.completed_at,
            u.username as assignee_name
          FROM tasks t
          LEFT JOIN users u ON t.assigned_to = u.id
          WHERE t.parent_task_id = ?
          ORDER BY t.created_at ASC`,
          [parentTask.id]
        );
        
        // Получаем теги родительской задачи
        const [parentTaskTags] = await connection.query(
          `SELECT tt.tag_name as name, t.color
           FROM task_tags tt
           LEFT JOIN tags t ON tt.tag_name = t.name
           WHERE tt.task_id = ?`,
          [parentTask.id]
        );
        
        // Добавляем дочерние задачи и теги к родительской
        return {
          ...parentTask,
          tags: parentTaskTags,
          children: childTasks
        };
      }));
      
      connection.release();
      
      res.json(taskTree);
    } catch (error) {
      logger.error('Ошибка при получении дерева задач:', error);
      res.status(500).json({ error: 'Ошибка сервера при получении дерева задач' });
    }
  }
};

module.exports = taskFilterController;
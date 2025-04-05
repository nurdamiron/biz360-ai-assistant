// src/controllers/project.controller.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');

/**
 * Контроллер для управления проектами
 */
const projectController = {
  /**
   * Получить список проектов с фильтрацией и пагинацией
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjects(req, res) {
    try {
      // Извлекаем параметры запроса
      const { 
        page = 1, 
        limit = 10, 
        sortBy = 'updated_at',
        sortOrder = 'desc',
        status,
        search
      } = req.query;
  
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const connection = await pool.getConnection();
      
      // Базовый запрос
      let query = 'SELECT * FROM projects WHERE 1=1';
      const params = [];
      
      // Добавляем условие поиска, если есть
      if (search) {
        query += ' AND (name LIKE ? OR description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      
      // Проверяем, существует ли столбец status, и добавляем фильтр, если он существует
      try {
        const [columns] = await connection.query(
          `SHOW COLUMNS FROM projects LIKE 'status'`
        );
        
        // Если столбец status существует и передан параметр status
        if (columns.length > 0 && status) {
          query += ' AND status = ?';
          params.push(status);
        }
      } catch (error) {
        // Если не удалось получить информацию о колонке, просто игнорируем фильтр по статусу
        logger.warn('Не удалось проверить наличие колонки status:', error.message);
      }
      
      // Проверяем, что поле сортировки существует
      const allowedSortFields = ['name', 'created_at', 'updated_at']; // Используем snake_case
      
      // Преобразуем camelCase в snake_case для совместимости с базой данных
      let actualSortBy = sortBy;
      if (sortBy === 'createdAt') actualSortBy = 'created_at';
      if (sortBy === 'updatedAt') actualSortBy = 'updated_at';
      
      // Если поле сортировки не входит в разрешенные, используем updated_at
      if (!allowedSortFields.includes(actualSortBy)) {
        actualSortBy = 'updated_at';
      }
      
      // Проверяем порядок сортировки
      const actualSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
      
      // Добавляем сортировку
      query += ` ORDER BY ${actualSortBy} ${actualSortOrder}`;
      
      // Добавляем пагинацию
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
      
      // Выполняем запрос на выборку проектов
      const [projects] = await connection.query(query, params);
      
      // Получаем общее количество проектов для пагинации
      let countQuery = 'SELECT COUNT(*) as total FROM projects WHERE 1=1';
      const countParams = [];
      
      if (search) {
        countQuery += ' AND (name LIKE ? OR description LIKE ?)';
        countParams.push(`%${search}%`, `%${search}%`);
      }
      
      // Добавляем фильтр по статусу, если столбец существует
      if (status) {
        try {
          const [columns] = await connection.query(
            `SHOW COLUMNS FROM projects LIKE 'status'`
          );
          
          if (columns.length > 0) {
            countQuery += ' AND status = ?';
            countParams.push(status);
          }
        } catch (error) {
          // Если не удалось получить информацию о колонке, игнорируем фильтр
        }
      }
      
      const [countResult] = await connection.query(countQuery, countParams);
      const totalItems = countResult[0].total;
      
      // Для каждого проекта получаем информацию о количестве задач
      for (const project of projects) {
        const [tasksStats] = await connection.query(
          `SELECT 
            COUNT(*) as tasksCount,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
            SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) as activeTasks
          FROM tasks 
          WHERE project_id = ?`,
          [project.id]
        );
        
        project.tasksCount = tasksStats[0].tasksCount || 0;
        project.completedTasks = tasksStats[0].completedTasks || 0;
        project.activeTasks = tasksStats[0].activeTasks || 0;
      }
      
      connection.release();
      
      // Формируем ответ с пагинацией
      res.json({
        items: projects,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalItems,
          totalPages: Math.ceil(totalItems / parseInt(limit))
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении списка проектов:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении списка проектов' 
      });
    }
  },

  /**
   * Получить детальную информацию о проекте
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjectById(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const connection = await pool.getConnection();
      
      // Получаем информацию о проекте
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      const project = projects[0];
      
      // Получаем статистику о задачах
      const [tasksStats] = await connection.query(
        `SELECT 
          COUNT(*) as tasksCount,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) as activeTasks
        FROM tasks 
        WHERE project_id = ?`,
        [projectId]
      );
      
      project.tasksCount = tasksStats[0].tasksCount || 0;
      project.completedTasks = tasksStats[0].completedTasks || 0;
      project.activeTasks = tasksStats[0].activeTasks || 0;
      
      connection.release();
      
      res.json({
        success: true,
        data: project
      });
    } catch (error) {
      logger.error(`Ошибка при получении информации о проекте #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении информации о проекте' 
      });
    }
  },

  /**
   * Создать новый проект
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createProject(req, res) {
    try {
      const { name, description } = req.body;
      
      // Проверяем обязательные поля
      if (!name || !description) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать название (name) и описание (description) проекта' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем, существует ли проект с таким именем
      const [existingProjects] = await connection.query(
        'SELECT id FROM projects WHERE name = ?',
        [name]
      );
      
      if (existingProjects.length > 0) {
        connection.release();
        return res.status(400).json({ 
          success: false,
          error: 'Проект с таким названием уже существует' 
        });
      }
      
      // Проверяем, существует ли колонка status
      let hasStatusColumn = false;
      try {
        const [columns] = await connection.query(
          `SHOW COLUMNS FROM projects LIKE 'status'`
        );
        hasStatusColumn = columns.length > 0;
      } catch (error) {
        logger.warn('Не удалось проверить наличие колонки status:', error.message);
      }
      
      // Создаем новый проект - разные запросы в зависимости от наличия колонки status
      let result;
      if (hasStatusColumn) {
        [result] = await connection.query(
          `INSERT INTO projects 
           (name, description, status, repository_url) 
           VALUES (?, ?, ?, ?)`,
          [
            name,
            description,
            'active',  // Значение по умолчанию
            req.body.repository_url || 'https://github.com/example/default-repo'
          ]
        );
      } else {
        [result] = await connection.query(
          `INSERT INTO projects 
           (name, description, repository_url) 
           VALUES (?, ?, ?)`,
          [
            name,
            description,
            req.body.repository_url || 'https://github.com/example/default-repo'
          ]
        );
      }
      
      // Получаем созданный проект
      const [createdProjects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [result.insertId]
      );
      
      connection.release();
      
      if (createdProjects.length === 0) {
        return res.status(500).json({ 
          success: false,
          error: 'Ошибка при создании проекта' 
        });
      }
      
      const project = createdProjects[0];
      
      // Добавляем дополнительные поля для соответствия интерфейсу Project
      project.tasksCount = 0;
      project.completedTasks = 0;
      project.activeTasks = 0;
      
      logger.info(`Создан новый проект: ${name} (ID: ${project.id})`);
      
      // Возвращаем созданный проект
      res.status(201).json({
        success: true,
        data: project
      });
    } catch (error) {
      logger.error('Ошибка при создании проекта:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при создании проекта' 
      });
    }
  },

  /**
   * Обновить существующий проект
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateProject(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { name, description, status } = req.body;
      
      // Проверяем, что хотя бы одно поле для обновления указано
      if (!name && !description && !status) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать хотя бы одно поле для обновления' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      const project = projects[0];
      
      // Проверяем, существует ли другой проект с таким именем
      if (name && name !== project.name) {
        const [existingProjects] = await connection.query(
          'SELECT id FROM projects WHERE name = ? AND id != ?',
          [name, projectId]
        );
        
        if (existingProjects.length > 0) {
          connection.release();
          return res.status(400).json({ 
            success: false,
            error: 'Проект с таким названием уже существует' 
          });
        }
      }
      
      // Проверяем, существует ли колонка status
      let hasStatusColumn = false;
      try {
        const [columns] = await connection.query(
          `SHOW COLUMNS FROM projects LIKE 'status'`
        );
        hasStatusColumn = columns.length > 0;
      } catch (error) {
        logger.warn('Не удалось проверить наличие колонки status:', error.message);
      }
      
      // Обновляем проект
      const updateFields = [];
      const params = [];
      
      if (name) {
        updateFields.push('name = ?');
        params.push(name);
      }
      
      if (description) {
        updateFields.push('description = ?');
        params.push(description);
      }
      
      // Добавляем статус только если колонка существует
      if (status && hasStatusColumn) {
        const validStatuses = ['active', 'inactive', 'archived'];
        if (!validStatuses.includes(status)) {
          connection.release();
          return res.status(400).json({ 
            success: false,
            error: `Некорректный статус. Допустимые значения: ${validStatuses.join(', ')}` 
          });
        }
        
        updateFields.push('status = ?');
        params.push(status);
      }
      
      // Если нет полей для обновления, возвращаем текущий проект
      if (updateFields.length === 0) {
        connection.release();
        
        // Получаем статистику о задачах
        const [tasksStats] = await connection.query(
          `SELECT 
            COUNT(*) as tasksCount,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
            SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) as activeTasks
          FROM tasks 
          WHERE project_id = ?`,
          [projectId]
        );
        
        project.tasksCount = tasksStats[0].tasksCount || 0;
        project.completedTasks = tasksStats[0].completedTasks || 0;
        project.activeTasks = tasksStats[0].activeTasks || 0;
        
        return res.json({
          success: true,
          data: project
        });
      }
      
      // Добавляем ID проекта в массив параметров
      params.push(projectId);
      
      // Формируем SQL-запрос
      const updateQuery = `UPDATE projects SET ${updateFields.join(', ')} WHERE id = ?`;
      
      // Выполняем запрос
      await connection.query(updateQuery, params);
      
      // Получаем обновленный проект
      const [updatedProjects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      // Получаем статистику о задачах
      const [tasksStats] = await connection.query(
        `SELECT 
          COUNT(*) as tasksCount,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) as activeTasks
        FROM tasks 
        WHERE project_id = ?`,
        [projectId]
      );
      
      const updatedProject = updatedProjects[0];
      updatedProject.tasksCount = tasksStats[0].tasksCount || 0;
      updatedProject.completedTasks = tasksStats[0].completedTasks || 0;
      updatedProject.activeTasks = tasksStats[0].activeTasks || 0;
      
      connection.release();
      
      logger.info(`Проект #${projectId} успешно обновлен`);
      
      res.json({
        success: true,
        data: updatedProject
      });
    } catch (error) {
      logger.error(`Ошибка при обновлении проекта #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при обновлении проекта' 
      });
    }
  },

  /**
   * Удалить проект
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteProject(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Удаляем проект
      await connection.query(
        'DELETE FROM projects WHERE id = ?',
        [projectId]
      );
      
      connection.release();
      
      logger.info(`Проект #${projectId} успешно удален`);
      
      res.json({
        success: true,
        message: 'Проект успешно удален'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении проекта #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при удалении проекта' 
      });
    }
  }
};

module.exports = projectController;
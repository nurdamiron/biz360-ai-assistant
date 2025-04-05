// src/api/routes/projects.js

const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const { authenticateCombined } = require('../middleware/auth');

/**
 * @route   GET /api/projects
 * @desc    Получить список проектов
 * @access  Private
 */
router.get('/', authenticateCombined, async (req, res) => {
    try {
      // Извлекаем параметры запроса
      const { 
        page = 1, 
        limit = 10, 
        sortBy = 'updated_at', // Используем snake_case
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
  });
  

/**
 * @route   GET /api/projects/:id
 * @desc    Получить детальную информацию о проекте
 * @access  Private
 */



/**
 * @route   POST /api/projects
 * @desc    Создать новый проект
 * @access  Private
 */
router.post('/', authenticateCombined, async (req, res) => {
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
  });
  

/**
 * @route   PUT /api/projects/:id
 * @desc    Обновить проект
 * @access  Private
 */
router.put('/:id', authenticateCombined, async (req, res) => {
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
  });

  /**
 * @route   GET /api/projects/:id
 * @desc    Получить детальную информацию о проекте
 * @access  Private
 */
  router.get('/:id', authenticateCombined, async (req, res) => {
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
  });

/**
 * @route   DELETE /api/projects/:id
 * @desc    Удалить проект
 * @access  Private
 */
router.delete('/:id', authenticateCombined, async (req, res) => {
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
  });
  

/**
 * @route   GET /api/projects/:id/stats
 * @desc    Получить статистику по проекту
 * @access  Private
 */
router.get('/:id/stats', authenticateCombined, async (req, res) => {
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
    
    // Получаем статистику по задачам
    const [taskStats] = await connection.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks 
      WHERE project_id = ?`,
      [projectId]
    );
    
    // Получаем статистику по файлам
    const [fileStats] = await connection.query(
      `SELECT 
        COUNT(*) as totalFiles,
        COUNT(DISTINCT file_type) as totalTypes,
        SUM(
          LENGTH(file_path) - LENGTH(REPLACE(file_path, '/', '')) + 1
        ) as totalDirectories
      FROM project_files 
      WHERE project_id = ?`,
      [projectId]
    );
    
    // Получаем статистику по типам файлов
    const [fileTypes] = await connection.query(
      `SELECT 
        file_type as type,
        COUNT(*) as count
      FROM project_files 
      WHERE project_id = ?
      GROUP BY file_type
      ORDER BY count DESC`,
      [projectId]
    );
    
    // Получаем статистику по времени выполнения задач
    const [timeStats] = await connection.query(
      `SELECT 
        AVG(TIMESTAMPDIFF(MINUTE, created_at, completed_at)) as avgCompletionTime
      FROM tasks
      WHERE project_id = ? AND status = 'completed' AND completed_at IS NOT NULL`,
      [projectId]
    );
    
    connection.release();
    
    // Формируем итоговую статистику
    const statistics = {
      tasks: taskStats[0],
      files: {
        total: fileStats[0].totalFiles || 0,
        types: fileStats[0].totalTypes || 0,
        directories: fileStats[0].totalDirectories || 0,
        byType: fileTypes
      },
      performance: {
        avgCompletionTime: timeStats[0].avgCompletionTime 
          ? Math.round(timeStats[0].avgCompletionTime) 
          : null
      }
    };
    
    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    logger.error(`Ошибка при получении статистики проекта #${req.params.id}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении статистики проекта' 
    });
  }
});

/**
 * @route   GET /api/projects/:id/files
 * @desc    Получить файлы проекта
 * @access  Private
 */
router.get('/:id/files', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { path = '' } = req.query;
    
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
    
    // Получаем файлы из указанного каталога
    const pathPattern = path ? `${path}/%` : '%';
    const [files] = await connection.query(
      `SELECT 
        id, file_path, file_type, last_analyzed, created_at, updated_at
      FROM project_files 
      WHERE project_id = ? AND file_path LIKE ?`,
      [projectId, pathPattern]
    );
    
    connection.release();
    
    // Формируем дерево файлов и папок
    const fileTree = [];
    const directories = new Set();
    
    files.forEach(file => {
      // Удаляем префикс пути, если он указан
      let relativePath = file.file_path;
      if (path && relativePath.startsWith(path + '/')) {
        relativePath = relativePath.substring(path.length + 1);
      }
      
      // Проверяем, есть ли в пути подкаталоги
      const parts = relativePath.split('/');
      
      if (parts.length > 1) {
        // Это файл в подкаталоге, добавляем каталог
        directories.add(parts[0]);
      } else {
        // Это файл в текущем каталоге
        fileTree.push({
          id: file.id,
          name: relativePath,
          path: file.file_path,
          type: file.file_type,
          isDirectory: false,
          lastModified: file.updated_at
        });
      }
    });
    
    // Добавляем каталоги в список
    directories.forEach(dir => {
      fileTree.push({
        name: dir,
        path: path ? `${path}/${dir}` : dir,
        type: 'directory',
        isDirectory: true
      });
    });
    
    res.json({
      success: true,
      data: {
        path,
        items: fileTree
      }
    });
  } catch (error) {
    logger.error(`Ошибка при получении файлов проекта #${req.params.id}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении файлов проекта' 
    });
  }
});

/**
 * @route   GET /api/projects/:id/files/content
 * @desc    Получить содержимое файла
 * @access  Private
 */
router.get('/:id/files/content', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { path } = req.query;
    
    if (!path) {
      return res.status(400).json({ 
        success: false,
        error: 'Необходимо указать путь к файлу (path)' 
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
    
    // Проверяем существование файла
    const [files] = await connection.query(
      `SELECT id FROM project_files 
       WHERE project_id = ? AND file_path = ?`,
      [projectId, path]
    );
    
    if (files.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false,
        error: 'Файл не найден' 
      });
    }
    
    // В реальном приложении здесь должен быть код для получения содержимого файла
    // из файловой системы или хранилища
    // Для примера возвращаем заглушку
    
    // Получаем содержимое из векторного хранилища кода
    const [codeSegments] = await connection.query(
      `SELECT code_segment FROM code_vectors 
       WHERE file_id = ? 
       ORDER BY start_line`,
      [files[0].id]
    );
    
    connection.release();
    
    // Объединяем сегменты в полное содержимое файла
    const content = codeSegments.length > 0
      ? codeSegments.map(segment => segment.code_segment).join('\n')
      : '// Содержимое файла недоступно';
    
    res.json({
      success: true,
      data: {
        path,
        content
      }
    });
  } catch (error) {
    logger.error(`Ошибка при получении содержимого файла:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении содержимого файла' 
    });
  }
});

/**
 * @route   POST /api/projects/:id/files/content
 * @desc    Сохранить содержимое файла
 * @access  Private
 */
router.post('/:id/files/content', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { path, content } = req.body;
    
    if (!path || content === undefined) {
      return res.status(400).json({ 
        success: false,
        error: 'Необходимо указать путь к файлу (path) и содержимое (content)' 
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
    
    // Проверяем существование файла
    const [files] = await connection.query(
      `SELECT id, file_hash FROM project_files 
       WHERE project_id = ? AND file_path = ?`,
      [projectId, path]
    );
    
    const crypto = require('crypto');
    const newHash = crypto.createHash('md5').update(content).digest('hex');
    
    if (files.length === 0) {
      // Файл не существует, создаем его
      const fileExtension = path.split('.').pop().toLowerCase();
      
      // Определяем тип файла по расширению
      let fileType = fileExtension;
      if (['js', 'jsx'].includes(fileExtension)) {
        fileType = 'javascript';
      } else if (['ts', 'tsx'].includes(fileExtension)) {
        fileType = 'typescript';
      }
      
      // Вставляем информацию о файле
      const [result] = await connection.query(
        `INSERT INTO project_files 
         (project_id, file_path, file_type, file_hash) 
         VALUES (?, ?, ?, ?)`,
        [projectId, path, fileType, newHash]
      );
      
      // Создаем векторное представление содержимого
      if (result.insertId) {
        await connection.query(
          `INSERT INTO code_vectors 
           (file_id, code_segment, start_line, end_line, embedding) 
           VALUES (?, ?, ?, ?, ?)`,
          [result.insertId, content, 1, content.split('\n').length, '[]']
        );
      }
    } else {
      // Файл существует, обновляем его
      const fileId = files[0].id;
      const oldHash = files[0].file_hash;
      
      // Обновляем хеш файла только если содержимое изменилось
      if (oldHash !== newHash) {
        await connection.query(
          `UPDATE project_files 
           SET file_hash = ?, updated_at = NOW() 
           WHERE id = ?`,
          [newHash, fileId]
        );
        
        // Удаляем старые сегменты кода
        await connection.query(
          'DELETE FROM code_vectors WHERE file_id = ?',
          [fileId]
        );
        
        // Создаем новое векторное представление
        await connection.query(
          `INSERT INTO code_vectors 
           (file_id, code_segment, start_line, end_line, embedding) 
           VALUES (?, ?, ?, ?, ?)`,
          [fileId, content, 1, content.split('\n').length, '[]']
        );
      }
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Файл успешно сохранен'
    });
  } catch (error) {
    logger.error(`Ошибка при сохранении содержимого файла:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при сохранении содержимого файла' 
    });
  }
});

/**
 * @route   POST /api/projects/:id/files/folder
 * @desc    Создать новую папку
 * @access  Private
 */
router.post('/:id/files/folder', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { path } = req.body;
    
    if (!path) {
      return res.status(400).json({ 
        success: false,
        error: 'Необходимо указать путь к папке (path)' 
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
    
    // В реальном приложении здесь должен быть код для создания папки
    // в файловой системе или хранилище
    // Для примера отправляем успешный ответ
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Папка успешно создана'
    });
  } catch (error) {
    logger.error(`Ошибка при создании папки:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при создании папки' 
    });
  }
});

/**
 * @route   DELETE /api/projects/:id/files
 * @desc    Удалить файл или папку
 * @access  Private
 */
router.delete('/:id/files', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id);
    const { path } = req.query;
    
    if (!path) {
      return res.status(400).json({ 
        success: false,
        error: 'Необходимо указать путь к файлу или папке (path)' 
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
    
    // Если это файл, удаляем его из БД
    const [files] = await connection.query(
      `SELECT id FROM project_files 
       WHERE project_id = ? AND file_path = ?`,
      [projectId, path]
    );
    
    if (files.length > 0) {
      // Удаляем файл
      await connection.query(
        'DELETE FROM project_files WHERE id = ?',
        [files[0].id]
      );
    } else {
      // Это папка, удаляем все файлы внутри неё
      await connection.query(
        `DELETE FROM project_files 
         WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)`,
        [projectId, path, `${path}/%`]
      );
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Файл или папка успешно удалены'
    });
  } catch (error) {
    logger.error(`Ошибка при удалении файла или папки:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при удалении файла или папки' 
    });
  }
});

module.exports = router;
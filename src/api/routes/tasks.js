// src/api/routes/tasks.js

const express = require('express');
const router = express.Router();
const TaskPlanner = require('../../core/task-planner');
const CodeGenerator = require('../../core/code-generator');
const logger = require('../../utils/logger');

/**
 * @route   GET /api/tasks
 * @desc    Получить список задач по проекту
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const projectId = parseInt(req.query.project_id);
    
    if (!projectId) {
      return res.status(400).json({ error: 'Необходимо указать project_id' });
    }
    
    const connection = req.app.locals.db;
    
    // Получаем список задач
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    );
    
    res.json(tasks);
  } catch (error) {
    logger.error('Ошибка при получении списка задач:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении задач' });
  }
});

/**
 * @route   GET /api/tasks/:id
 * @desc    Получить задачу по ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const connection = req.app.locals.db;
    
    // Получаем задачу
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const task = tasks[0];
    
    // Получаем подзадачи
    const [subtasks] = await connection.query(
      'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
      [taskId]
    );
    
    // Получаем сгенерированный код
    const [codeGenerations] = await connection.query(
      'SELECT * FROM code_generations WHERE task_id = ?',
      [taskId]
    );
    
    // Формируем полный ответ
    const response = {
      ...task,
      subtasks,
      code_generations: codeGenerations
    };
    
    res.json(response);
  } catch (error) {
    logger.error(`Ошибка при получении задачи #${req.params.id}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при получении задачи' });
  }
});

/**
 * @route   POST /api/tasks
 * @desc    Создать новую задачу
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const { project_id, title, description, priority, parent_task_id } = req.body;
    
    if (!project_id || !title || !description) {
      return res.status(400).json({ 
        error: 'Необходимо указать project_id, title и description' 
      });
    }
    
    // Инициализируем планировщик задач
    const taskPlanner = new TaskPlanner(project_id);
    
    // Создаем новую задачу
    const taskData = {
      title,
      description,
      priority: priority || 'medium',
      parent_task_id: parent_task_id || null
    };
    
    const task = await taskPlanner.createTask(taskData);
    
    res.status(201).json(task);
  } catch (error) {
    logger.error('Ошибка при создании задачи:', error);
    res.status(500).json({ error: 'Ошибка сервера при создании задачи' });
  }
});

/**
 * @route   PUT /api/tasks/:id
 * @desc    Обновить существующую задачу
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { title, description, status, priority } = req.body;
    
    const connection = req.app.locals.db;
    
    // Проверяем существование задачи
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    // Обновляем задачу
    await connection.query(
      `UPDATE tasks 
       SET title = ?, description = ?, status = ?, priority = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        title || tasks[0].title,
        description || tasks[0].description,
        status || tasks[0].status,
        priority || tasks[0].priority,
        taskId
      ]
    );
    
    // Получаем обновленную задачу
    const [updatedTasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    res.json(updatedTasks[0]);
  } catch (error) {
    logger.error(`Ошибка при обновлении задачи #${req.params.id}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при обновлении задачи' });
  }
});

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Удалить задачу
 * @access  Private
 */
router.delete('/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const connection = req.app.locals.db;
    
    // Проверяем существование задачи
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    // Удаляем задачу (и все связанные записи удаляются каскадно благодаря внешним ключам)
    await connection.query(
      'DELETE FROM tasks WHERE id = ?',
      [taskId]
    );
    
    res.json({ success: true, message: 'Задача успешно удалена' });
  } catch (error) {
    logger.error(`Ошибка при удалении задачи #${req.params.id}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при удалении задачи' });
  }
});

/**
 * @route   POST /api/tasks/:id/decompose
 * @desc    Декомпозировать задачу на подзадачи
 * @access  Private
 */
router.post('/:id/decompose', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем планировщик задач
    const taskPlanner = new TaskPlanner(projectId);
    
    // Декомпозируем задачу
    const subtasks = await taskPlanner.decomposeTask(taskId);
    
    res.json({ success: true, subtasks });
  } catch (error) {
    logger.error(`Ошибка при декомпозиции задачи #${req.params.id}:`, error);
    res.status(500).json({ error: `Ошибка сервера при декомпозиции задачи: ${error.message}` });
  }
});

/**
 * @route   GET /api/tasks/:id/subtasks
 * @desc    Получить подзадачи для задачи
 * @access  Private
 */
router.get('/:id/subtasks', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем планировщик задач
    const taskPlanner = new TaskPlanner(projectId);
    
    // Получаем подзадачи
    const subtasks = await taskPlanner.getSubtasks(taskId);
    
    res.json(subtasks);
  } catch (error) {
    logger.error(`Ошибка при получении подзадач для задачи #${req.params.id}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при получении подзадач' });
  }
});

/**
 * @route   PUT /api/tasks/:id/subtasks/:subtaskId
 * @desc    Обновить статус подзадачи
 * @access  Private
 */
router.put('/:id/subtasks/:subtaskId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const subtaskId = parseInt(req.params.subtaskId);
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Необходимо указать status' });
    }
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем планировщик задач
    const taskPlanner = new TaskPlanner(projectId);
    
    // Обновляем статус подзадачи
    await taskPlanner.updateSubtaskStatus(subtaskId, status);
    
    // Получаем обновленную подзадачу
    const [subtasks] = await connection.query(
      'SELECT * FROM subtasks WHERE id = ?',
      [subtaskId]
    );
    
    if (subtasks.length === 0) {
      return res.status(404).json({ error: 'Подзадача не найдена' });
    }
    
    res.json(subtasks[0]);
  } catch (error) {
    logger.error(`Ошибка при обновлении подзадачи #${req.params.subtaskId}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при обновлении подзадачи' });
  }
});

/**
 * @route   POST /api/tasks/:id/generate
 * @desc    Генерировать код для задачи
 * @access  Private
 */
router.post('/:id/generate', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем генератор кода
    const codeGenerator = new CodeGenerator(projectId);
    
    // Генерируем код
    const result = await codeGenerator.generateCode(taskId);
    
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`Ошибка при генерации кода для задачи #${req.params.id}:`, error);
    res.status(500).json({ error: `Ошибка сервера при генерации кода: ${error.message}` });
  }
});

/**
 * @route   PUT /api/tasks/:id/generations/:generationId
 * @desc    Обновить статус сгенерированного кода
 * @access  Private
 */
router.put('/:id/generations/:generationId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const generationId = parseInt(req.params.generationId);
    const { status, feedback } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Необходимо указать status' });
    }
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем генератор кода
    const codeGenerator = new CodeGenerator(projectId);
    
    // Обновляем статус генерации
    await codeGenerator.updateGenerationStatus(generationId, status, feedback);
    
    // Если статус "approved", применяем сгенерированный код
    if (status === 'approved') {
      await codeGenerator.applyGeneratedCode(generationId);
    }
    
    // Получаем обновленную информацию о генерации
    const [generations] = await connection.query(
      'SELECT * FROM code_generations WHERE id = ?',
      [generationId]
    );
    
    if (generations.length === 0) {
      return res.status(404).json({ error: 'Генерация не найдена' });
    }
    
    res.json({ success: true, generation: generations[0] });
  } catch (error) {
    logger.error(`Ошибка при обновлении статуса генерации #${req.params.generationId}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при обновлении статуса генерации' });
  }
});

/**
 * @route   POST /api/tasks/:id/generations/:generationId/tests
 * @desc    Создать тесты для сгенерированного кода
 * @access  Private
 */
router.post('/:id/generations/:generationId/tests', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const generationId = parseInt(req.params.generationId);
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const projectId = tasks[0].project_id;
    
    // Инициализируем генератор кода
    const codeGenerator = new CodeGenerator(projectId);
    
    // Создаем тесты
    const result = await codeGenerator.createTests(generationId);
    
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`Ошибка при создании тестов для генерации #${req.params.generationId}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при создании тестов' });
  }
});

module.exports = router;
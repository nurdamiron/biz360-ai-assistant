/**
 * Модуль планирования задач
 * 
 * Отвечает за создание структурированного плана выполнения задачи,
 * разбиение сложных задач на этапы, оценку времени и ресурсов.
 */

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const taskUnderstanding = require('../task-understanding');
const decomposer = require('./decomposer');
const planGenerator = require('./plan-generator');
const taskProgressWs = require('../../websocket/task-progress');

/**
 * Создает план выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} Созданный план
 */
async function createTaskPlan(taskId, options = {}) {
  try {
    logger.info(`Создание плана для задачи ${taskId}`);
    await taskProgressWs.startTaskStage(taskId, 'planning', 0, 'Начато планирование задачи');
    
    // Получаем информацию о задаче
    const connection = await pool.getConnection();
    let task;
    
    try {
      const [tasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (tasks.length === 0) {
        throw new Error(`Задача с ID ${taskId} не найдена`);
      }
      task = tasks[0];
    } finally {
      connection.release();
    }
    
    // Получаем результаты анализа задачи
    const analysis = await taskUnderstanding.getTaskAnalysis(taskId);
    if (!analysis) {
      // Если анализ не найден, запускаем его
      logger.info(`Анализ для задачи ${taskId} не найден, запускаем анализ`);
      await taskProgressWs.sendTaskLog(taskId, 'info', 'Анализ задачи не найден, запускаем анализ');
      
      // Анализируем задачу
      const analysisResult = await taskUnderstanding.analyzeTask(task);
      await taskProgressWs.updateTaskStageProgress(taskId, 30, 'Анализ задачи завершен');
    } else {
      await taskProgressWs.updateTaskStageProgress(taskId, 30, 'Получены результаты предыдущего анализа задачи');
    }
    
    // Создаем план выполнения задачи
    const plan = await planGenerator.generatePlan(taskId, options);
    await taskProgressWs.updateTaskStageProgress(taskId, 70, 'План задачи сформирован');
    
    // Выполняем декомпозицию задачи на подзадачи
    const decomposedTasks = await decomposer.decomposeTask(taskId, plan);
    await taskProgressWs.updateTaskStageProgress(taskId, 90, 'Задача декомпозирована на подзадачи');
    
    // Сохраняем план в БД
    await savePlanToDatabase(taskId, plan, decomposedTasks);
    
    await taskProgressWs.completeTaskStage(taskId, true, 'Планирование задачи успешно завершено');
    return {
      taskId,
      plan,
      subtasks: decomposedTasks
    };
  } catch (error) {
    logger.error(`Ошибка при создании плана для задачи ${taskId}:`, error);
    await taskProgressWs.sendTaskLog(taskId, 'error', `Ошибка при планировании: ${error.message}`);
    await taskProgressWs.completeTaskStage(taskId, false, `Ошибка при планировании: ${error.message}`);
    throw error;
  }
}

/**
 * Сохраняет план выполнения задачи в БД
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} plan - План выполнения
 * @param {Array} subtasks - Декомпозированные подзадачи
 * @returns {Promise<void>}
 */
async function savePlanToDatabase(taskId, plan, subtasks) {
  const connection = await pool.getConnection();
  
  try {
    // Начинаем транзакцию
    await connection.beginTransaction();
    
    try {
      // Сохраняем план в task_meta
      const [existingMeta] = await connection.query(`
        SELECT id FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_plan'
      `, [taskId]);
      
      if (existingMeta.length > 0) {
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'task_plan'
        `, [JSON.stringify(plan), taskId]);
      } else {
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'task_plan', ?, NOW())
        `, [taskId, JSON.stringify(plan)]);
      }
      
      // Сохраняем подзадачи в таблицу subtasks
      for (const subtask of subtasks) {
        await connection.query(`
          INSERT INTO subtasks (
            task_id, title, description, status, 
            estimated_hours, sequence_number, created_at
          ) VALUES (
            ?, ?, ?, 'pending', ?, ?, NOW()
          )
        `, [
          taskId,
          subtask.title,
          subtask.description,
          subtask.estimatedHours || null,
          subtask.sequenceNumber
        ]);
      }
      
      // Обновляем статус основной задачи
      await connection.query(`
        UPDATE tasks 
        SET status = 'in_progress', 
            progress = 15,
            updated_at = NOW() 
        WHERE id = ?
      `, [taskId]);
      
      // Завершаем транзакцию
      await connection.commit();
    } catch (error) {
      // Откатываем транзакцию в случае ошибки
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

/**
 * Получает план выполнения задачи из БД
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object|null>} План выполнения или null, если план не найден
 */
async function getTaskPlan(taskId) {
  try {
    const connection = await pool.getConnection();
    
    try {
      const [metaRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_plan'
      `, [taskId]);
      
      if (metaRecords.length === 0) {
        return null;
      }
      
      return JSON.parse(metaRecords[0].meta_value);
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении плана задачи ${taskId}:`, error);
    return null;
  }
}

/**
 * Получает подзадачи для задачи
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Array>} Массив подзадач
 */
async function getSubtasks(taskId) {
  try {
    const connection = await pool.getConnection();
    
    try {
      const [subtasks] = await connection.query(`
        SELECT * FROM subtasks 
        WHERE task_id = ? 
        ORDER BY sequence_number ASC
      `, [taskId]);
      
      return subtasks;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении подзадач для задачи ${taskId}:`, error);
    return [];
  }
}

/**
 * Обновляет план выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} updatedPlan - Обновленный план
 * @returns {Promise<boolean>} Результат операции
 */
async function updateTaskPlan(taskId, updatedPlan) {
  try {
    const connection = await pool.getConnection();
    
    try {
      const [existingMeta] = await connection.query(`
        SELECT id FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_plan'
      `, [taskId]);
      
      if (existingMeta.length > 0) {
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'task_plan'
        `, [JSON.stringify(updatedPlan), taskId]);
      } else {
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'task_plan', ?, NOW())
        `, [taskId, JSON.stringify(updatedPlan)]);
      }
      
      return true;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении плана задачи ${taskId}:`, error);
    return false;
  }
}

/**
 * Оценивает задачу по времени и сложности
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object>} Результат оценки
 */
async function estimateTask(taskId) {
  try {
    // Получаем информацию о задаче
    const connection = await pool.getConnection();
    let task;
    
    try {
      const [tasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (tasks.length === 0) {
        throw new Error(`Задача с ID ${taskId} не найдена`);
      }
      task = tasks[0];
    } finally {
      connection.release();
    }
    
    // Получаем результаты анализа задачи
    const analysis = await taskUnderstanding.getTaskAnalysis(taskId);
    if (!analysis) {
      throw new Error(`Анализ для задачи ${taskId} не найден`);
    }
    
    // Формируем промпт для оценки задачи
    const prompt = `
    Ты - опытный руководитель проектов, специализирующийся на оценке задач разработки.
    Оцени следующую задачу по времени и сложности:
    
    Название: ${task.title}
    Описание: ${task.description}
    
    Требования:
    ${analysis.requirements.map((req, i) => `${i+1}. ${req.description} (Приоритет: ${req.priority}, Тип: ${req.type})`).join('\n')}
    
    Тип задачи: ${analysis.type}
    Категория: ${analysis.category}
    
    Предоставь следующую информацию:
    1. Оценка времени в часах (минимальная, ожидаемая, максимальная)
    2. Факторы, влияющие на оценку
    3. Потенциальные риски
    4. Рекомендации по выполнению
    
    Ответь в формате JSON:
    {
      "time_estimate": {
        "min_hours": число,
        "expected_hours": число,
        "max_hours": число
      },
      "factors": ["фактор 1", "фактор 2", ...],
      "risks": ["риск 1", "риск 2", ...],
      "recommendations": ["рекомендация 1", "рекомендация 2", ...]
    }
    `;
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(prompt, {
      taskId,
      temperature: 0.2
    });
    
    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    const estimation = JSON.parse(jsonMatch[0]);
    
    // Обновляем оценку времени выполнения задачи в БД
    const connection2 = await pool.getConnection();
    try {
      await connection2.query(`
        UPDATE tasks 
        SET estimated_hours = ?
        WHERE id = ?
      `, [estimation.time_estimate.expected_hours, taskId]);
    } finally {
      connection2.release();
    }
    
    return {
      taskId,
      ...estimation
    };
  } catch (error) {
    logger.error(`Ошибка при оценке задачи ${taskId}:`, error);
    throw error;
  }
}

module.exports = {
  createTaskPlan,
  getTaskPlan,
  getSubtasks,
  updateTaskPlan,
  estimateTask
};
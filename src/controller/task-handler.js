/**
 * Модуль обработки задач AI-ассистента
 * 
 * Взаимодействует с очередью задач и запускает соответствующие модули AI-ассистента
 * в зависимости от типа задачи.
 */

const logger = require('../utils/logger');
const TaskQueue = require('./task-queue');
const taskUnderstanding = require('../core/task-understanding');
const taskPlanner = require('../core/task-planner');
const taskProgressWs = require('../websocket/task-progress');
const { pool } = require('../config/db.config');

// Создаем экземпляр очереди задач
const taskQueue = new TaskQueue();

/**
 * Обрабатывает задачу из очереди
 * 
 * @param {Object} task - Задача из очереди
 * @returns {Promise<Object>} - Результат обработки
 * @throws {Error} - В случае ошибки
 */
async function processTask(task) {
  if (!task) {
    throw new Error('Задача не определена');
  }
  
  logger.info(`Начало обработки задачи #${task.id} типа "${task.type}"`);
  
  try {
    // Обрабатываем задачу в зависимости от её типа
    switch (task.type) {
      case 'analyze-task':
        return await processAnalyzeTask(task);
      
      case 'generate-plan':
        return await processGeneratePlanTask(task);
      
      case 'decompose-task':
        return await processDecomposeTask(task);
      
      // В будущем будут добавлены другие типы задач
      // case 'generate-code':
      //   return await processGenerateCode(task);
      
      default:
        throw new Error(`Неизвестный тип задачи: ${task.type}`);
    }
  } catch (error) {
    // Логируем ошибку
    logger.error(`Ошибка при обработке задачи #${task.id}:`, error);
    
    // Отмечаем задачу как неудачную
    await taskQueue.failTask(task.id, error.message);
    
    // Обновляем статус основной задачи
    if (task.data && task.data.taskId) {
      await updateTaskStatus(task.data.taskId, 'failed', error.message);
    }
    
    throw error;
  }
}

/**
 * Обрабатывает задачу анализа
 * 
 * @param {Object} task - Задача из очереди
 * @returns {Promise<Object>} - Результат анализа
 */
async function processAnalyzeTask(task) {
  const { taskId } = task.data;
  
  if (!taskId) {
    throw new Error('ID задачи (taskId) не указан в данных задачи');
  }
  
  // Получаем информацию о задаче из БД
  const [tasks] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  
  if (tasks.length === 0) {
    throw new Error(`Задача с ID ${taskId} не найдена в БД`);
  }
  
  const dbTask = tasks[0];
  
  // Обновляем статус задачи в БД
  await updateTaskStatus(taskId, 'in_progress', 'Начат анализ задачи');
  
  // Обновляем прогресс задачи
  await taskProgressWs.updateTaskProgress(taskId, 5, 'Начат анализ требований задачи');
  
  // Выполняем анализ задачи
  const analysisResult = await taskUnderstanding.analyzeTask(dbTask);
  
  // Обновляем прогресс задачи
  await taskProgressWs.updateTaskProgress(taskId, 10, 'Анализ требований задачи завершен');
  
  // Отмечаем задачу в очереди как выполненную
  await taskQueue.completeTask(task.id);
  
  // Возвращаем результат анализа
  return {
    taskId,
    analysis: analysisResult
  };
}

/**
 * Обрабатывает задачу создания плана
 * 
 * @param {Object} task - Задача из очереди
 * @returns {Promise<Object>} - Результат создания плана
 */
async function processGeneratePlanTask(task) {
  const { taskId } = task.data;
  
  if (!taskId) {
    throw new Error('ID задачи (taskId) не указан в данных задачи');
  }
  
  // Получаем информацию о задаче из БД
  const [tasks] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  
  if (tasks.length === 0) {
    throw new Error(`Задача с ID ${taskId} не найдена в БД`);
  }
  
  // Проверяем, был ли выполнен анализ задачи
  const analysis = await taskUnderstanding.getTaskAnalysis(taskId);
  if (!analysis) {
    throw new Error(`Анализ для задачи ${taskId} не найден. Сначала необходимо выполнить анализ.`);
  }
  
  // Обновляем статус задачи в БД
  await taskProgressWs.startTaskStage(taskId, 'planning', 0, 'Начато планирование задачи');
  
  // Создаем план выполнения задачи
  const planResult = await taskPlanner.createTaskPlan(taskId);
  
  // Отмечаем задачу в очереди как выполненную
  await taskQueue.completeTask(task.id);
  
  // Возвращаем результат создания плана
  return {
    taskId,
    plan: planResult
  };
}

/**
 * Обрабатывает задачу декомпозиции
 * 
 * @param {Object} task - Задача из очереди
 * @returns {Promise<Object>} - Результат декомпозиции
 */
async function processDecomposeTask(task) {
  const { taskId } = task.data;
  
  if (!taskId) {
    throw new Error('ID задачи (taskId) не указан в данных задачи');
  }
  
  // Получаем информацию о задаче из БД
  const [tasks] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  
  if (tasks.length === 0) {
    throw new Error(`Задача с ID ${taskId} не найдена в БД`);
  }
  
  // Проверяем, был ли создан план задачи
  const plan = await taskPlanner.getTaskPlan(taskId);
  if (!plan) {
    throw new Error(`План для задачи ${taskId} не найден. Сначала необходимо выполнить планирование.`);
  }
  
  // Обновляем статус задачи в БД
  await taskProgressWs.startTaskStage(taskId, 'decomposition', 0, 'Начата декомпозиция задачи');
  
  // Получаем модуль декомпозиции
  const decomposer = require('../core/task-planner/decomposer');
  
  // Выполняем декомпозицию задачи
  const subtasks = await decomposer.decomposeTask(taskId, plan);
  
  // Обновляем прогресс задачи
  await taskProgressWs.completeTaskStage(taskId, true, 'Декомпозиция задачи завершена');
  
  // Анализируем зависимости между подзадачами
  await decomposer.analyzeDependencies(taskId);
  
  // Отмечаем задачу в очереди как выполненную
  await taskQueue.completeTask(task.id);
  
  // Возвращаем результат декомпозиции
  return {
    taskId,
    subtasksCount: subtasks.length
  };
}

/**
 * Обновляет статус задачи в БД
 * 
 * @param {number} taskId - ID задачи
 * @param {string} status - Новый статус ('pending', 'in_progress', 'completed', 'failed')
 * @param {string} message - Сообщение о статусе
 * @returns {Promise<void>}
 */
async function updateTaskStatus(taskId, status, message) {
  try {
    // Обновляем статус задачи в БД
    let query = 'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?';
    let params = [status, taskId];
    
    // Если задача завершена, устанавливаем completed_at
    if (status === 'completed') {
      query = 'UPDATE tasks SET status = ?, updated_at = NOW(), completed_at = NOW() WHERE id = ?';
    }
    
    await pool.query(query, params);
    
    // Обновляем статус в WebSocket
    await taskProgressWs.updateTaskStatus(taskId, status, message);
    
    logger.debug(`Обновлен статус задачи #${taskId}: ${status}`);
  } catch (error) {
    logger.error(`Ошибка при обновлении статуса задачи #${taskId}:`, error);
    throw error;
  }
}

/**
 * Запускает обработчик очереди задач
 * 
 * @returns {Promise<void>}
 */
async function startTaskProcessor() {
  try {
    logger.info('Запуск обработчика очереди задач');
    
    // Флаг для отслеживания состояния обработчика
    let isProcessing = false;
    
    // Функция для обработки одной задачи из очереди
    async function processSingleTask() {
      if (isProcessing) return;
      
      isProcessing = true;
      
      try {
        // Получаем следующую задачу из очереди
        const task = await taskQueue.getNextTask();
        
        if (task) {
          // Обрабатываем задачу
          await processTask(task);
        }
      } catch (error) {
        logger.error('Ошибка при обработке задачи из очереди:', error);
      } finally {
        isProcessing = false;
      }
    }
    
    // Запускаем интервал для проверки очереди
    const processorInterval = setInterval(processSingleTask, 2000);
    
    // Добавляем обработчик для плавного завершения
    process.on('SIGTERM', () => {
      logger.info('Получен сигнал SIGTERM, останавливаем обработчик очереди задач');
      clearInterval(processorInterval);
    });
    
    process.on('SIGINT', () => {
      logger.info('Получен сигнал SIGINT, останавливаем обработчик очереди задач');
      clearInterval(processorInterval);
    });
    
    // Запускаем первый цикл проверки очереди
    processSingleTask();
  } catch (error) {
    logger.error('Ошибка при запуске обработчика очереди задач:', error);
    throw error;
  }
}

/**
 * Обрабатывает запрос на выполнение задачи
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object>} - Результат обработки
 */
async function handleTaskRequest(taskId) {
  try {
    if (!taskId) {
      throw new Error('ID задачи не указан');
    }
    
    // Получаем информацию о задаче из БД
    const [tasks] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    
    if (tasks.length === 0) {
      throw new Error(`Задача с ID ${taskId} не найдена в БД`);
    }
    
    const task = tasks[0];
    
    // Обновляем статус задачи в БД
    await updateTaskStatus(taskId, 'in_progress', 'Задача взята в обработку');
    
    // Добавляем задачу в очередь на анализ
    await taskQueue.addTask('analyze-task', { taskId }, 8);
    
    // Добавляем задачу в очередь на планирование (будет выполнена после анализа)
    await taskQueue.addTask('generate-plan', { taskId }, 7);
    
    // Добавляем задачу в очередь на декомпозицию (будет выполнена после планирования)
    await taskQueue.addTask('decompose-task', { taskId }, 6);
    
    return {
      success: true,
      taskId,
      message: 'Задача взята в обработку',
      status: 'in_progress'
    };
  } catch (error) {
    logger.error(`Ошибка при обработке запроса на выполнение задачи #${taskId}:`, error);
    throw error;
  }
}

// Экспортируем функции и объекты
module.exports = {
  taskQueue,
  processTask,
  startTaskProcessor,
  handleTaskRequest,
  updateTaskStatus
};
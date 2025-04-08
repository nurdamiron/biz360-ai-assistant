/**
 * Адаптер для работы с базой данных MySQL в модуле понимания задач
 * 
 * Этот модуль предоставляет совместимость между модулем task-understanding
 * и существующей базой данных MySQL.
 */

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Сохраняет результаты анализа задачи в базу данных
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} analysisData - Данные анализа
 * @returns {Promise<void>}
 */
async function saveAnalysisResults(taskId, analysisData) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Обновление основной информации о задаче
      await connection.query(`
        UPDATE tasks 
        SET complexity = ?, 
            updated_at = NOW() 
        WHERE id = ?
      `, [analysisData.complexityScore, taskId]);
      
      // Подготавливаем данные для сохранения в task_meta
      const metaData = {
        requirements: analysisData.requirements,
        classification: analysisData.taskClassification
      };
      
      // Проверяем, существует ли уже запись с ключом 'task_analysis'
      const [existingMeta] = await connection.query(`
        SELECT id FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_analysis'
      `, [taskId]);
      
      if (existingMeta.length > 0) {
        // Обновляем существующую запись
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, 
              updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'task_analysis'
        `, [JSON.stringify(metaData), taskId]);
      } else {
        // Создаем новую запись
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'task_analysis', ?, NOW())
        `, [taskId, JSON.stringify(metaData)]);
      }
      
      logger.debug(`Результаты анализа для задачи ${taskId} сохранены в БД`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при сохранении результатов анализа задачи ${taskId}:`, error);
    throw error;
  }
}

/**
 * Получает сохраненные результаты анализа задачи из БД
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object|null>} Данные анализа или null, если анализ не найден
 */
async function getTaskAnalysis(taskId) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Запрашиваем запись из task_meta
      const [metaRows] = await connection.query(`
        SELECT meta_value 
        FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_analysis'
      `, [taskId]);
      
      if (metaRows.length === 0) {
        return null;
      }
      
      return JSON.parse(metaRows[0].meta_value);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении результатов анализа задачи ${taskId}:`, error);
    return null;
  }
}

/**
 * Получает информацию о задаче из БД
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object|null>} Информация о задаче или null, если задача не найдена
 */
async function getTaskInfo(taskId) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Запрашиваем информацию о задаче
      const [tasks] = await connection.query(`
        SELECT * 
        FROM tasks 
        WHERE id = ?
      `, [taskId]);
      
      if (tasks.length === 0) {
        return null;
      }
      
      return tasks[0];
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении информации о задаче ${taskId}:`, error);
    return null;
  }
}

/**
 * Обновляет статус задачи в БД
 * 
 * @param {number} taskId - ID задачи
 * @param {string} status - Новый статус
 * @returns {Promise<boolean>} Результат операции
 */
async function updateTaskStatus(taskId, status) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Обновляем статус задачи
      await connection.query(`
        UPDATE tasks 
        SET status = ?, 
            updated_at = NOW() 
        WHERE id = ?
      `, [status, taskId]);
      
      logger.debug(`Статус задачи ${taskId} обновлен на "${status}"`);
      return true;
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении статуса задачи ${taskId}:`, error);
    return false;
  }
}

/**
 * Обновляет прогресс задачи в БД
 * 
 * @param {number} taskId - ID задачи
 * @param {number} progress - Новое значение прогресса (0-100)
 * @returns {Promise<boolean>} Результат операции
 */
async function updateTaskProgress(taskId, progress) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Проверяем, что прогресс в допустимых пределах
      const validProgress = Math.max(0, Math.min(100, progress));
      
      // Обновляем прогресс задачи
      await connection.query(`
        UPDATE tasks 
        SET progress = ?, 
            updated_at = NOW() 
        WHERE id = ?
      `, [validProgress, taskId]);
      
      logger.debug(`Прогресс задачи ${taskId} обновлен на ${validProgress}%`);
      return true;
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении прогресса задачи ${taskId}:`, error);
    return false;
  }
}

/**
 * Добавляет запись в лог задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {string} logType - Тип лога ('info', 'warning', 'error', 'progress')
 * @param {string} message - Сообщение
 * @param {number|null} progress - Прогресс (опционально)
 * @returns {Promise<boolean>} Результат операции
 */
async function addTaskLog(taskId, logType, message, progress = null) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Добавляем запись в лог
      if (progress !== null) {
        await connection.query(`
          INSERT INTO task_logs (task_id, log_type, message, progress) 
          VALUES (?, ?, ?, ?)
        `, [taskId, logType, message, progress]);
      } else {
        await connection.query(`
          INSERT INTO task_logs (task_id, log_type, message) 
          VALUES (?, ?, ?)
        `, [taskId, logType, message]);
      }
      
      logger.debug(`Добавлен лог типа "${logType}" для задачи ${taskId}`);
      return true;
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при добавлении лога для задачи ${taskId}:`, error);
    return false;
  }
}

module.exports = {
  saveAnalysisResults,
  getTaskAnalysis,
  getTaskInfo,
  updateTaskStatus,
  updateTaskProgress,
  addTaskLog
};
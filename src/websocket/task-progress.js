/**
 * Модуль обновления прогресса задач через WebSocket (адаптированный для MySQL)
 * 
 * Отвечает за отправку уведомлений о прогрессе выполнения задач
 * и изменении статуса задач в реальном времени.
 */

const websocket = require('./index');
const logger = require('../utils/logger');
const { pool } = require('../config/db.config');

/**
 * Отправляет обновление прогресса задачи через WebSocket
 * 
 * @param {number} taskId - ID задачи
 * @param {number} progress - Процент выполнения (0-100)
 * @param {string} message - Сообщение о текущем этапе выполнения
 * @returns {Promise<void>}
 */
async function updateTaskProgress(taskId, progress, message) {
  try {
    // Проверяем, что процент прогресса в допустимых пределах
    const validProgress = Math.max(0, Math.min(100, progress));
    
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем информацию о задаче из БД
      const [tasks] = await connection.query('SELECT user_id FROM tasks WHERE id = ?', [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`Попытка обновить прогресс несуществующей задачи ${taskId}`);
        return;
      }
      
      const userId = tasks[0].user_id;
      
      // Обновляем прогресс в БД
      await connection.query('UPDATE tasks SET progress = ? WHERE id = ?', [validProgress, taskId]);
      
      // Добавляем запись в task_logs
      await connection.query(`
        INSERT INTO task_logs (task_id, log_type, message, progress) 
        VALUES (?, 'progress', ?, ?)
      `, [taskId, message || `Прогресс выполнения: ${validProgress}%`, validProgress]);
      
      // Получаем экземпляр WebSocket сервера
      const ws = websocket.getInstance();
      
      if (ws) {
        // Формируем данные для отправки
        const progressData = {
          type: 'task-progress',
          data: {
            taskId,
            progress: validProgress,
            message: message || `Прогресс выполнения: ${validProgress}%`,
            timestamp: new Date().toISOString()
          }
        };
        
        // Отправляем всем подключенным клиентам
        ws.broadcast(progressData);
      }
      
      logger.debug(`Обновлен прогресс задачи ${taskId}: ${validProgress}%`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении прогресса задачи ${taskId}:`, error);
  }
}

/**
 * Отправляет обновление статуса задачи через WebSocket
 * 
 * @param {number} taskId - ID задачи
 * @param {string} status - Новый статус задачи ('pending', 'in_progress', 'completed', 'failed')
 * @param {string} message - Сообщение, связанное с изменением статуса
 * @returns {Promise<void>}
 */
async function updateTaskStatus(taskId, status, message) {
  try {
    // Проверяем, что статус допустимый
    const validStatuses = ['pending', 'in_progress', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      logger.warn(`Попытка установить недопустимый статус "${status}" для задачи ${taskId}`);
      return;
    }
    
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем информацию о задаче из БД
      const [tasks] = await connection.query('SELECT user_id FROM tasks WHERE id = ?', [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`Попытка обновить статус несуществующей задачи ${taskId}`);
        return;
      }
      
      const userId = tasks[0].user_id;
      
      // Обновляем статус в БД
      let updateQuery = 'UPDATE tasks SET status = ? WHERE id = ?';
      let params = [status, taskId];
      
      // Если задача завершена, устанавливаем completed_at
      if (status === 'completed') {
        updateQuery = 'UPDATE tasks SET status = ?, completed_at = NOW() WHERE id = ?';
      }
      
      await connection.query(updateQuery, params);
      
      // Добавляем запись в task_logs
      const logType = status === 'failed' ? 'error' : 'info';
      const logMessage = message || `Статус задачи изменен на "${status}"`;
      
      await connection.query(`
        INSERT INTO task_logs (task_id, log_type, message) 
        VALUES (?, ?, ?)
      `, [taskId, logType, logMessage]);
      
      // Получаем экземпляр WebSocket сервера
      const ws = websocket.getInstance();
      
      if (ws) {
        // Формируем данные для отправки
        const statusData = {
          type: 'task-status',
          data: {
            taskId,
            status,
            message: logMessage,
            timestamp: new Date().toISOString()
          }
        };
        
        // Отправляем всем подключенным клиентам
        ws.broadcast(statusData);
      }
      
      logger.debug(`Обновлен статус задачи ${taskId}: ${status}`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении статуса задачи ${taskId}:`, error);
  }
}

/**
 * Отправляет лог выполнения задачи через WebSocket
 * 
 * @param {number} taskId - ID задачи
 * @param {string} logType - Тип лога ('info', 'warning', 'error')
 * @param {string} message - Текст сообщения
 * @returns {Promise<void>}
 */
async function sendTaskLog(taskId, logType, message) {
  try {
    // Проверяем, что тип лога допустимый
    const validLogTypes = ['info', 'warning', 'error', 'progress'];
    const logTypeNormalized = validLogTypes.includes(logType) ? logType : 'info';
    
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем информацию о задаче из БД
      const [tasks] = await connection.query('SELECT user_id FROM tasks WHERE id = ?', [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`Попытка отправить лог для несуществующей задачи ${taskId}`);
        return;
      }
      
      const userId = tasks[0].user_id;
      
      // Добавляем запись в task_logs
      await connection.query(`
        INSERT INTO task_logs (task_id, log_type, message) 
        VALUES (?, ?, ?)
      `, [taskId, logTypeNormalized, message]);
      
      // Получаем экземпляр WebSocket сервера
      const ws = websocket.getInstance();
      
      if (ws) {
        // Формируем данные для отправки
        const logData = {
          type: 'task-log',
          data: {
            taskId,
            logType: logTypeNormalized,
            message,
            timestamp: new Date().toISOString()
          }
        };
        
        // Отправляем всем подключенным клиентам
        ws.broadcast(logData);
      }
      
      // Если это ошибка, логируем её также в общий лог
      if (logTypeNormalized === 'error') {
        logger.error(`Ошибка в задаче ${taskId}: ${message}`);
      } else if (logTypeNormalized === 'warning') {
        logger.warn(`Предупреждение в задаче ${taskId}: ${message}`);
      } else {
        logger.debug(`Лог задачи ${taskId}: ${message}`);
      }
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при отправке лога задачи ${taskId}:`, error);
  }
}

/**
 * Отправляет уведомление о начале нового этапа выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {string} stage - Название этапа
 * @param {number} stageProgress - Прогресс этапа (0-100)
 * @param {string} message - Описание этапа
 * @returns {Promise<void>}
 */
async function startTaskStage(taskId, stage, stageProgress = 0, message) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем информацию о задаче из БД
      const [tasks] = await connection.query('SELECT user_id, progress FROM tasks WHERE id = ?', [taskId]);
      
      if (tasks.length === 0) {
        logger.warn(`Попытка начать этап для несуществующей задачи ${taskId}`);
        return;
      }
      
      const userId = tasks[0].user_id;
      const stageMessage = message || `Начат этап: ${stage}`;
      
      // Добавляем запись в task_logs
      await connection.query(`
        INSERT INTO task_logs (task_id, log_type, message, progress) 
        VALUES (?, 'info', ?, ?)
      `, [taskId, stageMessage, stageProgress]);
      
      // Добавляем информацию об этапе в task_meta
      const etapData = {
        stage,
        started_at: new Date().toISOString(),
        progress: stageProgress
      };
      
      // Проверяем, существует ли запись для текущего этапа
      const [existingMeta] = await connection.query(`
        SELECT id FROM task_meta 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [taskId]);
      
      if (existingMeta.length > 0) {
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'current_stage'
        `, [JSON.stringify(etapData), taskId]);
      } else {
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'current_stage', ?, NOW())
        `, [taskId, JSON.stringify(etapData)]);
      }
      
      // Отправляем уведомление через WebSocket
      await updateTaskProgress(taskId, stageProgress, stageMessage);
      
      logger.debug(`Начат этап "${stage}" для задачи ${taskId}`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при начале этапа для задачи ${taskId}:`, error);
  }
}

/**
 * Обновляет прогресс текущего этапа выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {number} stageProgress - Прогресс этапа (0-100)
 * @param {string} message - Сообщение о текущем состоянии этапа
 * @returns {Promise<void>}
 */
async function updateTaskStageProgress(taskId, stageProgress, message) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем текущий этап из task_meta
      const [metaRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [taskId]);
      
      if (metaRecords.length === 0) {
        logger.warn(`Попытка обновить прогресс этапа для задачи ${taskId} без активного этапа`);
        return;
      }
      
      const currentStage = JSON.parse(metaRecords[0].meta_value);
      
      // Обновляем прогресс этапа
      currentStage.progress = Math.max(0, Math.min(100, stageProgress));
      
      // Обновляем запись в task_meta
      await connection.query(`
        UPDATE task_meta 
        SET meta_value = ?, updated_at = NOW() 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [JSON.stringify(currentStage), taskId]);
      
      // Отправляем обновление прогресса задачи
      const stageMessage = message || `Прогресс этапа "${currentStage.stage}": ${stageProgress}%`;
      await updateTaskProgress(taskId, await calculateOverallProgress(taskId), stageMessage);
      
      logger.debug(`Обновлен прогресс этапа "${currentStage.stage}" для задачи ${taskId}: ${stageProgress}%`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при обновлении прогресса этапа для задачи ${taskId}:`, error);
  }
}

/**
 * Завершает текущий этап выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {boolean} success - Флаг успешного завершения этапа
 * @param {string} message - Сообщение о результате этапа
 * @returns {Promise<void>}
 */
async function completeTaskStage(taskId, success = true, message) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем текущий этап из task_meta
      const [metaRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [taskId]);
      
      if (metaRecords.length === 0) {
        logger.warn(`Попытка завершить этап для задачи ${taskId} без активного этапа`);
        return;
      }
      
      const currentStage = JSON.parse(metaRecords[0].meta_value);
      
      // Обновляем информацию об этапе
      currentStage.completed = true;
      currentStage.success = success;
      currentStage.completed_at = new Date().toISOString();
      currentStage.progress = 100; // Устанавливаем прогресс этапа в 100%
      
      // Архивируем информацию об этапе
      const [stagesHistoryRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'stages_history'
      `, [taskId]);
      
      let history = [];
      
      if (stagesHistoryRecords.length > 0) {
        history = JSON.parse(stagesHistoryRecords[0].meta_value);
      }
      
      history.push(currentStage);
      
      // Сохраняем историю этапов
      if (stagesHistoryRecords.length > 0) {
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'stages_history'
        `, [JSON.stringify(history), taskId]);
      } else {
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'stages_history', ?, NOW())
        `, [taskId, JSON.stringify(history)]);
      }
      
      // Удаляем запись о текущем этапе
      await connection.query(`
        DELETE FROM task_meta 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [taskId]);
      
      // Добавляем запись в task_logs
      const logType = success ? 'info' : 'warning';
      const stageMessage = message || `Этап "${currentStage.stage}" ${success ? 'успешно завершен' : 'завершен с ошибками'}`;
      
      await connection.query(`
        INSERT INTO task_logs (task_id, log_type, message, progress) 
        VALUES (?, ?, ?, 100)
      `, [taskId, logType, stageMessage]);
      
      // Отправляем уведомление через WebSocket
      await sendTaskLog(taskId, logType, stageMessage);
      
      // Обновляем общий прогресс задачи
      await updateTaskProgress(taskId, await calculateOverallProgress(taskId), stageMessage);
      
      logger.debug(`Завершен этап "${currentStage.stage}" для задачи ${taskId}: ${success ? 'успешно' : 'с ошибками'}`);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при завершении этапа для задачи ${taskId}:`, error);
  }
}

/**
 * Рассчитывает общий прогресс задачи на основе этапов
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<number>} Процент общего выполнения задачи
 */
async function calculateOverallProgress(taskId) {
  try {
    // Получаем соединение с базой данных
    const connection = await pool.getConnection();
    
    try {
      // Получаем историю этапов
      const [stagesHistoryRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'stages_history'
      `, [taskId]);
      
      // Получаем текущий этап
      const [currentStageRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'current_stage'
      `, [taskId]);
      
      // Собираем все этапы
      let allStages = [];
      
      if (stagesHistoryRecords.length > 0) {
        allStages = JSON.parse(stagesHistoryRecords[0].meta_value);
      }
      
      if (currentStageRecords.length > 0) {
        allStages.push(JSON.parse(currentStageRecords[0].meta_value));
      }
      
      if (allStages.length === 0) {
        // Если нет информации об этапах, возвращаем текущий прогресс из таблицы tasks
        const [tasks] = await connection.query('SELECT progress FROM tasks WHERE id = ?', [taskId]);
        return tasks.length > 0 ? tasks[0].progress : 0;
      }
      
      // Получаем информацию о плане выполнения задачи (если есть)
      const [taskPlanRecords] = await connection.query(`
        SELECT meta_value FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_plan'
      `, [taskId]);
      
      let stageWeights = {};
      
      if (taskPlanRecords.length > 0) {
        const plan = JSON.parse(taskPlanRecords[0].meta_value);
        
        // Если в плане есть информация о весе этапов, используем её
        if (plan.stages && Array.isArray(plan.stages)) {
          plan.stages.forEach(stage => {
            if (stage.name && stage.weight) {
              stageWeights[stage.name] = stage.weight;
            }
          });
        }
      }
      
      // Если нет информации о весах этапов, считаем все этапы одинаковыми
      if (Object.keys(stageWeights).length === 0) {
        const equalWeight = 1 / Math.max(1, allStages.length);
        allStages.forEach(stage => {
          stageWeights[stage.stage] = equalWeight;
        });
      }
      
      // Рассчитываем общий прогресс
      let overallProgress = 0;
      
      allStages.forEach(stage => {
        const stageWeight = stageWeights[stage.stage] || (1 / allStages.length);
        const stageProgress = stage.progress || 0;
        
        overallProgress += stageWeight * stageProgress;
      });
      
      // Округляем до целого числа
      return Math.round(overallProgress);
    } finally {
      // Возвращаем соединение в пул
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при расчете общего прогресса задачи ${taskId}:`, error);
    return 0;
  }
}

module.exports = {
  updateTaskProgress,
  updateTaskStatus,
  sendTaskLog,
  startTaskStage,
  updateTaskStageProgress,
  completeTaskStage,
  calculateOverallProgress
};
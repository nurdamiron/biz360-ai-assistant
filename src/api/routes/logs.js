// src/api/routes/logs.js

const express = require('express');
const router = express.Router();
const { pool } = require('../../config/db.config');
const taskLogger = require('../../utils/task-logger');
const logger = require('../../utils/logger');
const { authenticateCombined } = require('../middleware/auth');

/**
 * @route   GET /api/logs/task/:taskId
 * @desc    Получить логи выполнения задачи
 * @access  Private
 */
router.get('/task/:taskId', authenticateCombined, async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const { limit = 100, offset = 0, logType } = req.query;
    
    // Проверяем существование задачи
    const connection = await pool.getConnection();
    
    const [tasks] = await connection.query(
      'SELECT id FROM tasks WHERE id = ?',
      [taskId]
    );
    
    connection.release();
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    // Получаем логи задачи
    const logs = await taskLogger.getTaskLogs(taskId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      logType
    });
    
    res.json({
      taskId,
      logs,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: await getTaskLogsCount(taskId, logType)
      }
    });
  } catch (error) {
    logger.error(`Ошибка при получении логов задачи #${req.params.taskId}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при получении логов задачи' });
  }
});

/**
 * @route   GET /api/logs/system
 * @desc    Получить системные логи
 * @access  Private
 */
router.get('/system', authenticateCombined, async (req, res) => {
  try {
    const { limit = 100, offset = 0, level, search } = req.query;
    
    // В реальной системе здесь должно быть получение логов из файловой системы или БД
    // В данном примере возвращаем заглушку
    
    res.json({
      logs: [
        { timestamp: new Date(), level: 'info', message: 'Пример системного лога' },
        { timestamp: new Date(), level: 'error', message: 'Пример ошибки' }
      ],
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: 2
      }
    });
  } catch (error) {
    logger.error('Ошибка при получении системных логов:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении системных логов' });
  }
});

/**
 * @route   GET /api/logs/llm
 * @desc    Получить логи взаимодействия с LLM
 * @access  Private
 */
router.get('/llm', authenticateCombined, async (req, res) => {
  try {
    const { limit = 20, offset = 0, taskId } = req.query;
    
    const connection = await pool.getConnection();
    
    let query = 'SELECT * FROM llm_interactions';
    const params = [];
    
    if (taskId) {
      query += ' WHERE task_id = ?';
      params.push(parseInt(taskId));
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [interactions] = await connection.query(query, params);
    
    // Получаем общее количество для пагинации
    let countQuery = 'SELECT COUNT(*) as count FROM llm_interactions';
    const countParams = [];
    
    if (taskId) {
      countQuery += ' WHERE task_id = ?';
      countParams.push(parseInt(taskId));
    }
    
    const [countResult] = await connection.query(countQuery, countParams);
    
    connection.release();
    
    res.json({
      interactions: interactions.map(interaction => ({
        id: interaction.id,
        taskId: interaction.task_id,
        modelUsed: interaction.model_used,
        tokensUsed: interaction.tokens_used,
        createdAt: interaction.created_at,
        // Для экономии трафика не возвращаем полные промпты и ответы
        promptPreview: interaction.prompt.substring(0, 100) + '...',
        responsePreview: interaction.response.substring(0, 100) + '...'
      })),
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: countResult[0].count
      }
    });
  } catch (error) {
    logger.error('Ошибка при получении логов LLM:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении логов LLM' });
  }
});

/**
 * @route   GET /api/logs/llm/:id
 * @desc    Получить детальную информацию о взаимодействии с LLM
 * @access  Private
 */
router.get('/llm/:id', authenticateCombined, async (req, res) => {
  try {
    const interactionId = parseInt(req.params.id);
    
    const connection = await pool.getConnection();
    
    const [interactions] = await connection.query(
      'SELECT * FROM llm_interactions WHERE id = ?',
      [interactionId]
    );
    
    connection.release();
    
    if (interactions.length === 0) {
      return res.status(404).json({ error: 'Взаимодействие не найдено' });
    }
    
    const interaction = interactions[0];
    
    res.json({
      id: interaction.id,
      taskId: interaction.task_id,
      prompt: interaction.prompt,
      response: interaction.response,
      modelUsed: interaction.model_used,
      tokensUsed: interaction.tokens_used,
      createdAt: interaction.created_at
    });
  } catch (error) {
    logger.error(`Ошибка при получении информации о взаимодействии #${req.params.id}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при получении информации о взаимодействии' });
  }
});

/**
 * Получает общее количество логов задачи
 * @param {number} taskId - ID задачи
 * @param {string} [logType] - Тип лога для фильтрации
 * @returns {Promise<number>} - Количество логов
 */
async function getTaskLogsCount(taskId, logType) {
  try {
    const connection = await pool.getConnection();
    
    let query = 'SELECT COUNT(*) as count FROM task_logs WHERE task_id = ?';
    const params = [taskId];
    
    if (logType) {
      query += ' AND log_type = ?';
      params.push(logType);
    }
    
    const [result] = await connection.query(query, params);
    
    connection.release();
    
    return result[0].count;
  } catch (error) {
    logger.error(`Ошибка при получении количества логов для задачи #${taskId}:`, error);
    return 0;
  }
}

module.exports = router;
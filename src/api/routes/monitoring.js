// src/api/routes/monitoring.js

const express = require('express');
const router = express.Router();
const { getLLMClient } = require('../../utils/llm-client');
const tokenManager = require('../../utils/token-manager');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const os = require('os');

/**
 * @route   GET /api/monitoring/system
 * @desc    Получить информацию о состоянии системы
 * @access  Private
 */
router.get('/system', async (req, res) => {
  try {
    // Собираем системную информацию
    const systemInfo = {
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: {
          total: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
          free: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
          usage: Math.round((1 - os.freemem() / os.totalmem()) * 100) + '%'
        },
        cpus: os.cpus().length,
        uptime: formatUptime(process.uptime())
      },
      process: {
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: formatUptime(process.uptime())
      }
    };
    
    res.json(systemInfo);
  } catch (error) {
    logger.error('Ошибка при получении системной информации:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении системной информации' });
  }
});

/**
 * @route   GET /api/monitoring/database
 * @desc    Проверить состояние базы данных
 * @access  Private
 */
router.get('/database', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Получаем информацию о соединении
    const [connectionInfo] = await connection.query('SELECT VERSION() as version');
    
    // Получаем статистику по таблицам
    const [tables] = await connection.query(`
      SELECT table_name, 
             table_rows, 
             data_length, 
             index_length,
             create_time, 
             update_time
      FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_rows DESC
    `, [process.env.DB_NAME]);
    
    // Проверяем производительность
    const startTime = Date.now();
    await connection.query('SELECT 1');
    const queryTime = Date.now() - startTime;
    
    connection.release();
    
    res.json({
      status: 'connected',
      version: connectionInfo[0].version,
      responseTime: queryTime + 'ms',
      tables: tables.map(table => ({
        name: table.table_name,
        rows: table.table_rows,
        dataSize: formatBytes(table.data_length),
        indexSize: formatBytes(table.index_length),
        created: table.create_time,
        updated: table.update_time
      }))
    });
  } catch (error) {
    logger.error('Ошибка при проверке состояния базы данных:', error);
    res.status(500).json({ error: 'Ошибка сервера при проверке состояния базы данных' });
  }
});

/**
 * @route   GET /api/monitoring/llm
 * @desc    Получить статистику LLM-запросов
 * @access  Private
 */
router.get('/llm', async (req, res) => {
  try {
    const llmClient = getLLMClient();
    
    // Получаем статистику производительности
    const performanceStats = llmClient.getPerformanceStats();
    
    // Получаем исторические данные о токенах
    const connection = await pool.getConnection();
    
    // Проверяем существование таблицы
    const [tables] = await connection.query(
      'SHOW TABLES LIKE "llm_token_usage"'
    );
    
    let historicalData = [];
    
    // Если таблица существует, получаем данные за последние 30 дней
    if (tables.length > 0) {
      const [rows] = await connection.query(`
        SELECT date, prompt_tokens, completion_tokens, total_tokens
        FROM llm_token_usage
        WHERE date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
        ORDER BY date ASC
      `);
      
      historicalData = rows;
    }
    
    connection.release();
    
    res.json({
      currentStats: performanceStats,
      historicalData
    });
  } catch (error) {
    logger.error('Ошибка при получении статистики LLM:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении статистики LLM' });
  }
});

/**
 * @route   GET /api/monitoring/tasks
 * @desc    Получить статистику по задачам
 * @access  Private
 */
router.get('/tasks', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Общая статистика по задачам
    const [taskStats] = await connection.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks
    `);
    
    // Статистика по проектам
    const [projectStats] = await connection.query(`
      SELECT 
        p.id, 
        p.name,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      GROUP BY p.id
    `);
    
    // Статистика по типам генераций
    const [generationStats] = await connection.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'implemented' THEN 1 ELSE 0 END) as implemented
      FROM code_generations
    `);
    
    // Статистика по времени выполнения задач
    const [timeStats] = await connection.query(`
      SELECT 
        AVG(TIMESTAMPDIFF(MINUTE, created_at, completed_at)) as avg_completion_time
      FROM tasks
      WHERE status = 'completed' AND completed_at IS NOT NULL
    `);
    
    connection.release();
    
    res.json({
      tasks: taskStats[0],
      projects: projectStats,
      generations: generationStats[0],
      performance: {
        avgCompletionTime: timeStats[0].avg_completion_time 
          ? Math.round(timeStats[0].avg_completion_time) + ' min' 
          : 'N/A'
      }
    });
  } catch (error) {
    logger.error('Ошибка при получении статистики задач:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении статистики задач' });
  }
});

/**
 * @route   GET /api/monitoring/logs
 * @desc    Получить последние логи системы
 * @access  Private
 */
router.get('/logs', async (req, res) => {
  try {
    const { lines = 100, level = 'info' } = req.query;
    
    // Получаем последние логи из БД или файла
    // В реальной системе здесь должен быть код для чтения логов
    // Для примера возвращаем заглушку
    
    res.json({
      logs: [
        { timestamp: new Date(), level: 'info', message: 'Пример лога информационного уровня' },
        { timestamp: new Date(), level: 'warn', message: 'Пример лога уровня предупреждения' },
        { timestamp: new Date(), level: 'error', message: 'Пример лога уровня ошибки' }
      ],
      query: { lines, level }
    });
  } catch (error) {
    logger.error('Ошибка при получении логов:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении логов' });
  }
});

/**
 * @route   POST /api/monitoring/optimize-cache
 * @desc    Оптимизировать кэш системы
 * @access  Private
 */
router.post('/optimize-cache', async (req, res) => {
  try {
    const llmClient = getLLMClient();
    
    // Очищаем кэш LLM
    llmClient.clearCache();
    
    // Очищаем другие кэши при необходимости
    
    res.json({ 
      success: true, 
      message: 'Кэш успешно оптимизирован' 
    });
  } catch (error) {
    logger.error('Ошибка при оптимизации кэша:', error);
    res.status(500).json({ error: 'Ошибка сервера при оптимизации кэша' });
  }
});

/**
 * @route   GET /api/monitoring/health
 * @desc    Проверить здоровье системы
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const healthChecks = {
      api: { status: 'healthy' },
      database: await checkDatabaseHealth(),
      llm: await checkLLMHealth()
    };
    
    const isHealthy = Object.values(healthChecks)
      .every(check => check.status === 'healthy');
    
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      checks: healthChecks,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Ошибка при проверке здоровья системы:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Ошибка сервера при проверке здоровья системы'
    });
  }
});

/**
 * Проверяет здоровье базы данных
 * @returns {Promise<Object>} - Результат проверки
 */
async function checkDatabaseHealth() {
  try {
    const connection = await pool.getConnection();
    const startTime = Date.now();
    await connection.query('SELECT 1');
    const responseTime = Date.now() - startTime;
    connection.release();
    
    return { 
      status: 'healthy', 
      responseTime: responseTime + 'ms' 
    };
  } catch (error) {
    logger.error('Ошибка при проверке здоровья БД:', error);
    return { 
      status: 'unhealthy', 
      error: error.message 
    };
  }
}

/**
 * Проверяет здоровье LLM API
 * @returns {Promise<Object>} - Результат проверки
 */
async function checkLLMHealth() {
  try {
    const llmClient = getLLMClient();
    
    // Проверяем наличие API ключа
    if (!llmClient.apiKey) {
      return { 
        status: 'unhealthy', 
        error: 'API ключ не настроен' 
      };
    }
    
    return { status: 'healthy' };
  } catch (error) {
    logger.error('Ошибка при проверке здоровья LLM:', error);
    return { 
      status: 'unhealthy', 
      error: error.message 
    };
  }
}

/**
 * Форматирует время работы в человекочитаемый формат
 * @param {number} seconds - Время в секундах
 * @returns {string} - Отформатированное время
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

/**
 * Форматирует байты в человекочитаемый формат
 * @param {number} bytes - Размер в байтах
 * @returns {string} - Отформатированный размер
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
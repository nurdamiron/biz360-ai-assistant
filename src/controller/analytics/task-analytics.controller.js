// src/controller/analytics/task-analytics.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Контроллер для аналитики по задачам и подзадачам
 */
const taskAnalyticsController = {
  /**
   * Получить статистику по задачам проекта
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskStats(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
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
      
      // Получаем детальную статистику задач
      const [taskStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalTasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTasks,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blockedTasks,
          AVG(estimated_hours) as avgEstimatedHours,
          AVG(actual_hours) as avgActualHours,
          SUM(estimated_hours) as totalEstimatedHours,
          SUM(actual_hours) as totalActualHours
        FROM tasks 
        WHERE project_id = ?
      `, [projectId]);
      
      // Получаем статистику по времени выполнения задач
      const [timeStats] = await connection.query(`
        SELECT 
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTimeHours,
          MIN(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as minCompletionTimeHours,
          MAX(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as maxCompletionTimeHours
        FROM tasks
        WHERE project_id = ? AND status = 'completed' AND completed_at IS NOT NULL
      `, [projectId]);
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          taskStats: taskStats[0],
          timeStats: timeStats[0]
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении статистики задач для проекта #${req.params.projectId}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении статистики задач' 
      });
    }
  },

  /**
   * Получить статистику по подзадачам
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getSubtaskStats(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Задача не найдена' 
        });
      }
      
      // Получаем статистику по подзадачам
      const [subtaskStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalSubtasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedSubtasks,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressSubtasks,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingSubtasks,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blockedSubtasks,
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTimeHours
        FROM subtasks
        WHERE task_id = ?
      `, [taskId]);
      
      // Получаем ход выполнения задачи
      const [taskProgress] = await connection.query(`
        SELECT 
          (SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*)) * 100 as completionPercentage,
          COUNT(*) as totalSubtasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedSubtasks
        FROM subtasks
        WHERE task_id = ?
      `, [taskId]);
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          subtaskStats: subtaskStats[0],
          taskProgress: taskProgress[0]
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении статистики подзадач для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении статистики подзадач' 
      });
    }
  },

  /**
   * Получить временную линию выполнения задач
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskTimeline(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
      const { period = 'weekly', limit = 10 } = req.query;
      
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
      
      // Определяем формат группировки по времени
      let dateFormat, groupBy;
      switch (period) {
        case 'daily':
          dateFormat = '%Y-%m-%d';
          groupBy = 'DAY';
          break;
        case 'weekly':
          dateFormat = '%Y-%u'; // Год и номер недели
          groupBy = 'WEEK';
          break;
        case 'monthly':
          dateFormat = '%Y-%m';
          groupBy = 'MONTH';
          break;
        default:
          dateFormat = '%Y-%u';
          groupBy = 'WEEK';
      }
      
      // Получаем временную линию задач
      const [timeline] = await connection.query(`
        SELECT 
          DATE_FORMAT(created_at, ?) as period,
          COUNT(*) as tasksCreated,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted,
          MAX(created_at) as periodEnd
        FROM tasks
        WHERE project_id = ?
        GROUP BY DATE_FORMAT(created_at, ?)
        ORDER BY periodEnd DESC
        LIMIT ?
      `, [dateFormat, projectId, dateFormat, parseInt(limit)]);
      
      // Преобразуем формат периода для удобства использования
      const formattedTimeline = timeline.map(item => {
        let periodLabel;
        
        if (period === 'daily') {
          periodLabel = item.period; // Уже в формате YYYY-MM-DD
        } else if (period === 'weekly') {
          // Преобразуем YYYY-WW в более читаемый формат
          const [year, week] = item.period.split('-');
          periodLabel = `Week ${week}, ${year}`;
        } else if (period === 'monthly') {
          // Преобразуем YYYY-MM в формат с названием месяца
          const [year, month] = item.period.split('-');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          periodLabel = `${monthNames[parseInt(month) - 1]} ${year}`;
        }
        
        return {
          ...item,
          periodLabel
        };
      });
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          timeline: formattedTimeline,
          period
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении временной линии задач для проекта #${req.params.projectId}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении временной линии задач' 
      });
    }
  },

  /**
   * Получить распределение задач по тегам
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTasksByTags(req, res) {
    try {
      const projectId = parseInt(req.params.projectId);
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
      
      // Получаем распределение задач по тегам
      const [tagDistribution] = await connection.query(`
        SELECT 
          tt.tag_name,
          COUNT(DISTINCT t.id) as taskCount,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedCount,
          AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.completed_at)) as avgCompletionTime
        FROM task_tags tt
        JOIN tasks t ON tt.task_id = t.id
        WHERE t.project_id = ?
        GROUP BY tt.tag_name
        ORDER BY taskCount DESC
      `, [projectId]);
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          tagDistribution
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении распределения задач по тегам для проекта #${req.params.projectId}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении распределения задач по тегам' 
      });
    }
  }
};

module.exports = taskAnalyticsController;
// src/controllers/project-stats.controller.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');

/**
 * Контроллер для работы со статистикой проектов
 */
const projectStatsController = {
  /**
   * Получить статистику по проекту
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjectStats(req, res) {
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
  }
};

module.exports = projectStatsController;
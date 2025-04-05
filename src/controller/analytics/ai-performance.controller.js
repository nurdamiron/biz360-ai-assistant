// src/controller/analytics/ai-performance.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Контроллер для отслеживания производительности ИИ-ассистента
 */
const aiPerformanceController = {
  /**
   * Получить общую статистику производительности ИИ-ассистента
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getOverallPerformance(req, res) {
    try {
      const { projectId } = req.query;
      const connection = await pool.getConnection();
      
      // Базовые условия фильтрации по проекту
      const projectCondition = projectId ? 'AND t.project_id = ?' : '';
      const params = projectId ? [parseInt(projectId)] : [];
      
      // Получаем статистику по генерации кода
      const [codeGenStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalGenerations,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedGenerations,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedGenerations,
          SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pendingGenerations,
          SUM(CASE WHEN status = 'implemented' THEN 1 ELSE 0 END) as implementedGenerations,
          AVG(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) * 100 as approvalRate
        FROM code_generations cg
        JOIN tasks t ON cg.task_id = t.id
        WHERE 1=1 ${projectCondition}
      `, params);
      
      // Получаем статистику по проверкам кода
      const [reviewStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalReviews,
          AVG(score) as avgScore,
          MIN(score) as minScore,
          MAX(score) as maxScore,
          COUNT(DISTINCT task_id) as tasksWithReviews
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE 1=1 ${projectCondition}
      `, params);
      
      // Получаем статистику по декомпозиции задач
      const [taskDecompositionStats] = await connection.query(`
        SELECT 
          COUNT(t.id) as totalTasks,
          SUM(CASE WHEN subcount.count > 0 THEN 1 ELSE 0 END) as tasksWithSubtasks,
          SUM(CASE WHEN subcount.count = 0 THEN 1 ELSE 0 END) as tasksWithoutSubtasks,
          AVG(CASE WHEN subcount.count > 0 THEN subcount.count ELSE NULL END) as avgSubtasksPerTask
        FROM tasks t
        LEFT JOIN (
          SELECT task_id, COUNT(*) as count
          FROM subtasks
          GROUP BY task_id
        ) subcount ON t.id = subcount.task_id
        WHERE 1=1 ${projectCondition}
      `, params);
      
      // Получаем статистику по времени выполнения ИИ
      const [aiTimingStats] = await connection.query(`
        SELECT 
          AVG(TIMESTAMPDIFF(MINUTE, t.created_at, s.created_at)) as avgTimeToDecompose,
          AVG(TIMESTAMPDIFF(MINUTE, COALESCE(s.created_at, t.created_at), cg.created_at)) as avgTimeToGenerateCode
        FROM tasks t
        LEFT JOIN (
          SELECT task_id, MIN(created_at) as created_at
          FROM subtasks
          GROUP BY task_id
        ) s ON t.id = s.task_id
        LEFT JOIN (
          SELECT task_id, MIN(created_at) as created_at
          FROM code_generations
          GROUP BY task_id
        ) cg ON t.id = cg.task_id
        WHERE 1=1 ${projectCondition}
      `, params);
      
      connection.release();
      
      // Формируем ответ
      const response = {
        codeGeneration: {
          ...codeGenStats[0],
          approvalRate: parseFloat(codeGenStats[0].approvalRate).toFixed(2) + '%'
        },
        codeReviews: {
          ...reviewStats[0],
          avgScore: parseFloat(reviewStats[0].avgScore).toFixed(2)
        },
        taskDecomposition: {
          ...taskDecompositionStats[0],
          decompositionRate: taskDecompositionStats[0].totalTasks > 0 
            ? (taskDecompositionStats[0].tasksWithSubtasks / taskDecompositionStats[0].totalTasks * 100).toFixed(2) + '%' 
            : '0%'
        },
        timing: {
          ...aiTimingStats[0],
          avgTimeToDecompose: aiTimingStats[0].avgTimeToDecompose 
            ? `${Math.round(aiTimingStats[0].avgTimeToDecompose)} минут` 
            : 'N/A',
          avgTimeToGenerateCode: aiTimingStats[0].avgTimeToGenerateCode 
            ? `${Math.round(aiTimingStats[0].avgTimeToGenerateCode)} минут` 
            : 'N/A'
        }
      };
      
      res.json({
        success: true,
        data: response
      });
    } catch (error) {
      logger.error('Ошибка при получении общей производительности ИИ:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении производительности ИИ' 
      });
    }
  },

  /**
   * Получить статистику по языкам программирования
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getLanguageStats(req, res) {
    try {
      const { projectId } = req.query;
      const connection = await pool.getConnection();
      
      // Базовые условия фильтрации по проекту
      const projectCondition = projectId ? 'AND t.project_id = ?' : '';
      const params = projectId ? [parseInt(projectId)] : [];
      
      // Получаем статистику по языкам программирования
      const [languageStats] = await connection.query(`
        SELECT 
          language,
          COUNT(*) as count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedCount,
          AVG(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) * 100 as approvalRate
        FROM code_generations cg
        JOIN tasks t ON cg.task_id = t.id
        WHERE 1=1 ${projectCondition}
        GROUP BY language
        ORDER BY count DESC
      `, params);
      
      // Форматируем данные и считаем отношение успеха
      const formattedLanguageStats = languageStats.map(lang => ({
        ...lang,
        approvalRate: parseFloat(lang.approvalRate).toFixed(2) + '%',
        successRatio: lang.count > 0 
          ? (lang.approvedCount / lang.count).toFixed(2) 
          : '0.00'
      }));
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          languages: formattedLanguageStats
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении статистики по языкам программирования:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении статистики по языкам программирования' 
      });
    }
  },

  /**
   * Получить частые ошибки и проблемы в коде ИИ
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getCommonIssues(req, res) {
    try {
      const { projectId, limit = 10 } = req.query;
      const connection = await pool.getConnection();
      
      // Базовые условия фильтрации по проекту
      const projectCondition = projectId ? 'AND t.project_id = ?' : '';
      const params = [...(projectId ? [parseInt(projectId)] : []), parseInt(limit)];
      
      // Получаем частые ошибки из результатов проверок кода
      // Извлекаем данные из JSON с issues
      const [commonIssues] = await connection.query(`
        SELECT 
          JSON_EXTRACT(cr.review_result, '$.issues[*].severity') as severity,
          JSON_EXTRACT(cr.review_result, '$.issues[*].description') as description,
          COUNT(*) as count
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE cr.review_result IS NOT NULL ${projectCondition}
        GROUP BY severity, description
        ORDER BY count DESC
        LIMIT ?
      `, params);
      
      // Форматируем результаты для удобства чтения
      const formattedIssues = commonIssues.map(issue => {
        try {
          // Парсим JSON из строк
          const severity = JSON.parse(issue.severity);
          const description = JSON.parse(issue.description);
          
          return {
            severity: typeof severity === 'string' ? severity : 'unknown',
            description: typeof description === 'string' ? description : 'Unknown issue',
            count: issue.count
          };
        } catch (e) {
          return {
            severity: 'unknown',
            description: 'Failed to parse issue data',
            count: issue.count
          };
        }
      });
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          commonIssues: formattedIssues
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении частых проблем в коде:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении частых проблем в коде' 
      });
    }
  },

  /**
   * Получить тренд качества кода по времени
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getCodeQualityTrend(req, res) {
    try {
      const { projectId, period = 'weekly', limit = 12 } = req.query;
      const connection = await pool.getConnection();
      
      // Определяем формат группировки по времени
      let dateFormat;
      switch (period) {
        case 'daily':
          dateFormat = '%Y-%m-%d';
          break;
        case 'weekly':
          dateFormat = '%Y-%u'; // Год и номер недели
          break;
        case 'monthly':
          dateFormat = '%Y-%m';
          break;
        default:
          dateFormat = '%Y-%u';
      }
      
      // Базовые условия фильтрации по проекту
      const projectCondition = projectId ? 'AND t.project_id = ?' : '';
      const params = [...(projectId ? [parseInt(projectId)] : []), dateFormat, dateFormat, parseInt(limit)];
      
      // Получаем тренд качества кода по времени
      const [qualityTrend] = await connection.query(`
        SELECT 
          DATE_FORMAT(cr.created_at, ?) as period,
          AVG(cr.score) as avgScore,
          MIN(cr.score) as minScore,
          MAX(cr.score) as maxScore,
          COUNT(*) as reviewCount,
          MAX(cr.created_at) as periodEnd
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE 1=1 ${projectCondition}
        GROUP BY DATE_FORMAT(cr.created_at, ?)
        ORDER BY periodEnd DESC
        LIMIT ?
      `, params);
      
      // Преобразуем формат периода для удобства использования
      const formattedTrend = qualityTrend.map(item => {
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
          periodLabel,
          avgScore: parseFloat(item.avgScore).toFixed(2)
        };
      });
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          qualityTrend: formattedTrend,
          period
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении тренда качества кода:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении тренда качества кода' 
      });
    }
  },

  /**
   * Получить обучающие рекомендации на основе ошибок ИИ
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getLearningRecommendations(req, res) {
    try {
      const { projectId } = req.query;
      const connection = await pool.getConnection();
      
      // Базовые условия фильтрации по проекту
      const projectCondition = projectId ? 'AND t.project_id = ?' : '';
      const params = projectId ? [parseInt(projectId)] : [];
      
      // Получаем рекомендации на основе ошибок в коде
      const [issueAreas] = await connection.query(`
        SELECT 
          JSON_EXTRACT(cr.review_result, '$.issues[*].severity') as severity,
          JSON_EXTRACT(cr.review_result, '$.issues[*].description') as description,
          COUNT(*) as count,
          cr.language,
          AVG(cr.score) as avgScore
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE cr.review_result IS NOT NULL ${projectCondition}
        GROUP BY severity, description, cr.language
        ORDER BY count DESC
        LIMIT 5
      `, params);
      
      // Получаем самые сложные задачи для ИИ
      const [challengingTasks] = await connection.query(`
        SELECT 
          t.id,
          t.title,
          t.description,
          MIN(cr.score) as minScore,
          AVG(cr.score) as avgScore,
          COUNT(cg.id) as generationAttempts,
          t.project_id
        FROM tasks t
        JOIN code_reviews cr ON t.id = cr.task_id
        JOIN code_generations cg ON t.id = cg.task_id
        WHERE cr.score < 5 ${projectCondition}
        GROUP BY t.id
        ORDER BY minScore ASC, generationAttempts DESC
        LIMIT 5
      `, params);
      
      // Формируем учебные рекомендации
      const learningRecommendations = [];
      
      // Добавляем рекомендации по областям проблем
      issueAreas.forEach(issue => {
        try {
          const severity = JSON.parse(issue.severity);
          const description = JSON.parse(issue.description);
          
          learningRecommendations.push({
            type: 'issue_area',
            title: `Улучшить обработку ${issue.language} проблем: ${severity}`,
            description: typeof description === 'string' ? description : 'Проблемная область код',
            frequency: issue.count,
            language: issue.language,
            importance: 'high'
          });
        } catch (e) {
          // Пропускаем некорректные данные
        }
      });
      
      // Добавляем рекомендации по сложным задачам
      challengingTasks.forEach(task => {
        learningRecommendations.push({
          type: 'challenging_task',
          title: `Изучить сложную задачу: ${task.title}`,
          description: 'Эта задача вызвала затруднения у ИИ-ассистента',
          taskId: task.id,
          score: parseFloat(task.minScore).toFixed(1),
          attempts: task.generationAttempts,
          importance: 'medium'
        });
      });
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          recommendations: learningRecommendations
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении обучающих рекомендаций:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении обучающих рекомендаций' 
      });
    }
  }
};

module.exports = aiPerformanceController;
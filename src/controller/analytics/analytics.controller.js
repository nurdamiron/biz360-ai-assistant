// src/controller/analytics/analytics.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Контроллер для получения аналитических данных проектов и задач
 */
const analyticsController = {
  /**
   * Получить общую статистику по всем проектам
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getGlobalStats(req, res) {
    try {
      const connection = await pool.getConnection();
      
      // Получаем статистику по проектам
      const [projectStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalProjects,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as newProjectsLast7Days,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as newProjectsLast30Days
        FROM projects
      `);
      
      // Получаем статистику по задачам
      const [taskStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalTasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTasks,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blockedTasks,
          SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as newTasksLast7Days,
          SUM(CASE WHEN completed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as completedTasksLast7Days
        FROM tasks
      `);
      
      // Получаем среднее время выполнения задач (в часах)
      const [avgCompletionTime] = await connection.query(`
        SELECT 
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTimeHours
        FROM tasks
        WHERE status = 'completed' AND completed_at IS NOT NULL
      `);
      
      // Получаем статистику по активности пользователей
      const [userActivityStats] = await connection.query(`
        SELECT 
          COUNT(DISTINCT user_id) as activeUsers,
          COUNT(*) as totalActivities
        FROM task_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);
      
      // Получаем статистику по использованию AI
      const [aiUsageStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalGenerations,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedGenerations,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedGenerations
        FROM code_generations
      `);
      
      connection.release();
      
      // Формируем результат
      const result = {
        projects: projectStats[0],
        tasks: taskStats[0],
        performance: {
          avgCompletionTimeHours: avgCompletionTime[0].avgCompletionTimeHours || 0,
          activeUsers: userActivityStats[0].activeUsers || 0,
          totalActivities: userActivityStats[0].totalActivities || 0
        },
        aiUsage: aiUsageStats[0]
      };
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Ошибка при получении глобальной статистики:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении глобальной статистики' 
      });
    }
  },

  /**
   * Получить статистику по проекту
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjectAnalytics(req, res) {
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
      
      // Получаем распределение задач по исполнителям
      const [assigneeDistribution] = await connection.query(`
        SELECT 
          u.id,
          u.username,
          COUNT(t.id) as totalAssigned,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
          AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.completed_at)) as avgCompletionTime
        FROM tasks t
        JOIN users u ON t.assigned_to = u.id
        WHERE t.project_id = ? AND t.assigned_to IS NOT NULL
        GROUP BY t.assigned_to
        ORDER BY totalAssigned DESC
      `, [projectId]);
      
      // Получаем распределение задач по времени (по неделям)
      const [timeDistribution] = await connection.query(`
        SELECT 
          YEARWEEK(created_at) as weekId,
          DATE_FORMAT(MIN(created_at), '%Y-%m-%d') as weekStart,
          COUNT(*) as tasksCreated,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted
        FROM tasks
        WHERE project_id = ?
        GROUP BY YEARWEEK(created_at)
        ORDER BY weekId DESC
        LIMIT 10
      `, [projectId]);
      
      // Получаем статистику по тегам задач
      const [tagsDistribution] = await connection.query(`
        SELECT 
          tt.tag_name,
          COUNT(*) as taskCount,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedCount,
          AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.completed_at)) as avgCompletionTime
        FROM task_tags tt
        JOIN tasks t ON tt.task_id = t.id
        WHERE t.project_id = ?
        GROUP BY tt.tag_name
        ORDER BY taskCount DESC
      `, [projectId]);
      
      // Получаем статистику по использованию AI
      const [aiUsageStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalGenerations,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedGenerations,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejectedGenerations,
          AVG(score) as avgScore
        FROM code_generations cg
        JOIN tasks t ON cg.task_id = t.id
        WHERE t.project_id = ?
      `, [projectId]);
      
      // Получаем качество кода (на основе проверок кода)
      const [codeQualityStats] = await connection.query(`
        SELECT 
          AVG(score) as avgCodeQuality,
          MIN(score) as minCodeQuality,
          MAX(score) as maxCodeQuality
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE t.project_id = ?
      `, [projectId]);
      
      connection.release();
      
      // Формируем результат
      const result = {
        project: projects[0],
        tasks: taskStats[0],
        timePerformance: timeStats[0],
        teamPerformance: {
          assigneeDistribution: assigneeDistribution,
          tagsDistribution: tagsDistribution
        },
        timeline: {
          byWeek: timeDistribution
        },
        aiUsage: aiUsageStats[0],
        codeQuality: codeQualityStats[0]
      };
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Ошибка при получении аналитики для проекта #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении аналитики проекта' 
      });
    }
  },

  /**
   * Получить аналитику пользователя
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getUserAnalytics(req, res) {
    try {
      const userId = req.params.id ? parseInt(req.params.id) : req.user.id;
      const connection = await pool.getConnection();
      
      // Проверяем существование пользователя
      const [users] = await connection.query(
        'SELECT id, username, email, role FROM users WHERE id = ?',
        [userId]
      );
      
      if (users.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Пользователь не найден' 
        });
      }
      
      // Получаем задачи пользователя
      const [taskStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalTasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressTasks,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingTasks,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blockedTasks,
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTimeHours,
          AVG(CASE WHEN estimated_hours > 0 AND actual_hours > 0 
              THEN actual_hours / estimated_hours ELSE NULL END) as estimationAccuracy
        FROM tasks 
        WHERE assigned_to = ?
      `, [userId]);
      
      // Получаем активность пользователя по времени
      const [timeEntryStats] = await connection.query(`
        SELECT 
          SUM(hours) as totalHours,
          AVG(hours) as avgHoursPerTask,
          COUNT(DISTINCT task_id) as tasksWorkedOn
        FROM time_entries
        WHERE user_id = ?
      `, [userId]);
      
      // Получаем распределение задач по проектам
      const [projectDistribution] = await connection.query(`
        SELECT 
          p.id,
          p.name,
          COUNT(t.id) as taskCount,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedCount
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        WHERE t.assigned_to = ?
        GROUP BY p.id
        ORDER BY taskCount DESC
      `, [userId]);
      
      // Получаем статистику по тегам задач пользователя
      const [tagsDistribution] = await connection.query(`
        SELECT 
          tt.tag_name,
          COUNT(*) as taskCount
        FROM task_tags tt
        JOIN tasks t ON tt.task_id = t.id
        WHERE t.assigned_to = ?
        GROUP BY tt.tag_name
        ORDER BY taskCount DESC
        LIMIT 10
      `, [userId]);
      
      // Получаем историю статусов задач (завершено/создано) по неделям
      const [weeklyProgress] = await connection.query(`
        SELECT 
          YEARWEEK(created_at) as weekId,
          DATE_FORMAT(MIN(created_at), '%Y-%m-%d') as weekStart,
          COUNT(*) as tasksAssigned,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted
        FROM tasks
        WHERE assigned_to = ?
        GROUP BY YEARWEEK(created_at)
        ORDER BY weekId DESC
        LIMIT 10
      `, [userId]);
      
      // Получаем статистику по коду
      const [codeStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalReviews,
          AVG(score) as avgCodeQuality,
          COUNT(DISTINCT cr.task_id) as tasksWithReviews
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        WHERE t.assigned_to = ?
      `, [userId]);
      
      // Получаем статистику по времени работы за последние 30 дней
      const [recentActivity] = await connection.query(`
        SELECT 
          DATE(te.started_at) as workDate,
          SUM(te.hours) as hoursWorked,
          COUNT(DISTINCT te.task_id) as tasksWorkedOn
        FROM time_entries te
        WHERE te.user_id = ? AND te.started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(te.started_at)
        ORDER BY workDate DESC
      `, [userId]);
      
      connection.release();
      
      // Формируем результат
      const result = {
        user: users[0],
        tasks: taskStats[0],
        activity: {
          ...timeEntryStats[0],
          recentActivity
        },
        projectDistribution,
        tagsDistribution,
        weeklyProgress,
        codeQuality: codeStats[0]
      };
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Ошибка при получении аналитики для пользователя #${req.params.id || req.user.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении аналитики пользователя' 
      });
    }
  },

  /**
   * Получить аналитику эффективности AI-компонентов
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getAiAnalytics(req, res) {
    try {
      const { projectId } = req.query;
      const connection = await pool.getConnection();
      
      // Базовый запрос для фильтрации
      let projectFilter = '';
      const params = [];
      
      // Фильтрация по проекту, если указан
      if (projectId) {
        projectFilter = 'WHERE t.project_id = ?';
        params.push(parseInt(projectId));
      }
      
      // Получаем общую статистику по генерации кода
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
        ${projectFilter}
      `, params);
      
      // Получаем статистику по языкам программирования
      const [languageStats] = await connection.query(`
        SELECT 
          language,
          COUNT(*) as count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedCount,
          AVG(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) * 100 as approvalRate
        FROM code_generations cg
        JOIN tasks t ON cg.task_id = t.id
        ${projectFilter}
        GROUP BY language
        ORDER BY count DESC
      `, params);
      
      // Получаем статистику по результатам code reviews
      const [reviewStats] = await connection.query(`
        SELECT 
          AVG(score) as avgScore,
          MIN(score) as minScore,
          MAX(score) as maxScore,
          COUNT(*) as totalReviews,
          COUNT(DISTINCT task_id) as tasksWithReviews
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        ${projectFilter}
      `, params);
      
      // Получаем тренд качества кода по времени
      const [scoreOverTime] = await connection.query(`
        SELECT 
          DATE_FORMAT(cr.created_at, '%Y-%m-%d') as date,
          AVG(score) as avgScore,
          COUNT(*) as reviewCount
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        ${projectFilter}
        GROUP BY DATE_FORMAT(cr.created_at, '%Y-%m-%d')
        ORDER BY date DESC
        LIMIT 30
      `, params);
      
      // Получаем часто встречающиеся проблемы в коде
      const [commonIssues] = await connection.query(`
        SELECT 
          JSON_EXTRACT(review_result, '$.issues[*].severity') as severity,
          COUNT(*) as count
        FROM code_reviews cr
        JOIN tasks t ON cr.task_id = t.id
        ${projectFilter}
        GROUP BY severity
        ORDER BY count DESC
        LIMIT 10
      `, params);
      
      // Получаем статистику по декомпозиции задач
      const [taskDecompositionStats] = await connection.query(`
        SELECT 
          AVG(subtask_count) as avgSubtasksPerTask,
          MAX(subtask_count) as maxSubtasksPerTask,
          SUM(CASE WHEN subtask_count > 0 THEN 1 ELSE 0 END) as tasksWithSubtasks,
          SUM(CASE WHEN subtask_count = 0 THEN 1 ELSE 0 END) as tasksWithoutSubtasks
        FROM (
          SELECT 
            t.id,
            COUNT(s.id) as subtask_count
          FROM tasks t
          LEFT JOIN subtasks s ON t.id = s.task_id
          ${projectFilter ? projectFilter : 'WHERE 1=1'}
          GROUP BY t.id
        ) as task_subtasks
      `, params);
      
      connection.release();
      
      // Формируем результат
      const result = {
        codeGeneration: codeGenStats[0],
        languages: languageStats,
        codeReviews: {
          ...reviewStats[0],
          scoreOverTime
        },
        issues: commonIssues,
        taskDecomposition: taskDecompositionStats[0]
      };
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Ошибка при получении аналитики AI-компонентов:', error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении аналитики AI-компонентов' 
      });
    }
  },

  /**
   * Получить аналитику командной эффективности
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTeamAnalytics(req, res) {
    try {
      const { projectId } = req.query;
      
      if (!projectId) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать projectId' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT id, name FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Получаем статистику по участникам проекта
      const [teamStats] = await connection.query(`
        SELECT 
          u.id,
          u.username,
          COUNT(t.id) as assignedTasks,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.completed_at)) as avgCompletionTimeHours,
          SUM(te.hours) as totalHoursLogged
        FROM users u
        LEFT JOIN tasks t ON u.id = t.assigned_to AND t.project_id = ?
        LEFT JOIN time_entries te ON u.id = te.user_id AND te.task_id = t.id
        GROUP BY u.id
        HAVING assignedTasks > 0
        ORDER BY assignedTasks DESC
      `, [projectId]);
      
      // Получаем матрицу взаимодействия команды (кто кому комментирует задачи)
      const [teamInteractions] = await connection.query(`
        SELECT 
          tc.user_id as commenter_id,
          u_commenter.username as commenter_name,
          t.assigned_to as assignee_id,
          u_assignee.username as assignee_name,
          COUNT(*) as comment_count
        FROM task_comments tc
        JOIN tasks t ON tc.task_id = t.id
        JOIN users u_commenter ON tc.user_id = u_commenter.id
        JOIN users u_assignee ON t.assigned_to = u_assignee.id
        WHERE t.project_id = ? AND t.assigned_to IS NOT NULL AND tc.user_id != t.assigned_to
        GROUP BY tc.user_id, t.assigned_to
        ORDER BY comment_count DESC
      `, [projectId]);
      
      // Получаем статистику по совместной работе над задачами
      const [taskCollaboration] = await connection.query(`
        SELECT 
          t.id as task_id,
          t.title as task_title,
          COUNT(DISTINCT tc.user_id) as unique_commenters,
          COUNT(DISTINCT cr.id) as review_count,
          COUNT(DISTINCT cg.id) as generation_count
        FROM tasks t
        LEFT JOIN task_comments tc ON t.id = tc.task_id
        LEFT JOIN code_reviews cr ON t.id = cr.task_id
        LEFT JOIN code_generations cg ON t.id = cg.task_id
        WHERE t.project_id = ?
        GROUP BY t.id
        HAVING unique_commenters > 1 OR review_count > 0 OR generation_count > 0
        ORDER BY unique_commenters DESC, review_count DESC
        LIMIT 10
      `, [projectId]);
      
      // Получаем распределение времени работы по участникам
      const [workTimeDistribution] = await connection.query(`
        SELECT 
          u.id,
          u.username,
          SUM(te.hours) as total_hours,
          COUNT(DISTINCT te.task_id) as tasks_worked_on,
          SUM(CASE WHEN DAYOFWEEK(te.started_at) BETWEEN 2 AND 6 AND 
                  TIME(te.started_at) BETWEEN '09:00:00' AND '18:00:00' 
                THEN te.hours ELSE 0 END) as regular_hours,
          SUM(CASE WHEN DAYOFWEEK(te.started_at) IN (1, 7) OR 
                  TIME(te.started_at) NOT BETWEEN '09:00:00' AND '18:00:00' 
                THEN te.hours ELSE 0 END) as non_regular_hours
        FROM time_entries te
        JOIN users u ON te.user_id = u.id
        JOIN tasks t ON te.task_id = t.id
        WHERE t.project_id = ?
        GROUP BY u.id
        ORDER BY total_hours DESC
      `, [projectId]);
      
      connection.release();
      
      // Формируем результат
      const result = {
        project: projects[0],
        teamMembers: teamStats,
        teamInteractions,
        collaboration: {
          topCollaborativeTasks: taskCollaboration
        },
        workTime: workTimeDistribution
      };
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Ошибка при получении аналитики команды для проекта #${req.query.projectId}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении аналитики команды' 
      });
    }
  },

  /**
   * Получить прогнозы по проекту
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjectPredictions(req, res) {
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
      
      // Получаем данные о скорости выполнения задач
      const [velocityData] = await connection.query(`
        SELECT 
          COUNT(*) as totalTasks,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedTasks,
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTimeHours,
          COUNT(*) / TIMESTAMPDIFF(WEEK, MIN(created_at), GREATEST(MAX(completed_at), NOW())) as tasksPerWeek
        FROM tasks 
        WHERE project_id = ?
      `, [projectId]);
      
      // Получаем количество невыполненных задач
      const [pendingTasks] = await connection.query(`
        SELECT 
          COUNT(*) as pendingTasksCount,
          SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as highPriorityCount,
          SUM(CASE WHEN priority = 'medium' THEN 1 ELSE 0 END) as mediumPriorityCount,
          SUM(CASE WHEN priority = 'low' THEN 1 ELSE 0 END) as lowPriorityCount
        FROM tasks 
        WHERE project_id = ? AND status != 'completed'
      `, [projectId]);
      
      // Получаем историю скорости выполнения по неделям
      const [weeklyVelocity] = await connection.query(`
        SELECT 
          YEARWEEK(created_at) as weekId,
          DATE_FORMAT(MIN(created_at), '%Y-%m-%d') as weekStart,
          COUNT(*) as tasksCreated,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as tasksCompleted,
          AVG(TIMESTAMPDIFF(HOUR, created_at, completed_at)) as avgCompletionTime
        FROM tasks
        WHERE project_id = ?
        GROUP BY YEARWEEK(created_at)
        ORDER BY weekId DESC
        LIMIT 10
      `, [projectId]);
      
      connection.release();
      
      // Базовые статистические данные
      const velocity = velocityData[0];
      const pendingTasksData = pendingTasks[0];
      
      // Простое прогнозирование завершения проекта
      let estimatedCompletionWeeks = 0;
      let estimatedCompletionDate = null;
      
      if (velocity.tasksPerWeek > 0 && pendingTasksData.pendingTasksCount > 0) {
        estimatedCompletionWeeks = Math.ceil(pendingTasksData.pendingTasksCount / velocity.tasksPerWeek);
        
        // Прогнозируемая дата завершения
        const completionDate = new Date();
        completionDate.setDate(completionDate.getDate() + (estimatedCompletionWeeks * 7));
        estimatedCompletionDate = completionDate.toISOString().split('T')[0];
      }
      
      // Формируем результат с прогнозами
      const result = {
        project: projects[0],
        currentVelocity: velocity,
        pendingTasks: pendingTasksData,
        predictions: {
          estimatedCompletionWeeks,
          estimatedCompletionDate,
          confidenceLevel: 'medium', // В реальном приложении здесь был бы алгоритм для определения уровня уверенности
          riskFactors: []
        },
        historicalVelocity: weeklyVelocity
      };
      
      // Определяем риск-факторы
      if (pendingTasksData.highPriorityCount > 0.5 * pendingTasksData.pendingTasksCount) {
        result.predictions.riskFactors.push({
          type: 'high_priority_overload',
          description: 'Большое количество высокоприоритетных задач может задержать выполнение проекта'
        });
      }
      
      if (weeklyVelocity.length >= 2) {
        // Проверяем тренд на понижение скорости
        const recentWeeks = weeklyVelocity.slice(0, 4); // Последние 4 недели
        const velocityTrend = recentWeeks.map(w => w.tasksCompleted);
        
        let decreasingTrend = true;
        for (let i = 0; i < velocityTrend.length - 1; i++) {
          if (velocityTrend[i] >= velocityTrend[i+1]) {
            decreasingTrend = false;
            break;
          }
        }
        
        if (decreasingTrend) {
          result.predictions.riskFactors.push({
            type: 'decreasing_velocity',
            description: 'Скорость выполнения задач снижается в последние недели'
          });
          result.predictions.confidenceLevel = 'low';
        }
      }
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Ошибка при получении прогнозов для проекта #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении прогнозов по проекту' 
      });
    }
  }
};

module.exports = analyticsController;
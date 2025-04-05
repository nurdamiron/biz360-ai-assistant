// src/utils/metrics-collector.js

const { pool } = require('../config/db.config');
const logger = require('./logger');

/**
 * Класс для сбора и агрегации метрик
 */
class MetricsCollector {
  constructor() {
    this.scheduledJobs = [];
  }

  /**
   * Инициализирует коллектор метрик и создает необходимые таблицы
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем, существует ли таблица metrics
      const [tables] = await connection.query(
        'SHOW TABLES LIKE "metrics"'
      );
      
      if (tables.length === 0) {
        // Создаем таблицу metrics
        await connection.query(`
          CREATE TABLE metrics (
            id INT PRIMARY KEY AUTO_INCREMENT,
            metric_name VARCHAR(100) NOT NULL,
            metric_value FLOAT NOT NULL,
            dimensions JSON,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_metric_name (metric_name),
            INDEX idx_timestamp (timestamp)
          )
        `);
        
        logger.info('Таблица metrics успешно создана');
      }
      
      // Проверяем, существует ли таблица metric_aggregations
      const [aggregationTables] = await connection.query(
        'SHOW TABLES LIKE "metric_aggregations"'
      );
      
      if (aggregationTables.length === 0) {
        // Создаем таблицу metric_aggregations
        await connection.query(`
          CREATE TABLE metric_aggregations (
            id INT PRIMARY KEY AUTO_INCREMENT,
            metric_name VARCHAR(100) NOT NULL,
            aggregation_type ENUM('daily', 'weekly', 'monthly') NOT NULL,
            aggregation_date DATE NOT NULL,
            aggregation_value FLOAT NOT NULL,
            dimensions JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_aggregation (metric_name, aggregation_type, aggregation_date, dimensions(100)),
            INDEX idx_metric_name_type (metric_name, aggregation_type),
            INDEX idx_aggregation_date (aggregation_date)
          )
        `);
        
        logger.info('Таблица metric_aggregations успешно создана');
      }
      
      connection.release();
      
      // Запускаем агрегацию метрик
      this.scheduleAggregations();
      
      logger.info('MetricsCollector успешно инициализирован');
    } catch (error) {
      logger.error('Ошибка при инициализации MetricsCollector:', error);
      throw error;
    }
  }

  /**
   * Записывает значение метрики
   * @param {string} metricName - Название метрики
   * @param {number} value - Значение метрики
   * @param {Object} dimensions - Измерения для детализации метрики (опционально)
   * @returns {Promise<void>}
   */
  async recordMetric(metricName, value, dimensions = {}) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        'INSERT INTO metrics (metric_name, metric_value, dimensions) VALUES (?, ?, ?)',
        [metricName, value, JSON.stringify(dimensions)]
      );
      
      connection.release();
    } catch (error) {
      logger.error(`Ошибка при записи метрики ${metricName}:`, error);
      throw error;
    }
  }

  /**
   * Получает последнее значение метрики
   * @param {string} metricName - Название метрики
   * @param {Object} dimensions - Измерения для фильтрации (опционально)
   * @returns {Promise<number|null>} - Последнее значение метрики
   */
  async getLatestMetric(metricName, dimensions = null) {
    try {
      const connection = await pool.getConnection();
      
      let query = 'SELECT metric_value FROM metrics WHERE metric_name = ?';
      const params = [metricName];
      
      // Добавляем фильтр по измерениям, если они указаны
      if (dimensions) {
        // Для каждого ключа в dimensions проверяем, есть ли такой ключ со значением в JSON
        const dimensionFilters = Object.entries(dimensions).map(([key, value]) => {
          return `JSON_CONTAINS(dimensions, '${value}', '$.${key}')`;
        });
        
        if (dimensionFilters.length > 0) {
          query += ` AND ${dimensionFilters.join(' AND ')}`;
        }
      }
      
      query += ' ORDER BY timestamp DESC LIMIT 1';
      
      const [results] = await connection.query(query, params);
      
      connection.release();
      
      if (results.length === 0) {
        return null;
      }
      
      return results[0].metric_value;
    } catch (error) {
      logger.error(`Ошибка при получении метрики ${metricName}:`, error);
      throw error;
    }
  }

  /**
   * Получает агрегированные значения метрики
   * @param {string} metricName - Название метрики
   * @param {string} aggregationType - Тип агрегации ('daily', 'weekly', 'monthly')
   * @param {Object} dimensions - Измерения для фильтрации (опционально)
   * @param {number} limit - Ограничение количества результатов
   * @returns {Promise<Array>} - Массив агрегированных значений
   */
  async getAggregatedMetrics(metricName, aggregationType, dimensions = null, limit = 30) {
    try {
      const connection = await pool.getConnection();
      
      let query = `
        SELECT 
          aggregation_date,
          aggregation_value
        FROM metric_aggregations
        WHERE metric_name = ? AND aggregation_type = ?
      `;
      const params = [metricName, aggregationType];
      
      // Добавляем фильтр по измерениям, если они указаны
      if (dimensions) {
        // Для каждого ключа в dimensions проверяем, есть ли такой ключ со значением в JSON
        const dimensionFilters = Object.entries(dimensions).map(([key, value]) => {
          return `JSON_CONTAINS(dimensions, '${value}', '$.${key}')`;
        });
        
        if (dimensionFilters.length > 0) {
          query += ` AND ${dimensionFilters.join(' AND ')}`;
        }
      }
      
      query += ' ORDER BY aggregation_date DESC LIMIT ?';
      params.push(parseInt(limit));
      
      const [results] = await connection.query(query, params);
      
      connection.release();
      
      return results;
    } catch (error) {
      logger.error(`Ошибка при получении агрегированных метрик ${metricName}:`, error);
      throw error;
    }
  }

  /**
   * Агрегирует метрики за указанный период
   * @param {string} aggregationType - Тип агрегации ('daily', 'weekly', 'monthly')
   * @returns {Promise<void>}
   */
  async aggregateMetrics(aggregationType) {
    try {
      const connection = await pool.getConnection();
      
      // Определяем период агрегации
      let dateFormat, dateInterval;
      switch (aggregationType) {
        case 'daily':
          dateFormat = '%Y-%m-%d';
          dateInterval = 'DAY';
          break;
        case 'weekly':
          dateFormat = '%x-%v'; // ISO год и неделя
          dateInterval = 'WEEK';
          break;
        case 'monthly':
          dateFormat = '%Y-%m';
          dateInterval = 'MONTH';
          break;
        default:
          throw new Error(`Неизвестный тип агрегации: ${aggregationType}`);
      }
      
      // Находим все уникальные имена метрик
      const [metricNames] = await connection.query(
        'SELECT DISTINCT metric_name FROM metrics'
      );
      
      await connection.beginTransaction();
      
      try {
        // Перебираем все метрики и агрегируем их
        for (const { metric_name } of metricNames) {
          // Находим все уникальные комбинации измерений для метрики
          const [dimensionsCombinations] = await connection.query(
            'SELECT DISTINCT dimensions FROM metrics WHERE metric_name = ?',
            [metric_name]
          );
          
          // Для каждой комбинации измерений агрегируем метрики
          for (const { dimensions } of dimensionsCombinations) {
            // Агрегируем метрики по дате
            const [aggregatedMetrics] = await connection.query(`
              SELECT 
                DATE_FORMAT(timestamp, ?) as agg_date,
                AVG(metric_value) as avg_value,
                MAX(metric_value) as max_value,
                MIN(metric_value) as min_value,
                COUNT(*) as count
              FROM metrics
              WHERE 
                metric_name = ? AND 
                dimensions = ? AND
                timestamp >= DATE_SUB(NOW(), INTERVAL 1 ${dateInterval})
              GROUP BY agg_date
            `, [dateFormat, metric_name, dimensions]);
            
            // Сохраняем агрегированные метрики
            for (const metric of aggregatedMetrics) {
              // Определяем дату для агрегации
              let aggregationDate;
              if (aggregationType === 'weekly') {
                // Преобразуем формат ISO недели в дату (первый день недели)
                const [year, week] = metric.agg_date.split('-');
                aggregationDate = this._getFirstDayOfWeek(parseInt(year), parseInt(week));
              } else {
                // Для daily и monthly просто используем дату из agg_date
                aggregationDate = metric.agg_date + (aggregationType === 'daily' ? '' : '-01');
              }
              
              // Записываем агрегированное значение
              await connection.query(`
                INSERT INTO metric_aggregations 
                  (metric_name, aggregation_type, aggregation_date, aggregation_value, dimensions)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                  aggregation_value = ?,
                  created_at = NOW()
              `, [
                metric_name,
                aggregationType,
                aggregationDate,
                metric.avg_value, // используем среднее значение как основное
                dimensions,
                metric.avg_value
              ]);
            }
          }
        }
        
        await connection.commit();
        logger.info(`Агрегация метрик типа ${aggregationType} успешно выполнена`);
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при агрегации метрик типа ${aggregationType}:`, error);
      throw error;
    }
  }

  /**
   * Возвращает первый день недели для указанного года и номера недели
   * @param {number} year - Год
   * @param {number} week - Номер недели
   * @returns {string} - Дата в формате 'YYYY-MM-DD'
   * @private
   */
  _getFirstDayOfWeek(year, week) {
    // Простой алгоритм для определения даты начала недели
    // Неделя 1 - первая неделя, содержащая 4 января
    const date = new Date(year, 0, 1 + (week - 1) * 7);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Корректировка для недель, начинающихся с понедельника
    
    const firstDay = new Date(date.setDate(diff));
    return firstDay.toISOString().split('T')[0];
  }

  /**
   * Планирует регулярную агрегацию метрик
   */
  scheduleAggregations() {
    // В реальном приложении здесь бы использовалась библиотека для планирования задач,
    // например, node-cron. Для примера используем setInterval.
    
    // Ежедневная агрегация (в полночь)
    const dailyAggregation = setInterval(() => {
      this.aggregateMetrics('daily').catch(error => {
        logger.error('Ошибка при ежедневной агрегации метрик:', error);
      });
    }, 24 * 60 * 60 * 1000);
    
    // Еженедельная агрегация (в понедельник)
    const weeklyAggregation = setInterval(() => {
      const now = new Date();
      if (now.getDay() === 1) { // Понедельник
        this.aggregateMetrics('weekly').catch(error => {
          logger.error('Ошибка при еженедельной агрегации метрик:', error);
        });
      }
    }, 24 * 60 * 60 * 1000);
    
    // Ежемесячная агрегация (в первый день месяца)
    const monthlyAggregation = setInterval(() => {
      const now = new Date();
      if (now.getDate() === 1) { // Первый день месяца
        this.aggregateMetrics('monthly').catch(error => {
          logger.error('Ошибка при ежемесячной агрегации метрик:', error);
        });
      }
    }, 24 * 60 * 60 * 1000);
    
    this.scheduledJobs.push(dailyAggregation, weeklyAggregation, monthlyAggregation);
    
    logger.info('Запланирована регулярная агрегация метрик');
  }

  /**
   * Остановить все запланированные задачи агрегации
   */
  stopScheduledAggregations() {
    for (const job of this.scheduledJobs) {
      clearInterval(job);
    }
    this.scheduledJobs = [];
    logger.info('Остановлена регулярная агрегация метрик');
  }

  /**
   * Сохраняет предопределенные метрики системы
   * @returns {Promise<void>}
   */
  async recordSystemMetrics() {
    try {
      const connection = await pool.getConnection();
      
      // Общие метрики
      const [projectCount] = await connection.query('SELECT COUNT(*) as count FROM projects');
      const [taskCount] = await connection.query('SELECT COUNT(*) as count FROM tasks');
      const [userCount] = await connection.query('SELECT COUNT(*) as count FROM users WHERE active = 1');
      
      // Метрики задач
      const [taskStatusCounts] = await connection.query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM tasks
        GROUP BY status
      `);
      
      // Метрики генерации кода
      const [codeGenerationStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalGenerations,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedGenerations
        FROM code_generations
      `);
      
      // Метрики проверки кода
      const [codeReviewStats] = await connection.query(`
        SELECT 
          COUNT(*) as totalReviews,
          AVG(score) as avgScore
        FROM code_reviews
      `);
      
      // Транзакция для записи всех метрик
      await connection.beginTransaction();
      
      try {
        // Записываем общие метрики
        await this.recordMetric('project_count', projectCount[0].count);
        await this.recordMetric('task_count', taskCount[0].count);
        await this.recordMetric('active_user_count', userCount[0].count);
        
        // Записываем метрики по статусам задач
        for (const { status, count } of taskStatusCounts) {
          await this.recordMetric('task_status_count', count, { status });
        }
        
        // Записываем метрику коэффициента выполнения задач
        if (taskCount[0].count > 0) {
          const completedTasksCount = taskStatusCounts.find(s => s.status === 'completed')?.count || 0;
          const completionRate = completedTasksCount / taskCount[0].count;
          await this.recordMetric('task_completion_rate', completionRate);
        }
        
        // Записываем метрики генерации кода
        await this.recordMetric('code_generation_count', codeGenerationStats[0].totalGenerations);
        
        // Коэффициент принятия сгенерированного кода
        if (codeGenerationStats[0].totalGenerations > 0) {
          const approvalRate = codeGenerationStats[0].approvedGenerations / codeGenerationStats[0].totalGenerations;
          await this.recordMetric('code_generation_approval_rate', approvalRate);
        }
        
        // Записываем метрики проверки кода
        await this.recordMetric('code_review_count', codeReviewStats[0].totalReviews);
        if (codeReviewStats[0].totalReviews > 0) {
          await this.recordMetric('code_review_avg_score', codeReviewStats[0].avgScore);
        }
        
        await connection.commit();
        logger.info('Системные метрики успешно записаны');
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error('Ошибка при записи системных метрик:', error);
      throw error;
    }
  }
}

// Синглтон экземпляр для использования во всем приложении
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;
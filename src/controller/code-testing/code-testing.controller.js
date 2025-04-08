// src/controller/code-testing/code-testing.controller.js
const codeTestingSystem = require('../../core/code-testing');
const { TestReport, Task, CodeGeneration } = require('../../models');
const queueManager = require('../../queue/redis-queue');
const queueTypes = require('../../queue/queue-types');
const logger = require('../../utils/logger');

/**
 * Контроллер для тестирования кода
 */
class CodeTestingController {
  /**
   * Тестирование сгенерированного кода
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async testGeneratedCode(req, res) {
    try {
      const { generationId } = req.params;
      
      // Проверяем существование генерации
      const codeGeneration = await CodeGeneration.findByPk(generationId);
      if (!codeGeneration) {
        return res.status(404).json({
          success: false,
          error: 'Code generation not found'
        });
      }
      
      // Проверяем, есть ли уже отчет о тестировании
      const existingReport = await TestReport.findOne({
        where: {
          code_generation_id: generationId
        }
      });
      
      if (existingReport && existingReport.status !== 'error') {
        return res.status(400).json({
          success: false,
          error: 'Test report already exists for this generation',
          testReportId: existingReport.id
        });
      }
      
      // Отправляем задачу тестирования в очередь
      const job = await queueManager.addJob(queueTypes.CODE_TESTING, {
        generationId,
        taskId: codeGeneration.task_id,
        subtaskId: codeGeneration.subtask_id,
        userId: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Code testing queued',
        data: {
          generationId,
          taskId: codeGeneration.task_id,
          jobId: job.id
        }
      });
    } catch (error) {
      logger.error(`Error testing generated code: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to test generated code',
        message: error.message
      });
    }
  }

  /**
   * Тестирование существующего кода
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async testExistingCode(req, res) {
    try {
      const { taskId } = req.params;
      const { filePaths } = req.body;
      
      // Проверяем существование задачи
      const task = await Task.findByPk(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found'
        });
      }
      
      // Проверяем, что указаны пути к файлам
      if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'File paths are required'
        });
      }
      
      // Отправляем задачу тестирования в очередь
      const job = await queueManager.addJob(queueTypes.CODE_TESTING, {
        taskId,
        filePaths,
        userId: req.user.id,
        testExistingCode: true
      });
      
      res.json({
        success: true,
        message: 'Code testing queued',
        data: {
          taskId,
          jobId: job.id
        }
      });
    } catch (error) {
      logger.error(`Error testing existing code: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to test existing code',
        message: error.message
      });
    }
  }

  /**
   * Получение отчета о тестировании
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getTestReport(req, res) {
    try {
      const { reportId } = req.params;
      
      // Получаем отчет о тестировании
      const testReport = await TestReport.findByPk(reportId);
      if (!testReport) {
        return res.status(404).json({
          success: false,
          error: 'Test report not found'
        });
      }
      
      // Преобразуем JSON-поля
      const result = testReport.toJSON();
      
      try { result.validation_results = JSON.parse(result.validation_results || '{}'); } 
      catch (e) { result.validation_results = {}; }
      
      try { result.generated_tests = JSON.parse(result.generated_tests || '[]'); } 
      catch (e) { result.generated_tests = []; }
      
      try { result.test_results = JSON.parse(result.test_results || '{}'); } 
      catch (e) { result.test_results = {}; }
      
      try { result.code_metrics = JSON.parse(result.code_metrics || '{}'); } 
      catch (e) { result.code_metrics = {}; }
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error getting test report: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get test report',
        message: error.message
      });
    }
  }

  /**
   * Получение списка отчетов о тестировании
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getTestReports(req, res) {
    try {
      const { taskId, generationId, status, page = 1, limit = 20 } = req.query;
      
      // Формируем фильтры
      const filters = {};
      
      if (taskId) filters.task_id = taskId;
      if (generationId) filters.code_generation_id = generationId;
      if (status) filters.status = status;
      
      // Параметры пагинации
      const offset = (page - 1) * limit;
      
      // Получаем отчеты о тестировании
      const { count, rows } = await TestReport.findAndCountAll({
        where: filters,
        order: [['created_at', 'DESC']],
        limit,
        offset
      });
      
      // Преобразуем JSON-поля
      const formattedRows = rows.map(report => {
        const result = report.toJSON();
        
        try { result.validation_results = JSON.parse(result.validation_results || '{}'); } 
        catch (e) { result.validation_results = {}; }
        
        try { result.test_results = JSON.parse(result.test_results || '{}'); } 
        catch (e) { result.test_results = {}; }
        
        // Не включаем подробные данные в список
        delete result.generated_tests;
        delete result.code_metrics;
        
        return result;
      });
      
      res.json({
        success: true,
        data: {
          total: count,
          totalPages: Math.ceil(count / limit),
          currentPage: page,
          reports: formattedRows
        }
      });
    } catch (error) {
      logger.error(`Error getting test reports: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get test reports',
        message: error.message
      });
    }
  }
}

module.exports = new CodeTestingController();
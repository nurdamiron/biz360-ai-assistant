// src/core/code-testing/index.js
const logger = require('../../utils/logger');
const testGenerator = require('./test-generator');
const testRunner = require('./test-runner');
const codeValidator = require('./code-validator');
const codeMetricsCollector = require('./code-metrics-collector');
const { CodeGenerationModel, TestReportModel } = require('../../models');
const GitService = require('../../core/vcs-manager/gitService');
const notificationManager = require('../../utils/notification-manager');

/**
 * Главный класс системы тестирования кода
 */
class CodeTestingSystem {
  /**
   * Тестирование сгенерированного кода
   * @param {object} params - Параметры тестирования
   * @param {number} params.generationId - ID генерации кода
   * @param {number} params.taskId - ID задачи
   * @param {number} params.subtaskId - ID подзадачи (если есть)
   * @param {string} params.repoPath - Путь к репозиторию
   * @param {object} params.context - Дополнительный контекст
   * @returns {Promise<object>} - Результаты тестирования
   */
  async testGeneratedCode(params) {
    const { generationId, taskId, subtaskId, repoPath, context } = params;
    
    logger.info(`Starting testing for code generation ID: ${generationId}`);
    
    try {
      // Получаем информацию о сгенерированном коде
      const codeGeneration = await CodeGenerationModel.findByPk(generationId);
      if (!codeGeneration) {
        throw new Error(`Code generation with ID ${generationId} not found`);
      }
      
      // Получаем список сгенерированных файлов
      let generatedFiles = [];
      try {
        generatedFiles = JSON.parse(codeGeneration.generated_files || '[]');
      } catch (e) {
        logger.warn(`Failed to parse generated files for ID ${generationId}: ${e.message}`);
      }
      
      if (generatedFiles.length === 0) {
        throw new Error('No generated files to test');
      }
      
      // Создаем запись о тестировании
      const testReport = await TestReportModel.create({
        code_generation_id: generationId,
        task_id: taskId,
        subtask_id: subtaskId,
        status: 'in_progress',
        started_at: new Date()
      });
      
      // Шаг 1: Валидация кода
      logger.info(`Running code validation for generation ${generationId}`);
      const validationResults = await codeValidator.validateCode({
        files: generatedFiles,
        repoPath,
        context
      });
      
      await testReport.update({
        validation_results: JSON.stringify(validationResults)
      });
      
      // Если есть критические ошибки валидации, останавливаем тестирование
      if (validationResults.criticalErrors.length > 0) {
        logger.warn(`Critical validation errors found for generation ${generationId}`);
        
        await testReport.update({
          status: 'failed',
          completed_at: new Date(),
          summary: 'Testing failed due to critical validation errors',
          success_rate: 0
        });
        
        return {
          success: false,
          testReportId: testReport.id,
          error: 'Critical validation errors detected',
          validationResults
        };
      }
      
      // Шаг 2: Генерация тестов
      logger.info(`Generating tests for code generation ${generationId}`);
      const generatedTests = await testGenerator.generateTests({
        generationId,
        files: generatedFiles,
        repoPath,
        context,
        validationResults
      });
      
      await testReport.update({
        generated_tests: JSON.stringify(generatedTests.tests)
      });
      
      // Шаг 3: Запуск тестов
      logger.info(`Running tests for code generation ${generationId}`);
      const testResults = await testRunner.runTests({
        tests: generatedTests.tests,
        repoPath,
        context
      });
      
      // Шаг 4: Сбор метрик кода
      logger.info(`Collecting code metrics for generation ${generationId}`);
      const codeMetrics = await codeMetricsCollector.collectMetrics({
        files: generatedFiles,
        repoPath
      });
      
      // Рассчитываем общий успех тестирования (процент)
      const successRate = testResults.tests.length > 0
        ? (testResults.tests.filter(t => t.status === 'passed').length / testResults.tests.length) * 100
        : 0;
      
      // Обновляем отчет о тестировании
      await testReport.update({
        status: successRate >= 80 ? 'passed' : 'failed',
        completed_at: new Date(),
        test_results: JSON.stringify(testResults),
        code_metrics: JSON.stringify(codeMetrics),
        success_rate: successRate,
        summary: `Testing completed with ${successRate.toFixed(2)}% success rate. ${testResults.passedCount} passed, ${testResults.failedCount} failed.`
      });
      
      // Возвращаем результаты
      return {
        success: successRate >= 80,
        testReportId: testReport.id,
        validationResults,
        generatedTests: generatedTests.tests,
        testResults,
        codeMetrics,
        successRate
      };
    } catch (error) {
      logger.error(`Error testing generated code: ${error.message}`, {
        generationId,
        taskId,
        error: error.stack
      });
      
      // Обновляем отчет о тестировании в случае ошибки
      if (testReport) {
        await testReport.update({
          status: 'error',
          completed_at: new Date(),
          summary: `Testing failed due to an error: ${error.message}`,
          success_rate: 0
        });
      }
      
      throw error;
    }
  }

  /**
   * Генерация и запуск тестов для существующего кода
   * @param {object} params - Параметры тестирования
   * @param {number} params.taskId - ID задачи
   * @param {string[]} params.filePaths - Пути к файлам для тестирования
   * @param {string} params.repoPath - Путь к репозиторию
   * @param {object} params.context - Дополнительный контекст
   * @returns {Promise<object>} - Результаты тестирования
   */
  async testExistingCode(params) {
    const { taskId, filePaths, repoPath, context } = params;
    
    logger.info(`Starting testing for existing code files for task ${taskId}`);
    
    try {
      // Если пути к файлам не указаны, бросаем ошибку
      if (!filePaths || filePaths.length === 0) {
        throw new Error('No file paths provided for testing');
      }
      
      // Создаем запись о тестировании
      const testReport = await TestReportModel.create({
        task_id: taskId,
        status: 'in_progress',
        started_at: new Date()
      });
      
      // Формируем структуру файлов
      const files = await Promise.all(filePaths.map(async (path) => {
        const content = await GitService.readFile(repoPath, path);
        return { path, content };
      }));
      
      // Шаг 1: Валидация кода
      logger.info(`Running code validation for existing files in task ${taskId}`);
      const validationResults = await codeValidator.validateCode({
        files,
        repoPath,
        context
      });
      
      await testReport.update({
        validation_results: JSON.stringify(validationResults)
      });
      
      // Шаг 2: Генерация тестов
      logger.info(`Generating tests for existing files in task ${taskId}`);
      const generatedTests = await testGenerator.generateTests({
        taskId,
        files,
        repoPath,
        context,
        validationResults
      });
      
      await testReport.update({
        generated_tests: JSON.stringify(generatedTests.tests)
      });
      
      // Шаг 3: Запуск тестов
      logger.info(`Running tests for existing files in task ${taskId}`);
      const testResults = await testRunner.runTests({
        tests: generatedTests.tests,
        repoPath,
        context
      });
      
      // Шаг 4: Сбор метрик кода
      logger.info(`Collecting code metrics for existing files in task ${taskId}`);
      const codeMetrics = await codeMetricsCollector.collectMetrics({
        files,
        repoPath
      });
      
      // Рассчитываем общий успех тестирования (процент)
      const successRate = testResults.tests.length > 0
        ? (testResults.tests.filter(t => t.status === 'passed').length / testResults.tests.length) * 100
        : 0;
      
      // Обновляем отчет о тестировании
      await testReport.update({
        status: successRate >= 80 ? 'passed' : 'failed',
        completed_at: new Date(),
        test_results: JSON.stringify(testResults),
        code_metrics: JSON.stringify(codeMetrics),
        success_rate: successRate,
        summary: `Testing completed with ${successRate.toFixed(2)}% success rate. ${testResults.passedCount} passed, ${testResults.failedCount} failed.`
      });
      
      // Возвращаем результаты
      return {
        success: successRate >= 80,
        testReportId: testReport.id,
        validationResults,
        generatedTests: generatedTests.tests,
        testResults,
        codeMetrics,
        successRate
      };
    } catch (error) {
      logger.error(`Error testing existing code: ${error.message}`, {
        taskId,
        error: error.stack
      });
      
      // Обновляем отчет о тестировании в случае ошибки
      if (testReport) {
        await testReport.update({
          status: 'error',
          completed_at: new Date(),
          summary: `Testing failed due to an error: ${error.message}`,
          success_rate: 0
        });
      }
      
      throw error;
    }
  }

  /**
   * Получение отчета о тестировании
   * @param {number} testReportId - ID отчета о тестировании
   * @returns {Promise<object>} - Отчет о тестировании
   */
  async getTestReport(testReportId) {
    logger.info(`Getting test report with ID: ${testReportId}`);
    
    try {
      const testReport = await TestReportModel.findByPk(testReportId);
      if (!testReport) {
        throw new Error(`Test report with ID ${testReportId} not found`);
      }
      
      // Парсим JSON-поля
      const result = testReport.toJSON();
      
      try { result.validation_results = JSON.parse(result.validation_results || '{}'); } 
      catch (e) { result.validation_results = {}; }
      
      try { result.generated_tests = JSON.parse(result.generated_tests || '[]'); } 
      catch (e) { result.generated_tests = []; }
      
      try { result.test_results = JSON.parse(result.test_results || '{}'); } 
      catch (e) { result.test_results = {}; }
      
      try { result.code_metrics = JSON.parse(result.code_metrics || '{}'); } 
      catch (e) { result.code_metrics = {}; }
      
      return result;
    } catch (error) {
      logger.error(`Error getting test report: ${error.message}`, {
        testReportId,
        error: error.stack
      });
      
      throw error;
    }
  }
}

module.exports = new CodeTestingSystem();
// src/queue/queue-processors/code-testing-processor.js
const logger = require('../../utils/logger');
const codeTestingSystem = require('../../core/code-testing');
const { CodeGenerationModel, Task } = require('../../models');
const GitService = require('../../core/vcs-manager/gitService');const notificationManager = require('../../utils/notification-manager');
const projectContext = require('../../core/project-understanding');

/**
 * Обработчик для тестирования кода
 * @param {object} job - Объект задания BullMQ
 * @returns {Promise<object>} - Результат обработки
 */
async function processCodeTesting(job) {
  const { generationId, taskId, subtaskId, userId, testExistingCode, filePaths } = job.data;
  
  logger.info(`Processing code testing job for ${testExistingCode ? 'existing code' : `generation ID: ${generationId}`}`);
  
  try {
    if (testExistingCode) {
      // Тестирование существующего кода
      const task = await Task.findByPk(taskId);
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Получаем информацию о репозитории
      const context = await projectContext.getContextForTask(task);
      const { projectId, repositoryUrl, branch } = context;
      
      // Клонируем/обновляем репозиторий
      const repoPath = await GitService.prepareRepository(repositoryUrl, branch);
      
      // Запускаем тестирование существующего кода
      const testResults = await codeTestingSystem.testExistingCode({
        taskId,
        filePaths,
        repoPath,
        context
      });
      
      // Отправляем уведомление пользователю
      await notificationManager.sendNotification({
        user_id: userId,
        type: testResults.success ? 'code_testing_passed' : 'code_testing_failed',
        title: testResults.success ? 'Тесты успешно пройдены' : 'Тесты не пройдены',
        content: `Тестирование кода для задачи #${taskId} завершено с успехом на ${testResults.successRate.toFixed(2)}%.`,
        metadata: {
          taskId,
          testReportId: testResults.testReportId
        }
      });
      
      return {
        success: testResults.success,
        testReportId: testResults.testReportId,
        successRate: testResults.successRate
      };
    } else {
      // Тестирование сгенерированного кода
      const codeGeneration = await CodeGenerationModel.findByPk(generationId);
      if (!codeGeneration) {
        throw new Error(`Code generation with ID ${generationId} not found`);
      }
      
      // Получаем информацию о репозитории из контекста кода
      let context = {};
      try {
        context = JSON.parse(codeGeneration.context || '{}');
      } catch (e) {
        logger.warn(`Failed to parse context for generation ${generationId}: ${e.message}`);
      }
      
      const { projectId, repositoryUrl, branch } = context;
      
      // Клонируем/обновляем репозиторий
      const repoPath = await GitService.prepareRepository(repositoryUrl, branch);
      
      // Запускаем тестирование сгенерированного кода
      const testResults = await codeTestingSystem.testGeneratedCode({
        generationId,
        taskId,
        subtaskId,
        repoPath,
        context
      });
      
      // Отправляем уведомление пользователю
      await notificationManager.sendNotification({
        user_id: userId,
        type: testResults.success ? 'code_testing_passed' : 'code_testing_failed',
        title: testResults.success ? 'Тесты успешно пройдены' : 'Тесты не пройдены',
        content: `Тестирование сгенерированного кода для задачи #${taskId} завершено с успехом на ${testResults.successRate.toFixed(2)}%.`,
        metadata: {
          taskId,
          generationId,
          testReportId: testResults.testReportId
        }
      });
      
      return {
        success: testResults.success,
        testReportId: testResults.testReportId,
        successRate: testResults.successRate
      };
    }
  } catch (error) {
    logger.error(`Error processing code testing: ${error.message}`, {
      error: error.stack,
      testExistingCode,
      generationId,
      taskId
    });
    
    // Отправляем уведомление об ошибке
    await notificationManager.sendNotification({
      user_id: userId,
      type: 'code_testing_error',
      title: 'Ошибка при тестировании кода',
      content: `При тестировании кода для задачи #${taskId} произошла ошибка: ${error.message}`,
      metadata: {
        taskId,
        generationId,
        error: error.message
      }
    });
    
    throw error;
  }
}

module.exports = {
  processCodeTesting
};
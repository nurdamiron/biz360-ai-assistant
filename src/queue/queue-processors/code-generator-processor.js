// src/queue/queue-processors/code-generator-processor.js
const logger = require('../../utils/logger');
const { CodeGenerationModel } = require('../../models');
const codeGenerator = require('../../core/code-generator');
const GitService = require('../../core/vcs-manager/gitService');
const notificationManager = require('../../utils/notification-manager');

/**
 * Обработчик для генерации кода
 * @param {object} job - Объект задания BullMQ
 * @returns {Promise<object>} - Результат обработки
 */
async function processCodeGeneration(job) {
  logger.info(`Processing code generation for task ID: ${job.data.taskId}`);
  
  const { taskId, subtaskId, requirements, context, userId } = job.data;
  
  try {
    // Создаем запись о генерации кода
    const codeGeneration = await CodeGenerationModel.create({
      task_id: taskId,
      subtask_id: subtaskId,
      status: 'processing',
      requirements,
      context: JSON.stringify(context || {}),
      initiated_by: userId
    });
    
    // Получаем описание репозитория из контекста
    const { projectId, repositoryUrl, branch } = context;
    
    // Клонируем/обновляем репозиторий (если необходимо)
    const repoPath = await GitService.prepareRepository(repositoryUrl, branch);
    
    // Выполняем генерацию кода
    const result = await codeGenerator.generateCode({
      taskId,
      subtaskId,
      requirements,
      projectId,
      repoPath,
      context
    });
    
    // Сохраняем результаты
    await codeGeneration.update({
      status: 'completed',
      result: JSON.stringify(result),
      completed_at: new Date(),
      generated_files: JSON.stringify(result.files || [])
    });
    
    // Отправляем уведомление пользователю
    await notificationManager.sendNotification({
      user_id: userId,
      type: 'code_generation_completed',
      title: 'Код успешно сгенерирован',
      content: `Генерация кода для задачи #${taskId} завершена успешно.`,
      metadata: {
        taskId,
        subtaskId,
        generationId: codeGeneration.id
      }
    });
    
    logger.info(`Code generation completed for task ID ${taskId}`);
    
    return {
      taskId,
      subtaskId,
      generationId: codeGeneration.id,
      files: result.files
    };
  } catch (error) {
    logger.error(`Error processing code generation: ${error.message}`, {
      taskId,
      subtaskId,
      error: error.stack
    });
    
    // Обновляем статус генерации кода в случае ошибки
    if (codeGeneration) {
      await codeGeneration.update({
        status: 'failed',
        error: error.message
      });
    }
    
    // Отправляем уведомление об ошибке
    await notificationManager.sendNotification({
      user_id: userId,
      type: 'code_generation_failed',
      title: 'Ошибка генерации кода',
      content: `При генерации кода для задачи #${taskId} произошла ошибка: ${error.message}`,
      metadata: {
        taskId,
        subtaskId,
        error: error.message
      }
    });
    
    throw error;
  }
}

module.exports = {
  processCodeGeneration
};
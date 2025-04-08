// src/queue/queue-processors/task-processor.js
const logger = require('../../utils/logger');
const taskService = require('../../core/task-planner');
const { TaskModel, SubtaskModel } = require('../../models');

/**
 * Обработчик для задач декомпозиции
 * @param {object} job - Объект задания BullMQ
 * @returns {Promise<object>} - Результат обработки
 */
async function processTaskDecomposition(job) {
  logger.info(`Processing task decomposition for task ID: ${job.data.taskId}`);
  
  try {
    const { taskId } = job.data;
    
    // Обновляем статус задачи
    await TaskModel.update(
      { ai_processing_status: 'processing' },
      { where: { id: taskId } }
    );
    
    // Получаем задачу из БД
    const task = await TaskModel.findByPk(taskId);
    if (!task) {
      throw new Error(`Task with ID ${taskId} not found`);
    }
    
    // Выполняем декомпозицию задачи с помощью AI
    const subtasks = await taskService.decomposeTask(task);
    
    // Сохраняем полученные подзадачи в БД
    const savedSubtasks = await Promise.all(
      subtasks.map(subtask => 
        SubtaskModel.create({
          task_id: taskId,
          title: subtask.title,
          description: subtask.description,
          status: 'pending',
          estimated_hours: subtask.estimatedHours || 0,
          priority: subtask.priority || 'medium',
          order: subtask.order || 0
        })
      )
    );
    
    // Обновляем статус задачи
    await TaskModel.update(
      { 
        ai_processing_status: 'completed',
        ai_processing_completed_at: new Date() 
      },
      { where: { id: taskId } }
    );
    
    logger.info(`Task decomposition completed for task ID ${taskId}. Created ${savedSubtasks.length} subtasks.`);
    
    return {
      taskId,
      subtasksCount: savedSubtasks.length,
      subtasks: savedSubtasks.map(st => ({
        id: st.id,
        title: st.title
      }))
    };
  } catch (error) {
    logger.error(`Error processing task decomposition: ${error.message}`, {
      taskId: job.data.taskId,
      error: error.stack
    });
    
    // Обновляем статус задачи в случае ошибки
    await TaskModel.update(
      { 
        ai_processing_status: 'failed',
        ai_processing_error: error.message 
      },
      { where: { id: job.data.taskId } }
    );
    
    throw error;
  }
}

module.exports = {
  processTaskDecomposition
};
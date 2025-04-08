// src/controller/task/workflow.controller.js

const TaskCompleteWorkflow = require('../../core/task-complete-workflow');
const logger = require('../../utils/logger');

/**
 * Получение информации о рабочем процессе
 */
exports.getWorkflowStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    
    logger.debug(`Запрос статуса рабочего процесса для задачи #${taskId}`);
    
    const result = await TaskCompleteWorkflow.getWorkflowStatus(taskId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Ошибка при получении статуса рабочего процесса:`, error);
    
    return res.status(500).json({
      success: false,
      message: `Ошибка при получении статуса рабочего процесса: ${error.message}`,
      error: error.message
    });
  }
};

/**
 * Запуск рабочего процесса
 */
exports.startWorkflow = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    
    logger.info(`Запрос на запуск рабочего процесса для задачи #${taskId} от пользователя #${userId}`);
    
    const result = await TaskCompleteWorkflow.startWorkflow(taskId, userId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Ошибка при запуске рабочего процесса:`, error);
    
    return res.status(500).json({
      success: false,
      message: `Ошибка при запуске рабочего процесса: ${error.message}`,
      error: error.message
    });
  }
};

/**
 * Выполнение текущего шага рабочего процесса
 */
exports.executeCurrentStep = async (req, res) => {
  try {
    const { taskId } = req.params;
    
    logger.info(`Запрос на выполнение текущего шага рабочего процесса для задачи #${taskId}`);
    
    const result = await TaskCompleteWorkflow.executeCurrentStep(taskId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Ошибка при выполнении текущего шага рабочего процесса:`, error);
    
    return res.status(500).json({
      success: false,
      message: `Ошибка при выполнении текущего шага: ${error.message}`,
      error: error.message
    });
  }
};

/**
 * Переход к следующему шагу рабочего процесса
 */
exports.moveToNextStep = async (req, res) => {
  try {
    const { taskId } = req.params;
    const manualStepData = req.body.data || {};
    
    logger.info(`Запрос на переход к следующему шагу рабочего процесса для задачи #${taskId}`);
    
    const result = await TaskCompleteWorkflow.moveToNextStep(taskId, manualStepData);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Ошибка при переходе к следующему шагу рабочего процесса:`, error);
    
    return res.status(500).json({
      success: false,
      message: `Ошибка при переходе к следующему шагу: ${error.message}`,
      error: error.message
    });
  }
};

/**
 * Сброс рабочего процесса
 */
exports.resetWorkflow = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.id;
    
    logger.info(`Запрос на сброс рабочего процесса для задачи #${taskId} от пользователя #${userId}`);
    
    const result = await TaskCompleteWorkflow.resetWorkflow(taskId, userId);
    
    return res.status(200).json(result);
  } catch (error) {
    logger.error(`Ошибка при сбросе рабочего процесса:`, error);
    
    return res.status(500).json({
      success: false,
      message: `Ошибка при сбросе рабочего процесса: ${error.message}`,
      error: error.message
    });
  }
};
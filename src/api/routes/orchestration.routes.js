/**
 * @fileoverview Маршруты API для управления оркестрацией задач.
 * Определяет эндпоинты для создания, запуска, остановки и отслеживания задач.
 */
const express = require('express');
const router = express.Router();
const TaskOrchestrationController = require('../../controller/task/task-orchestration-controller');
const authMiddleware = require('../middleware/auth');

// Экземпляр контроллера оркестрации задач
let orchestrationController;

/**
 * Инициализирует маршруты с контроллером.
 * @param {Object} options - Настройки оркестрации
 * @returns {express.Router} - Маршрутизатор Express.
 */
const initRoutes = (options = {}) => {
  // Создаем экземпляр контроллера
  orchestrationController = new TaskOrchestrationController(options);
  
  // Middleware для проверки инициализации контроллера
  const checkController = (req, res, next) => {
    if (!orchestrationController) {
      return res.status(500).json({
        success: false,
        message: 'Контроллер оркестрации не инициализирован'
      });
    }
    next();
  };
  
  // Применяем middleware к маршрутам
  router.use(checkController);
  
  // Создание новой задачи
  router.post('/tasks', authMiddleware, async (req, res) => {
    return orchestrationController.createTask(req, res);
  });
  
  // Получение списка задач
  router.get('/tasks', authMiddleware, async (req, res) => {
    return orchestrationController.listTasks(req, res);
  });
  
  // Получение информации о задаче
  router.get('/tasks/:taskId', authMiddleware, async (req, res) => {
    return orchestrationController.getTaskInfo(req, res);
  });
  
  // Запуск задачи
  router.post('/tasks/:taskId/start', authMiddleware, async (req, res) => {
    return orchestrationController.startTask(req, res);
  });
  
  // Остановка (пауза) задачи
  router.post('/tasks/:taskId/pause', authMiddleware, async (req, res) => {
    return orchestrationController.pauseTask(req, res);
  });
  
  // Возобновление задачи
  router.post('/tasks/:taskId/resume', authMiddleware, async (req, res) => {
    return orchestrationController.resumeTask(req, res);
  });
  
  // Отмена задачи
  router.post('/tasks/:taskId/cancel', authMiddleware, async (req, res) => {
    return orchestrationController.cancelTask(req, res);
  });
  
  // Предоставление пользовательского ввода
  router.post('/tasks/:taskId/input', authMiddleware, async (req, res) => {
    return orchestrationController.provideUserInput(req, res);
  });
  
  // Получение результатов шага
  router.get('/tasks/:taskId/steps/:stepName', authMiddleware, async (req, res) => {
    return orchestrationController.getStepResults(req, res);
  });
  
  // Получение статистики оркестрации
  router.get('/stats', authMiddleware, async (req, res) => {
    return orchestrationController.getOrchestrationStats(req, res);
  });
  
  // Вебхук для событий Git (без проверки авторизации)
  router.post('/webhooks/git', async (req, res) => {
    try {
      // Тут можно добавить логику для обработки вебхуков Git
      // Например, триггеринг процесса интеграции обратной связи
      res.status(200).json({
        success: true,
        message: 'Вебхук Git обработан'
      });
    } catch (error) {
      console.error('Ошибка при обработке вебхука Git:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка при обработке вебхука Git',
        error: error.message
      });
    }
  });
  
  return router;
};

// Экспортируем маршрутизатор и функцию инициализации
module.exports = {
  router,
  initRoutes
};
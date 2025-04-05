// src/api/routes/tasks.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');
const TaskModel = require('../../models/task.model');

// Импорт контроллеров
const taskController = require('../../controller/task/task.controller');
const taskFilterController = require('../../controller/task/task-filter.controller');
const taskStatusController = require('../../controller/task/task-status.controller');
const taskTagsController = require('../../controller/task/task-tags.controller');
const taskAssignmentController = require('../../controller/task/task-assignment.controller');
const subtaskController = require('../../controller/subtask/subtask.controller');

// Базовые CRUD операции
/**
 * @route   GET /api/tasks
 * @desc    Получить список задач с фильтрацией
 * @access  Private
 */
router.get('/', authenticateCombined, taskFilterController.getTasks);

/**
 * @route   GET /api/tasks/:id
 * @desc    Получить задачу по ID
 * @access  Private
 */
router.get('/:id', authenticateCombined, taskController.getTaskById);

/**
 * @route   POST /api/tasks
 * @desc    Создать новую задачу
 * @access  Private
 */
router.post('/', 
  authenticateCombined, 
  validationMiddleware.validateBody(TaskModel.validateCreate),
  taskController.createTask
);

/**
 * @route   PUT /api/tasks/:id
 * @desc    Обновить существующую задачу
 * @access  Private
 */
router.put('/:id', 
  authenticateCombined, 
  validationMiddleware.validateBody(TaskModel.validateUpdate),
  taskController.updateTask
);

/**
 * @route   DELETE /api/tasks/:id
 * @desc    Удалить задачу
 * @access  Private
 */
router.delete('/:id', authenticateCombined, taskController.deleteTask);

// Статусы задач
/**
 * @route   PUT /api/tasks/:id/status
 * @desc    Изменить статус задачи
 * @access  Private
 */
router.put('/:id/status', 
  authenticateCombined, 
  validationMiddleware.validateBody(TaskModel.validateStatusChange),
  taskStatusController.changeTaskStatus
);

/**
 * @route   GET /api/tasks/:id/status/history
 * @desc    Получить историю изменений статуса задачи
 * @access  Private
 */
router.get('/:id/status/history', authenticateCombined, taskStatusController.getStatusHistory);

// Теги задач
/**
 * @route   GET /api/tasks/:id/tags
 * @desc    Получить теги задачи
 * @access  Private
 */
router.get('/:id/tags', authenticateCombined, taskTagsController.getTaskTags);

/**
 * @route   POST /api/tasks/:id/tags
 * @desc    Добавить теги к задаче
 * @access  Private
 */
router.post('/:id/tags', authenticateCombined, taskTagsController.addTaskTags);

/**
 * @route   DELETE /api/tasks/:id/tags
 * @desc    Удалить теги у задачи
 * @access  Private
 */
router.delete('/:id/tags', authenticateCombined, taskTagsController.removeTaskTags);

// Назначение задач
/**
 * @route   PUT /api/tasks/:id/assign
 * @desc    Назначить задачу пользователю
 * @access  Private
 */
router.put('/:id/assign', 
  authenticateCombined, 
  validationMiddleware.validateBody(TaskModel.validateAssignment),
  taskAssignmentController.assignTask
);

/**
 * @route   POST /api/tasks/:id/auto-assign
 * @desc    Автоматическое назначение задачи
 * @access  Private
 */
router.post('/:id/auto-assign', authenticateCombined, taskAssignmentController.autoAssignTask);

// Работа с подзадачами
/**
 * @route   GET /api/tasks/:taskId/subtasks
 * @desc    Получить список подзадач для задачи
 * @access  Private
 */
router.get('/:taskId/subtasks', authenticateCombined, subtaskController.getSubtasks);

/**
 * @route   POST /api/tasks/:taskId/subtasks
 * @desc    Создать новую подзадачу
 * @access  Private
 */
router.post('/:taskId/subtasks', authenticateCombined, subtaskController.createSubtask);

/**
 * @route   PUT /api/tasks/:taskId/subtasks/:subtaskId
 * @desc    Обновить подзадачу
 * @access  Private
 */
router.put('/:taskId/subtasks/:subtaskId', authenticateCombined, subtaskController.updateSubtask);

/**
 * @route   DELETE /api/tasks/:taskId/subtasks/:subtaskId
 * @desc    Удалить подзадачу
 * @access  Private
 */
router.delete('/:taskId/subtasks/:subtaskId', authenticateCombined, subtaskController.deleteSubtask);

/**
 * @route   PUT /api/tasks/:taskId/subtasks/:subtaskId/status
 * @desc    Изменить статус подзадачи
 * @access  Private
 */
router.put('/:taskId/subtasks/:subtaskId/status', authenticateCombined, subtaskController.changeSubtaskStatus);

/**
 * @route   POST /api/tasks/:taskId/subtasks/reorder
 * @desc    Изменить порядок подзадач
 * @access  Private
 */
router.post('/:taskId/subtasks/reorder', authenticateCombined, subtaskController.reorderSubtasks);

// Поиск и фильтрация
/**
 * @route   GET /api/tasks/project/:projectId
 * @desc    Получить задачи проекта
 * @access  Private
 */
router.get('/project/:projectId', authenticateCombined, taskFilterController.getTasksByProject);

/**
 * @route   GET /api/tasks/user/:userId
 * @desc    Получить задачи, назначенные пользователю
 * @access  Private
 */
router.get('/user/:userId', authenticateCombined, taskFilterController.getTasksByUser);

/**
 * @route   GET /api/tasks/:id/similar
 * @desc    Найти похожие задачи
 * @access  Private
 */
router.get('/:id/similar', authenticateCombined, taskFilterController.findSimilarTasks);

/**
 * @route   GET /api/tasks/tree
 * @desc    Получить дерево задач
 * @access  Private
 */
router.get('/tree', authenticateCombined, taskFilterController.getTaskTree);

// Вспомогательные маршруты
/**
 * @route   GET /api/tasks/tags/all
 * @desc    Получить все доступные теги
 * @access  Private
 */
router.get('/tags/all', authenticateCombined, taskTagsController.getAllTags);

/**
 * @route   GET /api/tasks/tags/popular
 * @desc    Получить популярные теги
 * @access  Private
 */
router.get('/tags/popular', authenticateCombined, taskTagsController.getPopularTags);

/**
 * @route   GET /api/tasks/status/statistics
 * @desc    Получить статистику по статусам задач
 * @access  Private
 */
router.get('/status/statistics', authenticateCombined, taskStatusController.getStatusStatistics);

/**
 * @route   GET /api/tasks/assignment/users
 * @desc    Получить список пользователей для назначения
 * @access  Private
 */
router.get('/assignment/users', authenticateCombined, taskAssignmentController.getAssignableUsers);

/**
 * @route   GET /api/tasks/assignment/workload
 * @desc    Получить статистику загруженности пользователей
 * @access  Private
 */
router.get('/assignment/workload', authenticateCombined, taskAssignmentController.getUsersWorkload);

module.exports = router;
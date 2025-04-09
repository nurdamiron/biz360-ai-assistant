// src/api/routes/orchestrator.js

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const orchestratorController = require('../../controller/orchestrator.controller');
const { validateTaskCreation, validateTaskTransition } = require('../middleware/validation');

/**
 * @swagger
 * /api/orchestrator/tasks:
 *   post:
 *     summary: Create a new AI-assisted task
 *     description: Creates a new task for AI-assisted development
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 description: Title of the task
 *               description:
 *                 type: string
 *                 description: Detailed description of the task
 *               projectId:
 *                 type: string
 *                 description: ID of the project
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *                 default: medium
 *     responses:
 *       201:
 *         description: Task created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/tasks', 
  authenticateToken, 
  validateTaskCreation, 
  orchestratorController.createTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/start:
 *   post:
 *     summary: Start task execution
 *     description: Starts the execution of a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startStep:
 *                 type: integer
 *                 description: Step to start from (optional)
 *     responses:
 *       200:
 *         description: Task started successfully
 *       404:
 *         description: Task not found
 *       409:
 *         description: Task is already running
 */
router.post('/tasks/:taskId/start', 
  authenticateToken, 
  orchestratorController.startTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/pause:
 *   post:
 *     summary: Pause task execution
 *     description: Pauses the execution of a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task paused successfully
 *       404:
 *         description: Task not found
 *       409:
 *         description: Task is not running
 */
router.post('/tasks/:taskId/pause', 
  authenticateToken, 
  orchestratorController.pauseTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/resume:
 *   post:
 *     summary: Resume task execution
 *     description: Resumes the execution of a paused task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task resumed successfully
 *       404:
 *         description: Task not found
 *       409:
 *         description: Task is not paused
 */
router.post('/tasks/:taskId/resume', 
  authenticateToken, 
  orchestratorController.resumeTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/cancel:
 *   post:
 *     summary: Cancel task execution
 *     description: Cancels the execution of a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task cancelled successfully
 *       404:
 *         description: Task not found
 */
router.post('/tasks/:taskId/cancel', 
  authenticateToken, 
  orchestratorController.cancelTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/transition:
 *   post:
 *     summary: Transition task to a specific step
 *     description: Manually transitions a task to a specific step
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stepNumber
 *             properties:
 *               stepNumber:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 16
 *                 description: Step number to transition to
 *               reason:
 *                 type: string
 *                 description: Reason for the transition
 *     responses:
 *       200:
 *         description: Task transitioned successfully
 *       400:
 *         description: Invalid step number
 *       404:
 *         description: Task not found
 */
router.post('/tasks/:taskId/transition', 
  authenticateToken, 
  validateTaskTransition,
  orchestratorController.transitionTask
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}:
 *   get:
 *     summary: Get task details
 *     description: Returns details of a specific task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task details
 *       404:
 *         description: Task not found
 */
router.get('/tasks/:taskId', 
  authenticateToken, 
  orchestratorController.getTask
);

/**
 * @swagger
 * /api/orchestrator/tasks:
 *   get:
 *     summary: Get all tasks
 *     description: Returns a list of all tasks
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed, failed, cancelled, paused]
 *         description: Filter by task status
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: string
 *         description: Filter by project ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of tasks
 */
router.get('/tasks', 
  authenticateToken, 
  orchestratorController.getTasks
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/state:
 *   get:
 *     summary: Get task state
 *     description: Returns the current state of a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task state
 *       404:
 *         description: Task not found
 */
router.get('/tasks/:taskId/state', 
  authenticateToken, 
  orchestratorController.getTaskState
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/history:
 *   get:
 *     summary: Get task history
 *     description: Returns the execution history of a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task history
 *       404:
 *         description: Task not found
 */
router.get('/tasks/:taskId/history', 
  authenticateToken, 
  orchestratorController.getTaskHistory
);

/**
 * @swagger
 * /api/orchestrator/tasks/{taskId}/metrics:
 *   get:
 *     summary: Get task metrics
 *     description: Returns performance metrics for a task
 *     tags: [Orchestrator]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the task
 *     responses:
 *       200:
 *         description: Task metrics
 *       404:
 *         description: Task not found
 */
router.get('/tasks/:taskId/metrics', 
  authenticateToken, 
  orchestratorController.getTaskMetrics
);

module.exports = router;
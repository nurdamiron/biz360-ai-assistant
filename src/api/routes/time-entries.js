// src/api/routes/time-entries.js

const express = require('express');
const router = express.Router();
const { authenticateCombined } = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');
const timeEntryController = require('../../controller/time-entry/time-entry.controller');
const TimeEntryModel = require('../../models/time-entry.model');

/**
 * @route   GET /api/time-entries
 * @desc    Получить записи о времени с фильтрацией
 * @access  Private
 */
router.get('/', 
  authenticateCombined, 
  validationMiddleware.validateQuery(TimeEntryModel.validateQuery),
  timeEntryController.getTimeEntries
);

/**
 * @route   POST /api/time-entries
 * @desc    Создать новую запись о времени
 * @access  Private
 */
router.post('/', 
  authenticateCombined, 
  validationMiddleware.validateBody(TimeEntryModel.validateCreate),
  timeEntryController.createTimeEntry
);

/**
 * @route   PUT /api/time-entries/:id
 * @desc    Обновить запись о времени
 * @access  Private
 */
router.put('/:id', 
  authenticateCombined, 
  validationMiddleware.validateBody(TimeEntryModel.validateUpdate),
  timeEntryController.updateTimeEntry
);

/**
 * @route   DELETE /api/time-entries/:id
 * @desc    Удалить запись о времени
 * @access  Private
 */
router.delete('/:id', authenticateCombined, timeEntryController.deleteTimeEntry);

/**
 * @route   GET /api/time-entries/statistics
 * @desc    Получить статистику по затраченному времени
 * @access  Private
 */
router.get('/statistics', authenticateCombined, timeEntryController.getTimeStatistics);

/**
 * @route   POST /api/time-entries/start
 * @desc    Начать отслеживание времени
 * @access  Private
 */
router.post('/start', 
  authenticateCombined, 
  validationMiddleware.validateBody(TimeEntryModel.validateStart),
  timeEntryController.startTimeTracking
);

/**
 * @route   PUT /api/time-entries/:id/stop
 * @desc    Остановить отслеживание времени
 * @access  Private
 */
router.put('/:id/stop', authenticateCombined, timeEntryController.stopTimeTracking);

module.exports = router;
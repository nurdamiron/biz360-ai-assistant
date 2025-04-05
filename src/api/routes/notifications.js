// src/api/routes/notifications.js

const express = require('express');
const router = express.Router();
const { authenticateCombined, authorize } = require('../middleware/auth');
const notificationController = require('../../controller/notification/notification.controller');

/**
 * @route   GET /api/notifications
 * @desc    Получить уведомления текущего пользователя
 * @access  Private
 */
router.get('/', authenticateCombined, notificationController.getUserNotifications);

/**
 * @route   GET /api/notifications/unread
 * @desc    Получить количество непрочитанных уведомлений
 * @access  Private
 */
router.get('/unread', authenticateCombined, notificationController.getUnreadCount);

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Отметить уведомление как прочитанное
 * @access  Private
 */
router.put('/:id/read', authenticateCombined, notificationController.markAsRead);

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Отметить все уведомления как прочитанные
 * @access  Private
 */
router.put('/read-all', authenticateCombined, notificationController.markAllAsRead);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Удалить уведомление
 * @access  Private
 */
router.delete('/:id', authenticateCombined, notificationController.deleteNotification);

/**
 * @route   GET /api/notifications/settings
 * @desc    Получить настройки уведомлений
 * @access  Private
 */
router.get('/settings', authenticateCombined, notificationController.getNotificationSettings);

/**
 * @route   PUT /api/notifications/settings
 * @desc    Обновить настройки уведомлений
 * @access  Private
 */
router.put('/settings', authenticateCombined, notificationController.updateNotificationSettings);

/**
 * @route   POST /api/notifications/test
 * @desc    Отправить тестовое уведомление (только для администраторов)
 * @access  Private/Admin
 */
router.post('/test', authenticateCombined, authorize(['admin']), notificationController.sendTestNotification);

/**
 * @route   DELETE /api/notifications/users/:userId
 * @desc    Удалить все уведомления пользователя (только для администраторов)
 * @access  Private/Admin
 */
router.delete('/users/:userId', authenticateCombined, authorize(['admin']), notificationController.clearUserNotifications);

module.exports = router;
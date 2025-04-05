// src/api/routes/project-files.routes.js

const express = require('express');
const router = express.Router({ mergeParams: true }); // Для доступа к req.params.id из родительского роутера
const { authenticateCombined } = require('../middleware/auth');
const projectFilesController = require('../../controllers/project-files.controller');

/**
 * @route   GET /api/projects/:id/files
 * @desc    Получить файлы проекта
 * @access  Private
 */
router.get('/', authenticateCombined, projectFilesController.getProjectFiles);

/**
 * @route   GET /api/projects/:id/files/content
 * @desc    Получить содержимое файла
 * @access  Private
 */
router.get('/content', authenticateCombined, projectFilesController.getFileContent);

/**
 * @route   POST /api/projects/:id/files/content
 * @desc    Сохранить содержимое файла
 * @access  Private
 */
router.post('/content', authenticateCombined, projectFilesController.saveFileContent);

/**
 * @route   POST /api/projects/:id/files/folder
 * @desc    Создать новую папку
 * @access  Private
 */
router.post('/folder', authenticateCombined, projectFilesController.createFolder);

/**
 * @route   DELETE /api/projects/:id/files
 * @desc    Удалить файл или папку
 * @access  Private
 */
router.delete('/', authenticateCombined, projectFilesController.deleteFile);

module.exports = router;
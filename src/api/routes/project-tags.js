// src/api/routes/project-tags.js

const express = require('express');
const router = express.Router({ mergeParams: true });
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const { authenticateCombined } = require('../middleware/auth');
const validationMiddleware = require('../middleware/validation');

/**
 * @route   GET /api/projects/:projectId/tags
 * @desc    Получить теги проекта
 * @access  Private
 */
router.get('/', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    
    const connection = await pool.getConnection();
    
    // Проверяем существование проекта
    const [projects] = await connection.query(
      'SELECT id FROM projects WHERE id = ?',
      [projectId]
    );
    
    if (projects.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false,
        error: 'Проект не найден' 
      });
    }
    
    // Получаем теги проекта
    const [tags] = await connection.query(
      `SELECT pt.tag_name as name, t.color, t.description 
       FROM project_tags pt
       LEFT JOIN tags t ON pt.tag_name = t.name
       WHERE pt.project_id = ?
       ORDER BY pt.tag_name`,
      [projectId]
    );
    
    connection.release();
    
    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    logger.error(`Ошибка при получении тегов проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении тегов проекта' 
    });
  }
});

/**
 * @route   POST /api/projects/:projectId/tags
 * @desc    Добавить тег к проекту
 * @access  Private
 */
router.post('/', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const { tag } = req.body;
    
    if (!tag) {
      return res.status(400).json({ 
        success: false,
        error: 'Необходимо указать тег (tag)' 
      });
    }
    
    const connection = await pool.getConnection();
    
    // Проверяем существование проекта
    const [projects] = await connection.query(
      'SELECT id FROM projects WHERE id = ?',
      [projectId]
    );
    
    if (projects.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false,
        error: 'Проект не найден' 
      });
    }
    
    // Проверяем, существует ли тег в справочнике
    const [existingTags] = await connection.query(
      'SELECT name, color, description FROM tags WHERE name = ?',
      [tag]
    );
    
    let tagInfo;
    
    if (existingTags.length === 0) {
      // Если тег не существует, создаем его
      await connection.query(
        'INSERT INTO tags (name) VALUES (?)',
        [tag]
      );
      
      tagInfo = { name: tag, color: '#3498db', description: null };
    } else {
      tagInfo = existingTags[0];
    }
    
    // Добавляем тег к проекту
    await connection.query(
      'INSERT IGNORE INTO project_tags (project_id, tag_name) VALUES (?, ?)',
      [projectId, tag]
    );
    
    connection.release();
    
    logger.info(`Добавлен тег "${tag}" к проекту #${projectId}`);
    
    res.status(201).json({
      success: true,
      message: 'Тег успешно добавлен к проекту',
      data: tagInfo
    });
  } catch (error) {
    logger.error(`Ошибка при добавлении тега к проекту #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при добавлении тега к проекту' 
    });
  }
});

/**
 * @route   DELETE /api/projects/:projectId/tags/:tagName
 * @desc    Удалить тег у проекта
 * @access  Private
 */
router.delete('/:tagName', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const tagName = req.params.tagName;
    
    const connection = await pool.getConnection();
    
    // Проверяем существование проекта
    const [projects] = await connection.query(
      'SELECT id FROM projects WHERE id = ?',
      [projectId]
    );
    
    if (projects.length === 0) {
      connection.release();
      return res.status(404).json({ 
        success: false,
        error: 'Проект не найден' 
      });
    }
    
    // Удаляем тег у проекта
    await connection.query(
      'DELETE FROM project_tags WHERE project_id = ? AND tag_name = ?',
      [projectId, tagName]
    );
    
    connection.release();
    
    logger.info(`Удален тег "${tagName}" у проекта #${projectId}`);
    
    res.json({
      success: true,
      message: 'Тег успешно удален у проекта'
    });
  } catch (error) {
    logger.error(`Ошибка при удалении тега у проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при удалении тега у проекта' 
    });
  }
});

/**
 * @route   GET /api/tags
 * @desc    Получить список всех доступных тегов
 * @access  Private
 */
router.get('/available', authenticateCombined, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    // Получаем список всех тегов
    const [tags] = await connection.query(
      'SELECT name, color, description FROM tags ORDER BY name'
    );
    
    connection.release();
    
    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    logger.error('Ошибка при получении списка тегов:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении списка тегов' 
    });
  }
});

module.exports = router;
// src/api/routes/project-settings.js

const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams is needed to access projectId from parent router
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const ProjectSettings = require('../../models/project-settings.model');
const validationMiddleware = require('../middleware/validation');
const { authenticateCombined } = require('../middleware/auth');

/**
 * @route   GET /api/projects/:projectId/settings
 * @desc    Получить все настройки проекта
 * @access  Private
 */
router.get('/', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    
    // Проверяем существование проекта
    const connection = await pool.getConnection();
    
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
    
    // Получаем все настройки проекта
    const [settings] = await connection.query(
      'SELECT setting_key, setting_value FROM project_settings WHERE project_id = ?',
      [projectId]
    );
    
    connection.release();
    
    // Преобразуем результат в удобный формат
    const formattedSettings = {};
    
    for (const setting of settings) {
      formattedSettings[setting.setting_key] = JSON.parse(setting.setting_value);
    }
    
    res.json({
      success: true,
      data: formattedSettings
    });
  } catch (error) {
    logger.error(`Ошибка при получении настроек проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении настроек проекта' 
    });
  }
});

/**
 * @route   GET /api/projects/:projectId/settings/:key
 * @desc    Получить конкретную настройку проекта
 * @access  Private
 */
router.get('/:key', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const settingKey = req.params.key;
    
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
    
    // Получаем настройку
    const [settings] = await connection.query(
      'SELECT setting_value FROM project_settings WHERE project_id = ? AND setting_key = ?',
      [projectId, settingKey]
    );
    
    connection.release();
    
    if (settings.length === 0) {
      // Если настройка не найдена, возвращаем настройку по умолчанию
      const defaultSetting = ProjectSettings.getDefaultSettings(settingKey);
      
      if (defaultSetting) {
        return res.json({
          success: true,
          data: defaultSetting,
          default: true
        });
      }
      
      return res.status(404).json({ 
        success: false,
        error: `Настройка с ключом "${settingKey}" не найдена` 
      });
    }
    
    res.json({
      success: true,
      data: JSON.parse(settings[0].setting_value)
    });
  } catch (error) {
    logger.error(`Ошибка при получении настройки проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при получении настройки проекта' 
    });
  }
});

/**
 * @route   PUT /api/projects/:projectId/settings/:key
 * @desc    Обновить настройку проекта
 * @access  Private
 */
router.put('/:key', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const settingKey = req.params.key;
    const settingValue = req.body;
    
    // Валидируем настройку
    const validationResult = ProjectSettings.validate(settingKey, settingValue);
    
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Некорректное значение настройки',
        details: validationResult.errors
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
    
    // Сохраняем настройку
    await connection.query(
      `INSERT INTO project_settings (project_id, setting_key, setting_value) 
       VALUES (?, ?, ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [
        projectId, 
        settingKey, 
        JSON.stringify(settingValue),
        JSON.stringify(settingValue)
      ]
    );
    
    connection.release();
    
    logger.info(`Обновлена настройка "${settingKey}" для проекта #${projectId}`);
    
    res.json({
      success: true,
      message: 'Настройка успешно обновлена',
      data: settingValue
    });
  } catch (error) {
    logger.error(`Ошибка при обновлении настройки проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при обновлении настройки проекта' 
    });
  }
});

/**
 * @route   DELETE /api/projects/:projectId/settings/:key
 * @desc    Удалить настройку проекта (сбросить до значения по умолчанию)
 * @access  Private
 */
router.delete('/:key', authenticateCombined, async (req, res) => {
  try {
    const projectId = parseInt(req.params.projectId);
    const settingKey = req.params.key;
    
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
    
    // Удаляем настройку
    await connection.query(
      'DELETE FROM project_settings WHERE project_id = ? AND setting_key = ?',
      [projectId, settingKey]
    );
    
    connection.release();
    
    // Получаем настройку по умолчанию
    const defaultSetting = ProjectSettings.getDefaultSettings(settingKey);
    
    logger.info(`Удалена настройка "${settingKey}" для проекта #${projectId}`);
    
    res.json({
      success: true,
      message: 'Настройка успешно сброшена до значения по умолчанию',
      data: defaultSetting
    });
  } catch (error) {
    logger.error(`Ошибка при удалении настройки проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при удалении настройки проекта' 
    });
  }
});

/**
 * @route   POST /api/projects/:projectId/settings/reset
 * @desc    Сбросить все настройки проекта до значений по умолчанию
 * @access  Private
 */
router.post('/reset', authenticateCombined, async (req, res) => {
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
    
    // Удаляем все настройки проекта
    await connection.query(
      'DELETE FROM project_settings WHERE project_id = ?',
      [projectId]
    );
    
    // Вставляем настройки по умолчанию
    const defaultKeys = ['code_analysis', 'git_integration', 'ai_assistant', 'notifications', 'team_settings'];
    
    for (const key of defaultKeys) {
      const defaultValue = ProjectSettings.getDefaultSettings(key);
      
      if (defaultValue) {
        await connection.query(
          `INSERT INTO project_settings (project_id, setting_key, setting_value) 
           VALUES (?, ?, ?)`,
          [projectId, key, JSON.stringify(defaultValue)]
        );
      }
    }
    
    connection.release();
    
    logger.info(`Сброшены все настройки для проекта #${projectId}`);
    
    // Собираем все настройки по умолчанию
    const defaultSettings = {};
    for (const key of defaultKeys) {
      defaultSettings[key] = ProjectSettings.getDefaultSettings(key);
    }
    
    res.json({
      success: true,
      message: 'Все настройки успешно сброшены до значений по умолчанию',
      data: defaultSettings
    });
  } catch (error) {
    logger.error(`Ошибка при сбросе настроек проекта #${req.params.projectId}:`, error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера при сбросе настроек проекта' 
    });
  }
});

module.exports = router;
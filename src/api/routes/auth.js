// src/api/routes/auth.js

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const { authenticateCombined, authorize } = require('../middleware/auth');

/**
 * @route   POST /api/auth/login
 * @desc    Аутентификация пользователя и выдача JWT токена
 * @access  Public
 */

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // 1) Проверяем, что поля не пустые
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Необходимо указать имя пользователя и пароль'
      });
    }
    console.log('Incoming login request:', req.body); // Логируем входящие данные


    // 2) Получаем соединение с БД
    const connection = await pool.getConnection();

    // 3) Ищем пользователя
    const [users] = await connection.query(
      'SELECT id, username, password, role, active FROM users WHERE username = ?',
      [username]
    );

    connection.release();

    // 4) Проверяем, нашли ли мы пользователя
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Неверное имя пользователя или пароль'
      });
    }

    const user = users[0];

    // 5) Проверяем, активен ли пользователь
    if (!user.active) {
      return res.status(401).json({
        success: false,
        message: 'Учетная запись деактивирована'
      });
    }

    // 6) Сравниваем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Неверное имя пользователя или пароль'
      });
    }

    // 7) Если пароль верен, генерируем JWT-токен
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET || 'fallback_secret', // Добавьте fallback
      { expiresIn: '24h' }
    );

    // 8) Логируем успех
    logger.info(`Пользователь ${username} успешно аутентифицирован`);

    // 9) Возвращаем пользователю токен и информацию о нем
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    logger.error('Ошибка при аутентификации пользователя:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка сервера при аутентификации'
    });
  }
});



/**
 * @route   GET /api/auth/me
 * @desc    Получение информации о текущем пользователе
 * @access  Private
 */
router.get('/me', authenticateCombined, async (req, res) => {
  try {
    // Информация о пользователе уже должна быть в req.user после аутентификации
    const { id, username, role } = req.user;
    
    const connection = await pool.getConnection();
    
    // Получаем дополнительную информацию о пользователе
    const [users] = await connection.query(
      'SELECT email, created_at, last_login FROM users WHERE id = ?',
      [id]
    );
    
    connection.release();
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.json({
      id,
      username,
      role,
      email: users[0].email,
      created_at: users[0].created_at,
      last_login: users[0].last_login
    });
  } catch (error) {
    logger.error('Ошибка при получении информации о пользователе:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении информации о пользователе' });
  }
});

/**
 * @route   POST /api/auth/register
 * @desc    Регистрация нового пользователя (только для администраторов)
 * @access  Private/Admin
 */
router.post('/register', authenticateCombined, authorize(['admin']), async (req, res) => {
  try {
    const { username, password, email, role } = req.body;
    
    if (!username || !password || !email) {
      return res.status(400).json({ 
        error: 'Необходимо указать имя пользователя, пароль и email' 
      });
    }
    
    // Проверяем корректность роли
    const allowedRoles = ['user', 'manager', 'admin'];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ 
        error: `Неверная роль. Допустимые значения: ${allowedRoles.join(', ')}` 
      });
    }
    
    const connection = await pool.getConnection();
    
    // Проверяем, существует ли пользователь с таким именем
    const [existingUsers] = await connection.query(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      connection.release();
      return res.status(400).json({ error: 'Пользователь с таким именем или email уже существует' });
    }
    
    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Создаем нового пользователя
    const [result] = await connection.query(
      `INSERT INTO users 
       (username, password, email, role, active) 
       VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, email, role || 'user', 1]
    );
    
    connection.release();
    
    logger.info(`Создан новый пользователь: ${username} (роль: ${role || 'user'})`);
    
    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      userId: result.insertId
    });
  } catch (error) {
    logger.error('Ошибка при регистрации пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера при регистрации пользователя' });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Изменение пароля пользователя
 * @access  Private
 */
router.post('/change-password', authenticateCombined, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Необходимо указать текущий и новый пароль' });
    }
    
    const connection = await pool.getConnection();
    
    // Получаем текущий пароль пользователя
    const [users] = await connection.query(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Проверяем текущий пароль
    const isPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
    
    if (!isPasswordValid) {
      connection.release();
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }
    
    // Хешируем новый пароль
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Обновляем пароль
    await connection.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );
    
    connection.release();
    
    logger.info(`Пользователь ${req.user.username} изменил пароль`);
    
    res.json({
      success: true,
      message: 'Пароль успешно изменен'
    });
  } catch (error) {
    logger.error('Ошибка при изменении пароля:', error);
    res.status(500).json({ error: 'Ошибка сервера при изменении пароля' });
  }
});

/**
 * @route   POST /api/auth/api-keys
 * @desc    Создание нового API ключа
 * @access  Private
 */
router.post('/api-keys', authenticateCombined, async (req, res) => {
  try {
    const { name, scope, expiresIn } = req.body;
    const userId = req.user.id;
    
    if (!name) {
      return res.status(400).json({ error: 'Необходимо указать название ключа' });
    }
    
    // Создаем случайный API ключ
    const apiKey = crypto.randomBytes(32).toString('hex');
    
    // Рассчитываем дату истечения
    let expiresAt = null;
    if (expiresIn) {
      expiresAt = new Date();
      
      if (expiresIn === '30d') {
        expiresAt.setDate(expiresAt.getDate() + 30);
      } else if (expiresIn === '90d') {
        expiresAt.setDate(expiresAt.getDate() + 90);
      } else if (expiresIn === '1y') {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }
    }
    
    const connection = await pool.getConnection();
    
    // Сохраняем API ключ
    const [result] = await connection.query(
      `INSERT INTO api_keys 
       (api_key, name, user_id, scope, active, expires_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [apiKey, name, userId, scope || null, 1, expiresAt]
    );
    
    connection.release();
    
    logger.info(`Пользователь ${req.user.username} создал новый API ключ: ${name}`);
    
    res.status(201).json({
      success: true,
      message: 'API ключ успешно создан',
      id: result.insertId,
      apiKey,
      name,
      scope,
      expiresAt
    });
  } catch (error) {
    logger.error('Ошибка при создании API ключа:', error);
    res.status(500).json({ error: 'Ошибка сервера при создании API ключа' });
  }
});

/**
 * @route   GET /api/auth/api-keys
 * @desc    Получение списка API ключей пользователя
 * @access  Private
 */
router.get('/api-keys', authenticateCombined, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const connection = await pool.getConnection();
    
    // Получаем список API ключей пользователя
    const [apiKeys] = await connection.query(
      `SELECT id, name, scope, active, created_at, expires_at
       FROM api_keys 
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    
    connection.release();
    
    res.json(apiKeys);
  } catch (error) {
    logger.error('Ошибка при получении списка API ключей:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении списка API ключей' });
  }
});

/**
 * @route   DELETE /api/auth/api-keys/:id
 * @desc    Удаление API ключа
 * @access  Private
 */
router.delete('/api-keys/:id', authenticateCombined, async (req, res) => {
  try {
    const keyId = parseInt(req.params.id);
    const userId = req.user.id;
    
    const connection = await pool.getConnection();
    
    // Проверяем, принадлежит ли ключ пользователю
    const [apiKeys] = await connection.query(
      'SELECT id FROM api_keys WHERE id = ? AND user_id = ?',
      [keyId, userId]
    );
    
    if (apiKeys.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'API ключ не найден' });
    }
    
    // Удаляем ключ
    await connection.query(
      'DELETE FROM api_keys WHERE id = ?',
      [keyId]
    );
    
    connection.release();
    
    logger.info(`Пользователь ${req.user.username} удалил API ключ #${keyId}`);
    
    res.json({
      success: true,
      message: 'API ключ успешно удален'
    });
  } catch (error) {
    logger.error('Ошибка при удалении API ключа:', error);
    res.status(500).json({ error: 'Ошибка сервера при удалении API ключа' });
  }
});

module.exports = router;
// src/middleware/auth.js

const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');

/**
 * Middleware для аутентификации по JWT токену
 * @param {Object} req - Express request объект
 * @param {Object} res - Express response объект
 * @param {Function} next - Express next функция
 * @returns {void}
 */
const authenticateJWT = async (req, res, next) => {
  // Получаем токен из заголовка Authorization
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Не предоставлен токен аутентификации' });
  }
  
  // Проверяем формат - "Bearer {token}"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Неверный формат токена' });
  }
  
  const token = parts[1];
  
  try {
    // Верифицируем токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Проверяем, не истекло ли время жизни токена
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: 'Токен истек' });
    }
    
    // Проверяем, существует ли пользователь
    const connection = await pool.getConnection();
    
    const [users] = await connection.query(
      'SELECT id, username, role FROM users WHERE id = ?',
      [decoded.userId]
    );
    
    connection.release();
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    
    // Добавляем информацию о пользователе в request
    req.user = {
      id: users[0].id,
      username: users[0].username,
      role: users[0].role
    };
    
    next();
  } catch (error) {
    logger.error('Ошибка при верификации JWT:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Неверный токен' });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Токен истек' });
    }
    
    return res.status(500).json({ error: 'Ошибка сервера при аутентификации' });
  }
};

/**
 * Middleware для аутентификации по API ключу
 * @param {Object} req - Express request объект
 * @param {Object} res - Express response объект
 * @param {Function} next - Express next функция
 * @returns {void}
 */
const authenticateAPIKey = async (req, res, next) => {
  // Получаем API ключ из заголовка или query параметра
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API ключ не предоставлен' });
  }
  
  try {
    // Проверяем API ключ в базе данных
    const connection = await pool.getConnection();
    
    const [apiKeys] = await connection.query(
      'SELECT * FROM api_keys WHERE api_key = ? AND active = 1',
      [apiKey]
    );
    
    connection.release();
    
    if (apiKeys.length === 0) {
      logger.warn(`Попытка использования неверного API ключа: ${apiKey.substring(0, 8)}...`);
      return res.status(401).json({ error: 'Неверный API ключ' });
    }
    
    // Проверяем срок действия ключа
    if (apiKeys[0].expires_at && new Date(apiKeys[0].expires_at) < new Date()) {
      logger.warn(`Попытка использования истекшего API ключа: ${apiKey.substring(0, 8)}...`);
      return res.status(401).json({ error: 'API ключ истек' });
    }
    
    // Добавляем информацию о ключе в request
    req.apiKey = {
      id: apiKeys[0].id,
      name: apiKeys[0].name,
      scope: apiKeys[0].scope,
      userId: apiKeys[0].user_id
    };
    
    // Если есть связанный пользователь, добавляем его информацию
    if (apiKeys[0].user_id) {
      const connection = await pool.getConnection();
      
      const [users] = await connection.query(
        'SELECT id, username, role FROM users WHERE id = ?',
        [apiKeys[0].user_id]
      );
      
      connection.release();
      
      if (users.length > 0) {
        req.user = {
          id: users[0].id,
          username: users[0].username,
          role: users[0].role
        };
      }
    }
    
    // Логируем использование API ключа
    logAPIKeyUsage(apiKeys[0].id, req);
    
    next();
  } catch (error) {
    logger.error('Ошибка при проверке API ключа:', error);
    return res.status(500).json({ error: 'Ошибка сервера при проверке API ключа' });
  }
};

/**
 * Middleware для обеспечения авторизации по ролям
 * @param {Array<string>} allowedRoles - Список разрешенных ролей
 * @returns {Function} - Express middleware
 */
const authorize = (allowedRoles) => {
  return (req, res, next) => {
    // Проверяем наличие пользователя (должен быть добавлен аутентификацией)
    if (!req.user) {
      return res.status(401).json({ error: 'Требуется аутентификация' });
    }
    
    // Проверяем наличие роли в списке разрешенных
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }
    
    // Логируем попытку доступа
    logger.warn(`Отказ в доступе пользователю ${req.user.username} с ролью ${req.user.role} к ${req.originalUrl}`);
    
    res.status(403).json({ error: 'Недостаточно прав' });
  };
};

/**
 * Middleware для комбинированной аутентификации - JWT или API ключ
 * @param {Object} req - Express request объект
 * @param {Object} res - Express response объект
 * @param {Function} next - Express next функция
 * @returns {void}
 */
const authenticateCombined = async (req, res, next) => {
  // Проверяем наличие Authorization заголовка (JWT)
  if (req.headers.authorization) {
    return authenticateJWT(req, res, next);
  }
  
  // Проверяем наличие API ключа
  if (req.headers['x-api-key'] || req.query.api_key) {
    return authenticateAPIKey(req, res, next);
  }
  
  // Если в режиме разработки, пропускаем аутентификацию
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
    req.user = { id: 0, username: 'dev', role: 'admin' };
    return next();
  }
  
  // Ни один метод не подошел
  res.status(401).json({ error: 'Требуется аутентификация' });
};

/**
 * Логирует использование API ключа
 * @param {number} keyId - ID API ключа
 * @param {Object} req - Express request объект
 */
async function logAPIKeyUsage(keyId, req) {
  try {
    const connection = await pool.getConnection();
    
    await connection.query(
      `INSERT INTO api_key_logs 
       (api_key_id, method, path, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        keyId,
        req.method,
        req.originalUrl,
        req.ip,
        req.headers['user-agent'] || 'unknown'
      ]
    );
    
    connection.release();
  } catch (error) {
    logger.error('Ошибка при логировании использования API ключа:', error);
  }
}

module.exports = {
  authenticateJWT,
  authenticateAPIKey,
  authenticateCombined,
  authorize
};
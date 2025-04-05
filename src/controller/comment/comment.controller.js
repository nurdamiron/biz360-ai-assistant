// src/controller/comment/comment.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');
const { markdown } = require('../../utils/markdown');

/**
 * Контроллер для управления комментариями к задачам и подзадачам
 */
const commentController = {
  /**
   * Получить комментарии к задаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskComments(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT id FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Получаем комментарии с информацией о пользователях
      const [comments] = await connection.query(
        `SELECT 
          tc.*,
          u.username,
          u.role as user_role
        FROM task_comments tc
        JOIN users u ON tc.user_id = u.id
        WHERE tc.task_id = ?
        ORDER BY tc.created_at ASC`,
        [taskId]
      );
      
      connection.release();
      
      // Обрабатываем Markdown в комментариях
      const processedComments = comments.map(comment => ({
        ...comment,
        content_html: markdown.parse(comment.content)
      }));
      
      res.json(processedComments);
    } catch (error) {
      logger.error(`Ошибка при получении комментариев для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении комментариев для задачи' });
    }
  },

  /**
   * Получить комментарии к подзадаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getSubtaskComments(req, res) {
    try {
      const subtaskId = parseInt(req.params.subtaskId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование подзадачи
      const [subtasks] = await connection.query(
        'SELECT id FROM subtasks WHERE id = ?',
        [subtaskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      // Получаем комментарии с информацией о пользователях
      const [comments] = await connection.query(
        `SELECT 
          sc.*,
          u.username,
          u.role as user_role
        FROM subtask_comments sc
        JOIN users u ON sc.user_id = u.id
        WHERE sc.subtask_id = ?
        ORDER BY sc.created_at ASC`,
        [subtaskId]
      );
      
      connection.release();
      
      // Обрабатываем Markdown в комментариях
      const processedComments = comments.map(comment => ({
        ...comment,
        content_html: markdown.parse(comment.content)
      }));
      
      res.json(processedComments);
    } catch (error) {
      logger.error(`Ошибка при получении комментариев для подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении комментариев для подзадачи' });
    }
  },

  /**
   * Создать комментарий к задаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createTaskComment(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const { content } = req.body;
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Содержимое комментария не может быть пустым' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование задачи
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Задача не найдена' });
      }
      
      // Получаем ID пользователя из запроса (после аутентификации)
      const userId = req.user.id;
      
      // Создаем комментарий
      const [result] = await connection.query(
        'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)',
        [taskId, userId, content]
      );
      
      // Получаем созданный комментарий с информацией о пользователе
      const [comments] = await connection.query(
        `SELECT 
          tc.*,
          u.username,
          u.role as user_role
        FROM task_comments tc
        JOIN users u ON tc.user_id = u.id
        WHERE tc.id = ?`,
        [result.insertId]
      );
      
      // Добавляем запись в логи задачи
      await taskLogger.logInfo(taskId, `Добавлен комментарий от ${req.user.username}`);
      
      connection.release();
      
      const comment = comments[0];
      comment.content_html = markdown.parse(comment.content);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_comment_added',
          comment
        });
      }
      
      res.status(201).json(comment);
    } catch (error) {
      logger.error(`Ошибка при создании комментария для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при создании комментария для задачи' });
    }
  },

  /**
   * Создать комментарий к подзадаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createSubtaskComment(req, res) {
    try {
      const subtaskId = parseInt(req.params.subtaskId);
      const { content } = req.body;
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Содержимое комментария не может быть пустым' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование подзадачи
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE id = ?',
        [subtaskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      const subtask = subtasks[0];
      
      // Получаем ID пользователя из запроса (после аутентификации)
      const userId = req.user.id;
      
      // Создаем комментарий
      const [result] = await connection.query(
        'INSERT INTO subtask_comments (subtask_id, user_id, content) VALUES (?, ?, ?)',
        [subtaskId, userId, content]
      );
      
      // Получаем созданный комментарий с информацией о пользователе
      const [comments] = await connection.query(
        `SELECT 
          sc.*,
          u.username,
          u.role as user_role
        FROM subtask_comments sc
        JOIN users u ON sc.user_id = u.id
        WHERE sc.id = ?`,
        [result.insertId]
      );
      
      // Добавляем запись в логи задачи
      await taskLogger.logInfo(
        subtask.task_id, 
        `Добавлен комментарий к подзадаче #${subtaskId} от ${req.user.username}`
      );
      
      connection.release();
      
      const comment = comments[0];
      comment.content_html = markdown.parse(comment.content);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('subtask', subtaskId, {
          type: 'subtask_comment_added',
          comment
        });
        
        wsServer.notifySubscribers('task', subtask.task_id, {
          type: 'subtask_comment_added',
          subtaskId,
          comment
        });
      }
      
      res.status(201).json(comment);
    } catch (error) {
      logger.error(`Ошибка при создании комментария для подзадачи #${req.params.subtaskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при создании комментария для подзадачи' });
    }
  },

  /**
   * Обновить комментарий к задаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateTaskComment(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const commentId = parseInt(req.params.commentId);
      const { content } = req.body;
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Содержимое комментария не может быть пустым' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование комментария
      const [comments] = await connection.query(
        'SELECT * FROM task_comments WHERE id = ? AND task_id = ?',
        [commentId, taskId]
      );
      
      if (comments.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Комментарий не найден' });
      }
      
      const comment = comments[0];
      
      // Проверяем права - только автор или администратор может редактировать
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на редактирование комментария' });
      }
      
      // Обновляем комментарий
      await connection.query(
        'UPDATE task_comments SET content = ?, updated_at = NOW() WHERE id = ?',
        [content, commentId]
      );
      
      // Получаем обновленный комментарий
      const [updatedComments] = await connection.query(
        `SELECT 
          tc.*,
          u.username,
          u.role as user_role
        FROM task_comments tc
        JOIN users u ON tc.user_id = u.id
        WHERE tc.id = ?`,
        [commentId]
      );
      
      connection.release();
      
      const updatedComment = updatedComments[0];
      updatedComment.content_html = markdown.parse(updatedComment.content);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_comment_updated',
          comment: updatedComment
        });
      }
      
      res.json(updatedComment);
    } catch (error) {
      logger.error(`Ошибка при обновлении комментария #${req.params.commentId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении комментария' });
    }
  },

  /**
   * Обновить комментарий к подзадаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateSubtaskComment(req, res) {
    try {
      const subtaskId = parseInt(req.params.subtaskId);
      const commentId = parseInt(req.params.commentId);
      const { content } = req.body;
      
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Содержимое комментария не может быть пустым' });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование комментария
      const [comments] = await connection.query(
        'SELECT * FROM subtask_comments WHERE id = ? AND subtask_id = ?',
        [commentId, subtaskId]
      );
      
      if (comments.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Комментарий не найден' });
      }
      
      const comment = comments[0];
      
      // Проверяем права - только автор или администратор может редактировать
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на редактирование комментария' });
      }
      
      // Проверяем существование подзадачи и получаем ID родительской задачи
      const [subtasks] = await connection.query(
        'SELECT task_id FROM subtasks WHERE id = ?',
        [subtaskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      const taskId = subtasks[0].task_id;
      
      // Обновляем комментарий
      await connection.query(
        'UPDATE subtask_comments SET content = ?, updated_at = NOW() WHERE id = ?',
        [content, commentId]
      );
      
      // Получаем обновленный комментарий
      const [updatedComments] = await connection.query(
        `SELECT 
          sc.*,
          u.username,
          u.role as user_role
        FROM subtask_comments sc
        JOIN users u ON sc.user_id = u.id
        WHERE sc.id = ?`,
        [commentId]
      );
      
      connection.release();
      
      const updatedComment = updatedComments[0];
      updatedComment.content_html = markdown.parse(updatedComment.content);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('subtask', subtaskId, {
          type: 'subtask_comment_updated',
          comment: updatedComment
        });
        
        wsServer.notifySubscribers('task', taskId, {
          type: 'subtask_comment_updated',
          subtaskId,
          comment: updatedComment
        });
      }
      
      res.json(updatedComment);
    } catch (error) {
      logger.error(`Ошибка при обновлении комментария #${req.params.commentId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении комментария' });
    }
  },

  /**
   * Удалить комментарий к задаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteTaskComment(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      const commentId = parseInt(req.params.commentId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование комментария
      const [comments] = await connection.query(
        'SELECT * FROM task_comments WHERE id = ? AND task_id = ?',
        [commentId, taskId]
      );
      
      if (comments.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Комментарий не найден' });
      }
      
      const comment = comments[0];
      
      // Проверяем права - только автор или администратор может удалить
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на удаление комментария' });
      }
      
      // Удаляем комментарий
      await connection.query(
        'DELETE FROM task_comments WHERE id = ?',
        [commentId]
      );
      
      connection.release();
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_comment_deleted',
          commentId
        });
      }
      
      res.json({
        success: true,
        message: 'Комментарий успешно удален'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении комментария #${req.params.commentId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении комментария' });
    }
  },

  /**
   * Удалить комментарий к подзадаче
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteSubtaskComment(req, res) {
    try {
      const subtaskId = parseInt(req.params.subtaskId);
      const commentId = parseInt(req.params.commentId);
      
      const connection = await pool.getConnection();
      
      // Проверяем существование комментария
      const [comments] = await connection.query(
        'SELECT * FROM subtask_comments WHERE id = ? AND subtask_id = ?',
        [commentId, subtaskId]
      );
      
      if (comments.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Комментарий не найден' });
      }
      
      const comment = comments[0];
      
      // Проверяем права - только автор или администратор может удалить
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        connection.release();
        return res.status(403).json({ error: 'Нет прав на удаление комментария' });
      }
      
      // Проверяем существование подзадачи и получаем ID родительской задачи
      const [subtasks] = await connection.query(
        'SELECT task_id FROM subtasks WHERE id = ?',
        [subtaskId]
      );
      
      if (subtasks.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Подзадача не найдена' });
      }
      
      const taskId = subtasks[0].task_id;
      
      // Удаляем комментарий
      await connection.query(
        'DELETE FROM subtask_comments WHERE id = ?',
        [commentId]
      );
      
      connection.release();
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('subtask', subtaskId, {
          type: 'subtask_comment_deleted',
          commentId
        });
        
        wsServer.notifySubscribers('task', taskId, {
          type: 'subtask_comment_deleted',
          subtaskId,
          commentId
        });
      }
      
      res.json({
        success: true,
        message: 'Комментарий успешно удален'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении комментария #${req.params.commentId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при удалении комментария' });
    }
  }
};

module.exports = commentController;
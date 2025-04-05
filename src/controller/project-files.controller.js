// src/controllers/project-files.controller.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Контроллер для работы с файлами проекта
 */
const projectFilesController = {
  /**
   * Получить список файлов проекта
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getProjectFiles(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { path = '' } = req.query;
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Получаем файлы из указанного каталога
      const pathPattern = path ? `${path}/%` : '%';
      const [files] = await connection.query(
        `SELECT 
          id, file_path, file_type, last_analyzed, created_at, updated_at
        FROM project_files 
        WHERE project_id = ? AND file_path LIKE ?`,
        [projectId, pathPattern]
      );
      
      connection.release();
      
      // Формируем дерево файлов и папок
      const fileTree = [];
      const directories = new Set();
      
      files.forEach(file => {
        // Удаляем префикс пути, если он указан
        let relativePath = file.file_path;
        if (path && relativePath.startsWith(path + '/')) {
          relativePath = relativePath.substring(path.length + 1);
        }
        
        // Проверяем, есть ли в пути подкаталоги
        const parts = relativePath.split('/');
        
        if (parts.length > 1) {
          // Это файл в подкаталоге, добавляем каталог
          directories.add(parts[0]);
        } else {
          // Это файл в текущем каталоге
          fileTree.push({
            id: file.id,
            name: relativePath,
            path: file.file_path,
            type: file.file_type,
            isDirectory: false,
            lastModified: file.updated_at
          });
        }
      });
      
      // Добавляем каталоги в список
      directories.forEach(dir => {
        fileTree.push({
          name: dir,
          path: path ? `${path}/${dir}` : dir,
          type: 'directory',
          isDirectory: true
        });
      });
      
      res.json({
        success: true,
        data: {
          path,
          items: fileTree
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении файлов проекта #${req.params.id}:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении файлов проекта' 
      });
    }
  },

  /**
   * Получить содержимое файла проекта
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getFileContent(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { path } = req.query;
      
      if (!path) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать путь к файлу (path)' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Проверяем существование файла
      const [files] = await connection.query(
        `SELECT id FROM project_files 
         WHERE project_id = ? AND file_path = ?`,
        [projectId, path]
      );
      
      if (files.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Файл не найден' 
        });
      }
      
      // Получаем содержимое из векторного хранилища кода
      const [codeSegments] = await connection.query(
        `SELECT code_segment FROM code_vectors 
         WHERE file_id = ? 
         ORDER BY start_line`,
        [files[0].id]
      );
      
      connection.release();
      
      // Объединяем сегменты в полное содержимое файла
      const content = codeSegments.length > 0
        ? codeSegments.map(segment => segment.code_segment).join('\n')
        : '// Содержимое файла недоступно';
      
      res.json({
        success: true,
        data: {
          path,
          content
        }
      });
    } catch (error) {
      logger.error(`Ошибка при получении содержимого файла:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при получении содержимого файла' 
      });
    }
  },

  /**
   * Сохранить содержимое файла
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async saveFileContent(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { path, content } = req.body;
      
      if (!path || content === undefined) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать путь к файлу (path) и содержимое (content)' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Проверяем существование файла
      const [files] = await connection.query(
        `SELECT id, file_hash FROM project_files 
         WHERE project_id = ? AND file_path = ?`,
        [projectId, path]
      );
      
      const newHash = crypto.createHash('md5').update(content).digest('hex');
      
      if (files.length === 0) {
        // Файл не существует, создаем его
        const fileExtension = path.split('.').pop().toLowerCase();
        
        // Определяем тип файла по расширению
        let fileType = fileExtension;
        if (['js', 'jsx'].includes(fileExtension)) {
          fileType = 'javascript';
        } else if (['ts', 'tsx'].includes(fileExtension)) {
          fileType = 'typescript';
        }
        
        // Вставляем информацию о файле
        const [result] = await connection.query(
          `INSERT INTO project_files 
           (project_id, file_path, file_type, file_hash) 
           VALUES (?, ?, ?, ?)`,
          [projectId, path, fileType, newHash]
        );
        
        // Создаем векторное представление содержимого
        if (result.insertId) {
          await connection.query(
            `INSERT INTO code_vectors 
             (file_id, code_segment, start_line, end_line, embedding) 
             VALUES (?, ?, ?, ?, ?)`,
            [result.insertId, content, 1, content.split('\n').length, '[]']
          );
        }
      } else {
        // Файл существует, обновляем его
        const fileId = files[0].id;
        const oldHash = files[0].file_hash;
        
        // Обновляем хеш файла только если содержимое изменилось
        if (oldHash !== newHash) {
          await connection.query(
            `UPDATE project_files 
             SET file_hash = ?, updated_at = NOW() 
             WHERE id = ?`,
            [newHash, fileId]
          );
          
          // Удаляем старые сегменты кода
          await connection.query(
            'DELETE FROM code_vectors WHERE file_id = ?',
            [fileId]
          );
          
          // Создаем новое векторное представление
          await connection.query(
            `INSERT INTO code_vectors 
             (file_id, code_segment, start_line, end_line, embedding) 
             VALUES (?, ?, ?, ?, ?)`,
            [fileId, content, 1, content.split('\n').length, '[]']
          );
        }
      }
      
      connection.release();
      
      res.json({
        success: true,
        message: 'Файл успешно сохранен'
      });
    } catch (error) {
      logger.error(`Ошибка при сохранении содержимого файла:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при сохранении содержимого файла' 
      });
    }
  },

  /**
   * Создать новую папку
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async createFolder(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { path } = req.body;
      
      if (!path) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать путь к папке (path)' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // В реальном приложении здесь должен быть код для создания папки
      // в файловой системе или хранилище
      // Для примера отправляем успешный ответ
      
      connection.release();
      
      res.json({
        success: true,
        message: 'Папка успешно создана'
      });
    } catch (error) {
      logger.error(`Ошибка при создании папки:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при создании папки' 
      });
    }
  },

  /**
   * Удалить файл или папку
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async deleteFile(req, res) {
    try {
      const projectId = parseInt(req.params.id);
      const { path } = req.query;
      
      if (!path) {
        return res.status(400).json({ 
          success: false,
          error: 'Необходимо указать путь к файлу или папке (path)' 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование проекта
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ 
          success: false,
          error: 'Проект не найден' 
        });
      }
      
      // Если это файл, удаляем его из БД
      const [files] = await connection.query(
        `SELECT id FROM project_files 
         WHERE project_id = ? AND file_path = ?`,
        [projectId, path]
      );
      
      if (files.length > 0) {
        // Удаляем файл
        await connection.query(
          'DELETE FROM project_files WHERE id = ?',
          [files[0].id]
        );
      } else {
        // Это папка, удаляем все файлы внутри неё
        await connection.query(
          `DELETE FROM project_files 
           WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)`,
          [projectId, path, `${path}/%`]
        );
      }
      
      connection.release();
      
      res.json({
        success: true,
        message: 'Файл или папка успешно удалены'
      });
    } catch (error) {
      logger.error(`Ошибка при удалении файла или папки:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Ошибка сервера при удалении файла или папки' 
      });
    }
  }
};

module.exports = projectFilesController;
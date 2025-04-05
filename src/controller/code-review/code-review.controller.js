// src/controller/code-review/code-review.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');
const { getLLMClient } = require('../../utils/llm-client');
const notificationManager = require('../../utils/notification-manager');

/**
 * Контроллер для AI-проверки кода
 */
const codeReviewController = {
  /**
   * Запрашивает AI-ревью кода
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async requestReview(req, res) {
    try {
      const { code, filePath, language, taskId, generationId } = req.body;
      
      // Проверяем обязательные поля
      if (!code) {
        return res.status(400).json({ error: 'Необходимо указать код для проверки' });
      }
      
      if (!filePath) {
        return res.status(400).json({ error: 'Необходимо указать путь к файлу' });
      }
      
      // Проверяем существование задачи, если указан taskId
      if (taskId) {
        const connection = await pool.getConnection();
        
        const [tasks] = await connection.query(
          'SELECT * FROM tasks WHERE id = ?',
          [taskId]
        );
        
        connection.release();
        
        if (tasks.length === 0) {
          return res.status(404).json({ error: 'Задача не найдена' });
        }
        
        // Логируем начало проверки кода
        await taskLogger.logInfo(taskId, `Запрошена AI-проверка кода для файла: ${filePath}`);
      }
      
      // Определяем язык программирования
      const detectedLanguage = language || this._detectLanguageFromFilePath(filePath);
      
      // Создаем промпт для проверки кода
      const prompt = this._createCodeReviewPrompt(code, detectedLanguage, filePath);
      
      // Получаем LLM клиент
      const llmClient = getLLMClient();
      
      // Отправляем запрос на проверку кода
      const response = await llmClient.sendPrompt(prompt);
      
      // Обрабатываем ответ
      const reviewResult = this._parseReviewResponse(response);
      
      // Сохраняем результат проверки в БД
      const reviewId = await this._saveReviewResult(
        code, 
        filePath, 
        detectedLanguage, 
        reviewResult, 
        taskId, 
        generationId
      );
      
      // Если указан taskId, логируем результаты проверки
      if (taskId) {
        await taskLogger.logInfo(
          taskId, 
          `Проверка кода завершена для файла: ${filePath}. Оценка: ${reviewResult.score}/10`
        );

        // Отправляем уведомление о результатах проверки кода
// Получаем информацию о задаче и исполнителе
const taskConnection = await pool.getConnection();
const [taskInfo] = await taskConnection.query(
  'SELECT t.assigned_to, t.created_by, t.title, u.username FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.id = ?',
  [taskId]
);
taskConnection.release();

if (taskInfo.length > 0) {
    const task = taskInfo[0];
    
    // Создаем сообщение в зависимости от результата проверки
    let title, message;
    
    if (reviewResult.score >= 8) {
      title = 'Отличный результат проверки кода';
      message = `Проверка кода для файла ${filePath} завершена с отличной оценкой: ${reviewResult.score}/10.`;
    } else if (reviewResult.score >= 6) {
      title = 'Хороший результат проверки кода';
      message = `Проверка кода для файла ${filePath} завершена с хорошей оценкой: ${reviewResult.score}/10.`;
    } else if (reviewResult.score >= 4) {
      title = 'Результат проверки кода требует внимания';
      message = `Проверка кода для файла ${filePath} завершена с оценкой ${reviewResult.score}/10. Рекомендуется внести исправления.`;
    } else {
      title = 'Низкий результат проверки кода';
      message = `Проверка кода для файла ${filePath} завершена с низкой оценкой: ${reviewResult.score}/10. Необходимо внести исправления.`;
    }
    
    // Отправляем уведомление исполнителю
    if (task.assigned_to) {
      await notificationManager.sendNotification({
        type: 'code_review_completed',
        userId: task.assigned_to,
        title,
        message,
        taskId,
        data: {
          taskId,
          taskTitle: task.title,
          filePath,
          score: reviewResult.score,
          reviewId,
          issues: reviewResult.issues.length,
          generationId: generationId || null
        }
      });
    }
    
    // Отправляем уведомление автору задачи, если он не является исполнителем
    if (task.created_by && task.created_by !== task.assigned_to) {
      await notificationManager.sendNotification({
        type: 'code_review_completed',
        userId: task.created_by,
        title,
        message,
        taskId,
        data: {
          taskId,
          taskTitle: task.title,
          filePath,
          score: reviewResult.score,
          reviewId,
          issues: reviewResult.issues.length,
          generationId: generationId || null,
          assignee: task.username
        }
      });
    }
  }
        
        // Если есть генерация кода, обновляем ее статус
        if (generationId) {
          const connection = await pool.getConnection();
          
          await connection.query(
            `UPDATE code_generations 
             SET status = ?, feedback = ?, updated_at = NOW() 
             WHERE id = ?`,
            [
              reviewResult.score >= 7 ? 'approved' : 'pending_review',
              JSON.stringify(reviewResult),
              generationId
            ]
          );
          
          connection.release();
        }
        
        // Отправляем уведомление через WebSockets, если есть
        const wsServer = websocket.getInstance();
        if (wsServer) {
          wsServer.notifySubscribers('task', taskId, {
            type: 'code_review_completed',
            taskId,
            generationId,
            reviewId,
            reviewResult
          });
        }
      }
      
      res.json({
        success: true,
        reviewId,
        result: reviewResult
      });
    } catch (error) {
      logger.error('Ошибка при запросе AI-проверки кода:', error);
      
      // Если указан taskId, логируем ошибку в лог задачи
      if (req.body.taskId) {
        try {
          await taskLogger.logError(
            req.body.taskId, 
            `Ошибка при проверке кода: ${error.message}`
          );
        } catch (logError) {
          logger.error('Не удалось записать ошибку в лог задачи:', logError);
        }
      }
      
      res.status(500).json({ error: 'Ошибка сервера при запросе AI-проверки кода' });
    }
  },

  /**
   * Получает результаты проверки кода
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getReview(req, res) {
    try {
      const reviewId = parseInt(req.params.id);
      
      const connection = await pool.getConnection();
      
      // Получаем результаты проверки
      const [reviews] = await connection.query(
        'SELECT * FROM code_reviews WHERE id = ?',
        [reviewId]
      );
      
      connection.release();
      
      if (reviews.length === 0) {
        return res.status(404).json({ error: 'Результаты проверки не найдены' });
      }
      
      const review = reviews[0];
      
      // Парсим результаты проверки
      if (review.review_result) {
        review.result = JSON.parse(review.review_result);
      }
      
      res.json(review);
    } catch (error) {
      logger.error(`Ошибка при получении результатов проверки #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении результатов проверки' });
    }
  },

  /**
   * Получает историю проверок кода для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getTaskReviews(req, res) {
    try {
      const taskId = parseInt(req.params.taskId);
      
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
      
      // Получаем все проверки кода для задачи
      const [reviews] = await connection.query(
        'SELECT * FROM code_reviews WHERE task_id = ? ORDER BY created_at DESC',
        [taskId]
      );
      
      connection.release();
      
      // Парсим результаты проверки
      for (const review of reviews) {
        if (review.review_result) {
          review.result = JSON.parse(review.review_result);
          delete review.review_result; // Удаляем исходное поле для экономии трафика
        }
      }
      
      res.json(reviews);
    } catch (error) {
      logger.error(`Ошибка при получении истории проверок для задачи #${req.params.taskId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении истории проверок' });
    }
  },

  /**
   * Создает промпт для проверки кода
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Промпт для LLM
   * @private
   */
  _createCodeReviewPrompt(code, language, filePath) {
    return `
# Проверка кода

## Файл
Путь: ${filePath}
Язык: ${language}

## Код для проверки
\`\`\`${language}
${code}
\`\`\`

## Инструкции
1. Проведи тщательный анализ приведенного кода.
2. Выяви проблемы, ошибки, недостатки и потенциальные улучшения.
3. Обрати внимание на следующие аспекты:
   - Синтаксические ошибки
   - Логические ошибки
   - Проблемы с безопасностью
   - Производительность
   - Читаемость
   - Соответствие лучшим практикам

## Формат ответа
Ответ должен быть предоставлен в формате JSON:
{
  "score": <число от 1 до 10>,
  "summary": "<краткое резюме в одно предложение>",
  "strengths": [
    "<сильная сторона 1>",
    "<сильная сторона 2>",
    ...
  ],
  "issues": [
    {
      "severity": "<critical|major|minor|suggestion>",
      "line": <номер строки или null>,
      "description": "<описание проблемы>",
      "solution": "<предлагаемое решение>"
    },
    ...
  ],
  "recommendations": [
    "<рекомендация 1>",
    "<рекомендация 2>",
    ...
  ]
}
`;
  },

  /**
   * Парсит ответ с результатами проверки
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Обработанные результаты проверки
   * @private
   */
  _parseReviewResponse(response) {
    try {
      // Ищем JSON в ответе
      const jsonMatch = response.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        // Парсим JSON
        const reviewResult = JSON.parse(jsonMatch[0]);
        
        // Проверяем наличие обязательных полей
        if (!reviewResult.score) {
          reviewResult.score = 5; // По умолчанию средняя оценка
        }
        
        if (!reviewResult.summary) {
          reviewResult.summary = 'Результаты проверки кода';
        }
        
        if (!reviewResult.issues) {
          reviewResult.issues = [];
        }
        
        return reviewResult;
      }
      
      // Если не удалось распарсить JSON, возвращаем минимальную структуру
      return {
        score: 5,
        summary: 'Не удалось получить структурированные результаты проверки',
        strengths: [],
        issues: [],
        recommendations: [
          'Повторите запрос на проверку кода'
        ]
      };
    } catch (error) {
      logger.error('Ошибка при парсинге результатов проверки:', error);
      
      // В случае ошибки возвращаем минимальную структуру
      return {
        score: 5,
        summary: 'Произошла ошибка при обработке результатов проверки',
        strengths: [],
        issues: [],
        recommendations: [
          'Повторите запрос на проверку кода'
        ]
      };
    }
  },

  /**
   * Сохраняет результат проверки кода в БД
   * @param {string} code - Проверенный код
   * @param {string} filePath - Путь к файлу
   * @param {string} language - Язык программирования
   * @param {Object} reviewResult - Результаты проверки
   * @param {number} [taskId] - ID задачи (опционально)
   * @param {number} [generationId] - ID генерации кода (опционально)
   * @returns {Promise<number>} - ID записи о проверке
   * @private
   */
  async _saveReviewResult(code, filePath, language, reviewResult, taskId = null, generationId = null) {
    const connection = await pool.getConnection();
    
    try {
      // Сохраняем результаты проверки
      const [result] = await connection.query(
        `INSERT INTO code_reviews 
         (task_id, generation_id, file_path, language, code, review_result, score, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          taskId,
          generationId,
          filePath,
          language,
          code,
          JSON.stringify(reviewResult),
          reviewResult.score
        ]
      );
      
      return result.insertId;
    } finally {
      connection.release();
    }
  },

  /**
   * Определяет язык программирования по пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Язык программирования
   * @private
   */
  _detectLanguageFromFilePath(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    
    const extensionToLanguage = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'rs': 'rust',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sql': 'sql',
      'sh': 'bash'
    };
    
    return extensionToLanguage[extension] || extension;
  }
};

module.exports = codeReviewController;
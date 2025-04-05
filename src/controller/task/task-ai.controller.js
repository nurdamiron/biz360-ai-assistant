// src/controller/task/task-ai.controller.js

const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const websocket = require('../../websocket');
const TaskDecomposer = require('../../core/task-planner/decomposer');
const { getLLMClient } = require('../../utils/llm-client');

/**
 * Контроллер для взаимодействия с AI-компонентами в контексте задач
 */
const taskAIController = {
  /**
   * Декомпозирует задачу на подзадачи с помощью AI
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async decomposeTask(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
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
      
      const task = tasks[0];
      
      // Получаем информацию о проекте
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [task.project_id]
      );
      
      if (projects.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Проект не найден' });
      }
      
      connection.release();
      
      // Логируем начало процесса декомпозиции
      await taskLogger.logInfo(taskId, 'Начата автоматическая декомпозиция задачи');
      
      // Создаем экземпляр декомпозера
      const decomposer = new TaskDecomposer(task.project_id);
      
      // Выполняем декомпозицию
      const subtasks = await decomposer.decompose(task);
      
      // Если не удалось получить подзадачи, возвращаем ошибку
      if (!subtasks || subtasks.length === 0) {
        await taskLogger.logError(taskId, 'Не удалось декомпозировать задачу на подзадачи');
        return res.status(400).json({ error: 'Не удалось декомпозировать задачу на подзадачи' });
      }
      
      // Сохраняем подзадачи в БД
      const savedSubtasks = await this._saveSubtasks(taskId, subtasks);
      
      // Логируем успешную декомпозицию
      await taskLogger.logInfo(taskId, `Задача успешно декомпозирована на ${savedSubtasks.length} подзадач`);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_decomposed',
          task,
          subtasks: savedSubtasks
        });
      }
      
      res.json({
        success: true,
        task,
        subtasks: savedSubtasks
      });
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи #${req.params.id}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.id), `Ошибка при декомпозиции: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при декомпозиции задачи' });
    }
  },

  /**
   * Сохраняет подзадачи в базе данных
   * @param {number} taskId - ID родительской задачи
   * @param {Array<Object>} subtasks - Массив подзадач для сохранения
   * @returns {Promise<Array<Object>>} - Массив сохраненных подзадач с ID
   * @private
   */
  async _saveSubtasks(taskId, subtasks) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const savedSubtasks = [];
      
      // Сохраняем каждую подзадачу
      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];
        
        const [result] = await connection.query(
          `INSERT INTO subtasks 
           (task_id, title, description, status, sequence_number) 
           VALUES (?, ?, ?, ?, ?)`,
          [taskId, subtask.title, subtask.description, 'pending', i + 1]
        );
        
        savedSubtasks.push({
          id: result.insertId,
          task_id: taskId,
          title: subtask.title,
          description: subtask.description,
          status: 'pending',
          sequence_number: i + 1
        });
      }
      
      await connection.commit();
      
      return savedSubtasks;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  /**
   * Генерирует код для задачи с помощью AI
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async generateCode(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      const { filePath, language } = req.body;
      
      // Проверяем обязательные поля
      if (!filePath) {
        return res.status(400).json({ error: 'Необходимо указать путь к файлу (filePath)' });
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
      
      const task = tasks[0];
      
      // Получаем подзадачи, если есть
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      connection.release();
      
      // Логируем начало генерации кода
      await taskLogger.logInfo(taskId, `Начата генерация кода для файла: ${filePath}`);
      
      // Создаем промпт для генерации кода
      const prompt = await this._createCodeGenerationPrompt(task, subtasks, filePath, language, tags);
      
      // Получаем LLM клиент
      const llmClient = getLLMClient();
      
      // Отправляем запрос на генерацию кода
      const response = await llmClient.sendPrompt(prompt);
      
      // Извлекаем код из ответа
      const generatedCode = this._extractCodeFromResponse(response, language);
      
      // Если не удалось извлечь код, возвращаем ошибку
      if (!generatedCode) {
        await taskLogger.logError(taskId, 'Не удалось сгенерировать код');
        return res.status(400).json({ error: 'Не удалось сгенерировать код' });
      }
      
      // Сохраняем сгенерированный код в БД
      const codeGenerationId = await this._saveGeneratedCode(taskId, filePath, generatedCode, language);
      
      // Логируем успешную генерацию кода
      await taskLogger.logInfo(taskId, `Код успешно сгенерирован для файла: ${filePath}`);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'code_generated',
          taskId,
          filePath,
          generationId: codeGenerationId
        });
      }
      
      res.json({
        success: true,
        generationId: codeGenerationId,
        filePath,
        code: generatedCode,
        language: language || this._detectLanguageFromFilePath(filePath)
      });
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${req.params.id}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.id), `Ошибка при генерации кода: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при генерации кода' });
    }
  },

  /**
   * Создает промпт для генерации кода
   * @param {Object} task - Задача
   * @param {Array<Object>} subtasks - Подзадачи
   * @param {string} filePath - Путь к файлу
   * @param {string} language - Язык программирования (опционально)
   * @param {Array<string>} tags - Теги задачи
   * @returns {Promise<string>} - Промпт для LLM
   * @private
   */
  async _createCodeGenerationPrompt(task, subtasks, filePath, language, tags) {
    // Определяем язык по расширению файла, если не указан
    const detectedLanguage = language || this._detectLanguageFromFilePath(filePath);
    
    // Создаем базовый промпт
    const prompt = `
# Задача генерации кода

## Контекст
Ты - опытный разработчик, который пишет высококачественный код.

## Файл
Путь: ${filePath}
Язык: ${detectedLanguage}

## Задача
Название: ${task.title}
Описание: ${task.description}

${subtasks.length > 0 ? `
## Подзадачи
${subtasks.map((subtask, index) => `${index + 1}. ${subtask.title}\n   ${subtask.description}`).join('\n\n')}
` : ''}

${tags.length > 0 ? `
## Теги
${tags.join(', ')}
` : ''}

## Инструкции
1. Напиши код для файла ${filePath} на языке ${detectedLanguage}.
2. Код должен быть полным, рабочим и готовым к использованию.
3. Не пропускай важные детали.
4. Включи только код без пояснений внутри кода.
5. Используй лучшие практики для выбранного языка.
6. Следуй стандартам форматирования, типичным для выбранного языка.

## Формат ответа
\`\`\`${detectedLanguage}
// Твой код здесь
\`\`\`

## Описание решения
После кода предоставь краткое описание, начинающееся с "Описание решения:", в котором объясни основные принципы и архитектурные решения.
`;
    
    return prompt;
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
  },

  /**
   * Извлекает код из ответа LLM
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {string|null} - Извлеченный код или null, если код не найден
   * @private
   */
  _extractCodeFromResponse(response, language) {
    // Определяем язык для поиска блока кода
    const lang = language || '';
    
    // Ищем блок кода в формате ```язык ... ```
    const codeBlockRegex = new RegExp(`\`\`\`(?:${lang})?\\s*([\\s\\S]*?)\\s*\`\`\``, 'i');
    const match = response.match(codeBlockRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Если блок кода не найден, возвращаем null
    return null;
  },

  /**
   * Сохраняет сгенерированный код в БД
   * @param {number} taskId - ID задачи
   * @param {string} filePath - Путь к файлу
   * @param {string} code - Сгенерированный код
   * @param {string} language - Язык программирования
   * @returns {Promise<number>} - ID записи о генерации кода
   * @private
   */
  async _saveGeneratedCode(taskId, filePath, code, language) {
    const connection = await pool.getConnection();
    
    try {
      // Получаем определенный язык
      const detectedLanguage = language || this._detectLanguageFromFilePath(filePath);
      
      // Сохраняем сгенерированный код
      const [result] = await connection.query(
        `INSERT INTO code_generations 
         (task_id, file_path, language, generated_content, status, created_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [taskId, filePath, detectedLanguage, code, 'pending_review']
      );
      
      return result.insertId;
    } finally {
      connection.release();
    }
  },

  /**
   * Получить сгенерированный код для задачи
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async getGeneratedCode(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
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
      
      // Получаем все сгенерированные коды для задачи
      const [generations] = await connection.query(
        `SELECT * FROM code_generations 
         WHERE task_id = ? 
         ORDER BY created_at DESC`,
        [taskId]
      );
      
      connection.release();
      
      res.json(generations);
    } catch (error) {
      logger.error(`Ошибка при получении сгенерированного кода для задачи #${req.params.id}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при получении сгенерированного кода' });
    }
  },

  /**
   * Обновить статус сгенерированного кода
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async updateCodeStatus(req, res) {
    try {
      const generationId = parseInt(req.params.generationId);
      const { status, feedback } = req.body;
      
      // Проверяем статус
      const validStatuses = ['pending_review', 'approved', 'rejected', 'implemented'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Недопустимый статус. Разрешенные значения: ${validStatuses.join(', ')}` 
        });
      }
      
      const connection = await pool.getConnection();
      
      // Проверяем существование записи о генерации кода
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Запись о генерации кода не найдена' });
      }
      
      const generation = generations[0];
      const taskId = generation.task_id;
      
      // Обновляем статус сгенерированного кода
      await connection.query(
        `UPDATE code_generations 
         SET status = ?, feedback = ?, updated_at = NOW() 
         WHERE id = ?`,
        [status, feedback || null, generationId]
      );
      
      // Получаем обновленную запись
      const [updatedGenerations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      connection.release();
      
      // Логируем изменение статуса
      await taskLogger.logInfo(
        taskId, 
        `Статус сгенерированного кода для файла ${generation.file_path} изменен на "${status}"`
      );
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'code_status_updated',
          taskId,
          generation: updatedGenerations[0]
        });
      }
      
      res.json({
        success: true,
        generation: updatedGenerations[0]
      });
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса сгенерированного кода #${req.params.generationId}:`, error);
      res.status(500).json({ error: 'Ошибка сервера при обновлении статуса сгенерированного кода' });
    }
  },

  /**
   * Получить оценку сложности задачи с помощью AI
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async estimateTaskComplexity(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
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
      
      const task = tasks[0];
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      connection.release();
      
      // Логируем начало оценки сложности
      await taskLogger.logInfo(taskId, 'Начата оценка сложности задачи');
      
      // Создаем промпт для оценки сложности
      const prompt = `
# Оценка сложности задачи

## Задача
Название: ${task.title}
Описание: ${task.description}

${tags.length > 0 ? `
## Теги
${tags.join(', ')}
` : ''}

## Инструкции
1. Проанализируй задачу и оцени её сложность по шкале от 1 до 10, где:
   - 1-3: Простая задача, требующая до 4 часов работы
   - 4-6: Задача средней сложности, требующая 4-16 часов работы
   - 7-8: Сложная задача, требующая 16-40 часов работы
   - 9-10: Очень сложная задача, требующая более 40 часов работы

2. Также определи ориентировочное время выполнения в часах.

3. Укажи, какие знания и навыки необходимы для выполнения этой задачи.

## Формат ответа
Предоставь ответ в формате JSON:
{
  "complexity_score": <число от 1 до 10>,
  "estimated_hours": <количество часов>,
  "required_skills": ["навык1", "навык2", ...],
  "explanation": "Объяснение оценки"
}
`;
      
      // Получаем LLM клиент
      const llmClient = getLLMClient();
      
      // Отправляем запрос на оценку сложности
      const response = await llmClient.sendPrompt(prompt);
      
      // Извлекаем JSON из ответа
      const estimationData = this._extractJSONFromResponse(response);
      
      // Если не удалось извлечь данные, возвращаем ошибку
      if (!estimationData) {
        await taskLogger.logError(taskId, 'Не удалось получить оценку сложности');
        return res.status(400).json({ error: 'Не удалось получить оценку сложности' });
      }
      
      // Логируем успешную оценку сложности
      await taskLogger.logInfo(
        taskId, 
        `Сложность задачи оценена в ${estimationData.complexity_score}/10, ${estimationData.estimated_hours} часов`
      );
      
      // Обновляем задачу с оценкой сложности
      await this._updateTaskWithEstimation(taskId, estimationData);
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'task_complexity_estimated',
          taskId,
          estimation: estimationData
        });
      }
      
      res.json({
        success: true,
        taskId,
        estimation: estimationData
      });
    } catch (error) {
      logger.error(`Ошибка при оценке сложности задачи #${req.params.id}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.id), `Ошибка при оценке сложности: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при оценке сложности задачи' });
    }
  },

  /**
   * Извлекает JSON из ответа LLM
   * @param {string} response - Ответ от LLM
   * @returns {Object|null} - Извлеченный объект или null, если объект не найден
   * @private
   */
  _extractJSONFromResponse(response) {
    try {
      // Ищем JSON в формате {...}
      const jsonRegex = /{[\s\S]*}/;
      const match = response.match(jsonRegex);
      
      if (match) {
        // Парсим JSON
        return JSON.parse(match[0]);
      }
      
      // Если JSON не найден, возвращаем null
      return null;
    } catch (error) {
      logger.error('Ошибка при извлечении JSON из ответа:', error);
      return null;
    }
  },

  /**
   * Обновляет задачу с оценкой сложности
   * @param {number} taskId - ID задачи
   * @param {Object} estimation - Данные оценки сложности
   * @returns {Promise<void>}
   * @private
   */
  async _updateTaskWithEstimation(taskId, estimation) {
    const connection = await pool.getConnection();
    
    try {
      // Обновляем задачу с оценкой сложности
      await connection.query(
        `UPDATE tasks 
         SET 
           complexity = ?,
           estimated_hours = ?,
           updated_at = NOW()
         WHERE id = ?`,
        [
          estimation.complexity_score,
          estimation.estimated_hours,
          taskId
        ]
      );
      
      // Сохраняем дополнительные данные в мета-информации задачи
      const metaData = {
        required_skills: estimation.required_skills,
        complexity_explanation: estimation.explanation
      };
      
      // Сохраняем мета-данные в отдельной таблице task_meta
      await connection.query(
        `INSERT INTO task_meta (task_id, meta_key, meta_value)
         VALUES (?, 'complexity_estimation', ?)
         ON DUPLICATE KEY UPDATE meta_value = ?`,
        [
          taskId,
          JSON.stringify(metaData),
          JSON.stringify(metaData)
        ]
      );
    } finally {
      connection.release();
    }
  },

  /**
   * Сгенерировать план работы над задачей
   * @param {Object} req - Express request объект
   * @param {Object} res - Express response объект
   * @returns {Promise<void>}
   */
  async generateWorkPlan(req, res) {
    try {
      const taskId = parseInt(req.params.id);
      
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
      
      const task = tasks[0];
      
      // Получаем подзадачи
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      // Получаем теги задачи
      const [taskTags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = taskTags.map(tag => tag.tag_name);
      
      connection.release();
      
      // Если уже есть подзадачи, используем их как план
      if (subtasks.length > 0) {
        return res.json({
          success: true,
          taskId,
          workPlan: subtasks.map(subtask => ({
            step: subtask.sequence_number,
            title: subtask.title,
            description: subtask.description,
            status: subtask.status,
            id: subtask.id
          }))
        });
      }
      
      // Логируем начало генерации плана
      await taskLogger.logInfo(taskId, 'Начата генерация плана работы');
      
      // Создаем промпт для генерации плана
      const prompt = `
# Генерация плана работы

## Задача
Название: ${task.title}
Описание: ${task.description}

${tags.length > 0 ? `
## Теги
${tags.join(', ')}
` : ''}

## Инструкции
1. Разбей задачу на логические шаги выполнения.
2. Для каждого шага укажи название и подробное описание.
3. Шаги должны быть конкретными, выполнимыми и следовать в логическом порядке.
4. Рекомендуется от 3 до 7 шагов.

## Формат ответа
Предоставь ответ в формате JSON:
{
  "steps": [
    {
      "step": 1,
      "title": "Название шага 1",
      "description": "Подробное описание шага 1"
    },
    {
      "step": 2,
      "title": "Название шага 2",
      "description": "Подробное описание шага 2"
    }
  ]
}
`;
      
      // Получаем LLM клиент
      const llmClient = getLLMClient();
      
      // Отправляем запрос на генерацию плана
      const response = await llmClient.sendPrompt(prompt);
      
      // Извлекаем JSON из ответа
      const planData = this._extractJSONFromResponse(response);
      
      // Если не удалось извлечь данные, возвращаем ошибку
      if (!planData || !planData.steps || !Array.isArray(planData.steps)) {
        await taskLogger.logError(taskId, 'Не удалось сгенерировать план работы');
        return res.status(400).json({ error: 'Не удалось сгенерировать план работы' });
      }
      
      // Логируем успешную генерацию плана
      await taskLogger.logInfo(taskId, `План работы успешно сгенерирован: ${planData.steps.length} шагов`);
      
      // Сохраняем план работы как подзадачи
      await this._saveSubtasks(taskId, planData.steps.map(step => ({
        title: step.title,
        description: step.description
      })));
      
      // Отправляем уведомление через WebSockets, если есть
      const wsServer = websocket.getInstance();
      if (wsServer) {
        wsServer.notifySubscribers('task', taskId, {
          type: 'work_plan_generated',
          taskId,
          workPlan: planData.steps
        });
      }
      
      res.json({
        success: true,
        taskId,
        workPlan: planData.steps
      });
    } catch (error) {
      logger.error(`Ошибка при генерации плана работы для задачи #${req.params.id}:`, error);
      
      // Логируем ошибку в лог задачи
      try {
        await taskLogger.logError(parseInt(req.params.id), `Ошибка при генерации плана: ${error.message}`);
      } catch (logError) {
        logger.error('Не удалось записать ошибку в лог задачи:', logError);
      }
      
      res.status(500).json({ error: 'Ошибка сервера при генерации плана работы' });
    }
  }
};

module.exports = taskAIController;
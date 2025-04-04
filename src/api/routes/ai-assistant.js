// src/api/routes/ai-assistant.js

const express = require('express');
const router = express.Router();
const controller = require('../../controller');
const LearningSystem = require('../../core/learning-system');
const logger = require('../../utils/logger');

/**
 * @route   GET /api/ai-assistant/status
 * @desc    Получить статус ИИ-ассистента
 * @access  Private
 */
router.get('/status', async (req, res) => {
  try {
    // Получаем статистику очереди задач
    const queueStats = await controller.taskQueue.getQueueStats();
    
    // Формируем расширенный статус системы
    const status = {
      running: controller.running,
      queue: queueStats,
      tokenUsage: await getLLMTokenUsage()
    };
    
    res.json(status);
  } catch (error) {
    logger.error('Ошибка при получении статуса ИИ-ассистента:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении статуса' });
  }
});

/**
 * @route   POST /api/ai-assistant/analyze-task
 * @desc    Проанализировать задачу и дать рекомендации
 * @access  Private
 */
router.post('/analyze-task', async (req, res) => {
  try {
    const { projectId, taskId } = req.body;
    
    if (!projectId || !taskId) {
      return res.status(400).json({ 
        error: 'Необходимо указать projectId и taskId' 
      });
    }
    
    // Инициализируем систему обучения
    const learningSystem = new LearningSystem(projectId);
    await learningSystem.initialize();
    
    // Получаем рекомендации для задачи
    const recommendations = await learningSystem.getRecommendationsForTask(taskId);
    
    res.json(recommendations);
  } catch (error) {
    logger.error('Ошибка при анализе задачи:', error);
    res.status(500).json({ error: 'Ошибка сервера при анализе задачи' });
  }
});

/**
 * @route   POST /api/ai-assistant/process-task
 * @desc    Автоматически обработать задачу (декомпозиция, генерация кода, создание PR)
 * @access  Private
 */
router.post('/process-task', async (req, res) => {
  try {
    const { taskId } = req.body;
    
    if (!taskId) {
      return res.status(400).json({ error: 'Необходимо указать taskId' });
    }
    
    // Отправляем задачу на обработку контроллеру
    const result = await controller.handleTaskRequest(taskId);
    
    res.json(result);
  } catch (error) {
    logger.error(`Ошибка при обработке задачи #${req.body.taskId}:`, error);
    res.status(500).json({ error: 'Ошибка сервера при обработке задачи' });
  }
});

/**
 * @route   POST /api/ai-assistant/feedback
 * @desc    Отправить обратную связь по сгенерированному коду
 * @access  Private
 */
router.post('/feedback', async (req, res) => {
  try {
    const { projectId, generationId, feedbackText, rating } = req.body;
    
    if (!projectId || !generationId || !feedbackText) {
      return res.status(400).json({ 
        error: 'Необходимо указать projectId, generationId и feedbackText' 
      });
    }
    
    // Инициализируем систему обучения
    const learningSystem = new LearningSystem(projectId);
    await learningSystem.initialize();
    
    // Обрабатываем обратную связь
    await learningSystem.processFeedback(generationId, feedbackText, rating || 3);
    
    res.json({ success: true, message: 'Обратная связь успешно обработана' });
  } catch (error) {
    logger.error('Ошибка при обработке обратной связи:', error);
    res.status(500).json({ error: 'Ошибка сервера при обработке обратной связи' });
  }
});

/**
 * @route   GET /api/ai-assistant/performance-report
 * @desc    Получить отчет о производительности системы
 * @access  Private
 */
router.get('/performance-report', async (req, res) => {
  try {
    const { projectId, timeframe } = req.query;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Необходимо указать projectId' });
    }
    
    // Инициализируем систему обучения
    const learningSystem = new LearningSystem(parseInt(projectId));
    await learningSystem.initialize();
    
    // Создаем отчет о производительности
    const report = await learningSystem.generatePerformanceReport(timeframe);
    
    res.json(report);
  } catch (error) {
    logger.error('Ошибка при создании отчета о производительности:', error);
    res.status(500).json({ error: 'Ошибка сервера при создании отчета' });
  }
});

/**
 * @route   POST /api/ai-assistant/analyze-failed-generation
 * @desc    Анализировать неудачную генерацию кода
 * @access  Private
 */
router.post('/analyze-failed-generation', async (req, res) => {
  try {
    const { projectId, generationId } = req.body;
    
    if (!projectId || !generationId) {
      return res.status(400).json({ 
        error: 'Необходимо указать projectId и generationId' 
      });
    }
    
    // Инициализируем систему обучения
    const learningSystem = new LearningSystem(projectId);
    await learningSystem.initialize();
    
    // Анализируем неудачную генерацию
    const analysis = await learningSystem.analyzeFailedGeneration(generationId);
    
    res.json(analysis);
  } catch (error) {
    logger.error('Ошибка при анализе неудачной генерации:', error);
    res.status(500).json({ error: 'Ошибка сервера при анализе генерации' });
  }
});

/**
 * @route   POST /api/ai-assistant/regenerate-code
 * @desc    Повторно генерировать код с учетом обратной связи
 * @access  Private
 */
router.post('/regenerate-code', async (req, res) => {
  try {
    const { generationId, taskId, feedback } = req.body;
    
    if (!generationId || !taskId) {
      return res.status(400).json({ 
        error: 'Необходимо указать generationId и taskId' 
      });
    }
    
    // Получаем информацию о задаче для определения проекта
    const connection = req.app.locals.db;
    
    const [tasks] = await connection.query(
      'SELECT * FROM tasks WHERE id = ?',
      [taskId]
    );
    
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    
    const task = tasks[0];
    
    // Получаем информацию о предыдущей генерации
    const [generations] = await connection.query(
      'SELECT * FROM code_generations WHERE id = ?',
      [generationId]
    );
    
    if (generations.length === 0) {
      return res.status(404).json({ error: 'Генерация не найдена' });
    }
    
    const generation = generations[0];
    
    // Создаем индивидуальный CodeGenerator с учетом обратной связи
    const CodeGenerator = require('../../core/code-generator');
    const codeGenerator = new CodeGenerator(task.project_id);
    
    // Генерируем код с учетом обратной связи
    const result = await regenerateCodeWithFeedback(
      codeGenerator, 
      taskId, 
      generation, 
      feedback
    );
    
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error(`Ошибка при повторной генерации кода:`, error);
    res.status(500).json({ error: 'Ошибка сервера при повторной генерации кода' });
  }
});

/**
 * Функция для повторной генерации кода с учетом обратной связи
 * @param {Object} codeGenerator - Экземпляр генератора кода
 * @param {number} taskId - ID задачи
 * @param {Object} previousGeneration - Предыдущая генерация
 * @param {string} feedback - Обратная связь
 * @returns {Promise<Object>} - Результат генерации
 */
async function regenerateCodeWithFeedback(codeGenerator, taskId, previousGeneration, feedback) {
  try {
    // Получаем информацию о задаче
    const task = await codeGenerator.getTaskInfo(taskId);
    
    // Создаем специальный промпт с учетом обратной связи
    const promptBuilder = codeGenerator.promptBuilder;
    const customPrompt = await createCustomPromptWithFeedback(
      promptBuilder, 
      task, 
      previousGeneration, 
      feedback
    );
    
    // Отправляем запрос к LLM
    const response = await codeGenerator.llmClient.sendPrompt(customPrompt);
    
    // Логируем взаимодействие с LLM
    await codeGenerator.logLLMInteraction(taskId, customPrompt, response);
    
    // Извлекаем код из ответа LLM
    const extractedCode = codeGenerator.extractCodeFromResponse(response);
    
    if (!extractedCode.code) {
      throw new Error('Не удалось извлечь код из ответа LLM');
    }
    
    // Валидируем код
    const validationResult = await codeGenerator.codeValidator.validate(
      extractedCode.code, 
      extractedCode.language
    );
    
    if (!validationResult.isValid) {
      logger.warn(`Сгенерированный код не прошел валидацию: ${validationResult.error}`);
      
      // Если код не прошел валидацию, пробуем исправить его
      const fixedCode = await codeGenerator.fixInvalidCode(
        extractedCode.code, 
        validationResult.error
      );
      
      extractedCode.code = fixedCode;
    }
    
    // Используем тот же путь к файлу, что и в предыдущей генерации
    const filePath = previousGeneration.file_path;
    
    // Сохраняем сгенерированный код в БД
    const generationId = await codeGenerator.saveGeneratedCode(
      taskId, 
      filePath, 
      extractedCode.code
    );
    
    // Возвращаем результат
    return {
      taskId,
      generationId,
      filePath,
      code: extractedCode.code,
      language: extractedCode.language,
      summary: extractedCode.summary
    };
  } catch (error) {
    logger.error(`Ошибка при повторной генерации кода для задачи #${taskId}:`, error);
    throw error;
  }
}

/**
 * Создает специальный промпт с учетом обратной связи
 * @param {Object} promptBuilder - Экземпляр построителя промптов
 * @param {Object} task - Задача
 * @param {Object} previousGeneration - Предыдущая генерация
 * @param {string} feedback - Обратная связь
 * @returns {Promise<string>} - Промпт для LLM
 */
async function createCustomPromptWithFeedback(promptBuilder, task, previousGeneration, feedback) {
  // Создаем базовый промпт для генерации кода
  const basePrompt = await promptBuilder.createCodeGenerationPrompt(task);
  
  // Добавляем информацию о предыдущей генерации и обратной связи
  const customPrompt = `
${basePrompt}

## Предыдущая генерация и обратная связь
Ты уже пытался решить эту задачу, но решение требует улучшения.

### Предыдущий код
\`\`\`javascript
${previousGeneration.generated_content}
\`\`\`

### Обратная связь разработчика
${feedback}

Улучши предыдущее решение, учитывая обратную связь. Исправь указанные проблемы и избегай повторения прежних ошибок.
`;
  
  return customPrompt;
}

/**
 * Получает статистику использования токенов LLM
 * @returns {Promise<Object>} - Статистика использования
 */
async function getLLMTokenUsage() {
  try {
    const { getLLMClient } = require('../../utils/llm-client');
    const llmClient = getLLMClient();
    
    return llmClient.getTokenUsageStats();
  } catch (error) {
    logger.error('Ошибка при получении статистики использования токенов:', error);
    return { error: 'Не удалось получить статистику' };
  }
}

module.exports = router;
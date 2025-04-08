/**
 * Модуль парсинга требований из описания задачи (адаптированный для MySQL)
 * 
 * Отвечает за извлечение и структурирование требований из текстового описания задачи.
 * Использует LLM для анализа текста и выделения конкретных требований.
 */

const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../../config/db.config');
const Handlebars = require('handlebars');

// Регистрируем хелперы для Handlebars
Handlebars.registerHelper('if', function(conditional, options) {
  if(conditional) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
});

Handlebars.registerHelper('each', function(context, options) {
  if (!context || !Array.isArray(context)) return "";
  
  let ret = "";
  for(let i=0, j=context.length; i<j; i++) {
    ret = ret + options.fn(context[i]);
  }
  return ret;
});

/**
 * Извлекает требования из текстового описания задачи
 * 
 * @param {string} description - Текстовое описание задачи
 * @param {Object} options - Дополнительные опции
 * @param {number} options.taskId - ID задачи для логирования
 * @returns {Promise<Array>} Массив объектов с требованиями
 */
async function extractRequirements(description, options = {}) {
  try {
    const taskId = options.taskId || 'unknown';
    logger.debug(`Извлечение требований для задачи ${taskId}`);

    // Используем LLM для извлечения требований
    const prompt = await buildRequirementExtractionPrompt(description, taskId);
    
    // Используем функцию sendPrompt из вашего клиента LLM
    const response = await llmClient.sendPrompt(prompt, {
      taskId,
      temperature: 0.1
    });
    
    // Логируем взаимодействие с LLM
    await logLLMInteraction(taskId, prompt, response);
    
    // Извлечение JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Обрабатываем результат с новой структурой
    const functionalReqs = parsed.functional || [];
    const nonFunctionalReqs = parsed.nonFunctional || [];
    const constraints = parsed.constraints || [];
    
    // Преобразуем в единый формат требований
    const requirements = [
      ...functionalReqs.map(req => ({
        description: req.description,
        priority: mapPriority(req.priority),
        type: 'functional',
        clarity: req.clarity === 'ambiguous' ? 'low' : 'high'
      })),
      ...nonFunctionalReqs.map(req => ({
        description: req.description,
        priority: mapPriority(req.priority),
        type: req.type || 'non-functional',
        clarity: 'medium'
      })),
      ...constraints.map(req => ({
        description: req.description,
        priority: 'high',
        type: req.type || 'constraint',
        clarity: 'high'
      }))
    ];
    
    logger.debug(`Извлечено ${requirements.length} требований для задачи ${taskId}`);
    return enrichRequirements(requirements);
  } catch (error) {
    logger.error(`Ошибка при извлечении требований: ${error.message}`);
    // Возвращаем пустой массив в случае ошибки
    return [];
  }
}

/**
 * Преобразует приоритет из формата шаблона в формат системы
 * 
 * @param {string} priority - Приоритет из ответа LLM
 * @returns {string} Стандартизированный приоритет
 */
function mapPriority(priority) {
  if (!priority) return 'medium';
  
  switch (priority.toLowerCase()) {
    case 'must-have':
      return 'high';
    case 'should-have':
      return 'medium';
    case 'nice-to-have':
      return 'low';
    default:
      return priority;
  }
}

/**
 * Обогащает извлеченные требования дополнительной информацией
 * 
 * @param {Array} requirements - Массив базовых требований
 * @returns {Array} Обогащенные требования с дополнительными полями
 */
function enrichRequirements(requirements) {
  return requirements.map((req, index) => {
    // Определяем приоритет требования
    let priority = req.priority || 'medium';
    
    // Определяем тип требования, если не указан
    let type = req.type || determineRequirementType(req.description);
    
    return {
      id: `REQ-${index + 1}`,
      description: req.description,
      priority,
      type,
      estimated_complexity: req.complexity || 'medium',
      dependencies: req.dependencies || [],
      notes: req.notes || null
    };
  });
}

/**
 * Определяет тип требования на основе его описания
 * 
 * @param {string} description - Описание требования
 * @returns {string} Тип требования
 */
function determineRequirementType(description) {
  const lowerDesc = description.toLowerCase();
  
  // Определение типа требования по ключевым словам
  if (lowerDesc.includes('должен') || lowerDesc.includes('необходимо') || 
      lowerDesc.includes('требуется') || lowerDesc.includes('обязательно')) {
    return 'functional';
  }
  
  if (lowerDesc.includes('производительность') || lowerDesc.includes('скорость') || 
      lowerDesc.includes('время отклика') || lowerDesc.includes('быстро')) {
    return 'performance';
  }
  
  if (lowerDesc.includes('безопасность') || lowerDesc.includes('защита') || 
      lowerDesc.includes('аутентификация') || lowerDesc.includes('авторизация')) {
    return 'security';
  }
  
  if (lowerDesc.includes('интерфейс') || lowerDesc.includes('ui') || 
      lowerDesc.includes('пользовательский опыт') || lowerDesc.includes('ux')) {
    return 'ui/ux';
  }
  
  // По умолчанию считаем требование функциональным
  return 'functional';
}

/**
 * Формирует промпт для извлечения требований
 * 
 * @param {string} description - Описание задачи
 * @param {number|string} taskId - ID задачи
 * @returns {Promise<string>} Промпт для отправки в LLM
 */
async function buildRequirementExtractionPrompt(description, taskId) {
  try {
    // Загружаем шаблон промпта из файла
    const promptTemplatePath = path.join(__dirname, '../../../templates/prompts/requirements-extraction.txt');
    const templateSource = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Получаем информацию о задаче, если указан taskId
    let taskTitle = "Задача без названия";
    
    if (taskId && taskId !== 'unknown') {
      try {
        const connection = await pool.getConnection();
        try {
          const [tasks] = await connection.query('SELECT title FROM tasks WHERE id = ?', [taskId]);
          if (tasks.length > 0) {
            taskTitle = tasks[0].title;
          }
        } finally {
          connection.release();
        }
      } catch (dbError) {
        logger.warn(`Не удалось получить информацию о задаче ${taskId}: ${dbError.message}`);
      }
    }
    
    // Компилируем шаблон Handlebars
    const template = Handlebars.compile(templateSource);
    
    // Подготавливаем данные для шаблона
    const templateData = {
      taskTitle: taskTitle,
      taskDescription: description
    };
    
    // Формируем промпт с использованием шаблона
    return template(templateData);
  } catch (error) {
    logger.error(`Ошибка при формировании промпта для извлечения требований: ${error.message}`);
    // Возвращаем простой промпт в случае ошибки
    return `
    Извлеки структурированные требования из описания задачи:
    
    ${description}
    
    Анализируй описание и выдели функциональные и нефункциональные требования, а также ограничения.
    Ответ предоставь в формате JSON.
    `;
  }
}

/**
 * Анализирует связи и зависимости между требованиями
 * 
 * @param {Array} requirements - Массив требований
 * @returns {Promise<Array>} Требования с обновленными зависимостями
 */
async function analyzeRequirementDependencies(requirements) {
  if (!requirements || requirements.length <= 1) {
    return requirements;
  }
  
  try {
    // Подготавливаем данные для промпта
    const reqSummary = requirements.map(req => 
      `${req.id}: ${req.description}`
    ).join('\n');
    
    const prompt = `
    Проанализируй следующие требования и определи зависимости между ними:
    
    ${reqSummary}
    
    Для каждого требования определи, от каких других требований оно зависит.
    Учитывай логические зависимости (для реализации одного требования необходимо сначала реализовать другое).
    
    Ответь в формате JSON:
    {
      "dependencies": [
        {
          "id": "REQ-1",
          "depends_on": ["REQ-2", "REQ-3"]
        },
        ...
      ]
    }
    `;
    
    // Используем функцию sendPrompt из вашего клиента LLM
    const response = await llmClient.sendPrompt(prompt, {
      temperature: 0.1
    });
    
    // Извлечение JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.dependencies || !Array.isArray(parsed.dependencies)) {
      throw new Error('Неверный формат ответа от LLM');
    }
    
    // Обновляем зависимости в оригинальных требованиях
    const reqMap = new Map(requirements.map(req => [req.id, req]));
    
    for (const dep of parsed.dependencies) {
      const req = reqMap.get(dep.id);
      if (req) {
        req.dependencies = dep.depends_on || [];
      }
    }
    
    return Array.from(reqMap.values());
  } catch (error) {
    logger.error(`Ошибка при анализе зависимостей требований: ${error.message}`);
    // Возвращаем исходные требования без изменений
    return requirements;
  }
}

/**
 * Логирует взаимодействие с LLM
 * 
 * @param {number|string} taskId - ID задачи
 * @param {string} prompt - Отправленный промпт
 * @param {string} response - Полученный ответ
 * @returns {Promise<void>}
 */
async function logLLMInteraction(taskId, prompt, response) {
  // Проверка на валидность taskId (должен быть числом)
  if (isNaN(parseInt(taskId))) {
    logger.debug(`Не логируем взаимодействие с LLM для невалидного taskId: ${taskId}`);
    return;
  }
  
  try {
    const connection = await pool.getConnection();
    
    try {
      // Сохраняем взаимодействие с LLM в таблицу llm_interactions
      await connection.query(`
        INSERT INTO llm_interactions (task_id, prompt, response, model_used, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `, [taskId, prompt, response, 'default']);
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при логировании взаимодействия с LLM: ${error.message}`);
  }
}

module.exports = {
  extractRequirements,
  analyzeRequirementDependencies
};
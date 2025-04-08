/**
 * Модуль генерации плана выполнения задачи (с поддержкой Handlebars)
 * 
 * Отвечает за создание структурированного плана с этапами, зависимостями
 * и распределением ресурсов.
 */

const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const taskUnderstanding = require('../task-understanding');
const taskProgressWs = require('../../websocket/task-progress');
const Handlebars = require('handlebars');

// Регистрируем хелперы для Handlebars, если они еще не зарегистрированы
if (!Handlebars.helpers.if) {
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
}

/**
 * Создание шаблона для генерации плана, если еще не существует
 * 
 * @returns {Promise<void>}
 */
async function createPlanGenerationTemplate() {
  // Путь к шаблону
  const templatePath = path.join(__dirname, '../../../templates/prompts/plan-generation.txt');
  
  // Проверяем существование шаблона
  try {
    await fs.access(templatePath);
    logger.debug('Шаблон для генерации плана уже существует');
    return;
  } catch (error) {
    // Шаблон не существует, создаем его
    logger.info('Создание шаблона для генерации плана...');
    
    const templateContent = `Ты - опытный технический руководитель проекта, специализирующийся на планировании задач разработки.
Создай детальный план выполнения следующей задачи:

ИНФОРМАЦИЯ О ЗАДАЧЕ:
ID задачи: {{taskId}}
Название задачи: {{taskTitle}}
Описание задачи: {{taskDescription}}
Приоритет: {{taskPriority}}
Сложность: {{taskComplexity}}

АНАЛИЗ ЗАДАЧИ:
{{#if taskAnalysis}}
Тип задачи: {{taskAnalysis.taskType}}
Требуемые навыки: {{#each taskAnalysis.requiredSkills}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
Потенциальные сложности: {{#each taskAnalysis.potentialChallenges}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
Оценка трудоемкости: {{taskAnalysis.estimatedEffort}}
Краткое описание: {{taskAnalysis.summary}}
{{/if}}

ТРЕБОВАНИЯ:
{{#each requirements}}
- {{this.description}} (Приоритет: {{this.priority}}, Тип: {{this.type}})
{{/each}}

ИНСТРУКЦИИ:
1. Создай план выполнения задачи с разбиением на логические этапы
2. Для каждого этапа укажи:
   - Название этапа
   - Подробное описание работ
   - Ожидаемый результат
   - Оценку времени в часах
   - Зависимости от других этапов (если есть)
   - Вес этапа в общем плане (число от 0 до 1, в сумме должно быть 1)
3. Определи потенциальные риски и способы их снижения
4. Укажи общую оценку времени выполнения задачи
5. Добавь любые важные замечания к плану

Каждый этап должен быть логически завершенным и иметь четко определенный результат.

ВЫХОДНОЙ ФОРМАТ:
Ответ предоставь в виде JSON следующей структуры:
{
  "title": "Название плана",
  "description": "Общее описание плана",
  "estimated_hours": число,
  "complexity": число от 1 до 10,
  "stages": [
    {
      "id": "stage-1",
      "name": "Название этапа",
      "description": "Описание работ",
      "expected_result": "Ожидаемый результат",
      "estimated_hours": число,
      "dependencies": ["stage-id", ...],
      "weight": число от 0 до 1
    },
    ...
  ],
  "risks": [
    {
      "description": "Описание риска",
      "mitigation": "Способы снижения риска",
      "probability": "high|medium|low",
      "impact": "high|medium|low"
    },
    ...
  ],
  "notes": "Дополнительные замечания"
}`;
    
    // Сохраняем шаблон в файл
    await fs.writeFile(templatePath, templateContent);
    logger.info('Шаблон для генерации плана успешно создан');
  }
}

/**
 * Генерирует план выполнения задачи
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} Сгенерированный план
 */
async function generatePlan(taskId, options = {}) {
  try {
    logger.info(`Генерация плана для задачи ${taskId}`);
    
    // Создаем шаблон, если его нет
    await createPlanGenerationTemplate();
    
    // Получаем информацию о задаче
    const connection = await pool.getConnection();
    let task;
    
    try {
      const [tasks] = await connection.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
      if (tasks.length === 0) {
        throw new Error(`Задача с ID ${taskId} не найдена`);
      }
      task = tasks[0];
    } finally {
      connection.release();
    }
    
    // Получаем результаты анализа задачи
    const analysis = await taskUnderstanding.getTaskAnalysis(taskId);
    if (!analysis) {
      throw new Error(`Анализ для задачи ${taskId} не найден`);
    }
    
    await taskProgressWs.sendTaskLog(taskId, 'info', 'Создание плана выполнения задачи');
    
    // Формируем промпт для генерации плана
    const prompt = await buildPlanGenerationPrompt(task, analysis);
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(prompt, {
      taskId,
      temperature: 0.2
    });
    
    // Логируем взаимодействие с LLM
    await logLLMInteraction(taskId, prompt, response);
    
    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    const plan = JSON.parse(jsonMatch[0]);
    
    // Обогащаем план дополнительной информацией
    const enrichedPlan = enrichPlan(plan, task, analysis);
    
    await taskProgressWs.sendTaskLog(taskId, 'info', `План выполнения задачи создан успешно. ${enrichedPlan.stages.length} этапов.`);
    
    return enrichedPlan;
  } catch (error) {
    logger.error(`Ошибка при генерации плана для задачи ${taskId}:`, error);
    throw error;
  }
}

/**
 * Формирует промпт для генерации плана
 * 
 * @param {Object} task - Информация о задаче
 * @param {Object} analysis - Результаты анализа задачи
 * @returns {Promise<string>} Промпт для отправки в LLM
 */
async function buildPlanGenerationPrompt(task, analysis) {
  try {
    // Загружаем шаблон промпта из файла
    const templatePath = path.join(__dirname, '../../../templates/prompts/plan-generation.txt');
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    
    // Компилируем шаблон
    const template = Handlebars.compile(templateSource);
    
    // Подготавливаем данные для шаблона
    const templateData = {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      taskPriority: task.priority || 'medium',
      taskComplexity: analysis.complexity || 5,
      taskAnalysis: analysis.meta || null,
      requirements: analysis.requirements || []
    };
    
    // Формируем промпт с использованием шаблона
    return template(templateData);
  } catch (error) {
    logger.error(`Ошибка при формировании промпта для генерации плана: ${error.message}`);
    // Возвращаем простой промпт в случае ошибки
    return `
    Создай план выполнения следующей задачи:
    
    Название задачи: ${task.title}
    Описание задачи: ${task.description}
    
    Ответь в формате JSON с массивом этапов, оценкой времени и рисками.
    `;
  }
}

/**
 * Обогащает план дополнительной информацией
 * 
 * @param {Object} plan - Сгенерированный план
 * @param {Object} task - Информация о задаче
 * @param {Object} analysis - Результаты анализа задачи
 * @returns {Object} Обогащенный план
 */
function enrichPlan(plan, task, analysis) {
  // Добавляем ID задачи
  plan.task_id = task.id;
  
  // Добавляем дату создания плана
  plan.created_at = new Date().toISOString();
  
  // Проверяем наличие обязательных полей
  if (!plan.stages || !Array.isArray(plan.stages)) {
    plan.stages = [];
  }
  
  if (!plan.risks || !Array.isArray(plan.risks)) {
    plan.risks = [];
  }
  
  // Рассчитываем общую оценку времени, если она не была указана
  if (!plan.estimated_hours && plan.stages.length > 0) {
    plan.estimated_hours = plan.stages.reduce((total, stage) => total + (stage.estimated_hours || 0), 0);
  }
  
  // Обеспечиваем уникальность ID этапов
  const stageIds = new Set();
  plan.stages.forEach(stage => {
    if (!stage.id) {
      stage.id = `stage-${stageIds.size + 1}`;
    }
    
    // Если ID уже существует, генерируем новый
    while (stageIds.has(stage.id)) {
      stage.id = `stage-${stageIds.size + 1}`;
    }
    
    stageIds.add(stage.id);
    
    // Если вес этапа не указан, устанавливаем его равномерно
    if (!stage.weight) {
      stage.weight = 1 / plan.stages.length;
    }
  });
  
  // Добавляем статус плана
  plan.status = 'created';
  
  return plan;
}

/**
 * Логирует взаимодействие с LLM
 * 
 * @param {number} taskId - ID задачи
 * @param {string} prompt - Отправленный промпт
 * @param {string} response - Полученный ответ
 * @returns {Promise<void>}
 */
async function logLLMInteraction(taskId, prompt, response) {
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

/**
 * Оптимизирует существующий план
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} currentPlan - Текущий план
 * @param {Object} options - Опции оптимизации
 * @returns {Promise<Object>} Оптимизированный план
 */
async function optimizePlan(taskId, currentPlan, options = {}) {
  try {
    logger.info(`Оптимизация плана для задачи ${taskId}`);
    
    // Формируем промпт для оптимизации плана
    const optimizationPrompt = `
    Ты - опытный технический руководитель проекта, специализирующийся на оптимизации планов разработки.
    У нас есть следующий план выполнения задачи, который нужно оптимизировать:
    
    ${JSON.stringify(currentPlan, null, 2)}
    
    Оптимизируй план с учетом следующих факторов:
    ${options.optimizeTime ? '- Уменьшение времени выполнения' : ''}
    ${options.optimizeResources ? '- Оптимизация использования ресурсов' : ''}
    ${options.parallelizeTasks ? '- Распараллеливание задач' : ''}
    ${options.reduceDependencies ? '- Уменьшение зависимостей между этапами' : ''}
    ${options.additionalFactors ? options.additionalFactors : ''}
    
    Не меняй структуру JSON, только корректируй значения. Сохрани все существующие этапы, но можешь изменить их параметры.
    
    Ответь обновленным планом в формате JSON.
    `;
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(optimizationPrompt, {
      taskId,
      temperature: 0.2
    });
    
    // Логируем взаимодействие с LLM
    await logLLMInteraction(taskId, optimizationPrompt, response);
    
    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    const optimizedPlan = JSON.parse(jsonMatch[0]);
    
    // Сохраняем оптимизированный план в БД
    const connection = await pool.getConnection();
    
    try {
      const [existingMeta] = await connection.query(`
        SELECT id FROM task_meta 
        WHERE task_id = ? AND meta_key = 'task_plan'
      `, [taskId]);
      
      if (existingMeta.length > 0) {
        await connection.query(`
          UPDATE task_meta 
          SET meta_value = ?, updated_at = NOW() 
          WHERE task_id = ? AND meta_key = 'task_plan'
        `, [JSON.stringify(optimizedPlan), taskId]);
      } else {
        await connection.query(`
          INSERT INTO task_meta (task_id, meta_key, meta_value, created_at) 
          VALUES (?, 'task_plan', ?, NOW())
        `, [taskId, JSON.stringify(optimizedPlan)]);
      }
    } finally {
      connection.release();
    }
    
    return optimizedPlan;
  } catch (error) {
    logger.error(`Ошибка при оптимизации плана для задачи ${taskId}:`, error);
    throw error;
  }
}

module.exports = {
  generatePlan,
  optimizePlan
};
/**
 * Модуль декомпозиции задач (с поддержкой Handlebars)
 * 
 * Отвечает за разбиение сложных задач на атомарные подзадачи,
 * определение зависимостей между подзадачами и оценку их сложности.
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
 * Декомпозирует задачу на подзадачи на основе плана
 * 
 * @param {number} taskId - ID задачи
 * @param {Object} plan - План выполнения задачи
 * @returns {Promise<Array>} Массив подзадач
 */
async function decomposeTask(taskId, plan) {
  try {
    logger.info(`Декомпозиция задачи ${taskId}`);
    await taskProgressWs.sendTaskLog(taskId, 'info', 'Начата декомпозиция задачи');
    
    // Если план не передан, получаем его из БД
    if (!plan) {
      const connection = await pool.getConnection();
      
      try {
        const [metaRecords] = await connection.query(`
          SELECT meta_value FROM task_meta 
          WHERE task_id = ? AND meta_key = 'task_plan'
        `, [taskId]);
        
        if (metaRecords.length === 0) {
          throw new Error(`План для задачи ${taskId} не найден`);
        }
        
        plan = JSON.parse(metaRecords[0].meta_value);
      } finally {
        connection.release();
      }
    }
    
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
    
    // Проверяем, есть ли этапы в плане
    if (!plan.stages || !Array.isArray(plan.stages) || plan.stages.length === 0) {
      throw new Error('План не содержит этапов для декомпозиции');
    }
    
    // Получаем контекст проекта для использования в промпте
    const projectContext = await getProjectContext(taskId);
    
    // Перебираем этапы и создаем подзадачи для каждого
    const subtasks = [];
    let sequenceNumber = 1;
    
    for (const stage of plan.stages) {
      // Формируем промпт для декомпозиции этапа
      const prompt = await buildDecompositionPrompt(task, analysis, stage, projectContext);
      
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
      
      const decomposedStage = JSON.parse(jsonMatch[0]);
      
      // Проверяем наличие подзадач
      if (!decomposedStage.subtasks || !Array.isArray(decomposedStage.subtasks)) {
        logger.warn(`Не удалось декомпозировать этап "${stage.name}" для задачи ${taskId}`);
        continue;
      }
      
      // Обрабатываем подзадачи
      for (const subtask of decomposedStage.subtasks) {
        subtasks.push({
          title: subtask.title || `Подзадача ${sequenceNumber}`,
          description: subtask.description || '',
          estimatedHours: subtask.estimatedHours || stage.estimated_hours / decomposedStage.subtasks.length,
          sequenceNumber: sequenceNumber++,
          stageId: stage.id,
          stageName: stage.name,
          dependencies: subtask.dependencies || [],
          skills: subtask.skills || [],
          codeFiles: subtask.codeFiles || [],
          testCoverage: subtask.testCoverage || false,
          priority: subtask.priority || 'medium'
        });
      }
      
      await taskProgressWs.sendTaskLog(
        taskId, 
        'info', 
        `Этап "${stage.name}" декомпозирован на ${decomposedStage.subtasks.length} подзадач`
      );
    }
    
    // Обогащаем подзадачи дополнительной информацией
    const enrichedSubtasks = enrichSubtasks(subtasks, task, plan);
    
    await taskProgressWs.sendTaskLog(
      taskId, 
      'info', 
      `Задача успешно декомпозирована на ${enrichedSubtasks.length} подзадач`
    );
    
    return enrichedSubtasks;
  } catch (error) {
    logger.error(`Ошибка при декомпозиции задачи ${taskId}:`, error);
    await taskProgressWs.sendTaskLog(taskId, 'error', `Ошибка при декомпозиции задачи: ${error.message}`);
    throw error;
  }
}

/**
 * Получает контекст проекта для использования в промпте
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object>} Контекст проекта
 */
async function getProjectContext(taskId) {
  try {
    // Получаем ID проекта
    const connection = await pool.getConnection();
    let projectId;
    
    try {
      const [tasks] = await connection.query('SELECT project_id FROM tasks WHERE id = ?', [taskId]);
      if (tasks.length === 0) {
        throw new Error(`Задача с ID ${taskId} не найдена`);
      }
      projectId = tasks[0].project_id;
    } finally {
      connection.release();
    }
    
    // Получаем информацию о проекте
    const context = {
      repositoryStructure: '',
      technologies: [],
      codeExamples: ''
    };
    
    // Получаем структуру репозитория
    const connection2 = await pool.getConnection();
    try {
      const [files] = await connection2.query(`
        SELECT file_path, file_type FROM project_files
        WHERE project_id = ?
        ORDER BY file_path ASC
        LIMIT 100
      `, [projectId]);
      
      if (files.length > 0) {
        context.repositoryStructure = files.map(f => `${f.file_path} (${f.file_type})`).join('\n');
      }
      
      // Получаем технологии проекта
      const [metaRecords] = await connection2.query(`
        SELECT meta_value FROM task_meta
        WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)
        AND meta_key = 'project_technologies'
        LIMIT 1
      `, [projectId]);
      
      if (metaRecords.length > 0) {
        try {
          const technologies = JSON.parse(metaRecords[0].meta_value);
          if (Array.isArray(technologies)) {
            context.technologies = technologies;
          }
        } catch (e) {
          logger.warn(`Ошибка при парсинге технологий проекта: ${e.message}`);
        }
      }
      
      // Получаем примеры кода (первые 5 файлов JS/TS)
      const [codeFiles] = await connection2.query(`
        SELECT file_path, file_content FROM project_files
        WHERE project_id = ? AND (file_type = 'js' OR file_type = 'ts' OR file_type = 'jsx' OR file_type = 'tsx')
        LIMIT 5
      `, [projectId]);
      
      if (codeFiles.length > 0) {
        context.codeExamples = codeFiles.map(f => `Файл: ${f.file_path}\n\n${f.file_content || 'Содержимое недоступно'}`).join('\n\n');
      }
    } finally {
      connection2.release();
    }
    
    return context;
  } catch (error) {
    logger.error(`Ошибка при получении контекста проекта:`, error);
    return {
      repositoryStructure: '',
      technologies: [],
      codeExamples: ''
    };
  }
}

/**
 * Формирует промпт для декомпозиции этапа с использованием Handlebars
 * 
 * @param {Object} task - Информация о задаче
 * @param {Object} analysis - Результаты анализа задачи
 * @param {Object} stage - Этап для декомпозиции
 * @param {Object} projectContext - Контекст проекта
 * @returns {Promise<string>} Промпт для отправки в LLM
 */
async function buildDecompositionPrompt(task, analysis, stage, projectContext) {
  try {
    // Загружаем шаблон промпта из файла
    const promptTemplatePath = path.join(__dirname, '../../../templates/prompts/task-decomposition.txt');
    let templateSource = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Компилируем шаблон Handlebars
    const template = Handlebars.compile(templateSource);
    
    // Определяем стратегию тестирования
    let testingStrategy = "Для каждой подзадачи, требующей изменения кода, должны быть предусмотрены соответствующие тесты.";
    if (task.description && task.description.toLowerCase().includes('test')) {
      testingStrategy += " Особое внимание уделите тестированию, так как это ключевой аспект задачи.";
    }
    
    // Определяем максимальное количество подзадач
    const maxSubtasks = stage.estimated_hours <= 4 ? 3 : (stage.estimated_hours <= 8 ? 5 : 8);
    
    // Подготавливаем данные для шаблона
    const templateData = {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      taskPriority: task.priority || 'medium',
      stageId: stage.id,
      stageName: stage.name,
      stageDescription: stage.description || '',
      expectedResult: stage.expected_result || '',
      estimatedHours: stage.estimated_hours || 0,
      taskAnalysis: analysis.meta || {},
      projectContext: projectContext || {},
      testingStrategy,
      maxSubtasks
    };
    
    // Формируем промпт с использованием шаблона
    return template(templateData);
  } catch (error) {
    logger.error(`Ошибка при формировании промпта для декомпозиции этапа: ${error.message}`);
    // Возвращаем простой промпт в случае ошибки
    return `
    Разбей следующий этап задачи на атомарные подзадачи:
    
    Задача: ${task.title}
    Этап: ${stage.name}
    
    Ответь в формате JSON с массивом подзадач.
    `;
  }
}

/**
 * Обогащает подзадачи дополнительной информацией
 * 
 * @param {Array} subtasks - Массив подзадач
 * @param {Object} task - Информация о задаче
 * @param {Object} plan - План выполнения задачи
 * @returns {Array} Обогащенные подзадачи
 */
function enrichSubtasks(subtasks, task, plan) {
  // Создаем карту этапов для быстрого доступа
  const stagesMap = {};
  if (plan.stages && Array.isArray(plan.stages)) {
    plan.stages.forEach(stage => {
      stagesMap[stage.id] = stage;
    });
  }
  
  // Обогащаем подзадачи
  return subtasks.map((subtask, index) => {
    // Если у подзадачи нет зависимостей, но у этапа есть, добавляем их
    if ((!subtask.dependencies || subtask.dependencies.length === 0) && subtask.stageId) {
      const stage = stagesMap[subtask.stageId];
      if (stage && stage.dependencies && stage.dependencies.length > 0) {
        // Находим последние подзадачи от зависимых этапов
        const stageDependencies = stage.dependencies.map(depStageId => {
          // Находим последнюю подзадачу зависимого этапа
          const lastSubtask = [...subtasks].reverse().find(s => s.stageId === depStageId);
          return lastSubtask ? lastSubtask.sequenceNumber : null;
        }).filter(Boolean);
        
        subtask.dependencies = stageDependencies;
      }
    }
    
    return subtask;
  });
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
 * Анализирует зависимости между подзадачами и оптимизирует их
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object>} Результат анализа
 */
async function analyzeDependencies(taskId) {
  try {
    logger.info(`Анализ зависимостей между подзадачами для задачи ${taskId}`);
    
    // Получаем подзадачи из БД
    const connection = await pool.getConnection();
    let subtasks;
    
    try {
      const [rows] = await connection.query(`
        SELECT * FROM subtasks 
        WHERE task_id = ? 
        ORDER BY sequence_number ASC
      `, [taskId]);
      
      subtasks = rows;
    } finally {
      connection.release();
    }
    
    if (!subtasks || subtasks.length === 0) {
      throw new Error(`Подзадачи для задачи ${taskId} не найдены`);
    }
    
    // Формируем промпт для анализа зависимостей
    const subtasksText = subtasks.map(subtask => 
      `${subtask.id}. ${subtask.title}: ${subtask.description}`
    ).join('\n\n');
    
    const prompt = `
    Ты - опытный технический аналитик, специализирующийся на оптимизации процессов разработки.
    Проанализируй зависимости между следующими подзадачами и предложи оптимизацию:
    
    ${subtasksText}
    
    Предложи оптимизированную структуру зависимостей, которая:
    1. Минимизирует время выполнения за счет параллельного выполнения независимых подзадач
    2. Устраняет ненужные зависимости
    3. Выявляет скрытые зависимости, которые могут привести к проблемам
    
    Ответь в формате JSON:
    {
      "dependencies": [
        {
          "subtask_id": id подзадачи,
          "depends_on": [список ID подзадач, от которых зависит]
        },
        ...
      ],
      "parallelization_groups": [
        [список ID подзадач, которые можно выполнять параллельно],
        ...
      ],
      "critical_path": [список ID подзадач, входящих в критический путь],
      "recommendations": [
        "Рекомендация 1",
        ...
      ]
    }
    `;
    
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
    
    const analysisResult = JSON.parse(jsonMatch[0]);
    
    // Обновляем зависимости в БД на основе анализа
    if (analysisResult.dependencies && Array.isArray(analysisResult.dependencies)) {
      const connection = await pool.getConnection();
      
      try {
        // Начинаем транзакцию
        await connection.beginTransaction();
        
        try {
          // Удаляем существующие зависимости
          await connection.query(`
            DELETE FROM subtask_dependencies 
            WHERE subtask_id IN (
              SELECT id FROM subtasks WHERE task_id = ?
            )
          `, [taskId]);
          
          // Добавляем новые зависимости
          for (const dep of analysisResult.dependencies) {
            if (dep.subtask_id && dep.depends_on && Array.isArray(dep.depends_on)) {
              for (const dependsOnId of dep.depends_on) {
                await connection.query(`
                  INSERT INTO subtask_dependencies (subtask_id, depends_on_subtask_id)
                  VALUES (?, ?)
                `, [dep.subtask_id, dependsOnId]);
              }
            }
          }
          
          // Завершаем транзакцию
          await connection.commit();
        } catch (error) {
          // Откатываем транзакцию в случае ошибки
          await connection.rollback();
          throw error;
        }
      } finally {
        connection.release();
      }
    }
    
    return analysisResult;
  } catch (error) {
    logger.error(`Ошибка при анализе зависимостей для задачи ${taskId}:`, error);
    throw error;
  }
}

module.exports = {
  decomposeTask,
  analyzeDependencies
};
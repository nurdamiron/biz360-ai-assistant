/**
 * Модуль понимания задачи (адаптированный для MySQL и Handlebars)
 * 
 * Отвечает за анализ входящих задач и извлечение ключевой информации.
 * Использует LLM для обработки текстовых описаний и выделения важных аспектов задачи.
 */

const { promisify } = require('util');
const logger = require('../../utils/logger');
const taskLogger = require('../../utils/task-logger');
const llmClient = require('../../utils/llm-client');
const requirementParser = require('./requirement-parser');
const dbAdapter = require('./db-adapter');
const { pool } = require('../../config/db.config');
const taskProgressWs = require('../../websocket/task-progress');
const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

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
 * Анализирует задачу и извлекает ключевую информацию
 * 
 * @param {Object} task - Объект задачи с описанием
 * @param {number} task.id - ID задачи
 * @param {string} task.title - Название задачи
 * @param {string} task.description - Описание задачи
 * @param {Object} options - Дополнительные опции анализа
 * @returns {Promise<Object>} Объект с проанализированными данными задачи
 */
async function analyzeTask(task, options = {}) {
  const taskId = task.id;
  taskLogger.info(taskId, 'Начинаем анализ задачи');
  
  // Отправляем обновление о начале анализа
  await taskProgressWs.sendTaskLog(taskId, 'info', 'Начинаем анализ задачи');
  await taskProgressWs.updateTaskProgress(taskId, 5, 'Начинаем анализ задачи');
  
  try {
    // Извлечение требований из описания задачи
    const requirements = await requirementParser.extractRequirements(task.description, { taskId });
    taskLogger.info(taskId, `Извлечено ${requirements.length} требований из задачи`);
    await taskProgressWs.sendTaskLog(taskId, 'info', `Извлечено ${requirements.length} требований из задачи`);
    await taskProgressWs.updateTaskProgress(taskId, 20, 'Требования извлечены');
    
    // Выполняем полный анализ задачи
    const taskAnalysis = await performTaskAnalysis(task);
    taskLogger.info(taskId, `Задача проанализирована: тип - ${taskAnalysis.taskType}, сложность - ${taskAnalysis.complexity}`);
    await taskProgressWs.sendTaskLog(taskId, 'info', `Задача проанализирована: тип - ${taskAnalysis.taskType}, сложность - ${taskAnalysis.complexity}`);
    await taskProgressWs.updateTaskProgress(taskId, 40, 'Задача проанализирована');
    
    // Определяем технологии для задачи
    const technologies = await identifyRequiredTechnologies(task);
    taskLogger.info(taskId, `Определены технологии для задачи: ${technologies.technologies.map(t => t.name).join(', ')}`);
    await taskProgressWs.updateTaskProgress(taskId, 60, 'Технологии определены');
    
    // Сохранение результатов анализа в БД
    const complexityScore = mapComplexityToNumeric(taskAnalysis.complexity);
    
    await dbAdapter.saveAnalysisResults(taskId, {
      requirements,
      taskClassification: {
        type: taskAnalysis.taskType,
        category: detectCategory(taskAnalysis, technologies),
        meta: {
          technologies: technologies.technologies.map(t => t.name),
          requiredSkills: taskAnalysis.requiredSkills || [],
          potentialChallenges: taskAnalysis.potentialChallenges || []
        }
      },
      complexityScore
    });
    
    await taskProgressWs.updateTaskProgress(taskId, 80, 'Результаты анализа сохранены');
    
    // Формирование итогового результата
    const analysisResult = {
      taskId,
      title: task.title,
      requirements,
      type: taskAnalysis.taskType,
      category: detectCategory(taskAnalysis, technologies),
      complexity: complexityScore,
      meta: {
        technologies: technologies.technologies.map(t => t.name),
        requiredSkills: taskAnalysis.requiredSkills || [],
        potentialChallenges: taskAnalysis.potentialChallenges || [],
        estimatedEffort: taskAnalysis.estimatedEffort || 'medium',
        summary: taskAnalysis.summary || '',
        keyRequirements: taskAnalysis.keyRequirements || []
      }
    };
    
    taskLogger.info(taskId, 'Анализ задачи успешно завершен');
    await taskProgressWs.sendTaskLog(taskId, 'info', 'Анализ задачи успешно завершен');
    await taskProgressWs.updateTaskProgress(taskId, 100, 'Анализ задачи завершен');
    
    return analysisResult;
  } catch (error) {
    taskLogger.error(taskId, `Ошибка при анализе задачи: ${error.message}`);
    logger.error(`Ошибка при анализе задачи ${taskId}:`, error);
    await taskProgressWs.sendTaskLog(taskId, 'error', `Ошибка при анализе задачи: ${error.message}`);
    throw error;
  }
}

/**
 * Преобразует текстовую сложность в числовую оценку
 * 
 * @param {string} complexity - Текстовая оценка сложности
 * @returns {number} Числовая оценка сложности от 1 до 10
 */
function mapComplexityToNumeric(complexity) {
  switch(complexity.toLowerCase()) {
    case 'low':
      return 3;
    case 'medium':
      return 5;
    case 'high':
      return 8;
    case 'very high':
      return 10;
    default:
      return 5;
  }
}

/**
 * Определяет категорию задачи на основе анализа и технологий
 * 
 * @param {Object} analysis - Результат анализа задачи
 * @param {Object} technologies - Определенные технологии
 * @returns {string} Категория задачи
 */
function detectCategory(analysis, technologies) {
  // Если в технологиях преобладают фронтендные технологии
  const frontendTechs = technologies.technologies.filter(t => 
    ['react', 'vue', 'angular', 'css', 'html', 'javascript', 'typescript', 'ui', 'frontend'].some(
      keyword => t.name.toLowerCase().includes(keyword)
    )
  );
  
  const backendTechs = technologies.technologies.filter(t => 
    ['node', 'express', 'php', 'java', 'python', 'c#', '.net', 'golang', 'ruby', 'backend', 'api'].some(
      keyword => t.name.toLowerCase().includes(keyword)
    )
  );
  
  const databaseTechs = technologies.technologies.filter(t => 
    ['sql', 'mysql', 'postgresql', 'mongodb', 'database', 'redis', 'nosql', 'oracle'].some(
      keyword => t.name.toLowerCase().includes(keyword)
    )
  );
  
  // Определяем преобладающую категорию
  if (frontendTechs.length > backendTechs.length && frontendTechs.length > databaseTechs.length) {
    return 'frontend';
  } else if (backendTechs.length > frontendTechs.length && backendTechs.length > databaseTechs.length) {
    return 'backend';
  } else if (databaseTechs.length > frontendTechs.length && databaseTechs.length > backendTechs.length) {
    return 'database';
  } else if (frontendTechs.length > 0 && backendTechs.length > 0) {
    return 'full-stack';
  }
  
  // Если не удалось определить по технологиям, смотрим на ключевые слова в описании
  const taskType = analysis.taskType.toLowerCase();
  if (taskType.includes('ui') || taskType.includes('interface') || taskType.includes('design')) {
    return 'ui/ux';
  } else if (taskType.includes('api') || taskType.includes('server')) {
    return 'backend';
  } else if (taskType.includes('database') || taskType.includes('data')) {
    return 'database';
  } else if (taskType.includes('security')) {
    return 'security';
  } else if (taskType.includes('performance')) {
    return 'performance';
  }
  
  return 'backend'; // По умолчанию считаем, что задача относится к бэкенду
}

/**
 * Выполняет полный анализ задачи с использованием шаблона task-analysis.txt
 * 
 * @param {Object} task - Объект задачи
 * @returns {Promise<Object>} Результат анализа
 */
async function performTaskAnalysis(task) {
  try {
    // Загружаем шаблон
    const templatePath = path.join(__dirname, '../../../templates/prompts/task-analysis.txt');
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    
    // Компилируем шаблон
    const template = Handlebars.compile(templateSource);
    
    // Получаем комментарии к задаче
    const comments = await getTaskComments(task.id);
    
    // Подготавливаем данные для шаблона
    const templateData = {
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      taskPriority: task.priority || 'medium',
      taskStatus: task.status || 'pending',
      taskCreatedAt: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString(),
      comments
    };
    
    // Формируем промпт
    const prompt = template(templateData);
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(prompt, {
      taskId: task.id,
      temperature: 0.1
    });
    
    // Логируем взаимодействие с LLM
    await logLLMInteraction(task.id, prompt, response);
    
    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    logger.error(`Ошибка при анализе задачи: ${error.message}`);
    // Возвращаем значения по умолчанию в случае ошибки
    return {
      complexity: 'medium',
      requiredSkills: [],
      potentialChallenges: [],
      estimatedEffort: 'medium',
      summary: `Задача: ${task.title}`,
      taskType: 'unknown',
      keyRequirements: []
    };
  }
}

/**
 * Идентифицирует технологии, необходимые для выполнения задачи
 *
 * @param {Object} task - Объект задачи
 * @returns {Promise<Object>} Объект с определенными технологиями
 */
async function identifyRequiredTechnologies(task) {
  try {
    // Получаем структуру репозитория
    let repositoryStructure = "";
    try {
      const projectId = await getTaskProjectId(task.id);
      if (projectId) {
        repositoryStructure = await getProjectRepositoryStructure(projectId);
      }
    } catch (error) {
      logger.warn(`Не удалось получить структуру репозитория: ${error.message}`);
    }
    
    // Получаем технологии проекта
    const projectTechnologies = await getProjectTechnologies(task.id);
    
    // Загружаем шаблон
    const templatePath = path.join(__dirname, '../../../templates/prompts/technology-identification.txt');
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    
    // Компилируем шаблон
    const template = Handlebars.compile(templateSource);
    
    // Подготавливаем данные для шаблона
    const templateData = {
      taskTitle: task.title,
      taskDescription: task.description,
      projectTechnologies,
      repositoryStructure
    };
    
    // Формируем промпт
    const prompt = template(templateData);
    
    // Отправляем запрос к LLM
    const response = await llmClient.sendPrompt(prompt, {
      taskId: task.id,
      temperature: 0.1
    });
    
    // Логируем взаимодействие с LLM
    await logLLMInteraction(task.id, prompt, response);
    
    // Извлекаем JSON из ответа
    const jsonMatch = response.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      throw new Error('Не удалось получить структурированный ответ от LLM');
    }
    
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    logger.error(`Ошибка при определении технологий: ${error.message}`);
    // Возвращаем значения по умолчанию в случае ошибки
    return {
      technologies: []
    };
  }
}

/**
 * Получает комментарии к задаче
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Array>} Массив комментариев
 */
async function getTaskComments(taskId) {
  try {
    const connection = await pool.getConnection();
    
    try {
      const [comments] = await connection.query(`
        SELECT tc.*, u.username
        FROM task_comments tc
        LEFT JOIN users u ON tc.user_id = u.id
        WHERE tc.task_id = ?
        ORDER BY tc.created_at ASC
      `, [taskId]);
      
      return comments.map(comment => ({
        id: comment.id,
        content: comment.content,
        userId: comment.user_id,
        username: comment.username,
        createdAt: comment.created_at
      }));
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении комментариев к задаче ${taskId}:`, error);
    return [];
  }
}

/**
 * Получает ID проекта задачи
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<number|null>} ID проекта или null, если не найден
 */
async function getTaskProjectId(taskId) {
  try {
    const connection = await pool.getConnection();
    
    try {
      const [tasks] = await connection.query(`
        SELECT project_id FROM tasks WHERE id = ?
      `, [taskId]);
      
      if (tasks.length === 0) {
        return null;
      }
      
      return tasks[0].project_id;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении ID проекта для задачи ${taskId}:`, error);
    return null;
  }
}

/**
 * Получает структуру репозитория проекта
 * 
 * @param {number} projectId - ID проекта
 * @returns {Promise<string>} Текстовое представление структуры репозитория
 */
async function getProjectRepositoryStructure(projectId) {
  try {
    const connection = await pool.getConnection();
    
    try {
      // Получаем файлы проекта
      const [files] = await connection.query(`
        SELECT file_path, file_type FROM project_files
        WHERE project_id = ?
        ORDER BY file_path ASC
      `, [projectId]);
      
      if (files.length === 0) {
        return "";
      }
      
      // Формируем текстовое представление структуры
      let structure = "Файловая структура проекта:\n";
      files.forEach(file => {
        structure += `${file.file_path} (${file.file_type})\n`;
      });
      
      return structure;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении структуры репозитория для проекта ${projectId}:`, error);
    return "";
  }
}

/**
 * Получает технологии проекта
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Array>} Массив технологий
 */
async function getProjectTechnologies(taskId) {
  try {
    const projectId = await getTaskProjectId(taskId);
    if (!projectId) return [];
    
    const connection = await pool.getConnection();
    
    try {
      // Проверяем наличие метаданных проекта
      const [meta] = await connection.query(`
        SELECT meta_value FROM task_meta
        WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)
        AND meta_key = 'project_technologies'
        LIMIT 1
      `, [projectId]);
      
      if (meta.length > 0) {
        try {
          const technologies = JSON.parse(meta[0].meta_value);
          if (Array.isArray(technologies)) {
            return technologies;
          }
        } catch (e) {
          logger.warn(`Ошибка при парсинге технологий проекта: ${e.message}`);
        }
      }
      
      // Если в метаданных нет информации, попробуем определить технологии из типов файлов
      const [files] = await connection.query(`
        SELECT file_type, COUNT(*) as count
        FROM project_files
        WHERE project_id = ?
        GROUP BY file_type
      `, [projectId]);
      
      // Маппинг типов файлов к технологиям
      const fileTypeToTech = {
        'js': 'JavaScript',
        'jsx': 'React',
        'ts': 'TypeScript',
        'tsx': 'React with TypeScript',
        'py': 'Python',
        'java': 'Java',
        'php': 'PHP',
        'rb': 'Ruby',
        'go': 'Go',
        'cs': 'C#',
        'html': 'HTML',
        'css': 'CSS',
        'scss': 'SASS',
        'less': 'LESS',
        'sql': 'SQL',
        'json': 'JSON',
        'yml': 'YAML',
        'yaml': 'YAML',
        'md': 'Markdown',
        'dockerfile': 'Docker'
      };
      
      // Преобразуем типы файлов в технологии
      const technologies = files
        .filter(f => fileTypeToTech[f.file_type.toLowerCase()])
        .map(f => fileTypeToTech[f.file_type.toLowerCase()]);
      
      // Добавляем технологии в метаданные для будущего использования
      if (technologies.length > 0) {
        try {
          await connection.query(`
            INSERT INTO task_meta (task_id, meta_key, meta_value)
            VALUES (?, 'project_technologies', ?)
          `, [taskId, JSON.stringify(technologies)]);
        } catch (e) {
          logger.warn(`Ошибка при сохранении технологий проекта: ${e.message}`);
        }
      }
      
      return technologies;
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Ошибка при получении технологий проекта:`, error);
    return [];
  }
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
 * Получает сохраненные результаты анализа задачи из БД
 * 
 * @param {number} taskId - ID задачи
 * @returns {Promise<Object|null>} Данные анализа или null, если анализ не найден
 */
async function getTaskAnalysis(taskId) {
  return dbAdapter.getTaskAnalysis(taskId);
}

module.exports = {
  analyzeTask,
  getTaskAnalysis
};
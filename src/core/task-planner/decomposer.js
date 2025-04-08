// src/core/task-planner/decomposer.js

const logger = require('../../utils/logger');
const { getLLMClient } = require('../../utils/llm-client');
const taskLogger = require('../../utils/task-logger');
const { pool } = require('../../config/db.config');
const taskAnalyzer = require('../task-understanding/task-analyzer');

/**
 * Класс для декомпозиции задач на подзадачи
 */
class TaskDecomposer {
  constructor() {
    this.llmClient = getLLMClient();
  }

  /**
   * Выполняет декомпозицию задачи на подзадачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат декомпозиции с созданными подзадачами
   */
  async decomposeTask(taskId) {
    try {
      logger.info(`Начало декомпозиции задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начата декомпозиция задачи');
      
      // Получаем данные о задаче
      const taskData = await this.getTaskData(taskId);
      
      if (!taskData) {
        logger.error(`Задача #${taskId} не найдена`);
        return { success: false, message: 'Задача не найдена' };
      }
      
      // Получаем анализ задачи или выполняем его, если не существует
      let taskAnalysis = await this.getTaskAnalysis(taskId);
      
      if (!taskAnalysis) {
        logger.info(`Анализ для задачи #${taskId} не найден, выполняем анализ`);
        const analyzer = taskAnalyzer;
        taskAnalysis = await analyzer.analyzeTask(taskId);
      }
      
      // Получаем данные о проекте
      const projectData = await this.getProjectData(taskData.project_id);
      
      // Выполняем декомпозицию с помощью LLM
      const decompositionResult = await this.performDecomposition(taskData, taskAnalysis, projectData);
      
      // Создаем подзадачи на основе результатов декомпозиции
      const createdSubtasks = await this.createSubtasks(taskId, decompositionResult.subtasks);
      
      // Создаем зависимости между подзадачами
      if (decompositionResult.dependencies && decompositionResult.dependencies.length > 0) {
        await this.createSubtaskDependencies(createdSubtasks, decompositionResult.dependencies);
      }
      
      // Обновляем задачу, устанавливая прогресс и оценку времени
      await this.updateTaskProgress(taskId, decompositionResult);
      
      const resultMessage = `Задача декомпозирована на ${createdSubtasks.length} подзадач`;
      await taskLogger.logInfo(taskId, resultMessage);
      
      logger.info(`Успешно выполнена декомпозиция задачи #${taskId}: ${resultMessage}`);
      
      return {
        success: true,
        message: resultMessage,
        taskId,
        subtasks: createdSubtasks,
        estimatedHours: decompositionResult.totalEstimatedHours
      };
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи #${taskId}:`, error);
      await taskLogger.logError(taskId, `Ошибка при декомпозиции задачи: ${error.message}`);
      
      return {
        success: false,
        message: `Произошла ошибка: ${error.message}`,
        taskId
      };
    }
  }

  /**
   * Получает данные о задаче
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Данные о задаче
   * @private
   */
  async getTaskData(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      // Получаем теги задачи
      const [tags] = await connection.query(
        'SELECT tag_name FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        return null;
      }
      
      const task = tasks[0];
      task.tags = tags.map(tag => tag.tag_name);
      
      return task;
    } catch (error) {
      logger.error(`Ошибка при получении данных о задаче #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Получает данные о проекте
   * @param {number} projectId - ID проекта
   * @returns {Promise<Object>} - Данные о проекте
   * @private
   */
  async getProjectData(projectId) {
    try {
      const connection = await pool.getConnection();
      
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      // Дополнительно получаем информацию о структуре проекта
      const [projectFiles] = await connection.query(
        'SELECT file_path, file_type FROM project_files WHERE project_id = ? LIMIT 50',
        [projectId]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        return null;
      }
      
      const projectData = projects[0];
      projectData.files = projectFiles;
      
      return projectData;
    } catch (error) {
      logger.error(`Ошибка при получении данных о проекте #${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Получает результаты анализа задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результаты анализа
   * @private
   */
  async getTaskAnalysis(taskId) {
    try {
      const connection = await pool.getConnection();
      
      const [metaResults] = await connection.query(
        'SELECT meta_value FROM task_meta WHERE task_id = ? AND meta_key = ?',
        [taskId, 'task_analysis']
      );
      
      connection.release();
      
      if (metaResults.length === 0) {
        return null;
      }
      
      return JSON.parse(metaResults[0].meta_value);
    } catch (error) {
      logger.error(`Ошибка при получении анализа задачи #${taskId}:`, error);
      return null; // Возвращаем null, чтобы можно было продолжить с новым анализом
    }
  }

  /**
   * Выполняет декомпозицию задачи с использованием LLM
   * @param {Object} taskData - Данные о задаче
   * @param {Object} taskAnalysis - Результаты анализа задачи
   * @param {Object} projectData - Данные о проекте
   * @returns {Promise<Object>} - Результаты декомпозиции
   * @private
   */
  async performDecomposition(taskData, taskAnalysis, projectData) {
    try {
      // Формируем промпт для LLM
      const prompt = this.createDecompositionPrompt(taskData, taskAnalysis, projectData);
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Парсим результаты
      return this.parseDecompositionResponse(response);
    } catch (error) {
      logger.error(`Ошибка при выполнении декомпозиции задачи #${taskData.id}:`, error);
      throw error;
    }
  }

  /**
   * Создает промпт для декомпозиции задачи
   * @param {Object} taskData - Данные о задаче
   * @param {Object} taskAnalysis - Результаты анализа задачи
   * @param {Object} projectData - Данные о проекте
   * @returns {string} - Промпт для LLM
   * @private
   */
  createDecompositionPrompt(taskData, taskAnalysis, projectData) {
    return `
# Задача: Декомпозиция задачи разработки на подзадачи

## Исходная задача
Название: ${taskData.title}
Описание: ${taskData.description || 'Нет описания'}
Приоритет: ${taskData.priority || 'Не указан'}
Теги: ${taskData.tags && taskData.tags.length > 0 ? taskData.tags.join(', ') : 'Нет тегов'}

## Результаты анализа задачи
Тип задачи: ${taskAnalysis.taskType || 'Не определен'}
Цель: ${taskAnalysis.objective || 'Не определена'}
Компоненты: ${taskAnalysis.components && taskAnalysis.components.length > 0 ? taskAnalysis.components.join(', ') : 'Не определены'}
Технологии: ${taskAnalysis.technologies && taskAnalysis.technologies.length > 0 ? taskAnalysis.technologies.join(', ') : 'Не определены'}
Сложность: ${taskAnalysis.complexity || 'medium'}
Файлы для изменения: ${taskAnalysis.filesToModify && taskAnalysis.filesToModify.length > 0 ? taskAnalysis.filesToModify.join(', ') : 'Нет'}
Файлы для создания: ${taskAnalysis.filesToCreate && taskAnalysis.filesToCreate.length > 0 ? taskAnalysis.filesToCreate.join(', ') : 'Нет'}

## Проект
Название: ${projectData.name}
Описание: ${projectData.description || 'Нет описания'}

## Инструкции
Разбей исходную задачу на логические подзадачи, которые могут быть выполнены последовательно или параллельно. Учитывай:

1. Каждая подзадача должна быть атомарной и иметь конкретное описание
2. Подзадачи должны быть упорядочены логически, от подготовки до тестирования
3. Для каждой подзадачи укажи примерную оценку времени в часах
4. Если есть зависимости между подзадачами, укажи их
5. Общее количество подзадач не должно превышать 10, оптимально 3-7 подзадач

## Формат ответа
Предоставь результаты декомпозиции в формате JSON:

\`\`\`json
{
  "subtasks": [
    {
      "title": "string", // Короткое название подзадачи
      "description": "string", // Подробное описание
      "sequence_number": number, // Порядковый номер
      "estimated_hours": number, // Оценка времени в часах
      "files_involved": ["string"] // Задействованные файлы
    }
  ],
  "dependencies": [
    {
      "subtask_index": number, // Индекс подзадачи (начиная с 0)
      "depends_on_index": number // Индекс подзадачи, от которой зависит
    }
  ],
  "totalEstimatedHours": number, // Общая оценка в часах
  "parallelizationPossible": boolean, // Возможность параллельного выполнения
  "recommendedApproach": "string" // Рекомендуемый подход к выполнению
}
\`\`\`
`;
  }

  /**
   * Парсит ответ LLM и извлекает результаты декомпозиции
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Структурированные результаты декомпозиции
   * @private
   */
  parseDecompositionResponse(response) {
    try {
      // Ищем JSON в ответе
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      
      if (jsonMatch && jsonMatch[1]) {
        return JSON.parse(jsonMatch[1]);
      }
      
      // Если не удалось найти JSON в формате markdown, пробуем парсить весь ответ
      try {
        return JSON.parse(response);
      } catch {
        // Если и это не удалось, извлекаем информацию регулярными выражениями
        return this.extractDecompositionWithRegex(response);
      }
    } catch (error) {
      logger.error(`Ошибка при парсинге ответа LLM:`, error);
      
      // Возвращаем базовый объект с данными
      return {
        subtasks: [
          {
            title: "Основная задача",
            description: "Выполнение основной задачи согласно описанию",
            sequence_number: 1,
            estimated_hours: 4,
            files_involved: []
          }
        ],
        dependencies: [],
        totalEstimatedHours: 4,
        parallelizationPossible: false,
        recommendedApproach: "Выполнение задачи согласно описанию"
      };
    }
  }

  /**
   * Извлекает информацию о декомпозиции из ответа с помощью регулярных выражений
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Структурированные результаты декомпозиции
   * @private
   */
  extractDecompositionWithRegex(response) {
    const subtasks = [];
    const dependencies = [];
    let totalEstimatedHours = 0;
    
    try {
      // Разбиваем ответ на строки
      const lines = response.split('\n');
      
      // Ищем подзадачи в формате "N. Название - описание (X ч.)"
      const subtaskRegex = /^\s*(\d+)[\.\)]\s+([^\n-]+)(?:-\s*([^\n\(]*))?(?:\s*\((\d+(?:\.\d+)?)\s*(?:ч|час|h))?/im;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = subtaskRegex.exec(line);
        
        if (match) {
          const sequenceNumber = parseInt(match[1], 10);
          const title = match[2].trim();
          let description = match[3] ? match[3].trim() : '';
          const estimatedHours = match[4] ? parseFloat(match[4]) : 1;
          
          // Если описание не найдено в этой строке, ищем в следующих
          if (!description && i + 1 < lines.length) {
            let nextLine = lines[i + 1].trim();
            if (nextLine && !subtaskRegex.test(nextLine) && !nextLine.startsWith('#')) {
              description = nextLine;
              i++; // Пропускаем строку с описанием
            }
          }
          
          subtasks.push({
            title,
            description,
            sequence_number: sequenceNumber,
            estimated_hours: estimatedHours,
            files_involved: []
          });
          
          totalEstimatedHours += estimatedHours;
        }
      }
      
      // Если не нашли подзадачи, пробуем другой формат
      if (subtasks.length === 0) {
        const altSubtaskRegex = /(?:Подзадача|Subtask)\s+(\d+):\s+([^\n]+)/gi;
        let match;
        
        while ((match = altSubtaskRegex.exec(response)) !== null) {
          const sequenceNumber = parseInt(match[1], 10);
          const title = match[2].trim();
          
          // Ищем информацию об оценке времени
          const hoursRegex = new RegExp(`(?:${title}).*?(?:оценка|estimate):\\s*(\\d+(?:\\.\\d+)?)\\s*(?:ч|час|h)`, 'i');
          const hoursMatch = hoursRegex.exec(response);
          const estimatedHours = hoursMatch ? parseFloat(hoursMatch[1]) : 1;
          
          subtasks.push({
            title,
            description: title,
            sequence_number: sequenceNumber,
            estimated_hours: estimatedHours,
            files_involved: []
          });
          
          totalEstimatedHours += estimatedHours;
        }
      }
      
      // Ищем зависимости
      // Формат: "Подзадача X зависит от подзадачи Y"
      const dependencyRegex = /(?:Подзадача|Subtask)\s+(\d+).*?зависит.*?(?:Подзадача|Subtask)\s+(\d+)/gi;
      let dependencyMatch;
      
      while ((dependencyMatch = dependencyRegex.exec(response)) !== null) {
        const subtaskIndex = parseInt(dependencyMatch[1], 10) - 1;
        const dependsOnIndex = parseInt(dependencyMatch[2], 10) - 1;
        
        dependencies.push({
          subtask_index: subtaskIndex,
          depends_on_index: dependsOnIndex
        });
      }
      
      // Проверка на возможность параллельного выполнения
      const parallelizationPossible = !response.toLowerCase().includes('последовательно') || 
                                      response.toLowerCase().includes('параллельно');
      
      // Извлечение рекомендуемого подхода
      let recommendedApproach = 'Стандартный подход к выполнению задачи';
      const approachMatch = response.match(/(?:Рекомендуемый подход|Recommended approach):\s*([^\n]+)/i);
      
      if (approachMatch) {
        recommendedApproach = approachMatch[1].trim();
      }
      
      return {
        subtasks,
        dependencies,
        totalEstimatedHours,
        parallelizationPossible,
        recommendedApproach
      };
    } catch (error) {
      logger.error('Ошибка при извлечении данных о декомпозиции с помощью регулярных выражений:', error);
      
      // Базовый вариант с одной подзадачей
      return {
        subtasks: [
          {
            title: "Выполнение задачи",
            description: "Выполнение основной задачи согласно описанию",
            sequence_number: 1,
            estimated_hours: 4,
            files_involved: []
          }
        ],
        dependencies: [],
        totalEstimatedHours: 4,
        parallelizationPossible: false,
        recommendedApproach: "Выполнение задачи согласно описанию"
      };
    }
  }

  /**
   * Создает подзадачи в БД
   * @param {number} taskId - ID задачи
   * @param {Array<Object>} subtasks - Массив подзадач
   * @returns {Promise<Array<Object>>} - Массив созданных подзадач
   * @private
   */
  async createSubtasks(taskId, subtasks) {
    try {
      if (!subtasks || subtasks.length === 0) {
        logger.warn(`Не удалось создать подзадачи для задачи #${taskId}: пустой список подзадач`);
        return [];
      }
      
      const connection = await pool.getConnection();
      const createdSubtasks = [];
      
      // Удаляем существующие подзадачи, если они есть
      await connection.query(
        'DELETE FROM subtasks WHERE task_id = ?',
        [taskId]
      );
      
      // Создаем новые подзадачи
      for (const subtask of subtasks) {
        const [result] = await connection.query(
          `INSERT INTO subtasks 
           (task_id, title, description, status, estimated_hours, sequence_number, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            taskId,
            subtask.title,
            subtask.description,
            'pending',
            subtask.estimated_hours,
            subtask.sequence_number
          ]
        );
        
        const subtaskId = result.insertId;
        
        // Сохраняем информацию о задействованных файлах в метаданных
        if (subtask.files_involved && subtask.files_involved.length > 0) {
          await connection.query(
            `INSERT INTO task_meta (task_id, subtask_id, meta_key, meta_value) 
             VALUES (?, ?, ?, ?)`,
            [
              taskId,
              subtaskId,
              'files_involved',
              JSON.stringify(subtask.files_involved)
            ]
          );
        }
        
        createdSubtasks.push({
          id: subtaskId,
          task_id: taskId,
          title: subtask.title,
          description: subtask.description,
          status: 'pending',
          estimated_hours: subtask.estimated_hours,
          sequence_number: subtask.sequence_number,
          files_involved: subtask.files_involved || []
        });
      }
      
      connection.release();
      
      logger.info(`Создано ${createdSubtasks.length} подзадач для задачи #${taskId}`);
      return createdSubtasks;
    } catch (error) {
      logger.error(`Ошибка при создании подзадач для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Создает зависимости между подзадачами
   * @param {Array<Object>} createdSubtasks - Массив созданных подзадач
   * @param {Array<Object>} dependencies - Массив зависимостей
   * @returns {Promise<void>}
   * @private
   */
  async createSubtaskDependencies(createdSubtasks, dependencies) {
    try {
      if (!dependencies || dependencies.length === 0) {
        return;
      }
      
      const connection = await pool.getConnection();
      
      for (const dependency of dependencies) {
        // Получаем ID подзадач по их индексам
        const subtaskIndex = dependency.subtask_index;
        const dependsOnIndex = dependency.depends_on_index;
        
        if (subtaskIndex >= createdSubtasks.length || dependsOnIndex >= createdSubtasks.length) {
          logger.warn(`Некорректный индекс подзадачи в зависимости: ${subtaskIndex} -> ${dependsOnIndex}`);
          continue;
        }
        
        const subtaskId = createdSubtasks[subtaskIndex].id;
        const dependsOnId = createdSubtasks[dependsOnIndex].id;
        
        // Добавляем зависимость
        await connection.query(
          `INSERT INTO subtask_dependencies (subtask_id, depends_on_subtask_id, created_at) 
           VALUES (?, ?, NOW())`,
          [subtaskId, dependsOnId]
        );
      }
      
      connection.release();
      
      logger.info(`Создано ${dependencies.length} зависимостей между подзадачами`);
    } catch (error) {
      logger.error(`Ошибка при создании зависимостей между подзадачами:`, error);
      // Не выбрасываем ошибку, так как это некритичная операция
    }
  }

  /**
   * Обновляет информацию о задаче на основе результатов декомпозиции
   * @param {number} taskId - ID задачи
   * @param {Object} decompositionResult - Результаты декомпозиции
   * @returns {Promise<void>}
   * @private
   */
  async updateTaskProgress(taskId, decompositionResult) {
    try {
      const connection = await pool.getConnection();
      
      // Обновляем оценку времени и прогресс
      await connection.query(
        `UPDATE tasks 
         SET 
           estimated_hours = ?, 
           progress = 10, 
           updated_at = NOW() 
         WHERE id = ?`,
        [
          decompositionResult.totalEstimatedHours,
          taskId
        ]
      );
      
      // Сохраняем рекомендуемый подход в метаданных
      if (decompositionResult.recommendedApproach) {
        await connection.query(
          `INSERT INTO task_meta (task_id, meta_key, meta_value) 
           VALUES (?, ?, ?) 
           ON DUPLICATE KEY UPDATE meta_value = ?`,
          [
            taskId,
            'recommended_approach',
            decompositionResult.recommendedApproach,
            decompositionResult.recommendedApproach
          ]
        );
      }
      
      // Сохраняем информацию о возможности параллельного выполнения
      await connection.query(
        `INSERT INTO task_meta (task_id, meta_key, meta_value) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE meta_value = ?`,
        [
          taskId,
          'parallelization_possible',
          decompositionResult.parallelizationPossible ? '1' : '0',
          decompositionResult.parallelizationPossible ? '1' : '0'
        ]
      );
      
      connection.release();
      
      logger.debug(`Обновлена информация о задаче #${taskId} на основе результатов декомпозиции`);
    } catch (error) {
      logger.error(`Ошибка при обновлении информации о задаче #${taskId}:`, error);
      // Не выбрасываем ошибку, так как это некритичная операция
    }
  }
}

module.exports = new TaskDecomposer();
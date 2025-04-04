// src/controller/index.js

const TaskPlanner = require('../core/task-planner');
const CodeGenerator = require('../core/code-generator');
const VCSManager = require('../core/vcs-manager/index');
const ProjectUnderstanding = require('../core/project-understanding');
const logger = require('../utils/logger');
const { pool } = require('../config/db.config');
const TaskQueue = require('./task-queue');

/**
 * Главный контроллер системы, координирующий работу всех компонентов
 */
class Controller {
  constructor() {
    this.taskQueue = new TaskQueue();
    this.running = false;
    this.processInterval = null;
  }

  /**
   * Запускает контроллер
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) {
      logger.warn('Контроллер уже запущен');
      return;
    }
    
    logger.info('Запуск контроллера системы');
    
    this.running = true;
    
    // Запускаем цикл обработки задач
    this.processInterval = setInterval(() => this.processNextTask(), 5000);
    
    logger.info('Контроллер системы успешно запущен');
  }

  /**
   * Останавливает контроллер
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.running) {
      logger.warn('Контроллер не запущен');
      return;
    }
    
    logger.info('Остановка контроллера системы');
    
    this.running = false;
    
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    logger.info('Контроллер системы успешно остановлен');
  }

  /**
   * Обрабатывает следующую задачу из очереди
   * @returns {Promise<void>}
   */
  async processNextTask() {
    if (!this.running) {
      return;
    }
    
    try {
      // Получаем следующую задачу из очереди
      const task = await this.taskQueue.getNextTask();
      
      if (!task) {
        // Нет задач в очереди
        return;
      }
      
      logger.info(`Начало обработки задачи #${task.id}: ${task.title}`);
      
      // Обрабатываем задачу в зависимости от её типа
      switch (task.type) {
        case 'decompose':
          await this.decomposeTask(task.data.taskId);
          break;
        
        case 'generate_code':
          await this.generateCode(task.data.taskId);
          break;
        
        case 'commit_code':
          await this.commitCode(task.data.taskId, task.data.generationId);
          break;
        
        case 'analyze_project':
          await this.analyzeProject(task.data.projectId);
          break;
        
        default:
          logger.warn(`Неизвестный тип задачи: ${task.type}`);
      }
      
      // Помечаем задачу как выполненную
      await this.taskQueue.completeTask(task.id);
      
      logger.info(`Задача #${task.id} успешно обработана`);
    } catch (error) {
      logger.error('Ошибка при обработке задачи из очереди:', error);
    }
  }

  /**
   * Добавляет задачу в очередь
   * @param {string} type - Тип задачи
   * @param {Object} data - Данные задачи
   * @param {number} priority - Приоритет (1-10)
   * @returns {Promise<Object>} - Добавленная задача
   */
  async addTask(type, data, priority = 5) {
    try {
      const task = await this.taskQueue.addTask(type, data, priority);
      logger.info(`Задача типа "${type}" добавлена в очередь с id=${task.id}`);
      return task;
    } catch (error) {
      logger.error(`Ошибка при добавлении задачи типа "${type}" в очередь:`, error);
      throw error;
    }
  }

  /**
   * Декомпозирует высокоуровневую задачу на подзадачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Array>} - Список созданных подзадач
   */
  async decomposeTask(taskId) {
    try {
      logger.info(`Декомпозиция задачи #${taskId}`);
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Инициализируем планировщик задач
      const taskPlanner = new TaskPlanner(task.project_id);
      
      // Декомпозируем задачу
      const subtasks = await taskPlanner.decomposeTask(taskId);
      
      // Добавляем в очередь задачу на генерацию кода для первой подзадачи
      if (subtasks && subtasks.length > 0) {
        await this.addTask('generate_code', { taskId }, 6);
      }
      
      return subtasks;
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Генерирует код для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат генерации
   */
  async generateCode(taskId) {
    try {
      logger.info(`Генерация кода для задачи #${taskId}`);
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Инициализируем генератор кода
      const codeGenerator = new CodeGenerator(task.project_id);
      
      // Генерируем код
      const result = await codeGenerator.generateCode(taskId);
      
      // Добавляем в очередь задачу на коммит кода, если генерация успешна
      if (result && result.generationId) {
        await this.addTask('commit_code', { 
          taskId, 
          generationId: result.generationId 
        }, 4);
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Коммитит сгенерированный код в репозиторий
   * @param {number} taskId - ID задачи
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<Object>} - Результат коммита
   */
  async commitCode(taskId, generationId) {
    try {
      logger.info(`Коммит кода для задачи #${taskId}, генерация #${generationId}`);
      
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Получаем информацию о генерации
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      connection.release();
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Автоматически одобряем генерацию
      // В реальной системе здесь должен быть этап проверки человеком
      
      // Инициализируем генератор кода для применения изменений
      const codeGenerator = new CodeGenerator(task.project_id);
      await codeGenerator.updateGenerationStatus(generationId, 'approved');
      
      // Применяем сгенерированный код
      await codeGenerator.applyGeneratedCode(generationId);
      
      // Инициализируем менеджер VCS
      const vcsManager = new VCSManager(task.project_id);
      
      // Создаем коммит и PR
      const result = await vcsManager.processTask(taskId, [
        {
          path: generation.file_path,
          content: generation.generated_content
        }
      ]);
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при коммите кода для задачи #${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Анализирует проект и обновляет модель проекта
   * @param {number} projectId - ID проекта
   * @returns {Promise<void>}
   */
  async analyzeProject(projectId) {
    try {
      logger.info(`Анализ проекта #${projectId}`);
      
      // Получаем информацию о проекте
      const connection = await pool.getConnection();
      
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      connection.release();
      
      if (projects.length === 0) {
        throw new Error(`Проект с id=${projectId} не найден`);
      }
      
      const project = projects[0];
      
      // Инициализируем систему понимания проекта
      const projectUnderstanding = new ProjectUnderstanding(projectId);
      
      // Анализируем проект
      await projectUnderstanding.analyzeProject(project.repository_url);
      
      logger.info(`Проект #${projectId} успешно проанализирован`);
    } catch (error) {
      logger.error(`Ошибка при анализе проекта #${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Обрабатывает запрос на выполнение задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<Object>} - Результат обработки
   */
  async handleTaskRequest(taskId) {
    try {
      // Получаем информацию о задаче
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${taskId} не найдена`);
      }
      
      const task = tasks[0];
      
      // Проверяем статус задачи
      if (task.status === 'completed') {
        return { 
          success: true, 
          message: 'Задача уже выполнена', 
          status: task.status 
        };
      }
      
      if (task.status === 'in_progress') {
        return { 
          success: true, 
          message: 'Задача уже выполняется', 
          status: task.status 
        };
      }
      
      // Проверяем, есть ли подзадачи
      const [subtasks] = await connection.query(
        'SELECT COUNT(*) AS count FROM subtasks WHERE task_id = ?',
        [taskId]
      );
      
      if (subtasks[0].count > 0) {
        // Задача уже декомпозирована, добавляем генерацию кода
        await this.addTask('generate_code', { taskId }, 6);
      } else {
        // Задача не декомпозирована, добавляем декомпозицию
        await this.addTask('decompose', { taskId }, 7);
      }
      
      return { 
        success: true, 
        message: 'Задача добавлена в очередь на выполнение', 
        status: 'queued' 
      };
    } catch (error) {
      logger.error(`Ошибка при обработке запроса на выполнение задачи #${taskId}:`, error);
      throw error;
    }
  }
}

module.exports = new Controller();
/**
 * @fileoverview Интегрированный контроллер для управления оркестрацией задач.
 * Связывает систему оркестрации с существующим API и утилитами проекта.
 */

// Импорт компонентов системы оркестрации
const { TaskOrchestrator } = require('../../core/orchestrator/task-orchestrator');
const { ContextManager } = require('../../core/orchestrator/context-manager');
const { StateManager, TASK_STATES } = require('../../core/orchestrator/state-manager');
const { TransitionManager } = require('../../core/orchestrator/transition-manager');
const { RecoveryManager } = require('../../core/orchestrator/recovery-manager');
const { NotificationManager } = require('../../core/orchestrator/notification-manager');

// Импорт существующих утилит проекта
const logger = require('../../utils/logger');
const { getLLMClient } = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const GitService = require('../../core/vcs-manager/gitService');
const { pool } = require('../../config/db.config');
const config = require('../../config/app.config');
const llmConfig = require('../../config/llm.config');

/**
 * Контроллер для управления оркестрацией задач, интегрированный с существующими компонентами.
 */
class TaskOrchestrationController {
  /**
   * Создает экземпляр TaskOrchestrationController.
   * Инициализирует систему оркестрации с существующими компонентами.
   * @param {Object} options - Опции для инициализации (опционально).
   */
  constructor(options = {}) {
    this.config = { ...config, ...options };
    this.initializeComponents();
    
    logger.info('TaskOrchestrationController инициализирован');
  }

  /**
   * Инициализирует компоненты системы оркестрации.
   * @private
   */
  async initializeComponents() {
    try {
      // Инициализируем менеджер промптов (если еще не инициализирован)
      if (!promptManager.initialized) {
        await promptManager.initialize();
      }
      
      // Получаем LLM клиент из существующей утилиты
      this.llmClient = getLLMClient(llmConfig);
      
      // Инициализируем систему уведомлений
      this.notificationManager = new NotificationManager({
        websocket: this.config.websocket,
        db: pool,
        emailService: this.config.emailService,
        config: this.config.notifications
      });
      
      // Инициализируем менеджер контекста
      this.contextManager = new ContextManager({
        db: pool,
        cache: this.config.useCache ? this.config.cache : null
      });
      
      // Инициализируем менеджер состояний
      this.stateManager = new StateManager({
        db: pool,
        contextManager: this.contextManager
      });
      
      // Инициализируем менеджер переходов
      this.transitionManager = new TransitionManager({
        stateManager: this.stateManager,
        contextManager: this.contextManager
      });
      
      // Инициализируем менеджер восстановления
      this.recoveryManager = new RecoveryManager({
        stateManager: this.stateManager,
        contextManager: this.contextManager,
        db: pool,
        notificationManager: this.notificationManager
      });
      
      // Инициализируем оркестратор задач
      this.taskOrchestrator = new TaskOrchestrator({
        stateManager: this.stateManager,
        contextManager: this.contextManager,
        transitionManager: this.transitionManager,
        recoveryManager: this.recoveryManager,
        notificationManager: this.notificationManager,
        queue: this.config.queue,
        db: pool
      });
      
      logger.info('Компоненты системы оркестрации инициализированы');
    } catch (error) {
      logger.error('Ошибка при инициализации компонентов системы оркестрации:', error);
      throw error;
    }
  }

  /**
   * Инициализирует Git-клиент для указанного репозитория.
   * @param {string} projectId - ID проекта.
   * @returns {Promise<GitService>} - Экземпляр GitService.
   * @private
   */
  async _initializeGitService(projectId) {
    try {
      // Получаем информацию о проекте из БД
      const [projectRows] = await pool.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (!projectRows || projectRows.length === 0) {
        throw new Error(`Проект с ID ${projectId} не найден`);
      }
      
      const project = projectRows[0];
      
      // Если у проекта нет локального пути, устанавливаем временный
      if (!project.local_path) {
        project.local_path = path.join(
          this.config.repos?.basePath || '/tmp/repos',
          `project_${project.id}_${Date.now()}`
        );
        
        // Обновляем путь в БД
        await pool.query(
          'UPDATE projects SET local_path = ? WHERE id = ?',
          [project.local_path, project.id]
        );
      }
      
      // Создаем экземпляр GitService
      const gitService = new GitService(project.local_path);
      
      // Проверяем, инициализирован ли репозиторий
      const isRepo = await gitService.isRepo();
      
      if (!isRepo && project.repository_url) {
        // Клонируем репозиторий, если есть URL и репозиторий не инициализирован
        await gitService.clone(project.repository_url, project.local_path);
      }
      
      return gitService;
    } catch (error) {
      logger.error(`Ошибка при инициализации GitService для проекта ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Создает новую задачу и инициализирует её в системе оркестрации.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async createTask(req, res) {
    try {
      const { title, description, project_id, priority, type, tags, assigned_to } = req.body;
      
      // Валидация входных данных
      if (!title || !description) {
        return res.status(400).json({
          success: false,
          message: 'Название и описание задачи обязательны'
        });
      }
      
      // Начинаем транзакцию
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      
      try {
        // Создаем задачу в БД
        const [result] = await connection.query(
          `INSERT INTO tasks 
           (title, description, project_id, priority, type, status, created_by, assigned_to) 
           VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`,
          [
            title, 
            description, 
            project_id || null, 
            priority || 'medium', 
            type || 'feature',
            req.user?.id || null,
            assigned_to || null
          ]
        );
        
        const taskId = result.insertId;
        
        // Добавляем теги, если они есть
        if (tags && Array.isArray(tags) && tags.length > 0) {
          const tagValues = tags.map(tag => [taskId, tag]);
          
          await connection.query(
            'INSERT INTO task_tags (task_id, tag) VALUES ?',
            [tagValues]
          );
        }
        
        // Коммитим транзакцию
        await connection.commit();
        connection.release();
        
        logger.info(`Задача создана: ${taskId}`);
        
        // Инициализируем задачу в системе оркестрации
        const result = await this.taskOrchestrator.initializeTask(taskId.toString(), {
          projectId: project_id ? project_id.toString() : null,
          task: {
            title,
            description,
            priority: priority || 'medium',
            type: type || 'feature'
          },
          data: {
            tags,
            assignedTo: assigned_to
          }
        });
        
        return res.status(201).json({
          success: true,
          task_id: taskId,
          status: 'created',
          message: 'Задача успешно создана и поставлена в очередь',
          orchestrationStatus: result.status || 'initialized'
        });
      } catch (error) {
        // Откатываем транзакцию в случае ошибки
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      logger.error('Ошибка при создании задачи:', error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при создании задачи',
        error: error.message
      });
    }
  }

  /**
   * Запускает выполнение существующей задачи.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async startTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      const task = taskRows[0];
      
      // Проверяем, что задача не запущена
      if (task.status !== 'created' && task.status !== 'paused') {
        return res.status(400).json({
          success: false,
          message: `Невозможно запустить задачу в статусе '${task.status}'`
        });
      }
      
      // Получаем текущее состояние задачи в системе оркестрации
      const currentState = await this.stateManager.getCurrentState(taskId.toString());
      
      // Проверяем, можно ли запустить задачу
      if (currentState !== TASK_STATES.INITIALIZED && 
          currentState !== TASK_STATES.PAUSED) {
        return res.status(400).json({
          success: false,
          message: `Невозможно запустить задачу в состоянии '${currentState}'`
        });
      }
      
      // Обновляем статус задачи в БД
      await pool.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        ['in_progress', taskId]
      );
      
      // Запускаем выполнение задачи в системе оркестрации
      const result = await this.taskOrchestrator.executeTask(taskId.toString());
      
      // Отправляем уведомление
      if (this.notificationManager) {
        await this.notificationManager.sendInfo(
          'Задача запущена',
          `Задача ${task.title} (ID: ${taskId}) запущена в работу`,
          { taskId: taskId.toString() }
        );
      }
      
      return res.status(200).json({
        success: true,
        task_id: taskId,
        status: 'in_progress',
        message: 'Задача успешно запущена',
        orchestrationStatus: result.status
      });
    } catch (error) {
      logger.error(`Ошибка при запуске задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при запуске задачи',
        error: error.message
      });
    }
  }

  /**
   * Приостанавливает выполнение задачи.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async pauseTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      const task = taskRows[0];
      
      // Проверяем, что задача в процессе выполнения
      if (task.status !== 'in_progress') {
        return res.status(400).json({
          success: false,
          message: `Невозможно приостановить задачу в статусе '${task.status}'`
        });
      }
      
      // Получаем текущее состояние задачи в системе оркестрации
      const currentState = await this.stateManager.getCurrentState(taskId.toString());
      
      // Проверяем, можно ли приостановить задачу
      if (currentState === TASK_STATES.COMPLETED || 
          currentState === TASK_STATES.FAILED ||
          currentState === TASK_STATES.PAUSED) {
        return res.status(400).json({
          success: false,
          message: `Невозможно приостановить задачу в состоянии '${currentState}'`
        });
      }
      
      // Обновляем статус задачи в БД
      await pool.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        ['paused', taskId]
      );
      
      // Приостанавливаем выполнение задачи в системе оркестрации
      await this.transitionManager.transitionToNextState(
        taskId.toString(),
        TASK_STATES.PAUSED,
        'Задача приостановлена пользователем'
      );
      
      // Отправляем уведомление
      if (this.notificationManager) {
        await this.notificationManager.sendInfo(
          'Задача приостановлена',
          `Задача ${task.title} (ID: ${taskId}) приостановлена`,
          { taskId: taskId.toString() }
        );
      }
      
      return res.status(200).json({
        success: true,
        task_id: taskId,
        status: 'paused',
        message: 'Задача успешно приостановлена'
      });
    } catch (error) {
      logger.error(`Ошибка при приостановке задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при приостановке задачи',
        error: error.message
      });
    }
  }

  /**
   * Возобновляет выполнение приостановленной задачи.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async resumeTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      const task = taskRows[0];
      
      // Проверяем, что задача приостановлена
      if (task.status !== 'paused') {
        return res.status(400).json({
          success: false,
          message: `Невозможно возобновить задачу в статусе '${task.status}'`
        });
      }
      
      // Получаем текущее состояние задачи в системе оркестрации
      const currentState = await this.stateManager.getCurrentState(taskId.toString());
      
      // Проверяем, можно ли возобновить задачу
      if (currentState !== TASK_STATES.PAUSED) {
        return res.status(400).json({
          success: false,
          message: `Невозможно возобновить задачу в состоянии '${currentState}'`
        });
      }
      
      // Обновляем статус задачи в БД
      await pool.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        ['in_progress', taskId]
      );
      
      // Получаем историю состояний задачи
      const stateHistory = await this.stateManager.getStateHistory(taskId.toString());
      
      // Находим последнее активное состояние перед паузой
      let lastActiveState = null;
      
      for (let i = stateHistory.length - 1; i >= 0; i--) {
        if (stateHistory[i].state !== TASK_STATES.PAUSED) {
          lastActiveState = stateHistory[i].state;
          break;
        }
      }
      
      // Если не нашли активное состояние, используем INITIALIZED
      if (!lastActiveState) {
        lastActiveState = TASK_STATES.INITIALIZED;
      }
      
      // Возобновляем выполнение задачи в системе оркестрации
      await this.transitionManager.transitionToNextState(
        taskId.toString(),
        lastActiveState,
        'Задача возобновлена пользователем'
      );
      
      // Запускаем выполнение задачи
      const result = await this.taskOrchestrator.executeTask(taskId.toString());
      
      // Отправляем уведомление
      if (this.notificationManager) {
        await this.notificationManager.sendInfo(
          'Задача возобновлена',
          `Задача ${task.title} (ID: ${taskId}) возобновлена`,
          { taskId: taskId.toString() }
        );
      }
      
      return res.status(200).json({
        success: true,
        task_id: taskId,
        status: 'in_progress',
        message: 'Задача успешно возобновлена',
        orchestrationStatus: result.status
      });
    } catch (error) {
      logger.error(`Ошибка при возобновлении задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при возобновлении задачи',
        error: error.message
      });
    }
  }

  /**
   * Отменяет выполнение задачи.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async cancelTask(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      const task = taskRows[0];
      
      // Проверяем, что задача не завершена
      if (task.status === 'completed' || task.status === 'failed') {
        return res.status(400).json({
          success: false,
          message: `Невозможно отменить задачу в статусе '${task.status}'`
        });
      }
      
      // Обновляем статус задачи в БД
      await pool.query(
        'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
        ['cancelled', taskId]
      );
      
      // Отменяем выполнение задачи в системе оркестрации
      await this.transitionManager.transitionToError(
        taskId.toString(),
        'Задача отменена пользователем'
      );
      
      // Отправляем уведомление
      if (this.notificationManager) {
        await this.notificationManager.sendWarning(
          'Задача отменена',
          `Задача ${task.title} (ID: ${taskId}) отменена`,
          { taskId: taskId.toString() }
        );
      }
      
      return res.status(200).json({
        success: true,
        task_id: taskId,
        status: 'cancelled',
        message: 'Задача успешно отменена'
      });
    } catch (error) {
      logger.error(`Ошибка при отмене задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при отмене задачи',
        error: error.message
      });
    }
  }

  /**
   * Получает информацию о задаче.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async getTaskInfo(req, res) {
    try {
      const { taskId } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        `SELECT t.*, u1.name as created_by_name, u2.name as assigned_to_name
         FROM tasks t
         LEFT JOIN users u1 ON t.created_by = u1.id
         LEFT JOIN users u2 ON t.assigned_to = u2.id
         WHERE t.id = ?`,
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      const task = taskRows[0];
      
      // Получаем теги задачи
      const [tagRows] = await pool.query(
        'SELECT tag FROM task_tags WHERE task_id = ?',
        [taskId]
      );
      
      const tags = tagRows.map(row => row.tag);
      
      // Получаем состояние задачи в системе оркестрации
      let orchestrationState = null;
      let stateHistory = [];
      let context = null;
      let progress = 0;
      
      try {
        orchestrationState = await this.stateManager.getCurrentState(taskId.toString());
        stateHistory = await this.stateManager.getStateHistory(taskId.toString());
        context = await this.contextManager.getContext(taskId.toString());
        
        // Вычисляем прогресс выполнения
        progress = this._calculateProgress(context);
      } catch (error) {
        logger.warn(`Не удалось получить информацию об оркестрации для задачи ${taskId}:`, error);
        // Продолжаем выполнение, даже если не удалось получить информацию об оркестрации
      }
      
      // Формируем результат
      const taskInfo = {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        type: task.type,
        created_at: task.created_at,
        updated_at: task.updated_at,
        created_by: {
          id: task.created_by,
          name: task.created_by_name
        },
        assigned_to: {
          id: task.assigned_to,
          name: task.assigned_to_name
        },
        project_id: task.project_id,
        tags,
        orchestration: {
          state: orchestrationState,
          progress,
          history: stateHistory
        }
      };
      
      // Добавляем результаты шагов, если есть контекст
      if (context && context.stepResults) {
        taskInfo.orchestration.step_results = {};
        
        // Для каждого шага добавляем только summary, чтобы не перегружать ответ
        Object.keys(context.stepResults).forEach(stepName => {
          const stepResult = context.stepResults[stepName];
          
          taskInfo.orchestration.step_results[stepName] = {
            success: stepResult.success,
            timestamp: stepResult.timestamp,
            duration: stepResult.duration,
            summary: stepResult.summary || {}
          };
        });
      }
      
      return res.status(200).json({
        success: true,
        task: taskInfo
      });
    } catch (error) {
      logger.error(`Ошибка при получении информации о задаче ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении информации о задаче',
        error: error.message
      });
    }
  }

  /**
   * Предоставляет ответ на запрос ввода от пользователя.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async provideUserInput(req, res) {
    try {
      const { taskId } = req.params;
      const { input, stepName } = req.body;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      // Получаем текущее состояние задачи в системе оркестрации
      const currentState = await this.stateManager.getCurrentState(taskId.toString());
      
      // Проверяем, ожидает ли задача ввода пользователя
      if (currentState !== TASK_STATES.WAITING_FOR_INPUT) {
        return res.status(400).json({
          success: false,
          message: `Задача не ожидает ввода пользователя (текущее состояние: ${currentState})`
        });
      }
      
      // Получаем контекст задачи
      const context = await this.contextManager.getContext(taskId.toString());
      
      // Обновляем контекст с пользовательским вводом
      await this.contextManager.updateContext(
        taskId.toString(), 
        `data.userInput.${stepName || 'general'}`, 
        input
      );
      
      // Определяем следующее состояние (сохранено в контексте)
      const nextState = context.data.nextStateAfterInput;
      
      // Переводим задачу в следующее состояние
      await this.transitionManager.transitionToNextState(
        taskId.toString(),
        nextState || null,
        'Пользователь предоставил ввод'
      );
      
      // Запускаем выполнение задачи
      const result = await this.taskOrchestrator.executeTask(taskId.toString());
      
      // Обновляем статус задачи в БД, если она была в ожидании
      if (taskRows[0].status === 'waiting_for_input') {
        await pool.query(
          'UPDATE tasks SET status = ?, updated_at = NOW() WHERE id = ?',
          ['in_progress', taskId]
        );
      }
      
      return res.status(200).json({
        success: true,
        task_id: taskId,
        status: 'in_progress',
        message: 'Ввод пользователя успешно обработан',
        orchestrationStatus: result.status
      });
    } catch (error) {
      logger.error(`Ошибка при обработке ввода пользователя для задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при обработке ввода пользователя',
        error: error.message
      });
    }
  }

  /**
   * Получает список задач.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async listTasks(req, res) {
    try {
      const { project_id, status, priority, type, assigned_to, tag, limit = 10, offset = 0, sort_by = 'id', sort_dir = 'desc' } = req.query;
      
      // Подготавливаем параметры запроса
      const params = [];
      let whereClause = '1=1'; // Начальное условие, всегда истинное
      
      // Добавляем условия фильтрации
      if (project_id) {
        whereClause += ' AND t.project_id = ?';
        params.push(project_id);
      }
      
      if (status) {
        whereClause += ' AND t.status = ?';
        params.push(status);
      }
      
      if (priority) {
        whereClause += ' AND t.priority = ?';
        params.push(priority);
      }
      
      if (type) {
        whereClause += ' AND t.type = ?';
        params.push(type);
      }
      
      if (assigned_to) {
        whereClause += ' AND t.assigned_to = ?';
        params.push(assigned_to);
      }
      
      // Проверяем правильность сортировки
      const allowedSortFields = ['id', 'title', 'status', 'priority', 'created_at', 'updated_at'];
      const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'id';
      const sortDirection = sort_dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      // Формируем запрос с пагинацией
      let query = `
        SELECT t.*, u1.name as created_by_name, u2.name as assigned_to_name, p.name as project_name
        FROM tasks t
        LEFT JOIN users u1 ON t.created_by = u1.id
        LEFT JOIN users u2 ON t.assigned_to = u2.id
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE ${whereClause}
      `;
      
      // Добавляем фильтрацию по тегу, если указан
      if (tag) {
        query = `
          SELECT t.*, u1.name as created_by_name, u2.name as assigned_to_name, p.name as project_name
          FROM tasks t
          LEFT JOIN users u1 ON t.created_by = u1.id
          LEFT JOIN users u2 ON t.assigned_to = u2.id
          LEFT JOIN projects p ON t.project_id = p.id
          JOIN task_tags tt ON t.id = tt.task_id
          WHERE ${whereClause} AND tt.tag = ?
        `;
        params.push(tag);
      }
      
      // Добавляем сортировку и пагинацию
      query += ` ORDER BY t.${sortField} ${sortDirection} LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));
      
      // Выполняем запрос
      const [tasks] = await pool.query(query, params);
      
      // Получаем общее количество задач
      let countQuery = `SELECT COUNT(*) as count FROM tasks t WHERE ${whereClause}`;
      
      if (tag) {
        countQuery = `
          SELECT COUNT(*) as count
          FROM tasks t
          JOIN task_tags tt ON t.id = tt.task_id
          WHERE ${whereClause} AND tt.tag = ?
        `;
      }
      
      const [countResult] = await pool.query(countQuery, tag ? [...params.slice(0, -2), tag] : params.slice(0, -2));
      const totalCount = countResult[0].count;
      
      // Получаем теги для всех задач
      const taskIds = tasks.map(task => task.id);
      
      if (taskIds.length > 0) {
        const [taskTags] = await pool.query(
          'SELECT task_id, tag FROM task_tags WHERE task_id IN (?)',
          [taskIds]
        );
        
        // Группируем теги по ID задачи
        const tagsByTaskId = {};
        
        taskTags.forEach(row => {
          if (!tagsByTaskId[row.task_id]) {
            tagsByTaskId[row.task_id] = [];
          }
          
          tagsByTaskId[row.task_id].push(row.tag);
        });
        
        // Добавляем теги к задачам
        tasks.forEach(task => {
          task.tags = tagsByTaskId[task.id] || [];
        });
      }
      
      // Получаем прогресс выполнения для задач в оркестрации
      for (const task of tasks) {
        try {
          const context = await this.contextManager.getContext(task.id.toString());
          task.progress = this._calculateProgress(context);
        } catch (error) {
          // Если не удалось получить прогресс, устанавливаем 0
          task.progress = 0;
        }
      }
      
      return res.status(200).json({
        success: true,
        tasks,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / limit)
        }
      });
    } catch (error) {
      logger.error('Ошибка при получении списка задач:', error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении списка задач',
        error: error.message
      });
    }
  }

  /**
   * Вычисляет процент выполнения задачи.
   * @private
   * @param {Object} context - Контекст задачи.
   * @returns {number} - Процент выполнения (0-100).
   */
  _calculateProgress(context) {
    if (!context || !context.stepResults) {
      return 0;
    }
    
    // Веса шагов в общем прогрессе (в сумме 100%)
    const stepWeights = {
      'taskUnderstanding': 5,
      'projectUnderstanding': 10,
      'taskPlanner': 5,
      'technologySuggester': 5,
      'codeGenerator': 20,
      'codeRefiner': 10,
      'selfReflection': 5,
      'errorCorrector': 5,
      'testGenerator': 10,
      'codeExecutor': 5,
      'testAnalyzer': 5,
      'documentationUpdater': 5,
      'learningSystem': 3,
      'prManager': 5,
      'feedbackIntegrator': 2
    };
    
    // Вычисляем прогресс на основе успешно выполненных шагов
    let progress = 0;
    
    for (const stepName in context.stepResults) {
      const stepResult = context.stepResults[stepName];
      
      if (stepResult && stepResult.success) {
        progress += stepWeights[stepName] || 0;
      }
    }
    
    return Math.min(100, Math.round(progress));
  }

  /**
   * Получает результаты выполнения шага задачи.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async getStepResults(req, res) {
    try {
      const { taskId, stepName } = req.params;
      
      // Проверяем существование задачи
      const [taskRows] = await pool.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Задача с ID ${taskId} не найдена`
        });
      }
      
      // Получаем контекст задачи
      const context = await this.contextManager.getContext(taskId.toString());
      
      // Проверяем наличие результатов шага
      if (!context.stepResults || !context.stepResults[stepName]) {
        return res.status(404).json({
          success: false,
          message: `Результаты шага ${stepName} не найдены`
        });
      }
      
      // Возвращаем результаты шага
      return res.status(200).json({
        success: true,
        step_name: stepName,
        step_results: context.stepResults[stepName]
      });
    } catch (error) {
      logger.error(`Ошибка при получении результатов шага ${req.params.stepName} для задачи ${req.params.taskId}:`, error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении результатов шага',
        error: error.message
      });
    }
  }

  /**
   * Получает статистику производительности системы оркестрации.
   * @param {Object} req - HTTP запрос.
   * @param {Object} res - HTTP ответ.
   * @returns {Promise<Object>} - Результат операции.
   */
  async getOrchestrationStats(req, res) {
    try {
      // Получаем статистику из БД
      const [taskStats] = await pool.query(`
        SELECT 
          status, 
          COUNT(*) as count, 
          AVG(TIMESTAMPDIFF(SECOND, created_at, updated_at)) as avg_duration_seconds
        FROM tasks
        GROUP BY status
      `);
      
      // Получаем статистику использования LLM
      const llmStats = this.llmClient.getPerformanceStats();
      
      // Собираем общую статистику
      const stats = {
        tasks: {
          by_status: taskStats.reduce((acc, row) => {
            acc[row.status] = {
              count: row.count,
              avg_duration: row.avg_duration_seconds ? `${Math.round(row.avg_duration_seconds)}s` : 'N/A'
            };
            return acc;
          }, {})
        },
        llm: llmStats,
        orchestration: {
          // Тут можно добавить дополнительную статистику по оркестрации
          active_tasks: this.taskOrchestrator ? this.taskOrchestrator.activeTasksCount : 0,
          queued_tasks: this.taskOrchestrator ? this.taskOrchestrator.taskQueue.size : 0
        }
      };
      
      return res.status(200).json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error('Ошибка при получении статистики системы оркестрации:', error);
      
      return res.status(500).json({
        success: false,
        message: 'Ошибка при получении статистики',
        error: error.message
      });
    }
  }
}

module.exports = TaskOrchestrationController;
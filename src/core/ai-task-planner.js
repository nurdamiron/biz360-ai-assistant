// src/core/ai-task-planner.js

const { pool } = require('../config/db.config');
const logger = require('../utils/logger');
const GitClient = require('../utils/git-client');
const notificationManager = require('../utils/notification-manager');
const TaskDecomposer = require('./task-planner/decomposer');
const CodeGenerator = require('./code-generator');
const taskLogger = require('../utils/task-logger');

/**
 * Класс для планирования и управления задачами ИИ-ассистента
 */
class AITaskPlanner {
  /**
   * Конструктор класса
   */
  constructor() {
    this.taskQueue = [];
    this.running = false;
    this.processingInterval = null;
  }

  /**
   * Запускает планировщик задач
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) {
      logger.warn('AITaskPlanner уже запущен');
      return;
    }
    
    logger.info('Запуск AITaskPlanner');
    this.running = true;
    
    // Запускаем обработку задач каждые 30 секунд
    this.processingInterval = setInterval(() => this.processNextTask(), 30000);
    
    // Начальная загрузка задач из БД
    await this.loadTasksFromDatabase();
    
    logger.info('AITaskPlanner успешно запущен');
  }

  /**
   * Останавливает планировщик задач
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.running) {
      logger.warn('AITaskPlanner не запущен');
      return;
    }
    
    logger.info('Остановка AITaskPlanner');
    this.running = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    logger.info('AITaskPlanner успешно остановлен');
  }

  /**
   * Загружает задачи из базы данных
   * @returns {Promise<void>}
   * @private
   */
  async loadTasksFromDatabase() {
    try {
      const connection = await pool.getConnection();
      
      // Получаем задачи в статусе 'pending' и 'in_progress'
      const [tasks] = await connection.query(`
        SELECT t.* 
        FROM tasks t
        WHERE t.status IN ('pending', 'in_progress')
        AND t.assigned_to IS NULL  -- Задачи без исполнителя (для ИИ)
        ORDER BY 
          t.priority DESC,
          t.created_at ASC
      `);
      
      connection.release();
      
      // Добавляем задачи в очередь
      tasks.forEach(task => {
        // Определяем следующий этап для задачи
        const nextStep = this.determineNextStep(task);
        
        if (nextStep) {
          this.taskQueue.push({
            taskId: task.id,
            step: nextStep,
            priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
            added: new Date()
          });
        }
      });
      
      logger.info(`Загружено ${this.taskQueue.length} задач из базы данных`);
    } catch (error) {
      logger.error('Ошибка при загрузке задач из базы данных:', error);
    }
  }

  /**
   * Определяет следующий шаг для задачи
   * @param {Object} task - Объект задачи
   * @returns {string|null} - Следующий шаг или null, если нет шагов
   * @private
   */
  determineNextStep(task) {
    // Проверяем, что задача в правильном статусе
    if (!['pending', 'in_progress'].includes(task.status)) {
      return null;
    }
    
    // Определяем этап на основе состояния задачи и данных
    if (task.status === 'pending') {
      return 'analyze'; // Анализ задачи
    }
    
    if (task.status === 'in_progress') {
      // Проверяем, есть ли декомпозиция на подзадачи
      // В реальном приложении тут был бы более сложный механизм определения этапа
      return task.has_subtasks ? 'generate_code' : 'decompose';
    }
    
    return null;
  }

  /**
   * Добавляет задачу в очередь ИИ-ассистента
   * @param {number} taskId - ID задачи
   * @param {string} initialStep - Начальный шаг обработки
   * @param {number} priority - Приоритет (1-3)
   * @returns {Promise<boolean>} - Успешно ли добавлена задача
   */
  async addTask(taskId, initialStep = 'analyze', priority = 2) {
    try {
      // Проверяем существование задачи
      const connection = await pool.getConnection();
      
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        logger.warn(`Задача #${taskId} не найдена при добавлении в AITaskPlanner`);
        return false;
      }
      
      // Проверяем, что задача еще не в очереди
      const existingTask = this.taskQueue.find(t => t.taskId === taskId);
      if (existingTask) {
        logger.warn(`Задача #${taskId} уже находится в очереди AITaskPlanner`);
        return false;
      }
      
      // Добавляем задачу в очередь
      this.taskQueue.push({
        taskId,
        step: initialStep,
        priority,
        added: new Date()
      });
      
      logger.info(`Задача #${taskId} добавлена в очередь AITaskPlanner с шагом ${initialStep}`);
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при добавлении задачи #${taskId} в AITaskPlanner:`, error);
      return false;
    }
  }

  /**
   * Обрабатывает следующую задачу из очереди
   * @returns {Promise<void>}
   * @private
   */
  async processNextTask() {
    if (!this.running || this.taskQueue.length === 0) {
      return;
    }
    
    try {
      // Сортируем задачи по приоритету и времени добавления
      this.taskQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // По убыванию приоритета
        }
        return a.added - b.added; // По возрастанию времени (FIFO)
      });
      
      // Берем задачу с наивысшим приоритетом
      const task = this.taskQueue.shift();
      
      logger.info(`Обработка задачи #${task.taskId}, шаг: ${task.step}`);
      
      // Обрабатываем задачу в зависимости от шага
      let success = false;
      
      switch (task.step) {
        case 'analyze':
          success = await this.analyzeTask(task.taskId);
          break;
        
        case 'decompose':
          success = await this.decomposeTask(task.taskId);
          break;
        
        case 'generate_code':
          success = await this.generateCode(task.taskId);
          break;
        
        case 'review_code':
          success = await this.reviewCode(task.taskId);
          break;
        
        case 'create_pr':
          success = await this.createPullRequest(task.taskId);
          break;
        
        default:
          logger.warn(`Неизвестный шаг обработки: ${task.step} для задачи #${task.taskId}`);
      }
      
      // Если обработка не удалась, возвращаем задачу в очередь с задержкой
      if (!success) {
        logger.warn(`Не удалось обработать задачу #${task.taskId} на шаге ${task.step}`);
        
        // Уменьшаем приоритет задачи и возвращаем в конец очереди
        this.taskQueue.push({
          ...task,
          priority: Math.max(1, task.priority - 1),
          added: new Date() // Сбрасываем время добавления
        });
      }
    } catch (error) {
      logger.error('Ошибка при обработке задачи из очереди AITaskPlanner:', error);
    }
  }

  /**
   * Анализирует задачу
   * @param {number} taskId - ID задачи
   * @returns {Promise<boolean>} - Успешно ли выполнен шаг
   * @private
   */
  async analyzeTask(taskId) {
    try {
      logger.info(`Анализ задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начат анализ задачи ИИ-ассистентом');
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        logger.warn(`Задача #${taskId} не найдена при анализе`);
        return false;
      }
      
      const task = tasks[0];
      
      // Обновляем статус задачи
      await connection.query(
        "UPDATE tasks SET status = 'in_progress', updated_at = NOW() WHERE id = ?",
        [taskId]
      );
      
      connection.release();
      
      // Логируем изменение статуса
      await taskLogger.logInfo(taskId, 'Задача взята в работу ИИ-ассистентом');
      
      // Добавляем задачу в очередь для декомпозиции
      this.taskQueue.push({
        taskId,
        step: 'decompose',
        priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
        added: new Date()
      });
      
      logger.info(`Задача #${taskId} успешно проанализирована`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при анализе задачи #${taskId}:`, error);
      return false;
    }
  }

  /**
   * Декомпозирует задачу на подзадачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<boolean>} - Успешно ли выполнен шаг
   * @private
   */
  async decomposeTask(taskId) {
    try {
      logger.info(`Декомпозиция задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начата декомпозиция задачи на подзадачи');
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        logger.warn(`Задача #${taskId} не найдена при декомпозиции`);
        return false;
      }
      
      const task = tasks[0];
      
      connection.release();
      
      // Создаем экземпляр декомпозера
      const taskDecomposer = new TaskDecomposer(task.project_id);
      
      // Декомпозируем задачу
      const subtasks = await taskDecomposer.decomposeTask(taskId);
      
      if (!subtasks || subtasks.length === 0) {
        await taskLogger.logWarning(taskId, 'Не удалось декомпозировать задачу на подзадачи');
        return false;
      }
      
      // Обновляем флаг наличия подзадач
      await connection.query(
        "UPDATE tasks SET has_subtasks = 1, updated_at = NOW() WHERE id = ?",
        [taskId]
      );
      
      // Логируем успешную декомпозицию
      await taskLogger.logInfo(taskId, `Задача успешно декомпозирована на ${subtasks.length} подзадач`);
      
      // Добавляем задачу в очередь для генерации кода
      this.taskQueue.push({
        taskId,
        step: 'generate_code',
        priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
        added: new Date()
      });
      
      logger.info(`Задача #${taskId} успешно декомпозирована на ${subtasks.length} подзадач`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при декомпозиции задачи #${taskId}:`, error);
      return false;
    }
  }

  /**
   * Генерирует код для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<boolean>} - Успешно ли выполнен шаг
   * @private
   */
  async generateCode(taskId) {
    try {
      logger.info(`Генерация кода для задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начата генерация кода');
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        logger.warn(`Задача #${taskId} не найдена при генерации кода`);
        return false;
      }
      
      const task = tasks[0];
      
      // Получаем подзадачи
      const [subtasks] = await connection.query(
        'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sequence_number',
        [taskId]
      );
      
      // Получаем информацию о проекте
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [task.project_id]
      );
      
      if (projects.length === 0) {
        connection.release();
        logger.warn(`Проект #${task.project_id} не найден при генерации кода`);
        return false;
      }
      
      const project = projects[0];
      
      connection.release();
      
      // Инициализируем генератор кода
      const codeGenerator = new CodeGenerator(task.project_id);
      
      // Определяем файлы, которые нужно создать/изменить
      let filesToGenerate = [];
      
      // В простом случае, каждая подзадача = один файл
      // В реальном приложении здесь была бы более сложная логика определения файлов
      for (const subtask of subtasks) {
        if (subtask.status !== 'completed') {
          // Извлекаем путь к файлу из названия или описания подзадачи
          // Это простой пример - в реальном приложении логика была бы сложнее
          const filePathMatch = subtask.description.match(/файл:\s*([^\s]+)/i);
          
          if (filePathMatch && filePathMatch[1]) {
            filesToGenerate.push({
              subtaskId: subtask.id,
              filePath: filePathMatch[1],
              description: subtask.description
            });
          } else {
            // Если путь не указан явно, создаем на основе имени подзадачи
            const inferredPath = this.inferFilePath(subtask.title, project.repository_path);
            
            filesToGenerate.push({
              subtaskId: subtask.id,
              filePath: inferredPath,
              description: subtask.description
            });
          }
        }
      }
      
      // Генерируем код для каждого файла
      const generations = [];
      
      for (const file of filesToGenerate) {
        const result = await codeGenerator.generateFile(
          taskId, 
          file.subtaskId, 
          file.filePath, 
          file.description
        );
        
        if (result && result.generationId) {
          generations.push({
            ...result,
            subtaskId: file.subtaskId,
            filePath: file.filePath
          });
        }
      }
      
      if (generations.length === 0) {
        await taskLogger.logWarning(taskId, 'Не удалось сгенерировать код ни для одного файла');
        return false;
      }
      
      // Логируем успешную генерацию
      await taskLogger.logInfo(taskId, `Успешно сгенерирован код для ${generations.length} файлов`);
      
      // Добавляем задачу в очередь для проверки кода
      this.taskQueue.push({
        taskId,
        step: 'review_code',
        priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
        added: new Date(),
        generationIds: generations.map(g => g.generationId)
      });
      
      logger.info(`Код успешно сгенерирован для задачи #${taskId}`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при генерации кода для задачи #${taskId}:`, error);
      return false;
    }
  }

  /**
   * Проверяет сгенерированный код
   * @param {number} taskId - ID задачи
   * @param {Array<number>} generationIds - ID сгенерированного кода
   * @returns {Promise<boolean>} - Успешно ли выполнен шаг
   * @private
   */
  async reviewCode(taskId, generationIds = []) {
    try {
      logger.info(`Проверка кода для задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начата самопроверка кода ИИ-ассистентом');
      
      const connection = await pool.getConnection();
      
      // Получаем ID генераций, если не переданы
      if (!generationIds || generationIds.length === 0) {
        const [generations] = await connection.query(
          'SELECT id FROM code_generations WHERE task_id = ? ORDER BY created_at DESC',
          [taskId]
        );
        
        generationIds = generations.map(g => g.id);
      }
      
      if (generationIds.length === 0) {
        connection.release();
        logger.warn(`Не найдены генерации кода для задачи #${taskId}`);
        return false;
      }
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        logger.warn(`Задача #${taskId} не найдена при проверке кода`);
        return false;
      }
      
      const task = tasks[0];
      
      connection.release();
      
      // Проверяем каждую генерацию кода
      let allReviewsSuccessful = true;
      let allPassedReview = true;
      
      for (const generationId of generationIds) {
        // Получаем информацию о генерации
        const [generations] = await connection.query(
          'SELECT * FROM code_generations WHERE id = ?',
          [generationId]
        );
        
        if (generations.length === 0) {
          continue;
        }
        
        const generation = generations[0];
        
        // Запрашиваем проверку кода
        const codeReviewController = require('../controller/code-review/code-review.controller');
        
        const reviewResult = await codeReviewController._createCodeReviewPrompt(
          generation.generated_content,
          generation.language,
          generation.file_path
        );
        
        // Обновляем статус генерации на основе результатов проверки
        if (reviewResult && reviewResult.score) {
          await connection.query(
            `UPDATE code_generations 
             SET status = ?, feedback = ?, updated_at = NOW() 
             WHERE id = ?`,
            [
              reviewResult.score >= 7 ? 'approved' : 'needs_improvement',
              JSON.stringify(reviewResult),
              generationId
            ]
          );
          
          // Если оценка низкая, помечаем, что не все проверки прошли успешно
          if (reviewResult.score < 7) {
            allPassedReview = false;
          }
        } else {
          allReviewsSuccessful = false;
        }
      }
      
      // Логируем результаты проверки
      if (!allReviewsSuccessful) {
        await taskLogger.logWarning(taskId, 'Не удалось выполнить проверку кода для некоторых файлов');
      } else if (!allPassedReview) {
        await taskLogger.logWarning(taskId, 'Некоторые файлы не прошли проверку качества кода');
        
        // Возвращаемся к шагу генерации кода для исправления
        this.taskQueue.push({
          taskId,
          step: 'generate_code',
          priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
          added: new Date()
        });
        
        return true;
      } else {
        await taskLogger.logInfo(taskId, 'Весь код успешно прошел проверку качества');
        
        // Добавляем задачу в очередь для создания PR
        this.taskQueue.push({
          taskId,
          step: 'create_pr',
          priority: task.priority === 'high' ? 3 : (task.priority === 'medium' ? 2 : 1),
          added: new Date()
        });
      }
      
      logger.info(`Код для задачи #${taskId} успешно проверен`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при проверке кода для задачи #${taskId}:`, error);
      return false;
    }
  }

  /**
   * Создает Pull Request для задачи
   * @param {number} taskId - ID задачи
   * @returns {Promise<boolean>} - Успешно ли выполнен шаг
   * @private
   */
  async createPullRequest(taskId) {
    try {
      logger.info(`Создание Pull Request для задачи #${taskId}`);
      await taskLogger.logInfo(taskId, 'Начато создание Pull Request');
      
      const connection = await pool.getConnection();
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT t.*, p.repository_path, p.repository_url FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.id = ?',
        [taskId]
      );
      
      if (tasks.length === 0) {
        connection.release();
        logger.warn(`Задача #${taskId} не найдена при создании PR`);
        return false;
      }
      
      const task = tasks[0];
      
      // Получаем сгенерированный код
      const [generations] = await connection.query(
        "SELECT * FROM code_generations WHERE task_id = ? AND status = 'approved'",
        [taskId]
      );
      
      if (generations.length === 0) {
        connection.release();
        logger.warn(`Не найден одобренный код для задачи #${taskId}`);
        return false;
      }
      
      connection.release();
      
      // Проверяем, настроен ли Git для задачи
      if (!task.git_branch) {
        // Создаем ветку для задачи
        const gitController = require('../controller/git-integration/git-controller');
        await gitController.createTaskBranch({
          params: { taskId }
        }, {
          json: () => {}
        });
      }
      
      // Инициализируем Git клиент
      const gitClient = new GitClient(task.repository_path);
      
      // Переключаемся на ветку задачи
      await gitClient.checkout(task.git_branch);
      
      // Создаем список изменений для коммита
      const changes = generations.map(generation => ({
        path: generation.file_path,
        content: generation.generated_content
      }));
      
      // Создаем коммит со всеми изменениями
      const commitMessage = `AI: Implement ${task.title}`;
      await gitClient.createTaskCommit(taskId, commitMessage, changes.map(c => c.path));
      
      // Отправляем изменения в репозиторий
      await gitClient.push('origin', task.git_branch);
      
      // Создаем Pull Request
      const prDescription = `
Автоматически созданный Pull Request для задачи #${taskId}

## Описание
${task.description}

## Изменения
${generations.map(g => `- ${g.file_path}`).join('\n')}

## Примечание
Этот PR был создан ИИ-ассистентом и требует проверки человеком.
      `;
      
      const prResult = await gitClient.createPullRequest({
        title: `AI: ${task.title}`,
        description: prDescription,
        sourceBranch: task.git_branch,
        targetBranch: 'main' // В реальном приложении это может быть настраиваемым
      });
      
      // Обновляем статус задачи
      await connection.query(
        "UPDATE tasks SET pull_request_url = ?, status = 'completed', updated_at = NOW(), completed_at = NOW() WHERE id = ?",
        [prResult.url, taskId]
      );
      
      // Записываем информацию о Pull Request
      await connection.query(
        'INSERT INTO task_pull_requests (task_id, pr_url, title, created_at) VALUES (?, ?, ?, NOW())',
        [taskId, prResult.url, `AI: ${task.title}`]
      );
      
      // Логируем успешное создание PR
      await taskLogger.logInfo(taskId, `Создан Pull Request: ${prResult.url}`);
      
      logger.info(`Pull Request успешно создан для задачи #${taskId}`);
      return true;
    } catch (error) {
      logger.error(`Ошибка при создании Pull Request для задачи #${taskId}:`, error);
      return false;
    }
  }

  /**
   * Вывести предполагаемый путь к файлу на основе названия подзадачи
   * @param {string} subtaskTitle - Название подзадачи
   * @param {string} repositoryPath - Путь к репозиторию
   * @returns {string} - Предполагаемый путь к файлу
   * @private
   */
  inferFilePath(subtaskTitle, repositoryPath) {
    // Простой алгоритм для определения пути к файлу на основе названия подзадачи
    // В реальном приложении здесь была бы более сложная логика
    
    // Удаляем ненужные символы и преобразуем в snake_case
    const fileName = subtaskTitle
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_');
    
    // Определяем расширение файла на основе слов в заголовке
    let extension = '.js'; // По умолчанию
    
    if (subtaskTitle.includes('Component') || subtaskTitle.includes('React')) {
      extension = '.jsx';
    } else if (subtaskTitle.includes('Style') || subtaskTitle.includes('CSS')) {
      extension = '.css';
    } else if (subtaskTitle.includes('Model') || subtaskTitle.includes('Database')) {
      extension = '.js'; // Модель данных
    } else if (subtaskTitle.includes('Controller') || subtaskTitle.includes('API')) {
      extension = '.js'; // Контроллер API
    } else if (subtaskTitle.includes('Test') || subtaskTitle.includes('Spec')) {
      extension = '.test.js'; // Тесты
    }
    
    // Определяем директорию на основе слов в заголовке
    let directory = 'src';
    
    if (subtaskTitle.includes('Component') || subtaskTitle.includes('React')) {
      directory += '/components';
    } else if (subtaskTitle.includes('Controller') || subtaskTitle.includes('API')) {
      directory += '/controllers';
    } else if (subtaskTitle.includes('Model') || subtaskTitle.includes('Database')) {
      directory += '/models';
    } else if (subtaskTitle.includes('Util') || subtaskTitle.includes('Helper')) {
      directory += '/utils';
    } else if (subtaskTitle.includes('Test') || subtaskTitle.includes('Spec')) {
      directory += '/tests';
    }
    
    return `${directory}/${fileName}${extension}`;
  }
}

// Создаем синглтон экземпляр для использования во всем приложении
const aiTaskPlanner = new AITaskPlanner();

module.exports = aiTaskPlanner;
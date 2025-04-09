/**
 * @fileoverview Исполнитель шага "Анализ контекста проекта" (Project Understanding).
 * Анализирует структуру проекта, код, зависимости и архитектуру для понимания
 * контекста, в котором должна быть выполнена задача.
 */

const { StepExecutor } = require('../step-executor');
const logger = require('../../../utils/logger');
const { ProjectUnderstandingResultSchema, StepInputSchema } = require('../contracts');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const glob = promisify(require('glob'));

/**
 * Исполнитель шага "Анализ контекста проекта".
 * @extends StepExecutor
 */
class ProjectUnderstandingExecutor extends StepExecutor {
  /**
   * Получает метаданные шага.
   * @returns {Object} - Метаданные шага.
   */
  getMetadata() {
    return {
      name: 'projectUnderstanding',
      description: 'Analyzes project structure, code, dependencies and architecture',
      timeout: 180000, // 3 минуты
      maxRetries: 2,
      requiresLLM: true,
      requiresGit: true,
      requiresExecution: false,
      inputSchema: StepInputSchema,
      outputSchema: ProjectUnderstandingResultSchema
    };
  }

  /**
   * Выполняет шаг "Анализ контекста проекта".
   * @param {string} taskId - Идентификатор задачи.
   * @param {Object} input - Входные данные для шага.
   * @param {Object} context - Контекст задачи.
   * @returns {Promise<Object>} - Результат выполнения шага.
   */
  async execute(taskId, input, context) {
    const startTime = Date.now();
    
    // Логируем начало выполнения шага
    this.logStepStart(taskId, input);
    
    try {
      // Валидируем входные данные
      const validationResult = this.validateInput(input);
      if (!validationResult.valid) {
        const error = `Invalid input: ${validationResult.errors.join(', ')}`;
        logger.error(`Step projectUnderstanding for task ${taskId} failed:`, error);
        
        return this.prepareBaseResult(false, error);
      }
      
      // Отправляем уведомление о начале анализа проекта
      await this.sendProgressNotification(
        taskId,
        10,
        'Starting project analysis'
      );
      
      // Получаем информацию о проекте
      const projectId = input.projectId;
      
      // Если проект не указан, возвращаем ошибку
      if (!projectId) {
        const error = 'Project ID is not specified';
        logger.error(`Step projectUnderstanding for task ${taskId} failed:`, error);
        
        return this.prepareBaseResult(false, error);
      }
      
      // Получаем информацию о проекте из БД
      const project = await this._getProjectInfo(projectId);
      
      // Если проект не найден, возвращаем ошибку
      if (!project) {
        const error = `Project with ID ${projectId} not found`;
        logger.error(`Step projectUnderstanding for task ${taskId} failed:`, error);
        
        return this.prepareBaseResult(false, error);
      }
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        20,
        'Analyzing project structure'
      );
      
      // Анализируем структуру проекта
      const projectStructure = await this._analyzeProjectStructure(project);
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        40,
        'Analyzing project dependencies'
      );
      
      // Анализируем зависимости проекта
      const dependencies = await this._analyzeProjectDependencies(project);
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        60,
        'Analyzing project architecture'
      );
      
      // Анализируем архитектуру проекта
      const architecture = await this._analyzeProjectArchitecture(
        project, 
        projectStructure, 
        dependencies
      );
      
      // Отправляем уведомление о прогрессе
      await this.sendProgressNotification(
        taskId,
        80,
        'Identifying relevant files for the task'
      );
      
      // Идентифицируем файлы, относящиеся к задаче
      const relevantFiles = await this._identifyRelevantFiles(
        project, 
        projectStructure, 
        input.taskUnderstanding
      );
      
      // Подготавливаем результат
      const result = {
        ...this.prepareBaseResult(true),
        projectStructure,
        dependencies,
        architecture,
        relevantFiles,
        summary: {
          projectName: project.name,
          codebaseSize: projectStructure.codebaseSize,
          mainLanguages: projectStructure.mainLanguages,
          relevantFiles: relevantFiles.length
        }
      };
      
      // Валидируем результат
      const outputValidation = this.validateOutput(result);
      if (!outputValidation.valid) {
        const warning = `Output validation warnings: ${outputValidation.errors.join(', ')}`;
        logger.warn(`Step projectUnderstanding for task ${taskId} output validation:`, warning);
        
        result.warnings = result.warnings || [];
        result.warnings.push(warning);
      }
      
      // Добавляем длительность выполнения
      result.duration = Date.now() - startTime;
      
      // Логируем завершение выполнения шага
      this.logStepCompletion(taskId, result, result.duration);
      
      return result;
    } catch (error) {
      logger.error(`Step projectUnderstanding for task ${taskId} failed:`, error);
      
      const result = this.prepareBaseResult(false, error.message);
      result.duration = Date.now() - startTime;
      
      return result;
    }
  }

  /**
   * Получает информацию о проекте из БД.
   * @private
   * @param {string} projectId - Идентификатор проекта.
   * @returns {Promise<Object|null>} - Информация о проекте или null, если проект не найден.
   */
  async _getProjectInfo(projectId) {
    logger.debug(`Getting project info for project ${projectId}`);
    
    try {
      // Если БД недоступна, возвращаем мок для тестирования
      if (!this.db) {
        logger.warn('Database not available, using mock project data');
        
        return {
          id: projectId,
          name: 'Mock Project',
          description: 'This is a mock project for testing',
          repositoryUrl: 'https://github.com/example/mock-project',
          localPath: '/path/to/mock-project',
          createdAt: new Date()
        };
      }
      
      // Получаем проект из БД
      const project = await this.db.Project.findByPk(projectId);
      
      if (!project) {
        logger.error(`Project with ID ${projectId} not found`);
        return null;
      }
      
      return project;
    } catch (error) {
      logger.error(`Error getting project info for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Анализирует структуру проекта.
   * @private
   * @param {Object} project - Информация о проекте.
   * @returns {Promise<Object>} - Структура проекта.
   */
  async _analyzeProjectStructure(project) {
    logger.debug(`Analyzing project structure for project ${project.id}`);
    
    try {
      // Получаем локальный путь к проекту
      const projectPath = project.localPath;
      
      // Если локальный путь не указан, используем временный каталог
      if (!projectPath) {
        logger.warn(`Local path not specified for project ${project.id}, using mock data`);
        
        return {
          fileTree: {
            name: project.name,
            type: 'directory',
            children: []
          },
          codebaseSize: 0,
          mainLanguages: []
        };
      }
      
      // Создаем дерево файлов
      const fileTree = await this._createFileTree(projectPath);
      
      // Анализируем языки программирования
      const languageStats = await this._analyzeLanguages(projectPath);
      
      // Вычисляем размер кодовой базы (количество файлов с кодом)
      const codebaseSize = await this._countCodeFiles(projectPath);
      
      // Получаем основные языки программирования
      const mainLanguages = Object.entries(languageStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([language]) => language);
      
      return {
        fileTree,
        codebaseSize,
        mainLanguages,
        languageStats
      };
    } catch (error) {
      logger.error(`Error analyzing project structure for project ${project.id}:`, error);
      
      // Возвращаем базовую структуру в случае ошибки
      return {
        fileTree: {
          name: project.name,
          type: 'directory',
          children: []
        },
        codebaseSize: 0,
        mainLanguages: []
      };
    }
  }

  /**
   * Создает дерево файлов для проекта.
   * @private
   * @param {string} projectPath - Путь к проекту.
   * @returns {Promise<Object>} - Дерево файлов.
   */
  async _createFileTree(projectPath) {
    logger.debug(`Creating file tree for project at ${projectPath}`);
    
    try {
      // Получаем имя каталога проекта
      const projectName = path.basename(projectPath);
      
      // Игнорируемые каталоги и файлы
      const ignoreDirs = [
        'node_modules', '.git', 'dist', 'build', 'target', 'out',
        'bin', 'obj', '.idea', '.vscode', '.next', '.nuxt', '.cache',
        'coverage', 'venv', '__pycache__', 'tmp'
      ];
      
      // Рекурсивная функция для создания дерева
      const buildTree = async (dirPath, depth = 0) => {
        // Ограничиваем глубину дерева для производительности
        if (depth > 5) {
          return {
            name: path.basename(dirPath),
            type: 'directory',
            children: [{ name: '...', type: 'ellipsis' }]
          };
        }
        
        // Получаем список файлов и каталогов
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        // Фильтруем список
        const filteredEntries = entries.filter(entry => {
          return !ignoreDirs.includes(entry.name) && !entry.name.startsWith('.');
        });
        
        // Создаем дерево для каждого элемента
        const children = await Promise.all(
          filteredEntries.map(async entry => {
            const entryPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
              return buildTree(entryPath, depth + 1);
            } else {
              return {
                name: entry.name,
                type: 'file',
                extension: path.extname(entry.name)
              };
            }
          })
        );
        
        return {
          name: path.basename(dirPath),
          type: 'directory',
          children
        };
      };
      
      // Создаем дерево, начиная с корня проекта
      return buildTree(projectPath);
    } catch (error) {
      logger.error(`Error creating file tree for project at ${projectPath}:`, error);
      
      // Возвращаем базовое дерево в случае ошибки
      return {
        name: path.basename(projectPath),
        type: 'directory',
        children: []
      };
    }
  }

  /**
   * Анализирует языки программирования, используемые в проекте.
   * @private
   * @param {string} projectPath - Путь к проекту.
   * @returns {Promise<Object>} - Статистика по языкам программирования.
   */
  async _analyzeLanguages(projectPath) {
    logger.debug(`Analyzing languages for project at ${projectPath}`);
    
    try {
      // Расширения файлов и соответствующие им языки
      const extensions = {
        '.js': 'JavaScript',
        '.jsx': 'JavaScript (React)',
        '.ts': 'TypeScript',
        '.tsx': 'TypeScript (React)',
        '.py': 'Python',
        '.java': 'Java',
        '.rb': 'Ruby',
        '.php': 'PHP',
        '.c': 'C',
        '.cpp': 'C++',
        '.h': 'C/C++ Header',
        '.cs': 'C#',
        '.go': 'Go',
        '.rs': 'Rust',
        '.swift': 'Swift',
        '.kt': 'Kotlin',
        '.scala': 'Scala',
        '.html': 'HTML',
        '.css': 'CSS',
        '.scss': 'SCSS',
        '.less': 'Less',
        '.json': 'JSON',
        '.xml': 'XML',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.md': 'Markdown',
        '.sql': 'SQL',
        '.sh': 'Shell',
        '.bat': 'Batch',
        '.ps1': 'PowerShell'
      };
      
      // Игнорируемые каталоги
      const ignoreDirs = [
        'node_modules', '.git', 'dist', 'build', 'target', 'out',
        'bin', 'obj', '.idea', '.vscode', '.next', '.nuxt', '.cache',
        'coverage', 'venv', '__pycache__', 'tmp'
      ];
      
      // Шаблон для игнорирования каталогов
      const ignorePattern = `{${ignoreDirs.join(',')}}`;
      
      // Получаем все файлы в проекте
      const files = await glob('**/*', {
        cwd: projectPath,
        ignore: ignorePattern,
        nodir: true,
        dot: false
      });
      
      // Считаем файлы по расширениям
      const stats = {};
      
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        const language = extensions[ext] || 'Other';
        
        stats[language] = (stats[language] || 0) + 1;
      });
      
      return stats;
    } catch (error) {
      logger.error(`Error analyzing languages for project at ${projectPath}:`, error);
      
      // Возвращаем пустую статистику в случае ошибки
      return {};
    }
  }

  /**
   * Подсчитывает количество файлов с кодом в проекте.
   * @private
   * @param {string} projectPath - Путь к проекту.
   * @returns {Promise<number>} - Количество файлов с кодом.
   */
  async _countCodeFiles(projectPath) {
    logger.debug(`Counting code files for project at ${projectPath}`);
    
    try {
      // Расширения файлов с кодом
      const codeExtensions = [
        '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.rb', '.php',
        '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.swift', '.kt',
        '.scala', '.html', '.css', '.scss', '.less', '.sql', '.sh',
        '.bat', '.ps1'
      ];
      
      // Игнорируемые каталоги
      const ignoreDirs = [
        'node_modules', '.git', 'dist', 'build', 'target', 'out',
        'bin', 'obj', '.idea', '.vscode', '.next', '.nuxt', '.cache',
        'coverage', 'venv', '__pycache__', 'tmp'
      ];
      
      // Шаблон для игнорирования каталогов
      const ignorePattern = `{${ignoreDirs.join(',')}}`;
      
      // Получаем все файлы в проекте
      const files = await glob('**/*', {
        cwd: projectPath,
        ignore: ignorePattern,
        nodir: true,
        dot: false
      });
      
      // Подсчитываем количество файлов с кодом
      let count = 0;
      
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (codeExtensions.includes(ext)) {
          count++;
        }
      });
      
      return count;
    } catch (error) {
      logger.error(`Error counting code files for project at ${projectPath}:`, error);
      
      return 0;
    }
  }

  /**
   * Анализирует зависимости проекта.
   * @private
   * @param {Object} project - Информация о проекте.
   * @returns {Promise<Object>} - Зависимости проекта.
   */
  async _analyzeProjectDependencies(project) {
    logger.debug(`Analyzing dependencies for project ${project.id}`);
    
    try {
      // Получаем локальный путь к проекту
      const projectPath = project.localPath;
      
      // Если локальный путь не указан, возвращаем пустые зависимости
      if (!projectPath) {
        logger.warn(`Local path not specified for project ${project.id}, using empty dependencies`);
        
        return {
          direct: [],
          dev: []
        };
      }
      
      // Проверяем наличие package.json
      const packageJsonPath = path.join(projectPath, 'package.json');
      let packageJson;
      
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(packageJsonContent);
      } catch (error) {
        logger.debug(`No package.json found or error parsing it: ${error.message}`);
        packageJson = null;
      }
      
      // Проверяем наличие requirements.txt (Python)
      const requirementsPath = path.join(projectPath, 'requirements.txt');
      let pythonDependencies = [];
      
      try {
        const requirementsContent = await fs.readFile(requirementsPath, 'utf-8');
        pythonDependencies = requirementsContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'))
          .map(line => line.split('==')[0]);
      } catch (error) {
        logger.debug(`No requirements.txt found or error parsing it: ${error.message}`);
      }
      
      // Проверяем наличие build.gradle (Java/Kotlin)
      const buildGradlePath = path.join(projectPath, 'build.gradle');
      let gradleDependencies = [];
      
      try {
        const buildGradleContent = await fs.readFile(buildGradlePath, 'utf-8');
        const dependencyRegex = /implementation\s+['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = dependencyRegex.exec(buildGradleContent)) !== null) {
          gradleDependencies.push(match[1]);
        }
      } catch (error) {
        logger.debug(`No build.gradle found or error parsing it: ${error.message}`);
      }
      
      // Проверяем наличие pom.xml (Maven)
      const pomXmlPath = path.join(projectPath, 'pom.xml');
      let mavenDependencies = [];
      
      try {
        const pomXmlContent = await fs.readFile(pomXmlPath, 'utf-8');
        // Простое извлечение зависимостей без полного парсинга XML
        const dependencyRegex = /<artifactId>([^<]+)<\/artifactId>/g;
        let match;
        
        while ((match = dependencyRegex.exec(pomXmlContent)) !== null) {
          mavenDependencies.push(match[1]);
        }
      } catch (error) {
        logger.debug(`No pom.xml found or error parsing it: ${error.message}`);
      }
      
      // Собираем все зависимости
      const directDependencies = [];
      const devDependencies = [];
      
      if (packageJson) {
        if (packageJson.dependencies) {
          directDependencies.push(...Object.keys(packageJson.dependencies));
        }
        
        if (packageJson.devDependencies) {
          devDependencies.push(...Object.keys(packageJson.devDependencies));
        }
      }
      
      directDependencies.push(...pythonDependencies);
      directDependencies.push(...gradleDependencies);
      directDependencies.push(...mavenDependencies);
      
      return {
        direct: directDependencies,
        dev: devDependencies
      };
    } catch (error) {
      logger.error(`Error analyzing dependencies for project ${project.id}:`, error);
      
      return {
        direct: [],
        dev: []
      };
    }
  }

  /**
   * Анализирует архитектуру проекта с помощью LLM.
   * @private
   * @param {Object} project - Информация о проекте.
   * @param {Object} projectStructure - Структура проекта.
   * @param {Object} dependencies - Зависимости проекта.
   * @returns {Promise<Object>} - Архитектура проекта.
   */
  async _analyzeProjectArchitecture(project, projectStructure, dependencies) {
    logger.debug(`Analyzing architecture for project ${project.id}`);
    
    try {
      // Проверяем, доступен ли клиент LLM
      if (!this.llmClient) {
        logger.warn('LLM client not available, using simplified architecture analysis');
        
        return {
          patterns: [],
          components: [],
          relations: []
        };
      }
      
      // Проверяем, доступен ли менеджер промптов
      if (!this.promptManager) {
        logger.warn('Prompt manager not available, using simplified architecture analysis');
        
        return {
          patterns: [],
          components: [],
          relations: []
        };
      }
      
      // Получаем промпт для анализа архитектуры
      const prompt = await this.promptManager.getPrompt('project-architecture-analysis.txt');
      
      if (!prompt) {
        logger.warn('Project architecture analysis prompt not found, using simplified analysis');
        
        return {
          patterns: [],
          components: [],
          relations: []
        };
      }
      
      // Подготавливаем данные для промпта
      const projectData = {
        name: project.name,
        description: project.description,
        mainLanguages: projectStructure.mainLanguages.join(', '),
        directDependencies: dependencies.direct.join(', '),
        devDependencies: dependencies.dev.join(', '),
        fileTree: JSON.stringify(this._simplifyFileTree(projectStructure.fileTree), null, 2)
      };
      
      // Подставляем данные в промпт
      const filledPrompt = prompt
        .replace('{project_name}', projectData.name)
        .replace('{project_description}', projectData.description)
        .replace('{main_languages}', projectData.mainLanguages)
        .replace('{direct_dependencies}', projectData.directDependencies)
        .replace('{dev_dependencies}', projectData.devDependencies)
        .replace('{file_tree}', projectData.fileTree);
      
      // Вызываем LLM для анализа архитектуры
      const response = await this.llmClient.generate({
        prompt: filledPrompt,
        max_tokens: 2000,
        temperature: 0.3,
        responseFormat: 'json'
      });
      
      // Обрабатываем ответ LLM
      let architectureResult;
      
      try {
        // Пытаемся распарсить JSON из ответа
        if (typeof response === 'string') {
          architectureResult = JSON.parse(response);
        } else if (response.text) {
          architectureResult = JSON.parse(response.text);
        } else if (response.choices && response.choices[0] && response.choices[0].text) {
          architectureResult = JSON.parse(response.choices[0].text);
        } else {
          throw new Error('Unexpected LLM response format');
        }
      } catch (parseError) {
        logger.error('Error parsing LLM response:', parseError);
        
        // Если не удалось распарсить JSON, возвращаем базовую структуру
        return {
          patterns: [],
          components: [],
          relations: []
        };
      }
      
      // Проверяем, что все необходимые поля присутствуют
      if (!architectureResult.patterns) {
        architectureResult.patterns = [];
      }
      
      if (!architectureResult.components) {
        architectureResult.components = [];
      }
      
      if (!architectureResult.relations) {
        architectureResult.relations = [];
      }
      
      return architectureResult;
    } catch (error) {
      logger.error(`Error analyzing architecture for project ${project.id}:`, error);
      
      // Возвращаем базовую структуру в случае ошибки
      return {
        patterns: [],
        components: [],
        relations: []
      };
    }
  }

  /**
   * Упрощает дерево файлов для подачи в LLM.
   * @private
   * @param {Object} fileTree - Дерево файлов.
   * @returns {Object} - Упрощенное дерево файлов.
   */
  _simplifyFileTree(fileTree) {
    // Максимальная глубина для упрощенного дерева
    const maxDepth = 3;
    
    // Рекурсивная функция для упрощения дерева
    const simplify = (node, depth = 0) => {
      if (depth >= maxDepth) {
        return { name: node.name, type: 'directory', children: ['...'] };
      }
      
      if (node.type === 'file') {
        return { name: node.name, type: 'file' };
      }
      
      // Упрощаем дочерние элементы
      const children = Array.isArray(node.children) ? node.children.map(child => {
        return simplify(child, depth + 1);
      }) : [];
      
      return {
        name: node.name,
        type: 'directory',
        children
      };
    };
    
    return simplify(fileTree);
  }

  /**
   * Идентифицирует файлы, относящиеся к задаче.
   * @private
   * @param {Object} project - Информация о проекте.
   * @param {Object} projectStructure - Структура проекта.
   * @param {Object} taskUnderstanding - Результат анализа задачи.
   * @returns {Promise<Array>} - Список релевантных файлов.
   */
  async _identifyRelevantFiles(project, projectStructure, taskUnderstanding) {
    logger.debug(`Identifying relevant files for project ${project.id}`);
    
    try {
      // Проверяем, доступен ли клиент LLM
      if (!this.llmClient) {
        logger.warn('LLM client not available, unable to identify relevant files');
        return [];
      }
      
      // Проверяем, доступен ли менеджер промптов
      if (!this.promptManager) {
        logger.warn('Prompt manager not available, unable to identify relevant files');
        return [];
      }
      
      // Получаем промпт для идентификации релевантных файлов
      const prompt = await this.promptManager.getPrompt('relevant-files-identification.txt');
      
      if (!prompt) {
        logger.warn('Relevant files identification prompt not found');
        return [];
      }
      
      // Подготавливаем данные для промпта
      const taskData = {
        type: taskUnderstanding.taskType || 'Unknown',
        description: taskUnderstanding.taskDescription || '',
        requirements: Array.isArray(taskUnderstanding.requirements) 
          ? taskUnderstanding.requirements.join(', ') 
          : ''
      };
      
      const projectData = {
        name: project.name,
        description: project.description,
        mainLanguages: projectStructure.mainLanguages.join(', '),
        fileTree: JSON.stringify(this._simplifyFileTree(projectStructure.fileTree), null, 2)
      };
      
      // Подставляем данные в промпт
      const filledPrompt = prompt
        .replace('{project_name}', projectData.name)
        .replace('{project_description}', projectData.description)
        .replace('{main_languages}', projectData.mainLanguages)
        .replace('{file_tree}', projectData.fileTree)
        .replace('{task_type}', taskData.type)
        .replace('{task_description}', taskData.description)
        .replace('{task_requirements}', taskData.requirements);
      
      // Вызываем LLM для идентификации релевантных файлов
      const response = await this.llmClient.generate({
        prompt: filledPrompt,
        max_tokens: 1000,
        temperature: 0.2,
        responseFormat: 'json'
      });
      
      // Обрабатываем ответ LLM
      let relevantFiles;
      
      try {
        // Пытаемся распарсить JSON из ответа
        if (typeof response === 'string') {
          relevantFiles = JSON.parse(response);
        } else if (response.text) {
          relevantFiles = JSON.parse(response.text);
        } else if (response.choices && response.choices[0] && response.choices[0].text) {
          relevantFiles = JSON.parse(response.choices[0].text);
        } else {
          throw new Error('Unexpected LLM response format');
        }
      } catch (parseError) {
        logger.error('Error parsing LLM response:', parseError);
        return [];
      }
      
      // Проверяем, что результат - массив
      if (!Array.isArray(relevantFiles)) {
        if (relevantFiles.relevantFiles && Array.isArray(relevantFiles.relevantFiles)) {
          relevantFiles = relevantFiles.relevantFiles;
        } else {
          logger.error('Invalid LLM response format for relevant files');
          return [];
        }
      }
      
      // Для каждого релевантного файла пытаемся получить его содержимое
      const relevantFilesWithContent = await Promise.all(
        relevantFiles.map(async file => {
          try {
            // Если файл уже содержит путь и причину, просто добавляем содержимое
            if (typeof file === 'object' && file.path) {
              const filePath = path.join(project.localPath, file.path);
              let content = '';
              
              try {
                content = await fs.readFile(filePath, 'utf-8');
              } catch (readError) {
                logger.warn(`Error reading file ${filePath}:`, readError);
              }
              
              return {
                path: file.path,
                reason: file.reason || 'Relevant to the task',
                content
              };
            }
            
            // Если файл - это строка (путь), добавляем содержимое и причину
            const filePath = path.join(project.localPath, file);
            let content = '';
            
            try {
              content = await fs.readFile(filePath, 'utf-8');
            } catch (readError) {
              logger.warn(`Error reading file ${filePath}:`, readError);
            }
            
            return {
              path: file,
              reason: 'Relevant to the task',
              content
            };
          } catch (error) {
            logger.warn(`Error processing relevant file ${file}:`, error);
            
            return {
              path: typeof file === 'object' ? file.path : file,
              reason: typeof file === 'object' ? file.reason : 'Relevant to the task',
              content: '',
              error: error.message
            };
          }
        })
      );
      
      // Фильтруем файлы без содержимого
      return relevantFilesWithContent.filter(file => file.content !== '');
    } catch (error) {
      logger.error(`Error identifying relevant files for project ${project.id}:`, error);
      return [];
    }
  }
}

module.exports = ProjectUnderstandingExecutor;
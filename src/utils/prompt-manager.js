/**
 * Менеджер промптов для LLM
 * Загружает, кэширует и управляет шаблонами промптов
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('./logger');
const config = require('../config/llm.config');
const { pool } = require('../config/db.config');

// Промисифицированное чтение файлов
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class PromptManager {
  /**
   * Создает экземпляр PromptManager
   */
  constructor() {
    // Пути к шаблонам
    this.templatesPath = config.templates?.path || path.join(process.cwd(), 'templates', 'prompts');
    this.customTemplatesPath = config.templates?.customPath || path.join(process.cwd(), 'templates', 'custom');
    
    // Кэш шаблонов
    this.templates = {};
    
    // Переменные окружения для подстановки
    this.globalVariables = {};
    
    // Флаг инициализации
    this.initialized = false;
    
    // Настройки формата шаблонов
    this.variablePattern = /\{\{([^}]+)\}\}/g;
    
    logger.debug('PromptManager создан');
  }

  /**
   * Инициализирует менеджер промптов, загружая все шаблоны
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Проверяем существование директорий
      await this._ensureDirectoriesExist();
      
      // Загружаем системные шаблоны
      await this._loadTemplatesFromDirectory(this.templatesPath);
      
      // Загружаем пользовательские шаблоны
      await this._loadTemplatesFromDirectory(this.customTemplatesPath);
      
      // Загружаем шаблоны из базы данных, если она доступна
      await this._loadTemplatesFromDatabase();
      
      // Загружаем глобальные переменные
      await this._loadGlobalVariables();
      
      this.initialized = true;
      logger.info(`PromptManager инициализирован. Загружено ${Object.keys(this.templates).length} шаблонов`);
    } catch (error) {
      logger.error('Ошибка при инициализации PromptManager:', error);
      throw error;
    }
  }

  /**
   * Проверяет и создает необходимые директории
   * @private
   */
  async _ensureDirectoriesExist() {
    try {
      // Проверяем директорию шаблонов
      if (!fs.existsSync(this.templatesPath)) {
        await mkdir(this.templatesPath, { recursive: true });
        logger.info(`Создана директория шаблонов: ${this.templatesPath}`);
      }
      
      // Проверяем директорию пользовательских шаблонов
      if (!fs.existsSync(this.customTemplatesPath)) {
        await mkdir(this.customTemplatesPath, { recursive: true });
        logger.info(`Создана директория пользовательских шаблонов: ${this.customTemplatesPath}`);
      }
    } catch (error) {
      logger.error('Ошибка при создании директорий шаблонов:', error);
      throw error;
    }
  }

  /**
   * Загружает шаблоны из указанной директории
   * @param {string} directory - Путь к директории
   * @private
   */
  async _loadTemplatesFromDirectory(directory) {
    try {
      if (!fs.existsSync(directory)) {
        logger.warn(`Директория шаблонов не существует: ${directory}`);
        return;
      }
      
      const files = await readdir(directory);
      let templatesCount = 0;
      
      // Итерируем по файлам и поддиректориям
      for (const file of files) {
        const filePath = path.join(directory, file);
        const fileStat = await stat(filePath);
        
        if (fileStat.isDirectory()) {
          // Рекурсивно загружаем шаблоны из поддиректории
          await this._loadTemplatesFromDirectory(filePath);
        } else if (file.endsWith('.txt') || file.endsWith('.md') || file.endsWith('.prompt')) {
          // Загружаем шаблон из файла
          const templateName = this._getTemplateName(directory, file);
          const templateContent = await readFile(filePath, 'utf8');
          
          this.templates[templateName] = {
            content: templateContent,
            path: filePath,
            source: 'file'
          };
          
          templatesCount++;
        }
      }
      
      logger.debug(`Загружено ${templatesCount} шаблонов из директории: ${directory}`);
    } catch (error) {
      logger.error(`Ошибка при загрузке шаблонов из директории: ${directory}`, error);
      throw error;
    }
  }

  /**
   * Загружает шаблоны из базы данных
   * @private
   */
  async _loadTemplatesFromDatabase() {
    try {
      const connection = await pool.getConnection();
      
      // Проверяем существование таблицы шаблонов
      const [tables] = await connection.query(
        "SHOW TABLES LIKE 'llm_templates'"
      );
      
      if (tables.length === 0) {
        logger.debug('Таблица llm_templates не существует. Шаблоны из базы данных не загружены.');
        connection.release();
        return;
      }
      
      // Загружаем шаблоны из базы данных
      const [rows] = await connection.query(
        'SELECT name, content, category FROM llm_templates WHERE active = 1'
      );
      
      connection.release();
      
      if (rows.length === 0) {
        logger.debug('Шаблоны в базе данных не найдены.');
        return;
      }
      
      // Добавляем шаблоны в кэш
      for (const row of rows) {
        // Категория добавляется как префикс к имени шаблона
        const templateName = row.category 
          ? `${row.category}/${row.name}` 
          : row.name;
        
        this.templates[templateName] = {
          content: row.content,
          source: 'database',
          category: row.category || 'default'
        };
      }
      
      logger.debug(`Загружено ${rows.length} шаблонов из базы данных`);
    } catch (error) {
      logger.error('Ошибка при загрузке шаблонов из базы данных:', error);
      // Просто логируем ошибку, но не прерываем инициализацию
    }
  }

  /**
   * Загружает глобальные переменные для подстановки в промпты
   * @private
   */
  async _loadGlobalVariables() {
    // Загружаем стандартные переменные окружения
    this.globalVariables = {
      APP_NAME: config.appName || 'BIZ360 AI',
      APP_VERSION: config.appVersion || '1.0.0',
      CURRENT_DATE: new Date().toISOString().split('T')[0],
      CURRENT_TIME: new Date().toTimeString().split(' ')[0]
    };
    
    // Загружаем пользовательские переменные из конфигурации
    if (config.templates?.variables) {
      this.globalVariables = {
        ...this.globalVariables,
        ...config.templates.variables
      };
    }
    
    // Загружаем переменные из базы данных, если она доступна
    try {
      const connection = await pool.getConnection();
      
      // Проверяем существование таблицы переменных
      const [tables] = await connection.query(
        "SHOW TABLES LIKE 'llm_template_variables'"
      );
      
      if (tables.length > 0) {
        const [rows] = await connection.query(
          'SELECT name, value FROM llm_template_variables WHERE active = 1'
        );
        
        for (const row of rows) {
          this.globalVariables[row.name] = row.value;
        }
        
        logger.debug(`Загружено ${rows.length} переменных из базы данных`);
      }
      
      connection.release();
    } catch (error) {
      logger.error('Ошибка при загрузке переменных из базы данных:', error);
      // Просто логируем ошибку, но не прерываем инициализацию
    }
  }

  /**
   * Формирует имя шаблона из пути к файлу
   * @param {string} directory - Путь к директории
   * @param {string} file - Имя файла
   * @returns {string} Имя шаблона
   * @private
   */
  _getTemplateName(directory, file) {
    // Удаляем расширение файла
    const nameWithoutExt = file.replace(/\.(txt|md|prompt)$/, '');
    
    // Если это корневая директория шаблонов, просто возвращаем имя файла
    if (directory === this.templatesPath || directory === this.customTemplatesPath) {
      return nameWithoutExt;
    }
    
    // Иначе включаем путь относительно корневой директории
    const relativePath = path.relative(
      directory.startsWith(this.customTemplatesPath) ? this.customTemplatesPath : this.templatesPath,
      directory
    );
    
    return path.join(relativePath, nameWithoutExt).replace(/\\/g, '/');
  }

  /**
   * Загружает шаблон по имени
   * @param {string} templateName - Имя шаблона
   * @returns {Promise<string>} Содержимое шаблона
   * @private
   */
  async _loadTemplate(templateName) {
    // Проверяем инициализацию
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Проверяем кэш
    if (this.templates[templateName]) {
      return this.templates[templateName].content;
    }
    
    // Если шаблон не найден в кэше, пытаемся загрузить его из файловой системы
    const possiblePaths = [
      path.join(this.templatesPath, `${templateName}.txt`),
      path.join(this.templatesPath, `${templateName}.md`),
      path.join(this.templatesPath, `${templateName}.prompt`),
      path.join(this.customTemplatesPath, `${templateName}.txt`),
      path.join(this.customTemplatesPath, `${templateName}.md`),
      path.join(this.customTemplatesPath, `${templateName}.prompt`)
    ];
    
    // Проверяем вложенные пути (если шаблон в поддиректории)
    if (templateName.includes('/')) {
      const parts = templateName.split('/');
      const file = parts.pop();
      const directory = parts.join('/');
      
      possiblePaths.push(
        path.join(this.templatesPath, directory, `${file}.txt`),
        path.join(this.templatesPath, directory, `${file}.md`),
        path.join(this.templatesPath, directory, `${file}.prompt`),
        path.join(this.customTemplatesPath, directory, `${file}.txt`),
        path.join(this.customTemplatesPath, directory, `${file}.md`),
        path.join(this.customTemplatesPath, directory, `${file}.prompt`)
      );
    }
    
    // Проверяем все возможные пути
    for (const filePath of possiblePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const content = await readFile(filePath, 'utf8');
          
          // Кэшируем шаблон
          this.templates[templateName] = {
            content,
            path: filePath,
            source: 'file'
          };
          
          return content;
        }
      } catch (error) {
        // Игнорируем ошибки и проверяем следующий путь
      }
    }
    
    // Если шаблон не найден в файловой системе, проверяем базу данных
    try {
      const connection = await pool.getConnection();
      
      const [rows] = await connection.query(
        'SELECT content FROM llm_templates WHERE name = ? AND active = 1',
        [templateName]
      );
      
      connection.release();
      
      if (rows.length > 0) {
        // Кэшируем шаблон
        this.templates[templateName] = {
          content: rows[0].content,
          source: 'database'
        };
        
        return rows[0].content;
      }
    } catch (error) {
      logger.error(`Ошибка при загрузке шаблона из базы данных: ${templateName}`, error);
    }
    
    // Если шаблон не найден нигде, выбрасываем ошибку
    throw new Error(`Шаблон не найден: ${templateName}`);
  }

  /**
   * Заполняет шаблон данными
   * @param {string} templateName - Имя шаблона
   * @param {Object} templateData - Данные для заполнения шаблона
   * @returns {Promise<string>} Заполненный шаблон
   */
  async fillPrompt(templateName, templateData = {}) {
    try {
      // Загружаем шаблон
      const templateContent = await this._loadTemplate(templateName);
      
      // Объединяем глобальные переменные и переданные данные
      const allData = { ...this.globalVariables, ...templateData };
      
      // Заменяем переменные в шаблоне
      let result = templateContent.replace(this.variablePattern, (match, variable) => {
        const varName = variable.trim();
        
        // Если переменная найдена, возвращаем ее значение
        if (allData[varName] !== undefined) {
          return allData[varName];
        }
        
        // Проверяем, есть ли значение по умолчанию (формат {{varName:default}})
        if (varName.includes(':')) {
          const [name, defaultValue] = varName.split(':');
          return allData[name.trim()] !== undefined ? allData[name.trim()] : defaultValue.trim();
        }
        
        // Если переменная не найдена, оставляем плейсхолдер
        logger.warn(`Переменная не найдена в шаблоне ${templateName}: ${varName}`);
        return match;
      });
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при заполнении шаблона ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Создает многосекционный промпт из цепочки шаблонов
   * @param {Array<Object>} chain - Цепочка шаблонов
   * @returns {Promise<string>} Объединенный промпт
   */
  async createPromptChain(chain) {
    try {
      if (!Array.isArray(chain) || chain.length === 0) {
        throw new Error('Цепочка промптов должна быть непустым массивом');
      }
      
      const sections = [];
      
      // Проходим по каждому элементу цепочки
      for (const item of chain) {
        if (!item.template) {
          throw new Error('Каждый элемент цепочки должен содержать имя шаблона');
        }
        
        // Заполняем шаблон данными
        const filledPrompt = await this.fillPrompt(item.template, item.data || {});
        
        // Если указан заголовок секции, добавляем его
        if (item.title) {
          sections.push(`## ${item.title}\n\n${filledPrompt}`);
        } else {
          sections.push(filledPrompt);
        }
      }
      
      // Объединяем все секции с разделителями
      return sections.join('\n\n');
    } catch (error) {
      logger.error('Ошибка при создании цепочки промптов:', error);
      throw error;
    }
  }

  /**
   * Получает шаблон по имени
   * @param {string} templateName - Имя шаблона
   * @param {Object} variables - Переменные для заполнения
   * @returns {Promise<string>} Заполненный промпт
   */
  async getPrompt(templateName, variables = {}) {
    return this.fillPrompt(templateName, variables);
  }

  /**
   * Добавляет новый шаблон
   * @param {string} templateName - Имя шаблона
   * @param {string} content - Содержимое шаблона
   * @param {Object} options - Опции шаблона
   * @param {boolean} options.saveToDatabase - Сохранять ли шаблон в БД
   * @param {boolean} options.saveToFile - Сохранять ли шаблон в файл
   * @param {string} options.category - Категория шаблона
   * @returns {Promise<boolean>} Успешно ли добавлен шаблон
   */
  async addTemplate(templateName, content, options = {}) {
    try {
      // Проверяем инициализацию
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Настройки по умолчанию
      const settings = {
        saveToDatabase: false,
        saveToFile: true,
        category: 'custom',
        ...options
      };
      
      // Сохраняем в базу данных, если нужно
      if (settings.saveToDatabase) {
        try {
          const connection = await pool.getConnection();
          
          await connection.query(
            'INSERT INTO llm_templates (name, content, category, active) VALUES (?, ?, ?, 1) ' +
            'ON DUPLICATE KEY UPDATE content = ?, category = ?, active = 1',
            [templateName, content, settings.category, content, settings.category]
          );
          
          connection.release();
          logger.info(`Шаблон ${templateName} сохранен в базу данных`);
        } catch (error) {
          logger.error(`Ошибка при сохранении шаблона ${templateName} в базу данных:`, error);
          // Продолжаем, даже если не удалось сохранить в БД
        }
      }
      
      // Сохраняем в файл, если нужно
      if (settings.saveToFile) {
        const filePath = settings.category === 'default' 
          ? path.join(this.templatesPath, `${templateName}.txt`)
          : path.join(this.customTemplatesPath, settings.category, `${templateName}.txt`);
        
        // Создаем директорию, если она не существует
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        
        await writeFile(filePath, content, 'utf8');
        logger.info(`Шаблон ${templateName} сохранен в файл: ${filePath}`);
      }
      
      // Добавляем в кэш
      this.templates[templateName] = {
        content,
        source: settings.saveToFile ? 'file' : 'database',
        category: settings.category
      };
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при добавлении шаблона ${templateName}:`, error);
      return false;
    }
  }

  /**
   * Удаляет шаблон
   * @param {string} templateName - Имя шаблона
   * @returns {Promise<boolean>} Успешно ли удален шаблон
   */
  async deleteTemplate(templateName) {
    try {
      // Проверяем инициализацию
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Проверяем, существует ли шаблон
      if (!this.templates[templateName]) {
        throw new Error(`Шаблон не найден: ${templateName}`);
      }
      
      const template = this.templates[templateName];
      
      // Удаляем из файловой системы, если есть путь
      if (template.path && fs.existsSync(template.path)) {
        fs.unlinkSync(template.path);
        logger.info(`Шаблон ${templateName} удален из файловой системы`);
      }
      
      // Удаляем из базы данных
      try {
        const connection = await pool.getConnection();
        
        await connection.query(
          'UPDATE llm_templates SET active = 0 WHERE name = ?',
          [templateName]
        );
        
        connection.release();
        logger.info(`Шаблон ${templateName} помечен как неактивный в базе данных`);
      } catch (error) {
        logger.error(`Ошибка при удалении шаблона ${templateName} из базы данных:`, error);
      }
      
      // Удаляем из кэша
      delete this.templates[templateName];
      
      return true;
    } catch (error) {
      logger.error(`Ошибка при удалении шаблона ${templateName}:`, error);
      return false;
    }
  }

  /**
   * Получает список всех доступных шаблонов
   * @param {string} category - Категория шаблонов (опционально)
   * @returns {Promise<Array<{name: string, source: string, category: string}>>} Список шаблонов
   */
  async listTemplates(category = null) {
    // Проверяем инициализацию
    if (!this.initialized) {
      await this.initialize();
    }
    
    const templatesList = Object.entries(this.templates).map(([name, template]) => ({
      name,
      source: template.source,
      category: template.category || 'default'
    }));
    
    // Фильтруем по категории, если указана
    if (category) {
      return templatesList.filter(template => template.category === category);
    }
    
    return templatesList;
  }

  /**
   * Получает содержимое шаблона без обработки переменных
   * @param {string} templateName - Имя шаблона
   * @returns {Promise<string>} Содержимое шаблона
   */
  async getRawTemplate(templateName) {
    return this._loadTemplate(templateName);
  }

  /**
   * Устанавливает глобальную переменную для всех шаблонов
   * @param {string} name - Имя переменной
   * @param {*} value - Значение переменной
   */
  setGlobalVariable(name, value) {
    this.globalVariables[name] = value;
    logger.debug(`Установлена глобальная переменная: ${name}`);
  }

  /**
   * Устанавливает несколько глобальных переменных
   * @param {Object} variables - Объект с переменными
   */
  setGlobalVariables(variables) {
    this.globalVariables = { ...this.globalVariables, ...variables };
    logger.debug(`Установлены глобальные переменные: ${Object.keys(variables).join(', ')}`);
  }

  /**
   * Обновляет кэш шаблонов
   * @returns {Promise<void>}
   */
  async refreshCache() {
    // Очищаем кэш
    this.templates = {};
    this.initialized = false;
    
    // Инициализируем заново
    await this.initialize();
    logger.info('Кэш шаблонов обновлен');
  }
}

// Создаем и экспортируем экземпляр
const promptManager = new PromptManager();
module.exports = promptManager;
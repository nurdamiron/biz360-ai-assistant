// src/core/documentation-updater/api-doc-builder.js

const path = require('path');
const fs = require('fs').promises;
const DocumentationGenerator = require('./doc-generator');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const fileUtils = require('../../utils/file-utils');

/**
 * Специализированный генератор для документации API
 * @extends DocumentationGenerator
 */
class ApiDocBuilder extends DocumentationGenerator {
  /**
   * Создает экземпляр генератора документации API
   * @param {Object} options - Опции генерации документации
   * @param {String} options.projectRoot - Корневая папка проекта
   * @param {String} options.outputFormat - Формат выходной документации (markdown, swagger)
   * @param {String} options.apiTitle - Название API
   * @param {String} options.apiVersion - Версия API
   */
  constructor(options = {}) {
    super(options);
    this.apiTitle = options.apiTitle || 'API Documentation';
    this.apiVersion = options.apiVersion || '1.0.0';
    
    // Для документации API рекомендуется Swagger или Markdown
    if (!['markdown', 'swagger'].includes(this.outputFormat)) {
      logger.warn(`Формат ${this.outputFormat} не оптимален для API. Рекомендуется 'swagger' или 'markdown'`);
    }
  }

  /**
   * Генерирует документацию для маршрутов API
   * @param {String} routesDir - Директория с файлами маршрутов
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Результат генерации
   */
  async generateApiRoutesDocs(routesDir, options = {}) {
    const absolutePath = path.isAbsolute(routesDir) ? routesDir : path.join(this.projectRoot, routesDir);
    
    logger.info(`Генерация документации API для маршрутов в ${routesDir}`);
    
    // Находим все файлы с маршрутами
    const routeFiles = await this._findRouteFiles(absolutePath, options.include || ['.js', '.ts']);
    
    const docs = {};
    const errors = [];
    
    // Генерируем документацию для каждого файла маршрутов
    for (const file of routeFiles) {
      try {
        const relativePath = path.relative(this.projectRoot, file);
        
        // Определяем базовый путь API из структуры файла и имени
        const basePath = this._extractBasePathFromFile(file, this.projectRoot);
        
        const routeDocsOptions = {
          ...options,
          isApiRoute: true,
          basePath,
          swaggerFormat: this.outputFormat === 'swagger' ? 'json' : undefined
        };
        
        docs[relativePath] = await this.generateFileDocumentation(file, routeDocsOptions);
      } catch (error) {
        errors.push({ file, error: error.message });
        logger.error(`Ошибка при документировании API маршрута ${file}:`, error);
      }
    }
    
    // Генерация общего обзора API
    if (options.generateOverview) {
      try {
        const apiDetails = {
          routes: routeFiles.map(file => ({
            file: path.relative(this.projectRoot, file),
            basePath: this._extractBasePathFromFile(file, this.projectRoot)
          }))
        };
        
        const promptVariables = {
          apiTitle: this.apiTitle,
          apiVersion: this.apiVersion,
          routes: apiDetails.routes,
          outputFormat: this.outputFormat
        };
        
        const promptText = await promptManager.getPrompt('generate-api-overview', promptVariables);
        const overviewResult = await llmClient.sendMessage(promptText);
        
        const overviewOptions = {
          isOverview: true,
          apiTitle: this.apiTitle,
          apiVersion: this.apiVersion,
          swaggerFormat: this.outputFormat === 'swagger' ? 'json' : undefined
        };
        
        docs['_api_overview.' + this.formatAdapter.fileExtension] = 
          this.formatAdapter.processOutput(overviewResult, overviewOptions);
      } catch (error) {
        errors.push({ file: '_api_overview', error: error.message });
        logger.error(`Ошибка при генерации обзора API:`, error);
      }
    }
    
    return {
      module: routesDir,
      docs,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Создает полную документацию Swagger для API
   * @param {String} routesDir - Директория с файлами маршрутов
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Результат генерации
   */
  async generateSwaggerDoc(routesDir, options = {}) {
    // Убедимся, что используется формат Swagger
    const originalFormat = this.outputFormat;
    this.outputFormat = 'swagger';
    this.formatAdapter = this._getFormatAdapter('swagger');
    
    try {
      // Генерируем документацию для всех маршрутов
      const routesDocs = await this.generateApiRoutesDocs(routesDir, { 
        ...options, 
        generateOverview: true,
        swaggerFormat: 'json'
      });
      
      // Создаем базовую структуру Swagger
      const swaggerBase = {
        openapi: '3.0.0',
        info: {
          title: this.apiTitle,
          version: this.apiVersion,
          description: options.description || `${this.apiTitle} API Documentation`
        },
        servers: options.servers || [{
          url: options.baseUrl || '/api',
          description: 'API server'
        }],
        paths: {},
        components: {
          schemas: {},
          securitySchemes: options.securitySchemes || {
            BearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            }
          }
        }
      };
      
      // Объединяем все пути из отдельных файлов маршрутов
      for (const [filePath, docContent] of Object.entries(routesDocs.docs)) {
        if (filePath.startsWith('_api_overview.')) continue;
        
        try {
          const routeSwagger = JSON.parse(docContent);
          
          // Добавляем пути из этого файла в общий Swagger
          if (routeSwagger.paths) {
            Object.assign(swaggerBase.paths, routeSwagger.paths);
          }
          
          // Добавляем схемы из этого файла в общий Swagger
          if (routeSwagger.components && routeSwagger.components.schemas) {
            Object.assign(swaggerBase.components.schemas, routeSwagger.components.schemas);
          }
        } catch (error) {
          logger.warn(`Не удалось обработать Swagger из ${filePath}:`, error);
        }
      }
      
      // Сохраняем объединенный Swagger
      const targetFilename = options.outputFilename || 'swagger.json';
      const outputPath = path.join(options.outputDir || 'docs/api', targetFilename);
      
      await fileUtils.ensureDir(path.dirname(outputPath));
      await fs.writeFile(outputPath, JSON.stringify(swaggerBase, null, 2));
      
      logger.info(`Swagger документация сохранена в ${outputPath}`);
      
      // Возвращаем путь к файлу и содержимое
      return {
        status: 'success',
        filePath: outputPath,
        content: swaggerBase
      };
    } catch (error) {
      logger.error('Ошибка при генерации Swagger документации:', error);
      throw error;
    } finally {
      // Восстанавливаем исходный формат
      this.outputFormat = originalFormat;
      this.formatAdapter = this._getFormatAdapter(originalFormat);
    }
  }

  /**
   * Генерирует документацию для модели данных
   * @param {String} modelPath - Путь к файлу модели
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<String>} Сгенерированная документация
   */
  async generateModelDoc(modelPath, options = {}) {
    try {
      const modelOptions = {
        ...options,
        isModel: true,
        schemaName: options.schemaName || this._extractModelNameFromPath(modelPath)
      };
      
      return await this.generateFileDocumentation(modelPath, modelOptions);
    } catch (error) {
      logger.error(`Ошибка при генерации документации для модели ${modelPath}:`, error);
      throw error;
    }
  }

  /**
   * Находит все файлы с маршрутами в директории
   * @private
   * @param {String} dirPath - Путь к директории
   * @param {Array<String>} extensions - Расширения файлов для включения
   * @returns {Promise<Array<String>>} Список путей к файлам маршрутов
   */
  async _findRouteFiles(dirPath, extensions) {
    const allFiles = await this._getModuleFiles(dirPath, extensions);
    
    // Фильтруем только файлы, относящиеся к маршрутам
    // Обычно они содержат 'route', 'routes', 'api', 'controller' в имени
    return allFiles.filter(file => {
      const filename = path.basename(file).toLowerCase();
      return filename.includes('route') || 
             filename.includes('api') || 
             filename.includes('controller');
    });
  }

  /**
   * Извлекает базовый путь API из имени и расположения файла
   * @private
   * @param {String} filePath - Путь к файлу
   * @param {String} projectRoot - Корневая директория проекта
   * @returns {String} Базовый путь API
   */
  _extractBasePathFromFile(filePath, projectRoot) {
    const relativePath = path.relative(projectRoot, filePath);
    
    // Извлекаем компоненты пути
    const pathParts = relativePath.split(path.sep);
    
    // Находим индекс 'routes' или 'api'
    const routesIndex = pathParts.findIndex(part => 
      part === 'routes' || part === 'api' || part.includes('route'));
    
    if (routesIndex !== -1 && routesIndex < pathParts.length - 1) {
      // Берем части пути после 'routes'/'api'
      const apiParts = pathParts.slice(routesIndex + 1);
      
      // Удаляем расширение файла и 'index' из последней части
      let lastPart = apiParts[apiParts.length - 1];
      lastPart = lastPart.replace(/\.(js|ts)$/, '');
      if (lastPart === 'index') {
        apiParts.pop();
      } else {
        apiParts[apiParts.length - 1] = lastPart;
      }
      
      // Формируем базовый путь
      return '/api/' + apiParts.join('/');
    }
    
    // Если не удалось извлечь путь, используем имя файла
    const filename = path.basename(filePath, path.extname(filePath));
    return '/api/' + (filename === 'index' ? '' : filename);
  }

  /**
   * Извлекает имя модели из пути к файлу
   * @private
   * @param {String} modelPath - Путь к файлу модели
   * @returns {String} Имя модели
   */
  _extractModelNameFromPath(modelPath) {
    const filename = path.basename(modelPath, path.extname(modelPath));
    
    // Удаляем '.model' из имени, если есть
    return filename.replace(/\.model$/, '');
  }
}

module.exports = ApiDocBuilder;
// src/core/documentation-updater/index.js

const DocumentationGenerator = require('./doc-generator');
const ApiDocBuilder = require('./api-doc-builder');
const logger = require('../../utils/logger');
const path = require('path');

/**
 * Фабрика для создания генераторов документации разных типов
 */
class DocumentationFactory {
  /**
   * Создает генератор документации нужного типа
   * @param {String} type - Тип генератора ('general', 'api')
   * @param {Object} options - Опции для генератора
   * @returns {DocumentationGenerator} Экземпляр генератора документации
   */
  static createGenerator(type, options = {}) {
    switch (type.toLowerCase()) {
      case 'api':
        return new ApiDocBuilder(options);
      case 'general':
      default:
        return new DocumentationGenerator(options);
    }
  }
}

/**
 * Менеджер для работы с документацией проекта
 */
class DocumentationManager {
  /**
   * Создает менеджер документации
   * @param {Object} options - Опции менеджера
   * @param {String} options.projectRoot - Корневая папка проекта
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.config = options.config || {};
  }

  /**
   * Генерирует документацию для всего проекта
   * @param {Object} options - Опции генерации
   * @returns {Promise<Object>} Результат генерации
   */
  async generateProjectDocs(options = {}) {
    try {
      logger.info('Запуск генерации документации для проекта');
      
      const results = {
        modules: {},
        api: null,
        errors: []
      };
      
      // Генерация документации для модулей кода
      if (options.modules || this.config.modules) {
        const modules = options.modules || this.config.modules || [];
        for (const module of modules) {
          try {
            const generator = DocumentationFactory.createGenerator('general', {
              projectRoot: this.projectRoot,
              outputFormat: module.format || 'markdown'
            });
            
            const moduleResult = await generator.generateModuleDocumentation(
              module.path,
              {
                generateOverview: module.generateOverview !== false,
                include: module.include || ['.js', '.ts'],
                ...module.options
              }
            );
            
            results.modules[module.path] = moduleResult;
            
            // Сохраняем документацию, если указана директория
            if (module.outputDir) {
              const outputDir = path.isAbsolute(module.outputDir) 
                ? module.outputDir 
                : path.join(this.projectRoot, module.outputDir);
              
              await generator.saveDocumentation(moduleResult, outputDir);
            }
            
            if (moduleResult.errors) {
              results.errors.push(...moduleResult.errors);
            }
          } catch (error) {
            logger.error(`Ошибка при генерации документации для модуля ${module.path}:`, error);
            results.errors.push({ module: module.path, error: error.message });
          }
        }
      }
      
      // Генерация документации API
      if (options.api || this.config.api) {
        const apiConfig = options.api || this.config.api;
        if (apiConfig) {
          try {
            const apiGenerator = DocumentationFactory.createGenerator('api', {
              projectRoot: this.projectRoot,
              outputFormat: apiConfig.format || 'swagger',
              apiTitle: apiConfig.title || 'API Documentation',
              apiVersion: apiConfig.version || '1.0.0'
            });
            
            if (apiConfig.swagger) {
              // Генерация Swagger документации
              results.api = await apiGenerator.generateSwaggerDoc(
                apiConfig.routesDir || 'src/api/routes',
                {
                  outputDir: apiConfig.outputDir || 'docs/api',
                  baseUrl: apiConfig.baseUrl || '/api',
                  description: apiConfig.description,
                  servers: apiConfig.servers,
                  securitySchemes: apiConfig.securitySchemes,
                  ...apiConfig.options
                }
              );
            } else {
              // Генерация обычной документации API
              const apiResults = await apiGenerator.generateApiRoutesDocs(
                apiConfig.routesDir || 'src/api/routes',
                {
                  generateOverview: apiConfig.generateOverview !== false,
                  ...apiConfig.options
                }
              );
              
              results.api = apiResults;
              
              // Сохраняем документацию, если указана директория
              if (apiConfig.outputDir) {
                const outputDir = path.isAbsolute(apiConfig.outputDir) 
                  ? apiConfig.outputDir 
                  : path.join(this.projectRoot, apiConfig.outputDir);
                
                await apiGenerator.saveDocumentation(apiResults, outputDir);
              }
              
              if (apiResults.errors) {
                results.errors.push(...apiResults.errors);
              }
            }
          } catch (error) {
            logger.error(`Ошибка при генерации документации API:`, error);
            results.errors.push({ module: 'api', error: error.message });
          }
        }
      }
      
      return {
        status: results.errors.length === 0 ? 'success' : 'completed_with_errors',
        ...results,
        errors: results.errors.length > 0 ? results.errors : null
      };
    } catch (error) {
      logger.error('Ошибка при генерации документации проекта:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Обновляет документацию для измененных файлов
   * @param {String} since - Временная метка или коммит для diff
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Результат обновления
   */
  async updateDocumentation(since = 'HEAD~1', options = {}) {
    try {
      logger.info(`Обновление документации для изменений с ${since}`);
      
      const generator = DocumentationFactory.createGenerator('general', {
        projectRoot: this.projectRoot,
        outputFormat: options.format || 'markdown'
      });
      
      const updateResult = await generator.updateDocumentationForChanges(since, {
        include: options.include || ['.js', '.ts'],
        ...options
      });
      
      // Сохраняем обновленную документацию, если указана директория
      if (options.outputDir) {
        const outputDir = path.isAbsolute(options.outputDir) 
          ? options.outputDir 
          : path.join(this.projectRoot, options.outputDir);
        
        await generator.saveDocumentation({ docs: updateResult.docs }, outputDir);
      }
      
      return {
        status: updateResult.errors ? 'completed_with_errors' : 'success',
        ...updateResult
      };
    } catch (error) {
      logger.error('Ошибка при обновлении документации:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }
  
  /**
   * Генерирует файл README.md для проекта или модуля
   * @param {Object} options - Опции генерации
   * @returns {Promise<Object>} Результат генерации
   */
  async generateReadme(options = {}) {
    try {
      const modulePath = options.modulePath || '';
      const targetPath = path.join(this.projectRoot, modulePath);
      
      logger.info(`Генерация README.md для ${modulePath || 'проекта'}`);
      
      const generator = DocumentationFactory.createGenerator('general', {
        projectRoot: this.projectRoot,
        outputFormat: 'markdown'
      });
      
      // Собираем информацию о модуле/проекте
      let moduleFiles;
      if (options.includeFiles !== false) {
        moduleFiles = await generator._getModuleFiles(
          targetPath, 
          options.include || ['.js', '.ts']
        );
      }
      
      // Формируем промпт для генерации README
      const promptManager = require('../../utils/prompt-manager');
      const llmClient = require('../../utils/llm-client');
      
      const promptVariables = {
        projectName: options.projectName || path.basename(this.projectRoot),
        modulePath,
        files: moduleFiles ? moduleFiles.map(f => path.relative(this.projectRoot, f)) : [],
        description: options.description || '',
        package: options.packageJson || null
      };
      
      // Если доступен package.json, добавляем его информацию
      if (!promptVariables.package && options.includePackageJson !== false) {
        try {
          const packagePath = path.join(this.projectRoot, 'package.json');
          const fs = require('fs').promises;
          const packageContent = await fs.readFile(packagePath, 'utf-8');
          promptVariables.package = JSON.parse(packageContent);
        } catch (e) {
          // Игнорируем ошибки при чтении package.json
        }
      }
      
      const promptText = await promptManager.getPrompt('generate-readme', promptVariables);
      const readmeContent = await llmClient.sendMessage(promptText);
      
      // Сохраняем README
      const readmePath = path.join(targetPath, 'README.md');
      const fs = require('fs').promises;
      await fs.writeFile(readmePath, readmeContent);
      
      return {
        status: 'success',
        path: readmePath,
        content: readmeContent
      };
    } catch (error) {
      logger.error('Ошибка при генерации README:', error);
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

module.exports = {
  DocumentationGenerator,
  ApiDocBuilder,
  DocumentationFactory,
  DocumentationManager
};
// src/controller/documentation/documentation.controller.js

const { DocumentationManager } = require('../../core/documentation-updater');
const config = require('../../config/app.config');
const logger = require('../../utils/logger');
const path = require('path');

/**
 * Контроллер для управления генерацией документации
 */
class DocumentationController {
  /**
   * Генерирует документацию для проекта или указанных модулей
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateDocumentation(req, res) {
    try {
      const options = req.body;
      
      logger.info('Запуск генерации документации', options);
      
      const docManager = new DocumentationManager({
        projectRoot: config.projectRoot || process.cwd(),
        config: config.documentation
      });
      
      const result = await docManager.generateProjectDocs(options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при генерации документации:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Обновляет документацию для изменившихся файлов
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async updateDocumentation(req, res) {
    try {
      const { since = 'HEAD~1' } = req.body;
      const options = req.body;
      
      logger.info(`Запуск обновления документации с ${since}`);
      
      const docManager = new DocumentationManager({
        projectRoot: config.projectRoot || process.cwd(),
        config: config.documentation
      });
      
      const result = await docManager.updateDocumentation(since, options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при обновлении документации:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Генерирует документацию для конкретного файла
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateFileDocumentation(req, res) {
    try {
      const { filePath } = req.body;
      
      if (!filePath) {
        return res.status(400).json({
          success: false,
          error: 'Не указан путь к файлу'
        });
      }
      
      logger.info(`Генерация документации для файла ${filePath}`);
      
      const { DocumentationFactory } = require('../../core/documentation-updater');
      
      const generator = DocumentationFactory.createGenerator('general', {
        projectRoot: config.projectRoot || process.cwd(),
        outputFormat: req.body.format || 'markdown'
      });
      
      const documentation = await generator.generateFileDocumentation(filePath, req.body);
      
      return res.status(200).json({
        success: true,
        filePath,
        documentation
      });
    } catch (error) {
      logger.error(`Ошибка при генерации документации для файла:`, error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Генерирует Swagger документацию для API
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateSwagger(req, res) {
    try {
      const options = {
        routesDir: req.body.routesDir || 'src/api/routes',
        outputDir: req.body.outputDir || 'docs/api',
        ...req.body
      };
      
      logger.info('Запуск генерации Swagger', options);
      
      const { DocumentationFactory } = require('../../core/documentation-updater');
      
      const apiGenerator = DocumentationFactory.createGenerator('api', {
        projectRoot: config.projectRoot || process.cwd(),
        outputFormat: 'swagger',
        apiTitle: options.apiTitle || config.name || 'API Documentation',
        apiVersion: options.apiVersion || config.version || '1.0.0'
      });
      
      const result = await apiGenerator.generateSwaggerDoc(options.routesDir, options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при генерации Swagger:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Генерирует README.md для проекта или модуля
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateReadme(req, res) {
    try {
      const options = req.body;
      
      logger.info('Запуск генерации README', options);
      
      const docManager = new DocumentationManager({
        projectRoot: config.projectRoot || process.cwd(),
        config: config.documentation
      });
      
      const result = await docManager.generateReadme(options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при генерации README:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new DocumentationController();
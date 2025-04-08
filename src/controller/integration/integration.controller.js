// src/controller/integration/integration.controller.js
const logger = require('../../utils/logger');
const projectManagementIntegration = require('../../core/project-management');
const { IntegrationTypeModel, IntegrationLinkModel, ProjectModel, TaskExternalLinkModel } = require('../../models');
const { ValidationError } = require('../../utils/errors');

/**
 * Контроллер для управления интеграциями
 */
class IntegrationController {
  /**
   * Получение списка доступных типов интеграций
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getIntegrationTypes(req, res) {
    try {
      // Получаем все типы интеграций
      const integrationTypes = await IntegrationTypeModel.findAll();
      
      res.json({
        success: true,
        data: integrationTypes
      });
    } catch (error) {
      logger.error(`Error getting integration types: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get integration types',
        message: error.message
      });
    }
  }

  /**
   * Получение активных интеграций для проекта
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getProjectIntegrations(req, res) {
    try {
      const { projectId } = req.params;
      
      // Проверяем наличие проекта
      const project = await ProjectModel.findByPk(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      // Получаем интеграции для проекта
      const integrations = await projectManagementIntegration.getActiveIntegrations(projectId);
      
      res.json({
        success: true,
        data: integrations
      });
    } catch (error) {
      logger.error(`Error getting project integrations: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get project integrations',
        message: error.message
      });
    }
  }

  /**
   * Создание интеграции для проекта
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async createIntegration(req, res) {
    try {
      const { projectId } = req.params;
      const { provider, config } = req.body;
      
      // Проверяем наличие проекта
      const project = await ProjectModel.findByPk(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      // Проверяем корректность провайдера
      const integrationType = await IntegrationTypeModel.findOne({
        where: { provider_name: provider }
      });
      
      if (!integrationType) {
        return res.status(400).json({
          success: false,
          error: 'Invalid provider',
          availableProviders: projectManagementIntegration.getAvailableProviders()
        });
      }
      
      // Проверяем наличие активной интеграции с таким же провайдером
      const existingIntegration = await IntegrationLinkModel.findOne({
        where: {
          project_id: projectId,
          integration_type_id: integrationType.id,
          active: true
        }
      });
      
      if (existingIntegration) {
        return res.status(400).json({
          success: false,
          error: `Integration with provider '${provider}' already exists for this project`,
          integrationId: existingIntegration.id
        });
      }
      
      // Валидируем конфигурацию
      if (!config) {
        return res.status(400).json({
          success: false,
          error: 'Configuration is required'
        });
      }
      
      // Создаем интеграцию
      const integration = await IntegrationLinkModel.create({
        project_id: projectId,
        integration_type_id: integrationType.id,
        config: JSON.stringify(config),
        active: true
      });
      
      res.status(201).json({
        success: true,
        data: {
          id: integration.id,
          projectId,
          provider,
          active: integration.active,
          createdAt: integration.created_at
        },
        message: 'Integration created successfully'
      });
    } catch (error) {
      logger.error(`Error creating integration: ${error.message}`, {
        error: error.stack
      });
      
      // Если ошибка валидации, возвращаем 400
      if (error instanceof ValidationError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to create integration',
        message: error.message
      });
    }
  }

  /**
   * Обновление интеграции для проекта
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async updateIntegration(req, res) {
    try {
      const { integrationId } = req.params;
      const { config, active } = req.body;
      
      // Проверяем наличие интеграции
      const integration = await IntegrationLinkModel.findByPk(integrationId, {
        include: [{ model: IntegrationTypeModel, as: 'integrationType' }]
      });
      
      if (!integration) {
        return res.status(404).json({
          success: false,
          error: 'Integration not found'
        });
      }
      
      // Обновляем интеграцию
      const updateFields = {};
      
      if (config !== undefined) {
        updateFields.config = JSON.stringify(config);
      }
      
      if (active !== undefined) {
        updateFields.active = active;
      }
      
      await integration.update(updateFields);
      
      res.json({
        success: true,
        data: {
          id: integration.id,
          projectId: integration.project_id,
          provider: integration.integrationType.provider_name,
          active: integration.active,
          updatedAt: integration.updated_at
        },
        message: 'Integration updated successfully'
      });
    } catch (error) {
      logger.error(`Error updating integration: ${error.message}`, {
        error: error.stack
      });
      
      // Если ошибка валидации, возвращаем 400
      if (error instanceof ValidationError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.details
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to update integration',
        message: error.message
      });
    }
  }

  /**
   * Удаление интеграции для проекта
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async deleteIntegration(req, res) {
    try {
      const { integrationId } = req.params;
      
      // Проверяем наличие интеграции
      const integration = await IntegrationLinkModel.findByPk(integrationId);
      
      if (!integration) {
        return res.status(404).json({
          success: false,
          error: 'Integration not found'
        });
      }
      
      // Удаляем интеграцию
      await integration.destroy();
      
      res.json({
        success: true,
        message: 'Integration deleted successfully'
      });
    } catch (error) {
      logger.error(`Error deleting integration: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to delete integration',
        message: error.message
      });
    }
  }

  /**
   * Получение внешних ссылок для задачи
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async getTaskExternalLinks(req, res) {
    try {
      const { taskId } = req.params;
      
      // Получаем связи задачи с внешними системами
      const links = await TaskExternalLinkModel.findAll({
        where: { task_id: taskId },
        include: [{ model: IntegrationTypeModel, as: 'integrationType' }]
      });
      
      // Форматируем ответ
      const formattedLinks = links.map(link => ({
        id: link.id,
        taskId: link.task_id,
        provider: link.integrationType.provider_name,
        externalId: link.external_id,
        externalUrl: link.external_url,
        createdAt: link.created_at
      }));
      
      res.json({
        success: true,
        data: formattedLinks
      });
    } catch (error) {
      logger.error(`Error getting task external links: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to get task external links',
        message: error.message
      });
    }
  }

  /**
   * Синхронизация задачи с внешней системой
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async synchronizeTask(req, res) {
    try {
      const { taskId } = req.params;
      const { direction = 'bidirectional', provider } = req.body;
      
      // Проверяем корректность направления
      const validDirections = ['to-external', 'from-external', 'bidirectional'];
      if (!validDirections.includes(direction)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid direction',
          validDirections
        });
      }
      
      // Синхронизируем задачу
      const result = await projectManagementIntegration.synchronizeTask(taskId, direction, provider);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error synchronizing task: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to synchronize task',
        message: error.message
      });
    }
  }

  /**
   * Импорт задач из внешней системы
   * @param {object} req - Express Request
   * @param {object} res - Express Response
   */
  async importTasksFromExternalSystem(req, res) {
    try {
      const { projectId } = req.params;
      const { provider, options } = req.body;
      
      // Проверяем наличие проекта
      const project = await ProjectModel.findByPk(projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      // Проверяем корректность провайдера
      if (!provider) {
        return res.status(400).json({
          success: false,
          error: 'Provider is required',
          availableProviders: projectManagementIntegration.getAvailableProviders()
        });
      }
      
      // Проверяем наличие активной интеграции с указанным провайдером
      const isActive = await projectManagementIntegration.isIntegrationActive(projectId, provider);
      if (!isActive) {
        return res.status(400).json({
          success: false,
          error: `No active integration found for provider '${provider}'`
        });
      }
      
      // Импортируем задачи
      const result = await projectManagementIntegration.importTasksFromExternalSystem(projectId, provider, options || {});
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error(`Error importing tasks from external system: ${error.message}`, {
        error: error.stack
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to import tasks from external system',
        message: error.message
      });
    }
  }
}

module.exports = new IntegrationController();
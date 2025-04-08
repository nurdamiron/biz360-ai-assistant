// src/core/project-management/index.js
const logger = require('../../utils/logger');
const jiraIntegration = require('./jira-integration');
const githubIntegration = require('./github-integration');
const gitlabIntegration = require('./gitlab-integration');
const azureDevopsIntegration = require('./azure-devops-integration');
const { ProjectModel, TaskModel, IntegrationTypeModel, IntegrationLinkModel } = require('../../models');

/**
 * Менеджер интеграций с системами управления проектами
 */
class ProjectManagementIntegration {
  constructor() {
    // Интеграции с различными системами
    this.providers = {
      jira: jiraIntegration,
      github: githubIntegration,
      gitlab: gitlabIntegration,
      'azure-devops': azureDevopsIntegration
    };
  }

  /**
   * Получение доступных провайдеров интеграции
   * @returns {string[]} - Список доступных провайдеров
   */
  getAvailableProviders() {
    return Object.keys(this.providers);
  }

  /**
   * Проверка активности интеграции для проекта
   * @param {number} projectId - ID проекта
   * @param {string} provider - Провайдер интеграции
   * @returns {Promise<boolean>} - Активна ли интеграция
   */
  async isIntegrationActive(projectId, provider) {
    try {
      // Получаем тип интеграции по названию провайдера
      const integrationType = await IntegrationTypeModel.findOne({
        where: { provider_name: provider }
      });
      
      if (!integrationType) {
        return false;
      }
      
      // Проверяем наличие активной интеграции для проекта
      const integration = await IntegrationLinkModel.findOne({
        where: {
          project_id: projectId,
          integration_type_id: integrationType.id,
          active: true
        }
      });
      
      return !!integration;
    } catch (error) {
      logger.error(`Error checking integration status: ${error.message}`, {
        error: error.stack,
        projectId,
        provider
      });
      
      return false;
    }
  }

  /**
   * Получение конфигурации интеграции
   * @param {number} projectId - ID проекта
   * @param {string} provider - Провайдер интеграции
   * @returns {Promise<object|null>} - Конфигурация интеграции
   */
  async getIntegrationConfig(projectId, provider) {
    try {
      // Получаем тип интеграции по названию провайдера
      const integrationType = await IntegrationTypeModel.findOne({
        where: { provider_name: provider }
      });
      
      if (!integrationType) {
        return null;
      }
      
      // Получаем интеграцию для проекта
      const integration = await IntegrationLinkModel.findOne({
        where: {
          project_id: projectId,
          integration_type_id: integrationType.id,
          active: true
        }
      });
      
      if (!integration) {
        return null;
      }
      
      // Парсим конфигурацию
      try {
        return JSON.parse(integration.config || '{}');
      } catch (e) {
        logger.warn(`Error parsing integration config for project ${projectId}, provider ${provider}: ${e.message}`);
        return {};
      }
    } catch (error) {
      logger.error(`Error getting integration config: ${error.message}`, {
        error: error.stack,
        projectId,
        provider
      });
      
      return null;
    }
  }

  /**
   * Создание задачи во внешней системе
   * @param {object} task - Объект задачи
   * @param {string} provider - Провайдер интеграции (опционально)
   * @returns {Promise<object|null>} - Результат создания
   */
  async createExternalTask(task, provider = null) {
    try {
      // Если провайдер не указан, пытаемся определить его из интеграций проекта
      if (!provider) {
        const activeIntegrations = await this.getActiveIntegrations(task.project_id);
        if (activeIntegrations.length === 0) {
          logger.warn(`No active integrations found for project ${task.project_id}`);
          return null;
        }
        
        // Берем первую активную интеграцию
        provider = activeIntegrations[0].provider_name;
      }
      
      // Проверяем наличие интеграции с указанным провайдером
      if (!this.providers[provider]) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Получаем конфигурацию интеграции
      const config = await this.getIntegrationConfig(task.project_id, provider);
      if (!config) {
        throw new Error(`Integration config not found for project ${task.project_id}, provider ${provider}`);
      }
      
      // Создаем задачу во внешней системе
      const result = await this.providers[provider].createTask(task, config);
      
      // Сохраняем связь задачи с внешней системой
      await this.saveTaskLink(task.id, provider, result.externalId, result.externalUrl);
      
      return result;
    } catch (error) {
      logger.error(`Error creating external task: ${error.message}`, {
        error: error.stack,
        taskId: task.id,
        provider
      });
      
      throw error;
    }
  }

  /**
   * Обновление задачи во внешней системе
   * @param {object} task - Объект задачи
   * @param {string} provider - Провайдер интеграции (опционально)
   * @returns {Promise<object|null>} - Результат обновления
   */
  async updateExternalTask(task, provider = null) {
    try {
      // Получаем связь задачи с внешней системой
      const taskLink = await this.getTaskLink(task.id, provider);
      if (!taskLink) {
        logger.warn(`No external task link found for task ${task.id}`);
        return null;
      }
      
      // Определяем провайдер из связи
      provider = taskLink.provider_name;
      
      // Проверяем наличие интеграции с указанным провайдером
      if (!this.providers[provider]) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Получаем конфигурацию интеграции
      const config = await this.getIntegrationConfig(task.project_id, provider);
      if (!config) {
        throw new Error(`Integration config not found for project ${task.project_id}, provider ${provider}`);
      }
      
      // Обновляем задачу во внешней системе
      return await this.providers[provider].updateTask(task, taskLink.external_id, config);
    } catch (error) {
      logger.error(`Error updating external task: ${error.message}`, {
        error: error.stack,
        taskId: task.id,
        provider
      });
      
      throw error;
    }
  }

  /**
   * Получение задачи из внешней системы
   * @param {number} taskId - ID задачи
   * @param {string} provider - Провайдер интеграции (опционально)
   * @returns {Promise<object|null>} - Данные задачи из внешней системы
   */
  async getExternalTask(taskId, provider = null) {
    try {
      // Получаем связь задачи с внешней системой
      const taskLink = await this.getTaskLink(taskId, provider);
      if (!taskLink) {
        logger.warn(`No external task link found for task ${taskId}`);
        return null;
      }
      
      // Определяем провайдер из связи
      provider = taskLink.provider_name;
      
      // Проверяем наличие интеграции с указанным провайдером
      if (!this.providers[provider]) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Получаем задачу из БД
      const task = await TaskModel.findByPk(taskId);
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Получаем конфигурацию интеграции
      const config = await this.getIntegrationConfig(task.project_id, provider);
      if (!config) {
        throw new Error(`Integration config not found for project ${task.project_id}, provider ${provider}`);
      }
      
      // Получаем задачу из внешней системы
      return await this.providers[provider].getTask(taskLink.external_id, config);
    } catch (error) {
      logger.error(`Error getting external task: ${error.message}`, {
        error: error.stack,
        taskId,
        provider
      });
      
      throw error;
    }
  }

  /**
   * Синхронизация задачи между BIZ360 и внешней системой
   * @param {number} taskId - ID задачи
   * @param {string} direction - Направление синхронизации ('to-external', 'from-external', 'bidirectional')
   * @param {string} provider - Провайдер интеграции (опционально)
   * @returns {Promise<object>} - Результат синхронизации
   */
  async synchronizeTask(taskId, direction = 'bidirectional', provider = null) {
    try {
      // Получаем задачу из БД
      const task = await TaskModel.findByPk(taskId);
      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }
      
      // Получаем связь задачи с внешней системой
      const taskLink = await this.getTaskLink(taskId, provider);
      
      // Определяем действие в зависимости от направления и наличия связи
      if (direction === 'to-external' || direction === 'bidirectional') {
        if (taskLink) {
          // Обновляем задачу во внешней системе
          await this.updateExternalTask(task, taskLink.provider_name);
        } else {
          // Создаем задачу во внешней системе
          await this.createExternalTask(task, provider);
        }
      }
      
      if (direction === 'from-external' || direction === 'bidirectional') {
        if (taskLink) {
          // Получаем внешнюю задачу
          const externalTask = await this.getExternalTask(taskId, taskLink.provider_name);
          
          if (externalTask) {
            // Обновляем локальную задачу из внешней
            await this.updateLocalTask(task, externalTask, taskLink.provider_name);
          }
        }
      }
      
      return {
        success: true,
        taskId,
        direction,
        provider: taskLink ? taskLink.provider_name : provider,
        message: 'Task synchronized successfully'
      };
    } catch (error) {
      logger.error(`Error synchronizing task: ${error.message}`, {
        error: error.stack,
        taskId,
        direction,
        provider
      });
      
      throw error;
    }
  }

  /**
   * Обновление локальной задачи из внешней
   * @param {object} localTask - Объект локальной задачи
   * @param {object} externalTask - Объект внешней задачи
   * @param {string} provider - Провайдер интеграции
   * @returns {Promise<object>} - Обновленная задача
   */
  async updateLocalTask(localTask, externalTask, provider) {
    try {
      // Проверяем наличие интеграции с указанным провайдером
      if (!this.providers[provider]) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Получаем конфигурацию интеграции
      const config = await this.getIntegrationConfig(localTask.project_id, provider);
      if (!config) {
        throw new Error(`Integration config not found for project ${localTask.project_id}, provider ${provider}`);
      }
      
      // Преобразуем внешнюю задачу в формат локальной
      const mappedTask = await this.providers[provider].mapExternalTaskToLocal(externalTask, config);
      
      // Обновляем локальную задачу
      // Обновляем только те поля, которые есть в маппинге
      const updateFields = {};
      
      if (mappedTask.title) updateFields.title = mappedTask.title;
      if (mappedTask.description) updateFields.description = mappedTask.description;
      if (mappedTask.status) updateFields.status = mappedTask.status;
      if (mappedTask.priority) updateFields.priority = mappedTask.priority;
      if (mappedTask.due_date) updateFields.due_date = mappedTask.due_date;
      if (mappedTask.assignee_id) updateFields.assignee_id = mappedTask.assignee_id;
      
      // Добавляем поле с информацией о последней синхронизации
      updateFields.last_sync_at = new Date();
      updateFields.last_sync_from = `${provider}:${externalTask.id}`;
      
      // Обновляем задачу
      await localTask.update(updateFields);
      
      return localTask;
    } catch (error) {
      logger.error(`Error updating local task from external: ${error.message}`, {
        error: error.stack,
        taskId: localTask.id,
        provider
      });
      
      throw error;
    }
  }

  /**
   * Получение активных интеграций для проекта
   * @param {number} projectId - ID проекта
   * @returns {Promise<Array>} - Список активных интеграций
   */
  async getActiveIntegrations(projectId) {
    try {
      // Получаем все типы интеграций
      const integrationTypes = await IntegrationTypeModel.findAll();
      
      // Получаем активные интеграции для проекта
      const integrationLinks = await IntegrationLinkModel.findAll({
        where: {
          project_id: projectId,
          active: true
        }
      });
      
      // Объединяем данные
      const activeIntegrations = integrationLinks.map(link => {
        const integrationType = integrationTypes.find(type => type.id === link.integration_type_id);
        
        return {
          id: link.id,
          provider_name: integrationType ? integrationType.provider_name : 'unknown',
          provider_title: integrationType ? integrationType.title : 'Unknown Provider',
          config: link.config ? JSON.parse(link.config) : {},
          created_at: link.created_at,
          updated_at: link.updated_at
        };
      });
      
      return activeIntegrations;
    } catch (error) {
      logger.error(`Error getting active integrations: ${error.message}`, {
        error: error.stack,
        projectId
      });
      
      throw error;
    }
  }

  /**
   * Получение связи задачи с внешней системой
   * @param {number} taskId - ID задачи
   * @param {string} provider - Провайдер интеграции (опционально)
   * @returns {Promise<object|null>} - Связь задачи с внешней системой
   */
  async getTaskLink(taskId, provider = null) {
    try {
      // Базовое условие для запроса
      const whereCondition = { task_id: taskId };
      
      // Если указан провайдер, добавляем его в условие
      if (provider) {
        // Получаем тип интеграции по названию провайдера
        const integrationType = await IntegrationTypeModel.findOne({
          where: { provider_name: provider }
        });
        
        if (!integrationType) {
          return null;
        }
        
        whereCondition.integration_type_id = integrationType.id;
      }
      
      // Получаем связь задачи с внешней системой
      const taskLink = await TaskExternalLinkModel.findOne({
        where: whereCondition,
        include: [{
          model: IntegrationTypeModel,
          as: 'integrationType'
        }]
      });
      
      if (!taskLink) {
        return null;
      }
      
      return {
        id: taskLink.id,
        task_id: taskLink.task_id,
        provider_name: taskLink.integrationType.provider_name,
        external_id: taskLink.external_id,
        external_url: taskLink.external_url,
        created_at: taskLink.created_at,
        updated_at: taskLink.updated_at
      };
    } catch (error) {
      logger.error(`Error getting task link: ${error.message}`, {
        error: error.stack,
        taskId,
        provider
      });
      
      return null;
    }
  }

  /**
   * Сохранение связи задачи с внешней системой
   * @param {number} taskId - ID задачи
   * @param {string} provider - Провайдер интеграции
   * @param {string} externalId - ID задачи во внешней системе
   * @param {string} externalUrl - URL задачи во внешней системе
   * @returns {Promise<object>} - Сохраненная связь
   */
  async saveTaskLink(taskId, provider, externalId, externalUrl) {
    try {
      // Получаем тип интеграции по названию провайдера
      const integrationType = await IntegrationTypeModel.findOne({
        where: { provider_name: provider }
      });
      
      if (!integrationType) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Проверяем, существует ли уже связь
      const existingLink = await TaskExternalLinkModel.findOne({
        where: {
          task_id: taskId,
          integration_type_id: integrationType.id
        }
      });
      
      if (existingLink) {
        // Обновляем существующую связь
        await existingLink.update({
          external_id: externalId,
          external_url: externalUrl
        });
        
        return existingLink;
      } else {
        // Создаем новую связь
        return await TaskExternalLinkModel.create({
          task_id: taskId,
          integration_type_id: integrationType.id,
          external_id: externalId,
          external_url: externalUrl
        });
      }
    } catch (error) {
      logger.error(`Error saving task link: ${error.message}`, {
        error: error.stack,
        taskId,
        provider,
        externalId
      });
      
      throw error;
    }
  }

  /**
   * Импорт задач из внешней системы в проект
   * @param {number} projectId - ID проекта
   * @param {string} provider - Провайдер интеграции
   * @param {object} options - Опции импорта
   * @returns {Promise<object>} - Результат импорта
   */
  async importTasksFromExternalSystem(projectId, provider, options = {}) {
    try {
      // Проверяем наличие интеграции с указанным провайдером
      if (!this.providers[provider]) {
        throw new Error(`Unknown integration provider: ${provider}`);
      }
      
      // Получаем конфигурацию интеграции
      const config = await this.getIntegrationConfig(projectId, provider);
      if (!config) {
        throw new Error(`Integration config not found for project ${projectId}, provider ${provider}`);
      }
      
      // Импортируем задачи из внешней системы
      const importedTasks = await this.providers[provider].importTasks(projectId, config, options);
      
      // Создаем локальные задачи и сохраняем связи
      const results = [];
      
      for (const externalTask of importedTasks) {
        try {
          // Преобразуем внешнюю задачу в формат локальной
          const mappedTask = await this.providers[provider].mapExternalTaskToLocal(externalTask, config);
          
          // Добавляем project_id
          mappedTask.project_id = projectId;
          
          // Создаем локальную задачу
          const task = await TaskModel.create(mappedTask);
          
          // Сохраняем связь с внешней задачей
          await this.saveTaskLink(task.id, provider, externalTask.id, externalTask.url);
          
          results.push({
            success: true,
            taskId: task.id,
            externalId: externalTask.id,
            title: task.title
          });
        } catch (e) {
          results.push({
            success: false,
            externalId: externalTask.id,
            title: externalTask.title || externalTask.name || 'Unknown',
            error: e.message
          });
        }
      }
      
      return {
        totalImported: results.filter(r => r.success).length,
        totalFailed: results.filter(r => !r.success).length,
        results
      };
    } catch (error) {
      logger.error(`Error importing tasks from external system: ${error.message}`, {
        error: error.stack,
        projectId,
        provider
      });
      
      throw error;
    }
  }
}

module.exports = new ProjectManagementIntegration();
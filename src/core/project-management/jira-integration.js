// src/core/project-management/jira-integration.js
const logger = require('../../utils/logger');
const axios = require('axios');
const { UserModel } = require('../../models');

/**
 * Интеграция с JIRA
 */
class JiraIntegration {
  /**
   * Создание запроса к JIRA API
   * @param {string} method - HTTP метод
   * @param {string} endpoint - Эндпоинт API
   * @param {object} config - Конфигурация интеграции
   * @param {object} data - Данные запроса (для POST/PUT)
   * @returns {Promise<object>} - Ответ API
   */
  async request(method, endpoint, config, data = null) {
    try {
      const { baseUrl, email, apiToken, project } = config;
      
      // Базовые заголовки для всех запросов
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      // Базовая аутентификация
      const auth = {
        username: email,
        password: apiToken
      };
      
      // Формируем полный URL
      const url = `${baseUrl}/rest/api/3${endpoint}`;
      
      // Выполняем запрос
      const response = await axios({
        method,
        url,
        auth,
        headers,
        data
      });
      
      return response.data;
    } catch (error) {
      // Если ошибка содержит ответ от сервера, логируем его
      if (error.response) {
        logger.error(`JIRA API error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
        throw new Error(`JIRA API error (${error.response.status}): ${error.response.data.errorMessages ? error.response.data.errorMessages.join(', ') : 'Unknown error'}`);
      }
      
      // Иначе логируем общую ошибку
      logger.error(`JIRA API request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Создание задачи в JIRA
   * @param {object} task - Объект задачи
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Результат создания
   */
  async createTask(task, config) {
    try {
      // Преобразуем задачу BIZ360 в формат JIRA
      const jiraIssue = this.mapTaskToJiraIssue(task, config);
      
      // Создаем задачу в JIRA
      const response = await this.request('POST', '/issue', config, jiraIssue);
      
      // Получаем созданную задачу
      const createdIssue = await this.request('GET', `/issue/${response.key}`, config);
      
      return {
        success: true,
        externalId: createdIssue.id,
        externalKey: createdIssue.key,
        externalUrl: `${config.baseUrl}/browse/${createdIssue.key}`,
        externalData: createdIssue
      };
    } catch (error) {
      logger.error(`Error creating JIRA issue: ${error.message}`, {
        error: error.stack,
        taskId: task.id
      });
      
      throw error;
    }
  }

  /**
   * Обновление задачи в JIRA
   * @param {object} task - Объект задачи
   * @param {string} externalId - ID задачи в JIRA
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Результат обновления
   */
  async updateTask(task, externalId, config) {
    try {
      // Получаем текущую задачу из JIRA
      const jiraIssue = await this.request('GET', `/issue/${externalId}`, config);
      
      // Преобразуем задачу BIZ360 в формат JIRA (только для обновления)
      const jiraUpdate = this.mapTaskToJiraUpdate(task, jiraIssue, config);
      
      // Обновляем задачу в JIRA
      await this.request('PUT', `/issue/${externalId}`, config, jiraUpdate);
      
      // Получаем обновленную задачу
      const updatedIssue = await this.request('GET', `/issue/${externalId}`, config);
      
      return {
        success: true,
        externalId: updatedIssue.id,
        externalKey: updatedIssue.key,
        externalUrl: `${config.baseUrl}/browse/${updatedIssue.key}`,
        externalData: updatedIssue
      };
    } catch (error) {
      logger.error(`Error updating JIRA issue: ${error.message}`, {
        error: error.stack,
        taskId: task.id,
        externalId
      });
      
      throw error;
    }
  }

  /**
   * Получение задачи из JIRA
   * @param {string} externalId - ID задачи в JIRA
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Задача из JIRA
   */
  async getTask(externalId, config) {
    try {
      // Получаем задачу из JIRA
      return await this.request('GET', `/issue/${externalId}`, config);
    } catch (error) {
      logger.error(`Error getting JIRA issue: ${error.message}`, {
        error: error.stack,
        externalId
      });
      
      throw error;
    }
  }

  /**
   * Импорт задач из JIRA в проект
   * @param {number} projectId - ID проекта
   * @param {object} config - Конфигурация интеграции
   * @param {object} options - Опции импорта
   * @returns {Promise<Array>} - Импортированные задачи
   */
  async importTasks(projectId, config, options = {}) {
    try {
      const { jiraProject, maxResults = 50, startAt = 0, status } = options;
      
      // Формируем JQL запрос
      let jql = `project = "${jiraProject || config.project}"`;
      
      // Добавляем фильтр по статусу, если указан
      if (status) {
        jql += ` AND status = "${status}"`;
      }
      
      // Получаем задачи из JIRA
      const response = await this.request('GET', `/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&startAt=${startAt}`, config);
      
      return response.issues;
    } catch (error) {
      logger.error(`Error importing tasks from JIRA: ${error.message}`, {
        error: error.stack,
        projectId
      });
      
      throw error;
    }
  }

  /**
   * Преобразование задачи BIZ360 в формат JIRA для создания
   * @param {object} task - Объект задачи
   * @param {object} config - Конфигурация интеграции
   * @returns {object} - Задача в формате JIRA
   */
  mapTaskToJiraIssue(task, config) {
    const { project, issueType = 'Task' } = config;
    
    // Формируем базовую структуру задачи
    const jiraIssue = {
      fields: {
        project: {
          key: project
        },
        issuetype: {
          name: issueType
        },
        summary: task.title,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: task.description || ''
                }
              ]
            }
          ]
        }
      }
    };
    
    // Добавляем приоритет, если указан
    if (task.priority) {
      const priorityMap = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'critical': 'Highest'
      };
      
      jiraIssue.fields.priority = {
        name: priorityMap[task.priority] || 'Medium'
      };
    }
    
    // Добавляем срок выполнения, если указан
    if (task.due_date) {
      jiraIssue.fields.duedate = task.due_date.toISOString().split('T')[0];
    }
    
    return jiraIssue;
  }

  /**
   * Преобразование задачи BIZ360 в формат JIRA для обновления
   * @param {object} task - Объект задачи
   * @param {object} jiraIssue - Текущая задача в JIRA
   * @param {object} config - Конфигурация интеграции
   * @returns {object} - Обновление в формате JIRA
   */
  mapTaskToJiraUpdate(task, jiraIssue, config) {
    // Формируем обновление задачи
    const jiraUpdate = {
      fields: {}
    };
    
    // Обновляем заголовок, если изменился
    if (task.title !== jiraIssue.fields.summary) {
      jiraUpdate.fields.summary = task.title;
    }
    
    // Обновляем описание, если изменилось
    const currentDescription = jiraIssue.fields.description && jiraIssue.fields.description.content
      ? this.extractTextFromJiraDocument(jiraIssue.fields.description)
      : '';
    
    if (task.description !== currentDescription) {
      jiraUpdate.fields.description = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: task.description || ''
              }
            ]
          }
        ]
      };
    }
    
    // Обновляем приоритет, если изменился
    if (task.priority) {
      const priorityMap = {
        'low': 'Low',
        'medium': 'Medium',
        'high': 'High',
        'critical': 'Highest'
      };
      
      const jiraPriority = priorityMap[task.priority] || 'Medium';
      const currentPriority = jiraIssue.fields.priority ? jiraIssue.fields.priority.name : null;
      
      if (jiraPriority !== currentPriority) {
        jiraUpdate.fields.priority = {
          name: jiraPriority
        };
      }
    }
    
    // Обновляем срок выполнения, если изменился
    if (task.due_date) {
      const dueDate = task.due_date.toISOString().split('T')[0];
      
      if (dueDate !== jiraIssue.fields.duedate) {
        jiraUpdate.fields.duedate = dueDate;
      }
    }
    
    return jiraUpdate;
  }

  /**
   * Преобразование задачи JIRA в формат BIZ360
   * @param {object} jiraIssue - Задача из JIRA
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Задача в формате BIZ360
   */
  async mapExternalTaskToLocal(jiraIssue, config) {
    // Базовая структура задачи
    const task = {
      title: jiraIssue.fields.summary,
      description: jiraIssue.fields.description 
        ? this.extractTextFromJiraDocument(jiraIssue.fields.description)
        : '',
      external_id: jiraIssue.id,
      external_key: jiraIssue.key,
      external_url: `${config.baseUrl}/browse/${jiraIssue.key}`
    };
    
    // Маппинг приоритета
    if (jiraIssue.fields.priority) {
      const priorityMap = {
        'Lowest': 'low',
        'Low': 'low',
        'Medium': 'medium',
        'High': 'high',
        'Highest': 'critical'
      };
      
      task.priority = priorityMap[jiraIssue.fields.priority.name] || 'medium';
    }
    
    // Маппинг статуса
    const statusMap = config.statusMapping || {
      'To Do': 'pending',
      'In Progress': 'in_progress',
      'Done': 'completed'
    };
    
    if (jiraIssue.fields.status) {
      task.status = statusMap[jiraIssue.fields.status.name] || 'pending';
    }
    
    // Добавляем срок выполнения, если указан
    if (jiraIssue.fields.duedate) {
      task.due_date = new Date(jiraIssue.fields.duedate);
    }
    
    // Маппинг исполнителя (если есть)
    if (jiraIssue.fields.assignee && jiraIssue.fields.assignee.emailAddress) {
      // Ищем пользователя по email
      const user = await UserModel.findOne({
        where: { email: jiraIssue.fields.assignee.emailAddress }
      });
      
      if (user) {
        task.assignee_id = user.id;
      }
    }
    
    return task;
  }

  /**
   * Извлечение текста из документа JIRA
   * @param {object} document - Документ JIRA
   * @returns {string} - Извлеченный текст
   */
  extractTextFromJiraDocument(document) {
    let text = '';
    
    // Если документ в формате Atlassian Document Format (ADF)
    if (document && document.content) {
      const extractTextFromNode = (node) => {
        if (node.text) {
          text += node.text;
        }
        
        if (node.content) {
          node.content.forEach(extractTextFromNode);
        }
        
        // Добавляем перенос строки после параграфов и заголовков
        if (['paragraph', 'heading'].includes(node.type)) {
          text += '\n';
        }
      };
      
      document.content.forEach(extractTextFromNode);
    } else if (typeof document === 'string') {
      // Для старого формата (просто строка)
      text = document;
    }
    
    return text.trim();
  }
}

module.exports = new JiraIntegration();
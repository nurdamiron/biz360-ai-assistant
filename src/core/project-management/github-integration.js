// src/core/project-management/github-integration.js
const logger = require('../../utils/logger');
const axios = require('axios');
const { UserModel } = require('../../models');

/**
 * Интеграция с GitHub Issues
 */
class GitHubIntegration {
  /**
   * Создание запроса к GitHub API
   * @param {string} method - HTTP метод
   * @param {string} endpoint - Эндпоинт API
   * @param {object} config - Конфигурация интеграции
   * @param {object} data - Данные запроса (для POST/PUT)
   * @returns {Promise<object>} - Ответ API
   */
  async request(method, endpoint, config, data = null) {
    try {
      const { token, owner, repo } = config;
      
      // Базовые заголовки для всех запросов
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${token}`
      };
      
      // Формируем полный URL
      const url = `https://api.github.com/repos/${owner}/${repo}${endpoint}`;
      
      // Выполняем запрос
      const response = await axios({
        method,
        url,
        headers,
        data
      });
      
      return response.data;
    } catch (error) {
      // Если ошибка содержит ответ от сервера, логируем его
      if (error.response) {
        logger.error(`GitHub API error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
        throw new Error(`GitHub API error (${error.response.status}): ${error.response.data.message || 'Unknown error'}`);
      }
      
      // Иначе логируем общую ошибку
      logger.error(`GitHub API request failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Создание задачи в GitHub Issues
   * @param {object} task - Объект задачи
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Результат создания
   */
  async createTask(task, config) {
    try {
      // Преобразуем задачу BIZ360 в формат GitHub Issue
      const githubIssue = this.mapTaskToGithubIssue(task, config);
      
      // Создаем задачу в GitHub
      const createdIssue = await this.request('POST', '/issues', config, githubIssue);
      
      return {
        success: true,
        externalId: createdIssue.id.toString(),
        externalNumber: createdIssue.number.toString(),
        externalUrl: createdIssue.html_url,
        externalData: createdIssue
      };
    } catch (error) {
      logger.error(`Error creating GitHub issue: ${error.message}`, {
        error: error.stack,
        taskId: task.id
      });
      
      throw error;
    }
  }

  /**
   * Обновление задачи в GitHub Issues
   * @param {object} task - Объект задачи
   * @param {string} externalId - ID задачи в GitHub
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Результат обновления
   */
  async updateTask(task, externalId, config) {
    try {
      // Получаем текущую задачу из GitHub
      const githubIssue = await this.getTask(externalId, config);
      
      // Преобразуем задачу BIZ360 в формат GitHub Issue (только для обновления)
      const githubUpdate = this.mapTaskToGithubUpdate(task, githubIssue, config);
      
      // Обновляем задачу в GitHub
      const updatedIssue = await this.request('PATCH', `/issues/${githubIssue.number}`, config, githubUpdate);
      
      return {
        success: true,
        externalId: updatedIssue.id.toString(),
        externalNumber: updatedIssue.number.toString(),
        externalUrl: updatedIssue.html_url,
        externalData: updatedIssue
      };
    } catch (error) {
      logger.error(`Error updating GitHub issue: ${error.message}`, {
        error: error.stack,
        taskId: task.id,
        externalId
      });
      
      throw error;
    }
  }

  /**
   * Получение задачи из GitHub Issues
   * @param {string} externalId - ID задачи в GitHub
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Задача из GitHub
   */
  async getTask(externalId, config) {
    try {
      // Сначала получаем список задач, чтобы найти номер задачи по ID
      const issues = await this.request('GET', '/issues?state=all', config);
      
      // Ищем задачу по ID
      const issue = issues.find(issue => issue.id.toString() === externalId);
      
      if (!issue) {
        throw new Error(`GitHub issue with ID ${externalId} not found`);
      }
      
      // Получаем задачу по номеру (для получения полной информации)
      return await this.request('GET', `/issues/${issue.number}`, config);
    } catch (error) {
      logger.error(`Error getting GitHub issue: ${error.message}`, {
        error: error.stack,
        externalId
      });
      
      throw error;
    }
  }

  /**
   * Импорт задач из GitHub Issues в проект
   * @param {number} projectId - ID проекта
   * @param {object} config - Конфигурация интеграции
   * @param {object} options - Опции импорта
   * @returns {Promise<Array>} - Импортированные задачи
   */
  async importTasks(projectId, config, options = {}) {
    try {
      const { state = 'open', labels, since, page = 1, perPage = 30 } = options;
      
      // Формируем параметры запроса
      let endpoint = `/issues?state=${state}&page=${page}&per_page=${perPage}`;
      
      if (labels) {
        endpoint += `&labels=${encodeURIComponent(labels)}`;
      }
      
      if (since) {
        endpoint += `&since=${since}`;
      }
      
      // Получаем задачи из GitHub
      return await this.request('GET', endpoint, config);
    } catch (error) {
      logger.error(`Error importing tasks from GitHub: ${error.message}`, {
        error: error.stack,
        projectId
      });
      
      throw error;
    }
  }

  /**
   * Преобразование задачи BIZ360 в формат GitHub Issue для создания
   * @param {object} task - Объект задачи
   * @param {object} config - Конфигурация интеграции
   * @returns {object} - Задача в формате GitHub
   */
  mapTaskToGithubIssue(task, config) {
    // Формируем базовую структуру задачи
    const githubIssue = {
      title: task.title,
      body: task.description || ''
    };
    
    // Добавляем метки в зависимости от приоритета
    const labels = [];
    
    if (task.priority) {
      switch (task.priority) {
        case 'low':
          labels.push('priority:low');
          break;
        case 'medium':
          labels.push('priority:medium');
          break;
        case 'high':
          labels.push('priority:high');
          break;
        case 'critical':
          labels.push('priority:critical');
          break;
      }
    }
    
    // Добавляем метку с типом задачи, если указан
    if (task.task_type) {
      labels.push(`type:${task.task_type}`);
    }
    
    // Добавляем метки из конфигурации, если указаны
    if (config.defaultLabels && Array.isArray(config.defaultLabels)) {
      labels.push(...config.defaultLabels);
    }
    
    if (labels.length > 0) {
      githubIssue.labels = labels;
    }
    
    // Добавляем assignees, если есть назначенный пользователь
    if (task.assignee_username) {
      githubIssue.assignees = [task.assignee_username];
    }
    
    return githubIssue;
  }

  /**
   * Преобразование задачи BIZ360 в формат GitHub Issue для обновления
   * @param {object} task - Объект задачи
   * @param {object} githubIssue - Текущая задача в GitHub
   * @param {object} config - Конфигурация интеграции
   * @returns {object} - Обновление в формате GitHub
   */
  mapTaskToGithubUpdate(task, githubIssue, config) {
    // Формируем обновление задачи
    const githubUpdate = {};
    
    // Обновляем заголовок, если изменился
    if (task.title !== githubIssue.title) {
      githubUpdate.title = task.title;
    }
    
    // Обновляем описание, если изменилось
    if (task.description !== githubIssue.body) {
      githubUpdate.body = task.description || '';
    }
    
    // Обновляем статус, если изменился
    const statusMap = {
      'pending': 'open',
      'in_progress': 'open',
      'completed': 'closed',
      'cancelled': 'closed'
    };
    
    const githubState = statusMap[task.status] || 'open';
    
    if (githubState !== githubIssue.state) {
      githubUpdate.state = githubState;
    }
    
    return githubUpdate;
  }

  /**
   * Преобразование задачи GitHub в формат BIZ360
   * @param {object} githubIssue - Задача из GitHub
   * @param {object} config - Конфигурация интеграции
   * @returns {Promise<object>} - Задача в формате BIZ360
   */
  async mapExternalTaskToLocal(githubIssue, config) {
    // Базовая структура задачи
    const task = {
      title: githubIssue.title,
      description: githubIssue.body || '',
      external_id: githubIssue.id.toString(),
      external_number: githubIssue.number.toString(),
      external_url: githubIssue.html_url
    };
    
    // Маппинг приоритета по меткам
    if (githubIssue.labels && githubIssue.labels.length > 0) {
      // Ищем метки приоритета
      const priorityLabel = githubIssue.labels.find(label => 
        label.name.startsWith('priority:')
      );
      
      if (priorityLabel) {
        const priority = priorityLabel.name.split(':')[1];
        
        // Маппинг приоритетов
        const priorityMap = {
          'low': 'low',
          'medium': 'medium',
          'high': 'high',
          'critical': 'critical'
        };
        
        task.priority = priorityMap[priority] || 'medium';
      }
    }
    
    // Маппинг статуса
    task.status = githubIssue.state === 'open' ? 'in_progress' : 'completed';
    
    // Если в конфигурации указано маппинг статусов по меткам
    if (config.statusMapping && githubIssue.labels) {
      for (const label of githubIssue.labels) {
        if (config.statusMapping[label.name]) {
          task.status = config.statusMapping[label.name];
          break;
        }
      }
    }
    
    // Маппинг исполнителя (если есть)
    if (githubIssue.assignee) {
      // Ищем пользователя по имени пользователя GitHub
      const user = await UserModel.findOne({
        where: { github_username: githubIssue.assignee.login }
      });
      
      if (user) {
        task.assignee_id = user.id;
      }
    }
    
    return task;
  }
}

module.exports = new GitHubIntegration();
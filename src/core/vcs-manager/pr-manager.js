// src/core/vcs-manager/pr-manager.js

const axios = require('axios');
const logger = require('../../utils/logger');
const config = require('../../config/app.config');

/**
 * Класс для работы с Pull Request
 */
class PRManager {
  /**
   * Конструктор менеджера PR
   * @param {string} repoOwner - Владелец репозитория
   * @param {string} repoName - Имя репозитория
   */
  constructor(repoOwner, repoName) {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.token = config.git.token;
    this.apiBaseUrl = 'https://api.github.com';
  }

  /**
   * Создает новый Pull Request
   * @param {string} title - Заголовок PR
   * @param {string} body - Описание PR
   * @param {string} head - Ветка с изменениями
   * @param {string} base - Целевая ветка (обычно main или master)
   * @returns {Promise<Object>} - Созданный Pull Request
   */
  async createPullRequest(title, body, head, base = 'main') {
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        data: {
          title,
          body,
          head,
          base
        }
      });
      
      logger.info(`Создан Pull Request #${response.data.number}: ${title}`);
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при создании Pull Request:`, error.response?.data || error.message);
      throw new Error(`Failed to create PR: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Получает информацию о Pull Request
   * @param {number} prNumber - Номер PR
   * @returns {Promise<Object>} - Информация о PR
   */
  async getPullRequest(prNumber) {
    try {
      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при получении информации о PR #${prNumber}:`, error.response?.data || error.message);
      throw new Error(`Failed to get PR: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Получает комментарии к Pull Request
   * @param {number} prNumber - Номер PR
   * @returns {Promise<Array<Object>>} - Список комментариев
   */
  async getPullRequestComments(prNumber) {
    try {
      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/comments`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при получении комментариев к PR #${prNumber}:`, error.response?.data || error.message);
      throw new Error(`Failed to get PR comments: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Добавляет комментарий к Pull Request
   * @param {number} prNumber - Номер PR
   * @param {string} body - Текст комментария
   * @returns {Promise<Object>} - Созданный комментарий
   */
  async addPullRequestComment(prNumber, body) {
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/issues/${prNumber}/comments`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        data: { body }
      });
      
      logger.info(`Добавлен комментарий к PR #${prNumber}`);
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при добавлении комментария к PR #${prNumber}:`, error.response?.data || error.message);
      throw new Error(`Failed to add comment: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Обновляет Pull Request
   * @param {number} prNumber - Номер PR
   * @param {Object} data - Данные для обновления (title, body, state)
   * @returns {Promise<Object>} - Обновленный PR
   */
  async updatePullRequest(prNumber, data) {
    try {
      const response = await axios({
        method: 'PATCH',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        data
      });
      
      logger.info(`Обновлен Pull Request #${prNumber}`);
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при обновлении PR #${prNumber}:`, error.response?.data || error.message);
      throw new Error(`Failed to update PR: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Закрывает Pull Request
   * @param {number} prNumber - Номер PR
   * @returns {Promise<Object>} - Закрытый PR
   */
  async closePullRequest(prNumber) {
    try {
      return await this.updatePullRequest(prNumber, { state: 'closed' });
    } catch (error) {
      logger.error(`Ошибка при закрытии PR #${prNumber}:`, error);
      throw error;
    }
  }

  /**
   * Мерджит Pull Request
   * @param {number} prNumber - Номер PR
   * @param {string} commitMessage - Сообщение для коммита слияния
   * @returns {Promise<Object>} - Результат мерджа
   */
  async mergePullRequest(prNumber, commitMessage) {
    try {
      const response = await axios({
        method: 'PUT',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls/${prNumber}/merge`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        data: {
          commit_title: commitMessage,
          merge_method: 'merge'
        }
      });
      
      logger.info(`Pull Request #${prNumber} успешно смерджен`);
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при мердже PR #${prNumber}:`, error.response?.data || error.message);
      throw new Error(`Failed to merge PR: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Получает список Pull Request для репозитория
   * @param {string} state - Статус PR (open, closed, all)
   * @returns {Promise<Array<Object>>} - Список PR
   */
  async listPullRequests(state = 'open') {
    try {
      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/pulls`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: { state }
      });
      
      return response.data;
    } catch (error) {
      logger.error(`Ошибка при получении списка PR:`, error.response?.data || error.message);
      throw new Error(`Failed to list PRs: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Проверяет, прошли ли все проверки для PR
   * @param {number} prNumber - Номер PR
   * @returns {Promise<boolean>} - Результат проверки
   */
  async checkPullRequestStatus(prNumber) {
    try {
      // Получаем список проверок для PR
      const pr = await this.getPullRequest(prNumber);
      const sha = pr.head.sha;
      
      const response = await axios({
        method: 'GET',
        url: `${this.apiBaseUrl}/repos/${this.repoOwner}/${this.repoName}/commits/${sha}/check-runs`,
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      const checkRuns = response.data.check_runs;
      
      // Проверяем, все ли проверки успешны
      const allPassed = checkRuns.every(check => check.conclusion === 'success');
      
      return allPassed;
    } catch (error) {
      logger.error(`Ошибка при проверке статуса PR #${prNumber}:`, error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Создает сообщение для PR на основе выполненной задачи
   * @param {Object} task - Задача, для которой создается PR
   * @param {Array<Object>} changedFiles - Список измененных файлов
   * @returns {Object} - Заголовок и описание PR
   */
  createPullRequestMessage(task, changedFiles) {
    const title = `[AI] ${task.title}`;
    
    let body = `## Описание\n${task.description}\n\n`;
    
    body += `## Изменения\n`;
    
    if (changedFiles && changedFiles.length > 0) {
      body += `Изменены следующие файлы:\n\n`;
      changedFiles.forEach(file => {
        body += `- \`${file}\`\n`;
      });
    } else {
      body += `Нет изменений в файлах.`;
    }
    
    body += `\n\n---\nЭтот PR был автоматически создан ИИ-ассистентом для задачи #${task.id}`;
    
    return { title, body };
  }
}

module.exports = PRManager;
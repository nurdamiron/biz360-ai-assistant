// src/utils/git-utils.js

/**
 * Утилиты для работы с Git
 */

/**
 * Парсит URL репозитория для получения имени владельца и репозитория
 * @param {string} repositoryUrl - URL репозитория
 * @returns {Object} - Объект с информацией о репозитории { owner, repo }
 */
function parseRepositoryUrl(repositoryUrl) {
    try {
      // Очищаем URL от протокола и расширения .git
      let cleanUrl = repositoryUrl.replace(/^(https?:\/\/|git@)/, '');
      cleanUrl = cleanUrl.replace(/\.git$/, '');
      
      // Обрабатываем разные форматы URL
      if (cleanUrl.includes('@')) {
        // SSH формат: git@github.com:owner/repo
        const parts = cleanUrl.split(':');
        const [owner, repo] = parts[1].split('/');
        return { owner, repo };
      } else if (cleanUrl.includes('/')) {
        // HTTPS формат: github.com/owner/repo
        const parts = cleanUrl.split('/');
        // Находим первые две части после домена
        let ownerIndex = -1;
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].includes('.')) {
            ownerIndex = i + 1;
            break;
          }
        }
        
        if (ownerIndex >= 0 && ownerIndex < parts.length - 1) {
          return {
            owner: parts[ownerIndex],
            repo: parts[ownerIndex + 1]
          };
        }
      }
      
      // Если не удалось распарсить, возвращаем undefined
      return { owner: undefined, repo: undefined };
    } catch (error) {
      console.error('Ошибка при парсинге URL репозитория:', error);
      return { owner: undefined, repo: undefined };
    }
  }
  
  /**
   * Генерирует имя ветки на основе названия задачи и её ID
   * @param {number} taskId - ID задачи
   * @param {string} taskTitle - Название задачи
   * @returns {string} - Имя ветки
   */
  function generateBranchName(taskId, taskTitle) {
    // Очищаем название задачи от специальных символов и нормализуем
    const cleanTitle = taskTitle.toLowerCase()
      .replace(/[^a-zа-я0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 30);
    
    return `task-${taskId}-${cleanTitle}`;
  }
  
  /**
   * Форматирует сообщение коммита на основе названия задачи и её ID
   * @param {number} taskId - ID задачи
   * @param {string} taskTitle - Название задачи
   * @returns {string} - Сообщение коммита
   */
  function formatCommitMessage(taskId, taskTitle) {
    return `[Task #${taskId}] ${taskTitle}`;
  }
  
  /**
   * Проверяет, является ли строка валидным SHA хешем коммита
   * @param {string} hash - Хеш для проверки
   * @returns {boolean} - Результат проверки
   */
  function isValidCommitHash(hash) {
    // Проверяем, что хеш состоит только из шестнадцатеричных символов
    // и имеет правильную длину (40 символов для полного SHA-1 хеша)
    return /^[0-9a-f]{40}$/i.test(hash) || /^[0-9a-f]{7}$/i.test(hash);
  }
  
  module.exports = {
    parseRepositoryUrl,
    generateBranchName,
    formatCommitMessage,
    isValidCommitHash
  };
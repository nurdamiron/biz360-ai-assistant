// src/core/vcs-manager/pr-manager.js
const GitService = require('./gitService'); // Используем новый GitService
const logger = require('../../utils/logger');
const prDescriptionGenerator = require('./pr-description-generator');
const reviewChecklistGenerator = require('./review-checklist-generator');
const config = require('../../config/app.config');

// ЗАГЛУШКА: Клиент для API Git-хостинга (GitHub/GitLab/...)
// В реальном проекте здесь будет полноценный клиент.
class HostingApiClientStub {
  constructor(repoUrl) {
    this.repoUrl = repoUrl;
    logger.info(`HostingApiClientStub initialized for ${repoUrl || 'default repository'}`);
  }
  async createPR(options) {
    logger.warn(`[Stub] Creating PR on hosting: ${options.title}`);
    // Имитация ответа API
    const prNumber = Math.floor(Math.random() * 10000);
    return {
      id: `pr-${prNumber}`, // Или ID из API
      number: prNumber,
      url: `${this.repoUrl || 'http://example.com'}/pull/${prNumber}`,
      state: 'open',
      title: options.title,
      body: options.body,
      head: { ref: options.headBranch },
      base: { ref: options.baseBranch },
    };
  }
  async getPRInfo(prIdOrNumber) {
     logger.warn(`[Stub] Getting PR info from hosting: ${prIdOrNumber}`);
     return { id: prIdOrNumber, number: prIdOrNumber, url: `${this.repoUrl}/pull/${prIdOrNumber}`, state: 'open', title: 'Stub PR Title', body: 'Stub PR Body' };
  }
   async updatePR(prIdOrNumber, updates) {
     logger.warn(`[Stub] Updating PR ${prIdOrNumber} on hosting with:`, updates);
     return { id: prIdOrNumber, number: prIdOrNumber, url: `${this.repoUrl}/pull/${prIdOrNumber}`, state: updates.state || 'open', title: updates.title || 'Updated Stub Title', body: updates.body || 'Updated Stub Body' };
  }
  async addPRComment(prIdOrNumber, comment) {
      logger.warn(`[Stub] Adding comment to PR ${prIdOrNumber} on hosting: "${comment}"`);
      return { id: `comment-${Math.random()}`, body: comment };
  }
  async mergePR(prIdOrNumber, options) {
       logger.warn(`[Stub] Merging PR ${prIdOrNumber} on hosting with method ${options?.mergeMethod || 'merge'}`);
       return { merged: true, sha: `merged-sha-${Math.random()}` };
  }
  // ... другие методы API
}
// --- Конец заглушки ---

/**
 * Менеджер для работы с Pull Request.
 * Координирует локальные Git-операции и вызовы API хостинга.
 */
class PRManager {
  /** @type {GitService} */
  #gitService;
  /** @type {HostingApiClientStub} */ // Заменить на реальный тип клиента
  #apiClient;
  /** @type {string} */
  #repoPath;
   /** @type {string | undefined} */
  #repositoryUrl; // URL репозитория для API клиента

  /**
   * Создает экземпляр PRManager.
   * @param {string} repoPath - Путь к локальному репозиторию.
   * @param {string} [repositoryUrl] - URL удаленного репозитория (для API).
   * @param {HostingApiClientStub} [apiClient] - Клиент для API хостинга. Если не передан, создается заглушка.
   */
  constructor(repoPath, repositoryUrl, apiClient) {
    if (!repoPath) {
      throw new Error('PRManager requires a repository path.');
    }
    this.#repoPath = repoPath;
    this.#repositoryUrl = repositoryUrl;
    this.#gitService = new GitService(this.#repoPath); // Создаем GitService для этого репозитория
    this.#apiClient = apiClient || new HostingApiClientStub(this.#repositoryUrl); // Используем переданный клиент или заглушку
    logger.info(`PRManager initialized for path: ${this.#repoPath}`);
  }

  /**
   * Проверяет наличие конфликтов перед созданием PR путем имитации слияния.
   * @param {string} baseBranch - Базовая ветка.
   * @param {string} headBranch - Текущая ветка.
   * @returns {Promise<{hasConflicts: boolean, message: string, conflictFiles: string[]}>}
   */
  async #checkConflictsInternal(baseBranch, headBranch) {
    let initialBranch;
    try {
      initialBranch = await this.#gitService.getCurrentBranch();

      // 1. Убедимся, что базовая ветка актуальна
      await this.#gitService.checkout(baseBranch);
      await this.#gitService.pull('origin', baseBranch); // Или использовать fetch + merge/rebase

      // 2. Переключаемся на ветку фичи и обновляем ее из базовой (опционально, но хорошо для актуальности)
      await this.#gitService.checkout(headBranch);
      // Можно добавить merge из baseBranch сюда, если это часть workflow

      // 3. Пробуем слить базовую ветку в текущую БЕЗ коммита и fast-forward
      logger.info(`Checking for conflicts by simulating merge from ${baseBranch} into ${headBranch}`);
      await this.#gitService.merge([baseBranch, '--no-commit', '--no-ff']);

      // Если merge прошел без ошибок (даже если не fast-forward), конфликтов нет
      logger.info('No conflicts detected during simulated merge.');
      // Откатываем merge, так как мы только проверяли
      await this.#gitService.mergeAbort(); // или git reset --merge если merge не упал с ошибкой

      return { hasConflicts: false, message: 'Конфликтов не обнаружено.', conflictFiles: [] };

    } catch (error) {
      // Ошибка merge часто означает конфликты
      const hasConflicts = await this.#gitService.hasMergeConflicts();
      if (hasConflicts) {
        const status = await this.#gitService.status();
        const conflictFiles = status.conflicted;
        const message = `Обнаружены конфликты при слиянии ${baseBranch} в ${headBranch}. Конфликтные файлы: ${conflictFiles.join(', ')}`;
        logger.warn(message);
        // Важно откатить состояние после неудавшегося merge
        try {
          await this.#gitService.mergeAbort();
        } catch (abortError) {
           logger.error('Failed to abort conflicting merge, manual intervention might be needed:', abortError);
           // Попытка reset как запасной вариант
           try { await this.#gitService.getInstance().raw('reset', '--hard', 'HEAD'); } catch (resetErr) {}
        }
        return { hasConflicts: true, message, conflictFiles };
      } else {
        // Другая ошибка во время проверки
        logger.error('Error during conflict check simulation:', error);
        // Попытка вернуться на исходную ветку
        if (initialBranch) {
            try { await this.#gitService.checkout(initialBranch); } catch(checkoutErr) {}
        }
        throw new Error(`Ошибка во время проверки конфликтов: ${error.message}`);
      }
    } finally {
      // Гарантированно пытаемся вернуться на исходную ветку
      if (initialBranch && initialBranch !== await this.#gitService.getCurrentBranch()) {
        try {
          await this.#gitService.checkout(initialBranch);
        } catch (finalCheckoutError) {
          logger.error(`Failed to checkout back to initial branch ${initialBranch}:`, finalCheckoutError);
        }
      }
    }
  }


  /**
   * Создает Pull Request
   * @param {Object} options - Опции для создания PR
   * @param {String} options.baseBranch - Базовая ветка (куда мерджим)
   * @param {String} options.headBranch - Текущая ветка (откуда мерджим)
   * @param {String} options.title - Заголовок PR
   * @param {String} [options.body] - Описание PR (если нет, будет сгенерировано)
   * @param {Boolean} [options.draft=false] - Черновик PR
   * @param {String} [options.taskId] - ID задачи (для генерации описания)
   * @param {String} [options.taskTitle] - Название задачи (для генерации описания)
   * @returns {Promise<Object>} Результат создания PR (включая success, message, url, id, number, conflicts?)
   */
  async createPR(options) {
    try {
      logger.info(`Creating PR from ${options.headBranch} into ${options.baseBranch} in repo ${this.#repoPath}`);

      // 1. Проверяем наличие конфликтов
      const conflictResult = await this.#checkConflictsInternal(options.baseBranch, options.headBranch);

      if (conflictResult.hasConflicts) {
        return {
          success: false,
          message: conflictResult.message,
          conflicts: conflictResult.conflictFiles,
          url: null,
        };
      }

      // 2. Генерируем описание, если не предоставлено
      let prBody = options.body;
      if (!prBody) {
         // prDescriptionGenerator тоже может нуждаться в GitService для получения логов
         // Передаем ему gitService или необходимые данные
         // TODO: Рефакторинг prDescriptionGenerator для приема gitService или repoPath
        prBody = await prDescriptionGenerator.generateDescription({
          baseBranch: options.baseBranch,
          headBranch: options.headBranch,
          taskId: options.taskId,
          taskTitle: options.taskTitle,
          includeChangeList: true,
          gitService: this.#gitService, // Передаем инстанс GitService
          repoPath: this.#repoPath       // Или просто путь
        });
      }

      // 3. Отправляем ветку в origin (важно сделать перед созданием PR)
       await this.#gitService.push('origin', options.headBranch);

      // 4. Создаем PR через API хостинга
      const pr = await this.#apiClient.createPR({
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        title: options.title,
        body: prBody,
        draft: options.draft || false,
      });

      logger.info(`PR successfully created via API: ${pr.url}`);

      return {
        success: true,
        message: 'Pull Request успешно создан',
        url: pr.url,
        id: pr.id, // ID из системы хостинга
        number: pr.number, // Номер PR из системы хостинга
      };
    } catch (error) {
      logger.error('Error creating PR:', error);
      // Можно добавить более специфичную обработку ошибок API
      throw new Error(`Не удалось создать Pull Request: ${error.message}`);
    }
  }

  /**
   * Проверяет наличие конфликтов слияния и анализирует их (публичный метод)
   * @param {Object} options - Опции для проверки
   * @param {String} options.baseBranch - Базовая ветка
   * @param {String} options.headBranch - Текущая ветка
   * @param {Boolean} [options.analyzeConflicts=false] - Нужно ли анализировать конфликты (TODO: интеграция с LLM для анализа)
   * @returns {Promise<Object>} Результат проверки
   */
  async checkMergeConflicts(options) {
      const checkResult = await this.#checkConflictsInternal(options.baseBranch, options.headBranch);
      if (checkResult.hasConflicts && options.analyzeConflicts) {
          logger.warn('Conflict analysis requested but not implemented yet.');
          // TODO: Вызвать LLM для анализа конфликтов, если нужно
          // const analysis = await analyzeConflictsWithLLM(checkResult.conflictFiles, this.#gitService);
          // checkResult.analysis = analysis;
      }
      return checkResult;
  }

  /**
   * Генерирует описание для PR (делегирует генератору)
   * @param {Object} options - Опции для генерации (см. prDescriptionGenerator)
   * @returns {Promise<String>} Сгенерированное описание
   */
  async generatePRDescription(options) {
    try {
      // Передаем GitService или repoPath, если это нужно генератору
      return await prDescriptionGenerator.generateDescription({
          ...options,
          gitService: this.#gitService,
          repoPath: this.#repoPath
      });
    } catch (error) {
      logger.error('Ошибка при генерации описания PR:', error);
      throw new Error(`Не удалось сгенерировать описание PR: ${error.message}`);
    }
  }

  /**
   * Генерирует шаблон для PR (делегирует генератору)
   * @param {Object} options - Опции для генерации (см. prDescriptionGenerator)
   * @returns {Promise<String>} Шаблон для PR
   */
  async generatePRTemplate(options) {
    try {
       // Передаем GitService или repoPath, если это нужно генератору
      return await prDescriptionGenerator.generateTemplate({
          ...options,
          gitService: this.#gitService,
          repoPath: this.#repoPath
      });
    } catch (error) {
      logger.error('Ошибка при генерации шаблона PR:', error);
      throw new Error(`Не удалось сгенерировать шаблон PR: ${error.message}`);
    }
  }

  /**
   * Генерирует чеклист для код-ревью (делегирует генератору)
   * @param {Object} options - Опции для генерации (см. reviewChecklistGenerator)
   * @returns {Promise<Object>} Сгенерированный чеклист
   */
  async generateReviewChecklist(options) {
    try {
      // Передаем GitService или repoPath, если это нужно генератору для анализа изменений
      return await reviewChecklistGenerator.generateChecklist({
          ...options,
          gitService: this.#gitService,
          repoPath: this.#repoPath
      });
    } catch (error) {
      logger.error('Ошибка при генерации чеклиста для код-ревью:', error);
      throw new Error(`Не удалось сгенерировать чеклист: ${error.message}`);
    }
  }

  /**
   * Оценивает PR на основе чеклиста (делегирует генератору)
   * @param {Object} options - Опции для оценки (см. reviewChecklistGenerator)
   * @returns {Promise<Object>} Результат оценки
   */
  async evaluatePR(options) {
    try {
       // Передаем GitService или repoPath, если это нужно генератору для анализа изменений
      return await reviewChecklistGenerator.evaluatePR({
          ...options,
          gitService: this.#gitService,
          repoPath: this.#repoPath
      });
    } catch (error) {
      logger.error('Ошибка при оценке PR:', error);
      throw new Error(`Не удалось оценить PR: ${error.message}`);
    }
  }

  /**
   * Получает информацию о PR через API хостинга.
   * @param {string|number} prIdOrNumber - ID или номер PR.
   * @returns {Promise<Object>} Информация о PR.
   */
  async getPRInfo(prIdOrNumber) {
    try {
      logger.info(`Getting info for PR ${prIdOrNumber} via API`);
      const prInfo = await this.#apiClient.getPRInfo(prIdOrNumber);
      return {
        success: true,
        pr: prInfo,
      };
    } catch (error) {
      logger.error(`Error getting info for PR ${prIdOrNumber}:`, error);
      throw new Error(`Не удалось получить информацию о PR: ${error.message}`);
    }
  }

  /**
   * Обновляет PR через API хостинга.
   * @param {string|number} prIdOrNumber - ID или номер PR.
   * @param {Object} updates - Поля для обновления (title, body, state).
   * @param {string} [updates.title] - Новый заголовок.
   * @param {string} [updates.body] - Новое описание.
   * @param {'open'|'closed'} [updates.state] - Новое состояние.
   * @returns {Promise<Object>} Обновленный PR.
   */
  async updatePR(prIdOrNumber, updates) {
    try {
      logger.info(`Updating PR ${prIdOrNumber} via API with:`, updates);
      const updatedPR = await this.#apiClient.updatePR(prIdOrNumber, updates);
      return {
        success: true,
        message: 'Pull Request успешно обновлен',
        pr: updatedPR,
      };
    } catch (error) {
      logger.error(`Error updating PR ${prIdOrNumber}:`, error);
      throw new Error(`Не удалось обновить Pull Request: ${error.message}`);
    }
  }

  /**
   * Добавляет комментарий к PR через API хостинга.
   * @param {string|number} prIdOrNumber - ID или номер PR.
   * @param {string} comment - Текст комментария.
   * @returns {Promise<Object>} Результат добавления комментария.
   */
  async addPRComment(prIdOrNumber, comment) {
    try {
      logger.info(`Adding comment to PR ${prIdOrNumber} via API`);
      const result = await this.#apiClient.addPRComment(prIdOrNumber, comment);
      return {
        success: true,
        message: 'Комментарий успешно добавлен',
        comment: result,
      };
    } catch (error) {
      logger.error(`Error adding comment to PR ${prIdOrNumber}:`, error);
      throw new Error(`Не удалось добавить комментарий: ${error.message}`);
    }
  }

  /**
   * Мерджит PR через API хостинга.
   * @param {string|number} prIdOrNumber - ID или номер PR.
   * @param {Object} [options] - Опции мерджа.
   * @param {'merge'|'squash'|'rebase'} [options.mergeMethod] - Метод мерджа.
   * @param {string} [options.commitTitle] - Заголовок коммита.
   * @param {string} [options.commitMessage] - Сообщение коммита.
   * @returns {Promise<Object>} Результат мерджа.
   */
  async mergePR(prIdOrNumber, options) {
    try {
      logger.info(`Merging PR ${prIdOrNumber} via API`);
      const result = await this.#apiClient.mergePR(prIdOrNumber, options);
      return {
        success: true,
        message: 'Pull Request успешно смерджен',
        result,
      };
    } catch (error) {
      logger.error(`Error merging PR ${prIdOrNumber}:`, error);
      throw new Error(`Не удалось смерджить Pull Request: ${error.message}`);
    }
  }
}

// Экспортируем КЛАСС, а не инстанс
module.exports = PRManager;
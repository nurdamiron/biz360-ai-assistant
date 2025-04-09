// src/core/vcs-manager/gitService.js
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../../utils/logger'); // Предполагаем, что логгер есть

// Опции для simple-git, можно вынести в конфиг при необходимости
const gitOptions = {
  baseDir: process.cwd(), // Базовая директория для git команд
  binary: 'git',
  maxConcurrentProcesses: 6,
};

/**
 * @typedef {import('simple-git').SimpleGit} SimpleGit
 * @typedef {import('simple-git').CloneOptions} CloneOptions
 * @typedef {import('simple-git').CommitResult} CommitResult
 * @typedef {import('simple-git').PullResult} PullResult
 * @typedef {import('simple-git').PushResult} PushResult
 * @typedef {import('simple-git').BranchSummary} BranchSummary
 * @typedef {import('simple-git').DiffResult} DiffResult
 */

/**
 * Сервис для инкапсуляции взаимодействия с Git.
 * Обеспечивает унифицированный интерфейс для Git-операций в проекте.
 */
class GitService {
  /** @type {SimpleGit} */
  #git;
  /** @type {string} */
  #repoPath;

  /**
   * Создает экземпляр GitService для конкретного репозитория.
   * @param {string} repoPath - Путь к локальному репозиторию.
   */
  constructor(repoPath) {
    if (!repoPath) {
      throw new Error('GitService requires a repository path.');
    }
    this.#repoPath = repoPath;
    // Убедимся, что директория существует, прежде чем инициализировать simple-git
    // Note: simple-git может сам создавать директорию при клонировании,
    // но для операций в существующем репо путь должен быть валидным.
    // Проверку на существование можно добавить в конкретные методы, если нужно.
    this.#git = simpleGit({ ...gitOptions, baseDir: this.#repoPath });
    logger.info(`GitService initialized for path: ${this.#repoPath}`);
  }

  /**
   * Получает экземпляр simple-git для прямого использования (если необходимо).
   * @returns {SimpleGit}
   */
  getInstance() {
    return this.#git;
  }

  /**
   * Проверяет, инициализирован ли репозиторий Git по указанному пути.
   * @returns {Promise<boolean>}
   */
  async isRepo() {
    try {
      const result = await this.#git.checkIsRepo();
      logger.info(`Checked if repo at ${this.#repoPath}. Is repo: ${result}`);
      return result;
    } catch (error) {
      logger.error(`Error checking if repo at ${this.#repoPath}: ${error.message}`);
      // Если директории нет или это не git репо, checkIsRepo может кидать ошибку
      return false;
    }
  }

  /**
   * Клонирует репозиторий.
   * @param {string} repoUrl - URL удаленного репозитория.
   * @param {string} localPath - Локальный путь для клонирования (переопределяет path конструктора для этой операции).
   * @param {CloneOptions | undefined} [options] - Дополнительные опции клонирования (например, --depth).
   * @returns {Promise<void>}
   */
  async clone(repoUrl, localPath, options) {
    const cloneGit = simpleGit(gitOptions); // Используем новый инстанс для клонирования
    try {
      logger.info(`Cloning ${repoUrl} into ${localPath}`);
      await cloneGit.clone(repoUrl, localPath, options);
      logger.info(`Repository cloned successfully to ${localPath}`);
      // Обновляем путь и инстанс для этого сервиса после клонирования, если нужно
      // this.#repoPath = localPath;
      // this.#git = simpleGit({ ...gitOptions, baseDir: this.#repoPath });
    } catch (error) {
      logger.error(`Error cloning repository ${repoUrl} to ${localPath}: ${error.message}`);
      throw error; // Перебрасываем ошибку дальше
    }
  }

  /**
   * Добавляет файлы в индекс Git.
   * @param {string | string[]} files - Файл или массив файлов для добавления (относительно repoPath).
   * @returns {Promise<void>}
   */
  async add(files) {
    try {
      await this.#git.add(files);
      logger.info(`Added files to index in ${this.#repoPath}: ${Array.isArray(files) ? files.join(', ') : files}`);
    } catch (error) {
      logger.error(`Error adding files in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Делает коммит изменений.
   * @param {string} message - Сообщение коммита.
   * @param {string | string[] | undefined} [files] - Файлы для коммита (если не указаны, коммитятся все проиндексированные).
   * @returns {Promise<CommitResult>}
   */
  async commit(message, files) {
    try {
      const commitResult = await this.#git.commit(message, files);
      logger.info(`Committed changes in ${this.#repoPath} with message "${message}". Hash: ${commitResult.commit}`);
      return commitResult;
    } catch (error) {
      logger.error(`Error committing in ${this.#repoPath}: ${error.message}`);
      // Проверяем типичные ошибки коммита (нечего коммитить)
      if (error.message.includes('nothing to commit')) {
         logger.warn(`Commit attempt in ${this.#repoPath}: nothing to commit.`);
         // Можно вернуть "пустой" результат или null, чтобы вызывающий код мог это обработать
         return { commit: '', summary: { changes: 0, insertions: 0, deletions: 0 }, author: null, branch: '' };
      }
      throw error;
    }
  }

  /**
   * Получает изменения из удаленного репозитория.
   * @param {string} [remote='origin'] - Имя удаленного репозитория.
   * @param {string} [branch] - Имя ветки (по умолчанию текущая).
   * @returns {Promise<PullResult>}
   */
  async pull(remote = 'origin', branch) {
    try {
      const currentBranch = branch || (await this.getCurrentBranch());
      logger.info(`Pulling changes from ${remote}/${currentBranch} into ${this.#repoPath}`);
      const pullResult = await this.#git.pull(remote, currentBranch);
      logger.info(`Pull completed in ${this.#repoPath}: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions.`);
      return pullResult;
    } catch (error) {
      logger.error(`Error pulling changes in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

   /**
   * Отправляет изменения в удаленный репозиторий.
   * @param {string} [remote='origin'] - Имя удаленного репозитория.
   * @param {string} [branch] - Имя ветки (по умолчанию текущая).
   * @param {string[]} [options] - Дополнительные опции push (например, ['--force']).
   * @returns {Promise<PushResult>}
   */
   async push(remote = 'origin', branch, options = []) {
    try {
      const currentBranch = branch || (await this.getCurrentBranch());
      logger.info(`Pushing changes from ${this.#repoPath} to ${remote}/${currentBranch}`);
      const pushResult = await this.#git.push(remote, currentBranch, options);
      logger.info(`Push completed from ${this.#repoPath} to ${remote}/${currentBranch}.`);
      return pushResult;
    } catch (error) {
      logger.error(`Error pushing changes from ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Переключается на указанную ветку.
   * @param {string} branchName - Имя ветки.
   * @returns {Promise<void>}
   */
  async checkout(branchName) {
    try {
      await this.#git.checkout(branchName);
      logger.info(`Checked out branch '${branchName}' in ${this.#repoPath}`);
    } catch (error) {
      logger.error(`Error checking out branch '${branchName}' in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Создает новую ветку и опционально переключается на нее.
   * @param {string} branchName - Имя новой ветки.
   * @param {boolean} [checkout=false] - Переключиться ли на созданную ветку.
   * @returns {Promise<void>}
   */
  async createBranch(branchName, checkoutBranch = false) {
    try {
      if (checkoutBranch) {
        await this.#git.checkoutLocalBranch(branchName);
        logger.info(`Created and checked out new branch '${branchName}' in ${this.#repoPath}`);
      } else {
        await this.#git.branch([branchName]);
         logger.info(`Created new branch '${branchName}' in ${this.#repoPath}`);
      }
    } catch (error) {
      logger.error(`Error creating branch '${branchName}' in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получает имя текущей ветки.
   * @returns {Promise<string>}
   */
  async getCurrentBranch() {
    try {
      const branchSummary = await this.#git.branchLocal();
      return branchSummary.current;
    } catch (error) {
      logger.error(`Error getting current branch in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

   /**
   * Получает список всех локальных веток.
   * @returns {Promise<BranchSummary>}
   */
  async listBranches() {
    try {
      const branches = await this.#git.branchLocal();
      logger.info(`Listed local branches in ${this.#repoPath}: ${branches.all.join(', ')}`);
      return branches;
    } catch (error) {
      logger.error(`Error listing branches in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получает статус репозитория.
   * @returns {Promise<import('simple-git').StatusResult>}
   */
  async status() {
    try {
      const statusResult = await this.#git.status();
      return statusResult;
    } catch (error) {
      logger.error(`Error getting status in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получает дифф изменений.
   * @param {string[]} [options] - Опции для команды diff (e.g., ['HEAD~1']).
   * @returns {Promise<string>} - Строка с результатом diff.
   */
  async diff(options = []) {
    try {
      const diffResult = await this.#git.diff(options);
      return diffResult;
    } catch (error) {
      logger.error(`Error getting diff in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Получает дифф изменений в виде статистики.
   * @param {string[]} [options] - Опции для команды diff (e.g., ['HEAD~1']).
   * @returns {Promise<DiffResult>} - Объект с результатом diff --stat.
   */
  async diffSummary(options = []) {
    try {
      const diffSummaryResult = await this.#git.diffSummary(options);
      return diffSummaryResult;
    } catch (error) {
      logger.error(`Error getting diff summary in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Проверяет наличие конфликтов слияния в рабочей директории.
   * @returns {Promise<boolean>} - true, если есть конфликты.
   */
  async hasMergeConflicts() {
    try {
      const status = await this.status();
      // Файлы в состоянии 'conflicted' указывают на конфликты
      return status.conflicted.length > 0;
    } catch (error) {
      logger.error(`Error checking for merge conflicts in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Пытается сделать merge указанной ветки в текущую.
   * Внимание: Этот метод может привести к конфликтам.
   * @param {string} branchName - Ветка для слияния.
   * @returns {Promise<string>} - Результат merge (сообщение git).
   */
  async merge(branchName) {
    try {
      logger.info(`Attempting to merge branch '${branchName}' into current branch in ${this.#repoPath}`);
      const mergeResult = await this.#git.merge([branchName]); // simple-git возвращает строку stdout
      logger.info(`Merge result for branch '${branchName}' in ${this.#repoPath}: ${mergeResult}`);
      return mergeResult;
    } catch (error) {
      // Ошибки слияния (конфликты) обрабатываются иначе
      if (error.git && error.git.failed && error.git.message.includes('CONFLICT')) {
         logger.warn(`Merge conflict occurred when merging '${branchName}' in ${this.#repoPath}. Files: ${error.git.conflicts.map(c => c.file).join(', ')}`);
         // Не перебрасываем ошибку, чтобы вызывающий код мог проверить hasMergeConflicts()
         return error.git.message; // Возвращаем сообщение об ошибке
      }
      logger.error(`Error merging branch '${branchName}' in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

   /**
   * Abort a merge operation that resulted in conflicts.
   * @returns {Promise<string>} - Git command output.
   */
  async mergeAbort() {
    try {
      logger.info(`Aborting merge operation in ${this.#repoPath}`);
      const result = await this.#git.merge(['--abort']);
      logger.info(`Merge aborted successfully in ${this.#repoPath}.`);
      return result;
    } catch (error) {
      logger.error(`Error aborting merge in ${this.#repoPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Выполняет git fetch.
   * @param {string} [remote='origin'] - Удаленный репозиторий.
   * @param {string[]} [options] - Доп. опции (e.g., ['--prune']).
   * @returns {Promise<import('simple-git').FetchResult>}
   */
  async fetch(remote = 'origin', options = []) {
     try {
        logger.info(`Workspaceing from ${remote} for repo ${this.#repoPath}`);
        const fetchResult = await this.#git.fetch(remote, undefined, options);
        logger.info(`Workspace completed for ${remote} in ${this.#repoPath}`);
        return fetchResult;
     } catch (error) {
        logger.error(`Error fetching from ${remote} in ${this.#repoPath}: ${error.message}`);
        throw error;
     }
  }

  // --- Методы, специфичные для PR (могут требовать интеграции с API хостинга) ---
  // Эти методы являются заглушками или упрощенными версиями.
  // Для полноценной работы с PR (GitHub, GitLab) потребуется
  // использовать их REST API через http-клиент (например, axios или node-fetch).

  /**
   * Генерирует описание для Pull Request (заглушка).
   * @param {string} sourceBranch
   * @param {string} targetBranch
   * @returns {Promise<string>}
   */
  async generatePrDescription(sourceBranch, targetBranch) {
    logger.warn('generatePrDescription is a placeholder and needs integration with LLM/template engine.');
    // TODO: Интегрировать с LLM (templates/prompts/pr-template.txt) или шаблонизатором
    const commits = await this.#git.log({ from: targetBranch, to: sourceBranch });
    const commitMessages = commits.all.map(c => `- ${c.message}`).join('\n');
    return `PR from ${sourceBranch} to ${targetBranch}\n\nCommits:\n${commitMessages}`;
  }

  /**
   * Создает Pull Request (заглушка, требует API хостинга).
   * @param {string} title
   * @param {string} body
   * @param {string} headBranch (source)
   * @param {string} baseBranch (target)
   * @returns {Promise<object>} - Информация о созданном PR (зависит от API хостинга).
   */
  async createPullRequest(title, body, headBranch, baseBranch) {
    logger.warn('createPullRequest requires integration with Git hosting API (GitHub, GitLab, etc.).');
    // TODO: Реализовать вызов API хостинга
    // Примерный псевдокод:
    // const hostingApi = new HostingApiClient(...);
    // const prData = await hostingApi.createPR({ title, body, head: headBranch, base: baseBranch });
    // return prData;
    return {
        id: Math.floor(Math.random() * 1000),
        url: `http://example.com/pr/${Math.floor(Math.random() * 1000)}`,
        title,
        headBranch,
        baseBranch,
        status: 'pending_api_integration'
    };
  }

  /**
   * Получает комментарии для PR (заглушка, требует API хостинга).
   * @param {string|number} prId - ID или номер Pull Request.
   * @returns {Promise<Array<object>>} - Массив комментариев.
   */
  async getPrComments(prId) {
    logger.warn('getPrComments requires integration with Git hosting API.');
    // TODO: Реализовать вызов API хостинга
    return [
        { id: 1, author: 'user1', body: 'Placeholder comment 1', createdAt: new Date().toISOString() },
        { id: 2, author: 'user2', body: 'Placeholder comment 2', createdAt: new Date().toISOString() },
    ];
  }
}

// Экспортируем класс
module.exports = GitService;

// --- Пример использования (можно удалить или закомментировать) ---
/*
async function exampleUsage() {
  const repoPath = path.join(__dirname, '../../../..', 'temp-repo-test'); // Пример пути

  // Создадим директорию, если ее нет
  try {
    await fs.mkdir(repoPath, { recursive: true });
  } catch (e) {}

  const gitService = new GitService(repoPath);

  try {
    // Клонируем, если еще не репозиторий
    if (!(await gitService.isRepo())) {
      // Используйте реальный URL репозитория для теста
      // await gitService.clone('https://github.com/user/repo.git', repoPath);
      console.log('Please clone a repository into', repoPath, 'manually for this example or provide a real URL.');
      // Инициализируем пустой репо для примера, если клонирование не удалось
       await simpleGit(gitOptions).init(repoPath);
       console.log('Initialized empty repo for example.');
       // Создадим файл и коммит, чтобы было с чем работать
       await fs.writeFile(path.join(repoPath, 'init.txt'), 'initial content');
       await gitService.add('init.txt');
       await gitService.commit('Initial commit');
    }

    // Выполняем операции
    const status = await gitService.status();
    console.log('Current status:', status.current);
    console.log('Is clean:', status.isClean());

    await gitService.createBranch('feature/test-branch', true);
    console.log('Current branch:', await gitService.getCurrentBranch());

    // Добавляем изменения
    await fs.writeFile(path.join(repoPath, 'test.txt'), `Test content ${Date.now()}`);
    await gitService.add('test.txt');
    await gitService.commit('Add test file');

    // Получаем дифф
    // const diff = await gitService.diff(['HEAD~1']);
    // console.log('\nDiff vs previous commit:\n', diff);

    // Вернемся на main/master (предполагаем, что такая ветка есть)
    try {
        await gitService.checkout('main');
    } catch (e) {
        await gitService.checkout('master'); // Fallback for older repos
    }

  } catch (error) {
    console.error('Example usage failed:', error);
  } finally {
      // Опционально: удалить тестовый репозиторий
      // await fs.rm(repoPath, { recursive: true, force: true });
      // console.log('Cleaned up temp repo.');
  }
}

// exampleUsage(); // Раскомментируйте для запуска примера
*/
// src/core/documentation-updater/doc-generator.js

const path = require('path');
const fs = require('fs').promises;
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const fileUtils = require('../../utils/file-utils');

/**
 * Базовый класс для генерации документации
 */
class DocumentationGenerator {
  /**
   * Создает экземпляр генератора документации
   * @param {Object} options - Опции генерации документации
   * @param {String} options.projectRoot - Корневая папка проекта
   * @param {String} options.outputFormat - Формат выходной документации (markdown, jsdoc, swagger)
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.outputFormat = options.outputFormat || 'markdown';
    this.formatAdapter = this._getFormatAdapter(this.outputFormat);
  }

  /**
   * Получает соответствующий адаптер формата документации
   * @private
   * @param {String} format - Формат документации
   * @returns {Object} Адаптер формата
   */
  _getFormatAdapter(format) {
    try {
      const adapter = require(`./format-adapters/${format}`);
      return new adapter();
    } catch (error) {
      logger.warn(`Адаптер формата ${format} не найден, используется markdown по умолчанию`);
      const MarkdownAdapter = require('./format-adapters/markdown');
      return new MarkdownAdapter();
    }
  }

  /**
   * Генерирует документацию для файла
   * @param {String} filePath - Путь к файлу для документирования
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<String>} Сгенерированная документация
   */
  async generateFileDocumentation(filePath, options = {}) {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.projectRoot, filePath);
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const fileExt = path.extname(filePath).substring(1);
      
      const promptVariables = {
        code: fileContent,
        language: fileExt,
        filePath: filePath,
        outputFormat: this.outputFormat,
        ...options
      };

      const promptText = await promptManager.getPrompt('generate-file-documentation', promptVariables);
      const documentationResult = await llmClient.sendMessage(promptText);

      return this.formatAdapter.processOutput(documentationResult, options);
    } catch (error) {
      logger.error(`Ошибка при генерации документации для файла ${filePath}:`, error);
      throw new Error(`Не удалось сгенерировать документацию для ${filePath}: ${error.message}`);
    }
  }

  /**
   * Генерирует документацию для модуля (папки)
   * @param {String} modulePath - Путь к модулю для документирования
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Результат генерации и документация
   */
  async generateModuleDocumentation(modulePath, options = {}) {
    const absolutePath = path.isAbsolute(modulePath) ? modulePath : path.join(this.projectRoot, modulePath);
    const fileList = await this._getModuleFiles(absolutePath, options.include || ['.js', '.ts']);
    
    logger.info(`Генерация документации для модуля ${modulePath}, найдено ${fileList.length} файлов`);
    
    const docs = {};
    const errors = [];
    
    for (const file of fileList) {
      try {
        const relativePath = path.relative(this.projectRoot, file);
        docs[relativePath] = await this.generateFileDocumentation(file, options);
      } catch (error) {
        errors.push({ file, error: error.message });
        logger.error(`Ошибка при документировании ${file}:`, error);
      }
    }
    
    // Генерация общего обзора модуля, если указано
    if (options.generateOverview) {
      try {
        const fileContents = await Promise.all(
          Object.keys(docs).map(async (file) => {
            const content = await fs.readFile(path.join(this.projectRoot, file), 'utf-8');
            return { file, content };
          })
        );
        
        const promptVariables = {
          modulePath,
          files: fileContents,
          outputFormat: this.outputFormat
        };
        
        const promptText = await promptManager.getPrompt('generate-module-overview', promptVariables);
        const overviewResult = await llmClient.sendMessage(promptText);
        
        docs['_overview.md'] = this.formatAdapter.processOutput(overviewResult, { isOverview: true });
      } catch (error) {
        errors.push({ file: '_overview.md', error: error.message });
        logger.error(`Ошибка при генерации обзора модуля ${modulePath}:`, error);
      }
    }
    
    return {
      module: modulePath,
      docs,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Рекурсивно получает список файлов в модуле
   * @private
   * @param {String} dirPath - Путь к директории
   * @param {Array<String>} extensions - Расширения файлов для включения
   * @returns {Promise<Array<String>>} Список путей к файлам
   */
  async _getModuleFiles(dirPath, extensions) {
    const files = [];
    
    async function scanDir(currentPath) {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          // Пропускаем node_modules, .git и другие специальные директории
          if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            await scanDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    }
    
    await scanDir(dirPath);
    return files;
  }

  /**
   * Сохраняет сгенерированную документацию на диск
   * @param {Object} documentation - Результат генерации документации
   * @param {String} outputDir - Директория для сохранения
   * @returns {Promise<Object>} Результат сохранения
   */
  async saveDocumentation(documentation, outputDir) {
    const docsDir = path.isAbsolute(outputDir) ? outputDir : path.join(this.projectRoot, outputDir);
    
    try {
      await fileUtils.ensureDir(docsDir);
      
      const savedFiles = [];
      
      for (const [filePath, content] of Object.entries(documentation.docs)) {
        const targetPath = path.join(docsDir, filePath.replace(/\.(js|ts)$/, `.${this.formatAdapter.fileExtension}`));
        const targetDir = path.dirname(targetPath);
        
        await fileUtils.ensureDir(targetDir);
        await fs.writeFile(targetPath, content);
        
        savedFiles.push(targetPath);
      }
      
      return {
        status: 'success',
        savedFiles,
        errors: documentation.errors
      };
    } catch (error) {
      logger.error(`Ошибка при сохранении документации:`, error);
      throw new Error(`Не удалось сохранить документацию: ${error.message}`);
    }
  }

  /**
   * Обновляет документацию для изменившихся файлов (на основе git diff)
   * @param {String} since - Временная метка или коммит для diff
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Результат обновления
   */
  async updateDocumentationForChanges(since, options = {}) {
    try {
      const gitUtils = require('../../utils/git-utils');
      const changedFiles = await gitUtils.getChangedFiles(since);
      
      const fileToProcess = changedFiles.filter(file => {
        const ext = path.extname(file);
        return (options.include || ['.js', '.ts']).includes(ext);
      });
      
      logger.info(`Обновление документации для ${fileToProcess.length} изменившихся файлов с ${since}`);
      
      const docs = {};
      const errors = [];
      
      for (const file of fileToProcess) {
        try {
          docs[file] = await this.generateFileDocumentation(file, options);
        } catch (error) {
          errors.push({ file, error: error.message });
        }
      }
      
      return {
        changedFiles: fileToProcess,
        docs,
        errors: errors.length > 0 ? errors : null
      };
    } catch (error) {
      logger.error(`Ошибка при обновлении документации:`, error);
      throw new Error(`Не удалось обновить документацию: ${error.message}`);
    }
  }
}

module.exports = DocumentationGenerator;
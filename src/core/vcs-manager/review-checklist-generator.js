// src/core/vcs-manager/review-checklist-generator.js

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const GitService = require('./git-client');
const fs = require('fs').promises;
const path = require('path');

/**
 * Генератор чеклистов для код-ревью
 */
class ReviewChecklistGenerator {
  /**
   * Генерирует чеклист для код-ревью на основе изменений
   * 
   * @param {Object} options - Опции для генерации чеклиста
   * @param {String} options.baseBranch - Базовая ветка (куда мерджим)
   * @param {String} options.headBranch - Текущая ветка (откуда мерджим)
   * @param {String} options.repositoryUrl - URL репозитория
   * @param {String} options.taskId - ID задачи (если есть)
   * @param {Array<String>} options.fileExtensions - Расширения файлов для включения в анализ
   * @param {Boolean} options.detailedChecklist - Генерировать ли подробный чеклист
   * @returns {Promise<Object>} Сгенерированный чеклист
   */
  async generateChecklist(options) {
    try {
      logger.info(`Генерация чеклиста для код-ревью для ветки ${options.headBranch}`);
      
      // Получаем список измененных файлов
      const changedFiles = await GitService.getChangedFiles(
        options.baseBranch, 
        options.headBranch
      );
      
      // Фильтруем файлы по расширениям, если указаны
      const filesToAnalyze = options.fileExtensions ? 
        changedFiles.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return options.fileExtensions.includes(ext);
        }) : changedFiles;
      
      // Ограничиваем количество файлов для анализа
      const filesForAnalysis = filesToAnalyze.slice(0, 15);
      
      // Получаем содержимое измененных файлов
      const fileContents = await Promise.all(
        filesForAnalysis.map(async (file) => {
          try {
            const diff = await GitService.getFileDiff(
              options.baseBranch, 
              options.headBranch, 
              file
            );
            
            return {
              file,
              diff
            };
          } catch (error) {
            logger.warn(`Не удалось получить diff для ${file}:`, error);
            return {
              file,
              diff: `Не удалось получить diff: ${error.message}`
            };
          }
        })
      );
      
      // Формируем переменные для промпта
      const promptVars = {
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        repositoryUrl: options.repositoryUrl,
        taskId: options.taskId,
        changedFiles,
        fileContents,
        detailedChecklist: options.detailedChecklist,
        // Определяем типы изменений по расширениям файлов
        changes: {
          hasJsChanges: filesToAnalyze.some(f => /\.(js|jsx|ts|tsx)$/.test(f)),
          hasCssChanges: filesToAnalyze.some(f => /\.(css|scss|less)$/.test(f)),
          hasHtmlChanges: filesToAnalyze.some(f => /\.(html|ejs|pug)$/.test(f)),
          hasTestChanges: filesToAnalyze.some(f => /\.(spec|test)\.(js|jsx|ts|tsx)$/.test(f)),
          hasConfigChanges: filesToAnalyze.some(f => /\.(json|yml|yaml|config)$/.test(f)),
          hasBackendChanges: filesToAnalyze.some(f => /\.(php|java|py|rb)$/.test(f))
        }
      };
      
      // Определяем подходящий тип чеклиста
      const promptName = options.detailedChecklist ? 
        'review-checklist-detailed' : 'review-checklist';
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt(promptName, promptVars);
      const result = await llmClient.sendMessage(promptText);
      
      // Если нужен подробный чеклист, генерируем еще и специфичные проверки
      if (options.detailedChecklist && fileContents.length > 0) {
        // Генерируем специфичные проверки для файлов разных типов
        const specificChecks = await this._generateSpecificChecks(fileContents);
        
        return {
          general: result,
          specific: specificChecks
        };
      }
      
      return {
        general: result
      };
    } catch (error) {
      logger.error('Ошибка при генерации чеклиста для код-ревью:', error);
      throw new Error(`Не удалось сгенерировать чеклист: ${error.message}`);
    }
  }
  
  /**
   * Генерирует специфичные проверки для разных типов файлов
   * @private
   * @param {Array<Object>} fileContents - Содержимое измененных файлов
   * @returns {Promise<Object>} Специфичные проверки
   */
  async _generateSpecificChecks(fileContents) {
    const specificChecks = {};
    
    // Группируем файлы по расширениям
    const filesByExt = fileContents.reduce((result, file) => {
      const ext = path.extname(file.file).toLowerCase();
      if (!result[ext]) {
        result[ext] = [];
      }
      result[ext].push(file);
      return result;
    }, {});
    
    // Генерируем проверки для каждого типа файлов
    for (const [ext, files] of Object.entries(filesByExt)) {
      if (files.length === 0) continue;
      
      try {
        // Определяем тип файлов по расширению
        let fileType = 'generic';
        if (/\.(js|jsx|ts|tsx)$/.test(ext)) fileType = 'javascript';
        else if (/\.(css|scss|less)$/.test(ext)) fileType = 'css';
        else if (/\.(html|ejs|pug)$/.test(ext)) fileType = 'html';
        else if (/\.(json|yml|yaml|config)$/.test(ext)) fileType = 'config';
        
        // Формируем переменные для промпта
        const promptVars = {
          fileType,
          extension: ext,
          files
        };
        
        // Получаем текст промпта и отправляем в LLM
        const promptText = await promptManager.getPrompt('review-checklist-specific', promptVars);
        specificChecks[ext] = await llmClient.sendMessage(promptText);
      } catch (error) {
        logger.warn(`Не удалось сгенерировать специфичные проверки для ${ext}:`, error);
        specificChecks[ext] = `Не удалось сгенерировать проверки: ${error.message}`;
      }
    }
    
    return specificChecks;
  }
  
  /**
   * Оценивает PR на основе чеклиста и изменений
   * 
   * @param {Object} options - Опции для оценки
   * @param {String} options.baseBranch - Базовая ветка
   * @param {String} options.headBranch - Текущая ветка
   * @param {String} options.prDescription - Описание PR
   * @param {Object} options.checklist - Чеклист для код-ревью
   * @returns {Promise<Object>} Результат оценки
   */
  async evaluatePR(options) {
    try {
      logger.info(`Оценка PR для ветки ${options.headBranch}`);
      
      // Получаем список измененных файлов
      const changedFiles = await GitService.getChangedFiles(
        options.baseBranch, 
        options.headBranch
      );
      
      // Ограничиваем количество файлов для анализа
      const filesForAnalysis = changedFiles.slice(0, 10);
      
      // Получаем содержимое измененных файлов
      const fileContents = await Promise.all(
        filesForAnalysis.map(async (file) => {
          try {
            const diff = await GitService.getFileDiff(
              options.baseBranch, 
              options.headBranch, 
              file
            );
            
            return {
              file,
              diff
            };
          } catch (error) {
            logger.warn(`Не удалось получить diff для ${file}:`, error);
            return {
              file,
              diff: `Не удалось получить diff: ${error.message}`
            };
          }
        })
      );
      
      // Формируем переменные для промпта
      const promptVars = {
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        prDescription: options.prDescription,
        checklist: options.checklist,
        changedFiles,
        fileContents
      };
      
      // Получаем текст промпта и отправляем в LLM
      const promptText = await promptManager.getPrompt('pr-evaluation', promptVars);
      const result = await llmClient.sendMessage(promptText);
      
      // Парсим результат (предполагаем, что LLM вернет JSON или структурированный текст)
      try {
        // Если результат в формате JSON
        if (result.trim().startsWith('{') && result.trim().endsWith('}')) {
          return JSON.parse(result);
        }
      } catch (e) {
        // Игнорируем ошибку парсинга, вернем как есть
      }
      
      return {
        evaluation: result
      };
    } catch (error) {
      logger.error('Ошибка при оценке PR:', error);
      throw new Error(`Не удалось оценить PR: ${error.message}`);
    }
  }
}

module.exports = new ReviewChecklistGenerator();
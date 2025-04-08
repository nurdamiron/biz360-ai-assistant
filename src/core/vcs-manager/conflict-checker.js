// src/core/vcs-manager/conflict-checker.js

const gitClient = require('./git-client');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Класс для проверки и анализа конфликтов при мердже веток
 */
class ConflictChecker {
  /**
   * Проверяет наличие конфликтов между ветками
   * 
   * @param {Object} options - Опции проверки
   * @param {String} options.baseBranch - Базовая ветка (куда мерджим)
   * @param {String} options.headBranch - Текущая ветка (откуда мерджим)
   * @param {Boolean} options.analyzeConflicts - Нужно ли анализировать конфликты
   * @returns {Promise<Object>} Результат проверки
   */
  async checkConflicts(options) {
    try {
      logger.info(`Проверка конфликтов между ветками ${options.baseBranch} и ${options.headBranch}`);
      
      // Проверяем наличие конфликтов
      const hasConflicts = await gitClient.checkMergeConflicts(
        options.baseBranch, 
        options.headBranch
      );
      
      if (!hasConflicts) {
        return {
          hasConflicts: false,
          message: `Конфликтов между ветками ${options.baseBranch} и ${options.headBranch} не обнаружено`
        };
      }
      
      // Получаем список файлов с конфликтами
      const conflictFiles = await gitClient.getConflictFiles(
        options.baseBranch, 
        options.headBranch
      );
      
      logger.info(`Обнаружены конфликты в ${conflictFiles.length} файлах`);
      
      // Если не нужен анализ, просто возвращаем список файлов
      if (!options.analyzeConflicts) {
        return {
          hasConflicts: true,
          conflictFiles,
          message: `Обнаружены конфликты в ${conflictFiles.length} файлах`
        };
      }
      
      // Анализируем конфликты с помощью LLM
      const analysis = await this._analyzeConflicts(
        options.baseBranch, 
        options.headBranch, 
        conflictFiles
      );
      
      return {
        hasConflicts: true,
        conflictFiles,
        analysis,
        message: `Обнаружены конфликты в ${conflictFiles.length} файлах. Анализ конфликтов доступен.`
      };
    } catch (error) {
      logger.error('Ошибка при проверке конфликтов:', error);
      throw new Error(`Не удалось проверить наличие конфликтов: ${error.message}`);
    }
  }
  
  /**
   * Анализирует конфликты в файлах с помощью LLM
   * @private
   * @param {String} baseBranch - Базовая ветка
   * @param {String} headBranch - Текущая ветка
   * @param {Array<String>} conflictFiles - Список файлов с конфликтами
   * @returns {Promise<Object>} Анализ конфликтов
   */
  async _analyzeConflicts(baseBranch, headBranch, conflictFiles) {
    // Результаты анализа
    const results = {
      summary: '',
      fileAnalysis: {}
    };
    
    try {
      // Для каждого файла получаем содержимое с конфликтами
      const conflictContents = await Promise.all(
        conflictFiles.slice(0, 5).map(async (file) => {
          try {
            // Получаем содержимое файла с конфликтами
            const conflictContent = await gitClient.getFileWithConflicts(
              baseBranch, 
              headBranch, 
              file
            );
            
            // Сохраняем для анализа
            return {
              file,
              content: conflictContent
            };
          } catch (error) {
            logger.warn(`Не удалось получить содержимое с конфликтами для ${file}:`, error);
            return {
              file,
              content: `Не удалось получить содержимое: ${error.message}`
            };
          }
        })
      );
      
      // Анализируем каждый файл с конфликтами
      for (const conflict of conflictContents) {
        if (!conflict.content.includes('<<<<<<<') && 
            !conflict.content.includes('=======') && 
            !conflict.content.includes('>>>>>>>')) {
          results.fileAnalysis[conflict.file] = 'Содержимое файла не содержит маркеров конфликта';
          continue;
        }
        
        // Отправляем промпт для анализа конфликта
        const promptVars = {
          file: conflict.file,
          baseBranch,
          headBranch,
          content: conflict.content
        };
        
        const promptText = await promptManager.getPrompt('conflict-analysis', promptVars);
        const analysis = await llmClient.sendMessage(promptText);
        
        results.fileAnalysis[conflict.file] = analysis;
      }
      
      // Генерируем общую сводку по конфликтам
      if (conflictContents.length > 0) {
        const summaryPromptVars = {
          baseBranch,
          headBranch,
          conflictFiles,
          fileAnalysis: results.fileAnalysis
        };
        
        const summaryPromptText = await promptManager.getPrompt('conflicts-summary', summaryPromptVars);
        results.summary = await llmClient.sendMessage(summaryPromptText);
      }
      
      return results;
    } catch (error) {
      logger.error('Ошибка при анализе конфликтов:', error);
      return {
        error: error.message,
        summary: 'Не удалось выполнить анализ конфликтов'
      };
    }
  }
  
  /**
   * Генерирует предложения по разрешению конфликтов
   * 
   * @param {Object} options - Опции для генерации
   * @param {String} options.baseBranch - Базовая ветка
   * @param {String} options.headBranch - Текущая ветка
   * @param {String} options.file - Файл с конфликтом
   * @param {String} options.content - Содержимое файла с конфликтом
   * @returns {Promise<String>} Предложение по разрешению конфликта
   */
  async generateConflictResolution(options) {
    try {
      logger.info(`Генерация предложения по разрешению конфликта в файле ${options.file}`);
      
      // Отправляем промпт для генерации предложения
      const promptVars = {
        file: options.file,
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        content: options.content
      };
      
      const promptText = await promptManager.getPrompt('conflict-resolution', promptVars);
      const resolution = await llmClient.sendMessage(promptText);
      
      return resolution;
    } catch (error) {
      logger.error('Ошибка при генерации предложения по разрешению конфликта:', error);
      throw new Error(`Не удалось сгенерировать предложение: ${error.message}`);
    }
  }
}

module.exports = new ConflictChecker();
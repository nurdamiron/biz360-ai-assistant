// src/core/feedback-system/comment-processor.js

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const CommentModel = require('../../models/comment.model');

/**
 * Класс для обработки комментариев к коду
 * 
 * Используемые промпты:
 * - templates/prompts/comment-processing.txt
 * - templates/prompts/comment-summarization.txt
 * - templates/prompts/comment-to-task.txt
 */
class CommentProcessor {
  /**
   * Обрабатывает комментарии к коду
   * 
   * @param {Object} options - Опции для обработки
   * @param {Array} options.comments - Массив комментариев
   * @param {String} options.filePath - Путь к файлу
   * @param {String} options.fileContent - Содержимое файла
   * @param {String} options.pullRequestId - ID PR (опционально)
   * @returns {Promise<Object>} Результат обработки
   */
  async processComments(options) {
    try {
      logger.info('Обработка комментариев к коду:', { commentsCount: options.comments.length });
      
      // Сортируем комментарии по дате, чтобы обрабатывать в хронологическом порядке
      const sortedComments = [...options.comments].sort((a, b) => {
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      
      // Обрабатываем каждый комментарий
      const processedComments = await Promise.all(
        sortedComments.map(async (comment) => {
          try {
            return await this._processComment(comment, options);
          } catch (error) {
            logger.warn(`Ошибка при обработке комментария ${comment.id}:`, error);
            return {
              ...comment,
              processed: false,
              error: error.message
            };
          }
        })
      );
      
      // Если есть PR, группируем комментарии по файлам и создаем сводку
      let summary = null;
      if (options.pullRequestId) {
        summary = await this._createPRCommentsSummary({
          comments: processedComments,
          pullRequestId: options.pullRequestId
        });
      }
      
      return {
        processed: processedComments.filter(c => c.processed).length,
        total: processedComments.length,
        comments: processedComments,
        summary
      };
    } catch (error) {
      logger.error('Ошибка при обработке комментариев к коду:', error);
      throw new Error(`Не удалось обработать комментарии: ${error.message}`);
    }
  }
  
  /**
   * Преобразует комментарии в задачи
   * 
   * @param {Object} options - Опции для преобразования
   * @param {Array} options.comments - Массив комментариев
   * @param {String} options.projectId - ID проекта
   * @param {String} options.userId - ID пользователя
   * @returns {Promise<Object>} Результат преобразования
   */
  async createTasksFromComments(options) {
    try {
      logger.info('Создание задач из комментариев к коду');
      
      const TaskModel = require('../../models/task.model');
      const createdTasks = [];
      
      // Группируем комментарии по файлам
      const commentsByFile = options.comments.reduce((result, comment) => {
        if (!comment.filePath) return result;
        
        if (!result[comment.filePath]) {
          result[comment.filePath] = [];
        }
        
        result[comment.filePath].push(comment);
        return result;
      }, {});
      
      // Для каждого файла с комментариями создаем задачу
      for (const [filePath, fileComments] of Object.entries(commentsByFile)) {
        try {
          // Формируем переменные для промпта
          const promptVars = {
            comments: fileComments,
            filePath,
            projectId: options.projectId
          };
          
          // Получаем текст промпта и отправляем в LLM
          const promptText = await promptManager.getPrompt('comment-to-task', promptVars);
          const taskDetails = await llmClient.sendMessage(promptText);
          
          // Парсим результат
          let title = '';
          let description = '';
          
          try {
            if (taskDetails.trim().startsWith('{') && taskDetails.trim().endsWith('}')) {
              const parsed = JSON.parse(taskDetails);
              title = parsed.title || `Задача по файлу ${filePath}`;
              description = parsed.description || '';
            } else {
              // Простой парсинг заголовка и описания
              const titleMatch = taskDetails.match(/title\s*[:=]\s*(.+?)(?:\n|$)/i);
              title = titleMatch ? titleMatch[1].trim() : `Задача по файлу ${filePath}`;
              
              const descriptionMatch = taskDetails.match(/description\s*[:=]\s*(.+?)(?:\n\s*\n|$)/is);
              description = descriptionMatch ? descriptionMatch[1].trim() : '';
            }
          } catch (error) {
            logger.warn('Ошибка парсинга деталей задачи:', error);
            title = `Задача по файлу ${filePath}`;
            description = `Задача создана на основе комментариев к файлу ${filePath}`;
          }
          
          // Создаем задачу
          const task = await TaskModel.create({
            title,
            description,
            priority: 'medium',
            status: 'open',
            projectId: options.projectId,
            userId: options.userId,
            metadata: {
              source: 'comments',
              filePath,
              commentIds: fileComments.map(c => c.id)
            }
          });
          
          // Обновляем комментарии, чтобы они были связаны с задачей
          await Promise.all(
            fileComments.map(comment => 
              CommentModel.update(
                { taskId: task.id },
                { where: { id: comment.id } }
              )
            )
          );
          
          createdTasks.push(task);
        } catch (error) {
          logger.error(`Ошибка при создании задачи для файла ${filePath}:`, error);
        }
      }
      
      return {
        success: true,
        tasksCreated: createdTasks.length,
        tasks: createdTasks
      };
    } catch (error) {
      logger.error('Ошибка при создании задач из комментариев:', error);
      throw new Error(`Не удалось создать задачи: ${error.message}`);
    }
  }
  
  /**
   * Обрабатывает отдельный комментарий
   * @private
   * @param {Object} comment - Комментарий
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Обработанный комментарий
   */
  async _processComment(comment, options) {
    // Формируем переменные для промпта
    const promptVars = {
      comment: comment.text,
      user: comment.user,
      filePath: options.filePath || comment.filePath,
      lineNumber: comment.lineNumber,
      codeContext: this._getCodeContext(options.fileContent, comment.lineNumber)
    };
    
    // Получаем текст промпта и отправляем в LLM
    const promptText = await promptManager.getPrompt('comment-processing', promptVars);
    const processingResult = await llmClient.sendMessage(promptText);
    
    // Пытаемся извлечь структурированные данные из ответа LLM
    let structuredResult = {};
    
    try {
      if (processingResult.trim().startsWith('{') && processingResult.trim().endsWith('}')) {
        structuredResult = JSON.parse(processingResult);
      } else {
        structuredResult = this._extractStructuredData(processingResult);
      }
    } catch (error) {
      logger.warn('Не удалось извлечь структурированные данные из обработки комментария:', error);
      structuredResult = { 
        analysis: processingResult,
        error: 'Не удалось извлечь структурированные данные'
      };
    }
    
    // Обновляем комментарий в БД
    try {
      await CommentModel.update(
        { 
          processed: true,
          analysis: JSON.stringify(structuredResult)
        },
        { where: { id: comment.id } }
      );
    } catch (error) {
      logger.warn(`Ошибка при обновлении комментария ${comment.id} в БД:`, error);
    }
    
    return {
      ...comment,
      processed: true,
      analysis: structuredResult
    };
  }
  
  /**
   * Создает сводку комментариев для PR
   * @private
   * @param {Object} options - Опции для создания сводки
   * @returns {Promise<Object>} Сводка комментариев
   */
  async _createPRCommentsSummary(options) {
    // Группируем комментарии по файлам
    const commentsByFile = options.comments.reduce((result, comment) => {
      if (!comment.filePath) return result;
      
      if (!result[comment.filePath]) {
        result[comment.filePath] = [];
      }
      
      result[comment.filePath].push(comment);
      return result;
    }, {});
    
    // Формируем переменные для промпта
    const promptVars = {
      commentsByFile,
      pullRequestId: options.pullRequestId
    };
    
    // Получаем текст промпта и отправляем в LLM
    const promptText = await promptManager.getPrompt('comment-summarization', promptVars);
    const summaryResult = await llmClient.sendMessage(promptText);
    
    return {
      pullRequestId: options.pullRequestId,
      summary: summaryResult,
      commentsByFile
    };
  }
  
  /**
   * Получает контекст кода для указанной строки
   * @private
   * @param {String} fileContent - Содержимое файла
   * @param {Number} lineNumber - Номер строки
   * @param {Number} contextLines - Количество строк контекста
   * @returns {String} Контекст кода
   */
  _getCodeContext(fileContent, lineNumber, contextLines = 5) {
    if (!fileContent || !lineNumber) return '';
    
    const lines = fileContent.split('\n');
    const start = Math.max(0, lineNumber - contextLines - 1);
    const end = Math.min(lines.length, lineNumber + contextLines);
    
    return lines.slice(start, end).map((line, i) => {
      const num = start + i + 1;
      const marker = num === lineNumber ? '>' : ' ';
      return `${marker} ${num}: ${line}`;
    }).join('\n');
  }
  
  /**
   * Извлекает структурированные данные из текстового ответа
   * @private
   * @param {String} text - Текст ответа
   * @returns {Object} Структурированные данные
   */
  _extractStructuredData(text) {
    const result = {
      type: null,
      severity: null,
      suggestion: null,
      requiresAction: false
    };
    
    // Ищем тип комментария
    const typeMatch = text.match(/(?:type|тип)\s*(?::|\-|=)\s*(\w+)/i);
    if (typeMatch) {
      result.type = typeMatch[1].toLowerCase();
    }
    
    // Ищем серьезность
    const severityMatch = text.match(/(?:severity|серьезность|важность)\s*(?::|\-|=)\s*(\w+)/i);
    if (severityMatch) {
      result.severity = severityMatch[1].toLowerCase();
    }
    
    // Ищем предложение
    const suggestionMatch = text.match(/(?:suggestion|предложение|рекомендация)\s*(?::|\-|=)\s*(.+?)(?:\n\s*\n|$)/is);
    if (suggestionMatch) {
      result.suggestion = suggestionMatch[1].trim();
    }
    
    // Ищем требуется ли действие
    const actionMatch = text.match(/(?:requires action|требуется действие|action required)\s*(?::|\-|=)\s*(yes|no|true|false|да|нет)/i);
    if (actionMatch) {
      const actionValue = actionMatch[1].toLowerCase();
      result.requiresAction = ['yes', 'true', 'да'].includes(actionValue);
    }
    
    return result;
  }
}

module.exports = new CommentProcessor();
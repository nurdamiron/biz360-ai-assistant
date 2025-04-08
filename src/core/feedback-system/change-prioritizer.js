// src/core/feedback-system/change-prioritizer.js

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const FeedbackModel = require('../../models/feedback.model');
const feedbackAnalyzer = require('./feedback-analyzer');

/**
 * Класс для приоритизации изменений на основе обратной связи
 */
class ChangePrioritizer {
  /**
   * Приоритизирует изменения на основе обратной связи
   * 
   * @param {Object} options - Опции для приоритизации
   * @param {Array} options.feedbackItems - Массив обратной связи (если уже получен)
   * @param {Object} options.feedbackFilter - Фильтр для получения обратной связи из БД
   * @param {Number} options.limit - Максимальное количество предложений
   * @returns {Promise<Object>} Приоритизированные изменения
   */
  async prioritizeChanges(options) {
    try {
      logger.info('Приоритизация изменений на основе обратной связи');
      
      // Получаем обратную связь
      let feedbackItems = options.feedbackItems;
      
      if (!feedbackItems && options.feedbackFilter) {
        feedbackItems = await this._getFeedbackByFilter(options.feedbackFilter);
      }
      
      if (!feedbackItems || feedbackItems.length === 0) {
        return {
          message: 'Нет данных обратной связи для приоритизации',
          suggestedChanges: []
        };
      }
      
      // Анализируем обратную связь, если ещё не проанализирована
      const analyzedFeedback = await Promise.all(
        feedbackItems.map(async (item) => {
          if (item.analysis) {
            return item;
          }
          
          try {
            const analysis = await feedbackAnalyzer.analyzeFeedback(item);
            return {
              ...item,
              analysis
            };
          } catch (error) {
            logger.warn(`Не удалось проанализировать обратную связь ${item.id}:`, error);
            return item;
          }
        })
      );
      
      // Группируем схожие предложения
      const groupedSuggestions = await this._groupSimilarSuggestions(analyzedFeedback);
      
      // Приоритизируем изменения с помощью LLM
      const priorityResult = await this._prioritizeSuggestions(groupedSuggestions, options);
      
      // Ограничиваем количество предложений, если нужно
      if (options.limit && priorityResult.suggestedChanges.length > options.limit) {
        priorityResult.suggestedChanges = priorityResult.suggestedChanges.slice(0, options.limit);
      }
      
      return priorityResult;
    } catch (error) {
      logger.error('Ошибка при приоритизации изменений:', error);
      throw new Error(`Не удалось приоритизировать изменения: ${error.message}`);
    }
  }
  
  /**
   * Создает задачи на основе приоритизированных изменений
   * 
   * @param {Object} options - Опции для создания задач
   * @param {Array} options.changes - Приоритизированные изменения
   * @param {String} options.projectId - ID проекта
   * @param {String} options.userId - ID пользователя
   * @returns {Promise<Object>} Результат создания задач
   */
  async createTasksFromChanges(options) {
    try {
      logger.info('Создание задач на основе приоритизированных изменений');
      
      const TaskModel = require('../../models/task.model');
      const createdTasks = [];
      
      // Для каждого изменения создаем задачу
      for (const change of options.changes) {
        try {
          // Формируем переменные для промпта
          const promptVars = {
            change,
            projectId: options.projectId
          };
          
          // Получаем текст промпта и отправляем в LLM для генерации названия и описания задачи
          const promptText = await promptManager.getPrompt('change-to-task', promptVars);
          const taskDetails = await llmClient.sendMessage(promptText);
          
          // Парсим результат
          let title = '';
          let description = '';
          
          try {
            if (taskDetails.trim().startsWith('{') && taskDetails.trim().endsWith('}')) {
              const parsed = JSON.parse(taskDetails);
              title = parsed.title || change.title || 'Новая задача';
              description = parsed.description || change.description || '';
            } else {
              // Простой парсинг заголовка и описания
              const titleMatch = taskDetails.match(/title\s*[:=]\s*(.+?)(?:\n|$)/i);
              title = titleMatch ? titleMatch[1].trim() : (change.title || 'Новая задача');
              
              const descriptionMatch = taskDetails.match(/description\s*[:=]\s*(.+?)(?:\n\s*\n|$)/is);
              description = descriptionMatch ? descriptionMatch[1].trim() : (change.description || '');
            }
          } catch (error) {
            logger.warn('Ошибка парсинга деталей задачи:', error);
            title = change.title || 'Новая задача';
            description = change.description || '';
          }
          
          // Создаем задачу
          const task = await TaskModel.create({
            title,
            description: description || change.description || '',
            priority: change.priority || 'medium',
            status: 'open',
            projectId: options.projectId,
            userId: options.userId,
            metadata: {
              source: 'feedback',
              changeId: change.id,
              feedbackIds: change.feedbackIds || []
            }
          });
          
          createdTasks.push(task);
        } catch (error) {
          logger.error(`Ошибка при создании задачи для изменения:`, error);
        }
      }
      
      return {
        success: true,
        tasksCreated: createdTasks.length,
        tasks: createdTasks
      };
    } catch (error) {
      logger.error('Ошибка при создании задач на основе изменений:', error);
      throw new Error(`Не удалось создать задачи: ${error.message}`);
    }
  }
  
  /**
   * Получает обратную связь по фильтру
   * @private
   * @param {Object} filter - Фильтр для выборки
   * @returns {Promise<Array>} Массив обратной связи
   */
  async _getFeedbackByFilter(filter) {
    try {
      const whereClause = {};
      
      if (filter.startDate && filter.endDate) {
        whereClause.createdAt = {
          [Op.between]: [filter.startDate, filter.endDate]
        };
      }
      
      if (filter.category) {
        whereClause.category = filter.category;
      }
      
      if (filter.minRating || filter.maxRating) {
        whereClause.rating = {};
        
        if (filter.minRating) {
          whereClause.rating[Op.gte] = filter.minRating;
        }
        
        if (filter.maxRating) {
          whereClause.rating[Op.lte] = filter.maxRating;
        }
      }
      
      const feedback = await FeedbackModel.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']],
        limit: filter.limit || 100
      });
      
      return feedback.map(item => item.toJSON());
    } catch (error) {
      logger.error('Ошибка при получении обратной связи из БД:', error);
      return [];
    }
  }
  
  /**
   * Группирует схожие предложения из обратной связи
   * @private
   * @param {Array} feedbackItems - Проанализированная обратная связь
   * @returns {Promise<Array>} Сгруппированные предложения
   */
  async _groupSimilarSuggestions(feedbackItems) {
    // Извлекаем все предложения и проблемы из анализа
    const allSuggestions = [];
    
    feedbackItems.forEach(item => {
      if (item.analysis && item.analysis.structuredAnalysis) {
        const analysis = item.analysis.structuredAnalysis;
        
        // Добавляем предложения
        if (Array.isArray(analysis.suggestions)) {
          analysis.suggestions.forEach(suggestion => {
            allSuggestions.push({
              text: suggestion,
              feedbackId: item.id,
              rating: item.rating,
              type: 'suggestion'
            });
          });
        }
        
        // Добавляем проблемы как предложения (чтобы их тоже учесть)
        if (Array.isArray(analysis.issues)) {
          analysis.issues.forEach(issue => {
            allSuggestions.push({
              text: issue,
              feedbackId: item.id,
              rating: item.rating,
              type: 'issue'
            });
          });
        }
      }
    });
    
    // Если предложений мало, то нет смысла группировать
    if (allSuggestions.length <= 5) {
      return allSuggestions.map(suggestion => ({
        text: suggestion.text,
        count: 1,
        feedbackIds: [suggestion.feedbackId],
        type: suggestion.type
      }));
    }
    
    // Формируем переменные для промпта группировки
    const promptVars = {
      suggestions: allSuggestions
    };
    
    // Получаем текст промпта и отправляем в LLM
    const promptText = await promptManager.getPrompt('group-similar-suggestions', promptVars);
    const groupingResult = await llmClient.sendMessage(promptText);
    
    // Парсим результат
    let groupedSuggestions = [];
    
    try {
      if (groupingResult.trim().startsWith('[') && groupingResult.trim().endsWith(']')) {
        groupedSuggestions = JSON.parse(groupingResult);
      } else {
        logger.warn('Результат группировки предложений не является JSON массивом');
        
        // Попытка извлечь группы из текста
        const groupMatches = groupingResult.match(/Group \d+:[\s\S]*?(?=Group \d+:|$)/g);
        if (groupMatches) {
          groupedSuggestions = groupMatches.map(groupText => {
            const titleMatch = groupText.match(/Group \d+:\s*(.+?)(?:\n|$)/);
            const title = titleMatch ? titleMatch[1].trim() : 'Группа предложений';
            
            const itemMatches = groupText.match(/(?:^|\n)[-•*]\s*(.+?)(?:$|\n)/g);
            const items = itemMatches ? 
              itemMatches.map(match => match.replace(/^[-•*\s]+/, '').trim()) : 
              [];
            
            return {
              text: title,
              items,
              count: items.length,
              feedbackIds: [] // Не можем восстановить ID обратной связи из текста
            };
          });
        }
      }
    } catch (error) {
      logger.error('Ошибка при парсинге результата группировки предложений:', error);
      
      // Возвращаем предложения без группировки
      groupedSuggestions = allSuggestions.map(suggestion => ({
        text: suggestion.text,
        count: 1,
        feedbackIds: [suggestion.feedbackId],
        type: suggestion.type
      }));
    }
    
    return groupedSuggestions;
  }
  
  /**
   * Приоритизирует предложения с помощью LLM
   * @private
   * @param {Array} groupedSuggestions - Сгруппированные предложения
   * @param {Object} options - Дополнительные опции
   * @returns {Promise<Object>} Приоритизированные предложения
   */
  async _prioritizeSuggestions(groupedSuggestions, options) {
    // Формируем переменные для промпта
    const promptVars = {
      suggestions: groupedSuggestions,
      limit: options.limit,
      projectContext: options.projectContext || {}
    };
    
    // Получаем текст промпта и отправляем в LLM
    const promptText = await promptManager.getPrompt('prioritize-changes', promptVars);
    const priorityResult = await llmClient.sendMessage(promptText);
    
    // Парсим результат
    let result = {
      reasoning: '',
      suggestedChanges: []
    };
    
    try {
      if (priorityResult.trim().startsWith('{') && priorityResult.trim().endsWith('}')) {
        result = JSON.parse(priorityResult);
      } else {
        // Извлекаем обоснование и список изменений из текста
        const reasoningMatch = priorityResult.match(/(?:reasoning|обоснование|rationale)[\s:]*\n([\s\S]*?)(?:\n\s*\n|\n\s*(?:suggested changes|предлагаемые изменения|priorities|приоритеты))/i);
        
        if (reasoningMatch) {
          result.reasoning = reasoningMatch[1].trim();
        }
        
        // Извлекаем изменения
        const changesSection = this._extractChangesSection(priorityResult);
        
        if (changesSection) {
          const changeMatches = changesSection.match(/(?:^|\n)(?:\d+\.\s*|\*\s*|[-•]\s*)(.+?)(?:$|\n(?:\d+\.\s*|\*\s*|[-•]\s*|$))/g);
          
          if (changeMatches) {
            result.suggestedChanges = changeMatches.map((match, index) => {
              const changeText = match.replace(/^(?:\d+\.\s*|\*\s*|[-•]\s*)/, '').trim();
              
              // Пытаемся извлечь приоритет из текста
              let priority = 'medium';
              let title = changeText;
              
              const priorityMatch = changeText.match(/\((?:priority|приоритет):\s*(high|medium|low|высокий|средний|низкий)\)/i);
              
              if (priorityMatch) {
                const extractedPriority = priorityMatch[1].toLowerCase();
                priority = this._normalizePriority(extractedPriority);
                title = changeText.replace(priorityMatch[0], '').trim();
              }
              
              return {
                id: `change-${index + 1}`,
                title,
                priority,
                originalSuggestion: groupedSuggestions[index] ? groupedSuggestions[index].text : null,
                count: groupedSuggestions[index] ? groupedSuggestions[index].count : 1,
                feedbackIds: groupedSuggestions[index] ? groupedSuggestions[index].feedbackIds : []
              };
            });
          }
        }
      }
    } catch (error) {
      logger.error('Ошибка при парсинге результата приоритизации:', error);
      
      // Возвращаем простую приоритизацию по количеству
      result.suggestedChanges = groupedSuggestions
        .sort((a, b) => (b.count || 1) - (a.count || 1))
        .map((suggestion, index) => ({
          id: `change-${index + 1}`,
          title: suggestion.text,
          priority: this._calculatePriorityByCount(suggestion.count),
          originalSuggestion: suggestion.text,
          count: suggestion.count || 1,
          feedbackIds: suggestion.feedbackIds || []
        }));
    }
    
    return result;
  }
  
  /**
   * Извлекает секцию изменений из текста
   * @private
   * @param {String} text - Текст результата
   * @returns {String|null} Секция изменений или null
   */
  _extractChangesSection(text) {
    const sectionHeaders = [
      'suggested changes', 'предлагаемые изменения', 
      'priorities', 'приоритеты', 
      'prioritized changes', 'приоритизированные изменения'
    ];
    
    for (const header of sectionHeaders) {
      const regex = new RegExp(`${header}[:\\s-]*\\n([\\s\\S]+)$`, 'i');
      const match = text.match(regex);
      if (match) {
        return match[1].trim();
      }
    }
    
    return null;
  }
  
  /**
   * Нормализует приоритет
   * @private
   * @param {String} priority - Приоритет в разных форматах
   * @returns {String} Нормализованный приоритет (high, medium, low)
   */
  _normalizePriority(priority) {
    const lowPriorities = ['low', 'низкий', 'низкая', 'низко'];
    const highPriorities = ['high', 'высокий', 'высокая', 'высоко'];
    
    if (lowPriorities.includes(priority.toLowerCase())) {
      return 'low';
    }
    
    if (highPriorities.includes(priority.toLowerCase())) {
      return 'high';
    }
    
    return 'medium';
  }
  
  /**
   * Вычисляет приоритет на основе количества повторений
   * @private
   * @param {Number} count - Количество повторений
   * @returns {String} Приоритет (high, medium, low)
   */
  _calculatePriorityByCount(count) {
    if (count >= 5) {
      return 'high';
    }
    
    if (count >= 2) {
      return 'medium';
    }
    
    return 'low';
  }
}

module.exports = new ChangePrioritizer();
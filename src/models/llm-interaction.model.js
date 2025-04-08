/**
 * Модель взаимодействия с LLM
 */
module.exports = (sequelize, DataTypes) => {
    const LlmInteraction = sequelize.define('LlmInteraction', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      task_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tasks',
          key: 'id'
        }
      },
      prompt: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      response: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      model_used: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      tokens_used: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'llm_interactions',
      timestamps: false,
      hooks: {
        afterCreate: async (interaction) => {
          // После создания записи, обновляем дневную статистику использования токенов
          try {
            const { LlmTokenUsage } = require('./index');
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            
            let tokenUsage = await LlmTokenUsage.findOne({
              where: { date: today }
            });
            
            // Разделяем общее количество токенов на токены промпта и ответа (примерное соотношение)
            // В идеале, это должно приходить из API LLM, но сейчас делаем приблизительную оценку
            const promptTokens = Math.round(interaction.tokens_used * 0.3); // ~30% на промпт
            const completionTokens = interaction.tokens_used - promptTokens; // ~70% на ответ
            
            if (tokenUsage) {
              // Обновляем существующую запись
              await tokenUsage.update({
                prompt_tokens: tokenUsage.prompt_tokens + promptTokens,
                completion_tokens: tokenUsage.completion_tokens + completionTokens,
                total_tokens: tokenUsage.total_tokens + interaction.tokens_used,
                models_usage: LlmInteraction._updateModelsUsage(
                  tokenUsage.models_usage, 
                  interaction.model_used, 
                  interaction.tokens_used
                )
              });
            } else {
              // Создаем новую запись
              await LlmTokenUsage.create({
                date: today,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: interaction.tokens_used,
                models_usage: JSON.stringify({
                  [interaction.model_used]: interaction.tokens_used
                })
              });
            }
          } catch (error) {
            const logger = require('../utils/logger');
            logger.error(`Ошибка при обновлении статистики использования токенов: ${error.message}`);
          }
        }
      }
    });
  
    /**
     * Вспомогательный метод для обновления статистики использования моделей
     * @param {string|Object} currentUsage - Текущая статистика использования моделей (JSON или строка)
     * @param {string} model - Использованная модель
     * @param {number} tokens - Количество использованных токенов
     * @returns {string} Обновленная статистика в формате JSON-строки
     */
    LlmInteraction._updateModelsUsage = (currentUsage, model, tokens) => {
      let usage = {};
      
      // Преобразуем текущую статистику в объект
      if (typeof currentUsage === 'string') {
        try {
          usage = JSON.parse(currentUsage);
        } catch (error) {
          usage = {};
        }
      } else if (currentUsage && typeof currentUsage === 'object') {
        usage = currentUsage;
      }
      
      // Обновляем статистику для модели
      usage[model] = (usage[model] || 0) + tokens;
      
      return JSON.stringify(usage);
    };
  
    /**
     * Получает список последних взаимодействий с LLM
     * @param {number} limit - Ограничение количества результатов
     * @returns {Promise<Array>} Список взаимодействий
     */
    LlmInteraction.getLatest = async function(limit = 10) {
      return LlmInteraction.findAll({
        order: [['created_at', 'DESC']],
        limit
      });
    };
  
    /**
     * Получает статистику использования токенов по дням
     * @param {number} days - Количество дней для анализа
     * @returns {Promise<Array>} Статистика по дням
     */
    LlmInteraction.getTokenUsageByDay = async function(days = 30) {
      const { LlmTokenUsage, sequelize } = require('./index');
      
      // Получаем статистику за указанное количество дней
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      return LlmTokenUsage.findAll({
        where: {
          date: {
            [sequelize.Op.gte]: startDate.toISOString().split('T')[0]
          }
        },
        order: [['date', 'ASC']]
      });
    };
  
    /**
     * Получает статистику использования токенов за текущий месяц
     * @returns {Promise<Object>} Статистика за месяц
     */
    LlmInteraction.getCurrentMonthUsage = async function() {
      const { LlmTokenUsage, sequelize } = require('./index');
      
      // Определяем начало текущего месяца
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      
      // Получаем все записи за текущий месяц
      const usageRecords = await LlmTokenUsage.findAll({
        where: {
          date: {
            [sequelize.Op.gte]: startOfMonth.toISOString().split('T')[0]
          }
        }
      });
      
      // Суммируем использование токенов
      const result = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        models: {}
      };
      
      usageRecords.forEach(record => {
        result.prompt_tokens += record.prompt_tokens;
        result.completion_tokens += record.completion_tokens;
        result.total_tokens += record.total_tokens;
        
        // Обновляем статистику по моделям
        try {
          const modelUsage = JSON.parse(record.models_usage);
          
          Object.entries(modelUsage).forEach(([model, tokens]) => {
            result.models[model] = (result.models[model] || 0) + tokens;
          });
        } catch (error) {
          // Игнорируем ошибки разбора JSON
        }
      });
      
      return result;
    };
  
    return LlmInteraction;
  };
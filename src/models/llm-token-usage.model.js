/**
 * Модель для отслеживания использования токенов LLM
 */

/**
 * Создание модели LlmTokenUsage
 * @param {Object} sequelize - Экземпляр Sequelize
 * @param {Object} DataTypes - Типы данных Sequelize
 * @returns {Object} - Модель Sequelize
 */
module.exports = (sequelize, DataTypes) => {
    const LlmTokenUsage = sequelize.define('llm_token_usage', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      llm_interaction_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'llm_interactions',
          key: 'id'
        },
        comment: 'ID связанного взаимодействия с LLM'
      },
      task_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'tasks',
          key: 'id'
        },
        comment: 'ID связанной задачи'
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: 'ID пользователя, если применимо'
      },
      model: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Название модели LLM (например, gpt-4, claude-3)'
      },
      prompt_tokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Количество токенов в запросе'
      },
      completion_tokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Количество токенов в ответе'
      },
      total_tokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Общее количество токенов'
      },
      estimated_cost_usd: {
        type: DataTypes.DECIMAL(10, 6),
        allowNull: true,
        comment: 'Оценочная стоимость запроса в USD'
      },
      operation_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Тип операции (например, task_analysis, code_generation)'
      },
      request_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Уникальный ID запроса к API LLM'
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'llm_token_usage',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['llm_interaction_id'] },
        { fields: ['task_id'] },
        { fields: ['user_id'] },
        { fields: ['model'] },
        { fields: ['operation_type'] },
        { fields: ['created_at'] }
      ]
    });
  
    /**
     * Добавляет запись об использовании токенов
     * @param {Object} usageData - Данные об использовании токенов
     * @returns {Promise<Object>} - Созданная запись
     */
    LlmTokenUsage.logTokenUsage = async function(usageData) {
      try {
        // Вычисляем общее количество токенов, если не указано
        if (!usageData.total_tokens && (usageData.prompt_tokens || usageData.completion_tokens)) {
          usageData.total_tokens = (usageData.prompt_tokens || 0) + (usageData.completion_tokens || 0);
        }
        
        // Создаем запись
        return await this.create(usageData);
      } catch (error) {
        console.error('Ошибка при логировании использования токенов:', error);
        throw error;
      }
    };
  
    /**
     * Получает статистику использования токенов за период
     * @param {Object} options - Параметры запроса
     * @param {Date} options.startDate - Начальная дата периода
     * @param {Date} options.endDate - Конечная дата периода
     * @param {Number} options.taskId - ID задачи (опционально)
     * @param {Number} options.userId - ID пользователя (опционально)
     * @returns {Promise<Object>} - Статистика использования
     */
    LlmTokenUsage.getUsageStats = async function(options) {
      const { startDate, endDate, taskId, userId } = options;
      
      const whereClause = {};
      
      // Добавляем условия фильтрации
      if (startDate && endDate) {
        whereClause.created_at = {
          [sequelize.Sequelize.Op.between]: [startDate, endDate]
        };
      } else if (startDate) {
        whereClause.created_at = {
          [sequelize.Sequelize.Op.gte]: startDate
        };
      } else if (endDate) {
        whereClause.created_at = {
          [sequelize.Sequelize.Op.lte]: endDate
        };
      }
      
      if (taskId) {
        whereClause.task_id = taskId;
      }
      
      if (userId) {
        whereClause.user_id = userId;
      }
      
      // Выполняем запрос
      const [results] = await sequelize.query(`
        SELECT 
          model,
          operation_type,
          SUM(prompt_tokens) as total_prompt_tokens,
          SUM(completion_tokens) as total_completion_tokens,
          SUM(total_tokens) as grand_total_tokens,
          SUM(estimated_cost_usd) as total_cost_usd
        FROM 
          llm_token_usage
        WHERE
          ${Object.keys(whereClause).map(key => {
            if (key === 'created_at') {
              if (whereClause[key][sequelize.Sequelize.Op.between]) {
                return `created_at BETWEEN '${whereClause[key][sequelize.Sequelize.Op.between][0].toISOString()}' AND '${whereClause[key][sequelize.Sequelize.Op.between][1].toISOString()}'`;
              } else if (whereClause[key][sequelize.Sequelize.Op.gte]) {
                return `created_at >= '${whereClause[key][sequelize.Sequelize.Op.gte].toISOString()}'`;
              } else if (whereClause[key][sequelize.Sequelize.Op.lte]) {
                return `created_at <= '${whereClause[key][sequelize.Sequelize.Op.lte].toISOString()}'`;
              }
            } else {
              return `${key} = '${whereClause[key]}'`;
            }
          }).join(' AND ')}
        GROUP BY
          model, operation_type
        ORDER BY
          grand_total_tokens DESC
      `);
      
      // Вычисляем общую сумму
      const totals = {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0
      };
      
      results.forEach(row => {
        totals.totalPromptTokens += parseInt(row.total_prompt_tokens || 0);
        totals.totalCompletionTokens += parseInt(row.total_completion_tokens || 0);
        totals.totalTokens += parseInt(row.grand_total_tokens || 0);
        totals.totalCostUsd += parseFloat(row.total_cost_usd || 0);
      });
      
      return {
        breakdown: results,
        totals
      };
    };
  
    return LlmTokenUsage;
  };
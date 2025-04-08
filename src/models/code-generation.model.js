/**
 * Модель генерации кода
 */
module.exports = (sequelize, DataTypes) => {
    const CodeGeneration = sequelize.define('CodeGeneration', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      task_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'tasks',
          key: 'id'
        }
      },
      file_path: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      original_content: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      generated_content: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM('pending_review', 'approved', 'rejected', 'implemented'),
        defaultValue: 'pending_review'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'code_generations',
      timestamps: false, // Мы управляем полями created_at и updated_at вручную
      hooks: {
        beforeCreate: (generation) => {
          generation.created_at = new Date();
          generation.updated_at = new Date();
        },
        beforeUpdate: (generation) => {
          generation.updated_at = new Date();
        }
      }
    });
  
    /**
     * Дополнительные методы для модели генерации кода
     */
  
    /**
     * Вычисляет разницу между оригинальным и сгенерированным кодом
     * @returns {Object} Объект с информацией о различиях
     */
    CodeGeneration.prototype.getDiff = function() {
      const diff = require('diff');
      
      if (!this.original_content) {
        return {
          type: 'new_file',
          changes: 100, // Новый файл - 100% изменений
          diff: null
        };
      }
      
      // Вычисляем построчную разницу между файлами
      const changes = diff.diffLines(this.original_content, this.generated_content);
      
      // Подсчитываем статистику изменений
      let added = 0;
      let removed = 0;
      let unchanged = 0;
      
      changes.forEach(part => {
        const lines = part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0);
        
        if (part.added) {
          added += lines;
        } else if (part.removed) {
          removed += lines;
        } else {
          unchanged += lines;
        }
      });
      
      const totalLines = added + unchanged + (this.original_content ? removed : 0);
      const changePercentage = Math.round(((added + removed) / totalLines) * 100);
      
      return {
        type: this.original_content ? 'modification' : 'new_file',
        changes: changePercentage,
        added,
        removed,
        unchanged,
        diff: changes
      };
    };
  
    /**
     * Получает все тесты, связанные с этой генерацией кода
     * @returns {Promise<Array>} Тесты для генерации
     */
    CodeGeneration.prototype.getTests = async function() {
      const { Test } = require('./index');
      
      return Test.findAll({
        where: { code_generation_id: this.id },
        order: [['created_at', 'ASC']]
      });
    };
  
    /**
     * Получает все отзывы о генерации кода
     * @returns {Promise<Array>} Отзывы о генерации
     */
    CodeGeneration.prototype.getFeedback = async function() {
      const { Feedback } = require('./index');
      
      return Feedback.findAll({
        where: { code_generation_id: this.id },
        order: [['created_at', 'DESC']]
      });
    };
  
    /**
     * Добавляет отзыв о генерации кода
     * @param {string} feedbackText - Текст отзыва
     * @param {number} rating - Оценка (1-5)
     * @param {number} userId - ID пользователя
     * @returns {Promise<Object>} Созданный отзыв
     */
    CodeGeneration.prototype.addFeedback = async function(feedbackText, rating, userId) {
      const { Feedback } = require('./index');
      
      return Feedback.create({
        code_generation_id: this.id,
        feedback_text: feedbackText,
        rating,
        user_id: userId
      });
    };
    
    /**
     * Изменяет статус генерации кода
     * @param {string} status - Новый статус
     * @param {number} userId - ID пользователя, изменившего статус
     * @param {string} comment - Комментарий к изменению статуса (опционально)
     * @returns {Promise<CodeGeneration>} Обновленная генерация
     */
    CodeGeneration.prototype.changeStatus = async function(status, userId, comment = null) {
      const oldStatus = this.status;
      
      if (oldStatus === status) {
        return this;
      }
      
      // Обновляем статус
      await this.update({ status });
      
      // Если предоставлен комментарий, добавляем отзыв
      if (comment) {
        await this.addFeedback(
          `Статус изменен с "${oldStatus}" на "${status}". Комментарий: ${comment}`,
          null, // Без оценки
          userId
        );
      }
      
      // Обновляем связанную задачу
      const { Task } = require('./index');
      const task = await Task.findByPk(this.task_id);
      
      if (task) {
        if (status === 'implemented') {
          // Если все генерации кода для этой задачи реализованы, завершаем задачу
          const allGenerations = await CodeGeneration.findAll({
            where: { task_id: task.id }
          });
          
          const allImplemented = allGenerations.every(gen => gen.status === 'implemented');
          
          if (allImplemented) {
            await task.changeStatus('completed', 'Все генерации кода реализованы');
          }
        } else if (status === 'rejected' && task.status === 'pending') {
          // Если генерация отклонена, но задача еще не в процессе, обновляем ее статус
          await task.changeStatus('in_progress', 'Генерация кода отклонена, требуется доработка');
        }
      }
      
      return this;
    };
  
    return CodeGeneration;
  };
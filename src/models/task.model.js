/**
 * Модель задачи
 */
module.exports = (sequelize, DataTypes) => {
  const Task = sequelize.define('Task', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'projects',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 255]
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'failed'),
      defaultValue: 'pending',
      allowNull: false
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100
      }
    },
    priority: {
      type: DataTypes.STRING(20),
      defaultValue: 'medium',
      allowNull: false
    },
    estimated_hours: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true
    },
    actual_hours: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    due_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    parent_task_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tasks',
        key: 'id'
      }
    },
    assigned_to: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    pull_request_number: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    complexity: {
      type: DataTypes.DECIMAL(3, 1),
      allowNull: true,
      validate: {
        min: 1,
        max: 10
      }
    },
    git_branch: {
      type: DataTypes.STRING(255),
      allowNull: true
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
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'tasks',
    timestamps: false, // Мы управляем полями created_at и updated_at вручную
    hooks: {
      beforeCreate: (task) => {
        task.created_at = new Date();
        task.updated_at = new Date();
      },
      beforeUpdate: (task) => {
        task.updated_at = new Date();
        
        // Если задача завершена, устанавливаем дату завершения
        if (task.changed('status') && task.status === 'completed' && !task.completed_at) {
          task.completed_at = new Date();
        }
      }
    }
  });

  /**
   * Дополнительные методы задачи
   */
  
  /**
   * Обновляет прогресс задачи на основе выполненных подзадач
   * @returns {Promise<void>}
   */
  Task.prototype.updateProgress = async function() {
    const { Subtask } = require('./index');
    
    const subtasks = await Subtask.findAll({
      where: { task_id: this.id }
    });
    
    if (subtasks.length === 0) {
      return;
    }
    
    const completedSubtasks = subtasks.filter(subtask => subtask.status === 'completed').length;
    const progress = Math.round((completedSubtasks / subtasks.length) * 100);
    
    await this.update({ progress });
  };

  /**
   * Получает все логи задачи
   * @returns {Promise<Array>} Логи задачи
   */
  Task.prototype.getLogs = async function() {
    const { TaskLog } = require('./index');
    
    return TaskLog.findAll({
      where: { task_id: this.id },
      order: [['created_at', 'DESC']]
    });
  };

  /**
   * Добавляет лог задачи
   * @param {string} type - Тип лога (info, warning, error, progress)
   * @param {string} message - Сообщение лога
   * @param {number} progress - Прогресс задачи (опционально)
   * @returns {Promise<Object>} Созданный лог
   */
  Task.prototype.log = async function(type, message, progress = null) {
    const { TaskLog } = require('./index');
    
    const log = await TaskLog.create({
      task_id: this.id,
      log_type: type,
      message,
      progress
    });
    
    // Если указан прогресс, обновляем его в задаче
    if (progress !== null) {
      await this.update({ progress });
    }
    
    return log;
  };

  /**
   * Изменяет статус задачи
   * @param {string} status - Новый статус
   * @param {string} message - Сообщение для лога (опционально)
   * @returns {Promise<Task>} Обновленная задача
   */
  Task.prototype.changeStatus = async function(status, message = null) {
    const oldStatus = this.status;
    
    if (oldStatus === status) {
      return this;
    }
    
    // Обновляем статус
    await this.update({ status });
    
    // Добавляем лог, если указано сообщение
    if (message) {
      await this.log('info', message);
    } else {
      await this.log('info', `Статус изменен с "${oldStatus}" на "${status}"`);
    }
    
    // Если задача завершена, устанавливаем дату завершения
    if (status === 'completed' && !this.completed_at) {
      await this.update({ completed_at: new Date() });
    }
    
    return this;
  };

  /**
   * Получает родительскую задачу
   * @returns {Promise<Task|null>} Родительская задача или null
   */
  Task.prototype.getParent = async function() {
    if (!this.parent_task_id) {
      return null;
    }
    
    return Task.findByPk(this.parent_task_id);
  };

  /**
   * Получает дочерние задачи
   * @returns {Promise<Array<Task>>} Массив дочерних задач
   */
  Task.prototype.getChildren = async function() {
    return Task.findAll({
      where: { parent_task_id: this.id }
    });
  };

  return Task;
};
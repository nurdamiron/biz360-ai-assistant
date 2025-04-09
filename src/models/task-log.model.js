/**
 * Модель для представления логов задач в системе
 * @param {Object} sequelize - экземпляр Sequelize
 * @param {Object} DataTypes - типы данных Sequelize
 * @returns {Object} модель TaskLog
 */
module.exports = (sequelize, DataTypes) => {
    const TaskLog = sequelize.define('TaskLog', {
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
        },
        onDelete: 'CASCADE'
      },
      log_type: {
        type: DataTypes.ENUM('info', 'warning', 'error', 'progress'),
        allowNull: false
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      progress: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'task_logs',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false // No updated_at field in this table
    });
  
    // Определение ассоциаций с другими моделями
    TaskLog.associate = function(models) {
      // Связь с задачей, к которой относится лог
      TaskLog.belongsTo(models.Task, {
        foreignKey: 'task_id',
        as: 'task'
      });
    };
  
    return TaskLog;
  };
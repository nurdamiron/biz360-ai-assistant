/**
 * Модель для представления очереди задач в системе
 * @param {Object} sequelize - экземпляр Sequelize
 * @param {Object} DataTypes - типы данных Sequelize
 * @returns {Object} модель TaskQueue
 */
module.exports = (sequelize, DataTypes) => {
    const TaskQueue = sequelize.define('TaskQueue', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      data: {
        type: DataTypes.JSON,
        allowNull: false
      },
      priority: {
        type: DataTypes.INTEGER,
        defaultValue: 5
      },
      status: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
        defaultValue: 'pending'
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true
      }
    }, {
      tableName: 'task_queue',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    });
  
    // Определение ассоциаций с другими моделями
    TaskQueue.associate = function(models) {
      // Связь с пользователем, создавшим задачу
      TaskQueue.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
      });
    };
  
    return TaskQueue;
  };
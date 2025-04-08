/**
 * Модель проекта
 */
module.exports = (sequelize, DataTypes) => {
    const Project = sequelize.define('Project', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 100]
        }
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      repository_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          isUrl: true
        }
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'archived'),
        defaultValue: 'active',
        allowNull: false
      },
      github_repo_connected: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      repository_path: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      last_analyzed: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        }
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
      tableName: 'projects',
      timestamps: false, // Мы управляем полями created_at и updated_at вручную
      hooks: {
        beforeCreate: (project) => {
          project.created_at = new Date();
          project.updated_at = new Date();
        },
        beforeUpdate: (project) => {
          project.updated_at = new Date();
        }
      }
    });
  
    /**
     * Дополнительные методы проекта
     */
    
    /**
     * Получает настройки проекта
     * @returns {Promise<Object>} Настройки проекта
     */
    Project.prototype.getSettings = async function() {
      const { ProjectSettings } = require('./index');
      const settings = await ProjectSettings.findAll({
        where: { project_id: this.id }
      });
      
      return settings.reduce((acc, setting) => {
        acc[setting.setting_key] = setting.setting_value;
        return acc;
      }, {});
    };
  
    /**
     * Получает пути всех файлов проекта
     * @returns {Promise<Array>} Массив путей файлов
     */
    Project.prototype.getFilePaths = async function() {
      const { ProjectFile } = require('./index');
      const files = await ProjectFile.findAll({
        attributes: ['file_path'],
        where: { project_id: this.id }
      });
      
      return files.map(file => file.file_path);
    };
  
    /**
     * Получает статистику проекта
     * @returns {Promise<Object>} Статистика проекта
     */
    Project.prototype.getStatistics = async function() {
      const { Task } = require('./index');
      const { sequelize } = require('./index');
      
      // Получаем статистику по задачам
      const taskStats = await Task.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: { project_id: this.id },
        group: ['status']
      });
      
      // Преобразуем в удобный формат
      const stats = {
        tasks: {
          total: 0,
          pending: 0,
          in_progress: 0,
          completed: 0,
          failed: 0
        }
      };
      
      taskStats.forEach(stat => {
        stats.tasks[stat.status] = stat.get('count');
        stats.tasks.total += stat.get('count');
      });
      
      return stats;
    };
  
    return Project;
  };
/**
 * Модель файла проекта
 */
module.exports = (sequelize, DataTypes) => {
    const ProjectFile = sequelize.define('ProjectFile', {
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
      file_path: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      file_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      file_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      last_analyzed: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'project_files',
      timestamps: false, // Мы управляем полями created_at и updated_at вручную
      hooks: {
        beforeCreate: (file) => {
          file.created_at = new Date();
          file.updated_at = new Date();
        },
        beforeUpdate: (file) => {
          file.updated_at = new Date();
        }
      },
      indexes: [
        {
          name: 'idx_project_files_path',
          fields: ['file_path']
        }
      ]
    });
  
    /**
     * Получает содержимое файла с диска
     * @returns {Promise<String>} Содержимое файла
     */
    ProjectFile.prototype.getFileContent = async function() {
      const fs = require('fs').promises;
      const path = require('path');
      const { Project } = require('./index');
      
      try {
        // Получаем проект, к которому принадлежит файл
        const project = await Project.findByPk(this.project_id);
        if (!project || !project.repository_path) {
          throw new Error('Не найден репозиторий проекта');
        }
        
        // Формируем полный путь к файлу
        const fullPath = path.join(project.repository_path, this.file_path);
        
        // Читаем и возвращаем содержимое
        return await fs.readFile(fullPath, 'utf8');
      } catch (error) {
        console.error(`Ошибка при чтении файла ${this.file_path}:`, error);
        throw error;
      }
    };
  
    /**
     * Получает векторные представления для этого файла
     * @returns {Promise<Array>} Массив векторных представлений
     */
    ProjectFile.prototype.getVectors = async function() {
      const { CodeVector } = require('./index');
      
      return await CodeVector.findAll({
        where: { file_id: this.id }
      });
    };
  
    /**
     * Проверяет, был ли файл изменен
     * @param {String} newHash - Новый хеш файла
     * @returns {Boolean} Был ли файл изменен
     */
    ProjectFile.prototype.hasChanged = function(newHash) {
      return this.file_hash !== newHash;
    };
  
    return ProjectFile;
  };
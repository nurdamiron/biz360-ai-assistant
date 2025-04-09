/**
 * Модель векторных представлений кода
 */
module.exports = (sequelize, DataTypes) => {
    const CodeVector = sequelize.define('CodeVector', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      file_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'project_files',
          key: 'id'
        }
      },
      code_segment: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      start_line: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1
        }
      },
      end_line: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1
        }
      },
      embedding: {
        type: DataTypes.JSON,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'code_vectors',
      timestamps: false, // Управляем created_at вручную
      hooks: {
        beforeCreate: (vector) => {
          vector.created_at = new Date();
        }
      },
      indexes: [
        {
          name: 'file_id_index',
          fields: ['file_id']
        }
      ]
    });
  
    /**
     * Получает файл, к которому относится этот вектор
     * @returns {Promise<Object>} Объект файла
     */
    CodeVector.prototype.getFile = async function() {
      const { ProjectFile } = require('./index');
      return await ProjectFile.findByPk(this.file_id);
    };
  
    /**
     * Вычисляет близость к другому вектору
     * @param {Array|Object} otherVector - Другой вектор для сравнения
     * @returns {Number} Оценка сходства (от 0 до 1)
     */
    CodeVector.prototype.calculateSimilarity = function(otherVector) {
      if (!this.embedding || !otherVector) return 0;
      
      // Если передан объект CodeVector, извлекаем его embedding
      const vector = Array.isArray(otherVector) ? otherVector : otherVector.embedding;
      if (!vector) return 0;
      
      // Вычисляем косинусное сходство между векторами
      try {
        const a = this.embedding;
        const b = vector;
        
        // Проверка на соответствие размерностей
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let aMagnitude = 0;
        let bMagnitude = 0;
        
        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          aMagnitude += a[i] * a[i];
          bMagnitude += b[i] * b[i];
        }
        
        aMagnitude = Math.sqrt(aMagnitude);
        bMagnitude = Math.sqrt(bMagnitude);
        
        if (aMagnitude === 0 || bMagnitude === 0) return 0;
        
        return dotProduct / (aMagnitude * bMagnitude);
      } catch (error) {
        console.error('Ошибка при вычислении сходства векторов:', error);
        return 0;
      }
    };
  
    /**
     * Возвращает полный контекст сегмента кода (с окружающими строками)
     * @param {Number} contextLines - Количество строк контекста до и после
     * @returns {Promise<Object>} Объект с контекстом и диапазоном строк
     */
    CodeVector.prototype.getContextWithSurroundingLines = async function(contextLines = 3) {
      try {
        const file = await this.getFile();
        if (!file) {
          throw new Error('Файл не найден');
        }
        
        const fileContent = await file.getFileContent();
        const lines = fileContent.split('\n');
        
        // Определяем диапазон строк с учетом контекста
        const startLineWithContext = Math.max(1, this.start_line - contextLines);
        const endLineWithContext = Math.min(lines.length, this.end_line + contextLines);
        
        // Извлекаем строки из файла
        const contextLines = lines.slice(startLineWithContext - 1, endLineWithContext);
        
        return {
          context: contextLines.join('\n'),
          startLine: startLineWithContext,
          endLine: endLineWithContext,
          coreStartLine: this.start_line,
          coreEndLine: this.end_line
        };
      } catch (error) {
        console.error('Ошибка при получении контекста кода:', error);
        return {
          context: this.code_segment,
          startLine: this.start_line,
          endLine: this.end_line,
          coreStartLine: this.start_line,
          coreEndLine: this.end_line
        };
      }
    };
  
    return CodeVector;
  };
// src/utils/code-validator.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

/**
 * Сервис для валидации сгенерированного кода
 */
class CodeValidator {
  /**
   * Валидирует код на наличие синтаксических ошибок
   * @param {string} code - Сгенерированный код
   * @param {string} language - Язык программирования
   * @returns {Promise<Object>} - Результат валидации: { isValid: boolean, error: string }
   */
  async validate(code, language) {
    try {
      // Проверяем минимальную длину кода
      if (!code || code.trim().length < 10) {
        return {
          isValid: false,
          error: 'Код слишком короткий'
        };
      }
      
      // Проверка синтаксиса в зависимости от языка
      switch (language.toLowerCase()) {
        case 'javascript':
        case 'js':
          return this.validateJavaScript(code);
          
        case 'typescript':
        case 'ts':
          return this.validateTypeScript(code);
          
        case 'python':
        case 'py':
          return this.validatePython(code);
          
        case 'java':
          return this.validateJava(code);
          
        case 'c':
        case 'cpp':
        case 'c++':
          return this.validateCpp(code);
          
        default:
          // Для языков без специфической проверки считаем код валидным
          logger.info(`Валидация для языка ${language} не реализована, пропускаем`);
          return {
            isValid: true,
            error: null
          };
      }
    } catch (error) {
      logger.error('Ошибка при валидации кода:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации кода: ${error.message}`
      };
    }
  }
  
  /**
   * Валидирует JavaScript код
   * @param {string} code - JavaScript код
   * @returns {Object} - Результат валидации
   * @private
   */
  validateJavaScript(code) {
    try {
      // Создаем временный файл
      const tempFile = this.createTempFile(code, '.js');
      
      try {
        // Используем Node.js для проверки синтаксиса
        execSync(`node --check ${tempFile}`, { stdio: 'pipe' });
        return {
          isValid: true,
          error: null
        };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr ? error.stderr.toString() : error.message
        };
      } finally {
        // Удаляем временный файл
        this.deleteTempFile(tempFile);
      }
    } catch (error) {
      logger.error('Ошибка при валидации JavaScript:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации JavaScript: ${error.message}`
      };
    }
  }
  
  /**
   * Валидирует TypeScript код
   * @param {string} code - TypeScript код
   * @returns {Object} - Результат валидации
   * @private
   */
  validateTypeScript(code) {
    try {
      // Создаем временный файл
      const tempFile = this.createTempFile(code, '.ts');
      
      try {
        // Проверяем наличие TypeScript компилятора
        execSync('tsc --version', { stdio: 'pipe' });
        
        // Используем TypeScript компилятор для проверки синтаксиса
        execSync(`tsc --noEmit ${tempFile}`, { stdio: 'pipe' });
        return {
          isValid: true,
          error: null
        };
      } catch (error) {
        // Если компилятор не установлен, пропускаем проверку
        if (error.message.includes('not found') || error.message.includes('not recognized')) {
          logger.warn('TypeScript компилятор не установлен, пропускаем проверку');
          return {
            isValid: true,
            error: null
          };
        }
        
        return {
          isValid: false,
          error: error.stderr ? error.stderr.toString() : error.message
        };
      } finally {
        // Удаляем временный файл
        this.deleteTempFile(tempFile);
      }
    } catch (error) {
      logger.error('Ошибка при валидации TypeScript:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации TypeScript: ${error.message}`
      };
    }
  }
  
  /**
   * Валидирует Python код
   * @param {string} code - Python код
   * @returns {Object} - Результат валидации
   * @private
   */
  validatePython(code) {
    try {
      // Создаем временный файл
      const tempFile = this.createTempFile(code, '.py');
      
      try {
        // Используем Python для проверки синтаксиса
        execSync(`python -m py_compile ${tempFile}`, { stdio: 'pipe' });
        return {
          isValid: true,
          error: null
        };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr ? error.stderr.toString() : error.message
        };
      } finally {
        // Удаляем временный файл
        this.deleteTempFile(tempFile);
      }
    } catch (error) {
      logger.error('Ошибка при валидации Python:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации Python: ${error.message}`
      };
    }
  }
  
  /**
   * Валидирует Java код
   * @param {string} code - Java код
   * @returns {Object} - Результат валидации
   * @private
   */
  validateJava(code) {
    try {
      // Извлекаем имя класса из кода
      const classNameMatch = code.match(/public\s+class\s+([A-Za-z0-9_]+)/);
      if (!classNameMatch) {
        return {
          isValid: false,
          error: 'Не удалось определить имя класса'
        };
      }
      
      const className = classNameMatch[1];
      
      // Создаем временный файл с именем класса
      const tempFile = this.createTempFile(code, `.java`, className);
      
      try {
        // Используем javac для проверки синтаксиса
        execSync(`javac ${tempFile}`, { stdio: 'pipe' });
        return {
          isValid: true,
          error: null
        };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr ? error.stderr.toString() : error.message
        };
      } finally {
        // Удаляем временный файл и скомпилированный класс
        this.deleteTempFile(tempFile);
        this.deleteTempFile(tempFile.replace('.java', '.class'));
      }
    } catch (error) {
      logger.error('Ошибка при валидации Java:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации Java: ${error.message}`
      };
    }
  }
  
  /**
   * Валидирует C/C++ код
   * @param {string} code - C/C++ код
   * @returns {Object} - Результат валидации
   * @private
   */
  validateCpp(code) {
    try {
      // Создаем временный файл
      const tempFile = this.createTempFile(code, '.cpp');
      
      try {
        // Используем g++ для проверки синтаксиса
        execSync(`g++ -fsyntax-only ${tempFile}`, { stdio: 'pipe' });
        return {
          isValid: true,
          error: null
        };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr ? error.stderr.toString() : error.message
        };
      } finally {
        // Удаляем временный файл
        this.deleteTempFile(tempFile);
      }
    } catch (error) {
      logger.error('Ошибка при валидации C/C++:', error);
      return {
        isValid: false,
        error: `Ошибка при валидации C/C++: ${error.message}`
      };
    }
  }
  
  /**
   * Создает временный файл с указанным содержимым
   * @param {string} content - Содержимое файла
   * @param {string} extension - Расширение файла
   * @param {string} [name] - Имя файла (без расширения)
   * @returns {string} - Путь к временному файлу
   * @private
   */
  createTempFile(content, extension, name = null) {
    try {
      const tempDir = os.tmpdir();
      const fileName = name || `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const filePath = path.join(tempDir, `${fileName}${extension}`);
      
      fs.writeFileSync(filePath, content);
      
      return filePath;
    } catch (error) {
      logger.error('Ошибка при создании временного файла:', error);
      throw error;
    }
  }
  
  /**
   * Удаляет временный файл
   * @param {string} filePath - Путь к файлу
   * @private
   */
  deleteTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error(`Ошибка при удалении временного файла ${filePath}:`, error);
    }
  }
}

module.exports = new CodeValidator();
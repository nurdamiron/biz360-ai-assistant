// src/core/code-generator/code-validator.js

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const util = require('util');
const logger = require('../../utils/logger');

// Промисифицируем exec для использования с async/await
const execAsync = util.promisify(exec);

/**
 * Класс для валидации сгенерированного кода
 */
class CodeValidator {
  constructor() {
    // Временная директория для валидации кода
    this.tempDir = path.join(os.tmpdir(), 'biz360-validator');
  }

  /**
   * Создание временной директории для валидации
   * @returns {Promise<string>} - Путь к временной директории
   */
  async createTempDir() {
    try {
      // Создаем уникальную временную директорию
      const timestamp = Date.now();
      const uniqueTempDir = `${this.tempDir}-${timestamp}`;
      
      await fs.mkdir(uniqueTempDir, { recursive: true });
      
      return uniqueTempDir;
    } catch (error) {
      logger.error('Ошибка при создании временной директории:', error);
      throw error;
    }
  }

  /**
   * Очистка временной директории
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<void>}
   */
  async cleanupTempDir(tempDir) {
    try {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
        logger.debug(`Временная директория ${tempDir} удалена`);
      }
    } catch (error) {
      logger.warn('Ошибка при очистке временной директории:', error);
      // Не выбрасываем ошибку, чтобы не прерывать основной процесс
    }
  }

  /**
   * Валидация JavaScript кода с помощью ESLint
   * @param {string} code - Код для валидации
   * @param {string} tempDir - Временная директория
   * @returns {Promise<Object>} - Результат валидации
   */
  async validateWithESLint(code, tempDir) {
    try {
      // Создаем временный файл с кодом
      const tempFile = path.join(tempDir, 'code-to-validate.js');
      await fs.writeFile(tempFile, code);
      
      // Создаем базовый конфиг ESLint
      const eslintConfig = {
        env: {
          node: true,
          es6: true
        },
        parserOptions: {
          ecmaVersion: 2020
        },
        rules: {
          "no-unused-vars": "warn",
          "no-undef": "error"
        }
      };
      
      const configPath = path.join(tempDir, '.eslintrc.json');
      await fs.writeFile(configPath, JSON.stringify(eslintConfig, null, 2));
      
      // Запускаем ESLint
      try {
        await execAsync(`npx eslint --no-eslintrc -c ${configPath} ${tempFile}`);
        return { isValid: true };
      } catch (error) {
        // ESLint вернул ошибки
        return {
          isValid: false,
          error: error.stderr || error.stdout || 'Неизвестная ошибка ESLint'
        };
      }
    } catch (error) {
      logger.error('Ошибка при валидации с ESLint:', error);
      return {
        isValid: false,
        error: `Ошибка валидации: ${error.message}`
      };
    }
  }

  /**
   * Проверяет синтаксис JavaScript кода
   * @param {string} code - Код для проверки
   * @param {string} tempDir - Временная директория
   * @returns {Promise<Object>} - Результат проверки
   */
  async checkJSSyntax(code, tempDir) {
    try {
      // Создаем временный файл с кодом
      const tempFile = path.join(tempDir, 'code-to-validate.js');
      await fs.writeFile(tempFile, code);
      
      // Запускаем Node.js с опцией проверки синтаксиса
      try {
        await execAsync(`node --check ${tempFile}`);
        return { isValid: true };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr || error.stdout || 'Неизвестная ошибка синтаксиса'
        };
      }
    } catch (error) {
      logger.error('Ошибка при проверке синтаксиса JS:', error);
      return {
        isValid: false,
        error: `Ошибка проверки синтаксиса: ${error.message}`
      };
    }
  }

  /**
   * Валидация TypeScript кода
   * @param {string} code - Код для валидации
   * @param {string} tempDir - Временная директория
   * @returns {Promise<Object>} - Результат валидации
   */
  async validateTypeScript(code, tempDir) {
    try {
      // Создаем временный файл с кодом
      const tempFile = path.join(tempDir, 'code-to-validate.ts');
      await fs.writeFile(tempFile, code);
      
      // Создаем базовый tsconfig.json
      const tsConfig = {
        compilerOptions: {
          target: "es2020",
          module: "commonjs",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true
        }
      };
      
      const configPath = path.join(tempDir, 'tsconfig.json');
      await fs.writeFile(configPath, JSON.stringify(tsConfig, null, 2));
      
      // Запускаем TypeScript компилятор только для проверки типов
      try {
        await execAsync(`npx tsc --noEmit --project ${configPath}`);
        return { isValid: true };
      } catch (error) {
        return {
          isValid: false,
          error: error.stderr || error.stdout || 'Неизвестная ошибка TypeScript'
        };
      }
    } catch (error) {
      logger.error('Ошибка при валидации TypeScript:', error);
      return {
        isValid: false,
        error: `Ошибка валидации: ${error.message}`
      };
    }
  }

  /**
   * Валидирует SQL код
   * @param {string} code - SQL код для валидации
   * @param {string} tempDir - Временная директория
   * @returns {Promise<Object>} - Результат валидации
   */
  async validateSQL(code, tempDir) {
    // В реальной системе здесь должна быть валидация SQL запросов
    // Это может быть сложно без реальной БД, поэтому делаем базовую проверку
    try {
      // Проверяем наличие базовых SQL команд и синтаксиса
      const sqlCommands = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'];
      const hasValidCommand = sqlCommands.some(cmd => code.toUpperCase().includes(cmd));
      
      if (!hasValidCommand) {
        return {
          isValid: false,
          error: 'SQL код не содержит стандартных SQL команд'
        };
      }
      
      // Проверяем базовую структуру (наличие точек с запятой, закрывающих скобок и т.д.)
      const semicolonCount = (code.match(/;/g) || []).length;
      const openParenthesisCount = (code.match(/\(/g) || []).length;
      const closeParenthesisCount = (code.match(/\)/g) || []).length;
      
      if (openParenthesisCount !== closeParenthesisCount) {
        return {
          isValid: false,
          error: 'Несбалансированные скобки в SQL коде'
        };
      }
      
      return { isValid: true };
    } catch (error) {
      logger.error('Ошибка при валидации SQL:', error);
      return {
        isValid: false,
        error: `Ошибка валидации: ${error.message}`
      };
    }
  }

  /**
   * Валидирует код в зависимости от языка
   * @param {string} code - Код для валидации
   * @param {string} language - Язык программирования
   * @returns {Promise<Object>} - Результат валидации
   */
  async validate(code, language = 'js') {
    let tempDir = null;
    
    try {
      if (!code) {
        return {
          isValid: false,
          error: 'Пустой код'
        };
      }
      
      // Создаем временную директорию для валидации
      tempDir = await this.createTempDir();
      
      // Определяем метод валидации в зависимости от языка
      switch (language.toLowerCase()) {
        case 'js':
        case 'javascript':
          // Сначала проверяем синтаксис
          const syntaxResult = await this.checkJSSyntax(code, tempDir);
          if (!syntaxResult.isValid) {
            return syntaxResult;
          }
          
          // Затем делаем более глубокую проверку с ESLint
          return await this.validateWithESLint(code, tempDir);
          
        case 'ts':
        case 'typescript':
          return await this.validateTypeScript(code, tempDir);
          
        case 'sql':
          return await this.validateSQL(code, tempDir);
          
        default:
          // Для неизвестных языков считаем код валидным
          logger.warn(`Валидация для языка ${language} не реализована`);
          return { isValid: true };
      }
    } catch (error) {
      logger.error('Ошибка при валидации кода:', error);
      return {
        isValid: false,
        error: `Ошибка валидации: ${error.message}`
      };
    } finally {
      // Очищаем временную директорию
      if (tempDir) {
        await this.cleanupTempDir(tempDir);
      }
    }
  }
}

module.exports = CodeValidator;
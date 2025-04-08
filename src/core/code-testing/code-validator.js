// src/core/code-testing/code-validator.js
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');
const { v4: uuidv4 } = require('uuid');

/**
 * Класс для валидации кода
 */
class CodeValidator {
  /**
   * Валидация кода
   * @param {object} params - Параметры валидации
   * @param {Array} params.files - Файлы для валидации
   * @param {string} params.repoPath - Путь к репозиторию
   * @param {object} params.context - Дополнительный контекст
   * @returns {Promise<object>} - Результаты валидации
   */
  async validateCode(params) {
    const { files, repoPath, context } = params;
    
    logger.info(`Validating ${files.length} files`);
    
    try {
      // Создаем временную директорию для валидации
      const tempDir = await this.createTempValidationDir(repoPath, files);
      
      // Валидируем каждый файл
      const fileResults = await Promise.all(files.map(file => 
        this.validateFile(file, tempDir, context)
      ));
      
      // Очищаем временную директорию
      await this.cleanupTempDir(tempDir);
      
      // Определяем общие результаты
      const criticalErrors = fileResults.flatMap(result => 
        result.criticalErrors.map(error => ({
          ...error,
          filePath: result.filePath
        }))
      );
      
      const warnings = fileResults.flatMap(result => 
        result.warnings.map(warning => ({
          ...warning,
          filePath: result.filePath
        }))
      );
      
      const validationResult = {
        valid: criticalErrors.length === 0,
        criticalErrors,
        warnings,
        fileResults
      };
      
      logger.info(`Validation completed: ${fileResults.length} files checked, ${criticalErrors.length} critical errors, ${warnings.length} warnings`);
      
      return validationResult;
    } catch (error) {
      logger.error(`Error validating code: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Создание временной директории для валидации
   * @param {string} repoPath - Путь к репозиторию
   * @param {Array} files - Файлы для валидации
   * @returns {Promise<string>} - Путь к временной директории
   */
  async createTempValidationDir(repoPath, files) {
    const tempDirBase = path.join(os.tmpdir(), 'biz360-code-validator');
    const tempDir = path.join(tempDirBase, uuidv4());
    
    logger.debug(`Creating temporary validation directory at ${tempDir}`);
    
    try {
      // Создаем базовую временную директорию, если ее нет
      await fs.mkdir(tempDirBase, { recursive: true });
      
      // Создаем уникальную временную директорию для этого запуска
      await fs.mkdir(tempDir, { recursive: true });
      
      // Копируем конфигурационные файлы из репозитория
      await this.copyConfigFiles(repoPath, tempDir);
      
      // Записываем файлы для валидации
      for (const file of files) {
        const filePath = path.join(tempDir, file.path);
        
        // Создаем директорию для файла, если ее нет
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        // Записываем файл
        await fs.writeFile(filePath, file.content, 'utf8');
      }
      
      return tempDir;
    } catch (error) {
      logger.error(`Error creating temporary validation directory: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Копирование конфигурационных файлов
   * @param {string} repoPath - Путь к репозиторию
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<void>}
   */
  async copyConfigFiles(repoPath, tempDir) {
    logger.debug(`Copying configuration files from ${repoPath} to ${tempDir}`);
    
    try {
      // Копируем конфигурационные файлы
      await this.copyFileIfExists(repoPath, tempDir, '.eslintrc.js');
      await this.copyFileIfExists(repoPath, tempDir, '.eslintrc.json');
      await this.copyFileIfExists(repoPath, tempDir, '.eslintrc.yml');
      await this.copyFileIfExists(repoPath, tempDir, '.prettierrc');
      await this.copyFileIfExists(repoPath, tempDir, '.prettierrc.js');
      await this.copyFileIfExists(repoPath, tempDir, '.prettierrc.json');
      await this.copyFileIfExists(repoPath, tempDir, 'tsconfig.json');
      await this.copyFileIfExists(repoPath, tempDir, 'package.json');
      
      // Создаем базовый файл конфигурации ESLint, если не существует
      const eslintConfigPath = path.join(tempDir, '.eslintrc.js');
      try {
        await fs.access(eslintConfigPath);
      } catch (e) {
        await fs.writeFile(eslintConfigPath, `module.exports = {
  env: {
    browser: true,
    node: true,
    es6: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'warn',
  },
};`, 'utf8');
      }
      
      // Создаем package.json с зависимостями для валидации, если не существует
      const packageJsonPath = path.join(tempDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch (e) {
        await fs.writeFile(packageJsonPath, JSON.stringify({
          name: 'biz360-code-validation',
          version: '1.0.0',
          private: true,
          devDependencies: {
            eslint: '^8.40.0',
            'eslint-plugin-jest': '^27.2.0',
            prettier: '^2.8.0',
            typescript: '^5.0.0'
          }
        }, null, 2), 'utf8');
      }
    } catch (error) {
      logger.error(`Error copying configuration files: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Копирование файла, если он существует
   * @param {string} srcDir - Исходная директория
   * @param {string} destDir - Целевая директория
   * @param {string} filename - Имя файла
   * @returns {Promise<void>}
   */
  async copyFileIfExists(srcDir, destDir, filename) {
    const srcPath = path.join(srcDir, filename);
    const destPath = path.join(destDir, filename);
    
    try {
      await fs.access(srcPath);
      await fs.copyFile(srcPath, destPath);
      logger.debug(`Copied ${filename}`);
    } catch (e) {
      // Файл не существует, пропускаем
      logger.debug(`File ${filename} does not exist, skipping`);
    }
  }

  /**
   * Валидация отдельного файла
   * @param {object} file - Файл для валидации
   * @param {string} tempDir - Путь к временной директории
   * @param {object} context - Дополнительный контекст
   * @returns {Promise<object>} - Результат валидации
   */
  async validateFile(file, tempDir, context) {
    logger.debug(`Validating file ${file.path}`);
    
    try {
      const filePath = file.path;
      const extension = path.extname(filePath).toLowerCase();
      
      // Базовая структура результата
      const result = {
        filePath,
        valid: true,
        criticalErrors: [],
        warnings: [],
        lintResults: null,
        syntaxValid: true
      };
      
      // Проверка синтаксиса
      if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
        const syntaxResult = await this.validateSyntax(file, tempDir);
        result.syntaxValid = syntaxResult.valid;
        
        if (!syntaxResult.valid) {
          result.valid = false;
          result.criticalErrors.push({
            type: 'syntax',
            message: syntaxResult.error,
            line: syntaxResult.line,
            column: syntaxResult.column
          });
        }
      }
      
      // Если синтаксис невалиден, не запускаем ESLint
      if (!result.syntaxValid) {
        return result;
      }
      
      // Проверка ESLint
      if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
        try {
          await this.installDeps(tempDir);
          const lintResult = await this.lintFile(file, tempDir);
          result.lintResults = lintResult;
          
          // Преобразуем результаты ESLint в наш формат
          for (const issue of lintResult.messages) {
            const issueObject = {
              type: 'eslint',
              message: issue.message,
              line: issue.line,
              column: issue.column,
              ruleId: issue.ruleId
            };
            
            if (issue.severity === 2) { // Error
              result.valid = false;
              result.criticalErrors.push(issueObject);
            } else if (issue.severity === 1) { // Warning
              result.warnings.push(issueObject);
            }
          }
        } catch (e) {
          logger.warn(`ESLint validation failed for ${filePath}: ${e.message}`);
          // Если ESLint не отработал, считаем это некритичным
          result.warnings.push({
            type: 'lint-process',
            message: `ESLint validation failed: ${e.message}`
          });
        }
      }
      
      // Проверка типов для TypeScript
      if (['.ts', '.tsx'].includes(extension)) {
        try {
          const typeResult = await this.validateTypes(file, tempDir);
          
          if (!typeResult.valid) {
            result.valid = false;
            result.criticalErrors.push({
              type: 'typescript',
              message: typeResult.error
            });
          }
        } catch (e) {
          logger.warn(`TypeScript validation failed for ${filePath}: ${e.message}`);
          // Если проверка типов не отработала, считаем это некритичным
          result.warnings.push({
            type: 'typescript-process',
            message: `TypeScript validation failed: ${e.message}`
          });
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Error validating file ${file.path}: ${error.message}`, {
        error: error.stack
      });
      
      return {
        filePath: file.path,
        valid: false,
        criticalErrors: [{
          type: 'process',
          message: `Validation process failed: ${error.message}`
        }],
        warnings: [],
        lintResults: null,
        syntaxValid: false
      };
    }
  }

  /**
   * Установка зависимостей для валидации
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<void>}
   */
  async installDeps(tempDir) {
    try {
      // Проверяем, установлены ли уже зависимости
      const nodeModulesPath = path.join(tempDir, 'node_modules');
      try {
        await fs.access(nodeModulesPath);
        // Если node_modules существует, считаем что зависимости уже установлены
        return;
      } catch (e) {
        // Node modules не найдены, устанавливаем зависимости
      }
      
      logger.debug('Installing dependencies for validation...');
      await this.executeCommand('npm install --no-package-lock', tempDir);
    } catch (error) {
      logger.warn(`Error installing dependencies: ${error.message}`);
      throw error;
    }
  }

  /**
   * Валидация синтаксиса файла
   * @param {object} file - Файл для валидации
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<object>} - Результат валидации синтаксиса
   */
  async validateSyntax(file, tempDir) {
    const filePath = path.join(tempDir, file.path);
    const extension = path.extname(file.path).toLowerCase();
    
    try {
      let command;
      
      if (['.js', '.jsx'].includes(extension)) {
        // Для JavaScript используем Node.js для проверки синтаксиса
        command = `node --check ${filePath}`;
      } else if (['.ts', '.tsx'].includes(extension)) {
        // Для TypeScript используем tsc для проверки синтаксиса
        command = `npx tsc --noEmit --allowJs false ${filePath}`;
      } else {
        // Для других файлов считаем синтаксис валидным
        return { valid: true };
      }
      
      await this.executeCommand(command, tempDir);
      return { valid: true };
    } catch (error) {
      // Извлекаем информацию об ошибке
      const errorMessage = error.stderr || error.stdout || error.message;
      const errorMatch = errorMessage.match(/(\w+Error|SyntaxError):(.+?)(at|on) line (\d+)/i);
      
      if (errorMatch) {
        return {
          valid: false,
          error: errorMatch[2].trim(),
          line: parseInt(errorMatch[4], 10),
          column: 1 // Колонка обычно не указывается в базовой проверке синтаксиса
        };
      }
      
      // Если не удалось извлечь детали, возвращаем общую ошибку
      return {
        valid: false,
        error: errorMessage
      };
    }
  }

  /**
   * Линтинг файла с использованием ESLint
   * @param {object} file - Файл для линтинга
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<object>} - Результат линтинга
   */
  async lintFile(file, tempDir) {
    const filePath = path.join(tempDir, file.path);
    
    try {
      // Запускаем ESLint в формате JSON для удобства парсинга
      const command = `npx eslint --format json ${filePath}`;
      const { stdout } = await this.executeCommand(command, tempDir);
      
      // Парсим результат
      const results = JSON.parse(stdout);
      
      if (results.length === 0) {
        return { messages: [] };
      }
      
      return results[0]; // ESLint возвращает массив результатов, берем первый (для нашего файла)
    } catch (error) {
      // Если ESLint выбросил ошибку из-за проблем с кодом, извлекаем результаты из stdout
      if (error.stdout) {
        try {
          const results = JSON.parse(error.stdout);
          if (results.length > 0) {
            return results[0];
          }
        } catch (e) {
          // Не удалось распарсить JSON
        }
      }
      
      throw error;
    }
  }

  /**
   * Валидация типов TypeScript
   * @param {object} file - Файл для валидации
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<object>} - Результат валидации типов
   */
  async validateTypes(file, tempDir) {
    const filePath = path.join(tempDir, file.path);
    
    try {
      // Запускаем tsc для проверки типов
      const command = `npx tsc --noEmit ${filePath}`;
      await this.executeCommand(command, tempDir);
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error.stderr || error.stdout || error.message
      };
    }
  }

  /**
   * Выполнение команды
   * @param {string} command - Команда для выполнения
   * @param {string} cwd - Рабочая директория
   * @returns {Promise<object>} - Результат выполнения команды
   */
  async executeCommand(command, cwd) {
    try {
      return await execAsync(command, { cwd });
    } catch (error) {
      if (error.stdout || error.stderr) {
        return { stdout: error.stdout, stderr: error.stderr };
      }
      throw error;
    }
  }

  /**
   * Очистка временной директории
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<void>}
   */
  async cleanupTempDir(tempDir) {
    logger.debug(`Cleaning up temporary directory ${tempDir}`);
    
    try {
      // В некоторых случаях может понадобиться сохранить директорию для отладки
      const shouldPreserve = process.env.BIZ360_PRESERVE_VALIDATION_DIR === 'true';
      
      if (shouldPreserve) {
        logger.info(`Preserving temporary validation directory at ${tempDir}`);
        return;
      }
      
      await this.rimraf(tempDir);
    } catch (error) {
      logger.warn(`Error cleaning up temporary directory: ${error.message}`);
      // Не выбрасываем ошибку, так как это некритично
    }
  }

  /**
   * Рекурсивное удаление директории
   * @param {string} dirPath - Путь к директории
   * @returns {Promise<void>}
   */
  async rimraf(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await this.rimraf(entryPath);
        } else {
          await fs.unlink(entryPath);
        }
      }
      
      await fs.rmdir(dirPath);
    } catch (e) {
      // Игнорируем ошибки, если файл или директория не существуют
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

module.exports = new CodeValidator();
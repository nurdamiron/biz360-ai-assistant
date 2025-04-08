// src/core/code-testing/test-runner.js
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');
const { v4: uuidv4 } = require('uuid');

/**
 * Класс для запуска тестов
 */
class TestRunner {
  /**
   * Запуск тестов
   * @param {object} params - Параметры запуска
   * @param {Array} params.tests - Тесты для запуска
   * @param {string} params.repoPath - Путь к репозиторию
   * @param {object} params.context - Дополнительный контекст
   * @returns {Promise<object>} - Результаты запуска тестов
   */
  async runTests(params) {
    const { tests, repoPath, context } = params;
    
    logger.info(`Running ${tests.length} tests`);
    
    try {
      // Создаем временную директорию для тестов
      const tempDir = await this.createTempTestsDir(repoPath, tests);
      
      // Запускаем тесты
      const testResults = await this.executeTests(tempDir, tests);
      
      // Очищаем временную директорию
      await this.cleanupTempDir(tempDir);
      
      // Формируем результаты
      const passedCount = testResults.filter(result => result.status === 'passed').length;
      const failedCount = testResults.filter(result => result.status === 'failed').length;
      
      const summary = {
        totalTests: tests.length,
        passedCount,
        failedCount,
        successRate: (passedCount / tests.length) * 100,
        tests: testResults
      };
      
      logger.info(`Tests completed: ${passedCount} passed, ${failedCount} failed`);
      
      return summary;
    } catch (error) {
      logger.error(`Error running tests: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Создание временной директории для тестов
   * @param {string} repoPath - Путь к репозиторию
   * @param {Array} tests - Тесты для запуска
   * @returns {Promise<string>} - Путь к временной директории
   */
  async createTempTestsDir(repoPath, tests) {
    const tempDirBase = path.join(os.tmpdir(), 'biz360-test-runner');
    const tempDir = path.join(tempDirBase, uuidv4());
    
    logger.debug(`Creating temporary test directory at ${tempDir}`);
    
    try {
      // Создаем базовую временную директорию, если ее нет
      await fs.mkdir(tempDirBase, { recursive: true });
      
      // Создаем уникальную временную директорию для этого запуска
      await fs.mkdir(tempDir, { recursive: true });
      
      // Копируем необходимые файлы из репозитория
      await this.copyProjectFiles(repoPath, tempDir);
      
      // Записываем тестовые файлы
      for (const test of tests) {
        const testFilePath = path.join(tempDir, test.testFilePath);
        
        // Создаем директорию для тестового файла, если ее нет
        await fs.mkdir(path.dirname(testFilePath), { recursive: true });
        
        // Записываем тестовый файл
        await fs.writeFile(testFilePath, test.testCode, 'utf8');
      }
      
      return tempDir;
    } catch (error) {
      logger.error(`Error creating temporary test directory: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Копирование файлов проекта во временную директорию
   * @param {string} repoPath - Путь к репозиторию
   * @param {string} tempDir - Путь к временной директории
   * @returns {Promise<void>}
   */
  async copyProjectFiles(repoPath, tempDir) {
    logger.debug(`Copying project files from ${repoPath} to ${tempDir}`);
    
    try {
      // Копируем package.json и package-lock.json
      await this.copyFileIfExists(repoPath, tempDir, 'package.json');
      await this.copyFileIfExists(repoPath, tempDir, 'package-lock.json');
      await this.copyFileIfExists(repoPath, tempDir, 'yarn.lock');
      
      // Копируем конфигурационные файлы для тестов
      await this.copyFileIfExists(repoPath, tempDir, 'jest.config.js');
      await this.copyFileIfExists(repoPath, tempDir, '.babelrc');
      await this.copyFileIfExists(repoPath, tempDir, 'babel.config.js');
      await this.copyFileIfExists(repoPath, tempDir, 'tsconfig.json');
      
      // Копируем исходный код
      await this.copyDirIfExists(repoPath, tempDir, 'src');
      
      // Создаем временный package.json с зависимостями для тестирования, если оригинальный не найден
      const packageJsonPath = path.join(tempDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch (e) {
        await fs.writeFile(packageJsonPath, JSON.stringify({
          name: 'biz360-test-run',
          version: '1.0.0',
          private: true,
          scripts: {
            test: 'jest'
          },
          dependencies: {},
          devDependencies: {
            jest: '^29.0.0',
            '@babel/core': '^7.22.0',
            '@babel/preset-env': '^7.22.0',
            '@testing-library/jest-dom': '^5.16.5'
          }
        }, null, 2), 'utf8');
        
        // Создаем babel.config.js, если не существует
        const babelConfigPath = path.join(tempDir, 'babel.config.js');
        try {
          await fs.access(babelConfigPath);
        } catch (e) {
          await fs.writeFile(babelConfigPath, `module.exports = {
  presets: ['@babel/preset-env'],
};`, 'utf8');
        }
      }
    } catch (error) {
      logger.error(`Error copying project files: ${error.message}`, {
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
   * Копирование директории, если она существует
   * @param {string} srcDir - Исходная директория
   * @param {string} destDir - Целевая директория
   * @param {string} dirname - Имя директории
   * @returns {Promise<void>}
   */
  async copyDirIfExists(srcDir, destDir, dirname) {
    const srcPath = path.join(srcDir, dirname);
    const destPath = path.join(destDir, dirname);
    
    try {
      await fs.access(srcPath);
      await this.copyDir(srcPath, destPath);
      logger.debug(`Copied directory ${dirname}`);
    } catch (e) {
      // Директория не существует, пропускаем
      logger.debug(`Directory ${dirname} does not exist, skipping`);
    }
  }

  /**
   * Рекурсивное копирование директории
   * @param {string} src - Исходная директория
   * @param {string} dest - Целевая директория
   * @returns {Promise<void>}
   */
  async copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Запуск тестов
   * @param {string} tempDir - Путь к временной директории
   * @param {Array} tests - Тесты для запуска
   * @returns {Promise<Array>} - Результаты запуска тестов
   */
  async executeTests(tempDir, tests) {
    logger.debug(`Executing tests in ${tempDir}`);
    
    try {
      // Устанавливаем зависимости
      logger.debug('Installing dependencies...');
      await this.executeCommand('npm install', tempDir);
      
      // Запускаем каждый тест отдельно
      const results = [];
      
      for (const test of tests) {
        try {
          logger.debug(`Running test ${test.testFilePath}...`);
          
          // Определяем команду для запуска теста
          let command;
          
          if (test.framework === 'jest') {
            command = `npx jest ${test.testFilePath} --json --outputFile=${path.join(tempDir, 'test-result.json')}`;
          } else if (test.framework === 'mocha' || test.framework === 'mocha-chai') {
            command = `npx mocha ${test.testFilePath} --reporter json > ${path.join(tempDir, 'test-result.json')}`;
          } else {
            // По умолчанию используем Jest
            command = `npx jest ${test.testFilePath} --json --outputFile=${path.join(tempDir, 'test-result.json')}`;
          }
          
          const { stdout, stderr } = await this.executeCommand(command, tempDir);
          
          // Парсим результаты
          const resultFilePath = path.join(tempDir, 'test-result.json');
          let testResult;
          
          try {
            const resultJson = await fs.readFile(resultFilePath, 'utf8');
            testResult = JSON.parse(resultJson);
          } catch (e) {
            testResult = null;
          }
          
          // Определяем статус теста
          let status = 'unknown';
          let details = '';
          
          if (testResult) {
            if (test.framework === 'jest') {
              status = testResult.numFailedTests === 0 ? 'passed' : 'failed';
              details = JSON.stringify(testResult);
            } else if (test.framework === 'mocha' || test.framework === 'mocha-chai') {
              status = testResult.failures === 0 ? 'passed' : 'failed';
              details = JSON.stringify(testResult);
            }
          } else {
            // Если не удалось прочитать файл с результатами, используем stderr
            status = stderr ? 'failed' : 'passed';
            details = stderr || stdout;
          }
          
          results.push({
            testFilePath: test.testFilePath,
            originalFilePath: test.originalFilePath,
            status,
            details,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          // Если тест завершился с ошибкой, считаем его проваленным
          results.push({
            testFilePath: test.testFilePath,
            originalFilePath: test.originalFilePath,
            status: 'failed',
            details: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Error executing tests: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
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
      const shouldPreserve = process.env.BIZ360_PRESERVE_TEST_DIR === 'true';
      
      if (shouldPreserve) {
        logger.info(`Preserving temporary test directory at ${tempDir}`);
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

module.exports = new TestRunner();
// src/core/code-testing/test-generator.js
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const { getPromptTemplate } = require('../../utils/prompt-utils');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { v4: uuidv4 } = require('uuid');

/**
 * Класс для генерации тестов
 */
class TestGenerator {
  /**
   * Генерация тестов для кода
   * @param {object} params - Параметры генерации
   * @param {number} params.generationId - ID генерации кода (опционально)
   * @param {number} params.taskId - ID задачи (опционально)
   * @param {Array} params.files - Файлы для тестирования
   * @param {string} params.repoPath - Путь к репозиторию
   * @param {object} params.context - Дополнительный контекст
   * @param {object} params.validationResults - Результаты валидации кода
   * @returns {Promise<object>} - Сгенерированные тесты
   */
  async generateTests(params) {
    const { generationId, taskId, files, repoPath, context, validationResults } = params;
    
    const testId = generationId ? `generation_${generationId}` : `task_${taskId}`;
    logger.info(`Generating tests for ${testId}`);
    
    try {
      // Определяем тестовый фреймворк на основе проекта
      const testFramework = await this.detectTestFramework(repoPath);
      
      // Генерируем тесты для каждого файла
      const testsPromises = files.map(file => 
        this.generateTestForFile(file, {
          testFramework,
          repoPath,
          context,
          validationResults
        })
      );
      
      const testsResults = await Promise.all(testsPromises);
      
      // Объединяем все тесты
      const tests = testsResults.filter(result => result !== null);
      
      logger.info(`Generated ${tests.length} test files for ${testId}`);
      
      return {
        tests,
        framework: testFramework
      };
    } catch (error) {
      logger.error(`Error generating tests: ${error.message}`, {
        testId,
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Определение тестового фреймворка на основе проекта
   * @param {string} repoPath - Путь к репозиторию
   * @returns {Promise<string>} - Название тестового фреймворка
   */
  async detectTestFramework(repoPath) {
    try {
      // Пытаемся найти package.json
      const packageJsonPath = path.join(repoPath, 'package.json');
      
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        const dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies
        };
        
        // Определяем фреймворк по зависимостям
        if (dependencies.jest) return 'jest';
        if (dependencies.mocha) return 'mocha';
        if (dependencies['@testing-library/react']) return 'react-testing-library';
        if (dependencies.chai) return 'mocha-chai';
        if (dependencies.cypress) return 'cypress';
        if (dependencies.jasmine) return 'jasmine';
        if (dependencies.ava) return 'ava';
        if (dependencies.tape) return 'tape';
      } catch (e) {
        logger.debug(`Could not read package.json: ${e.message}`);
      }
      
      // Ищем конфигурационные файлы
      const files = await fs.readdir(repoPath);
      
      if (files.includes('jest.config.js')) return 'jest';
      if (files.includes('.mocharc.js') || files.includes('.mocharc.json')) return 'mocha';
      if (files.includes('karma.conf.js')) return 'karma';
      if (files.includes('jasmine.json')) return 'jasmine';
      if (files.includes('cypress.json')) return 'cypress';
      
      // Ищем директории с тестами
      const directories = files.filter(async file => {
        const stats = await fs.stat(path.join(repoPath, file));
        return stats.isDirectory();
      });
      
      if (directories.includes('__tests__')) return 'jest';
      if (directories.includes('test') || directories.includes('tests')) {
        // Анализируем файлы в директории тестов
        const testFiles = await fs.readdir(path.join(repoPath, directories.includes('test') ? 'test' : 'tests'));
        const testFileContent = testFiles.length > 0 
          ? await fs.readFile(path.join(repoPath, directories.includes('test') ? 'test' : 'tests', testFiles[0]), 'utf8')
          : '';
        
        if (testFileContent.includes('describe') && testFileContent.includes('it(')) {
          if (testFileContent.includes('expect(')) return 'jest';
          if (testFileContent.includes('assert.')) return 'mocha';
          return 'jasmine';
        }
      }
      
      // По умолчанию используем Jest
      return 'jest';
    } catch (error) {
      logger.warn(`Error detecting test framework: ${error.message}. Using Jest as default.`);
      return 'jest';
    }
  }

  /**
   * Генерация теста для конкретного файла
   * @param {object} file - Файл для тестирования
   * @param {object} options - Дополнительные опции
   * @returns {Promise<object|null>} - Сгенерированный тест
   */
  async generateTestForFile(file, options) {
    const { testFramework, repoPath, context, validationResults } = options;
    
    // Прогнозируем, нужно ли генерировать тест для этого файла
    if (!this.shouldGenerateTestForFile(file, validationResults)) {
      logger.debug(`Skipping test generation for ${file.path}`);
      return null;
    }
    
    // Определяем тип файла и выбираем соответствующий промпт
    const fileType = this.detectFileType(file.path);
    const promptTemplate = await getPromptTemplate(`test-generation-${fileType}`);
    
    // Если промпт не найден, используем общий шаблон
    const finalPromptTemplate = promptTemplate || await getPromptTemplate('test-generation-generic');
    
    // Получаем дополнительный контекст из репозитория
    const additionalContext = await this.getAdditionalContext(file, repoPath, context);
    
    // Формируем контекст для промпта
    const promptContext = {
      filePath: file.path,
      fileContent: file.content,
      testFramework,
      fileType,
      validationResults: validationResults ? 
        validationResults.fileResults.find(fr => fr.filePath === file.path) : null,
      ...additionalContext,
      ...context
    };
    
    // Отправляем запрос к LLM
    const response = await llmClient.generateContent(finalPromptTemplate, promptContext);
    
    // Извлекаем тестовый код из ответа
    const testCode = this.extractTestCode(response);
    
    // Определяем путь для тестового файла
    const testFilePath = this.getTestFilePath(file.path, testFramework);
    
    return {
      originalFilePath: file.path,
      testFilePath,
      testCode,
      framework: testFramework,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Определение типа файла на основе расширения и содержимого
   * @param {string} filePath - Путь к файлу
   * @returns {string} - Тип файла
   */
  detectFileType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath).toLowerCase();
    
    // Определяем по расширению
    if (extension === '.js' || extension === '.jsx') {
      if (basename.includes('component') || basename.includes('.jsx')) return 'react';
      if (basename.includes('controller')) return 'controller';
      if (basename.includes('route')) return 'api';
      if (basename.includes('model')) return 'model';
      if (basename.includes('middleware')) return 'middleware';
      if (basename.includes('util') || basename.includes('helper')) return 'util';
      return 'javascript';
    }
    
    if (extension === '.ts' || extension === '.tsx') {
      if (basename.includes('component') || basename.includes('.tsx')) return 'react-typescript';
      if (basename.includes('controller')) return 'controller-typescript';
      if (basename.includes('route')) return 'api-typescript';
      if (basename.includes('model')) return 'model-typescript';
      return 'typescript';
    }
    
    if (extension === '.html') return 'html';
    if (extension === '.css') return 'css';
    if (extension === '.scss' || extension === '.sass') return 'sass';
    if (extension === '.less') return 'less';
    if (extension === '.py') return 'python';
    if (extension === '.java') return 'java';
    if (extension === '.php') return 'php';
    if (extension === '.rb') return 'ruby';
    if (extension === '.go') return 'go';
    if (extension === '.cs') return 'csharp';
    
    return 'generic';
  }

  /**
   * Определение, нужно ли генерировать тест для файла
   * @param {object} file - Файл для анализа
   * @param {object} validationResults - Результаты валидации кода
   * @returns {boolean} - Нужно ли генерировать тест
   */
  shouldGenerateTestForFile(file, validationResults) {
    const extension = path.extname(file.path).toLowerCase();
    const basename = path.basename(file.path).toLowerCase();
    
    // Не генерируем тесты для тестовых файлов
    if (basename.includes('.test.') || basename.includes('.spec.')) return false;
    if (file.path.includes('__tests__') || file.path.includes('/test/')) return false;
    
    // Не генерируем тесты для некоторых типов файлов
    if (['.md', '.txt', '.json', '.yml', '.yaml', '.lock', '.env'].includes(extension)) return false;
    
    // Не генерируем тесты для файлов с критическими ошибками валидации
    if (validationResults) {
      const fileResult = validationResults.fileResults.find(fr => fr.filePath === file.path);
      if (fileResult && fileResult.criticalErrors.length > 0) return false;
    }
    
    // По умолчанию генерируем тесты для JavaScript/TypeScript файлов
    return ['.js', '.jsx', '.ts', '.tsx'].includes(extension);
  }

  /**
   * Формирование пути для тестового файла
   * @param {string} filePath - Оригинальный путь к файлу
   * @param {string} testFramework - Тестовый фреймворк
   * @returns {string} - Путь для тестового файла
   */
  getTestFilePath(filePath, testFramework) {
    const extension = path.extname(filePath);
    const basename = path.basename(filePath, extension);
    const dirname = path.dirname(filePath);
    
    // Jest обычно использует __tests__ директорию или .test.js суффикс
    if (testFramework === 'jest') {
      // Если файл уже в директории __tests__, используем .test суффикс
      if (dirname.includes('__tests__')) {
        return path.join(dirname, `${basename}.test${extension}`);
      }
      
      // Иначе создаем файл в __tests__ директории рядом с оригинальным файлом
      return path.join(dirname, '__tests__', `${basename}.test${extension}`);
    }
    
    // Mocha обычно использует отдельную директорию test
    if (testFramework === 'mocha' || testFramework === 'mocha-chai') {
      return path.join('test', dirname, `${basename}.spec${extension}`);
    }
    
    // По умолчанию используем .test суффикс
    return path.join(dirname, `${basename}.test${extension}`);
  }

  /**
   * Извлечение тестового кода из ответа LLM
   * @param {string} response - Ответ от LLM
   * @returns {string} - Извлеченный тестовый код
   */
  extractTestCode(response) {
    // Пытаемся извлечь код из блоков кода в формате Markdown
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/g;
    const codeBlocks = [];
    let match;
    
    while ((match = codeBlockRegex.exec(response)) !== null) {
      codeBlocks.push(match[1].trim());
    }
    
    // Если найдены блоки кода, используем их
    if (codeBlocks.length > 0) {
      return codeBlocks.join('\n\n');
    }
    
    // Иначе используем весь ответ, удаляя возможные пояснения
    let cleanResponse = response.trim();
    
    // Удаляем вводные предложения
    const introRegex = /^(Here's|I've created|This is|Below is|The following is).*?\n/i;
    cleanResponse = cleanResponse.replace(introRegex, '');
    
    // Удаляем заключительные предложения
    const outroRegex = /\n(This test|These tests|This should|Hope this|Let me know).*?$/i;
    cleanResponse = cleanResponse.replace(outroRegex, '');
    
    return cleanResponse;
  }

  /**
   * Получение дополнительного контекста из репозитория
   * @param {object} file - Файл для тестирования
   * @param {string} repoPath - Путь к репозиторию
   * @param {object} context - Существующий контекст
   * @returns {Promise<object>} - Дополнительный контекст
   */
  async getAdditionalContext(file, repoPath, context) {
    const additionalContext = {};
    
    try {
      // Проверяем наличие зависимых файлов
      const dirname = path.dirname(file.path);
      const dependentFilePaths = await this.findDependentFiles(file, repoPath);
      
      if (dependentFilePaths.length > 0) {
        const dependentFiles = await Promise.all(dependentFilePaths.map(async (depPath) => {
          try {
            const content = await fs.readFile(path.join(repoPath, depPath), 'utf8');
            return { path: depPath, content };
          } catch (e) {
            logger.debug(`Could not read dependent file ${depPath}: ${e.message}`);
            return null;
          }
        }));
        
        additionalContext.dependentFiles = dependentFiles.filter(f => f !== null);
      }
      
      // Ищем существующие тесты для похожих файлов
      const existingTests = await this.findExistingTests(file, repoPath);
      if (existingTests.length > 0) {
        additionalContext.existingTests = existingTests;
      }
      
      return additionalContext;
    } catch (error) {
      logger.debug(`Error getting additional context: ${error.message}`);
      return additionalContext;
    }
  }

  /**
   * Поиск зависимых файлов
   * @param {object} file - Исходный файл
   * @param {string} repoPath - Путь к репозиторию
   * @returns {Promise<string[]>} - Пути к зависимым файлам
   */
  async findDependentFiles(file, repoPath) {
    try {
      // Ищем импорты в файле
      const importRegex = /(?:import|require)\s*\(?['"](\.\/|\.\.\/|\/)?([^'"]*)['"]\)?/g;
      const imports = [];
      let match;
      
      while ((match = importRegex.exec(file.content)) !== null) {
        imports.push(match[2]);
      }
      
      // Формируем полные пути
      const dirname = path.dirname(file.path);
      const resolvedPaths = [];
      
      for (const importPath of imports) {
        // Игнорируем внешние зависимости (node_modules)
        if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;
        
        // Пытаемся найти файл с разными расширениями
        const extensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];
        let found = false;
        
        for (const ext of extensions) {
          const fullPath = path.resolve(repoPath, dirname, importPath + ext);
          try {
            await fs.access(fullPath);
            resolvedPaths.push(path.relative(repoPath, fullPath));
            found = true;
            break;
          } catch (e) {
            // Файл не найден с этим расширением
          }
        }
        
        // Если не нашли с расширением, пробуем без него
        if (!found) {
          try {
            const fullPath = path.resolve(repoPath, dirname, importPath);
            await fs.access(fullPath);
            resolvedPaths.push(path.relative(repoPath, fullPath));
          } catch (e) {
            // Файл не найден
          }
        }
      }
      
      return resolvedPaths;
    } catch (error) {
      logger.debug(`Error finding dependent files: ${error.message}`);
      return [];
    }
  }

  /**
   * Поиск существующих тестов для похожих файлов
   * @param {object} file - Исходный файл
   * @param {string} repoPath - Путь к репозиторию
   * @returns {Promise<object[]>} - Найденные тесты
   */
  async findExistingTests(file, repoPath) {
    try {
      const extension = path.extname(file.path);
      const basename = path.basename(file.path, extension);
      const dirname = path.dirname(file.path);
      
      // Проверяем наличие тестов в стандартных местах
      const possibleTestLocations = [
        path.join(dirname, '__tests__', `${basename}.test${extension}`),
        path.join(dirname, '__tests__', `${basename}.spec${extension}`),
        path.join(dirname, `${basename}.test${extension}`),
        path.join(dirname, `${basename}.spec${extension}`),
        path.join('test', dirname, `${basename}.spec${extension}`),
        path.join('test', dirname, `${basename}.test${extension}`),
        path.join('tests', dirname, `${basename}.spec${extension}`),
        path.join('tests', dirname, `${basename}.test${extension}`)
      ];
      
      const foundTests = [];
      
      for (const testPath of possibleTestLocations) {
        try {
          const fullPath = path.join(repoPath, testPath);
          const content = await fs.readFile(fullPath, 'utf8');
          foundTests.push({
            path: testPath,
            content
          });
        } catch (e) {
          // Файл не найден
        }
      }
      
      return foundTests;
    } catch (error) {
      logger.debug(`Error finding existing tests: ${error.message}`);
      return [];
    }
  }
}

module.exports = new TestGenerator();
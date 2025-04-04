// src/core/testing-system/index.js

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');

/**
 * Система тестирования для оценки качества генерируемого кода
 * Создает и запускает тесты для проверки функциональности генерируемого кода
 * Предоставляет отчеты о покрытии и других метриках качества
 */
class TestingSystem {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.workDir = path.join(os.tmpdir(), 'biz360-testing', `project-${projectId}`);
  }

  /**
   * Инициализирует систему тестирования
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Создаем рабочую директорию, если она не существует
      await fs.mkdir(this.workDir, { recursive: true });
      
      logger.info(`Система тестирования инициализирована для проекта #${this.projectId}`);
    } catch (error) {
      logger.error(`Ошибка при инициализации системы тестирования:`, error);
      throw error;
    }
  }

  /**
   * Создает тесты для сгенерированного кода
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<Object>} - Информация о созданных тестах
   */
  async createTests(generationId) {
    try {
      logger.info(`Создание тестов для генерации #${generationId}`);
      
      // Получаем информацию о генерации
      const connection = await pool.getConnection();
      
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [generationId]
      );
      
      if (generations.length === 0) {
        connection.release();
        throw new Error(`Генерация с id=${generationId} не найдена`);
      }
      
      const generation = generations[0];
      
      // Получаем информацию о задаче
      const [tasks] = await connection.query(
        'SELECT * FROM tasks WHERE id = ?',
        [generation.task_id]
      );
      
      connection.release();
      
      if (tasks.length === 0) {
        throw new Error(`Задача с id=${generation.task_id} не найдена`);
      }
      
      const task = tasks[0];
      
      // Определяем тип тестов в зависимости от типа файла
      const fileExtension = path.extname(generation.file_path);
      const fileName = path.basename(generation.file_path, fileExtension);
      const testFramework = this.determineTestFramework(fileExtension);
      
      // Создаем промпт для генерации тестов
      const prompt = await this.createTestGenerationPrompt(
        task, 
        generation, 
        testFramework
      );
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.2 // Более низкая температура для генерации тестов
      });
      
      // Извлекаем код тестов из ответа
      const testCode = this.extractTestCodeFromResponse(response, testFramework);
      
      // Сохраняем тесты
      const testId = await this.saveTests(generationId, testCode, fileName, testFramework);
      
      logger.info(`Тесты успешно созданы для генерации #${generationId}, ID теста: ${testId}`);
      
      return {
        id: testId,
        generationId,
        framework: testFramework,
        code: testCode
      };
    } catch (error) {
      logger.error(`Ошибка при создании тестов для генерации #${generationId}:`, error);
      throw error;
    }
  }

  /**
   * Определяет подходящий фреймворк для тестирования
   * @param {string} fileExtension - Расширение файла
   * @returns {string} - Название фреймворка для тестирования
   */
  determineTestFramework(fileExtension) {
    switch (fileExtension.toLowerCase()) {
      case '.js':
        return 'jest';
      case '.ts':
        return 'jest-ts';
      case '.jsx':
      case '.tsx':
        return 'react-testing-library';
      case '.sql':
        return 'sql-test';
      default:
        return 'jest';
    }
  }

  /**
   * Создает промпт для генерации тестов
   * @param {Object} task - Задача
   * @param {Object} generation - Генерация кода
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {Promise<string>} - Промпт для LLM
   */
  async createTestGenerationPrompt(task, generation, testFramework) {
    // Определяем правильный шаблон для выбранного фреймворка
    let frameworkInstructions = '';
    
    switch (testFramework) {
      case 'jest':
        frameworkInstructions = `
- Используй Jest в качестве фреймворка для тестирования
- Включи все необходимые импорты, включая модуль, который тестируется
- Используй describe/it/test блоки для структурирования тестов
- Используй expect с соответствующими матчерами для проверок
- Используй моки (jest.mock) для имитации зависимостей, если необходимо
- Тесты должны быть исчерпывающими и покрывать успешные и ошибочные сценарии
`;
        break;
      
      case 'jest-ts':
        frameworkInstructions = `
- Используй Jest с TypeScript
- Включи необходимые типы и интерфейсы
- Используй строгую типизацию для всех функций и переменных
- Импортируй типы из тестируемого модуля, если необходимо
- Структурируй тесты с помощью describe/it/test блоков
- Используй expect с соответствующими матчерами для проверок
`;
        break;
      
      case 'react-testing-library':
        frameworkInstructions = `
- Используй React Testing Library и Jest
- Используй render для рендеринга компонентов
- Используй screen для запросов к DOM
- Используй userEvent для имитации взаимодействия пользователя
- Тестируй поведение, а не реализацию
- Фокусируйся на доступности и пользовательском опыте
`;
        break;
      
      case 'sql-test':
        frameworkInstructions = `
- Создай тесты для SQL-запросов с использованием node-sql-parser
- Проверь синтаксис SQL-запросов
- Проверь наличие необходимых таблиц и столбцов
- Используй моки для имитации базы данных
`;
        break;
      
      default:
        frameworkInstructions = `
- Используй Jest в качестве фреймворка для тестирования
- Включи все необходимые импорты
- Структурируй тесты с помощью describe/it/test блоков
`;
    }
    
    return `
# Задача: Создание тестов для кода

## Описание задачи
${task.description}

## Код для тестирования
\`\`\`javascript
${generation.generated_content}
\`\`\`

## Фреймворк и требования к тестам
${frameworkInstructions}

## Дополнительные инструкции
- Тесты должны быть автономными и не требовать внешних зависимостей
- Используй моки для сетевых запросов, баз данных и файловой системы
- Пиши тесты, которые проверяют как успешные, так и ошибочные сценарии
- Комментируй тесты для объяснения, что именно они проверяют
- Предусмотри различные случаи использования, включая граничные условия

Создай полный набор тестов, который можно запустить с помощью Jest.
Ответ должен содержать только код тестов без дополнительных пояснений.
`;
  }

  /**
   * Извлекает код тестов из ответа LLM
   * @param {string} response - Ответ от LLM
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {string} - Код тестов
   */
  extractTestCodeFromResponse(response, testFramework) {
    // Ищем блоки кода в ответе
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\n([\s\S]*?)```/g;
    const matches = [];
    let match;
    
    while ((match = codeBlockRegex.exec(response)) !== null) {
      matches.push(match[1]);
    }
    
    // Если нашли блоки кода, объединяем их
    if (matches.length > 0) {
      return matches.join('\n\n');
    }
    
    // Если не нашли блоков кода, возвращаем весь ответ как код
    return response;
  }

  /**
   * Сохраняет тесты в базу данных
   * @param {number} generationId - ID генерации кода
   * @param {string} testCode - Код тестов
   * @param {string} fileName - Имя файла без расширения
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {Promise<number>} - ID созданного теста
   */
  async saveTests(generationId, testCode, fileName, testFramework) {
    try {
      const testFileName = this.generateTestFileName(fileName, testFramework);
      
      const connection = await pool.getConnection();
      
      // Сохраняем тест в базу данных
      const [result] = await connection.query(
        'INSERT INTO tests (code_generation_id, test_name, test_content, result) VALUES (?, ?, ?, ?)',
        [generationId, testFileName, testCode, 'pending']
      );
      
      connection.release();
      
      return result.insertId;
    } catch (error) {
      logger.error(`Ошибка при сохранении тестов:`, error);
      throw error;
    }
  }

  /**
   * Генерирует имя файла для тестов
   * @param {string} fileName - Имя файла без расширения
   * @param {string} testFramework - Фреймворк для тестирования
   * @returns {string} - Имя файла для тестов
   */
  generateTestFileName(fileName, testFramework) {
    switch (testFramework) {
      case 'jest':
        return `${fileName}.test.js`;
      case 'jest-ts':
        return `${fileName}.test.ts`;
      case 'react-testing-library':
        return `${fileName}.test.jsx`;
      case 'sql-test':
        return `${fileName}.sql.test.js`;
      default:
        return `${fileName}.test.js`;
    }
  }

  /**
   * Запускает тесты для оценки качества кода
   * @param {number} testId - ID теста
   * @returns {Promise<Object>} - Результаты тестирования
   */
  async runTests(testId) {
    try {
      logger.info(`Запуск тестов #${testId}`);
      
      // Получаем информацию о тесте
      const connection = await pool.getConnection();
      
      const [tests] = await connection.query(
        'SELECT * FROM tests WHERE id = ?',
        [testId]
      );
      
      if (tests.length === 0) {
        connection.release();
        throw new Error(`Тест с id=${testId} не найден`);
      }
      
      const test = tests[0];
      
      // Получаем информацию о генерации кода
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [test.code_generation_id]
      );
      
      connection.release();
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${test.code_generation_id} не найдена`);
      }
      
      const generation = generations[0];
      
      // Создаем временную директорию для тестирования
      const testDir = path.join(this.workDir, `test-${testId}`);
      await fs.mkdir(testDir, { recursive: true });
      
      try {
        // Создаем файл с кодом
        const codeFileName = path.basename(generation.file_path);
        const codeFilePath = path.join(testDir, codeFileName);
        await fs.writeFile(codeFilePath, generation.generated_content);
        
        // Создаем файл с тестами
        const testFilePath = path.join(testDir, test.test_name);
        await fs.writeFile(testFilePath, test.test_content);
        
        // Создаем package.json для установки зависимостей
        const packageJson = {
          name: `test-${testId}`,
          version: '1.0.0',
          description: 'Temporary package for testing',
          scripts: {
            test: 'jest',
            'test:coverage': 'jest --coverage'
          },
          dependencies: {
            jest: '^29.0.0',
            '@types/jest': '^29.0.0',
            '@testing-library/react': '^14.0.0',
            '@testing-library/jest-dom': '^6.0.0',
            'node-sql-parser': '^4.0.0'
          }
        };
        
        await fs.writeFile(
          path.join(testDir, 'package.json'),
          JSON.stringify(packageJson, null, 2)
        );
        
        // Создаем jest.config.js
        const jestConfig = `
module.exports = {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'jsx'],
  testMatch: ['**/*.test.js', '**/*.test.jsx'],
  collectCoverageFrom: ['*.js', '!jest.config.js', '!node_modules/**'],
  coverageReporters: ['json', 'lcov', 'text', 'clover'],
  verbose: true
};
`;
        
        await fs.writeFile(path.join(testDir, 'jest.config.js'), jestConfig);
        
        // Запускаем установку зависимостей
        await this.runCommand('npm', ['install'], testDir);
        
        // Запускаем тесты с покрытием
        const { stdout, stderr } = await this.runCommand(
          'npm', 
          ['run', 'test:coverage'], 
          testDir
        );
        
        // Парсим результаты покрытия
        const coverageResults = this.parseCoverageResults(stdout);
        
        // Обновляем статус теста в БД
        await this.updateTestStatus(
          testId, 
          coverageResults.failed === 0 ? 'passed' : 'failed',
          stdout,
          coverageResults
        );
        
        logger.info(`Тесты #${testId} успешно выполнены`);
        
        return {
          testId,
          status: coverageResults.failed === 0 ? 'passed' : 'failed',
          results: coverageResults,
          output: stdout,
          error: stderr
        };
      } finally {
        // Удаляем временную директорию с тестами
        try {
          await this.runCommand('rm', ['-rf', testDir], os.tmpdir());
        } catch (err) {
          logger.warn(`Не удалось удалить временную директорию ${testDir}:`, err);
        }
      }
    } catch (error) {
      logger.error(`Ошибка при запуске тестов #${testId}:`, error);
      
      // Обновляем статус теста на "failed"
      await this.updateTestStatus(testId, 'failed', '', { 
        error: error.message 
      });
      
      throw error;
    }
  }

  /**
   * Запускает команду в указанной директории
   * @param {string} command - Команда для запуска
   * @param {Array<string>} args - Аргументы команды
   * @param {string} cwd - Рабочая директория
   * @returns {Promise<{stdout: string, stderr: string}>} - Вывод команды
   */
  runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0 || command === 'npm') {
          // npm может возвращать ненулевой код при ошибках в тестах,
          // но мы всё равно хотим получить вывод
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Команда завершилась с кодом ${code}: ${stderr}`));
        }
      });
      
      process.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Парсит результаты покрытия из вывода Jest
   * @param {string} output - Вывод команды запуска тестов
   * @returns {Object} - Результаты покрытия
   */
  parseCoverageResults(output) {
    try {
      // Извлекаем информацию о тестах
      const testResults = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        coverage: {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        execution_time: 0
      };
      
      // Поиск строки с общим результатом тестов
      const testSummaryRegex = /Tests:\s+(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+total/i;
      const testSummaryMatch = output.match(testSummaryRegex);
      
      if (testSummaryMatch) {
        testResults.passed = parseInt(testSummaryMatch[1], 10);
        testResults.failed = parseInt(testSummaryMatch[2], 10);
        testResults.total = parseInt(testSummaryMatch[3], 10);
      }
      
      // Поиск строк с покрытием
      const coverageRegex = /All files[^\n]*\|[\s\d.]+\|[\s\d.]+\|[\s\d.]+\|[\s\d.]+\|/;
      const coverageMatch = output.match(coverageRegex);
      
      if (coverageMatch) {
        const coverageLine = coverageMatch[0];
        const coverageValues = coverageLine.split('|').filter(str => str.trim());
        
        if (coverageValues.length >= 5) {
          testResults.coverage.statements = parseFloat(coverageValues[1].trim());
          testResults.coverage.branches = parseFloat(coverageValues[2].trim());
          testResults.coverage.functions = parseFloat(coverageValues[3].trim());
          testResults.coverage.lines = parseFloat(coverageValues[4].trim());
        }
      }
      
      // Поиск времени выполнения
      const timeRegex = /Time:\s+([\d.]+)\s+s/i;
      const timeMatch = output.match(timeRegex);
      
      if (timeMatch) {
        testResults.execution_time = parseFloat(timeMatch[1]) * 1000; // Преобразуем в мс
      }
      
      return testResults;
    } catch (error) {
      logger.error('Ошибка при парсинге результатов покрытия:', error);
      
      return {
        total: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        coverage: {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        },
        execution_time: 0,
        error: error.message
      };
    }
  }

  /**
   * Обновляет статус теста в БД
   * @param {number} testId - ID теста
   * @param {string} status - Статус теста ('passed', 'failed', 'pending')
   * @param {string} output - Вывод тестов
   * @param {Object} results - Результаты тестов
   * @returns {Promise<void>}
   */
  async updateTestStatus(testId, status, output, results) {
    try {
      const connection = await pool.getConnection();
      
      await connection.query(
        `UPDATE tests 
         SET result = ?, output = ?, coverage = ?, execution_time = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          status,
          output,
          JSON.stringify(results),
          results.execution_time || 0,
          testId
        ]
      );
      
      connection.release();
      
      logger.info(`Статус теста #${testId} обновлен на "${status}"`);
    } catch (error) {
      logger.error(`Ошибка при обновлении статуса теста #${testId}:`, error);
      throw error;
    }
  }

  /**
   * Анализирует результаты тестов и предоставляет рекомендации по улучшению
   * @param {number} testId - ID теста
   * @returns {Promise<Object>} - Рекомендации по улучшению
   */
  async analyzeTestResults(testId) {
    try {
      logger.info(`Анализ результатов тестов #${testId}`);
      
      // Получаем информацию о тесте
      const connection = await pool.getConnection();
      
      const [tests] = await connection.query(
        'SELECT * FROM tests WHERE id = ?',
        [testId]
      );
      
      if (tests.length === 0) {
        connection.release();
        throw new Error(`Тест с id=${testId} не найден`);
      }
      
      const test = tests[0];
      
      // Получаем информацию о генерации кода
      const [generations] = await connection.query(
        'SELECT * FROM code_generations WHERE id = ?',
        [test.code_generation_id]
      );
      
      connection.release();
      
      if (generations.length === 0) {
        throw new Error(`Генерация с id=${test.code_generation_id} не найдена`);
      }
      
      const generation = generations[0];
      
      // Анализируем результаты тестов с помощью LLM
      const coverage = test.coverage ? JSON.parse(test.coverage) : {};
      
      const prompt = `
# Задача: Анализ результатов тестирования и рекомендации по улучшению кода

## Код
\`\`\`javascript
${generation.generated_content}
\`\`\`

## Тесты
\`\`\`javascript
${test.test_content}
\`\`\`

## Результаты тестирования
- Статус: ${test.result}
- Всего тестов: ${coverage.total || 'Н/Д'}
- Успешных тестов: ${coverage.passed || 'Н/Д'}
- Неудачных тестов: ${coverage.failed || 'Н/Д'}
- Пропущенных тестов: ${coverage.skipped || 'Н/Д'}
- Покрытие выражений: ${coverage.coverage?.statements || 'Н/Д'}%
- Покрытие ветвлений: ${coverage.coverage?.branches || 'Н/Д'}%
- Покрытие функций: ${coverage.coverage?.functions || 'Н/Д'}%
- Покрытие строк: ${coverage.coverage?.lines || 'Н/Д'}%

## Вывод тестов
\`\`\`
${test.output ? test.output.substring(0, 2000) : 'Нет вывода'}
\`\`\`

## Задание
Проанализируй результаты тестирования и предоставь рекомендации по улучшению кода. Обрати внимание на:
1. Проблемы, обнаруженные тестами
2. Недостаточное покрытие тестами
3. Уязвимые места в коде
4. Возможные улучшения производительности
5. Лучшие практики, которые можно применить

Предоставь конкретные рекомендации по улучшению кода, указывая на конкретные строки и фрагменты.
`;
      
      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Более низкая температура для аналитического ответа
      });
      
      logger.info(`Анализ результатов тестов #${testId} успешно выполнен`);
      
      return {
        testId,
        analysis: response
      };
    } catch (error) {
      logger.error(`Ошибка при анализе результатов тестов #${testId}:`, error);
      throw error;
    }
  }
}

module.exports = TestingSystem;
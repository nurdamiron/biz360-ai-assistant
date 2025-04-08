/**
 * Безопасное выполнение кода в изолированной среде
 * Позволяет запускать код и тесты с минимальными рисками
 */

const path = require('path');
const { spawn, exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const os = require('os');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const dockerManager = require('./docker-manager');
const executionGuard = require('./execution-guard');

// Промисифицируем exec для удобства использования
const execPromise = util.promisify(exec);

/**
 * Запускает код в изолированной среде
 * 
 * @param {string} code - Код для выполнения
 * @param {string} language - Язык программирования (javascript, python, etc.)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат выполнения
 */
async function runCodeInSandbox(code, language, options = {}) {
    try {
        // Параметры запуска
        const { 
            timeout = 10000, // Таймаут по умолчанию: 10 секунд
            memoryLimit = '512M', // Лимит памяти по умолчанию: 512MB
            input = '', // Входные данные для stdin
            args = [], // Аргументы командной строки
            environment = {}, // Переменные окружения
            workingDir = null, // Рабочая директория
            executeInDocker = true, // Выполнять в Docker по умолчанию
            securityLevel = 'high', // Уровень безопасности: high/medium/low
            captureOutput = true // Захватывать вывод в stdout/stderr
        } = options;

        logger.debug('Running code in sandbox', { language, timeout, memoryLimit, executeInDocker });
        
        // Проверка кода на наличие потенциально опасных конструкций
        const securityCheck = await executionGuard.checkCodeSecurity(code, language, { securityLevel });
        
        if (!securityCheck.safe) {
            return {
                success: false,
                stdout: '',
                stderr: '',
                error: `Код не прошел проверку безопасности: ${securityCheck.reason}`,
                executionTime: 0,
                restricted: true
            };
        }
        
        // Выбор метода выполнения
        if (executeInDocker) {
            return await runInDocker(code, language, { 
                timeout, 
                memoryLimit, 
                input, 
                args, 
                environment,
                workingDir,
                captureOutput
            });
        } else {
            return await runInProcess(code, language, { 
                timeout, 
                input, 
                args, 
                environment,
                workingDir,
                captureOutput
            });
        }
    } catch (error) {
        logger.error('Error running code in sandbox', { error: error.message, stack: error.stack });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка запуска кода: ${error.message}`,
            executionTime: 0
        };
    }
}

/**
 * Запускает тесты в изолированной среде
 * 
 * @param {Object} testConfig - Конфигурация тестов
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результаты тестов
 */
async function safelyExecuteTests(testConfig, options = {}) {
    try {
        const {
            testFiles, // Пути к файлам тестов
            testCommand, // Команда для запуска тестов
            projectPath, // Путь к проекту
            testFramework, // Фреймворк тестирования (jest, mocha и т.д.)
            timeout = 60000, // Таймаут по умолчанию: 60 секунд
            environment = {}, // Переменные окружения
            executeInDocker = true, // Выполнять в Docker по умолчанию
            dockerImage = null, // Образ Docker
            collectCoverage = true, // Собирать информацию о покрытии кода
            retryCount = 0 // Количество повторных попыток при неудаче
        } = options;
        
        logger.info('Running tests in sandbox', { 
            testFramework,
            testFiles: Array.isArray(testFiles) ? testFiles.length : 'custom command',
            projectPath,
            executeInDocker
        });
        
        // Формируем команду для запуска тестов, если не предоставлена явно
        let finalTestCommand = testCommand;
        if (!finalTestCommand && testFramework) {
            finalTestCommand = buildTestCommand(testFramework, testFiles, { 
                collectCoverage,
                projectPath
            });
        }
        
        if (!finalTestCommand) {
            throw new Error('Test command not provided and could not be built automatically');
        }
        
        logger.debug('Test command', { command: finalTestCommand });
        
        let result;
        let attempts = 0;
        
        // Выполняем тесты с возможностью повторных попыток
        do {
            if (attempts > 0) {
                logger.info(`Retrying test execution (attempt ${attempts})`);
            }
            
            // Запускаем тесты в Docker или напрямую
            if (executeInDocker) {
                result = await runTestsInDocker(finalTestCommand, {
                    projectPath,
                    timeout,
                    environment,
                    dockerImage
                });
            } else {
                result = await runTestsInProcess(finalTestCommand, {
                    projectPath,
                    timeout,
                    environment
                });
            }
            
            attempts++;
        } while (!result.success && attempts <= retryCount);
        
        // Парсим результаты тестов, если нужно
        if (result.success && collectCoverage) {
            try {
                result.coverage = await parseCoverageReport(projectPath, testFramework);
            } catch (error) {
                logger.warn('Failed to parse coverage report', { error: error.message });
            }
        }
        
        // Парсим вывод тестового фреймворка для получения детальных результатов
        if (testFramework) {
            try {
                result.details = parseTestOutput(result.stdout, testFramework);
            } catch (error) {
                logger.warn('Failed to parse test output', { error: error.message });
            }
        }
        
        return result;
    } catch (error) {
        logger.error('Error executing tests', { error: error.message, stack: error.stack });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка запуска тестов: ${error.message}`,
            executionTime: 0
        };
    }
}

/**
 * Запускает код в Docker-контейнере
 * 
 * @param {string} code - Код для выполнения
 * @param {string} language - Язык программирования
 * @param {Object} options - Параметры запуска
 * @returns {Promise<Object>} - Результат выполнения
 */
async function runInDocker(code, language, options) {
    try {
        // Создаём временный файл с кодом
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
        const codeFilename = getCodeFilename(language);
        const codePath = path.join(tempDir, codeFilename);
        
        await fs.writeFile(codePath, code);
        
        // Получаем соответствующий Docker-образ и команду для языка
        const { image, command } = dockerManager.getDockerConfig(language);
        
        // Запускаем Docker-контейнер с ограничениями
        const startTime = Date.now();
        
        const result = await dockerManager.runContainer({
            image,
            command: command.replace('{file}', `/app/${codeFilename}`),
            bindMount: {
                source: tempDir,
                target: '/app'
            },
            timeout: options.timeout,
            memoryLimit: options.memoryLimit,
            input: options.input,
            env: options.environment,
            args: options.args
        });
        
        const executionTime = Date.now() - startTime;
        
        // Очищаем временные файлы
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            logger.warn('Failed to clean up temporary directory', { dir: tempDir, error: error.message });
        }
        
        return {
            success: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime,
            restricted: true
        };
    } catch (error) {
        logger.error('Error running code in Docker', { error: error.message });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка запуска в Docker: ${error.message}`,
            executionTime: 0,
            restricted: true
        };
    }
}

/**
 * Запускает код непосредственно в процессе Node.js
 * Внимание: Это менее безопасный вариант!
 * 
 * @param {string} code - Код для выполнения
 * @param {string} language - Язык программирования
 * @param {Object} options - Параметры запуска
 * @returns {Promise<Object>} - Результат выполнения
 */
async function runInProcess(code, language, options) {
    // Эта функция намеренно ограничена только несколькими доверенными языками
    const allowedLanguages = ['javascript', 'typescript'];
    
    if (!allowedLanguages.includes(language.toLowerCase())) {
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Прямое выполнение кода поддерживается только для: ${allowedLanguages.join(', ')}`,
            executionTime: 0
        };
    }
    
    try {
        // Для JavaScript можно использовать eval в отдельном контексте
        // Внимание: Это все равно менее безопасно, чем Docker!
        if (language.toLowerCase() === 'javascript') {
            const { VM } = require('vm2'); // Требуется установка: npm install vm2
            const vm = new VM({
                timeout: options.timeout,
                sandbox: {
                    console: {
                        log: (...args) => outputBuffer.stdout.push(args.join(' ')),
                        error: (...args) => outputBuffer.stderr.push(args.join(' ')),
                        warn: (...args) => outputBuffer.stderr.push(args.join(' ')),
                    },
                    process: {
                        env: { ...options.environment }
                    }
                }
            });
            
            const outputBuffer = {
                stdout: [],
                stderr: []
            };
            
            const startTime = Date.now();
            
            try {
                // Выполняем код в изолированной среде
                vm.run(code);
                
                return {
                    success: true,
                    stdout: outputBuffer.stdout.join('\n'),
                    stderr: outputBuffer.stderr.join('\n'),
                    executionTime: Date.now() - startTime,
                    restricted: true
                };
            } catch (vmError) {
                return {
                    success: false,
                    stdout: outputBuffer.stdout.join('\n'),
                    stderr: outputBuffer.stderr.join('\n') + `\nError: ${vmError.message}`,
                    error: vmError.message,
                    executionTime: Date.now() - startTime,
                    restricted: true
                };
            }
        }
        
        // Для TypeScript необходимо сначала транспилировать
        if (language.toLowerCase() === 'typescript') {
            // Создаём временный файл с кодом
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
            const tsPath = path.join(tempDir, 'code.ts');
            
            await fs.writeFile(tsPath, code);
            
            try {
                // Транспилируем TS в JS (требуется установка typescript)
                const tsc = path.join(process.cwd(), 'node_modules', '.bin', 'tsc');
                await execPromise(`${tsc} --target ES2020 --module CommonJS ${tsPath}`, { 
                    cwd: tempDir,
                    timeout: 10000
                });
                
                // Теперь запускаем получившийся JS
                const jsPath = path.join(tempDir, 'code.js');
                const jsCode = await fs.readFile(jsPath, 'utf8');
                
                // Запускаем JS код через механизм для JavaScript
                return await runInProcess(jsCode, 'javascript', options);
            } finally {
                // Очищаем временные файлы
                try {
                    await fs.rm(tempDir, { recursive: true, force: true });
                } catch (error) {
                    logger.warn('Failed to clean up temporary directory', { dir: tempDir, error: error.message });
                }
            }
        }
    } catch (error) {
        logger.error('Error running code in process', { error: error.message });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка выполнения кода: ${error.message}`,
            executionTime: 0
        };
    }
}

/**
 * Запускает тесты в Docker-контейнере
 * 
 * @param {string} testCommand - Команда для запуска тестов
 * @param {Object} options - Параметры запуска
 * @returns {Promise<Object>} - Результаты тестов
 */
async function runTestsInDocker(testCommand, options) {
    try {
        const {
            projectPath,
            timeout = 60000,
            environment = {},
            dockerImage = null
        } = options;
        
        if (!projectPath) {
            throw new Error('Project path is required for running tests in Docker');
        }
        
        // Если образ не указан явно, пытаемся определить из package.json
        let image = dockerImage;
        if (!image) {
            try {
                const packageJsonPath = path.join(projectPath, 'package.json');
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
                
                // Определяем образ на основе версии Node.js в package.json
                const nodeVersion = packageJson.engines?.node || 'latest';
                image = `node:${nodeVersion.replace(/[^\d\.]/g, '')}`;
            } catch (error) {
                // Если не удалось определить, используем стандартный образ
                image = 'node:lts';
                logger.warn('Using default Node.js image for testing', { 
                    error: error.message,
                    defaultImage: image
                });
            }
        }
        
        // Запускаем контейнер с проектом
        const startTime = Date.now();
        
        const result = await dockerManager.runContainer({
            image,
            command: testCommand,
            bindMount: {
                source: projectPath,
                target: '/app'
            },
            workdir: '/app',
            timeout,
            env: {
                ...environment,
                CI: 'true' // Многие тестовые фреймворки ведут себя иначе в CI окружении
            }
        });
        
        const executionTime = Date.now() - startTime;
        
        return {
            success: result.exitCode === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime
        };
    } catch (error) {
        logger.error('Error running tests in Docker', { error: error.message });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка запуска тестов в Docker: ${error.message}`,
            executionTime: 0
        };
    }
}

/**
 * Запускает тесты непосредственно в процессе
 * 
 * @param {string} testCommand - Команда для запуска тестов
 * @param {Object} options - Параметры запуска
 * @returns {Promise<Object>} - Результаты тестов
 */
async function runTestsInProcess(testCommand, options) {
    try {
        const {
            projectPath,
            timeout = 60000,
            environment = {}
        } = options;
        
        if (!projectPath) {
            throw new Error('Project path is required for running tests');
        }
        
        // Запускаем команду тестирования
        const startTime = Date.now();
        
        const child = spawn('sh', ['-c', testCommand], {
            cwd: projectPath,
            env: { ...process.env, ...environment, CI: 'true' },
            shell: true
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        // Устанавливаем таймаут
        const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            stderr += '\nTest execution timed out';
        }, timeout);
        
        return new Promise((resolve) => {
            child.on('close', (code) => {
                clearTimeout(timeoutId);
                const executionTime = Date.now() - startTime;
                
                resolve({
                    success: code === 0,
                    stdout,
                    stderr,
                    exitCode: code,
                    executionTime
                });
            });
        });
    } catch (error) {
        logger.error('Error running tests in process', { error: error.message });
        return {
            success: false,
            stdout: '',
            stderr: '',
            error: `Ошибка запуска тестов: ${error.message}`,
            executionTime: 0
        };
    }
}

/**
 * Строит команду для запуска тестов на основе фреймворка
 * 
 * @param {string} framework - Фреймворк тестирования
 * @param {Array} testFiles - Файлы тестов
 * @param {Object} options - Дополнительные опции
 * @returns {string} - Команда для запуска тестов
 */
function buildTestCommand(framework, testFiles, options = {}) {
    const { collectCoverage = true, projectPath } = options;
    
    // Формируем путь к бинарнику фреймворка
    const binPath = projectPath 
        ? path.join('node_modules', '.bin')
        : path.join(process.cwd(), 'node_modules', '.bin');
    
    const frameworkCommands = {
        'jest': () => {
            const coverageFlag = collectCoverage ? '--coverage' : '';
            const filesString = Array.isArray(testFiles) && testFiles.length > 0
                ? testFiles.join(' ')
                : '';
            return `${binPath}/jest ${coverageFlag} ${filesString}`;
        },
        'mocha': () => {
            const filesString = Array.isArray(testFiles) && testFiles.length > 0
                ? testFiles.join(' ')
                : 'test/**/*.js';
            return `${binPath}/mocha ${filesString}`;
        },
        'ava': () => {
            const filesString = Array.isArray(testFiles) && testFiles.length > 0
                ? testFiles.join(' ')
                : '';
            return `${binPath}/ava ${filesString}`;
        },
        'jasmine': () => {
            const filesString = Array.isArray(testFiles) && testFiles.length > 0
                ? testFiles.join(' ')
                : '';
            return `${binPath}/jasmine ${filesString}`;
        },
        // Добавьте другие фреймворки по необходимости
    };
    
    // Если известный фреймворк, формируем команду
    if (frameworkCommands[framework.toLowerCase()]) {
        return frameworkCommands[framework.toLowerCase()]();
    }
    
    // Если неизвестный фреймворк, пытаемся использовать команду из скриптов package.json
    if (projectPath) {
        try {
            const packageJsonPath = path.join(projectPath, 'package.json');
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            
            if (packageJson.scripts && packageJson.scripts.test) {
                return 'npm test';
            }
        } catch (error) {
            logger.warn('Failed to read package.json for test command', { error: error.message });
        }
    }
    
    // По умолчанию используем Jest
    return `${binPath}/jest ${collectCoverage ? '--coverage' : ''}`;
}

/**
 * Парсит отчет о покрытии кода
 * 
 * @param {string} projectPath - Путь к проекту
 * @param {string} framework - Фреймворк тестирования
 * @returns {Promise<Object>} - Данные покрытия
 */
async function parseCoverageReport(projectPath, framework) {
    try {
        // Различные фреймворки сохраняют отчеты в разных местах
        const coveragePaths = {
            'jest': path.join(projectPath, 'coverage', 'coverage-final.json'),
            'mocha': path.join(projectPath, 'coverage', 'coverage.json'),
            // Другие фреймворки...
        };
        
        const coveragePath = coveragePaths[framework.toLowerCase()] || 
                           path.join(projectPath, 'coverage', 'coverage-final.json');
        
        // Пытаемся прочитать отчет о покрытии
        const coverageData = JSON.parse(await fs.readFile(coveragePath, 'utf8'));
        
        // Преобразуем данные в более простой формат
        const summary = {
            lines: {
                total: 0,
                covered: 0,
                percentage: 0
            },
            statements: {
                total: 0,
                covered: 0,
                percentage: 0
            },
            functions: {
                total: 0,
                covered: 0,
                percentage: 0
            },
            branches: {
                total: 0,
                covered: 0,
                percentage: 0
            },
            files: []
        };
        
        // Обрабатываем файлы в отчете
        for (const filePath in coverageData) {
            const file = coverageData[filePath];
            
            // Суммируем статистику
            summary.statements.total += file.s.total || 0;
            summary.statements.covered += file.s.covered || 0;
            summary.lines.total += file.l.total || 0;
            summary.lines.covered += file.l.covered || 0;
            summary.functions.total += file.f.total || 0;
            summary.functions.covered += file.f.covered || 0;
            summary.branches.total += file.b.total || 0;
            summary.branches.covered += file.b.covered || 0;
            
            // Добавляем информацию о файле
            summary.files.push({
                path: filePath.replace(projectPath, ''),
                statements: {
                    percentage: file.s.pct,
                    covered: file.s.covered,
                    total: file.s.total
                },
                lines: {
                    percentage: file.l.pct,
                    covered: file.l.covered,
                    total: file.l.total
                },
                functions: {
                    percentage: file.f.pct,
                    covered: file.f.covered,
                    total: file.f.total
                },
                branches: {
                    percentage: file.b.pct,
                    covered: file.b.covered,
                    total: file.b.total
                }
            });
        }
        
        // Вычисляем проценты
        if (summary.statements.total > 0) {
            summary.statements.percentage = Math.round(
                (summary.statements.covered / summary.statements.total) * 100
            );
        }
        
        if (summary.lines.total > 0) {
            summary.lines.percentage = Math.round(
                (summary.lines.covered / summary.lines.total) * 100
            );
        }
        
        if (summary.functions.total > 0) {
            summary.functions.percentage = Math.round(
                (summary.functions.covered / summary.functions.total) * 100
            );
        }
        
        if (summary.branches.total > 0) {
            summary.branches.percentage = Math.round(
                (summary.branches.covered / summary.branches.total) * 100
            );
        }
        
        return summary;
    } catch (error) {
        logger.warn('Failed to parse coverage report', { error: error.message });
        return null;
    }
}

/**
 * Парсит вывод тестов для получения детальных результатов
 * 
 * @param {string} output - Вывод тестов
 * @param {string} framework - Фреймворк тестирования
 * @returns {Object} - Детальные результаты тестов
 */
function parseTestOutput(output, framework) {
    // Различные стратегии парсинга для разных фреймворков
    const parsers = {
        'jest': parseJestOutput,
        'mocha': parseMochaOutput,
        // Другие фреймворки...
    };
    
    if (parsers[framework.toLowerCase()]) {
        return parsers[framework.toLowerCase()](output);
    }
    
    // По умолчанию возвращаем базовую информацию
    return {
        passed: !output.includes('FAIL') && !output.includes('ERROR'),
        failureCount: (output.match(/FAIL/g) || []).length,
        errorCount: (output.match(/ERROR/g) || []).length,
        output: output
    };
}

/**
 * Парсит вывод Jest
 * 
 * @param {string} output - Вывод Jest
 * @returns {Object} - Детальные результаты тестов
 */
function parseJestOutput(output) {
    try {
        const result = {
            passed: output.includes('PASS'),
            failed: output.includes('FAIL'),
            testResults: [],
            summary: {}
        };
        
        // Пытаемся извлечь суммарную информацию
        const summaryMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
        if (summaryMatch) {
            result.summary = {
                failed: parseInt(summaryMatch[1], 10),
                passed: parseInt(summaryMatch[2], 10),
                total: parseInt(summaryMatch[3], 10)
            };
        }
        
        // Извлекаем информацию о времени выполнения
        const timeMatch = output.match(/Time:\s+([\d\.]+)s/);
        if (timeMatch) {
            result.summary.time = parseFloat(timeMatch[1]);
        }
        
        // Извлекаем результаты отдельных тестов
        const testMatchRegex = /PASS|FAIL\s+([^\n]+)\n([^]+?)(?=\n\n|$)/g;
        let match;
        
        while ((match = testMatchRegex.exec(output)) !== null) {
            const testFile = match[1].trim();
            const testDetails = match[2];
            
            // Извлекаем индивидуальные тесты
            const testCases = [];
            const testCaseRegex = /(?:✓|✕)\s+([^\n]+)/g;
            let testCaseMatch;
            
            while ((testCaseMatch = testCaseRegex.exec(testDetails)) !== null) {
                testCases.push({
                    name: testCaseMatch[1].trim(),
                    passed: testDetails.includes('✓')
                });
            }
            
            result.testResults.push({
                file: testFile,
                passed: !testDetails.includes('✕'),
                testCases
            });
        }
        
        return result;
    } catch (error) {
        logger.warn('Failed to parse Jest output', { error: error.message });
        return {
            passed: output.includes('PASS'),
            failed: output.includes('FAIL'),
            output
        };
    }
}

/**
 * Парсит вывод Mocha
 * 
 * @param {string} output - Вывод Mocha
 * @returns {Object} - Детальные результаты тестов
 */
function parseMochaOutput(output) {
    try {
        const result = {
            passed: !output.includes('failing'),
            testResults: [],
            summary: {}
        };
        
        // Извлекаем суммарную информацию
        const summaryMatch = output.match(/(\d+)\s+passing\s+(?:\(([^)]+)\))?(?:\n\s+(\d+)\s+failing)?/);
        if (summaryMatch) {
            result.summary = {
                passed: parseInt(summaryMatch[1], 10),
                failed: summaryMatch[3] ? parseInt(summaryMatch[3], 10) : 0,
                total: parseInt(summaryMatch[1], 10) + (summaryMatch[3] ? parseInt(summaryMatch[3], 10) : 0)
            };
            
            if (summaryMatch[2]) {
                result.summary.time = summaryMatch[2];
            }
        }
        
        // Извлекаем успешные тесты
        const passingTests = [];
        const passingRegex = /✓\s+([^\n]+)/g;
        let passingMatch;
        
        while ((passingMatch = passingRegex.exec(output)) !== null) {
            passingTests.push({
                name: passingMatch[1].trim(),
                passed: true
            });
        }
        
        // Извлекаем неудачные тесты
        const failingTests = [];
        const failingRegex = /✖\s+([^\n]+)/g;
        let failingMatch;
        
        while ((failingMatch = failingRegex.exec(output)) !== null) {
            failingTests.push({
                name: failingMatch[1].trim(),
                passed: false
            });
        }
        
        // Объединяем все тесты
        result.testResults = [...passingTests, ...failingTests];
        
        return result;
    } catch (error) {
        logger.warn('Failed to parse Mocha output', { error: error.message });
        return {
            passed: !output.includes('failing'),
            output
        };
    }
}

/**
 * Возвращает имя файла для кода на основе языка
 * 
 * @param {string} language - Язык программирования
 * @returns {string} - Имя файла
 */
function getCodeFilename(language) {
    const langMap = {
        'javascript': 'code.js',
        'typescript': 'code.ts',
        'python': 'code.py',
        'ruby': 'code.rb',
        'go': 'code.go',
        'java': 'Main.java',
        'csharp': 'Program.cs',
        'c': 'code.c',
        'cpp': 'code.cpp',
        'php': 'code.php',
        'rust': 'code.rs'
    };
    
    return langMap[language.toLowerCase()] || 'code.txt';
}

module.exports = {
    runCodeInSandbox,
    safelyExecuteTests
};
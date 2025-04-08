/**
 * Управление Docker-контейнерами для запуска кода в изолированной среде
 * Предоставляет интерфейс для безопасного выполнения кода в Docker
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const logger = require('../../utils/logger');

// Промисификация exec для удобства использования
const execPromise = util.promisify(exec);

// Базовые конфигурации Docker для различных языков
const DOCKER_CONFIGS = {
    'javascript': {
        image: 'node:lts-alpine',
        command: 'node {file}'
    },
    'typescript': {
        image: 'node:lts-alpine',
        command: 'npx ts-node {file}'
    },
    'python': {
        image: 'python:3.9-alpine',
        command: 'python {file}'
    },
    'python2': {
        image: 'python:2.7-alpine',
        command: 'python {file}'
    },
    'ruby': {
        image: 'ruby:alpine',
        command: 'ruby {file}'
    },
    'go': {
        image: 'golang:alpine',
        command: 'go run {file}'
    },
    'java': {
        image: 'openjdk:11-jdk-alpine',
        command: 'javac {file} && java Main'
    },
    'csharp': {
        image: 'mcr.microsoft.com/dotnet/sdk:6.0-alpine',
        command: 'dotnet run {file}'
    },
    'php': {
        image: 'php:alpine',
        command: 'php {file}'
    },
    'rust': {
        image: 'rust:alpine',
        command: 'rustc {file} -o /tmp/program && /tmp/program'
    },
    'c': {
        image: 'gcc:alpine',
        command: 'gcc {file} -o /tmp/program && /tmp/program'
    },
    'cpp': {
        image: 'gcc:alpine',
        command: 'g++ {file} -o /tmp/program && /tmp/program'
    }
};

/**
 * Получает Docker-конфигурацию для заданного языка
 * 
 * @param {string} language - Язык программирования
 * @returns {Object} - Конфигурация Docker (image, command)
 */
function getDockerConfig(language) {
    const langLower = language.toLowerCase();
    
    // Обработка альтернативных названий языков
    const langMappings = {
        'js': 'javascript',
        'ts': 'typescript',
        'py': 'python',
        'rb': 'ruby',
        'cs': 'csharp',
        'rs': 'rust',
        'node': 'javascript',
        'nodejs': 'javascript',
        'typescript': 'typescript'
    };
    
    const normalizedLang = langMappings[langLower] || langLower;
    
    if (DOCKER_CONFIGS[normalizedLang]) {
        return DOCKER_CONFIGS[normalizedLang];
    }
    
    // Если язык не поддерживается, используем универсальный образ
    logger.warn(`Language ${language} is not directly supported, using fallback`);
    return {
        image: 'alpine:latest',
        command: 'cat {file}'  // Просто покажем содержимое файла
    };
}

/**
 * Проверяет, доступен ли Docker
 * 
 * @returns {Promise<boolean>} - Доступен ли Docker
 */
async function isDockerAvailable() {
    try {
        await execPromise('docker --version');
        return true;
    } catch (error) {
        logger.warn('Docker is not available', { error: error.message });
        return false;
    }
}

/**
 * Запускает Docker-контейнер с заданными параметрами
 * 
 * @param {Object} options - Параметры запуска контейнера
 * @returns {Promise<Object>} - Результат выполнения
 */
async function runContainer(options) {
    const {
        image,
        command,
        bindMount = null,
        workdir = '/app',
        timeout = 10000,
        memoryLimit = '512M',
        cpuLimit = '1.0',
        input = '',
        env = {},
        args = [],
        removeAfter = true,
        network = 'none',  // По умолчанию отключаем сеть для безопасности
        user = 'nobody'   // По умолчанию запускаем от непривилегированного пользователя
    } = options;
    
    try {
        // Проверяем доступность Docker
        if (!await isDockerAvailable()) {
            throw new Error('Docker is not available');
        }
        
        // Генерируем уникальное имя контейнера
        const containerName = `sandbox-${crypto.randomBytes(8).toString('hex')}`;
        
        // Сохраняем input во временный файл, если он есть
        let inputFile = null;
        if (input) {
            inputFile = path.join(os.tmpdir(), `input-${containerName}.txt`);
            await fs.writeFile(inputFile, input);
        }
        
        // Формируем базовую команду Docker
        let dockerCmd = [
            'docker', 'run',
            '--name', containerName,
            '--rm', // Автоматически удаляем контейнер после выполнения
            '--network', network,
            '-u', user,
            '-w', workdir,
            '-m', memoryLimit,
            '--cpus', cpuLimit,
            '--read-only' // Запрещаем запись в файловую систему (кроме явно указанных томов)
        ];
        
        // Если нужен монтирование, добавляем его
        if (bindMount) {
            dockerCmd.push('-v', `${bindMount.source}:${bindMount.target}`);
        }
        
        // Добавляем переменные окружения
        for (const [key, value] of Object.entries(env)) {
            dockerCmd.push('-e', `${key}=${value}`);
        }
        
        // Добавляем дополнительные временные директории с правами записи
        dockerCmd.push('-v', '/tmp:/tmp:rw');
        
        // Добавляем образ и команду
        dockerCmd.push(image);
        
        // Преобразуем команду в массив аргументов, если это строка
        const commandArgs = typeof command === 'string'
            ? command.split(' ')
            : command;
            
        dockerCmd = dockerCmd.concat(commandArgs);
        
        // Добавляем аргументы к команде
        if (args && args.length > 0) {
            dockerCmd = dockerCmd.concat(args);
        }
        
        logger.debug('Running Docker container', { 
            containerName, 
            commandLine: dockerCmd.join(' ') 
        });
        
        return await runDockerWithTimeout(dockerCmd, { 
            timeout, 
            input: inputFile,
            removeAfter,
            containerName
        });
    } catch (error) {
        logger.error('Error running Docker container', { error: error.message });
        return {
            success: false,
            stdout: '',
            stderr: error.message,
            exitCode: 1
        };
    }
}

/**
 * Запускает Docker-команду с таймаутом
 * 
 * @param {Array} dockerCmd - Команда Docker в виде массива аргументов
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат выполнения
 */
async function runDockerWithTimeout(dockerCmd, options) {
    const { 
        timeout, 
        input = null,
        removeAfter = true,
        containerName
    } = options;
    
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let killed = false;
        
        // Запускаем процесс
        const dockerProcess = spawn(dockerCmd[0], dockerCmd.slice(1));
        
        // Если есть входные данные, подаем их на stdin
        if (input) {
            try {
                const inputStream = fs.createReadStream(input);
                inputStream.pipe(dockerProcess.stdin);
            } catch (error) {
                logger.error('Error piping input to container', { error: error.message });
            }
        }
        
        // Обрабатываем stdout
        dockerProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        // Обрабатываем stderr
        dockerProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        // Обрабатываем завершение процесса
        dockerProcess.on('close', async (code) => {
            // Очищаем таймаут
            clearTimeout(timeoutId);
            
            // Очищаем временный файл с input, если он был создан
            if (input) {
                try {
                    await fs.unlink(input);
                } catch (error) {
                    logger.warn('Failed to remove input file', { 
                        file: input, 
                        error: error.message 
                    });
                }
            }
            
            // Если контейнер еще существует и нужно его удалить
            if (removeAfter && !killed) {
                try {
                    await execPromise(`docker rm -f ${containerName}`);
                } catch (rmError) {
                    // Игнорируем ошибки удаления, контейнер мог уже не существовать
                }
            }
            
            // Возвращаем результат
            resolve({
                success: code === 0 && !killed,
                stdout,
                stderr,
                exitCode: killed ? 1 : code,
                timedOut: killed
            });
        });
        
        // Обрабатываем ошибки процесса
        dockerProcess.on('error', (error) => {
            clearTimeout(timeoutId);
            
            // Пытаемся удалить контейнер при ошибке
            if (removeAfter) {
                try {
                    execPromise(`docker rm -f ${containerName}`);
                } catch (rmError) {
                    // Игнорируем ошибки удаления
                }
            }
            
            reject(error);
        });
        
        // Устанавливаем таймаут
        const timeoutId = setTimeout(async () => {
            killed = true;
            
            // Останавливаем контейнер
            try {
                await execPromise(`docker stop -t 1 ${containerName}`);
                
                // Удаляем контейнер, если нужно
                if (removeAfter) {
                    await execPromise(`docker rm -f ${containerName}`);
                }
            } catch (error) {
                logger.warn('Error stopping container after timeout', { 
                    containerName, 
                    error: error.message 
                });
            }
            
            // Убиваем процесс
            dockerProcess.kill('SIGKILL');
            
            stderr += '\nExecution timed out after ' + (timeout / 1000) + ' seconds';
        }, timeout);
    });
}

/**
 * Создает временный Docker-образ с установленными зависимостями
 * 
 * @param {string} baseImage - Базовый образ
 * @param {Object} requirements - Требования (зависимости, файлы и т.д.)
 * @returns {Promise<string>} - Имя созданного образа
 */
async function setupDockerImage(baseImage, requirements) {
    try {
        const {
            packages = [],
            nodeModules = [],
            pythonPackages = [],
            gemPackages = [],
            files = {},
            commands = []
        } = requirements;
        
        // Генерируем уникальное имя образа
        const imageName = `sandbox-img-${crypto.randomBytes(6).toString('hex')}`;
        
        // Создаем временную директорию для Dockerfile
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-build-'));
        const dockerfilePath = path.join(tmpDir, 'Dockerfile');
        
        // Формируем содержимое Dockerfile
        let dockerfileContent = `FROM ${baseImage}\n\n`;
        
        // Добавляем установку системных пакетов
        if (packages.length > 0) {
            if (baseImage.includes('alpine')) {
                dockerfileContent += `RUN apk add --no-cache ${packages.join(' ')}\n\n`;
            } else if (baseImage.includes('debian') || baseImage.includes('ubuntu')) {
                dockerfileContent += 'RUN apt-get update && \\\n';
                dockerfileContent += `    apt-get install -y ${packages.join(' ')} && \\\n`;
                dockerfileContent += '    apt-get clean && rm -rf /var/lib/apt/lists/*\n\n';
            }
        }
        
        // Добавляем установку Node.js пакетов
        if (nodeModules.length > 0) {
            if (baseImage.includes('node')) {
                dockerfileContent += `RUN npm install -g ${nodeModules.join(' ')}\n\n`;
            } else {
                logger.warn('Node.js packages requested but base image is not Node.js', { baseImage });
            }
        }
        
        // Добавляем установку Python пакетов
        if (pythonPackages.length > 0) {
            if (baseImage.includes('python')) {
                dockerfileContent += `RUN pip install ${pythonPackages.join(' ')}\n\n`;
            } else {
                logger.warn('Python packages requested but base image is not Python', { baseImage });
            }
        }
        
        // Добавляем установку Ruby gems
        if (gemPackages.length > 0) {
            if (baseImage.includes('ruby')) {
                dockerfileContent += `RUN gem install ${gemPackages.join(' ')}\n\n`;
            } else {
                logger.warn('Ruby gems requested but base image is not Ruby', { baseImage });
            }
        }
        
        // Создаем рабочую директорию
        dockerfileContent += 'WORKDIR /app\n\n';
        
        // Добавляем файлы
        for (const [filePath, content] of Object.entries(files)) {
            const targetPath = path.join(tmpDir, path.basename(filePath));
            await fs.writeFile(targetPath, content);
            
            dockerfileContent += `COPY ${path.basename(filePath)} /app/${filePath}\n`;
        }
        
        if (Object.keys(files).length > 0) {
            dockerfileContent += '\n';
        }
        
        // Добавляем пользовательские команды
        for (const cmd of commands) {
            dockerfileContent += `RUN ${cmd}\n`;
        }
        
        if (commands.length > 0) {
            dockerfileContent += '\n';
        }
        
        // Добавляем настройки безопасности
        dockerfileContent += 'USER nobody\n\n';
        
        // Записываем Dockerfile
        await fs.writeFile(dockerfilePath, dockerfileContent);
        
        // Собираем образ
        logger.debug('Building Docker image', { imageName, dockerfilePath });
        
        const { stdout, stderr } = await execPromise(`docker build -t ${imageName} ${tmpDir}`);
        
        logger.debug('Docker image built successfully', { 
            imageName, 
            buildOutput: stdout.slice(0, 500) // Ограничиваем вывод для лога
        });
        
        // Очищаем временную директорию
        await fs.rm(tmpDir, { recursive: true, force: true });
        
        return imageName;
    } catch (error) {
        logger.error('Error setting up Docker image', { error: error.message });
        throw error;
    }
}

/**
 * Проверяет и очищает старые временные образы и контейнеры
 * 
 * @param {number} olderThanHours - Удалять объекты старше указанного количества часов
 * @returns {Promise<void>}
 */
async function cleanupOldResources(olderThanHours = 24) {
    try {
        // Проверяем, доступен ли Docker
        if (!await isDockerAvailable()) {
            return;
        }
        
        // Получаем список контейнеров с нашим префиксом
        const containerCmd = 'docker ps -a --filter "name=sandbox-" --format "{{.Names}}"';
        const { stdout: containerList } = await execPromise(containerCmd);
        
        if (containerList.trim()) {
            // Останавливаем и удаляем все контейнеры с нашим префиксом
            logger.info('Cleaning up sandbox containers');
            await execPromise('docker rm -f $(docker ps -a --filter "name=sandbox-" -q)');
        }
        
        // Получаем список образов с нашим префиксом
        const imageCmd = 'docker images --filter "reference=sandbox-img-*" --format "{{.Repository}}"';
        const { stdout: imageList } = await execPromise(imageCmd);
        
        if (imageList.trim()) {
            // Удаляем все образы с нашим префиксом
            logger.info('Cleaning up sandbox images');
            await execPromise('docker rmi $(docker images --filter "reference=sandbox-img-*" -q)');
        }
        
        logger.info('Cleanup completed successfully');
    } catch (error) {
        logger.warn('Error during Docker resources cleanup', { error: error.message });
    }
}

module.exports = {
    getDockerConfig,
    runContainer,
    setupDockerImage,
    isDockerAvailable,
    cleanupOldResources
};
/**
 * База знаний о технологиях
 * Отвечает за хранение и получение информации о различных технологиях,
 * а также за извлечение технологий из контекста проекта
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

// Внутренняя база данных технологий (может быть расширена и вынесена в JSON/БД)
const TECH_CATEGORIES = {
    FRONTEND: 'frontend',
    BACKEND: 'backend',
    DATABASE: 'database',
    TESTING: 'testing',
    DEVOPS: 'devops',
    MOBILE: 'mobile',
    DESKTOP: 'desktop',
    AI_ML: 'ai_ml',
    SECURITY: 'security',
    OTHER: 'other'
};

/**
 * Основная база данных технологий с метаданными
 * @type {Object}
 */
const techDatabase = {
    // Frontend технологии
    'react': {
        name: 'React',
        category: TECH_CATEGORIES.FRONTEND,
        description: 'Библиотека JavaScript для построения пользовательских интерфейсов',
        usage: 'Создание интерактивных UI компонентов и SPA',
        ecosystem: ['react-router', 'redux', 'next.js', 'chakra-ui', 'material-ui'],
        alternatives: ['vue', 'angular', 'svelte'],
        maturity: 'Высокая',
        learning_curve: 'Средняя',
        community_support: 'Сильная',
        trend_rating: 5
    },
    'vue': {
        name: 'Vue.js',
        category: TECH_CATEGORIES.FRONTEND,
        description: 'Прогрессивный JavaScript-фреймворк для создания UI',
        usage: 'Создание SPA, интерактивных компонентов',
        ecosystem: ['vue-router', 'vuex', 'nuxt.js', 'vuetify'],
        alternatives: ['react', 'angular', 'svelte'],
        maturity: 'Высокая',
        learning_curve: 'Низкая к средней',
        community_support: 'Сильная',
        trend_rating: 4
    },
    // Backend технологии
    'express': {
        name: 'Express.js',
        category: TECH_CATEGORIES.BACKEND,
        description: 'Минималистичный веб-фреймворк для Node.js',
        usage: 'Создание REST API, веб-приложений',
        ecosystem: ['passport', 'morgan', 'mongoose', 'sequelize'],
        alternatives: ['koa', 'fastify', 'nest.js', 'hapi'],
        maturity: 'Высокая',
        learning_curve: 'Низкая',
        community_support: 'Сильная',
        trend_rating: 5
    },
    'nest': {
        name: 'NestJS',
        category: TECH_CATEGORIES.BACKEND,
        description: 'Прогрессивный Node.js фреймворк для создания эффективных серверных приложений',
        usage: 'Создание масштабируемых API, микросервисов',
        ecosystem: ['typeorm', '@nestjs/graphql', '@nestjs/swagger'],
        alternatives: ['express', 'koa', 'fastify'],
        maturity: 'Высокая',
        learning_curve: 'Средняя',
        community_support: 'Сильная и растущая',
        trend_rating: 4.5
    },
    // Database технологии
    'sequelize': {
        name: 'Sequelize',
        category: TECH_CATEGORIES.DATABASE,
        description: 'ORM для Node.js с поддержкой различных SQL диалектов',
        usage: 'Работа с реляционными БД (MySQL, PostgreSQL, SQLite)',
        ecosystem: ['sequelize-cli', 'sequelize-typescript'],
        alternatives: ['typeorm', 'prisma', 'knex'],
        maturity: 'Высокая',
        learning_curve: 'Средняя',
        community_support: 'Сильная',
        trend_rating: 4
    },
    'mongoose': {
        name: 'Mongoose',
        category: TECH_CATEGORIES.DATABASE,
        description: 'MongoDB object modeling для Node.js',
        usage: 'Работа с MongoDB, определение схем, валидация',
        ecosystem: [],
        alternatives: ['mongodb native driver', 'typegoose'],
        maturity: 'Высокая',
        learning_curve: 'Низкая к средней',
        community_support: 'Сильная',
        trend_rating: 4
    },
    // Тестирование
    'jest': {
        name: 'Jest',
        category: TECH_CATEGORIES.TESTING,
        description: 'JavaScript Testing Framework с акцентом на простоту',
        usage: 'Модульное тестирование, снэпшот-тестирование, охват кода',
        ecosystem: ['ts-jest', 'jest-dom'],
        alternatives: ['mocha', 'jasmine', 'ava'],
        maturity: 'Высокая',
        learning_curve: 'Низкая',
        community_support: 'Сильная',
        trend_rating: 5
    },
    // ... и так далее, база может расширяться
};

/**
 * Извлекает существующие технологии из контекста проекта
 * 
 * @param {Object} projectContext - Контекст проекта (файлы, структура, зависимости)
 * @returns {Promise<Array>} - Массив технологий с дополнительными метаданными
 */
async function extractExistingTechnologies(projectContext) {
    try {
        const technologies = [];
        
        // Извлечение зависимостей из package.json, если доступно
        if (projectContext.packageJson) {
            await extractFromPackageJson(projectContext.packageJson, technologies);
        } else if (projectContext.projectRoot) {
            // Попытка найти package.json в корне проекта
            try {
                const packageJsonPath = path.join(projectContext.projectRoot, 'package.json');
                const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
                const packageJson = JSON.parse(packageJsonContent);
                await extractFromPackageJson(packageJson, technologies);
            } catch (err) {
                logger.debug('Unable to read package.json', { error: err.message });
            }
        }
        
        // Извлечение технологий из файлов проекта (если есть анализ файлов)
        if (projectContext.projectFiles) {
            await extractFromProjectFiles(projectContext.projectFiles, technologies);
        }
        
        // Извлечение из существующей схемы БД (если есть)
        if (projectContext.dbSchema) {
            await extractFromDbSchema(projectContext.dbSchema, technologies);
        }
        
        // Обогащаем найденные технологии метаданными из нашей базы
        return enrichTechnologies(technologies);
    } catch (error) {
        logger.error('Error extracting existing technologies', { error: error.message });
        return [];
    }
}

/**
 * Извлекает технологии из package.json
 * 
 * @param {Object} packageJson - Содержимое package.json
 * @param {Array} technologies - Массив для добавления найденных технологий
 */
async function extractFromPackageJson(packageJson, technologies) {
    const dependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {})
    };
    
    for (const [dep, version] of Object.entries(dependencies)) {
        // Очищаем имя от scope и версии
        const cleanName = dep.replace(/^@[^/]+\//, '');
        
        technologies.push({
            name: cleanName,
            version: version.replace(/[^0-9.]/g, ''),
            source: 'package.json',
            isDev: packageJson.devDependencies && packageJson.devDependencies[dep] !== undefined
        });
    }
}

/**
 * Извлекает технологии из файлов проекта
 * 
 * @param {Array} projectFiles - Массив файлов проекта с метаданными
 * @param {Array} technologies - Массив для добавления найденных технологий
 */
async function extractFromProjectFiles(projectFiles, technologies) {
    // Определяем технологии по расширениям и содержимому файлов
    const extensionMap = {
        '.jsx': 'react',
        '.tsx': ['react', 'typescript'],
        '.vue': 'vue',
        '.ts': 'typescript',
        '.scss': 'sass',
        '.py': 'python',
        '.go': 'golang',
        '.rb': 'ruby',
        '.php': 'php',
        '.java': 'java',
        '.kt': 'kotlin',
        // ... другие расширения
    };
    
    // Счетчик для определения преобладающих технологий
    const techCounter = {};
    
    for (const file of projectFiles) {
        const ext = path.extname(file.path);
        
        if (extensionMap[ext]) {
            const techs = Array.isArray(extensionMap[ext])
                ? extensionMap[ext]
                : [extensionMap[ext]];
                
            for (const tech of techs) {
                techCounter[tech] = (techCounter[tech] || 0) + 1;
            }
        }
        
        // Можно также проверять содержимое файлов,
        // например, искать import/require паттерны
    }
    
    // Добавляем только значимые технологии (более 3 файлов)
    for (const [tech, count] of Object.entries(techCounter)) {
        if (count >= 3) {
            technologies.push({
                name: tech,
                source: 'file_analysis',
                prevalence: count
            });
        }
    }
}

/**
 * Извлекает технологии из схемы БД
 * 
 * @param {Object|string} dbSchema - Схема БД или строка описания
 * @param {Array} technologies - Массив для добавления найденных технологий
 */
async function extractFromDbSchema(dbSchema, technologies) {
    if (typeof dbSchema === 'string') {
        // Пытаемся определить тип БД из строки
        if (dbSchema.includes('CREATE TABLE') || dbSchema.includes('INTEGER') || 
            dbSchema.includes('VARCHAR')) {
            technologies.push({
                name: 'sql',
                source: 'db_schema'
            });
            
            // Пытаемся определить конкретный диалект
            if (dbSchema.includes('AUTOINCREMENT')) {
                technologies.push({
                    name: 'sqlite',
                    source: 'db_schema'
                });
            } else if (dbSchema.includes('AUTO_INCREMENT')) {
                technologies.push({
                    name: 'mysql',
                    source: 'db_schema'
                });
            }
        } else if (dbSchema.includes('ObjectId') || dbSchema.includes('document')) {
            technologies.push({
                name: 'mongodb',
                source: 'db_schema'
            });
        }
    } else if (typeof dbSchema === 'object') {
        // Ищем характерные признаки в структуре объекта
        if (dbSchema.type && dbSchema.type === 'mongodb') {
            technologies.push({
                name: 'mongodb',
                source: 'db_schema'
            });
        } else if (dbSchema.dialect) {
            technologies.push({
                name: dbSchema.dialect.toLowerCase(),
                source: 'db_schema'
            });
        }
    }
}

/**
 * Дополняет список технологий метаданными из базы данных
 * 
 * @param {Array} technologies - Массив найденных технологий
 * @returns {Array} - Массив технологий с метаданными
 */
function enrichTechnologies(technologies) {
    return technologies.map(tech => {
        const dbEntry = techDatabase[tech.name.toLowerCase()];
        
        if (dbEntry) {
            return {
                ...tech,
                info: {
                    category: dbEntry.category,
                    description: dbEntry.description,
                    alternatives: dbEntry.alternatives,
                    ecosystem: dbEntry.ecosystem,
                    maturity: dbEntry.maturity
                }
            };
        }
        
        return tech;
    });
}

/**
 * Получает данные о технологии из базы знаний
 * 
 * @param {string} techName - Название технологии
 * @returns {Object|null} - Информация о технологии или null, если не найдена
 */
function getTechInfo(techName) {
    if (!techName) return null;
    
    const normalizedName = techName.toLowerCase().trim();
    return techDatabase[normalizedName] || null;
}

/**
 * Получает рекомендуемые технологии по категории
 * 
 * @param {string} category - Категория технологий
 * @param {Object} options - Дополнительные параметры (например, учитывать тренды)
 * @returns {Array} - Массив рекомендуемых технологий
 */
function getRecommendedByCategory(category, options = {}) {
    const result = [];
    
    for (const [key, tech] of Object.entries(techDatabase)) {
        if (tech.category === category) {
            result.push({
                key,
                ...tech
            });
        }
    }
    
    // Сортировка по рейтингу трендов, если запрошено
    if (options.sortByTrend) {
        result.sort((a, b) => (b.trend_rating || 0) - (a.trend_rating || 0));
    }
    
    return result;
}

module.exports = {
    extractExistingTechnologies,
    getTechInfo,
    getRecommendedByCategory,
    TECH_CATEGORIES
};
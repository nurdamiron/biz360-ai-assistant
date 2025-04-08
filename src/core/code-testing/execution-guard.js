/**
 * Защита от вредоносного кода
 * Анализирует код перед выполнением на предмет потенциально опасных конструкций
 */

const logger = require('../../utils/logger');
const acorn = require('acorn'); // Потребуется установка: npm install acorn
const estraverse = require('estraverse'); // Потребуется установка: npm install estraverse
const ast = require('ast-types'); // Потребуется установка: npm install ast-types

// Паттерны для поиска потенциально опасных конструкций
const DANGEROUS_PATTERNS = {
    javascript: {
        // Системные вызовы и доступ к ФС
        systemCalls: [
            'require\\([\'"]child_process[\'"]\\)',
            'require\\([\'"]fs[\'"]\\)',
            'spawn\\(',
            'exec\\(',
            'execSync\\(',
            'spawnSync\\(',
            'readFileSync\\(',
            'writeFileSync\\(',
            'fs\\.',
            'process\\.binding',
            'child_process',
            'Worker\\('
        ],
        // Сетевые запросы
        network: [
            'require\\([\'"]http[\'"]\\)',
            'require\\([\'"]https[\'"]\\)',
            'require\\([\'"]net[\'"]\\)',
            'require\\([\'"]dgram[\'"]\\)',
            'fetch\\(',
            'XMLHttpRequest',
            'WebSocket',
            'Socket\\(',
            '\\.connect\\('
        ],
        // Доступ к системной информации
        systemInfo: [
            'process\\.env',
            'process\\.argv',
            'os\\.',
            'require\\([\'"]os[\'"]\\)'
        ],
        // Выполнение произвольного кода
        codeExecution: [
            'eval\\(',
            'Function\\(',
            'new Function',
            'setTimeout\\([\'"`]',
            'setInterval\\([\'"`]'
        ]
    },
    python: {
        // Системные вызовы и доступ к ФС
        systemCalls: [
            'import\\s+os',
            'import\\s+subprocess',
            'import\\s+sys',
            'from\\s+os\\s+import',
            'from\\s+subprocess\\s+import',
            'from\\s+sys\\s+import',
            'os\\.',
            'subprocess\\.',
            'sys\\.',
            'open\\(',
            'exec\\(',
            'eval\\(',
            '__import__\\('
        ],
        // Сетевые запросы
        network: [
            'import\\s+socket',
            'import\\s+urllib',
            'import\\s+requests',
            'import\\s+http',
            'from\\s+socket\\s+import',
            'from\\s+urllib\\s+import',
            'from\\s+requests\\s+import',
            'from\\s+http\\s+import',
            'socket\\.',
            'urllib\\.',
            'requests\\.'
        ],
        // Доступ к системной информации
        systemInfo: [
            'os\\.environ',
            'sys\\.argv',
            'platform\\.',
            'import\\s+platform'
        ],
        // Выполнение произвольного кода
        codeExecution: [
            'eval\\(',
            'exec\\(',
            'compile\\(',
            'execfile\\(',
            '__import__\\('
        ]
    }
    // Можно добавить паттерны для других языков (Java, C#, Ruby и т.д.)
};

/**
 * Проверяет код на наличие потенциально опасных конструкций
 * 
 * @param {string} code - Код для проверки
 * @param {string} language - Язык программирования
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Результат проверки
 */
async function checkCodeSecurity(code, language, options = {}) {
    try {
        const { 
            securityLevel = 'high',  // high, medium, low
            allowSystemCalls = false,
            allowNetworkAccess = false,
            allowSystemInfo = false,
            allowCodeExecution = false
        } = options;
        
        logger.debug('Checking code security', { language, securityLevel });
        
        // Устанавливаем разрешения в зависимости от уровня безопасности
        const permissions = {
            systemCalls: allowSystemCalls || securityLevel === 'low',
            networkAccess: allowNetworkAccess || securityLevel === 'low',
            systemInfo: allowSystemInfo || securityLevel === 'low' || securityLevel === 'medium',
            codeExecution: allowCodeExecution || securityLevel === 'low'
        };
        
        // Выбираем паттерны для заданного языка
        const patterns = DANGEROUS_PATTERNS[language.toLowerCase()];
        
        if (!patterns) {
            logger.warn(`No security patterns defined for language: ${language}`);
            return { safe: true };
        }
        
        // Выполняем различные проверки в зависимости от языка
        if (language.toLowerCase() === 'javascript') {
            return checkJavaScriptSecurity(code, patterns, permissions);
        } else {
            // Для других языков используем регулярные выражения
            return checkWithRegex(code, patterns, permissions);
        }
    } catch (error) {
        logger.error('Error checking code security', { error: error.message });
        
        // В случае ошибки при анализе, считаем код небезопасным
        return {
            safe: false,
            reason: `Ошибка при анализе безопасности: ${error.message}`
        };
    }
}

/**
 * Проверяет безопасность JavaScript-кода с помощью AST
 * 
 * @param {string} code - Код для проверки
 * @param {Object} patterns - Паттерны опасных конструкций
 * @param {Object} permissions - Разрешения
 * @returns {Object} - Результат проверки
 */
function checkJavaScriptSecurity(code, patterns, permissions) {
    try {
        // Сначала проверяем с помощью регулярных выражений для быстрой проверки
        const regexResult = checkWithRegex(code, patterns, permissions);
        
        if (!regexResult.safe) {
            return regexResult;
        }
        
        // Если регулярные выражения не нашли проблем, делаем более глубокую проверку с AST
        // Парсим код в AST
        const ast = acorn.parse(code, { 
            ecmaVersion: 2020,
            sourceType: 'module'
        });
        
        // Результат глубокой проверки
        let astCheckResult = { safe: true };
        
        // Проходим по AST и ищем потенциально опасные конструкции
        estraverse.traverse(ast, {
            enter: function(node, parent) {
                // Проверяем вызовы require()
                if (isRequireCall(node) && !astCheckResult.safe) {
                    const moduleName = getRequireModuleName(node);
                    
                    if (moduleName) {
                        // Проверяем системные модули
                        if (!permissions.systemCalls && isSystemModule(moduleName)) {
                            astCheckResult = {
                                safe: false,
                                reason: `Обнаружено использование системного модуля: ${moduleName}`
                            };
                            return estraverse.VisitorOption.Break;
                        }
                        
                        // Проверяем сетевые модули
                        if (!permissions.networkAccess && isNetworkModule(moduleName)) {
                            astCheckResult = {
                                safe: false,
                                reason: `Обнаружено использование сетевого модуля: ${moduleName}`
                            };
                            return estraverse.VisitorOption.Break;
                        }
                    }
                }
                
                // Проверяем вызовы опасных функций
                if (isFunctionCall(node) && !permissions.codeExecution) {
                    const funcName = getFunctionName(node);
                    
                    if (isDangerousFunction(funcName)) {
                        astCheckResult = {
                            safe: false,
                            reason: `Обнаружен вызов потенциально опасной функции: ${funcName}`
                        };
                        return estraverse.VisitorOption.Break;
                    }
                }
                
                // Проверяем доступ к опасным свойствам
                if (isMemberExpression(node) && !permissions.systemInfo) {
                    const memberPath = getMemberPath(node);
                    
                    if (isDangerousMember(memberPath)) {
                        astCheckResult = {
                            safe: false,
                            reason: `Обнаружен доступ к системной информации: ${memberPath}`
                        };
                        return estraverse.VisitorOption.Break;
                    }
                }
            }
        });
        
        return astCheckResult;
    } catch (error) {
        logger.warn('Error during AST-based security check', { error: error.message });
        
        // В случае ошибки при AST-анализе, возвращаем результат регулярных выражений
        return checkWithRegex(code, patterns, permissions);
    }
}

/**
 * Проверяет код с помощью регулярных выражений
 * 
 * @param {string} code - Код для проверки
 * @param {Object} patterns - Паттерны опасных конструкций
 * @param {Object} permissions - Разрешения
 * @returns {Object} - Результат проверки
 */
function checkWithRegex(code, patterns, permissions) {
    // Проверяем на системные вызовы
    if (!permissions.systemCalls && patterns.systemCalls) {
        for (const pattern of patterns.systemCalls) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(code)) {
                return {
                    safe: false,
                    reason: `Обнаружен потенциально опасный системный вызов: ${pattern}`
                };
            }
        }
    }
    
    // Проверяем на сетевые запросы
    if (!permissions.networkAccess && patterns.network) {
        for (const pattern of patterns.network) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(code)) {
                return {
                    safe: false,
                    reason: `Обнаружен потенциально опасный сетевой запрос: ${pattern}`
                };
            }
        }
    }
    
    // Проверяем на доступ к системной информации
    if (!permissions.systemInfo && patterns.systemInfo) {
        for (const pattern of patterns.systemInfo) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(code)) {
                return {
                    safe: false,
                    reason: `Обнаружен доступ к системной информации: ${pattern}`
                };
            }
        }
    }
    
    // Проверяем на выполнение произвольного кода
    if (!permissions.codeExecution && patterns.codeExecution) {
        for (const pattern of patterns.codeExecution) {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(code)) {
                return {
                    safe: false,
                    reason: `Обнаружено выполнение произвольного кода: ${pattern}`
                };
            }
        }
    }
    
    // Если все проверки пройдены, код считается безопасным
    return { safe: true };
}

/**
 * Проверяет, является ли узел вызовом require()
 * 
 * @param {Object} node - Узел AST
 * @returns {boolean} - true, если узел - вызов require()
 */
function isRequireCall(node) {
    return node.type === 'CallExpression' &&
           node.callee.type === 'Identifier' &&
           node.callee.name === 'require';
}

/**
 * Получает имя модуля из вызова require()
 * 
 * @param {Object} node - Узел AST (вызов require)
 * @returns {string|null} - Имя модуля или null
 */
function getRequireModuleName(node) {
    if (node.arguments.length > 0 && 
        node.arguments[0].type === 'Literal' && 
        typeof node.arguments[0].value === 'string') {
        return node.arguments[0].value;
    }
    return null;
}

/**
 * Проверяет, является ли модуль системным
 * 
 * @param {string} moduleName - Имя модуля
 * @returns {boolean} - true, если модуль системный
 */
function isSystemModule(moduleName) {
    const systemModules = [
        'fs', 'child_process', 'cluster', 'os', 'path', 
        'process', 'stream', 'worker_threads', 'vm'
    ];
    return systemModules.includes(moduleName);
}

/**
 * Проверяет, является ли модуль сетевым
 * 
 * @param {string} moduleName - Имя модуля
 * @returns {boolean} - true, если модуль сетевой
 */
function isNetworkModule(moduleName) {
    const networkModules = [
        'http', 'https', 'net', 'dgram', 'dns', 'tls', 'url'
    ];
    return networkModules.includes(moduleName);
}

/**
 * Проверяет, является ли узел вызовом функции
 * 
 * @param {Object} node - Узел AST
 * @returns {boolean} - true, если узел - вызов функции
 */
function isFunctionCall(node) {
    return node.type === 'CallExpression';
}

/**
 * Получает имя функции из вызова
 * 
 * @param {Object} node - Узел AST (вызов функции)
 * @returns {string} - Имя функции или пустая строка
 */
function getFunctionName(node) {
    if (node.callee.type === 'Identifier') {
        return node.callee.name;
    } else if (node.callee.type === 'MemberExpression') {
        if (node.callee.property.type === 'Identifier') {
            return node.callee.property.name;
        }
    }
    return '';
}

/**
 * Проверяет, является ли функция потенциально опасной
 * 
 * @param {string} funcName - Имя функции
 * @returns {boolean} - true, если функция потенциально опасна
 */
function isDangerousFunction(funcName) {
    const dangerousFunctions = [
        'eval', 'Function', 'exec', 'spawn', 'execSync', 'spawnSync',
        'fork', 'execFile', 'execFileSync', 'load', 'compile'
    ];
    return dangerousFunctions.includes(funcName);
}

/**
 * Проверяет, является ли узел обращением к свойству объекта
 * 
 * @param {Object} node - Узел AST
 * @returns {boolean} - true, если узел - обращение к свойству
 */
function isMemberExpression(node) {
    return node.type === 'MemberExpression';
}

/**
 * Получает путь к свойству объекта
 * 
 * @param {Object} node - Узел AST (MemberExpression)
 * @returns {string} - Путь к свойству (например, "process.env")
 */
function getMemberPath(node) {
    if (node.object.type === 'Identifier') {
        return node.object.name + '.' + (node.property.name || node.property.value);
    } else if (node.object.type === 'MemberExpression') {
        return getMemberPath(node.object) + '.' + (node.property.name || node.property.value);
    }
    return '';
}

/**
 * Проверяет, является ли путь к свойству потенциально опасным
 * 
 * @param {string} memberPath - Путь к свойству
 * @returns {boolean} - true, если путь потенциально опасен
 */
function isDangerousMember(memberPath) {
    const dangerousMembers = [
        'process.env', 'process.argv', 'global', 'window', 
        'os.', 'fs.', 'child_process.'
    ];
    
    for (const dangerous of dangerousMembers) {
        if (memberPath.startsWith(dangerous)) {
            return true;
        }
    }
    
    return false;
}

module.exports = {
    checkCodeSecurity
};
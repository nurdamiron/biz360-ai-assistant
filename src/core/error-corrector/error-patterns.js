/**
 * Шаблоны распространенных ошибок и их исправлений
 * Предоставляет правила для автоматического определения и исправления частых ошибок в коде
 */

const logger = require('../../utils/logger');

/**
 * Шаблоны ошибок для JavaScript
 */
const JAVASCRIPT_PATTERNS = [
    {
        name: 'js_missing_semicolon',
        type: 'syntax_error',
        description: 'Отсутствует точка с запятой',
        detectRegex: /SyntaxError: (unexpected token|.*expected.*)/i,
        confidence: 0.6,
        detect: function(code, errorMessage) {
            // Проверяем на ошибки, которые могут быть вызваны отсутствием точки с запятой
            if (!errorMessage || !errorMessage.match(/SyntaxError: (unexpected token|.*expected.*)/i)) {
                return false;
            }
            
            // Ищем строки, которые могут нуждаться в точке с запятой
            const lines = code.split('\n');
            const problematicLines = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Пропускаем пустые строки, комментарии и строки, которые уже заканчиваются на ;
                if (!line || line.startsWith('//') || line.endsWith(';') || line.endsWith('{') || line.endsWith('}')) {
                    continue;
                }
                
                // Ищем строки, которые могут нуждаться в ;
                if (line.match(/^(let|const|var|return|throw|break|continue|do|for|if|switch|try|function|class)/)) {
                    problematicLines.push({ index: i, line });
                }
            }
            
            return problematicLines.length > 0 ? problematicLines : false;
        },
        fix: function(code, errorMessage) {
            const problematicLines = this.detect(code, errorMessage);
            
            if (!problematicLines || problematicLines.length === 0) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку синтаксиса',
                    explanation: 'Проверьте отсутствующие точки с запятой и правильность синтаксиса вручную'
                };
            }
            
            // Добавляем точку с запятой к проблемным строкам
            const lines = code.split('\n');
            const changes = [];
            
            for (const { index, line } of problematicLines) {
                if (!lines[index].trim().endsWith(';')) {
                    lines[index] = lines[index].replace(/\s*$/, ';');
                    changes.push(`Добавлена точка с запятой в строке ${index + 1}: ${line}`);
                }
            }
            
            return {
                fixedCode: lines.join('\n'),
                description: 'Добавлены отсутствующие точки с запятой',
                explanation: 'В JavaScript многие выражения должны заканчиваться точкой с запятой',
                changes
            };
        }
    },
    {
        name: 'js_undefined_variable',
        type: 'reference_error',
        description: 'Использование необъявленной переменной',
        detectRegex: /ReferenceError: (\w+) is not defined/i,
        confidence: 0.8,
        detect: function(code, errorMessage) {
            // Извлекаем имя переменной из сообщения об ошибке
            const match = errorMessage && errorMessage.match(/ReferenceError: (\w+) is not defined/i);
            if (!match) return false;
            
            const varName = match[1];
            return varName ? { varName } : false;
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку неопределенной переменной',
                    explanation: 'Проверьте правильность имени переменной и убедитесь, что она объявлена перед использованием'
                };
            }
            
            const { varName } = result;
            
            // Проверяем, есть ли похожие переменные (возможные опечатки)
            const varRegex = /\b(let|const|var)\s+(\w+)\b/g;
            const declaredVars = [];
            
            let match;
            while ((match = varRegex.exec(code)) !== null) {
                declaredVars.push(match[2]);
            }
            
            // Ищем наиболее похожую переменную
            let mostSimilar = null;
            let bestSimilarity = 0;
            
            for (const declaredVar of declaredVars) {
                const similarity = stringSimilarity(varName, declaredVar);
                if (similarity > bestSimilarity && similarity > 0.6) {
                    bestSimilarity = similarity;
                    mostSimilar = declaredVar;
                }
            }
            
            if (mostSimilar) {
                // Заменяем все вхождения неопределенной переменной на наиболее похожую
                const regex = new RegExp(`\\b${varName}\\b`, 'g');
                const fixedCode = code.replace(regex, mostSimilar);
                
                return {
                    fixedCode,
                    description: `Заменена неопределенная переменная '${varName}' на '${mostSimilar}'`,
                    explanation: `Переменная '${varName}' не была объявлена, но найдена похожая переменная '${mostSimilar}'`,
                    changes: [`Заменена переменная '${varName}' на '${mostSimilar}'`]
                };
            } else {
                // Если переменная используется в присваивании, можно добавить объявление
                const assignmentRegex = new RegExp(`\\b${varName}\\s*=\\s*`, 'g');
                
                if (assignmentRegex.test(code)) {
                    // Находим первое присваивание и добавляем объявление
                    const fixedCode = code.replace(
                        new RegExp(`\\b${varName}\\s*=\\s*`),
                        `let ${varName} = `
                    );
                    
                    return {
                        fixedCode,
                        description: `Добавлено объявление переменной '${varName}'`,
                        explanation: `Переменная '${varName}' использовалась без объявления`,
                        changes: [`Добавлено объявление 'let ${varName}'`]
                    };
                } else {
                    return {
                        fixedCode: null,
                        description: 'Требуется объявление переменной',
                        explanation: `Переменная '${varName}' не объявлена, необходимо добавить объявление с помощью let, const или var`
                    };
                }
            }
        }
    },
    {
        name: 'js_property_access_null',
        type: 'type_error',
        description: 'Обращение к свойству null или undefined',
        detectRegex: /(?:TypeError: Cannot read propert(?:y|ies) ['"](.*)['"] of (null|undefined)|TypeError: (?:null|undefined) is not an object)/i,
        confidence: 0.7,
        detect: function(code, errorMessage) {
            // Извлекаем имя свойства и тип ошибки из сообщения
            const match = errorMessage && errorMessage.match(
                /(?:TypeError: Cannot read propert(?:y|ies) ['"](.*)['"] of (null|undefined)|TypeError: (?:null|undefined) is not an object)/i
            );
            
            if (!match) return false;
            
            const propName = match[1] || null;
            const objectType = match[2] || 'null/undefined';
            
            return { propName, objectType };
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку обращения к свойству null/undefined',
                    explanation: 'Проверьте, что объект инициализирован перед обращением к его свойствам'
                };
            }
            
            const { propName, objectType } = result;
            
            // Ищем обращения к свойству, которые могут вызывать ошибку
            let fixedCode = code;
            let changes = [];
            
            // Если известно имя свойства, ищем конкретные обращения
            if (propName) {
                // Regex для обнаружения обращений obj.property или obj["property"]
                const propRegex = new RegExp(`(\\w+)(?:\\.${propName}|\\[["']${propName}["']\\])`, 'g');
                
                // Заменяем на проверку с оператором ?. или ||
                fixedCode = code.replace(propRegex, (match, objName) => {
                    changes.push(`Добавлена проверка на null/undefined для доступа к свойству '${propName}'`);
                    
                    // Используем опциональную цепочку (ES2020+)
                    if (match.includes('.')) {
                        return `${objName}?.${propName}`;
                    } else {
                        return `${objName}?.[${match.substring(match.indexOf('['))}`;
                    }
                });
            } else {
                // Если имя свойства неизвестно, ищем обращения к свойствам в целом
                // Это более рискованное исправление, поэтому уменьшаем уверенность
                this.confidence = 0.5;
                
                const propRegex = /(\w+)(?:\.(\w+)|\[["'](\w+)["']\])/g;
                
                // Анализируем код на наличие проблемных обращений
                while ((match = propRegex.exec(code)) !== null) {
                    const objName = match[1];
                    
                    // Ищем объявления этой переменной
                    const objDeclRegex = new RegExp(`\\b(let|const|var)\\s+${objName}\\b`, 'g');
                    
                    // Если есть объявление, но нет инициализации, это может быть причиной
                    if (objDeclRegex.test(code) && new RegExp(`\\b${objName}\\s*=\\s*null\\b`).test(code)) {
                        // Добавляем комментарий о возможной проблеме
                        changes.push(`Добавлен комментарий о возможной причине ошибки: переменная '${objName}' имеет значение null`);
                        
                        // Поскольку мы не знаем контекст, добавляем только комментарий
                        fixedCode = fixedCode.replace(
                            new RegExp(`\\b(let|const|var)\\s+${objName}\\b`),
                            `$1 ${objName} // WARN: Эта переменная может быть null/undefined при обращении к свойствам`
                        );
                    }
                }
            }
            
            // Если код не изменился, предлагаем общие рекомендации
            if (fixedCode === code) {
                return {
                    fixedCode: null,
                    description: 'Требуется проверка на null/undefined',
                    explanation: `Перед обращением к свойствам объекта необходимо убедиться, что он не ${objectType}`
                };
            }
            
            return {
                fixedCode,
                description: 'Добавлена защита от обращения к свойствам null/undefined',
                explanation: `Используется оператор опциональной цепочки (?.) для безопасного доступа к свойствам`,
                changes
            };
        }
    },
    // Дополнительные шаблоны для JavaScript...
    {
        name: 'js_missing_import',
        type: 'module_error',
        description: 'Отсутствует импорт модуля',
        detectRegex: /(?:Error: Cannot find module ['"](.*)['"]|ReferenceError: (.*) is not defined)/i,
        detect: function(code, errorMessage) {
            // Извлекаем имя модуля из сообщения об ошибке
            const moduleMatch = errorMessage && errorMessage.match(/Error: Cannot find module ['"](.*)['"]|ReferenceError: (.*) is not defined/i);
            if (!moduleMatch) return false;
            
            const moduleName = moduleMatch[1] || moduleMatch[2];
            if (!moduleName) return false;
            
            // Проверяем, используется ли этот модуль в коде
            const usageRegex = new RegExp(`\\b${moduleName}\\b`, 'g');
            
            return usageRegex.test(code) ? { moduleName } : false;
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку импорта',
                    explanation: 'Проверьте наличие необходимых импортов и установку модулей'
                };
            }
            
            const { moduleName } = result;
            
            // Определяем тип используемых импортов (ES или CommonJS)
            const esImportRegex = /import\s+.*\s+from\s+/;
            const commonjsImportRegex = /(?:const|let|var)\s+.*\s*=\s*require\(/;
            
            let importStatement;
            if (esImportRegex.test(code)) {
                // Используем ES импорт
                importStatement = `import ${moduleName} from '${moduleName}';\n`;
            } else if (commonjsImportRegex.test(code)) {
                // Используем CommonJS импорт
                importStatement = `const ${moduleName} = require('${moduleName}');\n`;
            } else {
                // По умолчанию используем ES импорт
                importStatement = `import ${moduleName} from '${moduleName}';\n`;
            }
            
            // Добавляем импорт в начало файла
            const fixedCode = importStatement + code;
            
            return {
                fixedCode,
                description: `Добавлен импорт модуля '${moduleName}'`,
                explanation: `Модуль '${moduleName}' используется, но не был импортирован`,
                changes: [`Добавлен импорт: ${importStatement.trim()}`]
            };
        }
    }
];

/**
 * Шаблоны ошибок для TypeScript
 */
const TYPESCRIPT_PATTERNS = [
    {
        name: 'ts_type_mismatch',
        type: 'typescript_type',
        description: 'Несовпадение типов',
        detectRegex: /Type '(.*)' is not assignable to type '(.*)'/i,
        confidence: 0.7,
        detect: function(code, errorMessage) {
            // Извлекаем информацию о типах из сообщения об ошибке
            const match = errorMessage && errorMessage.match(/Type ['"](.*)['"] is not assignable to type ['"](.*)['"]|Type ['"](.*)['"] cannot be used as an index type/i);
            if (!match) return false;
            
            const actualType = match[1] || match[3];
            const expectedType = match[2] || null;
            
            return { actualType, expectedType };
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку типа',
                    explanation: 'Проверьте совместимость типов данных'
                };
            }
            
            const { actualType, expectedType } = result;
            
            // Если ожидаемый тип неизвестен, предлагаем общие рекомендации
            if (!expectedType) {
                return {
                    fixedCode: null,
                    description: 'Необходимо привести тип',
                    explanation: `Тип '${actualType}' не соответствует ожидаемому типу. Проверьте совместимость типов или используйте приведение`
                };
            }
            
            let fixedCode = code;
            let changes = [];
            
            // Проверяем случай string → number
            if (actualType.includes('string') && expectedType.includes('number')) {
                // Ищем присваивания строк в числовые переменные
                const assignmentRegex = /(\w+)\s*(?::\s*number)?\s*=\s*(['"].*['"]|\w+\s*\+\s*['"].*['"])/g;
                
                fixedCode = code.replace(assignmentRegex, (match, varName, value) => {
                    changes.push(`Добавлено преобразование строки в число с помощью Number()`);
                    return `${varName} = Number(${value})`;
                });
            }
            // Проверяем случай number → string
            else if (actualType.includes('number') && expectedType.includes('string')) {
                // Ищем присваивания чисел в строковые переменные
                const assignmentRegex = /(\w+)\s*(?::\s*string)?\s*=\s*(\d+|\w+\s*\+\s*\d+)/g;
                
                fixedCode = code.replace(assignmentRegex, (match, varName, value) => {
                    changes.push(`Добавлено преобразование числа в строку с помощью String()`);
                    return `${varName} = String(${value})`;
                });
            }
            // Добавляем явное приведение типов
            else if (expectedType === 'any') {
                // Ищем выражения, которые могут нуждаться в приведении к any
                const variableRegex = new RegExp(`(\\w+)\\s*:\\s*${actualType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
                
                fixedCode = code.replace(variableRegex, (match, varName) => {
                    changes.push(`Изменен тип переменной '${varName}' на 'any'`);
                    return `${varName}: any`;
                });
            }
            
            // Если код не изменился, предлагаем использовать as для приведения типов
            if (fixedCode === code) {
                return {
                    fixedCode: null,
                    description: 'Требуется явное приведение типов',
                    explanation: `Используйте оператор 'as ${expectedType}' для явного приведения типа '${actualType}' к '${expectedType}'`
                };
            }
            
            return {
                fixedCode,
                description: 'Добавлено преобразование типов',
                explanation: `Исправлено несоответствие типов: '${actualType}' → '${expectedType}'`,
                changes
            };
        }
    },
    // Дополнительные шаблоны для TypeScript...
];

/**
 * Шаблоны ошибок для Python
 */
const PYTHON_PATTERNS = [
    {
        name: 'py_indentation_error',
        type: 'indentation_error',
        description: 'Ошибка отступов',
        detectRegex: /IndentationError: (.*)/i,
        confidence: 0.7,
        detect: function(code, errorMessage) {
            // Извлекаем информацию об ошибке отступов
            const match = errorMessage && errorMessage.match(/IndentationError: (.*) at line (\d+)/i);
            if (!match) return false;
            
            const message = match[1];
            const lineNumber = parseInt(match[2], 10);
            
            return { message, lineNumber };
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку отступов',
                    explanation: 'Проверьте правильность отступов в коде'
                };
            }
            
            const { message, lineNumber } = result;
            
            const lines = code.split('\n');
            const problematicLine = lineNumber > 0 && lineNumber <= lines.length ? lines[lineNumber - 1] : null;
            
            if (!problematicLine) {
                return {
                    fixedCode: null,
                    description: 'Не удалось найти проблемную строку',
                    explanation: 'Проверьте отступы вручную'
                };
            }
            
            let fixedCode = code;
            let changes = [];
            
            // Определяем, какой тип ошибки отступов
            if (message.includes('unexpected indent')) {
                // Слишком большой отступ
                const currentIndent = problematicLine.match(/^\s*/)[0];
                const newIndent = currentIndent.substring(4); // Уменьшаем отступ на 4 пробела
                
                lines[lineNumber - 1] = newIndent + problematicLine.trim();
                fixedCode = lines.join('\n');
                changes.push(`Уменьшен отступ в строке ${lineNumber}`);
            } else if (message.includes('expected an indented block')) {
                // Отсутствует отступ в блоке
                const prevLine = lineNumber > 1 ? lines[lineNumber - 2] : '';
                const currentIndent = problematicLine.match(/^\s*/)[0];
                
                // Если предыдущая строка заканчивается на ":", нужно добавить отступ
                if (prevLine.trim().endsWith(':')) {
                    lines[lineNumber - 1] = currentIndent + '    ' + problematicLine.trim();
                    fixedCode = lines.join('\n');
                    changes.push(`Добавлен отступ в строке ${lineNumber}`);
                }
            }
            
            // Если код не изменился, предлагаем общие рекомендации
            if (fixedCode === code) {
                return {
                    fixedCode: null,
                    description: 'Требуется исправление отступов',
                    explanation: 'В Python отступы используются для определения блоков кода. Проверьте согласованность отступов'
                };
            }
            
            return {
                fixedCode,
                description: 'Исправлены отступы в коде',
                explanation: 'В Python отступы критичны для определения блоков кода',
                changes
            };
        }
    },
    {
        name: 'py_undefined_name',
        type: 'name_error',
        description: 'Использование необъявленной переменной',
        detectRegex: /NameError: name '(.*)' is not defined/i,
        confidence: 0.7,
        detect: function(code, errorMessage) {
            // Извлекаем имя переменной из сообщения об ошибке
            const match = errorMessage && errorMessage.match(/NameError: name ['"](.*)['"] is not defined/i);
            if (!match) return false;
            
            const varName = match[1];
            return varName ? { varName } : false;
        },
        fix: function(code, errorMessage) {
            const result = this.detect(code, errorMessage);
            if (!result) {
                return {
                    fixedCode: null,
                    description: 'Не удалось автоматически исправить ошибку неопределенной переменной',
                    explanation: 'Проверьте правильность имени переменной и убедитесь, что она объявлена перед использованием'
                };
            }
            
            const { varName } = result;
            
            // Проверяем, есть ли похожие переменные (возможные опечатки)
            const varRegex = /\b(\w+)\s*=/g;
            const declaredVars = [];
            
            let match;
            while ((match = varRegex.exec(code)) !== null) {
                declaredVars.push(match[1]);
            }
            
            // Ищем наиболее похожую переменную
            let mostSimilar = null;
            let bestSimilarity = 0;
            
            for (const declaredVar of declaredVars) {
                const similarity = stringSimilarity(varName, declaredVar);
                if (similarity > bestSimilarity && similarity > 0.6) {
                    bestSimilarity = similarity;
                    mostSimilar = declaredVar;
                }
            }
            
            if (mostSimilar) {
                // Заменяем все вхождения неопределенной переменной на наиболее похожую
                const regex = new RegExp(`\\b${varName}\\b`, 'g');
                const fixedCode = code.replace(regex, mostSimilar);
                
                return {
                    fixedCode,
                    description: `Заменена неопределенная переменная '${varName}' на '${mostSimilar}'`,
                    explanation: `Переменная '${varName}' не была объявлена, но найдена похожая переменная '${mostSimilar}'`,
                    changes: [`Заменена переменная '${varName}' на '${mostSimilar}'`]
                };
            } else {
                // Если переменная используется в присваивании, или нет похожих переменных
                const assigmentRegex = new RegExp(`\\b${varName}\\s*=\\s*`, 'g');
                
                if (assigmentRegex.test(code)) {
                    // Переменная используется в присваивании, но может быть ошибка в другом месте
                    return {
                        fixedCode: null,
                        description: 'Переменная используется без инициализации',
                        explanation: `Переменная '${varName}' не инициализирована перед использованием. В Python переменные должны быть инициализированы перед использованием.`
                    };
                } else {
                    // Предполагаем, что это может быть опечатка в строке с инициализацией
                    return {
                        fixedCode: null,
                        description: 'Переменная не определена',
                        explanation: `Переменная '${varName}' не определена. Необходимо инициализировать ее перед использованием.`
                    };
                }
            }
        }
    },
    // Дополнительные шаблоны для Python...
];

/**
 * Шаблоны ошибок для SQL
 */
const SQL_PATTERNS = [
    {
        name: 'sql_syntax_error',
        type: 'syntax_error',
        description: 'Синтаксическая ошибка в SQL-запросе',
        detectRegex: /syntax error/i,
        confidence: 0.6,
        // ... реализация для SQL
    },
    // Дополнительные шаблоны для SQL...
];

// Объединяем все шаблоны по языкам и типам ошибок
const ERROR_PATTERNS = {
    javascript: JAVASCRIPT_PATTERNS,
    typescript: [...JAVASCRIPT_PATTERNS, ...TYPESCRIPT_PATTERNS],
    python: PYTHON_PATTERNS,
    sql: SQL_PATTERNS,
    // Можно добавить другие языки
};

/**
 * Возвращает шаблоны для заданного типа ошибки и языка
 * 
 * @param {string} errorType - Тип ошибки
 * @param {string} language - Язык программирования
 * @returns {Array} - Массив шаблонов
 */
function getPatterns(errorType, language) {
    // Если язык не указан, возвращаем шаблоны для всех языков
    if (!language) {
        return Object.values(ERROR_PATTERNS)
            .flat()
            .filter(pattern => !errorType || pattern.type === errorType);
    }
    
    // Нормализуем язык
    const normalizedLang = language.toLowerCase();
    
    // Если нет шаблонов для этого языка, возвращаем пустой массив
    if (!ERROR_PATTERNS[normalizedLang]) {
        return [];
    }
    
    // Возвращаем шаблоны для указанного языка и типа ошибки
    return ERROR_PATTERNS[normalizedLang]
        .filter(pattern => !errorType || pattern.type === errorType);
}

/**
 * Регистрирует новый шаблон ошибки
 * 
 * @param {string} language - Язык программирования
 * @param {Object} pattern - Шаблон ошибки
 * @returns {boolean} - Успешность регистрации
 */
function registerPattern(language, pattern) {
    if (!language || !pattern || !pattern.name || !pattern.type) {
        logger.warn('Invalid pattern registration attempt', { language, pattern });
        return false;
    }
    
    // Нормализуем язык
    const normalizedLang = language.toLowerCase();
    
    // Создаем массив шаблонов для языка, если его нет
    if (!ERROR_PATTERNS[normalizedLang]) {
        ERROR_PATTERNS[normalizedLang] = [];
    }
    
    // Проверяем, существует ли уже шаблон с таким именем
    const existingPatternIndex = ERROR_PATTERNS[normalizedLang]
        .findIndex(p => p.name === pattern.name);
    
    if (existingPatternIndex >= 0) {
        // Заменяем существующий шаблон
        ERROR_PATTERNS[normalizedLang][existingPatternIndex] = pattern;
        logger.debug(`Pattern '${pattern.name}' updated for language '${language}'`);
    } else {
        // Добавляем новый шаблон
        ERROR_PATTERNS[normalizedLang].push(pattern);
        logger.debug(`Pattern '${pattern.name}' registered for language '${language}'`);
    }
    
    return true;
}

/**
 * Вычисляет степень похожести двух строк
 * 
 * @private
 * @param {string} str1 - Первая строка
 * @param {string} str2 - Вторая строка
 * @returns {number} - Оценка похожести (0-1)
 */
function stringSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;
    
    // Расстояние Левенштейна
    const len1 = str1.length;
    const len2 = str2.length;
    
    // Создаем матрицу расстояний
    const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
    
    // Инициализируем матрицу
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    // Заполняем матрицу
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1, // удаление
                matrix[i][j - 1] + 1, // вставка
                matrix[i - 1][j - 1] + cost // замена
            );
        }
    }
    
    // Вычисляем сходство как 1 - (расстояние / максимальная длина)
    const distance = matrix[len1][len2];
    return 1 - distance / Math.max(len1, len2);
}

module.exports = {
    getPatterns,
    registerPattern
};
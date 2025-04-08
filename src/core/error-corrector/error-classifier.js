/**
 * Классификатор ошибок кода
 * Анализирует сообщения об ошибках и определяет их тип, серьезность и возможные причины
 */

const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');

// Шаблоны известных ошибок для различных языков программирования
const ERROR_PATTERNS = {
    // Общие ошибки
    general: [
        {
            pattern: /permission denied|access denied|not allowed/i,
            type: 'permission',
            severity: 'high',
            description: 'Отсутствие прав доступа'
        },
        {
            pattern: /timeout|timed out/i, 
            type: 'timeout',
            severity: 'medium',
            description: 'Превышено время ожидания'
        },
        {
            pattern: /memory|allocation|heap|stack overflow/i,
            type: 'memory',
            severity: 'high',
            description: 'Проблемы с памятью'
        },
        {
            pattern: /not found|doesn't exist|does not exist|couldn't find|could not find/i,
            type: 'not_found',
            severity: 'medium',
            description: 'Ресурс не найден'
        }
    ],
    
    // JavaScript/TypeScript ошибки
    javascript: [
        {
            pattern: /TypeError: (.*) is not a function/i,
            type: 'type_error',
            severity: 'high',
            description: 'Попытка вызвать функцию на не-функциональном значении'
        },
        {
            pattern: /ReferenceError: (.*) is not defined/i,
            type: 'reference_error',
            severity: 'high',
            description: 'Использование необъявленной переменной'
        },
        {
            pattern: /SyntaxError: Unexpected token/i,
            type: 'syntax_error',
            severity: 'high',
            description: 'Синтаксическая ошибка - неожиданный токен'
        },
        {
            pattern: /SyntaxError: missing \) after argument list/i,
            type: 'syntax_error',
            severity: 'high',
            description: 'Отсутствует закрывающая скобка после списка аргументов'
        },
        {
            pattern: /Uncaught \(in promise\)/i,
            type: 'promise_error',
            severity: 'medium',
            description: 'Необработанная ошибка в Promise'
        },
        {
            pattern: /Cannot read propert(?:y|ies) ['"]?(.*)['"]? of (null|undefined)/i,
            type: 'null_reference',
            severity: 'high',
            description: 'Попытка обратиться к свойству null/undefined'
        },
        {
            pattern: /Module not found/i,
            type: 'module_error',
            severity: 'high',
            description: 'Модуль не найден'
        },
        {
            pattern: /is not assignable to type/i,
            type: 'typescript_type',
            severity: 'medium',
            description: 'Несовпадение типов в TypeScript'
        },
        {
            pattern: /\(property\) (.*) is missing in type/i,
            type: 'typescript_property',
            severity: 'medium',
            description: 'Отсутствует обязательное свойство объекта в TypeScript'
        }
    ],
    
    // Python ошибки
    python: [
        {
            pattern: /IndentationError/i,
            type: 'indentation_error',
            severity: 'high',
            description: 'Ошибка отступов'
        },
        {
            pattern: /ImportError: No module named/i,
            type: 'import_error',
            severity: 'high',
            description: 'Модуль не найден при импорте'
        },
        {
            pattern: /AttributeError: ['"]?(.*?)['"]? object has no attribute ['"]?(.*?)['"]?/i,
            type: 'attribute_error',
            severity: 'high',
            description: 'Обращение к несуществующему атрибуту объекта'
        },
        {
            pattern: /NameError: name ['"]?(.*?)['"]? is not defined/i,
            type: 'name_error',
            severity: 'high',
            description: 'Использование необъявленной переменной'
        },
        {
            pattern: /TypeError: (.*?) takes (\d+) positional argument but (\d+) were given/i,
            type: 'argument_error',
            severity: 'high',
            description: 'Неверное количество аргументов функции'
        },
        {
            pattern: /KeyError: ['"]?(.*?)['"]?/i,
            type: 'key_error',
            severity: 'medium',
            description: 'Обращение к несуществующему ключу словаря'
        },
        {
            pattern: /IndexError: list index out of range/i,
            type: 'index_error',
            severity: 'medium',
            description: 'Индекс списка вне допустимого диапазона'
        }
    ],
    
    // SQL ошибки
    sql: [
        {
            pattern: /syntax error/i,
            type: 'syntax_error',
            severity: 'high',
            description: 'Синтаксическая ошибка в SQL-запросе'
        },
        {
            pattern: /table ['"]?(.*?)['"]? already exists/i,
            type: 'table_exists',
            severity: 'medium',
            description: 'Попытка создать существующую таблицу'
        },
        {
            pattern: /table ['"]?(.*?)['"]? doesn't exist|table ['"]?(.*?)['"]? not found/i,
            type: 'table_not_found',
            severity: 'high',
            description: 'Обращение к несуществующей таблице'
        },
        {
            pattern: /column ['"]?(.*?)['"]? doesn't exist|column ['"]?(.*?)['"]? not found/i,
            type: 'column_not_found',
            severity: 'high',
            description: 'Обращение к несуществующему столбцу'
        },
        {
            pattern: /duplicate key|unique constraint/i,
            type: 'unique_constraint',
            severity: 'medium',
            description: 'Нарушение ограничения уникальности'
        },
        {
            pattern: /foreign key constraint/i,
            type: 'foreign_key',
            severity: 'medium',
            description: 'Нарушение ограничения внешнего ключа'
        }
    ],
    
    // Ошибки сборки и инструментов
    build: [
        {
            pattern: /npm ERR! code ENOENT/i,
            type: 'npm_not_found',
            severity: 'high',
            description: 'NPM не может найти файл или директорию'
        },
        {
            pattern: /npm ERR! code E404/i,
            type: 'npm_package_not_found',
            severity: 'high',
            description: 'NPM пакет не найден'
        },
        {
            pattern: /Failed to compile/i,
            type: 'compilation_error',
            severity: 'high',
            description: 'Ошибка компиляции'
        },
        {
            pattern: /Cannot find module/i,
            type: 'module_not_found',
            severity: 'high',
            description: 'Модуль не найден при сборке'
        }
    ],
    
    // Ошибки тестов
    test: [
        {
            pattern: /Expected (.*) to (equal|be|include|contain|have)/i,
            type: 'assertion_error',
            severity: 'medium',
            description: 'Ожидания теста не соответствуют результату'
        },
        {
            pattern: /Cannot spy on/i,
            type: 'spy_error',
            severity: 'medium',
            description: 'Невозможно создать шпиона для объекта/метода'
        },
        {
            pattern: /Test timeout/i,
            type: 'test_timeout',
            severity: 'medium',
            description: 'Превышено время выполнения теста'
        }
    ]
};

/**
 * Классифицирует ошибку на основе сообщения и кода
 * 
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} code - Код, вызвавший ошибку (опционально)
 * @param {Object} options - Дополнительные опции
 * @returns {Promise<Object>} - Классификация ошибки
 */
async function classifyError(errorMessage, code = null, options = {}) {
    try {
        logger.debug('Classifying error', { 
            errorLength: errorMessage?.length || 0,
            codeProvided: !!code,
            options: Object.keys(options)
        });
        
        const {
            language = detectLanguage(errorMessage, code),
            useLLM = true,
            details = true
        } = options;
        
        // Пытаемся сначала классифицировать ошибку на основе правил
        const ruleBasedClassification = classifyWithRules(errorMessage, language);
        
        // Если нашли совпадение с высокой уверенностью и не нужны детали, возвращаем результат
        if (ruleBasedClassification.confidence >= 0.8 && !details) {
            logger.debug('Error classified with high confidence using rules', { 
                errorType: ruleBasedClassification.type,
                confidence: ruleBasedClassification.confidence
            });
            
            return ruleBasedClassification;
        }
        
        // Если требуется использование LLM и есть доступ к LLM, используем его
        if (useLLM) {
            try {
                const llmClassification = await classifyWithLLM(errorMessage, code, language);
                
                // Если LLM дал результат с высокой уверенностью, используем его
                if (llmClassification.confidence >= 0.7) {
                    logger.debug('Error classified with LLM', { 
                        errorType: llmClassification.type,
                        confidence: llmClassification.confidence
                    });
                    
                    return llmClassification;
                }
                
                // Иначе объединяем результаты
                const combinedClassification = combineClassifications(
                    ruleBasedClassification,
                    llmClassification
                );
                
                logger.debug('Error classified with combined approach', { 
                    errorType: combinedClassification.type,
                    confidence: combinedClassification.confidence
                });
                
                return combinedClassification;
            } catch (llmError) {
                logger.warn('Error using LLM for classification, falling back to rule-based', { 
                    error: llmError.message
                });
                
                // В случае ошибки LLM используем только правила
                return ruleBasedClassification;
            }
        }
        
        // Если LLM не используется, возвращаем результат на основе правил
        return ruleBasedClassification;
    } catch (error) {
        logger.error('Error classifying error', { 
            error: error.message,
            stack: error.stack
        });
        
        // В случае ошибки возвращаем базовый результат
        return {
            type: 'unknown',
            severity: 'unknown',
            description: 'Неизвестная ошибка',
            causes: ['Не удалось классифицировать ошибку'],
            solutions: ['Обратитесь к документации или запросите помощь'],
            confidence: 0.1
        };
    }
}

/**
 * Классифицирует ошибку на основе правил
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} language - Язык программирования
 * @returns {Object} - Классификация ошибки
 */
function classifyWithRules(errorMessage, language) {
    if (!errorMessage) {
        return {
            type: 'unknown',
            severity: 'unknown',
            description: 'Пустое сообщение об ошибке',
            causes: ['Не предоставлено сообщение об ошибке'],
            solutions: ['Предоставьте полное сообщение об ошибке для анализа'],
            confidence: 0.1
        };
    }
    
    // Проверяем общие ошибки
    let bestMatch = findBestErrorMatch(errorMessage, ERROR_PATTERNS.general);
    
    // Проверяем ошибки конкретного языка
    if (language && ERROR_PATTERNS[language.toLowerCase()]) {
        const languageMatch = findBestErrorMatch(errorMessage, ERROR_PATTERNS[language.toLowerCase()]);
        
        // Если нашли более точное совпадение для языка, используем его
        if (languageMatch.confidence > bestMatch.confidence) {
            bestMatch = languageMatch;
        }
    }
    
    // Проверяем ошибки сборки
    const buildMatch = findBestErrorMatch(errorMessage, ERROR_PATTERNS.build);
    if (buildMatch.confidence > bestMatch.confidence) {
        bestMatch = buildMatch;
    }
    
    // Проверяем ошибки тестов
    const testMatch = findBestErrorMatch(errorMessage, ERROR_PATTERNS.test);
    if (testMatch.confidence > bestMatch.confidence) {
        bestMatch = testMatch;
    }
    
    // Формируем базовые рекомендации по решению
    let solutions = [];
    
    switch (bestMatch.type) {
        case 'syntax_error':
            solutions = [
                'Проверьте синтаксис на наличие опечаток',
                'Убедитесь, что все открывающие скобки имеют закрывающие',
                'Проверьте правильность отступов'
            ];
            break;
        case 'reference_error':
        case 'name_error':
            solutions = [
                'Убедитесь, что переменная объявлена перед использованием',
                'Проверьте правильность имени переменной (с учетом регистра)',
                'Проверьте область видимости переменной'
            ];
            break;
        case 'type_error':
            solutions = [
                'Проверьте типы данных переменных',
                'Убедитесь, что вызываете функцию на правильном объекте',
                'Используйте отладчик для проверки значений в рантайме'
            ];
            break;
        case 'null_reference':
            solutions = [
                'Добавьте проверку на null/undefined перед обращением к свойству',
                'Используйте опциональную цепочку (?.) в JavaScript',
                'Убедитесь, что объект инициализирован перед использованием'
            ];
            break;
        case 'module_error':
        case 'import_error':
            solutions = [
                'Проверьте правильность пути импорта',
                'Убедитесь, что модуль установлен',
                'Проверьте package.json на наличие зависимости'
            ];
            break;
        case 'permission':
            solutions = [
                'Проверьте права доступа к файлу/ресурсу',
                'Запустите приложение с необходимыми правами',
                'Измените права доступа к файлу/ресурсу'
            ];
            break;
        default:
            solutions = [
                'Проанализируйте стек ошибки для определения места возникновения',
                'Используйте отладчик для пошагового анализа',
                'Ищите похожие ошибки в документации или на Stack Overflow'
            ];
    }
    
    return {
        ...bestMatch,
        solutions
    };
}

/**
 * Находит наилучшее совпадение с шаблонами ошибок
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {Array} patterns - Массив шаблонов ошибок
 * @returns {Object} - Наилучшее совпадение
 */
function findBestErrorMatch(errorMessage, patterns) {
    let bestMatch = {
        type: 'unknown',
        severity: 'unknown',
        description: 'Неизвестная ошибка',
        causes: ['Неизвестная причина'],
        confidence: 0.1
    };
    
    for (const errorPattern of patterns) {
        const match = errorMessage.match(errorPattern.pattern);
        
        if (match) {
            // Вычисляем уверенность на основе длины совпадения и специфичности
            const matchLength = match[0].length;
            const messageLength = errorMessage.length;
            
            // Чем длиннее совпадение относительно сообщения, тем выше уверенность
            let confidence = 0.5 + (matchLength / messageLength) * 0.3;
            
            // Если есть группы захвата, увеличиваем уверенность
            if (match.length > 1) {
                confidence += 0.1;
            }
            
            // Если уверенность выше текущей лучшей, обновляем лучшее совпадение
            if (confidence > bestMatch.confidence) {
                // Извлекаем информацию из групп захвата, если есть
                let causes = ['Неизвестная причина'];
                
                if (match.length > 1) {
                    const matchGroups = match.slice(1).filter(Boolean);
                    causes = [`Проблема связана с: ${matchGroups.join(', ')}`];
                }
                
                bestMatch = {
                    type: errorPattern.type,
                    severity: errorPattern.severity,
                    description: errorPattern.description,
                    causes,
                    match: match[0],
                    confidence
                };
            }
        }
    }
    
    return bestMatch;
}

/**
 * Классифицирует ошибку с использованием LLM
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} code - Код, вызвавший ошибку
 * @param {string} language - Язык программирования
 * @returns {Promise<Object>} - Классификация ошибки
 */
async function classifyWithLLM(errorMessage, code, language) {
    try {
        // Загружаем промпт для классификации ошибки
        const prompt = await promptManager.getPrompt('error-classification', {
            error_message: errorMessage,
            code: code || 'Код не предоставлен',
            language: language || 'Не определен'
        });
        
        // Отправляем запрос к LLM
        const response = await llmClient.sendPrompt(prompt, {
            temperature: 0.3,
            structuredOutput: true
        });
        
        // Обрабатываем ответ
        let parsedResponse;
        
        if (typeof response === 'string') {
            // Если ответ в виде строки, пытаемся извлечь JSON
            try {
                const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                                response.match(/\{[\s\S]*\}/);
                                
                if (jsonMatch) {
                    parsedResponse = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    throw new Error('No JSON found in LLM response');
                }
            } catch (e) {
                logger.warn('Failed to parse LLM response as JSON', { error: e.message });
                
                // Возвращаем базовый объект
                return {
                    type: 'unknown',
                    severity: 'unknown',
                    description: 'Не удалось проанализировать ошибку с помощью LLM',
                    causes: ['Ошибка парсинга ответа LLM'],
                    solutions: ['Попробуйте классифицировать ошибку вручную'],
                    confidence: 0.1
                };
            }
        } else {
            // Если ответ уже в виде объекта
            parsedResponse = response;
        }
        
        // Убеждаемся, что в ответе есть все необходимые поля
        return {
            type: parsedResponse.type || 'unknown',
            severity: parsedResponse.severity || 'unknown',
            description: parsedResponse.description || 'Неизвестная ошибка',
            causes: parsedResponse.causes || ['Неизвестная причина'],
            solutions: parsedResponse.solutions || ['Решение не предоставлено'],
            confidence: parsedResponse.confidence || 0.7,
            llm_analysis: parsedResponse.analysis || null
        };
    } catch (error) {
        logger.error('Error using LLM for error classification', { error: error.message });
        throw error;
    }
}

/**
 * Объединяет классификации из разных источников
 * 
 * @private
 * @param {Object} ruleClassification - Классификация на основе правил
 * @param {Object} llmClassification - Классификация на основе LLM
 * @returns {Object} - Объединенная классификация
 */
function combineClassifications(ruleClassification, llmClassification) {
    // Если уверенность в правилах выше, чем в LLM, приоритет правилам
    if (ruleClassification.confidence > llmClassification.confidence) {
        return {
            ...ruleClassification,
            // Добавляем решения из LLM, если они есть и отличаются
            solutions: combineArrays(ruleClassification.solutions, llmClassification.solutions),
            // Добавляем причины из LLM, если они есть и отличаются
            causes: combineArrays(ruleClassification.causes, llmClassification.causes),
            // Сохраняем анализ LLM, если есть
            llm_analysis: llmClassification.llm_analysis || null
        };
    }
    
    // Иначе приоритет LLM
    return {
        ...llmClassification,
        // Если тип из правил был более конкретным, используем его
        type: ruleClassification.type !== 'unknown' ? ruleClassification.type : llmClassification.type,
        // Если у ошибки было предопределенное описание, используем его
        description: ruleClassification.type !== 'unknown' ? ruleClassification.description : llmClassification.description
    };
}

/**
 * Объединяет массивы, удаляя дубликаты
 * 
 * @private
 * @param {Array} arr1 - Первый массив
 * @param {Array} arr2 - Второй массив
 * @returns {Array} - Объединенный массив
 */
function combineArrays(arr1, arr2) {
    if (!arr1 || !arr1.length) return arr2 || [];
    if (!arr2 || !arr2.length) return arr1;
    
    // Создаем множество уникальных элементов
    const combined = new Set([...arr1]);
    
    // Добавляем элементы из второго массива, если они достаточно отличаются
    for (const item2 of arr2) {
        let isDuplicate = false;
        
        for (const item1 of arr1) {
            // Проверяем на похожесть (если строки похожи более чем на 60%)
            if (similarityScore(item1, item2) > 0.6) {
                isDuplicate = true;
                break;
            }
        }
        
        if (!isDuplicate) {
            combined.add(item2);
        }
    }
    
    return Array.from(combined);
}

/**
 * Вычисляет степень похожести двух строк (простая метрика)
 * 
 * @private
 * @param {string} str1 - Первая строка
 * @param {string} str2 - Вторая строка
 * @returns {number} - Оценка похожести (0-1)
 */
function similarityScore(str1, str2) {
    if (str1 === str2) return 1;
    
    // Приводим к нижнему регистру и удаляем пунктуацию
    const normalize = (str) => str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
    
    const words1 = normalize(str1).split(/\s+/);
    const words2 = normalize(str2).split(/\s+/);
    
    // Считаем общие слова
    const commonWords = words1.filter(word => words2.includes(word));
    
    // Вычисляем оценку на основе отношения общих слов к общему количеству
    return (2 * commonWords.length) / (words1.length + words2.length);
}

/**
 * Определяет язык программирования по сообщению об ошибке и коду
 * 
 * @private
 * @param {string} errorMessage - Сообщение об ошибке
 * @param {string} code - Код, вызвавший ошибку
 * @returns {string} - Определенный язык программирования
 */
function detectLanguage(errorMessage, code) {
    if (!errorMessage && !code) return null;
    
    // Признаки различных языков в сообщениях об ошибках
    const errorSignatures = {
        javascript: [
            /TypeError:|ReferenceError:|SyntaxError:|RangeError:|EvalError:|URIError:|AggregationError:|InternalError:/i,
            /undefined is not a function|is not a function|is not defined|cannot read property/i,
            /unexpected token/i,
            /\[JavaScript\]|Node\.js|V8|ECMAScript/i
        ],
        typescript: [
            /TS\d+:/i,
            /TypeScript|TSC|tsc: error TS/i,
            /is not assignable to type/i,
            /Property '.*' does not exist on type/i
        ],
        python: [
            /IndentationError:|TypeError:|ValueError:|ImportError:|AttributeError:|NameError:|SyntaxError:|RuntimeError:/i,
            /\[Python\]|Traceback \(most recent call last\)/i,
            /File ".*", line \d+/i
        ],
        java: [
            /Exception in thread|java\.lang\.|java\.util\./i,
            /\.java:\d+/i,
            /\[Java\]|javac/i
        ],
        csharp: [
            /\[C#\]|\.cs\(\d+,\d+\)|\.cs:line \d+/i,
            /CS\d+:/i
        ],
        sql: [
            /SQL syntax|syntax error at or near|ERROR: syntax error at or near/i,
            /ORA-\d+|PLS-\d+|Microsoft SQL Server|MySQL Error/i
        ],
        php: [
            /PHP (Notice|Warning|Fatal error|Parse error):/i,
            /on line \d+/i,
            /\[PHP\]/i
        ],
        ruby: [
            /\[Ruby\]|\.rb:\d+:in/i
        ],
        go: [
            /\[Go\]|panic:|go\.go:/i
        ]
    };
    
    // Проверяем сообщение об ошибке на наличие признаков языка
    if (errorMessage) {
        for (const [language, signatures] of Object.entries(errorSignatures)) {
            for (const signature of signatures) {
                if (signature.test(errorMessage)) {
                    return language;
                }
            }
        }
    }
    
    // Если язык не определен по ошибке, пытаемся определить по коду
    if (code) {
        const codeSignatures = {
            javascript: [
                /const |let |var |function\s+\w+\s*\(|=>/,
                /console\.log|import\s+.*\s+from|require\(|export\s+/,
                /\[\s*\.\.\.\w+\s*\]|\.\.\.\w+/
            ],
            typescript: [
                /interface |type\s+\w+\s*=|<\w+>|:\s*\w+/,
                /implements |extends |public\s+|private\s+|protected\s+/
            ],
            python: [
                /def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import/,
                /if\s+__name__\s*==\s*('|")__main__('|")/
            ],
            java: [
                /public\s+class|private\s+static|public\s+static|void\s+main/,
                /System\.out\.println|import\s+java\./
            ],
            csharp: [
                /namespace\s+\w+|using\s+System|public\s+class|private\s+void/,
                /Console\.WriteLine|List<|Dictionary<|IEnumerable<|async\s+Task/
            ],
            sql: [
                /SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM|CREATE\s+TABLE/i
            ],
            php: [
                /<\?php|\$\w+\s*=|echo\s+|function\s+\w+\s*\(/
            ],
            ruby: [
                /def\s+\w+|class\s+\w+\s*<|require\s+('|")|puts\s+/
            ],
            go: [
                /func\s+\w+\s*\(|package\s+main|import\s+\(/,
                /fmt\.Println|go\s+func/
            ]
        };
        
        for (const [language, signatures] of Object.entries(codeSignatures)) {
            for (const signature of signatures) {
                if (signature.test(code)) {
                    return language;
                }
            }
        }
    }
    
    // Если язык не определен, возвращаем null
    return null;
}

/**
 * Обогащает классификацию ошибки контекстом проекта
 * 
 * @param {Object} classification - Базовая классификация ошибки
 * @param {Object} projectContext - Контекст проекта
 * @returns {Promise<Object>} - Обогащенная классификация
 */
async function enrichWithProjectContext(classification, projectContext) {
    if (!projectContext || Object.keys(projectContext).length === 0) {
        return classification;
    }
    
    try {
        logger.debug('Enriching error classification with project context');
        
        // Базовое обогащение: добавляем технологии проекта
        if (projectContext.technologies && projectContext.technologies.length > 0) {
            const techStack = projectContext.technologies.join(', ');
            
            // Добавляем информацию о технологиях в описание
            classification.project_context = {
                technologies: projectContext.technologies,
                related_files: []
            };
            
            // Если есть файлы проекта, ищем похожие на ошибку
            if (projectContext.files && projectContext.files.length > 0) {
                // Находим файлы, связанные с ошибкой
                const relatedFiles = findRelatedFiles(classification, projectContext.files);
                
                if (relatedFiles.length > 0) {
                    classification.project_context.related_files = relatedFiles;
                    
                    // Добавляем информацию о связанных файлах в решения
                    classification.solutions.push(
                        `Проверьте файлы: ${relatedFiles.map(f => f.path).join(', ')}`
                    );
                }
            }
            
            // Если есть данные о базе данных и ошибка связана с БД
            if (projectContext.dbSchema && isDBRelatedError(classification)) {
                classification.project_context.database = {
                    type: detectDatabaseType(projectContext.dbSchema)
                };
                
                // Добавляем рекомендации, связанные с базой данных
                classification.solutions.push(
                    'Проверьте схему базы данных на соответствие запросам'
                );
            }
        }
        
        return classification;
    } catch (error) {
        logger.error('Error enriching classification with project context', { 
            error: error.message
        });
        
        // В случае ошибки возвращаем исходную классификацию
        return classification;
    }
}

/**
 * Находит файлы, связанные с ошибкой
 * 
 * @private
 * @param {Object} classification - Классификация ошибки
 * @param {Array} files - Файлы проекта
 * @returns {Array} - Связанные файлы
 */
function findRelatedFiles(classification, files) {
    const relatedFiles = [];
    const errorType = classification.type;
    const errorMessage = classification.match || '';
    
    // Ищем файлы, упомянутые в сообщении об ошибке
    for (const file of files) {
        // Проверяем, упоминается ли путь к файлу в сообщении об ошибке
        if (errorMessage && errorMessage.includes(file.path)) {
            relatedFiles.push({
                path: file.path,
                relevance: 'high',
                reason: 'Упоминается в сообщении об ошибке'
            });
            continue;
        }
        
        // Для ошибок импорта/модуля проверяем файлы на связь с модулями
        if (errorType === 'module_error' || errorType === 'import_error') {
            // Извлекаем имя модуля из сообщения об ошибке
            const moduleMatch = errorMessage.match(/['"]([^'"]+)['"]/);
            if (moduleMatch && moduleMatch[1]) {
                const moduleName = moduleMatch[1];
                
                // Проверяем, содержит ли файл импорт этого модуля
                if (file.content && (
                    file.content.includes(`import ${moduleName}`) ||
                    file.content.includes(`from ${moduleName}`) ||
                    file.content.includes(`require('${moduleName}')`) ||
                    file.content.includes(`require("${moduleName}")`)
                )) {
                    relatedFiles.push({
                        path: file.path,
                        relevance: 'medium',
                        reason: 'Содержит импорт проблемного модуля'
                    });
                }
            }
        }
        
        // Для ошибок типа переменных проверяем использование переменных
        if (errorType === 'reference_error' || errorType === 'type_error') {
            // Извлекаем имя переменной из сообщения об ошибке
            const varMatch = errorMessage.match(/['"]([^'"]+)['"]/);
            if (varMatch && varMatch[1]) {
                const varName = varMatch[1];
                
                // Проверяем, содержит ли файл эту переменную
                if (file.content && file.content.includes(varName)) {
                    relatedFiles.push({
                        path: file.path,
                        relevance: 'medium',
                        reason: 'Содержит упоминание проблемной переменной'
                    });
                }
            }
        }
    }
    
    return relatedFiles;
}

/**
 * Определяет, связана ли ошибка с базой данных
 * 
 * @private
 * @param {Object} classification - Классификация ошибки
 * @returns {boolean} - true, если ошибка связана с БД
 */
function isDBRelatedError(classification) {
    const dbErrorTypes = [
        'sql_error', 'query_error', 'table_not_found', 'column_not_found',
        'foreign_key', 'unique_constraint', 'table_exists'
    ];
    
    return dbErrorTypes.includes(classification.type) ||
           (classification.match && (
               classification.match.includes('SQL') ||
               classification.match.includes('query') ||
               classification.match.includes('database')
           ));
}

/**
 * Определяет тип базы данных
 * 
 * @private
 * @param {string|Object} dbSchema - Схема базы данных
 * @returns {string} - Тип базы данных
 */
function detectDatabaseType(dbSchema) {
    if (!dbSchema) return 'unknown';
    
    if (typeof dbSchema === 'string') {
        // Проверяем ключевые слова в строке схемы
        if (dbSchema.includes('CREATE TABLE') || 
            dbSchema.includes('INTEGER') || 
            dbSchema.includes('VARCHAR')) {
            return 'sql';
        } else if (dbSchema.includes('ObjectId') || 
                  dbSchema.includes('document')) {
            return 'mongodb';
        }
    } else if (typeof dbSchema === 'object') {
        // Проверяем структуру объекта
        if (dbSchema.type) {
            return dbSchema.type;
        } else if (dbSchema.collections || dbSchema.documents) {
            return 'mongodb';
        } else if (dbSchema.tables) {
            return 'sql';
        }
    }
    
    return 'unknown';
}

module.exports = {
    classifyError,
    enrichWithProjectContext
};
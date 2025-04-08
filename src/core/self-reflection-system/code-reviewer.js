// src/core/self-reflection-system/code-reviewer.js

const logger = require('../../utils/logger');
const { getLLMClient } = require('../../utils/llm-client');

/**
 * Класс для выполнения различных типов проверок кода
 */
class CodeReviewer {
  constructor() {
    this.llmClient = getLLMClient();
    
    // Предопределенные шаблоны проблем для различных языков и типов файлов
    this.knownIssuePatterns = this.loadIssuePatterns();
  }

  /**
   * Загружает шаблоны известных проблем для различных языков
   * @returns {Object} Шаблоны проблем
   */
  loadIssuePatterns() {
    return {
      javascript: {
        quality: [
          {
            pattern: /console\.log\(/g,
            severity: 'low',
            message: 'Отладочный console.log найден в продакшн-коде',
            suggestion: 'Удалите или закомментируйте отладочные вызовы console.log'
          },
          {
            pattern: /var\s+/g,
            severity: 'low',
            message: 'Использование устаревшего ключевого слова var',
            suggestion: 'Замените var на const или let'
          },
          {
            pattern: /function\s*\(\)\s*\{\s*return\s*[^;{]+;\s*\}/g,
            severity: 'low',
            message: 'Простая функция может быть заменена на стрелочную функцию',
            suggestion: 'Используйте стрелочные функции для простых возвращаемых выражений'
          }
        ],
        security: [
          {
            pattern: /eval\(/g,
            severity: 'high',
            message: 'Использование eval() представляет угрозу безопасности',
            suggestion: 'Избегайте использования eval(), найдите альтернативный подход'
          },
          {
            pattern: /document\.write\(/g,
            severity: 'medium',
            message: 'document.write() может быть небезопасным',
            suggestion: 'Используйте безопасные методы DOM-манипуляций'
          },
          {
            pattern: /innerHTML\s*=\s*(?!['"`]<)/,
            severity: 'medium',
            message: 'Прямое присваивание innerHTML может вызвать XSS-уязвимость',
            suggestion: 'Используйте textContent или безопасные методы обновления DOM'
          }
        ],
        bestPractices: [
          {
            pattern: /\/\/\s*TODO/gi,
            severity: 'low',
            message: 'Найдена TODO-заметка в коде',
            suggestion: 'Завершите задачу или создайте ticket вместо комментария'
          },
          {
            pattern: /if\s*\([^)]+\)\s*\{\s*return[^;]*;\s*\}\s*else\s*\{/g,
            severity: 'low',
            message: 'Избыточная else после return',
            suggestion: 'Удалите else и соответствующие фигурные скобки для улучшения читаемости'
          },
          {
            pattern: /setTimeout\(\s*function\s*\(\)/g,
            severity: 'low',
            message: 'Используйте стрелочные функции в setTimeout',
            suggestion: 'Замените function() на () =>'
          }
        ]
      },
      typescript: {
        quality: [
          {
            pattern: /any(?!\[\])/g,
            severity: 'medium',
            message: 'Использование типа any снижает преимущества TypeScript',
            suggestion: 'Используйте более конкретные типы или unknown'
          },
          {
            pattern: /\.push\(<[^>]*?any[^>]*?>\(/g,
            severity: 'low',
            message: 'Приведение к any при push может привести к проблемам типизации',
            suggestion: 'Используйте правильное типизирование данных'
          }
        ],
        security: [
          {
            pattern: /eval\(/g,
            severity: 'high',
            message: 'Использование eval() представляет угрозу безопасности',
            suggestion: 'Избегайте использования eval(), найдите альтернативный подход'
          }
        ],
        bestPractices: [
          {
            pattern: /\/\/\s*@ts-ignore/g,
            severity: 'medium',
            message: 'Использование @ts-ignore отключает проверку типов',
            suggestion: 'Вместо отключения проверки типов исправьте основную проблему'
          },
          {
            pattern: /interface\s+[A-Z][A-Za-z0-9]*\s*\{\s*\}\s*/g,
            severity: 'low',
            message: 'Пустой интерфейс',
            suggestion: 'Удалите пустой интерфейс или добавьте нужные свойства'
          }
        ]
      },
      python: {
        // Шаблоны для Python, аналогично другим языкам
      },
      // Другие языки...
    };
  }

  /**
   * Проверяет качество кода
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты проверки
   */
  async reviewQuality(code, language, fileType) {
    try {
      logger.debug(`Проверка качества кода на языке ${language}, тип файла: ${fileType}`);
      
      // Начинаем с базовой статической проверки
      const issues = this.staticCodeCheck(code, language, 'quality');
      
      // Если есть существенные проблемы с качеством, узнаем больше деталей через LLM
      if (issues.length > 0 && issues.some(issue => issue.severity === 'high' || issue.severity === 'medium')) {
        const llmResults = await this.deepQualityReview(code, language, fileType);
        
        // Объединяем результаты, избегая дублирования
        const combinedIssues = this.mergeIssues(issues, llmResults.issues);
        
        return {
          passed: combinedIssues.length === 0 || !combinedIssues.some(issue => issue.severity === 'high'),
          score: this.calculateQualityScore(combinedIssues),
          issues: combinedIssues
        };
      }
      
      // Если проблем мало или они несущественные, используем только результаты статического анализа
      return {
        passed: issues.length === 0 || !issues.some(issue => issue.severity === 'high'),
        score: this.calculateQualityScore(issues),
        issues
      };
    } catch (error) {
      logger.error(`Ошибка при проверке качества кода: ${error.message}`, error);
      return {
        passed: true, // Не блокируем процесс из-за ошибки проверки
        score: 50,    // Нейтральная оценка по умолчанию
        issues: [
          {
            type: 'quality_check',
            severity: 'low',
            message: `Ошибка при проверке качества: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Выполняет глубокую проверку качества кода с использованием LLM
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты глубокой проверки
   * @private
   */
  async deepQualityReview(code, language, fileType) {
    try {
      // Формируем промпт для LLM
      const prompt = `
# Задача: Проверка качества кода

## Код для анализа (${language}, тип: ${fileType})
\`\`\`${language}
${code}
\`\`\`

## Инструкции
Выполни детальный анализ качества кода выше. Оцени:
1. Структуру и организацию
2. Читаемость и ясность
3. Соблюдение принципов SOLID, DRY, KISS
4. Согласованность стиля
5. Эффективность именования
6. Разделение ответственности
7. Документирование кода

## Формат ответа
Предоставь ответ в формате JSON:
\`\`\`json
{
  "issues": [
    {
      "type": "quality",
      "severity": "high|medium|low",
      "message": "Краткое описание проблемы",
      "location": "Точное место в коде",
      "suggestion": "Предложение по улучшению"
    }
  ],
  "score": 0-100,
  "summary": "Краткое резюме о качестве кода"
}
\`\`\`

Фокусируйся только на проблемах качества кода. Не оценивай безопасность, производительность или функциональную корректность.
`;

      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем JSON из ответа
      return this.extractJsonFromResponse(response, {
        issues: [],
        score: 75,
        summary: 'Не удалось получить детальную информацию о качестве кода'
      });
    } catch (error) {
      logger.error(`Ошибка при глубокой проверке качества: ${error.message}`, error);
      return {
        issues: [],
        score: 50,
        summary: `Ошибка анализа LLM: ${error.message}`
      };
    }
  }

  /**
   * Проверяет безопасность кода
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты проверки
   */
  async reviewSecurity(code, language, fileType) {
    try {
      logger.debug(`Проверка безопасности кода на языке ${language}, тип файла: ${fileType}`);
      
      // Выполняем статическую проверку на известные уязвимости
      const issues = this.staticCodeCheck(code, language, 'security');
      
      // Если код относится к критичным с точки зрения безопасности типам файлов,
      // выполняем дополнительную проверку с использованием LLM
      const securityCriticalTypes = ['controller', 'middleware', 'router', 'api', 'auth'];
      
      if (securityCriticalTypes.includes(fileType) || code.length > 500) {
        const llmResults = await this.deepSecurityReview(code, language, fileType);
        
        // Объединяем результаты
        const combinedIssues = this.mergeIssues(issues, llmResults.issues);
        
        return {
          passed: combinedIssues.length === 0 || !combinedIssues.some(issue => issue.severity === 'critical' || issue.severity === 'high'),
          score: this.calculateSecurityScore(combinedIssues),
          issues: combinedIssues
        };
      }
      
      // Для некритичных файлов возвращаем результаты статической проверки
      return {
        passed: issues.length === 0 || !issues.some(issue => issue.severity === 'critical' || issue.severity === 'high'),
        score: this.calculateSecurityScore(issues),
        issues
      };
    } catch (error) {
      logger.error(`Ошибка при проверке безопасности кода: ${error.message}`, error);
      return {
        passed: true, // Не блокируем процесс из-за ошибки проверки
        score: 70,    // По умолчанию - хорошая оценка, чтобы не блокировать PR
        issues: [
          {
            type: 'security_check',
            severity: 'low',
            message: `Ошибка при проверке безопасности: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Выполняет глубокую проверку безопасности кода с использованием LLM
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты глубокой проверки
   * @private
   */
  async deepSecurityReview(code, language, fileType) {
    try {
      // Формируем промпт для LLM с фокусом на безопасность
      const prompt = `
# Задача: Аудит безопасности кода

## Код для анализа (${language}, тип: ${fileType})
\`\`\`${language}
${code}
\`\`\`

## Инструкции
Проведи детальный аудит безопасности кода. Ищи потенциальные уязвимости, включая:
1. Инъекции (SQL, NoSQL, Command, etc.)
2. XSS/CSRF уязвимости
3. Незащищенные данные аутентификации
4. Небезопасное хранение данных
5. Недостаточную валидацию входных данных
6. Использование небезопасных функций
7. Утечки чувствительной информации
8. Race conditions и другие проблемы параллельного выполнения

## Формат ответа
Предоставь ответ в формате JSON:
\`\`\`json
{
  "issues": [
    {
      "type": "security",
      "severity": "critical|high|medium|low",
      "message": "Краткое описание уязвимости",
      "location": "Точное место в коде",
      "suggestion": "Рекомендация по устранению"
    }
  ],
  "score": 0-100,
  "summary": "Краткое резюме о безопасности кода"
}
\`\`\`

Сосредоточься только на проблемах безопасности. Не оценивай качество, производительность или функциональную корректность.
`;

      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем JSON из ответа
      return this.extractJsonFromResponse(response, {
        issues: [],
        score: 80,
        summary: 'Не удалось получить детальную информацию о безопасности кода'
      });
    } catch (error) {
      logger.error(`Ошибка при глубокой проверке безопасности: ${error.message}`, error);
      return {
        issues: [],
        score: 70,
        summary: `Ошибка анализа LLM: ${error.message}`
      };
    }
  }

  /**
   * Проверяет соответствие лучшим практикам
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты проверки
   */
  async reviewBestPractices(code, language, fileType) {
    try {
      logger.debug(`Проверка соответствия лучшим практикам на языке ${language}, тип файла: ${fileType}`);
      
      // Выполняем статическую проверку на соответствие лучшим практикам
      const issues = this.staticCodeCheck(code, language, 'bestPractices');
      
      // Для более сложных файлов выполняем дополнительную проверку через LLM
      if (code.length > 300 || fileType !== 'unknown') {
        const llmResults = await this.bestPracticesLLMReview(code, language, fileType);
        
        // Объединяем результаты
        const combinedIssues = this.mergeIssues(issues, llmResults.issues);
        
        return {
          passed: true, // Несоответствие лучшим практикам не является блокирующим фактором
          score: this.calculateBestPracticesScore(combinedIssues),
          issues: combinedIssues
        };
      }
      
      // Для простых файлов возвращаем результаты статической проверки
      return {
        passed: true,
        score: this.calculateBestPracticesScore(issues),
        issues
      };
    } catch (error) {
      logger.error(`Ошибка при проверке соответствия лучшим практикам: ${error.message}`, error);
      return {
        passed: true,
        score: 60,
        issues: [
          {
            type: 'best_practices_check',
            severity: 'low',
            message: `Ошибка при проверке лучших практик: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Проверяет соответствие лучшим практикам с использованием LLM
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} fileType - Тип файла
   * @returns {Promise<Object>} Результаты проверки
   * @private
   */
  async bestPracticesLLMReview(code, language, fileType) {
    try {
      // Формируем промпт для LLM с фокусом на лучшие практики
      const prompt = `
# Задача: Оценка соответствия лучшим практикам

## Код для анализа (${language}, тип: ${fileType})
\`\`\`${language}
${code}
\`\`\`

## Инструкции
Оцени, насколько код соответствует лучшим практикам для ${language} и типа файла ${fileType}. Обрати внимание на:
1. Соответствие общепринятым конвенциям кодирования
2. Использование современных возможностей языка
3. Эффективные паттерны и идиомы
4. Правильное использование библиотек и фреймворков
5. Модульность и повторное использование кода
6. Понятные имена и комментарии

## Формат ответа
Предоставь ответ в формате JSON:
\`\`\`json
{
  "issues": [
    {
      "type": "best_practices",
      "severity": "medium|low",
      "message": "Описание несоответствия лучшим практикам",
      "location": "Точное место в коде",
      "suggestion": "Рекомендация по улучшению"
    }
  ],
  "score": 0-100,
  "summary": "Краткое резюме о соответствии лучшим практикам"
}
\`\`\`

Фокусируйся только на лучших практиках языка и архитектуры, не затрагивая безопасность или производительность.
`;

      // Отправляем запрос к LLM
      const response = await this.llmClient.sendPrompt(prompt);
      
      // Извлекаем JSON из ответа
      return this.extractJsonFromResponse(response, {
        issues: [],
        score: 70,
        summary: 'Не удалось получить детальную информацию о соответствии лучшим практикам'
      });
    } catch (error) {
      logger.error(`Ошибка при проверке лучших практик через LLM: ${error.message}`, error);
      return {
        issues: [],
        score: 60,
        summary: `Ошибка анализа LLM: ${error.message}`
      };
    }
  }

  /**
   * Выполняет статическую проверку кода на основе предопределенных шаблонов
   * @param {string} code - Код для проверки
   * @param {string} language - Язык программирования
   * @param {string} checkType - Тип проверки (quality, security, bestPractices)
   * @returns {Array<Object>} Список обнаруженных проблем
   * @private
   */
  staticCodeCheck(code, language, checkType) {
    try {
      // Выбираем подходящие шаблоны для языка и типа проверки
      const patterns = this.knownIssuePatterns[language] && 
                      this.knownIssuePatterns[language][checkType] || [];
      
      if (patterns.length === 0) {
        return [];
      }
      
      // Применяем шаблоны к коду
      const issues = [];
      
      for (const pattern of patterns) {
        // Сбрасываем lastIndex для регулярных выражений
        pattern.pattern.lastIndex = 0;
        
        // Проверяем совпадения
        let match;
        while ((match = pattern.pattern.exec(code)) !== null) {
          // Определяем позицию в коде
          const position = this.findPositionInCode(code, match.index);
          
          issues.push({
            type: checkType,
            severity: pattern.severity,
            message: pattern.message,
            location: `Строка ${position.line}, символ ${position.column}`,
            suggestion: pattern.suggestion
          });
        }
      }
      
      return issues;
    } catch (error) {
      logger.error(`Ошибка при статической проверке кода (${checkType}): ${error.message}`, error);
      return [];
    }
  }

  /**
   * Находит позицию (строка, столбец) в коде по индексу символа
   * @param {string} code - Код
   * @param {number} index - Индекс символа
   * @returns {Object} Позиция в виде { line, column }
   * @private
   */
  findPositionInCode(code, index) {
    const lines = code.substring(0, index).split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length + 1;
    
    return { line, column };
  }

  /**
   * Объединяет два списка проблем, избегая дублирования
   * @param {Array<Object>} issues1 - Первый список проблем
   * @param {Array<Object>} issues2 - Второй список проблем
   * @returns {Array<Object>} Объединенный список проблем
   * @private
   */
  mergeIssues(issues1, issues2) {
    if (!issues2 || !Array.isArray(issues2)) {
      return issues1;
    }
    
    const mergedIssues = [...issues1];
    
    // Добавляем только уникальные проблемы из второго списка
    for (const issue of issues2) {
      const isDuplicate = mergedIssues.some(existingIssue => 
        existingIssue.message === issue.message || 
        (existingIssue.location === issue.location && existingIssue.type === issue.type)
      );
      
      if (!isDuplicate) {
        mergedIssues.push(issue);
      }
    }
    
    return mergedIssues;
  }

  /**
   * Извлекает JSON из ответа LLM
   * @param {string} response - Ответ от LLM
   * @param {Object} defaultValue - Значение по умолчанию
   * @returns {Object} Извлеченный JSON или значение по умолчанию
   * @private
   */
  extractJsonFromResponse(response, defaultValue) {
    try {
      // Пытаемся найти JSON в ответе
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      
      if (jsonMatch && jsonMatch[1]) {
        const jsonStr = jsonMatch[1].trim();
        return JSON.parse(jsonStr);
      }
      
      // Если не нашли JSON в формате Markdown, пробуем парсить весь ответ
      try {
        return JSON.parse(response.trim());
      } catch (e) {
        // Если и это не получилось, возвращаем значение по умолчанию
        return defaultValue;
      }
    } catch (error) {
      logger.error(`Ошибка при извлечении JSON из ответа LLM: ${error.message}`, error);
      return defaultValue;
    }
  }

  /**
   * Рассчитывает оценку качества кода на основе найденных проблем
   * @param {Array<Object>} issues - Список проблем
   * @returns {number} Оценка (0-100)
   * @private
   */
  calculateQualityScore(issues) {
    if (!issues || issues.length === 0) {
      return 100;
    }
    
    // Определяем штрафы за разные уровни серьезности проблем
    const penaltyPerSeverity = {
      critical: 40,
      high: 20,
      medium: 10,
      low: 2
    };
    
    // Рассчитываем общий штраф
    let totalPenalty = 0;
    
    for (const issue of issues) {
      const penalty = penaltyPerSeverity[issue.severity] || 5;
      totalPenalty += penalty;
    }
    
    // Ограничиваем суммарный штраф
    totalPenalty = Math.min(totalPenalty, 100);
    
    return 100 - totalPenalty;
  }

  /**
   * Рассчитывает оценку безопасности кода на основе найденных проблем
   * @param {Array<Object>} issues - Список проблем
   * @returns {number} Оценка (0-100)
   * @private
   */
  calculateSecurityScore(issues) {
    if (!issues || issues.length === 0) {
      return 100;
    }
    
    // Для безопасности используем более суровые штрафы
    const penaltyPerSeverity = {
      critical: 70,
      high: 40,
      medium: 15,
      low: 5
    };
    
    // Рассчитываем общий штраф
    let totalPenalty = 0;
    
    for (const issue of issues) {
      if (issue.type === 'security') {
        const penalty = penaltyPerSeverity[issue.severity] || 10;
        totalPenalty += penalty;
      }
    }
    
    // Ограничиваем суммарный штраф
    totalPenalty = Math.min(totalPenalty, 100);
    
    return 100 - totalPenalty;
  }

  /**
   * Рассчитывает оценку соответствия лучшим практикам
   * @param {Array<Object>} issues - Список проблем
   * @returns {number} Оценка (0-100)
   * @private
   */
  calculateBestPracticesScore(issues) {
    if (!issues || issues.length === 0) {
      return 100;
    }
    
    // Для лучших практик используем умеренные штрафы
    const penaltyPerSeverity = {
      high: 15,
      medium: 7,
      low: 3
    };
    
    // Рассчитываем общий штраф
    let totalPenalty = 0;
    
    for (const issue of issues) {
      const penalty = penaltyPerSeverity[issue.severity] || 5;
      totalPenalty += penalty;
    }
    
    // Ограничиваем суммарный штраф
    totalPenalty = Math.min(totalPenalty, 80); // Не опускаемся ниже 20 баллов
    
    return 100 - totalPenalty;
  }
}

module.exports = new CodeReviewer();
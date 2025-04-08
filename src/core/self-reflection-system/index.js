// src/core/self-reflection-system/index.js

const logger = require('../../utils/logger');
const { getLLMClient } = require('../../utils/llm-client');
const codeValidator = require('../../utils/code-validator');
const codeReviewer = require('./code-reviewer');
const CodeGeneration = require('../../models/code-generation.model');

/**
 * Класс для самопроверки и анализа генерируемого кода
 */
class SelfReflectionSystem {
  constructor() {
    this.llmClient = getLLMClient();
  }

  /**
   * Выполняет самопроверку сгенерированного кода
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<Object>} Результаты самопроверки
   */
  async performSelfReflection(generationId) {
    try {
      logger.info(`Начало самопроверки для генерации #${generationId}`);

      // Получаем данные о генерации кода
      const generation = await this.getCodeGeneration(generationId);
      if (!generation) {
        throw new Error(`Генерация кода #${generationId} не найдена`);
      }

      // Запускаем несколько проверок параллельно
      const [
        validationResult,
        qualityReview,
        securityReview,
        bestPracticesReview
      ] = await Promise.all([
        this.validateCode(generation),
        this.reviewCodeQuality(generation),
        this.reviewCodeSecurity(generation),
        this.reviewBestPractices(generation)
      ]);

      // Собираем результаты всех проверок
      const allIssues = [
        ...validationResult.issues,
        ...qualityReview.issues,
        ...securityReview.issues,
        ...bestPracticesReview.issues
      ];

      // Определяем общий результат
      const hasCriticalIssues = allIssues.some(issue => issue.severity === 'critical');
      const hasHighIssues = allIssues.some(issue => issue.severity === 'high');
      
      const overallResult = {
        generationId,
        passed: !hasCriticalIssues,
        needsAttention: hasHighIssues,
        score: this.calculateOverallScore([
          validationResult, 
          qualityReview, 
          securityReview, 
          bestPracticesReview
        ]),
        summary: this.generateSummary(allIssues),
        details: {
          validation: validationResult,
          quality: qualityReview,
          security: securityReview,
          bestPractices: bestPracticesReview
        },
        allIssues: allIssues,
        timestamp: new Date().toISOString()
      };

      // Сохраняем результаты проверки
      await this.saveReflectionResults(generationId, overallResult);

      logger.info(`Завершена самопроверка для генерации #${generationId}`);
      return overallResult;
    } catch (error) {
      logger.error(`Ошибка при самопроверке для генерации #${generationId}:`, error);
      throw error;
    }
  }

  /**
   * Получает информацию о генерации кода
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<Object>} Данные о генерации
   * @private
   */
  async getCodeGeneration(generationId) {
    try {
      const generation = await CodeGeneration.findByPk(generationId);
      
      if (!generation) {
        logger.warn(`Генерация кода с ID ${generationId} не найдена`);
        return null;
      }
      
      return {
        id: generation.id,
        taskId: generation.task_id,
        filePath: generation.file_path,
        fileType: this.detectFileType(generation.file_path),
        language: generation.language || this.detectLanguageFromFilePath(generation.file_path),
        originalContent: generation.original_content,
        generatedContent: generation.generated_content,
        status: generation.status
      };
    } catch (error) {
      logger.error(`Ошибка при получении данных о генерации #${generationId}:`, error);
      throw error;
    }
  }

  /**
   * Выполняет валидацию кода
   * @param {Object} generation - Данные о генерации кода
   * @returns {Promise<Object>} Результаты валидации
   * @private
   */
  async validateCode(generation) {
    try {
      logger.debug(`Валидация кода для файла ${generation.filePath}`);
      
      // Используем внешний валидатор кода
      const validationResult = await codeValidator.validate(
        generation.generatedContent, 
        generation.language
      );
      
      // Преобразуем результат в единый формат
      const issues = validationResult.isValid ? [] : [
        {
          type: 'validation',
          severity: 'critical',
          message: validationResult.error || 'Код не прошел валидацию',
          location: 'unknown'
        }
      ];
      
      return {
        passed: validationResult.isValid,
        score: validationResult.isValid ? 100 : 0,
        issues
      };
    } catch (error) {
      logger.error(`Ошибка при валидации кода для файла ${generation.filePath}:`, error);
      return {
        passed: false,
        score: 0,
        issues: [
          {
            type: 'validation',
            severity: 'critical',
            message: `Ошибка валидации: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Проверяет качество кода с помощью code-reviewer
   * @param {Object} generation - Данные о генерации кода
   * @returns {Promise<Object>} Результаты проверки качества
   * @private
   */
  async reviewCodeQuality(generation) {
    try {
      logger.debug(`Проверка качества кода для файла ${generation.filePath}`);
      
      const reviewResult = await codeReviewer.reviewQuality(
        generation.generatedContent,
        generation.language,
        generation.fileType
      );
      
      return reviewResult;
    } catch (error) {
      logger.error(`Ошибка при проверке качества кода для файла ${generation.filePath}:`, error);
      return {
        passed: true, // Не считаем проблемой качества критической ошибкой
        score: 50,    // Средний балл по умолчанию
        issues: [
          {
            type: 'quality',
            severity: 'low',
            message: `Невозможно выполнить проверку качества: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Проверяет безопасность кода
   * @param {Object} generation - Данные о генерации кода
   * @returns {Promise<Object>} Результаты проверки безопасности
   * @private
   */
  async reviewCodeSecurity(generation) {
    try {
      logger.debug(`Проверка безопасности кода для файла ${generation.filePath}`);
      
      return await codeReviewer.reviewSecurity(
        generation.generatedContent,
        generation.language,
        generation.fileType
      );
    } catch (error) {
      logger.error(`Ошибка при проверке безопасности кода для файла ${generation.filePath}:`, error);
      return {
        passed: true, // Не считаем проблему безопасности критической ошибкой по умолчанию
        score: 50,    // Средний балл по умолчанию
        issues: [
          {
            type: 'security',
            severity: 'medium',
            message: `Невозможно выполнить проверку безопасности: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Проверяет соответствие лучшим практикам
   * @param {Object} generation - Данные о генерации кода
   * @returns {Promise<Object>} Результаты проверки
   * @private
   */
  async reviewBestPractices(generation) {
    try {
      logger.debug(`Проверка соответствия лучшим практикам для файла ${generation.filePath}`);
      
      return await codeReviewer.reviewBestPractices(
        generation.generatedContent,
        generation.language,
        generation.fileType
      );
    } catch (error) {
      logger.error(`Ошибка при проверке соответствия лучшим практикам для файла ${generation.filePath}:`, error);
      return {
        passed: true, // Не считаем проблему с лучшими практиками критической ошибкой
        score: 50,    // Средний балл по умолчанию
        issues: [
          {
            type: 'best_practices',
            severity: 'low',
            message: `Невозможно выполнить проверку лучших практик: ${error.message}`,
            location: 'unknown'
          }
        ]
      };
    }
  }

  /**
   * Рассчитывает общую оценку качества кода
   * @param {Array<Object>} reviews - Результаты всех проверок
   * @returns {number} Общая оценка (0-100)
   * @private
   */
  calculateOverallScore(reviews) {
    if (!reviews || reviews.length === 0) {
      return 0;
    }

    // Распределение весов по типам проверок
    const weights = {
      validation: 0.4,    // 40% - валидность кода критически важна
      quality: 0.25,      // 25% - качество кода
      security: 0.25,     // 25% - безопасность кода
      bestPractices: 0.1  // 10% - соответствие лучшим практикам
    };

    // Вычисляем взвешенную сумму
    let totalScore = 0;
    let totalWeight = 0;

    const reviewTypes = ['validation', 'quality', 'security', 'bestPractices'];
    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i];
      const type = reviewTypes[i] || 'other';
      const weight = weights[type] || 0.1;
      
      totalScore += review.score * weight;
      totalWeight += weight;
    }

    // Нормализуем на случай, если не все типы проверок представлены
    return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
  }

  /**
   * Генерирует текстовое резюме по обнаруженным проблемам
   * @param {Array<Object>} issues - Список проблем
   * @returns {string} Текстовое резюме
   * @private
   */
  generateSummary(issues) {
    if (!issues || issues.length === 0) {
      return 'Код успешно прошел все проверки. Проблем не обнаружено.';
    }

    // Группируем проблемы по типу и серьезности
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    const highIssues = issues.filter(issue => issue.severity === 'high');
    const mediumIssues = issues.filter(issue => issue.severity === 'medium');
    const lowIssues = issues.filter(issue => issue.severity === 'low');

    // Формируем резюме
    const summaryParts = [];

    if (criticalIssues.length > 0) {
      summaryParts.push(`Обнаружены критические проблемы (${criticalIssues.length}), которые необходимо исправить перед созданием PR.`);
    }

    if (highIssues.length > 0) {
      summaryParts.push(`Обнаружены серьезные проблемы (${highIssues.length}), требующие внимания.`);
    }

    if (mediumIssues.length > 0) {
      summaryParts.push(`Обнаружены проблемы средней важности (${mediumIssues.length}), рекомендуется рассмотреть.`);
    }

    if (lowIssues.length > 0) {
      summaryParts.push(`Обнаружены незначительные проблемы (${lowIssues.length}), которые можно игнорировать.`);
    }

    // Добавляем общую оценку
    const totalIssues = issues.length;
    if (criticalIssues.length === 0 && highIssues.length === 0) {
      if (mediumIssues.length === 0 && lowIssues.length === 0) {
        summaryParts.push('Код высокого качества, проблем не обнаружено.');
      } else {
        summaryParts.push(`Код приемлемого качества с ${totalIssues} незначительными проблемами.`);
      }
    } else {
      summaryParts.push(`Всего обнаружено ${totalIssues} проблем различной важности.`);
    }

    return summaryParts.join(' ');
  }

  /**
   * Сохраняет результаты самопроверки в БД
   * @param {number} generationId - ID генерации кода
   * @param {Object} results - Результаты самопроверки
   * @returns {Promise<void>}
   * @private
   */
  async saveReflectionResults(generationId, results) {
    try {
      // Обновляем запись в таблице code_generations
      await CodeGeneration.update(
        {
          reflection_results: JSON.stringify(results),
          reflection_score: results.score,
          reflection_passed: results.passed,
          reflection_timestamp: results.timestamp
        },
        { where: { id: generationId } }
      );

      logger.debug(`Сохранены результаты самопроверки для генерации #${generationId}`);
    } catch (error) {
      logger.error(`Ошибка при сохранении результатов самопроверки для генерации #${generationId}:`, error);
      // Не пробрасываем ошибку дальше, так как сохранение результатов не должно прерывать основной процесс
    }
  }

  /**
   * Определяет тип файла на основе пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} Тип файла
   * @private
   */
  detectFileType(filePath) {
    if (!filePath) return 'unknown';
    
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    
    if (fileName.includes('Controller')) return 'controller';
    if (fileName.includes('Service')) return 'service';
    if (fileName.includes('Model')) return 'model';
    if (fileName.includes('Repository')) return 'repository';
    if (fileName.includes('Component')) return 'component';
    if (fileName.includes('middleware')) return 'middleware';
    if (fileName.includes('util') || fileName.includes('Utils')) return 'utility';
    if (fileName.includes('config')) return 'configuration';
    if (fileName.includes('test') || fileName.includes('Test')) return 'test';
    if (fileName.includes('router') || fileName.includes('Router') || fileName.includes('routes')) return 'router';
    
    // Определение по пути
    if (filePath.includes('/controllers/')) return 'controller';
    if (filePath.includes('/services/')) return 'service';
    if (filePath.includes('/models/')) return 'model';
    if (filePath.includes('/repositories/')) return 'repository';
    if (filePath.includes('/components/')) return 'component';
    if (filePath.includes('/middleware/')) return 'middleware';
    if (filePath.includes('/utils/') || filePath.includes('/helpers/')) return 'utility';
    if (filePath.includes('/config/')) return 'configuration';
    if (filePath.includes('/tests/') || filePath.includes('/__tests__/')) return 'test';
    if (filePath.includes('/routes/') || filePath.includes('/routers/')) return 'router';
    
    // Определение по расширению
    const extension = fileName.split('.').pop().toLowerCase();
    if (extension === 'jsx' || extension === 'tsx') return 'component';
    if (extension === 'css' || extension === 'scss' || extension === 'less') return 'stylesheet';
    if (extension === 'html') return 'html';
    if (extension === 'json') return 'configuration';
    if (extension === 'md') return 'documentation';
    
    return 'unknown';
  }

  /**
   * Определяет язык программирования на основе пути к файлу
   * @param {string} filePath - Путь к файлу
   * @returns {string} Язык программирования
   * @private
   */
  detectLanguageFromFilePath(filePath) {
    if (!filePath) return 'javascript';
    
    const extension = filePath.split('.').pop().toLowerCase();
    
    const extensionToLanguage = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'rs': 'rust',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sql': 'sql',
      'sh': 'bash'
    };
    
    return extensionToLanguage[extension] || extension;
  }

  /**
   * Выполняет интерактивную самопроверку с запросом к LLM
   * @param {number} generationId - ID генерации кода
   * @returns {Promise<Object>} Результаты интерактивной самопроверки
   */
  async performInteractiveSelfReflection(generationId) {
    try {
      logger.info(`Начало интерактивной самопроверки для генерации #${generationId}`);

      // Получаем данные о генерации кода
      const generation = await this.getCodeGeneration(generationId);
      if (!generation) {
        throw new Error(`Генерация кода #${generationId} не найдена`);
      }

      // Запускаем стандартные проверки
      const standardResults = await this.performSelfReflection(generationId);
      
      // Если стандартные проверки не выявили проблем, не тратим токены на LLM
      if (standardResults.passed && standardResults.score >= 80) {
        logger.info(`Стандартные проверки прошли успешно для генерации #${generationId}, пропускаем проверку LLM`);
        return standardResults;
      }

      // Формируем промпт для LLM
      const prompt = this.createSelfReflectionPrompt(generation, standardResults);
      
      // Отправляем запрос к LLM
      const llmResponse = await this.llmClient.sendPrompt(prompt);
      
      // Парсим результаты
      const llmReview = this.parseLLMResponse(llmResponse);
      
      // Объединяем результаты
      const combinedResults = {
        ...standardResults,
        llmReview,
        hasCombinedResults: true
      };

      // Обновляем запись в БД
      await this.saveReflectionResults(generationId, combinedResults);
      
      logger.info(`Завершена интерактивная самопроверка для генерации #${generationId}`);
      return combinedResults;
    } catch (error) {
      logger.error(`Ошибка при интерактивной самопроверке для генерации #${generationId}:`, error);
      throw error;
    }
  }

  /**
   * Создает промпт для самопроверки с использованием LLM
   * @param {Object} generation - Данные о генерации кода
   * @param {Object} standardResults - Результаты стандартных проверок
   * @returns {string} Промпт для LLM
   * @private
   */
  createSelfReflectionPrompt(generation, standardResults) {
    return `
# Самопроверка сгенерированного кода

## Код для проверки
\`\`\`${generation.language}
${generation.generatedContent}
\`\`\`

## Тип файла
${generation.fileType}

## Результаты автоматических проверок
${JSON.stringify(standardResults, null, 2)}

## Задача
Выполни тщательную проверку кода выше как опытный разработчик. Обрати внимание на следующие аспекты:

1. Качество кода: стиль, читаемость, поддерживаемость, использование хороших практик
2. Корректность: правильность логики, обработка ошибок, пограничные случаи
3. Производительность: возможные оптимизации, узкие места
4. Безопасность: уязвимости или потенциальные проблемы безопасности
5. Соответствие стандартам языка ${generation.language} и лучшим практикам

## Формат ответа
Предоставь результаты в JSON формате:
\`\`\`json
{
  "issues": [
    {
      "type": "string", // качество, корректность, производительность, безопасность и т.д.
      "severity": "string", // critical, high, medium, low
      "message": "string", // подробное описание проблемы
      "location": "string", // местоположение в коде (строка, функция и т.д.)
      "suggestion": "string" // предложение по исправлению
    }
  ],
  "score": 0-100, // общая оценка качества кода
  "passed": boolean, // проходит ли код минимальные требования
  "summary": "string", // краткое резюме проверки
  "recommendations": ["string"] // список рекомендаций по улучшению
}
\`\`\`

Обрати особое внимание на проблемы, которые могли быть не выявлены автоматическими проверками.
`;
  }

  /**
   * Парсит ответ от LLM
   * @param {string} response - Ответ от LLM
   * @returns {Object} Структурированный результат проверки
   * @private
   */
  parseLLMResponse(response) {
    try {
      // Пытаемся извлечь JSON из ответа
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      
      if (jsonMatch && jsonMatch[1]) {
        return JSON.parse(jsonMatch[1]);
      }
      
      // Если не получилось извлечь JSON, ищем структурированные данные в тексте
      const fallbackResult = {
        issues: [],
        score: 50,
        passed: true,
        summary: 'Не удалось извлечь структурированные данные из ответа LLM.',
        recommendations: []
      };
      
      // Пытаемся извлечь проблемы из текста
      const issueRegex = /(?:проблема|issue):\s*([^\n]+)/gi;
      const issues = [];
      let match;
      
      while ((match = issueRegex.exec(response)) !== null) {
        issues.push({
          type: 'quality',
          severity: 'medium',
          message: match[1],
          location: 'unknown',
          suggestion: 'Исправьте указанную проблему'
        });
      }
      
      if (issues.length > 0) {
        fallbackResult.issues = issues;
        fallbackResult.summary = `Найдено ${issues.length} проблем в коде.`;
      }
      
      // Оцениваем общее качество
      if (response.includes('низкое качество') || response.includes('серьезные проблемы')) {
        fallbackResult.score = 30;
        fallbackResult.passed = false;
      } else if (response.includes('хорошее качество') || response.includes('высокое качество')) {
        fallbackResult.score = 80;
      }
      
      return fallbackResult;
    } catch (error) {
      logger.error('Ошибка при парсинге ответа LLM:', error);
      return {
        issues: [
          {
            type: 'parser',
            severity: 'medium',
            message: `Не удалось разобрать ответ LLM: ${error.message}`,
            location: 'unknown',
            suggestion: 'Попробуйте запустить самопроверку еще раз'
          }
        ],
        score: 50,
        passed: true,
        summary: 'Произошла ошибка при обработке ответа модели.',
        recommendations: ['Повторите самопроверку с использованием стандартных инструментов.']
      };
    }
  }
}

module.exports = new SelfReflectionSystem();
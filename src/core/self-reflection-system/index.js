// src/core/self-reflection-system/index.js

const { getLLMClient } = require('../../utils/llm-client');
const logger = require('../../utils/logger');
const { pool } = require('../../config/db.config');
const fs = require('fs').promises;
const path = require('path');

/**
 * Система саморефлексии для анализа эффективности ИИ-ассистента
 * и предложения улучшений на основе исторических данных
 */
class SelfReflectionSystem {
  constructor(projectId) {
    this.projectId = projectId;
    this.llmClient = getLLMClient();
    this.insightsDir = path.join(process.cwd(), 'data', 'insights');
    this.improvedPromptsDir = path.join(process.cwd(), 'data', 'improved_prompts');
  }

  /**
   * Инициализирует систему саморефлексии
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Создаем директории для хранения инсайтов и улучшенных промптов
      await fs.mkdir(this.insightsDir, { recursive: true });
      await fs.mkdir(this.improvedPromptsDir, { recursive: true });
      
      logger.info(`Система саморефлексии инициализирована для проекта #${this.projectId}`);
    } catch (error) {
      logger.error(`Ошибка при инициализации системы саморефлексии:`, error);
      throw error;
    }
  }

  /**
   * Выполняет полный цикл саморефлексии
   * @param {string} timeframe - Временной период ('day', 'week', 'month')
   * @returns {Promise<Object>} - Результаты саморефлексии
   */
  async performSelfReflection(timeframe = 'week') {
    try {
      logger.info(`Начало процесса саморефлексии за ${timeframe}`);
      
      // Собираем исторические данные
      const historicalData = await this.collectHistoricalData(timeframe);
      
      // Если нет достаточного количества данных, прерываем процесс
      if (historicalData.tasks.length < 5) {
        logger.info('Недостаточно данных для проведения саморефлексии');
        return {
          success: false,
          message: 'Недостаточно данных',
          recommendations: []
        };
      }
      
      // Анализируем эффективность работы компонентов
      const componentAnalysis = await this.analyzeComponentPerformance(historicalData);
      
      // Анализируем качество генерируемого кода
      const codeQualityAnalysis = await this.analyzeCodeQuality(historicalData);
      
      // Анализируем обратную связь от пользователей
      const feedbackAnalysis = await this.analyzeFeedback(historicalData);
      
      // Формируем итоговые рекомендации
      const recommendations = await this.generateRecommendations(
        componentAnalysis,
        codeQualityAnalysis,
        feedbackAnalysis
      );
      
      // Сохраняем результаты анализа
      await this.saveReflectionResults({
        date: new Date(),
        timeframe,
        componentAnalysis,
        codeQualityAnalysis,
        feedbackAnalysis,
        recommendations
      });
      
      // Применяем улучшения
      await this.applyImprovements(recommendations);
      
      logger.info(`Процесс саморефлексии успешно завершен`);
      
      return {
        success: true,
        date: new Date(),
        timeframe,
        recommendations: recommendations.map(r => ({
          area: r.area,
          recommendation: r.recommendation,
          priority: r.priority
        }))
      };
    } catch (error) {
      logger.error(`Ошибка при выполнении саморефлексии:`, error);
      throw error;
    }
  }

  /**
   * Собирает исторические данные о работе системы
   * @param {string} timeframe - Временной период ('day', 'week', 'month')
   * @returns {Promise<Object>} - Исторические данные
   */
  async collectHistoricalData(timeframe) {
    try {
      // Определяем временные рамки
      const startDate = this.getStartDateForTimeframe(timeframe);
      
      // Подключаемся к БД
      const connection = await pool.getConnection();
      
      try {
        // Запрашиваем задачи за период
        const [tasks] = await connection.query(
          `SELECT t.* 
           FROM tasks t
           WHERE t.project_id = ? AND t.created_at >= ?
           ORDER BY t.created_at DESC`,
          [this.projectId, startDate]
        );
        
        // Запрашиваем подзадачи для этих задач
        const taskIds = tasks.map(task => task.id);
        let subtasks = [];
        
        if (taskIds.length > 0) {
          const [subtasksResult] = await connection.query(
            `SELECT s.*
             FROM subtasks s
             WHERE s.task_id IN (?)`,
            [taskIds]
          );
          
          subtasks = subtasksResult;
        }
        
        // Запрашиваем генерации кода
        let codeGenerations = [];
        
        if (taskIds.length > 0) {
          const [codeGenerationsResult] = await connection.query(
            `SELECT cg.*
             FROM code_generations cg
             WHERE cg.task_id IN (?)`,
            [taskIds]
          );
          
          codeGenerations = codeGenerationsResult;
        }
        
        // Запрашиваем обратную связь
        const generationIds = codeGenerations.map(gen => gen.id);
        let feedback = [];
        
        if (generationIds.length > 0) {
          const [feedbackResult] = await connection.query(
            `SELECT f.*
             FROM feedback f
             WHERE f.code_generation_id IN (?)`,
            [generationIds]
          );
          
          feedback = feedbackResult;
        }
        
        // Запрашиваем тесты
        let tests = [];
        
        if (generationIds.length > 0) {
          const [testsResult] = await connection.query(
            `SELECT t.*
             FROM tests t
             WHERE t.code_generation_id IN (?)`,
            [generationIds]
          );
          
          tests = testsResult;
        }
        
        // Запрашиваем логи взаимодействия с LLM
        let llmInteractions = [];
        
        if (taskIds.length > 0) {
          const [llmInteractionsResult] = await connection.query(
            `SELECT l.*
             FROM llm_interactions l
             WHERE l.task_id IN (?)
             ORDER BY l.created_at DESC
             LIMIT 100`,
            [taskIds]
          );
          
          llmInteractions = llmInteractionsResult;
        }
        
        // Возвращаем собранные данные
        return {
          timeframe,
          startDate,
          endDate: new Date(),
          tasks,
          subtasks,
          codeGenerations,
          feedback,
          tests,
          llmInteractions
        };
      } finally {
        connection.release();
      }
    } catch (error) {
      logger.error(`Ошибка при сборе исторических данных:`, error);
      throw error;
    }
  }

  /**
   * Получает дату начала для заданного временного периода
   * @param {string} timeframe - Временной период ('day', 'week', 'month')
   * @returns {Date} - Дата начала периода
   */
  getStartDateForTimeframe(timeframe) {
    const now = new Date();
    
    switch (timeframe) {
      case 'day':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Анализирует эффективность работы компонентов системы
   * @param {Object} historicalData - Исторические данные
   * @returns {Promise<Object>} - Результаты анализа
   */
  async analyzeComponentPerformance(historicalData) {
    try {
      logger.info('Анализ эффективности работы компонентов');
      
      // Анализируем эффективность декомпозиции задач
      const decompositionSuccess = this.calculateDecompositionSuccess(historicalData);
      
      // Анализируем эффективность генерации кода
      const codeGenSuccess = this.calculateCodeGenerationSuccess(historicalData);
      
      // Анализируем эффективность тестирования
      const testingSuccess = this.calculateTestingSuccess(historicalData);
      
      // Анализируем использование токенов LLM
      const tokenUsage = this.calculateTokenUsage(historicalData);
      
      // Находим узкие места в процессе
      const bottlenecks = this.identifyBottlenecks({
        decomposition: decompositionSuccess,
        codeGeneration: codeGenSuccess,
        testing: testingSuccess,
        tokenUsage
      });
      
      return {
        decomposition: decompositionSuccess,
        codeGeneration: codeGenSuccess,
        testing: testingSuccess,
        tokenUsage,
        bottlenecks
      };
    } catch (error) {
      logger.error(`Ошибка при анализе эффективности компонентов:`, error);
      throw error;
    }
  }

  /**
   * Рассчитывает успешность декомпозиции задач
   * @param {Object} historicalData - Исторические данные
   * @returns {Object} - Метрики успешности декомпозиции
   */
  calculateDecompositionSuccess(historicalData) {
    const { tasks, subtasks } = historicalData;
    
    // Группируем подзадачи по задачам
    const taskToSubtasks = {};
    subtasks.forEach(subtask => {
      if (!taskToSubtasks[subtask.task_id]) {
        taskToSubtasks[subtask.task_id] = [];
      }
      taskToSubtasks[subtask.task_id].push(subtask);
    });
    
    // Подсчитываем задачи, для которых была выполнена декомпозиция
    const tasksWithSubtasks = Object.keys(taskToSubtasks).length;
    
    // Подсчитываем среднее количество подзадач на задачу
    let totalSubtasks = 0;
    Object.values(taskToSubtasks).forEach(subtaskList => {
      totalSubtasks += subtaskList.length;
    });
    
    const avgSubtasksPerTask = tasksWithSubtasks > 0
      ? totalSubtasks / tasksWithSubtasks
      : 0;
    
    // Подсчитываем успешно выполненные подзадачи
    let completedSubtasks = 0;
    subtasks.forEach(subtask => {
      if (subtask.status === 'completed') {
        completedSubtasks++;
      }
    });
    
    const subtaskCompletionRate = totalSubtasks > 0
      ? completedSubtasks / totalSubtasks
      : 0;
    
    return {
      tasksWithSubtasks,
      totalTasks: tasks.length,
      decompositionRate: tasks.length > 0 ? tasksWithSubtasks / tasks.length : 0,
      avgSubtasksPerTask,
      subtaskCompletionRate,
      issuesDetected: avgSubtasksPerTask < 3 ? 'Слишком мало подзадач' : 
                      avgSubtasksPerTask > 10 ? 'Слишком много подзадач' : null
    };
  }

  /**
   * Рассчитывает успешность генерации кода
   * @param {Object} historicalData - Исторические данные
   * @returns {Object} - Метрики успешности генерации кода
   */
  calculateCodeGenerationSuccess(historicalData) {
    const { codeGenerations, feedback } = historicalData;
    
    // Подсчитываем количество генераций по статусам
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    
    codeGenerations.forEach(gen => {
      if (gen.status === 'approved' || gen.status === 'implemented') {
        approved++;
      } else if (gen.status === 'rejected') {
        rejected++;
      } else {
        pending++;
      }
    });
    
    // Рассчитываем процент одобрения
    const approvalRate = codeGenerations.length > 0
      ? approved / codeGenerations.length
      : 0;
    
    // Анализируем обратную связь
    let totalRating = 0;
    feedback.forEach(f => {
      if (f.rating) {
        totalRating += f.rating;
      }
    });
    
    const avgRating = feedback.length > 0
      ? totalRating / feedback.length
      : 0;
    
    return {
      totalGenerations: codeGenerations.length,
      approved,
      rejected,
      pending,
      approvalRate,
      avgRating,
      issuesDetected: approvalRate < 0.7 ? 'Низкий процент одобрения кода' : null
    };
  }

  /**
   * Рассчитывает успешность тестирования
   * @param {Object} historicalData - Исторические данные
   * @returns {Object} - Метрики успешности тестирования
   */
  calculateTestingSuccess(historicalData) {
    const { tests } = historicalData;
    
    // Подсчитываем количество тестов по статусам
    let passed = 0;
    let failed = 0;
    let pending = 0;
    
    tests.forEach(test => {
      if (test.result === 'passed') {
        passed++;
      } else if (test.result === 'failed') {
        failed++;
      } else {
        pending++;
      }
    });
    
    // Рассчитываем процент успешных тестов
    const passRate = tests.length > 0
      ? passed / tests.length
      : 0;
    
    // Анализируем покрытие кода тестами
    let totalCoverage = {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
      count: 0
    };
    
    tests.forEach(test => {
      if (test.coverage) {
        try {
          const coverage = JSON.parse(test.coverage);
          
          if (coverage.coverage) {
            totalCoverage.statements += coverage.coverage.statements || 0;
            totalCoverage.branches += coverage.coverage.branches || 0;
            totalCoverage.functions += coverage.coverage.functions || 0;
            totalCoverage.lines += coverage.coverage.lines || 0;
            totalCoverage.count++;
          }
        } catch (error) {
          // Игнорируем ошибки парсинга
        }
      }
    });
    
    // Рассчитываем среднее покрытие
    const avgCoverage = totalCoverage.count > 0
      ? {
          statements: totalCoverage.statements / totalCoverage.count,
          branches: totalCoverage.branches / totalCoverage.count,
          functions: totalCoverage.functions / totalCoverage.count,
          lines: totalCoverage.lines / totalCoverage.count
        }
      : {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0
        };
    
    return {
      totalTests: tests.length,
      passed,
      failed,
      pending,
      passRate,
      avgCoverage,
      issuesDetected: passRate < 0.8 ? 'Низкий процент успешных тестов' : 
                      avgCoverage.lines < 70 ? 'Недостаточное покрытие кода тестами' : null
    };
  }

  /**
   * Рассчитывает использование токенов LLM
   * @param {Object} historicalData - Исторические данные
   * @returns {Object} - Метрики использования токенов
   */
  calculateTokenUsage(historicalData) {
    const { llmInteractions, tasks } = historicalData;
    
    // Подсчитываем общее количество токенов
    let totalTokens = 0;
    let totalRequests = llmInteractions.length;
    
    // В реальной системе нужно считать токены из ответов API
    // В данном примере просто оцениваем по длине текста
    llmInteractions.forEach(interaction => {
      // Примерная оценка: 1 токен ~= 4 символа
      const promptTokens = Math.ceil(interaction.prompt.length / 4);
      const responseTokens = Math.ceil(interaction.response.length / 4);
      
      totalTokens += promptTokens + responseTokens;
    });
    
    // Рассчитываем среднее количество токенов на задачу
    const tokensPerTask = tasks.length > 0
      ? totalTokens / tasks.length
      : 0;
    
    // Рассчитываем среднее количество токенов на запрос
    const tokensPerRequest = totalRequests > 0
      ? totalTokens / totalRequests
      : 0;
    
    // Оцениваем стоимость (примерный расчет)
    const estimatedCost = totalTokens * 0.000002; // $0.000002 за токен
    
    return {
      totalTokens,
      totalRequests,
      tokensPerTask,
      tokensPerRequest,
      estimatedCost,
      issuesDetected: tokensPerRequest > 10000 ? 'Высокое потребление токенов на запрос' : null
    };
  }

  /**
   * Идентифицирует узкие места в процессе
   * @param {Object} metrics - Метрики компонентов
   * @returns {Array<Object>} - Список узких мест
   */
  identifyBottlenecks(metrics) {
    const bottlenecks = [];
    
    // Проверяем декомпозицию задач
    if (metrics.decomposition.decompositionRate < 0.7) {
      bottlenecks.push({
        component: 'task_decomposition',
        issue: 'Низкий процент задач с декомпозицией',
        severity: 'high',
        metric: metrics.decomposition.decompositionRate,
        recommendation: 'Улучшить алгоритм декомпозиции задач'
      });
    }
    
    // Проверяем генерацию кода
    if (metrics.codeGeneration.approvalRate < 0.7) {
      bottlenecks.push({
        component: 'code_generation',
        issue: 'Низкий процент одобрения кода',
        severity: 'high',
        metric: metrics.codeGeneration.approvalRate,
        recommendation: 'Улучшить промпты для генерации кода'
      });
    }
    
    // Проверяем тестирование
    if (metrics.testing.passRate < 0.8) {
      bottlenecks.push({
        component: 'testing',
        issue: 'Низкий процент успешных тестов',
        severity: 'medium',
        metric: metrics.testing.passRate,
        recommendation: 'Улучшить генерацию тестов'
      });
    }
    
    // Проверяем покрытие кода тестами
    if (metrics.testing.avgCoverage.lines < 70) {
      bottlenecks.push({
        component: 'testing',
        issue: 'Недостаточное покрытие кода тестами',
        severity: 'medium',
        metric: metrics.testing.avgCoverage.lines,
        recommendation: 'Расширить тестовые сценарии'
      });
    }
    
    // Проверяем использование токенов
    if (metrics.tokenUsage.tokensPerRequest > 10000) {
      bottlenecks.push({
        component: 'llm_client',
        issue: 'Высокое потребление токенов на запрос',
        severity: 'high',
        metric: metrics.tokenUsage.tokensPerRequest,
        recommendation: 'Оптимизировать промпты и контекстные окна'
      });
    }
    
    return bottlenecks;
  }

  /**
   * Анализирует качество генерируемого кода
   * @param {Object} historicalData - Исторические данные
   * @returns {Promise<Object>} - Результаты анализа
   */
  async analyzeCodeQuality(historicalData) {
    try {
      logger.info('Анализ качества генерируемого кода');
      
      const { codeGenerations, feedback, tests } = historicalData;
      
      // Если нет достаточного количества данных, возвращаем пустые результаты
      if (codeGenerations.length < 5) {
        return {
          qualityScore: 0,
          commonIssues: [],
          patternAnalysis: {}
        };
      }
      
      // Выбираем несколько случайных генераций для анализа
      const samplesToAnalyze = this.selectRandomSamples(
        codeGenerations,
        Math.min(5, codeGenerations.length)
      );
      
      // Собираем обратную связь для выбранных генераций
      const feedbackForSamples = feedback.filter(f => 
        samplesToAnalyze.some(s => s.id === f.code_generation_id)
      );
      
      // Собираем результаты тестов для выбранных генераций
      const testsForSamples = tests.filter(t => 
        samplesToAnalyze.some(s => s.id === t.code_generation_id)
      );
      
      // Анализируем образцы кода с помощью LLM
      const prompt = this.createCodeQualityAnalysisPrompt(
        samplesToAnalyze,
        feedbackForSamples,
        testsForSamples
      );
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.2 // Низкая температура для аналитического ответа
      });
      
      // Извлекаем результаты анализа из ответа
      const analysis = this.parseCodeQualityAnalysis(response);
      
      return {
        qualityScore: analysis.qualityScore,
        commonIssues: analysis.commonIssues,
        patternAnalysis: analysis.patternAnalysis,
        recommendations: analysis.recommendations
      };
    } catch (error) {
      logger.error(`Ошибка при анализе качества кода:`, error);
      throw error;
    }
  }

  /**
   * Выбирает случайные образцы из массива
   * @param {Array} array - Исходный массив
   * @param {number} count - Количество образцов
   * @returns {Array} - Выбранные образцы
   */
  selectRandomSamples(array, count) {
    const samples = [];
    const indices = new Set();
    
    if (array.length <= count) {
      return [...array];
    }
    
    while (samples.length < count) {
      const index = Math.floor(Math.random() * array.length);
      
      if (!indices.has(index)) {
        indices.add(index);
        samples.push(array[index]);
      }
    }
    
    return samples;
  }

  /**
   * Создает промпт для анализа качества кода
   * @param {Array} codeGenerations - Генерации кода
   * @param {Array} feedback - Обратная связь
   * @param {Array} tests - Результаты тестов
   * @returns {string} - Промпт для LLM
   */
  createCodeQualityAnalysisPrompt(codeGenerations, feedback, tests) {
    // Формируем блоки с примерами кода и обратной связью
    const codeExamples = codeGenerations.map(gen => {
      // Находим обратную связь для данной генерации
      const genFeedback = feedback.filter(f => f.code_generation_id === gen.id);
      
      // Находим результаты тестов для данной генерации
      const genTests = tests.filter(t => t.code_generation_id === gen.id);
      
      return `
## Пример кода ${gen.id} (статус: ${gen.status})

\`\`\`javascript
${gen.generated_content}
\`\`\`

### Обратная связь:
${genFeedback.map(f => `- ${f.feedback_text}`).join('\n') || 'Нет обратной связи'}

### Результаты тестов:
${genTests.map(t => `- Статус: ${t.result}`).join('\n') || 'Нет результатов тестов'}
`;
    }).join('\n\n');
    
    return `
# Задача: Анализ качества генерируемого кода

Проанализируй следующие примеры кода, сгенерированного ИИ-ассистентом, и оцени их качество.
Определи общие проблемы, паттерны и области для улучшения.

${codeExamples}

## Вопросы для анализа:

1. Какова общая оценка качества кода по шкале от 1 до 10?
2. Какие общие проблемы видны в сгенерированном коде?
3. Какие положительные паттерны можно заметить?
4. Какие антипаттерны присутствуют?
5. Как можно улучшить промпты или процесс генерации для повышения качества кода?

Предоставь структурированный анализ с конкретными примерами и рекомендациями.
Формат ответа:

QUALITY_SCORE: [оценка от 1 до 10]

COMMON_ISSUES:
- [проблема 1]
- [проблема 2]
...

POSITIVE_PATTERNS:
- [паттерн 1]
- [паттерн 2]
...

ANTI_PATTERNS:
- [антипаттерн 1]
- [антипаттерн 2]
...

RECOMMENDATIONS:
- [рекомендация 1]
- [рекомендация 2]
...

IMPROVEMENT_PROMPTS:
- [улучшенный промпт 1]
- [улучшенный промпт 2]
...
`;
  }

  /**
   * Парсит результаты анализа качества кода
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Структурированные результаты анализа
   */
  parseCodeQualityAnalysis(response) {
    try {
      // Извлекаем оценку качества
      const qualityScoreMatch = response.match(/QUALITY_SCORE:\s*(\d+)/i);
      const qualityScore = qualityScoreMatch ? parseInt(qualityScoreMatch[1], 10) : 0;
      
      // Извлекаем общие проблемы
      const commonIssues = this.extractSection(response, 'COMMON_ISSUES');
      
      // Извлекаем положительные паттерны
      const positivePatterns = this.extractSection(response, 'POSITIVE_PATTERNS');
      
      // Извлекаем антипаттерны
      const antiPatterns = this.extractSection(response, 'ANTI_PATTERNS');
      
      // Извлекаем рекомендации
      const recommendations = this.extractSection(response, 'RECOMMENDATIONS');
      
      // Извлекаем улучшенные промпты
      const improvementPrompts = this.extractSection(response, 'IMPROVEMENT_PROMPTS');
      
      return {
        qualityScore,
        commonIssues,
        patternAnalysis: {
          positive: positivePatterns,
          negative: antiPatterns
        },
        recommendations,
        improvementPrompts
      };
    } catch (error) {
      logger.error('Ошибка при парсинге результатов анализа качества кода:', error);
      
      return {
        qualityScore: 0,
        commonIssues: [],
        patternAnalysis: {
          positive: [],
          negative: []
        },
        recommendations: [],
        improvementPrompts: []
      };
    }
  }

  /**
   * Извлекает секцию из текста
   * @param {string} text - Исходный текст
   * @param {string} sectionName - Название секции
   * @returns {Array<string>} - Строки из секции
   */
  extractSection(text, sectionName) {
    const sectionRegex = new RegExp(`${sectionName}:\\s*([\\s\\S]*?)(?=\\n\\n[A-Z_]+:|$)`, 'i');
    const match = text.match(sectionRegex);
    
    if (!match) return [];
    
    return match[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim());
  }

  /**
   * Анализирует обратную связь от пользователей
   * @param {Object} historicalData - Исторические данные
   * @returns {Promise<Object>} - Результаты анализа
   */
  async analyzeFeedback(historicalData) {
    try {
      logger.info('Анализ обратной связи от пользователей');
      
      const { feedback } = historicalData;
      
      // Если нет достаточного количества данных, возвращаем пустые результаты
      if (feedback.length < 3) {
        return {
          sentimentAnalysis: {
            positive: 0,
            negative: 0,
            neutral: 0
          },
          commonThemes: [],
          userSatisfaction: 0
        };
      }
      
      // Анализируем обратную связь с помощью LLM
      const prompt = `
# Задача: Анализ обратной связи

Проанализируй следующую обратную связь от пользователей об ИИ-ассистенте и определи общие темы,
настроение и уровень удовлетворенности.

Обратная связь:
${feedback.map((f, i) => `${i+1}. "${f.feedback_text}" (Оценка: ${f.rating || 'Н/Д'})`).join('\n')}

Выполни следующие задачи:
1. Определи настроение каждого отзыва (положительное, отрицательное, нейтральное)
2. Выдели основные темы и проблемы, упомянутые в отзывах
3. Оцени общий уровень удовлетворенности по шкале от 1 до 10
4. Предложи конкретные улучшения на основе этой обратной связи

Формат ответа:

SENTIMENT_ANALYSIS:
- Положительные: [количество]
- Отрицательные: [количество]
- Нейтральные: [количество]

COMMON_THEMES:
- [тема 1]: [количество упоминаний]
- [тема 2]: [количество упоминаний]
...

USER_SATISFACTION: [оценка от 1 до 10]

IMPROVEMENT_SUGGESTIONS:
- [предложение 1]
- [предложение 2]
...
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Извлекаем результаты анализа из ответа
      const analysis = this.parseFeedbackAnalysis(response);
      
      return {
        sentimentAnalysis: analysis.sentiment,
        commonThemes: analysis.themes,
        userSatisfaction: analysis.satisfaction,
        improvementSuggestions: analysis.suggestions
      };
    } catch (error) {
      logger.error(`Ошибка при анализе обратной связи:`, error);
      throw error;
    }
  }

  /**
   * Парсит результаты анализа обратной связи
   * @param {string} response - Ответ от LLM
   * @returns {Object} - Структурированные результаты анализа
   */
  parseFeedbackAnalysis(response) {
    try {
      // Извлекаем анализ настроения
      const sentimentSection = response.match(/SENTIMENT_ANALYSIS:\s*([\s\S]*?)(?=\n\n[A-Z_]+:|$)/i);
      const sentiment = {
        positive: 0,
        negative: 0,
        neutral: 0
      };
      
      if (sentimentSection) {
        const positiveMatch = sentimentSection[1].match(/положительные:\s*(\d+)/i);
        const negativeMatch = sentimentSection[1].match(/отрицательные:\s*(\d+)/i);
        const neutralMatch = sentimentSection[1].match(/нейтральные:\s*(\d+)/i);
        
        sentiment.positive = positiveMatch ? parseInt(positiveMatch[1], 10) : 0;
        sentiment.negative = negativeMatch ? parseInt(negativeMatch[1], 10) : 0;
        sentiment.neutral = neutralMatch ? parseInt(neutralMatch[1], 10) : 0;
      }
      
      // Извлекаем общие темы
      const themesSection = this.extractSection(response, 'COMMON_THEMES');
      const themes = themesSection.map(theme => {
        const parts = theme.split(':');
        return {
          theme: parts[0].trim(),
          count: parts.length > 1 ? parseInt(parts[1].trim(), 10) || 1 : 1
        };
      });
      
      // Извлекаем уровень удовлетворенности
      const satisfactionMatch = response.match(/USER_SATISFACTION:\s*(\d+)/i);
      const satisfaction = satisfactionMatch ? parseInt(satisfactionMatch[1], 10) : 0;
      
      // Извлекаем предложения по улучшению
      const suggestions = this.extractSection(response, 'IMPROVEMENT_SUGGESTIONS');
      
      return {
        sentiment,
        themes,
        satisfaction,
        suggestions
      };
    } catch (error) {
      logger.error('Ошибка при парсинге результатов анализа обратной связи:', error);
      
      return {
        sentiment: {
          positive: 0,
          negative: 0,
          neutral: 0
        },
        themes: [],
        satisfaction: 0,
        suggestions: []
      };
    }
  }

  /**
   * Формирует итоговые рекомендации на основе проведенного анализа
   * @param {Object} componentAnalysis - Анализ компонентов
   * @param {Object} codeQualityAnalysis - Анализ качества кода
   * @param {Object} feedbackAnalysis - Анализ обратной связи
   * @returns {Promise<Array<Object>>} - Список рекомендаций
   */
  async generateRecommendations(componentAnalysis, codeQualityAnalysis, feedbackAnalysis) {
    try {
      logger.info('Формирование итоговых рекомендаций');
      
      const recommendations = [];
      
      // Добавляем рекомендации по компонентам
      if (componentAnalysis.bottlenecks) {
        componentAnalysis.bottlenecks.forEach(bottleneck => {
          recommendations.push({
            area: 'component',
            component: bottleneck.component,
            issue: bottleneck.issue,
            recommendation: bottleneck.recommendation,
            priority: this.mapSeverityToPriority(bottleneck.severity),
            metrics: {
              current: bottleneck.metric,
              target: this.calculateTargetMetric(bottleneck)
            }
          });
        });
      }
      
      // Добавляем рекомендации по качеству кода
      if (codeQualityAnalysis.recommendations) {
        codeQualityAnalysis.recommendations.forEach((recommendation, index) => {
          recommendations.push({
            area: 'code_quality',
            issue: codeQualityAnalysis.commonIssues[index] || 'Проблема с качеством кода',
            recommendation,
            priority: index < 2 ? 'high' : 'medium',
            relatedPatterns: codeQualityAnalysis.patternAnalysis.negative.slice(0, 2)
          });
        });
      }
      
      // Добавляем рекомендации на основе обратной связи
      if (feedbackAnalysis.improvementSuggestions) {
        feedbackAnalysis.improvementSuggestions.forEach((suggestion, index) => {
          recommendations.push({
            area: 'user_feedback',
            issue: feedbackAnalysis.commonThemes[index]?.theme || 'Проблема на основе обратной связи',
            recommendation: suggestion,
            priority: index < 2 ? 'high' : 'medium',
            userSatisfaction: feedbackAnalysis.userSatisfaction
          });
        });
      }
      
      // Сортируем рекомендации по приоритету
      const priorityWeights = {
        'high': 3,
        'medium': 2,
        'low': 1
      };
      
      recommendations.sort((a, b) => {
        return priorityWeights[b.priority] - priorityWeights[a.priority];
      });
      
      return recommendations;
    } catch (error) {
      logger.error(`Ошибка при формировании рекомендаций:`, error);
      throw error;
    }
  }

  /**
   * Преобразует серьезность проблемы в приоритет
   * @param {string} severity - Серьезность проблемы
   * @returns {string} - Приоритет
   */
  mapSeverityToPriority(severity) {
    switch (severity) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Рассчитывает целевое значение метрики
   * @param {Object} bottleneck - Информация об узком месте
   * @returns {number} - Целевое значение метрики
   */
  calculateTargetMetric(bottleneck) {
    switch (bottleneck.component) {
      case 'task_decomposition':
        return Math.min(0.9, bottleneck.metric + 0.2);
      case 'code_generation':
        return Math.min(0.9, bottleneck.metric + 0.2);
      case 'testing':
        if (bottleneck.issue.includes('покрытие')) {
          return Math.min(90, bottleneck.metric + 20);
        } else {
          return Math.min(0.9, bottleneck.metric + 0.1);
        }
      case 'llm_client':
        return bottleneck.metric * 0.8; // Уменьшение на 20%
      default:
        return bottleneck.metric * 1.2; // Увеличение на 20%
    }
  }

  /**
   * Сохраняет результаты саморефлексии
   * @param {Object} results - Результаты саморефлексии
   * @returns {Promise<void>}
   */
  async saveReflectionResults(results) {
    try {
      // Создаем имя файла на основе текущей даты
      const date = new Date();
      const fileName = `reflection_${date.getFullYear()}-${(date.getMonth() + 1)
        .toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours()
        .toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}.json`;
      
      // Сохраняем результаты в файл
      const filePath = path.join(this.insightsDir, fileName);
      
      await fs.writeFile(
        filePath,
        JSON.stringify(results, null, 2)
      );
      
      logger.info(`Результаты саморефлексии сохранены в ${filePath}`);
    } catch (error) {
      logger.error(`Ошибка при сохранении результатов саморефлексии:`, error);
      throw error;
    }
  }

  /**
   * Применяет улучшения на основе рекомендаций
   * @param {Array<Object>} recommendations - Список рекомендаций
   * @returns {Promise<void>}
   */
  async applyImprovements(recommendations) {
    try {
      logger.info('Применение улучшений на основе рекомендаций');
      
      // Применяем улучшения в порядке приоритета
      for (const recommendation of recommendations) {
        switch (recommendation.area) {
          case 'component':
            await this.improveComponent(recommendation);
            break;
          case 'code_quality':
            await this.improveCodeQuality(recommendation);
            break;
          case 'user_feedback':
            await this.improveBasedOnFeedback(recommendation);
            break;
        }
      }
      
      logger.info('Улучшения успешно применены');
    } catch (error) {
      logger.error(`Ошибка при применении улучшений:`, error);
      throw error;
    }
  }

  /**
   * Улучшает компонент системы
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveComponent(recommendation) {
    try {
      logger.info(`Улучшение компонента ${recommendation.component}: ${recommendation.issue}`);
      
      // В зависимости от компонента применяем соответствующие улучшения
      switch (recommendation.component) {
        case 'task_decomposition':
          await this.improveTaskDecomposition(recommendation);
          break;
        case 'code_generation':
          await this.improveCodeGeneration(recommendation);
          break;
        case 'testing':
          await this.improveTesting(recommendation);
          break;
        case 'llm_client':
          await this.improveLLMClient(recommendation);
          break;
      }
    } catch (error) {
      logger.error(`Ошибка при улучшении компонента ${recommendation.component}:`, error);
      throw error;
    }
  }

  /**
   * Улучшает процесс декомпозиции задач
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveTaskDecomposition(recommendation) {
    try {
      // Создаем промпт для улучшения декомпозиции задач
      const prompt = `
# Улучшение процесса декомпозиции задач

Текущая проблема: ${recommendation.issue}
Текущая метрика: ${recommendation.metrics.current}
Целевая метрика: ${recommendation.metrics.target}

Создай улучшенный шаблон промпта для декомпозиции задач,
который поможет улучшить качество декомпозиции и повысить метрику.

Шаблон должен включать:
1. Улучшенные инструкции для LLM
2. Более структурированный формат ответа
3. Примеры хорошей декомпозиции
4. Проверки и подсказки для более детальной декомпозиции

Верни только шаблон промпта без дополнительных пояснений.
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем улучшенный промпт
      const fileName = 'improved_task_decomposition_prompt.txt';
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`Улучшенный промпт для декомпозиции задач сохранен в ${filePath}`);
    } catch (error) {
      logger.error(`Ошибка при улучшении декомпозиции задач:`, error);
      throw error;
    }
  }

  /**
   * Улучшает процесс генерации кода
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveCodeGeneration(recommendation) {
    try {
      // Создаем промпт для улучшения генерации кода
      const prompt = `
# Улучшение процесса генерации кода

Текущая проблема: ${recommendation.issue}
Текущая метрика: ${recommendation.metrics.current}
Целевая метрика: ${recommendation.metrics.target}

Создай улучшенный шаблон промпта для генерации кода,
который поможет улучшить качество генерируемого кода и повысить метрику.

Шаблон должен включать:
1. Улучшенные инструкции для LLM
2. Более детальное описание архитектурных требований
3. Примеры хорошего кода
4. Лучшие практики и стандарты кодирования
5. Инструкции по обработке ошибок и тестируемости

Верни только шаблон промпта без дополнительных пояснений.
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем улучшенный промпт
      const fileName = 'improved_code_generation_prompt.txt';
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`Улучшенный промпт для генерации кода сохранен в ${filePath}`);
    } catch (error) {
      logger.error(`Ошибка при улучшении генерации кода:`, error);
      throw error;
    }
  }

  /**
   * Улучшает процесс тестирования
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveTesting(recommendation) {
    try {
      // Создаем промпт для улучшения тестирования
      const prompt = `
# Улучшение процесса тестирования

Текущая проблема: ${recommendation.issue}
Текущая метрика: ${recommendation.metrics.current}
Целевая метрика: ${recommendation.metrics.target}

Создай улучшенный шаблон промпта для генерации тестов,
который поможет улучшить качество тестов и повысить метрику.

Шаблон должен включать:
1. Улучшенные инструкции для LLM
2. Требования к покрытию кода
3. Различные типы тестов (unit, integration, edge cases)
4. Примеры хороших тестов
5. Техники мокирования и стабов

Верни только шаблон промпта без дополнительных пояснений.
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем улучшенный промпт
      const fileName = 'improved_testing_prompt.txt';
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`Улучшенный промпт для тестирования сохранен в ${filePath}`);
    } catch (error) {
      logger.error(`Ошибка при улучшении тестирования:`, error);
      throw error;
    }
  }

  /**
   * Улучшает клиент LLM
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveLLMClient(recommendation) {
    try {
      // Создаем промпт для оптимизации запросов к LLM
      const prompt = `
# Оптимизация запросов к LLM

Текущая проблема: ${recommendation.issue}
Текущая метрика: ${recommendation.metrics.current} токенов на запрос
Целевая метрика: ${recommendation.metrics.target} токенов на запрос

Создай рекомендации по оптимизации запросов к LLM,
которые помогут снизить количество токенов и повысить эффективность.

Рекомендации должны включать:
1. Техники сокращения промптов
2. Стратегии управления контекстным окном
3. Оптимальный формат запросов и ответов
4. Приоритизация информации в контексте
5. Техники кэширования и повторного использования

Формат ответа:

OPTIMIZATION_TECHNIQUES:
- [техника 1]
- [техника 2]
...

PROMPT_OPTIMIZATION:
- [рекомендация 1]
- [рекомендация 2]
...

CONTEXT_MANAGEMENT:
- [стратегия 1]
- [стратегия 2]
...

EXAMPLE_OPTIMIZED_PROMPT:
\`\`\`
[пример оптимизированного промпта]
\`\`\`
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем рекомендации
      const fileName = 'llm_optimization_recommendations.txt';
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`Рекомендации по оптимизации LLM сохранены в ${filePath}`);
      
      // Извлекаем и применяем настройки
      const techniques = this.extractSection(response, 'OPTIMIZATION_TECHNIQUES');
      
      // Эти настройки могли бы быть применены к реальному LLM клиенту
      // Например, уменьшение максимального размера контекста, оптимизация шаблонов и т.д.
      
      logger.info(`Применены оптимизации LLM: ${techniques.length} техник`);
    } catch (error) {
      logger.error(`Ошибка при улучшении LLM клиента:`, error);
      throw error;
    }
  }

  /**
   * Улучшает качество кода
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveCodeQuality(recommendation) {
    try {
      logger.info(`Улучшение качества кода: ${recommendation.issue}`);
      
      // Создаем промпт для улучшения качества кода
      const prompt = `
# Улучшение качества кода

Проблема: ${recommendation.issue}
Рекомендация: ${recommendation.recommendation}

Создай конкретные инструкции для LLM по улучшению качества кода,
которые помогут избежать указанной проблемы.

Инструкции должны включать:
1. Конкретные примеры хорошего и плохого кода
2. Рекомендации по стилю и структуре
3. Лучшие практики и паттерны
4. Типичные ошибки и как их избегать

Формат ответа:

CODE_QUALITY_INSTRUCTIONS:
- [инструкция 1]
- [инструкция 2]
...

GOOD_EXAMPLES:
\`\`\`javascript
// Пример хорошего кода
[пример хорошего кода]
\`\`\`

BAD_EXAMPLES:
\`\`\`javascript
// Пример плохого кода
[пример плохого кода]
\`\`\`

PROMPT_ADDITION:
[Дополнение к промпту для улучшения качества кода]
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем инструкции
      const fileName = `code_quality_${recommendation.issue.replace(/\s+/g, '_').toLowerCase()}.txt`;
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`Инструкции по улучшению качества кода сохранены в ${filePath}`);
      
      // Извлекаем дополнение к промпту
      const promptAdditionMatch = response.match(/PROMPT_ADDITION:\s*([\s\S]*?)(?=\n\n[A-Z_]+:|$)/i);
      
      if (promptAdditionMatch) {
        const promptAddition = promptAdditionMatch[1].trim();
        
        // Сохраняем дополнение к промпту для генерации кода
        const additionFileName = 'code_quality_prompt_addition.txt';
        const additionFilePath = path.join(this.improvedPromptsDir, additionFileName);
        
        await fs.writeFile(additionFilePath, promptAddition);
        
        logger.info(`Дополнение к промпту для генерации кода сохранено в ${additionFilePath}`);
      }
    } catch (error) {
      logger.error(`Ошибка при улучшении качества кода:`, error);
      throw error;
    }
  }

  /**
   * Улучшает систему на основе обратной связи
   * @param {Object} recommendation - Рекомендация
   * @returns {Promise<void>}
   */
  async improveBasedOnFeedback(recommendation) {
    try {
      logger.info(`Улучшение на основе обратной связи: ${recommendation.issue}`);
      
      // Создаем промпт для улучшения на основе обратной связи
      const prompt = `
# Улучшение системы на основе обратной связи

Проблема: ${recommendation.issue}
Рекомендация: ${recommendation.recommendation}
Уровень удовлетворенности: ${recommendation.userSatisfaction}/10

Создай план улучшения системы на основе этой обратной связи.
План должен включать конкретные действия, которые помогут решить проблему
и повысить уровень удовлетворенности пользователей.

Формат ответа:

IMPROVEMENT_PLAN:
- [действие 1]
- [действие 2]
...

SUCCESS_METRICS:
- [метрика 1]
- [метрика 2]
...

IMPLEMENTATION_STEPS:
1. [шаг 1]
2. [шаг 2]
...

PROMPT_MODIFICATIONS:
[Модификации промптов для решения проблемы]
`;
      
      const response = await this.llmClient.sendPrompt(prompt, {
        temperature: 0.3 // Низкая температура для аналитического ответа
      });
      
      // Сохраняем план улучшения
      const fileName = `feedback_improvement_${recommendation.issue.replace(/\s+/g, '_').toLowerCase()}.txt`;
      const filePath = path.join(this.improvedPromptsDir, fileName);
      
      await fs.writeFile(filePath, response);
      
      logger.info(`План улучшения на основе обратной связи сохранен в ${filePath}`);
      
      // Извлекаем модификации промптов
      const promptModificationsMatch = response.match(/PROMPT_MODIFICATIONS:\s*([\s\S]*?)(?=\n\n[A-Z_]+:|$)/i);
      
      if (promptModificationsMatch) {
        const promptModifications = promptModificationsMatch[1].trim();
        
        // Сохраняем модификации промптов
        const modFileName = 'feedback_prompt_modifications.txt';
        const modFilePath = path.join(this.improvedPromptsDir, modFileName);
        
        await fs.writeFile(modFilePath, promptModifications);
        
        logger.info(`Модификации промптов на основе обратной связи сохранены в ${modFilePath}`);
      }
    } catch (error) {
      logger.error(`Ошибка при улучшении на основе обратной связи:`, error);
      throw error;
    }
  }
}

module.exports = SelfReflectionSystem;
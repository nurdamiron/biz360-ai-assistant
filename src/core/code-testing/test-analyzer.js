// src/core/code-testing/test-analyzer.js
const logger = require('../../utils/logger');
const llmClient = require('../../utils/llm-client');
const { getPromptTemplate } = require('../../utils/prompt-utils');

/**
 * Класс для анализа результатов тестирования
 */
class TestAnalyzer {
  /**
   * Анализирует результаты тестирования
   * @param {object} testResults - Результаты тестирования
   * @param {object} context - Контекст тестирования
   * @returns {Promise<object>} - Результаты анализа
   */
  async analyzeTestResults(testResults, context) {
    logger.info(`Analyzing test results for task ${context.taskId}, subtask ${context.subtaskId}`);
    
    try {
      // Если тесты успешны и нет ошибок, выполняем базовый анализ
      if (testResults.success && testResults.summary.failed === 0) {
        return {
          quality: 'good',
          issues: [],
          suggestions: [],
          coverage: {
            estimated: this.estimateCodeCoverage(testResults, context),
            adequate: true
          },
          summary: 'All tests passed successfully.'
        };
      }
      
      // Получаем шаблон промпта для анализа результатов тестирования
      const promptTemplate = await getPromptTemplate('test-results-analysis');
      
      // Формируем контекст для промпта
      const promptContext = {
        taskId: context.taskId,
        subtaskId: context.subtaskId,
        testResults: {
          success: testResults.success,
          summary: testResults.summary,
          tests: testResults.tests.slice(0, 10), // Ограничиваем количество тестов для промпта
          rawOutput: testResults.rawOutput.substring(0, 2000) // Ограничиваем длину вывода
        },
        generatedFiles: context.generatedFiles.map(file => ({
          path: file.path,
          content: file.content.substring(0, 1000) // Ограничиваем длину кода
        })),
        testFiles: context.testFiles.map(file => ({
          path: file.path,
          content: file.content.substring(0, 1000) // Ограничиваем длину кода
        }))
      };
      
      // Отправляем запрос к LLM
      const response = await llmClient.generateStructuredContent(
        promptTemplate,
        promptContext,
        { format: 'json' }
      );
      
      // Обрабатываем ответ
      let analysis = {};
      
      try {
        if (typeof response === 'string') {
          analysis = JSON.parse(response);
        } else {
          analysis = response;
        }
        
        // Добавляем оценку покрытия кода
        analysis.coverage = {
          estimated: this.estimateCodeCoverage(testResults, context),
          adequate: analysis.coverage ? analysis.coverage.adequate : (testResults.summary.total > 0)
        };
      } catch (parseError) {
        logger.error(`Error parsing LLM test analysis response: ${parseError.message}`, {
          error: parseError.stack,
          response
        });
        
        // Базовый анализ в случае ошибки
        analysis = {
          quality: testResults.success ? 'acceptable' : 'poor',
          issues: testResults.success ? [] : ['Tests failed'],
          suggestions: ['Review failing tests and fix the code accordingly'],
          coverage: {
            estimated: this.estimateCodeCoverage(testResults, context),
            adequate: testResults.summary.total > 0
          },
          summary: testResults.success ? 'Tests passed but analysis failed' : 'Tests failed and analysis failed'
        };
      }
      
      return analysis;
    } catch (error) {
      logger.error(`Error analyzing test results: ${error.message}`, {
        error: error.stack,
        taskId: context.taskId,
        subtaskId: context.subtaskId
      });
      
      // Базовый анализ в случае ошибки
      return {
        quality: testResults.success ? 'acceptable' : 'poor',
        issues: testResults.success ? [] : ['Tests failed'],
        suggestions: ['Review failing tests and fix the code accordingly'],
        coverage: {
          estimated: this.estimateCodeCoverage(testResults, context),
          adequate: testResults.summary.total > 0
        },
        summary: `Error during analysis: ${error.message}`
      };
    }
  }

  /**
   * Оценивает покрытие кода тестами
   * @param {object} testResults - Результаты тестирования
   * @param {object} context - Контекст тестирования
   * @returns {object} - Оценка покрытия
   */
  estimateCodeCoverage(testResults, context) {
    try {
      // Оцениваем покрытие на основе количества тестов и строк кода
      const totalLines = context.generatedFiles.reduce((sum, file) => {
        return sum + (file.content.match(/\n/g) || []).length + 1;
      }, 0);
      
      const totalTests = testResults.summary.total;
      
      // Простая эвристика: предполагаем, что каждый тест покрывает примерно 10 строк кода
      const estimatedCoveredLines = Math.min(totalLines, totalTests * 10);
      const estimatedPercentage = Math.round((estimatedCoveredLines / totalLines) * 100);
      
      return {
        percentage: estimatedPercentage,
        lines: {
          total: totalLines,
          covered: estimatedCoveredLines
        },
        tests: {
          total: totalTests,
          passed: testResults.summary.passed,
          failed: testResults.summary.failed,
          skipped: testResults.summary.skipped
        }
      };
    } catch (error) {
      logger.error(`Error estimating code coverage: ${error.message}`, {
        error: error.stack
      });
      
      // Базовая оценка в случае ошибки
      return {
        percentage: testResults.success ? 50 : 30,
        lines: {
          total: 100,
          covered: testResults.success ? 50 : 30
        },
        tests: {
          total: testResults.summary.total,
          passed: testResults.summary.passed,
          failed: testResults.summary.failed,
          skipped: testResults.summary.skipped
        }
      };
    }
  }
}

module.exports = new TestAnalyzer();

// src/config/testing.config.js
/**
 * Конфигурация для системы тестирования
 */
module.exports = {
  // Соответствие расширений файлов и языков программирования
  extensionToLanguage: {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'cs': 'csharp',
    'cpp': 'cpp',
    'c': 'c',
    'swift': 'swift',
    'kt': 'kotlin',
    'rs': 'rust'
  },
  
  // Директории для тестов для разных типов проектов
  testDirectories: {
    'node': 'tests',
    'javascript': 'tests',
    'typescript': 'tests',
    'python': 'tests',
    'java': 'src/test/java',
    'php': 'tests',
    'ruby': 'spec',
    'go': 'tests',
    'csharp': 'Tests',
    'cpp': 'tests',
    'c': 'tests',
    'swift': 'Tests',
    'kotlin': 'src/test/kotlin',
    'rust': 'tests'
  },
  
  // Фреймворки для тестирования для разных типов проектов
  testingFrameworks: {
    'node': 'jest',
    'javascript': 'jest',
    'typescript': 'jest',
    'python': 'pytest',
    'java': 'junit',
    'php': 'phpunit',
    'ruby': 'rspec',
    'go': 'go-test',
    'csharp': 'nunit',
    'cpp': 'googletest',
    'c': 'check',
    'swift': 'xctest',
    'kotlin': 'junit',
    'rust': 'rust-test'
  },
  
  // Расширения файлов тестов для разных типов проектов
  testExtensions: {
    'node': 'js',
    'javascript': 'js',
    'typescript': 'ts',
    'python': 'py',
    'java': 'java',
    'php': 'php',
    'ruby': 'rb',
    'go': 'go',
    'csharp': 'cs',
    'cpp': 'cpp',
    'c': 'c',
    'swift': 'swift',
    'kotlin': 'kt',
    'rust': 'rs'
  },
  
  // Команды для запуска тестов для разных типов проектов
  testCommands: {
    'node': 'npx jest',
    'javascript': 'npx jest',
    'typescript': 'npx jest',
    'python': 'python -m pytest',
    'java': './gradlew test',
    'php': 'vendor/bin/phpunit',
    'ruby': 'bundle exec rspec',
    'go': 'go test',
    'csharp': 'dotnet test',
    'cpp': 'ctest',
    'c': 'make test',
    'swift': 'swift test',
    'kotlin': './gradlew test',
    'rust': 'cargo test'
  }
};
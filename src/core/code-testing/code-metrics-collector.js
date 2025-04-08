// src/core/code-testing/code-metrics-collector.js
const logger = require('../../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Класс для сбора метрик кода
 */
class CodeMetricsCollector {
  /**
   * Сбор метрик кода
   * @param {object} params - Параметры сбора метрик
   * @param {Array} params.files - Файлы для анализа
   * @param {string} params.repoPath - Путь к репозиторию
   * @returns {Promise<object>} - Собранные метрики
   */
  async collectMetrics(params) {
    const { files, repoPath } = params;
    
    logger.info(`Collecting metrics for ${files.length} files`);
    
    try {
      // Собираем метрики для каждого файла
      const fileMetrics = await Promise.all(files.map(file => 
        this.collectFileMetrics(file)
      ));
      
      // Агрегируем метрики
      const totalMetrics = this.aggregateMetrics(fileMetrics);
      
      logger.info(`Metrics collection completed`);
      
      return {
        fileMetrics,
        totalMetrics
      };
    } catch (error) {
      logger.error(`Error collecting code metrics: ${error.message}`, {
        error: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Сбор метрик для отдельного файла
   * @param {object} file - Файл для анализа
   * @returns {Promise<object>} - Метрики файла
   */
  async collectFileMetrics(file) {
    logger.debug(`Collecting metrics for file ${file.path}`);
    
    try {
      const extension = path.extname(file.path).toLowerCase();
      const content = file.content;
      
      // Базовые метрики для всех файлов
      const metrics = {
        filePath: file.path,
        fileSize: content.length,
        lineCount: this.countLines(content),
        nonEmptyLineCount: this.countNonEmptyLines(content)
      };
      
      // Дополнительные метрики для исходного кода
      if (['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.php', '.rb'].includes(extension)) {
        Object.assign(metrics, {
          commentLineCount: this.countCommentLines(content, extension),
          functionCount: this.countFunctions(content, extension),
          complexityScore: this.calculateComplexity(content, extension),
          cyclomatic: this.calculateCyclomaticComplexity(content, extension),
          tokensCount: this.countTokens(content)
        });
      }
      
      return metrics;
    } catch (error) {
      logger.error(`Error collecting metrics for file ${file.path}: ${error.message}`, {
        error: error.stack
      });
      
      return {
        filePath: file.path,
        error: error.message
      };
    }
  }

  /**
   * Агрегация метрик нескольких файлов
   * @param {Array} fileMetrics - Метрики отдельных файлов
   * @returns {object} - Агрегированные метрики
   */
  aggregateMetrics(fileMetrics) {
    // Фильтруем файлы с ошибками
    const validMetrics = fileMetrics.filter(m => !m.error);
    
    // Базовые агрегированные метрики
    const aggregated = {
      totalFiles: validMetrics.length,
      totalErroredFiles: fileMetrics.length - validMetrics.length,
      totalSize: 0,
      totalLines: 0,
      totalNonEmptyLines: 0,
      averageFileSize: 0,
      averageLineCount: 0,
      maxFileSize: 0,
      maxLineCount: 0,
      largestFile: null
    };
    
    // Дополнительные метрики для исходного кода
    if (validMetrics.length > 0 && 'commentLineCount' in validMetrics[0]) {
      Object.assign(aggregated, {
        totalCommentLines: 0,
        totalFunctions: 0,
        averageComplexity: 0,
        averageCyclomatic: 0,
        commentRatio: 0,
        maxComplexity: 0,
        mostComplexFile: null
      });
    }
    
    // Суммируем метрики
    for (const metrics of validMetrics) {
      aggregated.totalSize += metrics.fileSize;
      aggregated.totalLines += metrics.lineCount;
      aggregated.totalNonEmptyLines += metrics.nonEmptyLineCount;
      
      if (metrics.fileSize > aggregated.maxFileSize) {
        aggregated.maxFileSize = metrics.fileSize;
        aggregated.largestFile = metrics.filePath;
      }
      
      if (metrics.lineCount > aggregated.maxLineCount) {
        aggregated.maxLineCount = metrics.lineCount;
      }
      
      // Дополнительные метрики для исходного кода
      if ('commentLineCount' in metrics) {
        aggregated.totalCommentLines += metrics.commentLineCount;
        aggregated.totalFunctions += metrics.functionCount;
        
        if (metrics.complexityScore > aggregated.maxComplexity) {
          aggregated.maxComplexity = metrics.complexityScore;
          aggregated.mostComplexFile = metrics.filePath;
        }
      }
    }
    
    // Вычисляем средние значения
    if (validMetrics.length > 0) {
      aggregated.averageFileSize = aggregated.totalSize / validMetrics.length;
      aggregated.averageLineCount = aggregated.totalLines / validMetrics.length;
      
      // Дополнительные метрики для исходного кода
      if ('commentLineCount' in validMetrics[0]) {
        aggregated.averageComplexity = validMetrics.reduce((sum, m) => sum + m.complexityScore, 0) / validMetrics.length;
        aggregated.averageCyclomatic = validMetrics.reduce((sum, m) => sum + m.cyclomatic, 0) / validMetrics.length;
        aggregated.commentRatio = aggregated.totalCommentLines / aggregated.totalLines;
      }
    }
    
    return aggregated;
  }

  /**
   * Подсчет количества строк в файле
   * @param {string} content - Содержимое файла
   * @returns {number} - Количество строк
   */
  countLines(content) {
    return content.split('\n').length;
  }

  /**
   * Подсчет количества непустых строк в файле
   * @param {string} content - Содержимое файла
   * @returns {number} - Количество непустых строк
   */
  countNonEmptyLines(content) {
    return content.split('\n').filter(line => line.trim().length > 0).length;
  }

  /**
   * Подсчет количества строк с комментариями
   * @param {string} content - Содержимое файла
   * @param {string} extension - Расширение файла
   * @returns {number} - Количество строк с комментариями
   */
  countCommentLines(content, extension) {
    // Разные регулярные выражения для разных языков программирования
    let commentRegex;
    
    if (['.js', '.jsx', '.ts', '.tsx', '.c', '.cpp', '.java', '.cs'].includes(extension)) {
      // Однострочные и многострочные комментарии в стиле C
      commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
    } else if (['.py'].includes(extension)) {
      // Однострочные комментарии Python
      commentRegex = /#.*$|'''[\s\S]*?'''|"""[\s\S]*?"""/gm;
    } else if (['.php'].includes(extension)) {
      // Комментарии PHP
      commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\/|#.*$/gm;
    } else if (['.rb'].includes(extension)) {
      // Комментарии Ruby
      commentRegex = /#.*$|=begin[\s\S]*?=end/gm;
    } else {
      // По умолчанию используем комментарии в стиле C
      commentRegex = /\/\/.*$|\/\*[\s\S]*?\*\//gm;
    }
    
    // Получаем все совпадения
    let matches = content.match(commentRegex) || [];
    
    // Считаем количество строк в многострочных комментариях
    let lineCount = 0;
    for (const match of matches) {
      lineCount += match.split('\n').length;
    }
    
    return lineCount;
  }

  /**
   * Подсчет количества функций в файле
   * @param {string} content - Содержимое файла
   * @param {string} extension - Расширение файла
   * @returns {number} - Количество функций
   */
  countFunctions(content, extension) {
    // Разные регулярные выражения для разных языков программирования
    let functionRegex;
    
    if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
      // Функции, методы и стрелочные функции в JavaScript/TypeScript
      functionRegex = /function\s+\w+\s*\(|(\w+|\[\w+\])\s*:\s*function\s*\(|(\w+)\s*\([^)]*\)\s*{|=>\s*{|\(\)\s*=>/g;
    } else if (['.py'].includes(extension)) {
      // Функции Python
      functionRegex = /def\s+\w+\s*\(/g;
    } else if (['.java'].includes(extension)) {
      // Методы Java
      functionRegex = /(\w+\s+)+\w+\s*\([^)]*\)\s*({|\s*throws)/g;
    } else if (['.c', '.cpp'].includes(extension)) {
      // Функции C/C++
      functionRegex = /(\w+\s+)+\w+\s*\([^;]*\)\s*({|$)/g;
    } else if (['.cs'].includes(extension)) {
      // Методы C#
      functionRegex = /(public|private|protected|internal|static)(\s+\w+)+\s*\([^;]*\)\s*({|$)/g;
    } else if (['.php'].includes(extension)) {
      // Функции PHP
      functionRegex = /function\s+\w+\s*\(/g;
    } else if (['.rb'].includes(extension)) {
      // Методы Ruby
      functionRegex = /def\s+\w+(\.|::)?\w*[?!]?\s*(\(|$)/g;
    } else {
      // По умолчанию ищем функции в стиле JavaScript
      functionRegex = /function\s+\w+\s*\(|(\w+)\s*\([^)]*\)\s*{/g;
    }
    
    // Получаем все совпадения
    const matches = content.match(functionRegex) || [];
    
    return matches.length;
  }

  /**
   * Расчет метрики сложности кода
   * @param {string} content - Содержимое файла
   * @param {string} extension - Расширение файла
   * @returns {number} - Оценка сложности кода
   */
  calculateComplexity(content, extension) {
    // Упрощенная метрика сложности кода
    // Основывается на:
    // 1. Длине файла
    // 2. Количестве функций
    // 3. Количестве условных операторов и циклов
    // 4. Количестве вложенных структур
    
    const lineCount = this.countLines(content);
    const functionCount = this.countFunctions(content, extension);
    
    // Регулярные выражения для поиска условных операторов и циклов
    let controlRegex;
    
    if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.php'].includes(extension)) {
      controlRegex = /if\s*\(|else\s*{|for\s*\(|while\s*\(|switch\s*\(|case\s+|try\s*{|catch\s*\(/g;
    } else if (['.py'].includes(extension)) {
      controlRegex = /if\s+|elif\s+|else:|for\s+|while\s+|try:|except\s+|with\s+/g;
    } else if (['.rb'].includes(extension)) {
      controlRegex = /if\s+|elsif\s+|else\s+|unless\s+|case\s+|when\s+|while\s+|until\s+|for\s+|begin\s+|rescue\s+/g;
    } else {
      controlRegex = /if\s*\(|else\s*{|for\s*\(|while\s*\(|switch\s*\(|case\s+|try\s*{|catch\s*\(/g;
    }
    
    // Подсчет количества управляющих структур
    const controlMatches = content.match(controlRegex) || [];
    const controlCount = controlMatches.length;
    
    // Подсчет вложенных уровней
    let maxNestingLevel = 0;
    let currentNestingLevel = 0;
    
    for (const char of content) {
      if (char === '{' || char === '(' || char === '[') {
        currentNestingLevel++;
        maxNestingLevel = Math.max(maxNestingLevel, currentNestingLevel);
      } else if (char === '}' || char === ')' || char === ']') {
        currentNestingLevel = Math.max(0, currentNestingLevel - 1);
      }
    }
    
    // Формула сложности
    // Нормализуем длину файла (1 балл за каждые 50 строк)
    const lengthScore = Math.ceil(lineCount / 50);
    
    // Функции (1 балл за каждые 2 функции)
    const functionScore = Math.ceil(functionCount / 2);
    
    // Управляющие структуры (1 балл за каждые 5 структур)
    const controlScore = Math.ceil(controlCount / 5);
    
    // Вложенность (2 балла за каждый уровень вложенности выше 3)
    const nestingScore = Math.max(0, (maxNestingLevel - 3) * 2);
    
    // Итоговая оценка сложности
    const complexityScore = lengthScore + functionScore + controlScore + nestingScore;
    
    return complexityScore;
  }

  /**
   * Расчет цикломатической сложности кода
   * @param {string} content - Содержимое файла
   * @param {string} extension - Расширение файла
   * @returns {number} - Оценка цикломатической сложности
   */
  calculateCyclomaticComplexity(content, extension) {
    // Цикломатическая сложность = E - N + 2P
    // E - количество рёбер в графе потока управления
    // N - количество узлов в графе потока управления
    // P - количество компонент связности (обычно 1 для функции)
    
    // Упрощенная формула: 1 + <количество точек ветвления>
    
    // Регулярные выражения для поиска точек ветвления
    let branchRegex;
    
    if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cpp', '.cs', '.php'].includes(extension)) {
      branchRegex = /if\s*\(|else\s+if|else|for\s*\(|while\s*\(|do\s*{|switch\s*\(|case\s+|catch\s*\(|&&|\|\||\?/g;
    } else if (['.py'].includes(extension)) {
      branchRegex = /if\s+|elif\s+|else:|for\s+|while\s+|except\s+|and\s+|or\s+/g;
    } else if (['.rb'].includes(extension)) {
      branchRegex = /if\s+|elsif\s+|else\s+|unless\s+|case\s+|when\s+|while\s+|until\s+|for\s+|rescue\s+|&&|\|\||and\s+|or\s+/g;
    } else {
      branchRegex = /if\s*\(|else\s+if|else|for\s*\(|while\s*\(|do\s*{|switch\s*\(|case\s+|catch\s*\(|&&|\|\||\?/g;
    }
    
    // Подсчет количества точек ветвления
    const branchMatches = content.match(branchRegex) || [];
    const branchCount = branchMatches.length;
    
    // Цикломатическая сложность = 1 + количество точек ветвления
    return 1 + branchCount;
  }

  /**
   * Подсчет токенов в коде
   * @param {string} content - Содержимое файла
   * @returns {number} - Количество токенов
   */
  countTokens(content) {
    // Упрощенный вариант - делим текст на токены
    // Токенами считаются слова, числа, операторы и пунктуация
    
    // Удаляем комментарии
    const withoutComments = content.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|#.*$|'''[\s\S]*?'''|"""[\s\S]*?"""/gm, '');
    
    // Удаляем строки
    const withoutStrings = withoutComments.replace(/'[^']*'|"[^"]*"/g, '');
    
    // Регулярное выражение для поиска токенов
    const tokenRegex = /\b\w+\b|[-+*/=<>!&|^~%]+|[{}()\[\],.;:?]/g;
    
    // Подсчет токенов
    const tokens = withoutStrings.match(tokenRegex) || [];
    
    return tokens.length;
  }
}

module.exports = new CodeMetricsCollector();
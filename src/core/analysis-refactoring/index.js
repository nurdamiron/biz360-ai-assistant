// src/core/analysis-refactoring/index.js

/**
 * Модуль для анализа и рефакторинга сгенерированного (или существующего) кода.
 *
 * Использует:
 *   - CodeValidator (ESLint) для статики.
 *   - Babel (AST) для структурного рефакторинга.
 */

const path = require('path');
const fs = require('fs').promises;
const { transformAsync } = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const CodeValidator = require('../code-generator/code-validator');
const logger = require('../../utils/logger');

/**
 * Класс AnalysisRefactoring
 *  - ESLint-валидатор (через CodeValidator)
 *  - Babel-трансформация (AST) для более глубокого рефакторинга
 */
class AnalysisRefactoring {
  constructor() {
    this.validator = new CodeValidator();
  }

  /**
   * Запуск полного анализа и рефакторинга кода:
   * 1. Прогон кода через ESLint (авто-фикс).
   * 2. Опционально AST-преобразования (для продвинутых рефакторингов).
   *
   * @param {string} code - Исходный код
   * @param {Object} [options] - Дополнительные настройки
   * @param {boolean} [options.useBabelRefactor=true] - Включать ли AST рефакторинг
   * @returns {Promise<{ refactoredCode: string, lintMessages: Array, astChanges: Array }>}
   */
  async runFullAnalysis(code, options = {}) {
    const { useBabelRefactor = true } = options;
    let refactoredCode = code;
    let lintMessages = [];
    let astChanges = [];

    // 1. ESLint авто-фикс
    const eslintResult = await this.runESLintFix(refactoredCode);
    refactoredCode = eslintResult.fixedCode;
    lintMessages = eslintResult.messages;

    // 2. Babel/AST рефакторинг (если нужно)
    if (useBabelRefactor) {
      const astResult = await this.runBabelRefactor(refactoredCode);
      refactoredCode = astResult.refactoredCode;
      astChanges = astResult.astChanges;
    }

    // Возвращаем итог
    return { refactoredCode, lintMessages, astChanges };
  }

  /**
   * Запускает встроенный в CodeValidator ESLint с опцией авто-фикс.
   * Возвращает исправленный код и список сообщений.
   *
   * @param {string} code - Исходный JS-код
   * @returns {Promise<{ fixedCode: string, messages: Array }>}
   */
  async runESLintFix(code) {
    // Создаём временную папку
    const tempDir = await this.validator.createTempDir();

    try {
      // Валидация (внутри CodeValidator уже вызывается ESLint в режиме fix)
      const result = await this.validator.validateWithESLint(code, tempDir);
      return {
        fixedCode: result.outputCode || code,
        messages: result.messages || []
      };
    } catch (error) {
      logger.error('Ошибка при запуске ESLint авто-фикса:', error);
      return { fixedCode: code, messages: [] };
    } finally {
      // Чистим временную директорию
      await this.validator.cleanupTempDir(tempDir);
    }
  }

  /**
 * Запускает Babel-трансформации для AST-рефакторинга.
 * Выполняет различные оптимизации кода на основе AST.
 *
 * @param {string} code - Исходный код
 * @returns {Promise<{refactoredCode: string, astChanges: Array}>}
 */
async runBabelRefactor(code) {
  try {
    // Парсим в AST
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'classProperties']
    });

    const astChanges = [];
    
    // Обходим AST
    traverse(ast, {
      // Обнаружение слишком длинных функций
      FunctionDeclaration(path) {
        const fnStart = path.node.loc.start.line;
        const fnEnd = path.node.loc.end.line;
        const fnLength = fnEnd - fnStart + 1;
        const fnName = path.node.id?.name || 'anonymous';

        if (fnLength > 100) {
          astChanges.push({
            type: 'LargeFunction',
            name: fnName,
            location: { start: fnStart, end: fnEnd },
            message: `Function ${fnName} is too long (${fnLength} lines). Consider breaking it down.`
          });
        }
      },
      
      // Проверка использования переменных
      VariableDeclarator(path) {
        const varName = path.node.id.name;
        const binding = path.scope.getBinding(varName);
        
        // Неиспользуемые переменные
        if (binding && binding.referenced === false) {
          astChanges.push({
            type: 'UnusedVariable',
            name: varName,
            location: {
              start: path.node.loc.start.line,
              end: path.node.loc.end.line
            },
            message: `Variable ${varName} is declared but never used.`
          });
        }
      },
      
      // Обнаружение глубокой вложенности if-условий
      IfStatement(path) {
        let currentPath = path;
        let depth = 1;
        let nestingChain = [];
        
        // Находим цепочку вложенных if-statements
        while (currentPath.get('consequent').get('body')[0]?.isIfStatement()) {
          const innerIfPath = currentPath.get('consequent').get('body')[0];
          nestingChain.push(innerIfPath.node.loc.start.line);
          currentPath = innerIfPath;
          depth++;
        }
        
        if (depth > 3) {
          astChanges.push({
            type: 'DeepNesting',
            location: {
              start: path.node.loc.start.line,
              nested: nestingChain
            },
            message: `Deep nesting of conditionals (depth ${depth}). Consider refactoring.`
          });
        }
      },
      
      // Идентификация жёстко закодированных значений (magic numbers)
      NumericLiteral(path) {
        // Игнорируем обычные числа: 0, 1, -1, 2, 100, и 1000
        const ignoredValues = [0, 1, -1, 2, 100, 1000];
        const value = path.node.value;
        
        if (!ignoredValues.includes(value) && 
            !path.parent.type.includes('Object') && // Не в объектных литералах
            !path.findParent(p => p.isVariableDeclarator())) { // Не в объявлениях переменных
          
          astChanges.push({
            type: 'MagicNumber',
            value: value,
            location: {
              start: path.node.loc.start.line,
              column: path.node.loc.start.column
            },
            message: `Magic number ${value} found. Consider using a named constant.`
          });
        }
      }
    });

    // Генерируем код обратно
    const output = generate(ast, {
      retainLines: false,
      compact: false,
      comments: true
    });

    return { refactoredCode: output.code, astChanges };
  } catch (error) {
    logger.error('Ошибка при Babel-рефакторинге:', error);
    // Если что-то пошло не так, возвращаем исходный код
    return { refactoredCode: code, astChanges: [] };
  }
}
}

module.exports = AnalysisRefactoring;

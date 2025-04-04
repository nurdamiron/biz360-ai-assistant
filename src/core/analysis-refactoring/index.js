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
   * Запускает Babel-трансформации, позволяющие делать AST-рефакторинг.
   * Пример показывает, как можно разбивать слишком большие функции и т.д.
   *
   * @param {string} code
   * @returns {Promise<{refactoredCode: string, astChanges: Array}>}
   */
  async runBabelRefactor(code) {
    try {
      // Парсим в AST
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties'] // Добавьте любые нужные плагины
      });

      const astChanges = [];
      // Обходим AST
      traverse(ast, {
        // Пример упрощённого рефакторинга:
        // Если найдём функцию > 100 строк, логируем предупреждение (либо делим на части - на ваше усмотрение).
        FunctionDeclaration(path) {
          const fnStart = path.node.loc.start.line;
          const fnEnd = path.node.loc.end.line;
          const fnLength = fnEnd - fnStart + 1;

          if (fnLength > 100) {
            astChanges.push({
              type: 'LargeFunction',
              message: `Function at lines ${fnStart}-${fnEnd} is too long (${fnLength} lines). Consider refactoring.`
            });
            // Здесь можно применить автоматический рефакторинг (разделение на подфункции), но это уже гораздо сложнее
          }
        },
      });

      // Генерируем код обратно
      const output = generate(ast, {
        retainLines: false,
        compact: false
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

// src/core/code-generator/code-extractor.js

const logger = require('../../utils/logger');

/**
 * Класс для извлечения кода из ответов LLM
 */
class CodeExtractor {
  /**
   * Извлекает код из ответа LLM с учетом языка программирования
   * @param {string} response - Ответ от LLM
   * @param {string} [language] - Ожидаемый язык программирования (опционально)
   * @param {Object} [options] - Дополнительные опции
   * @param {boolean} [options.includeComments=true] - Включать ли комментарии в извлеченный код
   * @param {boolean} [options.normalizeIndentation=true] - Нормализовать ли отступы
   * @param {boolean} [options.removePrologue=true] - Удалять ли вводный текст перед кодом
   * @returns {Object|null} - Объект с извлеченным кодом или null, если код не найден
   */
  extract(response, language = null, options = {}) {
    const defaultOptions = {
      includeComments: true,
      normalizeIndentation: true,
      removePrologue: true
    };

    const opts = { ...defaultOptions, ...options };
    
    try {
      // Если ответ пуст, возвращаем null
      if (!response || response.trim() === '') {
        logger.warn('Получен пустой ответ от LLM');
        return null;
      }

      // Определяем язык, если не указан
      const detectedLanguage = language || this._detectLanguage(response);
      
      // Извлекаем код разными методами и выбираем лучший результат
      const extractionMethods = [
        this._extractFromCodeBlocks,
        this._extractFromIndentation,
        this._extractUnstructured
      ];

      let bestExtraction = null;
      let bestQuality = -1;

      for (const method of extractionMethods) {
        const extraction = method.call(this, response, detectedLanguage);
        
        if (extraction && extraction.code) {
          const quality = this._assessExtractionQuality(extraction.code, detectedLanguage);
          
          if (quality > bestQuality) {
            bestQuality = quality;
            bestExtraction = extraction;
          }
        }
      }

      // Если ничего не нашли, возвращаем null
      if (!bestExtraction || !bestExtraction.code) {
        logger.warn('Не удалось извлечь код из ответа LLM');
        return null;
      }

      // Обрабатываем извлеченный код согласно опциям
      let processedCode = bestExtraction.code;
      
      if (opts.removePrologue) {
        processedCode = this._removePrologue(processedCode);
      }
      
      if (!opts.includeComments) {
        processedCode = this._removeComments(processedCode, detectedLanguage);
      }
      
      if (opts.normalizeIndentation) {
        processedCode = this._normalizeIndentation(processedCode);
      }

      return {
        code: processedCode,
        language: bestExtraction.language || detectedLanguage,
        quality: bestQuality,
        extractionMethod: bestExtraction.method
      };
    } catch (error) {
      logger.error(`Ошибка при извлечении кода: ${error.message}`, error);
      return null;
    }
  }

  /**
   * Извлекает код из блоков кода в формате Markdown (```code```)
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {Object|null} - Объект с извлеченным кодом или null, если код не найден
   * @private
   */
  _extractFromCodeBlocks(response, language) {
    try {
      // Регулярное выражение для поиска блоков кода в формате Markdown
      // Учитываем потенциальное указание языка после открывающих ```
      const languagePattern = language ? `(${language}|)` : '(\\w*)';
      const codeBlockRegex = new RegExp(`\`\`\`${languagePattern}\\s*([\\s\\S]*?)\\s*\`\`\``, 'gi');
      
      const codeBlocks = [];
      let match;
      
      while ((match = codeBlockRegex.exec(response)) !== null) {
        const blockLanguage = match[1] ? match[1].trim().toLowerCase() : language;
        const code = match[2].trim();
        
        if (code) {
          codeBlocks.push({
            language: blockLanguage,
            code,
            position: match.index
          });
        }
      }
      
      // Если нашли блоки кода
      if (codeBlocks.length > 0) {
        // Если указан язык, ищем совпадение сначала по языку
        const matchingLanguageBlock = language ? 
          codeBlocks.find(block => block.language === language) : null;
        
        if (matchingLanguageBlock) {
          return {
            code: matchingLanguageBlock.code,
            language: matchingLanguageBlock.language,
            method: 'codeBlock'
          };
        }
        
        // Иначе берем самый большой блок кода
        const largestBlock = codeBlocks.reduce((largest, current) => 
          current.code.length > largest.code.length ? current : largest, codeBlocks[0]);
        
        return {
          code: largestBlock.code,
          language: largestBlock.language,
          method: 'codeBlock'
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Ошибка при извлечении блоков кода: ${error.message}`, error);
      return null;
    }
  }

  /**
   * Извлекает код на основе отступов
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {Object|null} - Объект с извлеченным кодом или null, если код не найден
   * @private
   */
  _extractFromIndentation(response, language) {
    try {
      // Разбиваем текст на строки
      const lines = response.split('\n');
      
      // Ищем блоки с отступами (как минимум 4 последовательные строки с отступами)
      const indentedBlocks = [];
      let currentBlock = [];
      let inBlock = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isIndented = line.startsWith('    ') || line.startsWith('\t');
        
        if (isIndented || line.trim() === '') {
          if (!inBlock) {
            inBlock = true;
          }
          currentBlock.push(line);
        } else {
          if (inBlock && currentBlock.length >= 4) {
            // Проверяем, выглядит ли блок как код
            const blockText = currentBlock.join('\n');
            if (this._looksLikeCode(blockText, language)) {
              indentedBlocks.push(blockText);
            }
          }
          currentBlock = [];
          inBlock = false;
        }
      }
      
      // Проверяем последний блок
      if (inBlock && currentBlock.length >= 4) {
        const blockText = currentBlock.join('\n');
        if (this._looksLikeCode(blockText, language)) {
          indentedBlocks.push(blockText);
        }
      }
      
      // Если нашли блоки с отступами
      if (indentedBlocks.length > 0) {
        // Берем самый большой блок
        const largestBlock = indentedBlocks.reduce((largest, current) => 
          current.length > largest.length ? current : largest, indentedBlocks[0]);
        
        // Удаляем лишние отступы
        const normalizedCode = this._normalizeIndentation(largestBlock);
        
        return {
          code: normalizedCode,
          language: language,
          method: 'indentation'
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Ошибка при извлечении кода по отступам: ${error.message}`, error);
      return null;
    }
  }

  /**
   * Извлекает код из неструктурированного текста
   * @param {string} response - Ответ от LLM
   * @param {string} language - Ожидаемый язык программирования
   * @returns {Object|null} - Объект с извлеченным кодом или null, если код не найден
   * @private
   */
  _extractUnstructured(response, language) {
    try {
      // Удаляем вводные и заключительные фразы
      const cleanedResponse = this._removeNonCodeParts(response);
      
      // Проверяем, выглядит ли оставшийся текст как код
      if (this._looksLikeCode(cleanedResponse, language)) {
        return {
          code: cleanedResponse,
          language: language,
          method: 'unstructured'
        };
      }
      
      return null;
    } catch (error) {
      logger.error(`Ошибка при извлечении неструктурированного кода: ${error.message}`, error);
      return null;
    }
  }

  /**
   * Удаляет вводные и заключительные фразы из текста
   * @param {string} text - Исходный текст
   * @returns {string} - Очищенный текст
   * @private
   */
  _removeNonCodeParts(text) {
    let cleaned = text.trim();
    
    // Удаляем типичные вводные фразы
    const introPatterns = [
      /^(Here's|I've created|This is|Below is|The following is).*?\n/i,
      /^(Let me|I'll|I will|I would|I'd|I've created|I have created).*?\n/i,
      /^(Sure|Okay|OK|Certainly|Absolutely|Of course|Yes).*?\n/i
    ];
    
    for (const pattern of introPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    // Удаляем типичные заключительные фразы
    const outroPatterns = [
      /\n(This code|This implementation|This solution).*?$/i,
      /\n(Let me know|Feel free|I hope|Hope this|This should|If you have).*?$/i,
      /\n(You can|Now you can|This will|The code above).*?$/i
    ];
    
    for (const pattern of outroPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    return cleaned.trim();
  }

  /**
   * Удаляет прологовый текст (shebang, декларации, и т.д.) из кода
   * @param {string} code - Исходный код
   * @returns {string} - Код без пролога
   * @private
   */
  _removePrologue(code) {
    // Удаляем shebang (#!) и комментарии в начале файла
    const lines = code.split('\n');
    
    let firstNonCommentLine = 0;
    while (
      firstNonCommentLine < lines.length && (
        lines[firstNonCommentLine].trim().startsWith('#!') ||
        lines[firstNonCommentLine].trim().startsWith('//') ||
        lines[firstNonCommentLine].trim().startsWith('/*') ||
        lines[firstNonCommentLine].trim().startsWith('*') ||
        lines[firstNonCommentLine].trim().startsWith('#') ||
        lines[firstNonCommentLine].trim() === ''
      )
    ) {
      firstNonCommentLine++;
    }
    
    const withoutPrologue = lines.slice(firstNonCommentLine).join('\n');
    return withoutPrologue.trim();
  }

  /**
   * Удаляет комментарии из кода
   * @param {string} code - Исходный код
   * @param {string} language - Язык программирования
   * @returns {string} - Код без комментариев
   * @private
   */
  _removeComments(code, language) {
    let commentPattern;
    
    // Выбираем шаблон для удаления комментариев в зависимости от языка
    switch (language) {
      case 'python':
        // Python комментарии
        commentPattern = /#.*?$/gm;
        break;
      case 'html':
        // HTML комментарии
        commentPattern = /<!--[\s\S]*?-->/g;
        break;
      case 'css':
        // CSS комментарии
        commentPattern = /\/\*[\s\S]*?\*\//g;
        break;
      default:
        // JavaScript и другие C-подобные языки
        commentPattern = /\/\/.*?$|\/\*[\s\S]*?\*\//gm;
    }
    
    return code.replace(commentPattern, '');
  }

  /**
   * Нормализует отступы в коде
   * @param {string} code - Исходный код
   * @returns {string} - Код с нормализованными отступами
   * @private
   */
  _normalizeIndentation(code) {
    const lines = code.split('\n');
    
    // Пропускаем пустые строки в начале и в конце
    let start = 0;
    while (start < lines.length && lines[start].trim() === '') {
      start++;
    }
    
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') {
      end--;
    }
    
    if (start >= end) {
      return code.trim();
    }
    
    // Находим минимальный отступ среди непустых строк
    const indentSizes = lines
      .slice(start, end + 1)
      .filter(line => line.trim() !== '')
      .map(line => {
        const match = line.match(/^[ \t]*/)[0];
        return match.length;
      });
    
    const minIndent = Math.min(...indentSizes);
    
    // Удаляем минимальный отступ из всех строк
    const normalized = lines
      .slice(start, end + 1)
      .map(line => {
        if (line.trim() === '') {
          return '';
        }
        return line.substring(minIndent);
      })
      .join('\n');
    
    return normalized;
  }

  /**
   * Определяет язык программирования из ответа LLM
   * @param {string} response - Ответ от LLM
   * @returns {string|null} - Определенный язык программирования или null
   * @private
   */
  _detectLanguage(response) {
    // Ищем указание языка в блоке кода
    const languageInBlockMatch = response.match(/```(\w+)/);
    if (languageInBlockMatch && languageInBlockMatch[1]) {
      const detectedLanguage = languageInBlockMatch[1].toLowerCase();
      
      // Проверяем корректность языка
      if (this._isValidLanguage(detectedLanguage)) {
        return detectedLanguage;
      }
    }
    
    // Пытаемся определить язык по характерным признакам
    if (response.includes('def ') && response.includes(':')) {
      return 'python';
    }
    
    if (response.includes('function ') && (response.includes('{') || response.includes('=>'))) {
      return 'javascript';
    }
    
    if (response.includes('const ') || response.includes('let ') || response.includes('var ')) {
      return 'javascript';
    }
    
    if (response.includes('class ') && response.includes('extends ') && response.includes('{')){
      return 'javascript';
    }
    
    if (response.includes('import React') || response.includes('from "react"')) {
      return 'jsx';
    }
    
    if (response.includes('public class ') || response.includes('private class ')) {
      return 'java';
    }
    
    if (response.includes('#include ')) {
      return 'cpp';
    }
    
    if (response.includes('<?php')) {
      return 'php';
    }
    
    if (response.includes('<html') || response.includes('<!DOCTYPE html')) {
      return 'html';
    }
    
    if (response.includes('body {') || response.includes('@media ')) {
      return 'css';
    }
    
    // По умолчанию предполагаем JavaScript
    return 'javascript';
  }

  /**
   * Проверяет, является ли язык допустимым
   * @param {string} language - Язык для проверки
   * @returns {boolean} - true, если язык допустимый
   * @private
   */
  _isValidLanguage(language) {
    const validLanguages = [
      'javascript', 'js', 'typescript', 'ts',
      'python', 'py', 'java', 'c', 'cpp', 'c++',
      'csharp', 'cs', 'go', 'ruby', 'rb', 'php',
      'swift', 'kotlin', 'rust', 'html', 'css',
      'sql', 'bash', 'sh', 'json', 'xml', 'yaml',
      'jsx', 'tsx'
    ];
    
    return validLanguages.includes(language.toLowerCase());
  }

  /**
   * Определяет, похож ли текст на код
   * @param {string} text - Текст для проверки
   * @param {string} language - Предполагаемый язык программирования
   * @returns {boolean} - true, если текст похож на код
   * @private
   */
  _looksLikeCode(text, language) {
    if (!text || text.trim() === '') {
      return false;
    }
    
    const codeIndicators = {
      common: [
        /function\s+\w+\s*\(/,
        /class\s+\w+/,
        /import\s+.*?from/,
        /const\s+\w+\s*=/,
        /let\s+\w+\s*=/,
        /var\s+\w+\s*=/,
        /return\s+/,
        /if\s*\(/,
        /for\s*\(/,
        /while\s*\(/,
        /switch\s*\(/,
        /try\s*{/,
        /catch\s*\(/
      ],
      javascript: [
        /=>/,
        /\$\{.*?\}/,
        /\(\)\s*=>/,
        /export\s+(default\s+)?/,
        /module\.exports/,
        /require\(/
      ],
      python: [
        /def\s+\w+\s*\(/,
        /import\s+\w+/,
        /from\s+\w+\s+import/,
        /if\s+.*?:/,
        /for\s+.*?:/,
        /while\s+.*?:/,
        /class\s+.*?:/
      ],
      java: [
        /public\s+(static\s+)?\w+/,
        /private\s+(static\s+)?\w+/,
        /protected\s+(static\s+)?\w+/,
        /System\.out\.print/
      ],
      html: [
        /<html/,
        /<head/,
        /<body/,
        /<div/,
        /<script/,
        /<style/
      ],
      css: [
        /\s*{\s*/,
        /\s*}\s*/,
        /\w+\s*:\s*\w+/,
        /@media/,
        /@import/
      ]
    };
    
    // Проверяем общие индикаторы
    const hasCommonIndicators = codeIndicators.common.some(pattern => pattern.test(text));
    
    // Проверяем индикаторы конкретного языка
    const specificIndicators = codeIndicators[language] || [];
    const hasSpecificIndicators = specificIndicators.some(pattern => pattern.test(text));
    
    // Определяем процент строк с отступами (индикатор структурированного кода)
    const lines = text.split('\n');
    const indentedLines = lines.filter(line => 
      line.trim() !== '' && (line.startsWith('  ') || line.startsWith('\t'))
    );
    const indentedPercentage = indentedLines.length / lines.length;
    
    // Определяем процент строк с знаками пунктуации, характерными для кода
    const syntaxLines = lines.filter(line => 
      /[;{}()[\]=]/.test(line)
    );
    const syntaxPercentage = syntaxLines.length / lines.length;
    
    // Вычисляем общую оценку "похожести на код"
    return (
      (hasCommonIndicators || hasSpecificIndicators) &&
      (indentedPercentage > 0.3 || syntaxPercentage > 0.4)
    );
  }

  /**
   * Оценивает качество извлеченного кода
   * @param {string} code - Извлеченный код
   * @param {string} language - Язык программирования
   * @returns {number} - Оценка качества (от 0 до 100)
   * @private
   */
  _assessExtractionQuality(code, language) {
    if (!code || code.trim() === '') {
      return 0;
    }
    
    let score = 0;
    const lines = code.split('\n');
    
    // Оценка по длине кода
    score += Math.min(lines.length, 100) / 2; // До 50 баллов за длину
    
    // Оценка по структуре кода
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    
    if (openBraces === closeBraces && openBraces > 0) {
      score += 10; // Сбалансированные фигурные скобки
    }
    
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    
    if (openParens === closeParens && openParens > 0) {
      score += 10; // Сбалансированные круглые скобки
    }
    
    // Оценка по ключевым словам в зависимости от языка
    const codeKeywords = {
      javascript: ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'import', 'export'],
      python: ['def', 'class', 'import', 'if', 'else', 'for', 'while', 'return', 'try', 'except'],
      java: ['public', 'private', 'class', 'void', 'int', 'String', 'import', 'return'],
      typescript: ['interface', 'type', 'function', 'class', 'const', 'let', 'export', 'import'],
      html: ['html', 'head', 'body', 'div', 'span', 'script', 'style'],
      css: ['body', 'margin', 'padding', 'width', 'height', 'color', '@media']
    };
    
    const keywords = codeKeywords[language] || codeKeywords.javascript;
    let keywordCount = 0;
    
    for (const keyword of keywords) {
      const re = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = code.match(re) || [];
      keywordCount += matches.length;
    }
    
    score += Math.min(keywordCount, 30); // До 30 баллов за ключевые слова
    
    return score;
  }
  
  /**
   * Извлекает несколько блоков кода из ответа LLM
   * @param {string} response - Ответ от LLM
   * @param {string} [language] - Ожидаемый язык программирования (опционально)
   * @param {Object} [options] - Дополнительные опции
   * @returns {Array<Object>} - Массив объектов с извлеченным кодом
   */
  extractMultiple(response, language = null, options = {}) {
    try {
      // Регулярное выражение для поиска блоков кода в формате Markdown
      const codeBlockRegex = /```(\w*)\s*([\s\S]*?)```/g;
      
      const codeBlocks = [];
      let match;
      
      while ((match = codeBlockRegex.exec(response)) !== null) {
        const blockLanguage = match[1].trim().toLowerCase() || language || this._detectLanguage(match[2]);
        const code = match[2].trim();
        
        if (code) {
          const processed = this.extract(match[0], blockLanguage, options);
          
          if (processed) {
            codeBlocks.push({
              ...processed,
              position: match.index
            });
          }
        }
      }
      
      // Если не найдено блоков кода в формате Markdown, 
      // пытаемся извлечь цельный код из всего ответа
      if (codeBlocks.length === 0) {
        const extraction = this.extract(response, language, options);
        
        if (extraction) {
          codeBlocks.push(extraction);
        }
      }
      
      return codeBlocks;
    } catch (error) {
      logger.error(`Ошибка при извлечении множественных блоков кода: ${error.message}`, error);
      return [];
    }
  }
  
  /**
   * Создает файл с извлеченным кодом
   * @param {string} response - Ответ от LLM
   * @param {string} filePath - Путь к файлу
   * @param {string} [language] - Ожидаемый язык программирования (опционально)
   * @param {Object} [options] - Дополнительные опции
   * @returns {Promise<boolean>} - Успешно ли создан файл
   */
  async extractToFile(response, filePath, language = null, options = {}) {
    try {
      const extraction = this.extract(response, language, options);
      
      if (!extraction) {
        logger.warn(`Не удалось извлечь код для файла ${filePath}`);
        return false;
      }
      
      // Используем fs для записи файла, если оно доступно
      const fs = require('fs').promises;
      
      try {
        // Создаем директории, если их нет
        const path = require('path');
        const directory = path.dirname(filePath);
        
        try {
          await fs.mkdir(directory, { recursive: true });
        } catch (mkdirError) {
          logger.warn(`Не удалось создать директорию ${directory}: ${mkdirError.message}`);
        }
        
        // Записываем файл
        await fs.writeFile(filePath, extraction.code);
        
        logger.info(`Файл ${filePath} успешно создан`);
        return true;
      } catch (fsError) {
        logger.error(`Ошибка при записи файла ${filePath}: ${fsError.message}`, fsError);
        return false;
      }
    } catch (error) {
      logger.error(`Ошибка при извлечении кода в файл: ${error.message}`, error);
      return false;
    }
  }
}

module.exports = new CodeExtractor();
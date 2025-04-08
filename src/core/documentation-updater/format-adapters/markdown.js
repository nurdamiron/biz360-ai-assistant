// src/core/documentation-updater/format-adapters/markdown.js

/**
 * Адаптер для генерации документации в формате Markdown
 */
class MarkdownAdapter {
    constructor() {
      this.fileExtension = 'md';
    }
  
    /**
     * Обрабатывает вывод LLM и форматирует его как Markdown
     * @param {String} content - Контент от LLM
     * @param {Object} options - Дополнительные опции
     * @returns {String} Отформатированный Markdown
     */
    processOutput(content, options = {}) {
      // Проверяем, содержит ли ответ уже markdown-разметку
      if (content.includes('```') || content.includes('#')) {
        // Если это обзор и он не начинается с заголовка, добавляем заголовок
        if (options.isOverview && !content.trim().startsWith('#')) {
          return `# Обзор модуля ${options.moduleName || ''}\n\n${content}`;
        }
        
        // Удаляем лишние обертки markdown блоков, если LLM их добавил
        // Например, если LLM вернул: "Вот документация в markdown: ```markdown ... ```"
        const markdownPattern = /```markdown\s*([\s\S]*?)\s*```/g;
        const matches = [...content.matchAll(markdownPattern)];
        
        if (matches.length > 0) {
          // Берем содержимое первого markdown блока
          return matches[0][1].trim();
        }
        
        return content;
      }
      
      // Если ответ не содержит markdown-разметки, добавим базовое форматирование
      let formattedContent = content;
      
      // Если это документация для файла, добавим заголовок с именем файла
      if (options.filePath && !options.isOverview) {
        formattedContent = `# ${options.filePath}\n\n${formattedContent}`;
      }
      
      return formattedContent;
    }
  
    /**
     * Соединяет несколько документов в один
     * @param {Array<String>} docs - Массив документов
     * @param {Object} options - Опции объединения
     * @returns {String} Объединенный документ
     */
    combineDocuments(docs, options = {}) {
      let combined = '';
      
      // Если указан заголовок для общего документа
      if (options.title) {
        combined += `# ${options.title}\n\n`;
      }
      
      // Добавляем содержание, если требуется
      if (options.toc) {
        combined += '## Содержание\n\n';
        
        docs.forEach((doc, index) => {
          // Извлекаем заголовок первого уровня, если есть
          const titleMatch = doc.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1] : `Раздел ${index + 1}`;
          
          // Добавляем элемент содержания
          combined += `- [${title}](#${title.toLowerCase().replace(/[^\w\-]+/g, '-')})\n`;
        });
        
        combined += '\n';
      }
      
      // Объединяем документы с разделителями
      docs.forEach((doc, index) => {
        // Если это не первый документ, добавляем разделитель
        if (index > 0) {
          combined += '\n\n---\n\n';
        }
        
        combined += doc;
      });
      
      return combined;
    }
  }
  
  module.exports = MarkdownAdapter;
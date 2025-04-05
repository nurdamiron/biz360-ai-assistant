// src/utils/markdown.js

/**
 * Модуль для обработки Markdown и преобразования его в HTML
 * Включает базовую защиту от XSS
 */

const escapeHtml = (text) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };
  
  const markdown = {
    /**
     * Преобразует Markdown в HTML
     * @param {string} text - Текст в формате Markdown
     * @returns {string} - HTML
     */
    parse(text) {
      if (!text) return '';
      
      // Экранируем HTML-теги для безопасности
      let html = escapeHtml(text);
      
      // Заголовки
      html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
      
      // Выделение текста
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
      
      // Подчеркивание
      html = html.replace(/__(.*?)__/g, '<u>$1</u>');
      
      // Зачеркивание
      html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');
      
      // Код
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
      
      // Блоки кода
      html = html.replace(/```([\s\S]*?)```/g, (match, p1) => {
        return `<pre><code>${p1}</code></pre>`;
      });
      
      // Ссылки
      html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      
      // Горизонтальная линия
      html = html.replace(/^\-\-\-$/gm, '<hr>');
      
      // Списки с маркерами
      // Сначала обрабатываем группы строк, начинающихся с маркера
      html = html.replace(/^[*\-+] (.*)/gm, '<li>$1</li>');
      // Затем обернем последовательности li в ul
      html = html.replace(/(<li>.*<\/li>)(?!\n<li>)/gs, '<ul>$1</ul>');
      
      // Нумерованные списки
      html = html.replace(/^\d+\. (.*)/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)(?!\n<li>)/gs, '<ol>$1</ol>');
      
      // Цитаты
      html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
      
      // Преобразуем переносы строк в <br> или <p>
      html = html
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
      
      // Оборачиваем весь текст в <p>, если он еще не в параграфе
      if (!html.startsWith('<')) {
        html = `<p>${html}</p>`;
      }
      
      // Особые случаи и исправления
      // Удаляем лишние <p> вокруг блоков
      html = html
        .replace(/<p><(h[1-6]|ul|ol|blockquote|pre)>/g, '<$1>')
        .replace(/<\/(h[1-6]|ul|ol|blockquote|pre)><\/p>/g, '</$1>');
      
      // Упоминания пользователей
      html = html.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
      
      // Хэштеги
      html = html.replace(/#(\w+)/g, '<span class="hashtag">#$1</span>');
      
      return html;
    },
    
    /**
     * Удаляет Markdown-разметку из текста
     * @param {string} text - Текст с Markdown-разметкой
     * @returns {string} - Чистый текст
     */
    strip(text) {
      if (!text) return '';
      
      // Удаляем разметку
      return text
        .replace(/#+\s/g, '')            // Заголовки
        .replace(/\*\*(.*?)\*\*/g, '$1')  // Полужирный
        .replace(/\*(.*?)\*/g, '$1')      // Курсив
        .replace(/__(.*?)__/g, '$1')      // Подчеркивание
        .replace(/~~(.*?)~~/g, '$1')      // Зачеркивание
        .replace(/`(.*?)`/g, '$1')        // Код
        .replace(/```[\s\S]*?```/g, '')   // Блоки кода
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')  // Ссылки
        .replace(/^\-\-\-$/gm, '')        // Горизонтальная линия
        .replace(/^[*\-+] /gm, '')        // Маркированные списки
        .replace(/^\d+\. /gm, '')         // Нумерованные списки
        .replace(/^> /gm, '')             // Цитаты
        .trim();
    },
    
    /**
     * Получает первый абзац из Markdown-текста для превью
     * @param {string} text - Текст с Markdown-разметкой
     * @param {number} maxLength - Максимальная длина превью
     * @returns {string} - Превью текста
     */
    getPreview(text, maxLength = 100) {
      if (!text) return '';
      
      // Удаляем Markdown-разметку
      const plainText = this.strip(text);
      
      // Получаем первый абзац (текст до первой пустой строки)
      const firstParagraph = plainText.split(/\n\s*\n/)[0] || plainText;
      
      // Обрезаем до нужной длины
      if (firstParagraph.length <= maxLength) {
        return firstParagraph;
      }
      
      // Добавляем многоточие в конец, если текст был обрезан
      return firstParagraph.substring(0, maxLength) + '...';
    }
  };
  
  module.exports = {
    markdown
  };
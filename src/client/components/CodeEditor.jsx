// src/client/components/CodeEditor.jsx

import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Box, Paper, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeIcon from '@mui/icons-material/Code';
import Editor from '@monaco-editor/react';

/**
 * Компонент редактора кода с подсветкой синтаксиса
 * @param {Object} props - Свойства компонента
 * @param {string} props.value - Значение кода
 * @param {string} props.language - Язык программирования
 * @param {boolean} props.readOnly - Только для чтения
 * @param {function} props.onChange - Функция обратного вызова при изменении кода
 * @param {number} props.height - Высота редактора
 */
const CodeEditor = ({ 
  value, 
  language = 'javascript', 
  readOnly = false, 
  onChange,
  height = 400
}) => {
  const editorRef = useRef(null);

  // Обработчик монтирования редактора
  function handleEditorDidMount(editor, monaco) {
    editorRef.current = editor;
    
    // Настройка редактора
    editor.updateOptions({
      minimap: {
        enabled: true
      },
      scrollBeyondLastLine: false,
      fontSize: 14,
      wordWrap: 'on',
      wrappingIndent: 'same',
      padding: { top: 10, bottom: 10 }
    });
    
    // Добавляем подсветку строк с ошибками и предупреждениями
    monaco.editor.setModelMarkers(editor.getModel(), 'owner', []);
  }

  // Обработчик изменения значения
  function handleEditorChange(value) {
    if (onChange) {
      onChange(value);
    }
  }

  // Функция копирования кода в буфер обмена
  const copyToClipboard = () => {
    if (editorRef.current) {
      const code = editorRef.current.getValue();
      navigator.clipboard.writeText(code)
        .then(() => {
          // Можно добавить уведомление об успешном копировании
          console.log('Код скопирован в буфер обмена');
        })
        .catch(err => {
          console.error('Ошибка при копировании в буфер обмена:', err);
        });
    }
  };

  // Функция форматирования кода
  const formatCode = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument').run();
    }
  };

  // Определение темы редактора на основе системных настроек
  const [theme, setTheme] = React.useState('light');
  
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      setTheme(e.matches ? 'vs-dark' : 'light');
    };
    
    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return (
    <Box sx={{ position: 'relative' }}>
      <Paper 
        elevation={1} 
        sx={{ 
          height: height,
          position: 'relative',
          '&:hover .code-actions': {
            opacity: 1
          }
        }}
      >
        <Editor
          height={height}
          language={language}
          value={value}
          theme={theme}
          options={{
            readOnly,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            folding: true,
            lineNumbers: 'on',
            renderLineHighlight: 'all',
            suggest: {
              showMethods: true,
              showVariables: true
            }
          }}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
        />
        
        {/* Панель инструментов для редактора */}
        <Box 
          className="code-actions"
          sx={{ 
            position: 'absolute', 
            top: 8, 
            right: 8, 
            opacity: 0,
            transition: 'opacity 0.2s',
            backgroundColor: theme === 'vs-dark' ? 'rgba(30, 30, 30, 0.6)' : 'rgba(255, 255, 255, 0.6)',
            borderRadius: 1,
            padding: '4px'
          }}
        >
          <Tooltip title="Копировать код">
            <IconButton size="small" onClick={copyToClipboard}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          
          {!readOnly && (
            <Tooltip title="Форматировать код">
              <IconButton size="small" onClick={formatCode}>
                <CodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

CodeEditor.propTypes = {
  value: PropTypes.string.isRequired,
  language: PropTypes.string,
  readOnly: PropTypes.bool,
  onChange: PropTypes.func,
  height: PropTypes.number
};

export default CodeEditor;
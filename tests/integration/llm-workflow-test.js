// tests/integration/llm-workflow-test.js

const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const llmClient = require('../../src/utils/llm-client');
const llmCache = require('../../src/utils/llm-cache');
const promptManager = require('../../src/utils/prompt-manager');
const ErrorCorrector = require('../../src/core/error-corrector');
const DocumentationUpdater = require('../../src/core/documentation-updater');
const PRManager = require('../../src/core/vcs-manager/pr-manager');
const fs = require('fs').promises;
const path = require('path');

describe('Интеграционное тестирование AI-ассистента', function() {
  // Увеличиваем таймаут для тестов с API
  this.timeout(30000);
  
  // Мок для LLM-клиента
  let llmClientStub;
  // Временная директория для тестов
  const testDir = path.join(__dirname, '../tmp-test');
  
  before(async function() {
    // Создаем временную директорию для тестов
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (error) {
      console.error('Ошибка при создании временной директории:', error);
    }
    
    // Создаем мок для LLM-клиента
    llmClientStub = sinon.stub(llmClient, 'generateCompletion');
    
    // Настраиваем мок для возврата предопределенных ответов
    llmClientStub.withArgs(sinon.match(/декомпозиция/i)).resolves(`
      {
        "taskName": "Реализация интеграции",
        "subtasks": [
          {
            "id": 1,
            "title": "Установка зависимостей",
            "description": "Установка необходимых библиотек",
            "complexity": 1,
            "dependsOn": []
          },
          {
            "id": 2,
            "title": "Конфигурация модуля",
            "description": "Настройка основных параметров",
            "complexity": 2,
            "dependsOn": [1]
          }
        ]
      }
    `);
    
    llmClientStub.withArgs(sinon.match(/генерация кода/i)).resolves(`
      \`\`\`javascript
      class TestModule {
        constructor(options = {}) {
          this.name = options.name || 'default';
        }
        
        initialize() {
          console.log('Инициализация модуля', this.name);
          return true;
        }
      }
      
      module.exports = TestModule;
      \`\`\`
    `);
    
    llmClientStub.withArgs(sinon.match(/исправление ошибок/i)).resolves(`
      \`\`\`javascript
      class TestModule {
        constructor(options = {}) {
          this.name = options.name || 'default';
        }
        
        initialize() {
          console.log('Инициализация модуля', this.name);
          return true;
        }
      }
      
      module.exports = TestModule;
      \`\`\`
    `);
    
    llmClientStub.withArgs(sinon.match(/документация/i)).resolves(`
      # TestModule
      
      Модуль для тестирования функциональности.
      
      ## Использование
      
      \`\`\`javascript
      const TestModule = require('./TestModule');
      const module = new TestModule({ name: 'test' });
      module.initialize();
      \`\`\`
    `);
    
    // Инициализируем компоненты
    await promptManager.initialize();
  });
  
  after(async function() {
    // Восстанавливаем оригинальное поведение
    llmClientStub.restore();
    
    // Удаляем временную директорию
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Ошибка при удалении временной директории:', error);
    }
  });
  
  describe('Модуль унификации шаблонов (prompt-manager)', function() {
    it('должен успешно загрузить шаблоны промптов', async function() {
      const templates = await promptManager.listTemplates();
      expect(templates).to.be.an('array');
      expect(templates.length).to.be.greaterThan(0);
    });
    
    it('должен заполнять шаблон промпта данными', async function() {
      // Создаем временный шаблон для теста
      await promptManager.addTemplate('test-template', 'Тестовый шаблон: {{value}}');
      
      const prompt = await promptManager.fillPrompt('test-template', { value: 'работает' });
      expect(prompt).to.equal('Тестовый шаблон: работает');
    });
    
    it('должен создавать цепочку промптов', async function() {
      // Создаем временные шаблоны для теста
      await promptManager.addTemplate('chain-test-1', 'Шаблон 1: {{value1}}');
      await promptManager.addTemplate('chain-test-2', 'Шаблон 2: {{value2}}');
      
      const chain = [
        { template: 'chain-test-1', data: { value1: 'значение1' } },
        { template: 'chain-test-2', data: { value2: 'значение2' } }
      ];
      
      const prompt = await promptManager.createPromptChain(chain);
      expect(prompt).to.include('Шаблон 1: значение1');
      expect(prompt).to.include('Шаблон 2: значение2');
    });
  });
  
  describe('Модуль кэширования LLM-запросов (llm-cache)', function() {
    it('должен кэшировать и возвращать результаты запросов', async function() {
      // Создаем уникальный ключ для теста
      const testKey = `test-key-${Date.now()}`;
      const testValue = { text: 'тестовый ответ', choices: [{ message: { content: 'тестовый ответ' } }] };
      
      // Сохраняем в кэш
      await llmCache.set(testKey, testValue);
      
      // Получаем из кэша
      const cachedValue = await llmCache.get(testKey);
      expect(cachedValue).to.deep.equal(testValue);
    });
    
    it('должен корректно генерировать ключ кэша', function() {
      const prompt = 'Тестовый промпт';
      const options1 = { model: 'gpt-4', temperature: 0.5, max_tokens: 100 };
      const options2 = { model: 'gpt-4', temperature: 0.7, max_tokens: 100 };
      
      const key1 = llmCache.generateKey(prompt, options1);
      const key2 = llmCache.generateKey(prompt, options2);
      
      // Разные параметры должны давать разные ключи
      expect(key1).to.not.equal(key2);
      
      // Одинаковые параметры должны давать одинаковые ключи
      const key3 = llmCache.generateKey(prompt, options1);
      expect(key1).to.equal(key3);
    });
    
    it('должен обертывать функцию LLM-клиента с кэшированием', async function() {
      // Имитируем функцию LLM-клиента
      const mockLLMFunction = sinon.stub().resolves('тестовый ответ');
      
      // Первый вызов (без кэша)
      const result1 = await llmCache.withCache(mockLLMFunction, 'тестовый запрос', { model: 'test-model' });
      expect(result1).to.equal('тестовый ответ');
      expect(mockLLMFunction.calledOnce).to.be.true;
      
      // Второй вызов (должен использовать кэш)
      const result2 = await llmCache.withCache(mockLLMFunction, 'тестовый запрос', { model: 'test-model' });
      expect(result2).to.equal('тестовый ответ');
      // Функция не должна быть вызвана повторно
      expect(mockLLMFunction.calledOnce).to.be.true;
    });
  });
  
  describe('Модуль исправления ошибок (error-corrector)', function() {
    let errorCorrector;
    
    before(function() {
      errorCorrector = new ErrorCorrector();
    });
    
    it('должен исправлять синтаксические ошибки в коде', async function() {
      // Код с синтаксической ошибкой
      const codeWithError = `
        function test() {
          console.log("Hello world")  // Отсутствует точка с запятой
          return true
        }
      `;
      
      const fixedCode = await errorCorrector.fixSyntaxErrors(codeWithError, 'javascript');
      expect(fixedCode).to.include('console.log');
      expect(fixedCode).to.include('return true');
    });
    
    it('должен исправлять ошибки на основе сообщения об ошибке', async function() {
      // Код с логической ошибкой
      const codeWithError = `
        function divide(a, b) {
          return a / b;
        }
      `;
      
      const error = new Error('Division by zero');
      
      const fixedCode = await errorCorrector.fixErrors(codeWithError, 'javascript', error);
      expect(fixedCode).to.include('function divide');
      // Ожидаем, что исправленный код содержит проверку деления на ноль
      expect(fixedCode.toLowerCase()).to.match(/if.*b.*===.*0|if.*b.*==.*0|if.*!b/);
    });
    
    it('должен сохранять исправленный код в файл', async function() {
      // Создаем тестовый файл с ошибкой
      const testFilePath = path.join(testDir, 'test-error.js');
      const codeWithError = `
        function test() {
          console.log("Test function")  // Отсутствует точка с запятой
          return true
        }
      `;
      
      await fs.writeFile(testFilePath, codeWithError, 'utf8');
      
      // Исправляем ошибки в файле
      const isFixed = await errorCorrector.fixErrorsInFile(testFilePath, new Error('Syntax error'));
      
      // Проверяем результат
      expect(isFixed).to.be.true;
      
      // Читаем исправленный файл
      const fixedCode = await fs.readFile(testFilePath, 'utf8');
      expect(fixedCode).not.to.equal(codeWithError);
    });
  });
  
  describe('Модуль обновления документации (documentation-updater)', function() {
    let documentationUpdater;
    
    before(function() {
      documentationUpdater = new DocumentationUpdater({
        docsPath: path.join(testDir, 'docs')
      });
    });
    
    it('должен генерировать JSDoc комментарии для кода', async function() {
      const code = `
        class Calculator {
          constructor(precision = 2) {
            this.precision = precision;
          }
          
          add(a, b) {
            return a + b;
          }
          
          subtract(a, b) {
            return a - b;
          }
        }
      `;
      
      const documentedCode = await documentationUpdater.generateJSDocComments(code, 'javascript');
      
      // Ожидаем JSDoc комментарии в результате
      expect(documentedCode).to.include('/**');
      expect(documentedCode).to.include('@param');
      expect(documentedCode).to.include('@returns');
    });
    
    it('должен генерировать README.md для модуля', async function() {
      const moduleInfo = {
        moduleName: 'TestModule',
        description: 'Тестовый модуль для проверки функциональности',
        files: ['index.js', 'utils.js', 'constants.js']
      };
      
      const readme = await documentationUpdater.generateModuleReadme(moduleInfo);
      
      // Ожидаем определенные разделы в README
      expect(readme).to.include('# TestModule');
      expect(readme).to.include('Тестовый модуль для проверки функциональности');
      expect(readme).to.include('## Использование');
      expect(readme).to.include('index.js');
    });
    
    it('должен обновлять файл документации', async function() {
      // Создаем тестовый файл кода
      const testFilePath = path.join(testDir, 'test-module.js');
      const code = `
        class TestModule {
          constructor(options = {}) {
            this.name = options.name || 'default';
          }
          
          initialize() {
            console.log('Инициализация модуля', this.name);
            return true;
          }
        }
        
        module.exports = TestModule;
      `;
      
      await fs.writeFile(testFilePath, code, 'utf8');
      
      // Обновляем документацию для файла
      const result = await documentationUpdater.updateFileDocumentation(testFilePath);
      
      // Проверяем результат
      expect(result).to.be.an('object');
      expect(result.success).to.be.true;
      expect(result.docFilePath).to.exist;
      
      // Проверяем содержимое созданного файла документации
      if (result.success && result.docFilePath) {
        const docContent = await fs.readFile(result.docFilePath, 'utf8');
        expect(docContent).to.include('/**');
        expect(docContent).to.include('TestModule');
      }
    });
  });
  
  describe('Интеграция между модулями', function() {
    it('должен обрабатывать полный цикл: генерация кода → исправление ошибок → документация', async function() {
      // 1. Генерация кода с использованием LLM
      const codePrompt = 'Генерация кода для класса TestModule с методом initialize';
      const generatedCode = await llmClient.generateCompletion(codePrompt, { model: 'gpt-3.5-turbo' });
      
      // Извлекаем код из ответа (имитация работы code-extractor)
      let code = generatedCode;
      const codeMatch = generatedCode.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/i);
      if (codeMatch && codeMatch[1]) {
        code = codeMatch[1];
      }
      
      // Сохраняем сгенерированный код в файл
      const codeFilePath = path.join(testDir, 'generated-module.js');
      await fs.writeFile(codeFilePath, code, 'utf8');
      
      // 2. Предположим, что в коде есть ошибка, которую нужно исправить
      const errorCorrector = new ErrorCorrector();
      
      // Намеренно вводим ошибку в код
      let codeWithError = code.replace('return true', 'return tru');
      await fs.writeFile(codeFilePath, codeWithError, 'utf8');
      
      // Исправляем ошибку
      const error = new Error('Uncaught ReferenceError: tru is not defined');
      const isFixed = await errorCorrector.fixErrorsInFile(codeFilePath, error);
      expect(isFixed).to.be.true;
      
      // Читаем исправленный код
      const fixedCode = await fs.readFile(codeFilePath, 'utf8');
      expect(fixedCode).not.to.equal(codeWithError);
      
      // 3. Генерируем документацию для исправленного кода
      const documentationUpdater = new DocumentationUpdater({
        docsPath: path.join(testDir, 'docs')
      });
      
      // Создаем README для модуля
      const moduleInfo = {
        moduleName: 'GeneratedModule',
        description: 'Автоматически сгенерированный модуль',
        files: ['generated-module.js']
      };
      
      const readme = await documentationUpdater.generateModuleReadme(moduleInfo);
      const readmePath = path.join(testDir, 'README.md');
      await fs.writeFile(readmePath, readme, 'utf8');
      
      // Обновляем JSDoc для кода
      const docResult = await documentationUpdater.updateFileDocumentation(codeFilePath);
      expect(docResult.success).to.be.true;
      
      // 4. Имитируем создание PR (без реального создания)
      const mockPrManager = {
        createPullRequestMessage: function(task, changedFiles) {
          return {
            title: `[AI] Реализация TestModule`,
            body: `## Изменения\nСгенерирован и улучшен модуль TestModule.\n\n### Файлы:\n${changedFiles.join('\n')}`
          };
        },
        
        addPullRequestComment: async function(prNumber, comment) {
          return { id: 123, body: comment };
        }
      };
      
      // Интегрируем документацию с PR
      const changedFiles = ['generated-module.js', docResult.docFilePath];
      await documentationUpdater.integrateDocumentationWithPR(mockPrManager, 123, changedFiles);
      
      // Проверяем наличие всех созданных файлов
      const filesExist = await Promise.all([
        fs.access(codeFilePath).then(() => true).catch(() => false),
        fs.access(readmePath).then(() => true).catch(() => false),
        fs.access(docResult.docFilePath).then(() => true).catch(() => false)
      ]);
      
      expect(filesExist.every(Boolean)).to.be.true;
    });
  });
});
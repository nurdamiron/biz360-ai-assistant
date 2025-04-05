// tests/unit/core/code-generator.test.js

const { expect } = require('chai');
const sinon = require('sinon');
const CodeGenerator = require('../../../src/core/code-generator');
const codeValidator = require('../../../src/utils/code-validator');

describe('CodeGenerator', () => {
  let codeGenerator;
  
  beforeEach(() => {
    // Создаем экземпляр CodeGenerator для тестирования
    codeGenerator = new CodeGenerator(1); // projectId = 1
    
    // Подменяем методы, которые взаимодействуют с внешними системами
    codeGenerator.getTaskInfo = sinon.stub().resolves({
      id: 1,
      title: 'Test Task',
      description: 'Test task description'
    });
    
    codeGenerator.llmClient = {
      sendPrompt: sinon.stub().resolves('```javascript\nfunction test() {\n  return true;\n}\n```\n\nОписание решения: This is a test function.'),
      modelName: 'test-model',
      getLastTokenCount: sinon.stub().returns(100)
    };
    
    codeGenerator.logLLMInteraction = sinon.stub().resolves();
    codeGenerator.saveGeneratedCode = sinon.stub().resolves(123);
    
    // Мокаем запросы к базе данных
    sinon.stub(codeGenerator, '_detectLanguageFromFilePath').returns('javascript');
    
    // Мокаем pool.getConnection
    global.pool = {
      getConnection: sinon.stub().resolves({
        query: sinon.stub().resolves([[]]), // Возвращаем пустой массив подзадач и тегов
        release: sinon.stub()
      })
    };
  });
  
  afterEach(() => {
    // Восстанавливаем все stubs
    sinon.restore();
  });
  
  describe('extractCodeFromResponse', () => {
    it('should extract code from LLM response with language', () => {
      const response = '```javascript\nfunction test() {\n  return true;\n}\n```\n\nОписание решения: This is a test function.';
      const result = codeGenerator.extractCodeFromResponse(response, 'javascript');
      
      expect(result).to.deep.equal({
        code: 'function test() {\n  return true;\n}',
        language: 'javascript',
        summary: 'This is a test function.'
      });
    });
    
    it('should extract code from LLM response without language', () => {
      const response = '```\nfunction test() {\n  return true;\n}\n```\n\nОписание решения: This is a test function.';
      const result = codeGenerator.extractCodeFromResponse(response, 'javascript');
      
      expect(result).to.deep.equal({
        code: 'function test() {\n  return true;\n}',
        language: 'javascript',
        summary: 'This is a test function.'
      });
    });
    
    it('should return null if no code found', () => {
      const response = 'This is a response without code block';
      const result = codeGenerator.extractCodeFromResponse(response, 'javascript');
      
      expect(result).to.deep.equal({
        code: null,
        language: 'javascript',
        summary: null
      });
    });
  });
  
  describe('generateCode', () => {
    it('should generate code successfully', async () => {
      // Подготавливаем тестовое окружение
      sinon.stub(codeValidator, 'validate').resolves({ isValid: true, error: null });
      
      // Вызываем метод
      const result = await codeGenerator.generateCode(1, 'test.js', 'javascript');
      
      // Проверяем результат
      expect(result).to.deep.equal({
        generationId: 123,
        taskId: 1,
        filePath: 'test.js',
        code: 'function test() {\n  return true;\n}',
        language: 'javascript',
        summary: 'This is a test function.'
      });
      
      // Проверяем, что все методы были вызваны
      expect(codeGenerator.getTaskInfo.calledOnce).to.be.true;
      expect(codeGenerator.llmClient.sendPrompt.calledOnce).to.be.true;
      expect(codeGenerator.logLLMInteraction.calledOnce).to.be.true;
      expect(codeValidator.validate.calledOnce).to.be.true;
      expect(codeGenerator.saveGeneratedCode.calledOnce).to.be.true;
    });
    
    it('should fix code if validation fails', async () => {
      // Подготавливаем тестовое окружение
      sinon.stub(codeValidator, 'validate').resolves({ isValid: false, error: 'Syntax error' });
      sinon.stub(codeGenerator, 'fixInvalidCode').resolves('function fixedTest() {\n  return true;\n}');
      
      // Вызываем метод
      const result = await codeGenerator.generateCode(1, 'test.js', 'javascript');
      
      // Проверяем результат
      expect(result).to.deep.equal({
        generationId: 123,
        taskId: 1,
        filePath: 'test.js',
        code: 'function fixedTest() {\n  return true;\n}',
        language: 'javascript',
        summary: 'This is a test function.'
      });
      
      // Проверяем, что все методы были вызваны
      expect(codeGenerator.fixInvalidCode.calledOnce).to.be.true;
    });
    
    it('should throw error if code extraction fails', async () => {
      // Подготавливаем тестовое окружение
      codeGenerator.llmClient.sendPrompt = sinon.stub().resolves('Invalid response without code');
      
      // Проверяем, что метод выбрасывает ошибку
      try {
        await codeGenerator.generateCode(1, 'test.js', 'javascript');
        // Если дошли до этой точки, то тест не пройден
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('Не удалось извлечь код из ответа LLM');
      }
    });
  });
  
  describe('fixInvalidCode', () => {
    it('should fix invalid code', async () => {
      // Подготавливаем тестовое окружение
      codeGenerator.llmClient.sendPrompt = sinon.stub().resolves('```\nfunction fixedTest() {\n  return true;\n}\n```');
      
      // Вызываем метод
      const result = await codeGenerator.fixInvalidCode('function test() {\n  return true\n}', 'Missing semicolon');
      
      // Проверяем результат
      expect(result).to.equal('function fixedTest() {\n  return true;\n}');
      
      // Проверяем, что sendPrompt был вызван
      expect(codeGenerator.llmClient.sendPrompt.calledOnce).to.be.true;
    });
    
    it('should return original code if extraction fails', async () => {
      // Подготавливаем тестовое окружение
      codeGenerator.llmClient.sendPrompt = sinon.stub().resolves('Invalid response without code');
      
      // Вызываем метод
      const originalCode = 'function test() {\n  return true\n}';
      const result = await codeGenerator.fixInvalidCode(originalCode, 'Missing semicolon');
      
      // Проверяем результат
      expect(result).to.equal(originalCode);
    });
  });
});
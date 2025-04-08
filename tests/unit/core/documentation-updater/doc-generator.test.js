// tests/unit/core/documentation-updater/doc-generator.test.js

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const DocumentationGenerator = require('../../../../src/core/documentation-updater/doc-generator');
const llmClient = require('../../../../src/utils/llm-client');
const promptManager = require('../../../../src/utils/prompt-manager');
const fileUtils = require('../../../../src/utils/file-utils');
const logger = require('../../../../src/utils/logger');

describe('DocumentationGenerator', () => {
  let llmClientStub, promptManagerStub, fileUtilsStub, fsStub, loggerStub;
  let generator;

  beforeEach(() => {
    // Создаем заглушки для зависимостей
    llmClientStub = sinon.stub(llmClient, 'sendMessage');
    promptManagerStub = sinon.stub(promptManager, 'getPrompt');
    fileUtilsStub = { ensureDir: sinon.stub() };
    sinon.stub(fileUtils, 'ensureDir').callsFake(fileUtilsStub.ensureDir);
    fsStub = {
      readFile: sinon.stub(fs, 'readFile'),
      writeFile: sinon.stub(fs, 'writeFile'),
      readdir: sinon.stub(fs, 'readdir')
    };
    loggerStub = sinon.stub(logger, 'info');
    sinon.stub(logger, 'warn');
    sinon.stub(logger, 'error');
    
    // Создаем экземпляр генератора документации
    generator = new DocumentationGenerator({
      projectRoot: '/test/project',
      outputFormat: 'markdown'
    });
  });

  afterEach(() => {
    // Восстанавливаем оригинальные функции
    sinon.restore();
  });

  describe('generateFileDocumentation', () => {
    it('должен генерировать документацию для файла', async () => {
      // Настраиваем моки
      const filePath = 'src/example.js';
      const fileContent = 'function test() { return true; }';
      const promptText = 'Тестовый промпт для документации файла';
      const llmResponse = '# Example.js\n\nФайл содержит функцию test, которая всегда возвращает true.';
      
      fsStub.readFile.withArgs(path.join('/test/project', filePath), 'utf-8').resolves(fileContent);
      promptManagerStub.resolves(promptText);
      llmClientStub.resolves(llmResponse);
      
      // Мокаем адаптер формата
      generator.formatAdapter = {
        processOutput: sinon.stub().returns(llmResponse)
      };
      
      // Вызываем тестируемый метод
      const result = await generator.generateFileDocumentation(filePath);
      
      // Проверяем результат
      expect(result).to.equal(llmResponse);
      
      // Проверяем, что все нужные функции были вызваны с правильными параметрами
      expect(fsStub.readFile.calledOnce).to.be.true;
      expect(promptManagerStub.calledOnce).to.be.true;
      expect(promptManagerStub.firstCall.args[0]).to.equal('generate-file-documentation');
      expect(promptManagerStub.firstCall.args[1]).to.include({
        code: fileContent,
        language: 'js',
        filePath: filePath,
        outputFormat: 'markdown'
      });
      
      expect(llmClientStub.calledOnce).to.be.true;
      expect(llmClientStub.firstCall.args[0]).to.equal(promptText);
      
      expect(generator.formatAdapter.processOutput.calledOnce).to.be.true;
      expect(generator.formatAdapter.processOutput.firstCall.args[0]).to.equal(llmResponse);
    });
    
    it('должен обрабатывать ошибки при генерации документации', async () => {
      // Настраиваем моки для сценария с ошибкой
      const filePath = 'src/example.js';
      fsStub.readFile.rejects(new Error('Файл не найден'));
      
      // Проверяем, что метод выбрасывает ошибку
      try {
        await generator.generateFileDocumentation(filePath);
        // Если мы сюда попали, значит ошибка не была выброшена, и тест должен провалиться
        expect.fail('Должна была быть выброшена ошибка');
      } catch (error) {
        expect(error.message).to.include('Не удалось сгенерировать документацию');
        expect(logger.error.calledOnce).to.be.true;
      }
    });
  });

  describe('generateModuleDocumentation', () => {
    it('должен генерировать документацию для модуля', async () => {
      // Настраиваем моки
      const modulePath = 'src/core';
      const files = [
        '/test/project/src/core/file1.js',
        '/test/project/src/core/file2.js'
      ];
      
      // Мокаем внутренний метод _getModuleFiles
      sinon.stub(generator, '_getModuleFiles').resolves(files);
      
      // Мокаем generateFileDocumentation
      sinon.stub(generator, 'generateFileDocumentation').callsFake((file) => {
        return Promise.resolve(`Документация для ${file}`);
      });
      
      // Мокаем адаптер формата
      generator.formatAdapter = {
        processOutput: sinon.stub().callsFake(input => input)
      };
      
      // Настраиваем моки для обзора модуля
      fsStub.readFile.resolves('файл содержит код');
      const overviewPrompt = 'Промпт для обзора модуля';
      const overviewResponse = '# Обзор модуля\n\nМодуль содержит функциональность X';
      
      promptManagerStub.withArgs('generate-module-overview', sinon.match.any).resolves(overviewPrompt);
      llmClientStub.withArgs(overviewPrompt).resolves(overviewResponse);
      
      // Вызываем тестируемый метод
      const result = await generator.generateModuleDocumentation(modulePath, { generateOverview: true });
      
      // Проверяем результат
      expect(result).to.have.property('module', modulePath);
      expect(result).to.have.property('docs').that.is.an('object');
      expect(result.docs).to.have.property('src/core/file1.js').that.equals('Документация для /test/project/src/core/file1.js');
      expect(result.docs).to.have.property('src/core/file2.js').that.equals('Документация для /test/project/src/core/file2.js');
      expect(result.docs).to.have.property('_overview.md').that.equals(overviewResponse);
      expect(result).to.have.property('errors', null);
      
      // Проверяем, что все нужные методы были вызваны
      expect(generator._getModuleFiles.calledOnce).to.be.true;
      expect(generator.generateFileDocumentation.calledTwice).to.be.true;
      expect(promptManagerStub.calledOnce).to.be.true;
      expect(llmClientStub.calledOnce).to.be.true;
    });
  });

  describe('saveDocumentation', () => {
    it('должен сохранять сгенерированную документацию', async () => {
      // Настраиваем моки
      const documentation = {
        module: 'src/core',
        docs: {
          'src/core/file1.js': '# Документация для file1.js',
          'src/core/file2.js': '# Документация для file2.js'
        },
        errors: null
      };
      
      const outputDir = 'docs/generated';
      
      fileUtilsStub.ensureDir.resolves();
      fsStub.writeFile.resolves();
      
      // Мокаем адаптер формата
      generator.formatAdapter = {
        fileExtension: 'md'
      };
      
      // Вызываем тестируемый метод
      const result = await generator.saveDocumentation(documentation, outputDir);
      
      // Проверяем результат
      expect(result).to.have.property('status', 'success');
      expect(result).to.have.property('savedFiles').that.is.an('array').with.lengthOf(2);
      expect(result).to.have.property('errors', null);
      
      // Проверяем, что все нужные функции были вызваны
      expect(fileUtilsStub.ensureDir.called).to.be.true;
      expect(fsStub.writeFile.calledTwice).to.be.true;
      
      // Проверяем правильность параметров при записи файлов
      const firstFileCall = fsStub.writeFile.firstCall.args;
      expect(firstFileCall[0]).to.include(path.join('docs/generated', 'src/core/file1.md'));
      expect(firstFileCall[1]).to.equal('# Документация для file1.js');
      
      const secondFileCall = fsStub.writeFile.secondCall.args;
      expect(secondFileCall[0]).to.include(path.join('docs/generated', 'src/core/file2.md'));
      expect(secondFileCall[1]).to.equal('# Документация для file2.js');
    });
  });
});
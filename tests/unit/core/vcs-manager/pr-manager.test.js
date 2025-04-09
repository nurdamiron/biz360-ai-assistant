// tests/unit/core/vcs-manager/pr-manager.test.js

const { expect } = require('chai');
const sinon = require('sinon');
const prManager = require('../../../../src/core/vcs-manager/pr-manager');
const GitService = require('../../../../src/core/vcs-manager/git-client');
const prDescriptionGenerator = require('../../../../src/core/vcs-manager/pr-description-generator');
const conflictChecker = require('../../../../src/core/vcs-manager/conflict-checker');
const reviewChecklistGenerator = require('../../../../src/core/vcs-manager/review-checklist-generator');
const logger = require('../../../../src/utils/logger');

describe('PRManager', () => {
  let GitServiceStub, prDescriptionGeneratorStub, conflictCheckerStub, reviewChecklistGeneratorStub, loggerStub;

  beforeEach(() => {
    // Создаем заглушки для зависимостей
    GitServiceStub = sinon.stub(GitService);
    prDescriptionGeneratorStub = sinon.stub(prDescriptionGenerator);
    conflictCheckerStub = sinon.stub(conflictChecker);
    reviewChecklistGeneratorStub = sinon.stub(reviewChecklistGenerator);
    loggerStub = sinon.stub(logger, 'info');
    sinon.stub(logger, 'warn');
    sinon.stub(logger, 'error');
  });

  afterEach(() => {
    // Восстанавливаем оригинальные функции
    sinon.restore();
  });

  describe('createPR', () => {
    it('должен успешно создавать PR при отсутствии конфликтов', async () => {
      // Настраиваем моки
      const noConflictsResult = {
        hasConflicts: false,
        message: 'Конфликтов не обнаружено'
      };
      
      conflictCheckerStub.checkConflicts = sinon.stub().resolves(noConflictsResult);
      
      const mockDescription = '# Тестовое описание PR\n\nДобавляет новые функции';
      prDescriptionGeneratorStub.generateDescription = sinon.stub().resolves(mockDescription);
      
      const mockPR = {
        url: 'https://github.com/user/repo/pull/123',
        id: 'pr123',
        number: 123
      };
      
      GitServiceStub.createPullRequest = sinon.stub().resolves(mockPR);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        title: 'Добавление новой функции',
        taskId: 'task123',
        taskTitle: 'Разработать новую функцию'
      };
      
      const result = await prManager.createPR(options);
      
      // Проверяем результат
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('message').that.includes('успешно создан');
      expect(result).to.have.property('url', mockPR.url);
      expect(result).to.have.property('id', mockPR.id);
      expect(result).to.have.property('number', mockPR.number);
      
      // Проверяем, что все нужные функции были вызваны с правильными параметрами
      expect(conflictCheckerStub.checkConflicts.calledOnce).to.be.true;
      expect(conflictCheckerStub.checkConflicts.firstCall.args[0]).to.deep.include({
        baseBranch: 'main',
        headBranch: 'feature/new-feature'
      });
      
      expect(prDescriptionGeneratorStub.generateDescription.calledOnce).to.be.true;
      expect(prDescriptionGeneratorStub.generateDescription.firstCall.args[0]).to.deep.include({
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        taskId: 'task123',
        taskTitle: 'Разработать новую функцию'
      });
      
      expect(GitServiceStub.createPullRequest.calledOnce).to.be.true;
      expect(GitServiceStub.createPullRequest.firstCall.args[0]).to.deep.include({
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        title: 'Добавление новой функции',
        body: mockDescription
      });
      
      expect(loggerStub.calledTwice).to.be.true;
    });
    
    it('должен возвращать ошибку при наличии конфликтов', async () => {
      // Настраиваем моки для случая с конфликтами
      const conflictsResult = {
        hasConflicts: true,
        message: 'Обнаружены конфликты в 2 файлах',
        conflictFiles: ['src/file1.js', 'src/file2.js']
      };
      
      conflictCheckerStub.checkConflicts = sinon.stub().resolves(conflictsResult);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/conflicting-feature',
        title: 'Конфликтующая функция'
      };
      
      const result = await prManager.createPR(options);
      
      // Проверяем результат
      expect(result).to.have.property('success', false);
      expect(result).to.have.property('message').that.includes('Обнаружены конфликты');
      expect(result).to.have.property('conflicts').that.is.an('array').with.lengthOf(2);
      expect(result).to.have.property('url', null);
      
      // Проверяем, что только проверка конфликтов была вызвана
      expect(conflictCheckerStub.checkConflicts.calledOnce).to.be.true;
      expect(prDescriptionGeneratorStub.generateDescription.called).to.be.false;
      expect(GitServiceStub.createPullRequest.called).to.be.false;
    });
  });

  describe('generateReviewChecklist', () => {
    it('должен генерировать чеклист для код-ревью', async () => {
      // Настраиваем моки
      const mockChecklist = {
        general: '## Общий чеклист\n- Пункт 1\n- Пункт 2',
        specific: {
          '.js': '### JavaScript\n- Проверить обработку ошибок',
          '.css': '### CSS\n- Проверить кроссбраузерность'
        }
      };
      
      reviewChecklistGeneratorStub.generateChecklist = sinon.stub().resolves(mockChecklist);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        detailedChecklist: true,
        fileExtensions: ['.js', '.css']
      };
      
      const result = await prManager.generateReviewChecklist(options);
      
      // Проверяем результат
      expect(result).to.deep.equal(mockChecklist);
      
      // Проверяем, что generateChecklist был вызван с правильными параметрами
      expect(reviewChecklistGeneratorStub.generateChecklist.calledOnce).to.be.true;
      expect(reviewChecklistGeneratorStub.generateChecklist.firstCall.args[0]).to.deep.equal(options);
    });
  });

  describe('checkMergeConflicts', () => {
    it('должен проверять наличие конфликтов', async () => {
      // Настраиваем моки
      const conflictsResult = {
        hasConflicts: true,
        message: 'Обнаружены конфликты в 2 файлах',
        conflictFiles: ['src/file1.js', 'src/file2.js']
      };
      
      conflictCheckerStub.checkConflicts = sinon.stub().resolves(conflictsResult);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        analyzeConflicts: true
      };
      
      const result = await prManager.checkMergeConflicts(options);
      
      // Проверяем результат
      expect(result).to.deep.equal(conflictsResult);
      
      // Проверяем, что checkConflicts был вызван с правильными параметрами
      expect(conflictCheckerStub.checkConflicts.calledOnce).to.be.true;
      expect(conflictCheckerStub.checkConflicts.firstCall.args[0]).to.deep.equal(options);
    });
  });

  describe('generatePRDescription', () => {
    it('должен генерировать описание PR', async () => {
      // Настраиваем моки
      const mockDescription = '# PR Description\nThis is a test PR description';
      prDescriptionGeneratorStub.generateDescription = sinon.stub().resolves(mockDescription);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        taskId: 'task123'
      };
      
      const result = await prManager.generatePRDescription(options);
      
      // Проверяем результат
      expect(result).to.equal(mockDescription);
      
      // Проверяем, что generateDescription был вызван с правильными параметрами
      expect(prDescriptionGeneratorStub.generateDescription.calledOnce).to.be.true;
      expect(prDescriptionGeneratorStub.generateDescription.firstCall.args[0]).to.deep.equal(options);
    });
  });

  describe('evaluatePR', () => {
    it('должен оценивать PR на основе чеклиста', async () => {
      // Настраиваем моки
      const mockEvaluation = {
        overallRating: 8,
        passedChecks: ['Пункт 1', 'Пункт 2'],
        failedChecks: ['Пункт 3'],
        suggestions: ['Улучшить тесты'],
        critical: [],
        summary: 'В целом хороший PR, но требует доработки тестов'
      };
      
      reviewChecklistGeneratorStub.evaluatePR = sinon.stub().resolves(mockEvaluation);
      
      // Вызываем тестируемый метод
      const options = {
        baseBranch: 'main',
        headBranch: 'feature/new-feature',
        prDescription: 'Описание PR',
        checklist: { general: '## Чеклист\n- Пункт 1\n- Пункт 2\n- Пункт 3' }
      };
      
      const result = await prManager.evaluatePR(options);
      
      // Проверяем результат
      expect(result).to.deep.equal(mockEvaluation);
      
      // Проверяем, что evaluatePR был вызван с правильными параметрами
      expect(reviewChecklistGeneratorStub.evaluatePR.calledOnce).to.be.true;
      expect(reviewChecklistGeneratorStub.evaluatePR.firstCall.args[0]).to.deep.equal(options);
    });
  });
});
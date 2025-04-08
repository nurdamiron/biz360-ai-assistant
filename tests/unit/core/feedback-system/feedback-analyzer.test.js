// tests/unit/core/feedback-system/feedback-analyzer.test.js

const { expect } = require('chai');
const sinon = require('sinon');
const feedbackAnalyzer = require('../../../../src/core/feedback-system/feedback-analyzer');
const llmClient = require('../../../../src/utils/llm-client');
const promptManager = require('../../../../src/utils/prompt-manager');
const logger = require('../../../../src/utils/logger');

describe('FeedbackAnalyzer', () => {
  let llmClientStub, promptManagerStub, loggerStub;

  beforeEach(() => {
    // Создаем заглушки для зависимостей
    llmClientStub = sinon.stub(llmClient, 'sendMessage');
    promptManagerStub = sinon.stub(promptManager, 'getPrompt');
    loggerStub = sinon.stub(logger, 'info');
    sinon.stub(logger, 'warn');
    sinon.stub(logger, 'error');
  });

  afterEach(() => {
    // Восстанавливаем оригинальные функции
    sinon.restore();
  });

  describe('analyzeFeedback', () => {
    it('должен анализировать обратную связь и возвращать структурированный результат', async () => {
      // Настраиваем моки
      const mockPrompt = 'Это тестовый промпт для анализа';
      const mockLLMResponse = JSON.stringify({
        sentimentScore: 4,
        tone: "положительный",
        categories: ["UI", "функциональность"],
        suggestions: ["Улучшить навигацию"],
        issues: [],
        summary: "Позитивный отзыв о UI с предложением по навигации"
      });

      promptManagerStub.withArgs('feedback-analysis', sinon.match.any).resolves(mockPrompt);
      llmClientStub.withArgs(mockPrompt).resolves(mockLLMResponse);

      // Тестовая обратная связь
      const feedback = {
        id: '123',
        text: 'Мне нравится ваш интерфейс, но навигация может быть улучшена',
        rating: 4,
        userId: 'user1',
        taskId: 'task1',
        category: 'UI'
      };

      // Вызываем тестируемый метод
      const result = await feedbackAnalyzer.analyzeFeedback(feedback);

      // Проверяем результат
      expect(result).to.have.property('originalFeedback').that.deep.equals(feedback);
      expect(result).to.have.property('structuredAnalysis').that.is.an('object');
      expect(result.structuredAnalysis).to.have.property('sentimentScore', 4);
      expect(result.structuredAnalysis).to.have.property('categories').that.includes('UI');
      expect(result.structuredAnalysis).to.have.property('suggestions').that.includes('Улучшить навигацию');
      expect(result.structuredAnalysis).to.have.property('summary');
      expect(result).to.have.property('rawAnalysis').that.equals(mockLLMResponse);

      // Проверяем, что промпт-менеджер и LLM клиент были вызваны с правильными параметрами
      expect(promptManagerStub.calledOnce).to.be.true;
      expect(promptManagerStub.firstCall.args[0]).to.equal('feedback-analysis');
      expect(llmClientStub.calledOnce).to.be.true;
      expect(llmClientStub.firstCall.args[0]).to.equal(mockPrompt);
      
      // Проверяем, что логгер был вызван
      expect(loggerStub.calledOnce).to.be.true;
    });

    it('должен обрабатывать ошибки при анализе обратной связи', async () => {
      // Настраиваем моки для сценария с ошибкой
      promptManagerStub.withArgs('feedback-analysis', sinon.match.any).resolves('mock prompt');
      llmClientStub.withArgs('mock prompt').rejects(new Error('LLM API error'));

      // Тестовая обратная связь
      const feedback = {
        id: '123',
        text: 'Тестовый отзыв',
        rating: 3,
        userId: 'user1'
      };

      // Проверяем, что метод выбрасывает ошибку
      try {
        await feedbackAnalyzer.analyzeFeedback(feedback);
        // Если мы сюда попали, значит ошибка не была выброшена, и тест должен провалиться
        expect.fail('Должна была быть выброшена ошибка');
      } catch (error) {
        expect(error.message).to.include('Не удалось проанализировать обратную связь');
        expect(logger.error.calledOnce).to.be.true;
      }
    });
  });

  describe('analyzeCodeComments', () => {
    it('должен анализировать комментарии к коду и возвращать структурированный результат', async () => {
      // Настраиваем моки
      const mockPrompt = 'Это тестовый промпт для анализа комментариев';
      const mockLLMResponse = JSON.stringify({
        commentAnalysis: [
          {
            commentId: "1",
            type: "suggestion",
            severity: "minor",
            requiresAction: true,
            summary: "Предложение по улучшению кода"
          }
        ],
        overallAnalysis: {
          mainThemes: ["Улучшение читаемости"],
          criticalIssues: [],
          recommendations: ["Переименовать переменные"]
        },
        summary: "Предложения по улучшению читаемости кода"
      });

      promptManagerStub.withArgs('code-comments-analysis', sinon.match.any).resolves(mockPrompt);
      llmClientStub.withArgs(mockPrompt).resolves(mockLLMResponse);

      // Тестовые комментарии
      const options = {
        comments: [
          {
            id: '1',
            text: 'Лучше использовать более описательные имена переменных',
            user: 'reviewer1',
            filePath: 'src/example.js',
            lineNumber: 10
          }
        ],
        filePath: 'src/example.js'
      };

      // Вызываем тестируемый метод
      const result = await feedbackAnalyzer.analyzeCodeComments(options);

      // Проверяем результат
      expect(result).to.have.property('originalComments').that.deep.equals(options.comments);
      expect(result).to.have.property('structuredAnalysis').that.is.an('object');
      expect(result.structuredAnalysis).to.have.property('commentAnalysis').that.is.an('array');
      expect(result.structuredAnalysis).to.have.property('overallAnalysis').that.is.an('object');
      expect(result.structuredAnalysis.overallAnalysis).to.have.property('mainThemes').that.includes('Улучшение читаемости');
      expect(result).to.have.property('rawAnalysis').that.equals(mockLLMResponse);

      // Проверяем, что промпт-менеджер и LLM клиент были вызваны с правильными параметрами
      expect(promptManagerStub.calledOnce).to.be.true;
      expect(promptManagerStub.firstCall.args[0]).to.equal('code-comments-analysis');
      expect(llmClientStub.calledOnce).to.be.true;
      expect(llmClientStub.firstCall.args[0]).to.equal(mockPrompt);
    });
  });
});
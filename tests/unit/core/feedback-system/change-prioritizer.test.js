// tests/unit/core/feedback-system/change-prioritizer.test.js

const { expect } = require('chai');
const sinon = require('sinon');
const changePrioritizer = require('../../../../src/core/feedback-system/change-prioritizer');
const feedbackAnalyzer = require('../../../../src/core/feedback-system/feedback-analyzer');
const llmClient = require('../../../../src/utils/llm-client');
const promptManager = require('../../../../src/utils/prompt-manager');
const logger = require('../../../../src/utils/logger');
const FeedbackModel = require('../../../../src/models/feedback.model');
const TaskModel = require('../../../../src/models/task.model');

describe('ChangePrioritizer', () => {
  let llmClientStub, promptManagerStub, loggerStub, feedbackAnalyzerStub, feedbackModelStub, taskModelStub;

  beforeEach(() => {
    // Создаем заглушки для зависимостей
    llmClientStub = sinon.stub(llmClient, 'sendMessage');
    promptManagerStub = sinon.stub(promptManager, 'getPrompt');
    loggerStub = sinon.stub(logger, 'info');
    sinon.stub(logger, 'warn');
    sinon.stub(logger, 'error');
    feedbackAnalyzerStub = sinon.stub(feedbackAnalyzer, 'analyzeFeedback');
    feedbackModelStub = sinon.stub(FeedbackModel, 'findAll');
    taskModelStub = sinon.stub(TaskModel, 'create');
  });

  afterEach(() => {
    // Восстанавливаем оригинальные функции
    sinon.restore();
  });

  describe('prioritizeChanges', () => {
    it('должен приоритизировать изменения на основе обратной связи', async () => {
      // Настраиваем моки
      const mockFeedback = [
        {
          id: '1',
          text: 'Добавьте темную тему',
          rating: 5,
          category: 'UI',
          toJSON: () => ({
            id: '1',
            text: 'Добавьте темную тему',
            rating: 5,
            category: 'UI'
          })
        },
        {
          id: '2',
          text: 'Было бы хорошо добавить темную тему',
          rating: 4,
          category: 'UI',
          toJSON: () => ({
            id: '2',
            text: 'Было бы хорошо добавить темную тему',
            rating: 4,
            category: 'UI'
          })
        }
      ];
      
      feedbackModelStub.resolves(mockFeedback);
      
      const mockAnalysis1 = {
        structuredAnalysis: {
          suggestions: ['Добавить темную тему'],
          issues: []
        }
      };
      
      const mockAnalysis2 = {
        structuredAnalysis: {
          suggestions: ['Добавить темный режим'],
          issues: []
        }
      };
      
      feedbackAnalyzerStub.onFirstCall().resolves(mockAnalysis1);
      feedbackAnalyzerStub.onSecondCall().resolves(mockAnalysis2);
      
      const mockGroupPrompt = 'Это тестовый промпт для группировки предложений';
      const mockGroupResponse = JSON.stringify([
        {
          text: "Добавить темную тему",
          items: ["Добавить темную тему", "Добавить темный режим"],
          count: 2,
          feedbackIds: ["1", "2"],
          type: "suggestion"
        }
      ]);
      
      promptManagerStub.withArgs('group-similar-suggestions', sinon.match.any).resolves(mockGroupPrompt);
      llmClientStub.onFirstCall().resolves(mockGroupResponse);
      
      const mockPriorityPrompt = 'Это тестовый промпт для приоритизации';
      const mockPriorityResponse = JSON.stringify({
        reasoning: "Это популярный запрос с высоким рейтингом",
        suggestedChanges: [
          {
            id: "change-1",
            title: "Разработать и реализовать темную тему",
            priority: "high",
            originalSuggestion: "Добавить темную тему",
            count: 2,
            feedbackIds: ["1", "2"]
          }
        ]
      });
      
      promptManagerStub.withArgs('prioritize-changes', sinon.match.any).resolves(mockPriorityPrompt);
      llmClientStub.onSecondCall().resolves(mockPriorityResponse);
      
      // Вызываем тестируемый метод
      const options = {
        feedbackFilter: {
          category: 'UI',
          startDate: new Date(),
          endDate: new Date()
        }
      };
      
      const result = await changePrioritizer.prioritizeChanges(options);
      
      // Проверяем результат
      expect(result).to.have.property('reasoning').that.equals("Это популярный запрос с высоким рейтингом");
      expect(result).to.have.property('suggestedChanges').that.is.an('array').with.lengthOf(1);
      expect(result.suggestedChanges[0]).to.have.property('title', "Разработать и реализовать темную тему");
      expect(result.suggestedChanges[0]).to.have.property('priority', "high");
      expect(result.suggestedChanges[0]).to.have.property('count', 2);
      
      // Проверяем, что все нужные функции были вызваны
      expect(feedbackModelStub.calledOnce).to.be.true;
      expect(feedbackAnalyzerStub.calledTwice).to.be.true;
      expect(promptManagerStub.calledTwice).to.be.true;
      expect(llmClientStub.calledTwice).to.be.true;
    });
    
    it('должен возвращать сообщение, если нет данных обратной связи', async () => {
      // Настраиваем моки для пустого списка обратной связи
      feedbackModelStub.resolves([]);
      
      // Вызываем тестируемый метод
      const options = {
        feedbackFilter: {
          category: 'UI',
          startDate: new Date(),
          endDate: new Date()
        }
      };
      
      const result = await changePrioritizer.prioritizeChanges(options);
      
      // Проверяем результат
      expect(result).to.have.property('message').that.includes('Нет данных обратной связи');
      expect(result).to.have.property('suggestedChanges').that.is.an('array').that.is.empty;
      
      // Проверяем, что был вызван только feedbackModel.findAll
      expect(feedbackModelStub.calledOnce).to.be.true;
      expect(feedbackAnalyzerStub.called).to.be.false;
      expect(promptManagerStub.called).to.be.false;
      expect(llmClientStub.called).to.be.false;
    });
  });

  describe('createTasksFromChanges', () => {
    it('должен создавать задачи на основе приоритизированных изменений', async () => {
      // Настраиваем моки
      const mockTaskPrompt = 'Это тестовый промпт для преобразования изменения в задачу';
      const mockTaskResponse = JSON.stringify({
        title: "Разработать темную тему",
        description: "Реализовать темную тему для улучшения UX при использовании в ночное время"
      });
      
      promptManagerStub.withArgs('change-to-task', sinon.match.any).resolves(mockTaskPrompt);
      llmClientStub.withArgs(mockTaskPrompt).resolves(mockTaskResponse);
      
      const mockTask = {
        id: 'task123',
        title: "Разработать темную тему",
        description: "Реализовать темную тему для улучшения UX при использовании в ночное время",
        priority: "high",
        status: "open"
      };
      
      taskModelStub.resolves(mockTask);
      
      // Вызываем тестируемый метод
      const options = {
        changes: [
          {
            id: "change-1",
            title: "Разработать и реализовать темную тему",
            priority: "high",
            count: 2,
            feedbackIds: ["1", "2"]
          }
        ],
        projectId: 'project123',
        userId: 'user123'
      };
      
      const result = await changePrioritizer.createTasksFromChanges(options);
      
      // Проверяем результат
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('tasksCreated', 1);
      expect(result).to.have.property('tasks').that.is.an('array').with.lengthOf(1);
      expect(result.tasks[0]).to.deep.equal(mockTask);
      
      // Проверяем, что все нужные функции были вызваны
      expect(promptManagerStub.calledOnce).to.be.true;
      expect(promptManagerStub.firstCall.args[0]).to.equal('change-to-task');
      expect(llmClientStub.calledOnce).to.be.true;
      expect(taskModelStub.calledOnce).to.be.true;
      
      // Проверяем правильность параметров при создании задачи
      const taskCreateArgs = taskModelStub.firstCall.args[0];
      expect(taskCreateArgs).to.have.property('title', "Разработать темную тему");
      expect(taskCreateArgs).to.have.property('description').that.includes("темную тему");
      expect(taskCreateArgs).to.have.property('priority', "high");
      expect(taskCreateArgs).to.have.property('projectId', 'project123');
      expect(taskCreateArgs).to.have.property('userId', 'user123');
      expect(taskCreateArgs).to.have.property('metadata').that.is.an('object');
      expect(taskCreateArgs.metadata).to.have.property('source', 'feedback');
      expect(taskCreateArgs.metadata).to.have.property('feedbackIds').that.deep.equals(["1", "2"]);
    });
  });
});
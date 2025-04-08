// src/controller/git-integration/pr-controller.js

const PRManager = require('../../core/vcs-manager/pr-manager');
const logger = require('../../utils/logger');
const config = require('../../config/app.config');

/**
 * Контроллер для работы с Pull Request
 */
class PRController {
  /**
   * Создает новый Pull Request
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async createPR(req, res) {
    try {
      const options = {
        baseBranch: req.body.baseBranch,
        headBranch: req.body.headBranch,
        title: req.body.title,
        body: req.body.body,
        draft: req.body.draft,
        taskId: req.body.taskId,
        taskTitle: req.body.taskTitle,
        repositoryUrl: req.body.repositoryUrl || config.github?.repositoryUrl
      };
      
      logger.info('Запрос на создание PR:', options);
      
      const result = await PRManager.createPR(options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при создании PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Проверяет наличие конфликтов перед созданием PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async checkConflicts(req, res) {
    try {
      const options = {
        baseBranch: req.body.baseBranch,
        headBranch: req.body.headBranch,
        analyzeConflicts: req.body.analyzeConflicts || false
      };
      
      logger.info('Проверка конфликтов для веток:', options);
      
      const result = await PRManager.checkMergeConflicts(options);
      
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Ошибка при проверке конфликтов:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Генерирует описание для PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateDescription(req, res) {
    try {
      const options = {
        baseBranch: req.body.baseBranch,
        headBranch: req.body.headBranch,
        repositoryUrl: req.body.repositoryUrl || config.github?.repositoryUrl,
        taskId: req.body.taskId,
        taskTitle: req.body.taskTitle,
        taskDescription: req.body.taskDescription,
        includeChangeList: req.body.includeChangeList !== false
      };
      
      logger.info('Запрос на генерацию описания PR:', options);
      
      const description = await PRManager.generatePRDescription(options);
      
      return res.status(200).json({
        success: true,
        description
      });
    } catch (error) {
      logger.error('Ошибка при генерации описания PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Генерирует чеклист для ревью PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async generateChecklist(req, res) {
    try {
      const options = {
        baseBranch: req.body.baseBranch,
        headBranch: req.body.headBranch,
        repositoryUrl: req.body.repositoryUrl || config.github?.repositoryUrl,
        taskId: req.body.taskId,
        fileExtensions: req.body.fileExtensions,
        detailedChecklist: req.body.detailedChecklist
      };
      
      logger.info('Запрос на генерацию чеклиста для ревью:', options);
      
      const checklist = await PRManager.generateReviewChecklist(options);
      
      return res.status(200).json({
        success: true,
        checklist
      });
    } catch (error) {
      logger.error('Ошибка при генерации чеклиста для ревью:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Оценивает PR на основе чеклиста
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async evaluatePR(req, res) {
    try {
      const options = {
        baseBranch: req.body.baseBranch,
        headBranch: req.body.headBranch,
        prDescription: req.body.prDescription,
        checklist: req.body.checklist
      };
      
      logger.info('Запрос на оценку PR:', options);
      
      const evaluation = await PRManager.evaluatePR(options);
      
      return res.status(200).json({
        success: true,
        evaluation
      });
    } catch (error) {
      logger.error('Ошибка при оценке PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Получает информацию о PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async getPRInfo(req, res) {
    try {
      const options = {
        prId: req.params.prId || req.body.prId,
        repositoryUrl: req.body.repositoryUrl || config.github?.repositoryUrl
      };
      
      logger.info(`Запрос информации о PR ${options.prId}`);
      
      const result = await PRManager.getPRInfo(options);
      
      return res.status(200).json({
        success: true,
        pr: result.pr
      });
    } catch (error) {
      logger.error('Ошибка при получении информации о PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Обновляет PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async updatePR(req, res) {
    try {
      const options = {
        prId: req.params.prId || req.body.prId,
        title: req.body.title,
        body: req.body.body,
        state: req.body.state
      };
      
      logger.info(`Запрос на обновление PR ${options.prId}`);
      
      const result = await PRManager.updatePR(options);
      
      return res.status(200).json({
        success: true,
        pr: result.pr
      });
    } catch (error) {
      logger.error('Ошибка при обновлении PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Добавляет комментарий к PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async addComment(req, res) {
    try {
      const options = {
        prId: req.params.prId || req.body.prId,
        comment: req.body.comment
      };
      
      logger.info(`Запрос на добавление комментария к PR ${options.prId}`);
      
      const result = await PRManager.addPRComment(options);
      
      return res.status(200).json({
        success: true,
        comment: result.comment
      });
    } catch (error) {
      logger.error('Ошибка при добавлении комментария к PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  
  /**
   * Мерджит PR
   * @param {Object} req - Express запрос
   * @param {Object} res - Express ответ
   */
  async mergePR(req, res) {
    try {
      const options = {
        prId: req.params.prId || req.body.prId,
        mergeMethod: req.body.mergeMethod,
        commitTitle: req.body.commitTitle,
        commitMessage: req.body.commitMessage
      };
      
      logger.info(`Запрос на мердж PR ${options.prId}`);
      
      const result = await PRManager.mergePR(options);
      
      return res.status(200).json({
        success: true,
        result: result.result
      });
    } catch (error) {
      logger.error('Ошибка при мердже PR:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new PRController();
// src/api/routes/code-testing/index.js
const express = require('express');
const router = express.Router();
const codeTestingController = require('../../../controller/code-testing/code-testing.controller');
const authMiddleware = require('../../middleware/auth');
const validationMiddleware = require('../../middleware/validation');
const { testExistingCodeSchema } = require('./validation');

// Все эндпоинты требуют аутентификации
router.use(authMiddleware);

// Тестирование сгенерированного кода
router.post('/generation/:generationId', codeTestingController.testGeneratedCode);

// Тестирование существующего кода
router.post('/task/:taskId', 
  validationMiddleware(testExistingCodeSchema),
  codeTestingController.testExistingCode
);

// Получение отчета о тестировании
router.get('/report/:reportId', codeTestingController.getTestReport);

// Получение списка отчетов о тестировании
router.get('/reports', codeTestingController.getTestReports);

module.exports = router;

// src/api/routes/code-testing/validation.js
const Joi = require('joi');


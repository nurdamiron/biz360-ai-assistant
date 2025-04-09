// src/api/routes/feedback/validation.js
const Joi = require('joi');

// Validation schema for creating feedback
const feedbackValidationSchema = Joi.object({
  task_id: Joi.number().integer().allow(null),
  subtask_id: Joi.number().integer().allow(null),
  feedback_type: Joi.string().valid(
    'code_quality', 
    'code_correctness', 
    'task_decomposition', 
    'bug_fixing', 
    'refactoring', 
    'general'
  ).required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comments: Joi.string().allow('', null),
  specific_issues: Joi.array().items(
    Joi.object({
      issue_type: Joi.string().required(),
      description: Joi.string().required(),
      severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
      file_path: Joi.string().allow('', null),
      line_number: Joi.number().integer().allow(null)
    })
  ).allow(null),
  suggestions: Joi.string().allow('', null),
  ai_response_id: Joi.string().allow('', null),
  context: Joi.object().allow(null)
});

module.exports = {
  feedbackValidationSchema
};
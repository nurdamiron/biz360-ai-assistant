/**
 * @fileoverview Модуль определяет структуры данных (контракты) для взаимодействия
 * между компонентами системы оркестрации. Контракты представлены в виде JSON Schema
 * и используются для валидации данных, передаваемых между компонентами.
 */

/**
 * JSON Schema для контекста задачи.
 */
const ContextSchema = {
  type: 'object',
  required: ['taskId', 'createdAt', 'updatedAt', 'currentState', 'history'],
  properties: {
    taskId: { type: 'string' },
    projectId: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    task: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] }
      }
    },
    stepResults: {
      type: 'object',
      additionalProperties: true
    },
    currentState: { type: 'string' },
    history: {
      type: 'array',
      items: {
        type: 'object',
        required: ['timestamp', 'state'],
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          state: { type: 'string' },
          message: { type: 'string' }
        }
      }
    },
    data: {
      type: 'object',
      additionalProperties: true
    }
  }
};

/**
 * JSON Schema для перехода состояния задачи.
 */
const StateTransitionSchema = {
  type: 'object',
  required: ['taskId', 'fromState', 'toState', 'timestamp'],
  properties: {
    taskId: { type: 'string' },
    fromState: { type: 'string' },
    toState: { type: 'string' },
    message: { type: 'string' },
    metadata: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' }
  }
};

/**
 * Базовая JSON Schema для результата выполнения шага.
 */
const BaseStepResultSchema = {
  type: 'object',
  required: ['success'],
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
    warnings: {
      type: 'array',
      items: { type: 'string' }
    },
    summary: { type: 'object' },
    timestamp: { type: 'string', format: 'date-time' },
    duration: { type: 'number' }
  }
};

/**
 * JSON Schema для результата выполнения шага понимания задачи.
 */
const TaskUnderstandingResultSchema = {
  allOf: [
    { $ref: '#/definitions/BaseStepResult' },
    {
      type: 'object',
      required: ['taskAnalysis'],
      properties: {
        taskAnalysis: {
          type: 'object',
          required: ['taskType', 'taskDescription', 'requirements'],
          properties: {
            taskType: { type: 'string' },
            taskDescription: { type: 'string' },
            requirements: {
              type: 'array',
              items: { type: 'string' }
            },
            acceptanceCriteria: {
              type: 'array',
              items: { type: 'string' }
            },
            ambiguities: {
              type: 'array',
              items: { type: 'string' }
            },
            clarificationQuestions: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        taskClassification: {
          type: 'object',
          properties: {
            complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
            domain: { type: 'string' },
            techStack: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  ]
};

/**
 * JSON Schema для результата выполнения шага анализа контекста проекта.
 */
const ProjectUnderstandingResultSchema = {
  allOf: [
    { $ref: '#/definitions/BaseStepResult' },
    {
      type: 'object',
      required: ['projectStructure'],
      properties: {
        projectStructure: {
          type: 'object',
          properties: {
            fileTree: { type: 'object' },
            codebaseSize: { type: 'number' },
            mainLanguages: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        dependencies: {
          type: 'object',
          properties: {
            direct: {
              type: 'array',
              items: { type: 'string' }
            },
            dev: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        },
        architecture: {
          type: 'object',
          properties: {
            patterns: {
              type: 'array',
              items: { type: 'string' }
            },
            components: {
              type: 'array',
              items: { type: 'object' }
            },
            relations: {
              type: 'array',
              items: { type: 'object' }
            }
          }
        },
        codeQuality: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: { type: 'object' }
            },
            metrics: { type: 'object' }
          }
        },
        relevantFiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              reason: { type: 'string' },
              content: { type: 'string' }
            }
          }
        }
      }
    }
  ]
};

/**
 * JSON Schema для результата выполнения шага планирования задачи.
 */
const TaskPlannerResultSchema = {
  allOf: [
    { $ref: '#/definitions/BaseStepResult' },
    {
      type: 'object',
      required: ['plan'],
      properties: {
        plan: {
          type: 'object',
          required: ['tasks'],
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'description'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                  dependencies: {
                    type: 'array',
                    items: { type: 'string' }
                  }
                }
              }
            },
            executionStrategy: { type: 'string' },
            estimatedEffort: { type: 'string' }
          }
        },
        alternatives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              pros: {
                type: 'array',
                items: { type: 'string' }
              },
              cons: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }
      }
    }
  ]
};

/**
 * JSON Schema для результата выполнения шага выбора технологий.
 */
const TechnologySuggesterResultSchema = {
  allOf: [
    { $ref: '#/definitions/BaseStepResult' },
    {
      type: 'object',
      required: ['recommendations'],
      properties: {
        recommendations: {
          type: 'object',
          properties: {
            languages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  reason: { type: 'string' }
                }
              }
            },
            frameworks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  reason: { type: 'string' }
                }
              }
            },
            libraries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  reason: { type: 'string' }
                }
              }
            },
            tools: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  reason: { type: 'string' }
                }
              }
            }
          }
        },
        compatibility: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  solution: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  ]
};

/**
 * JSON Schema для результата выполнения шага генерации кода.
 */
const CodeGeneratorResultSchema = {
  allOf: [
    { $ref: '#/definitions/BaseStepResult' },
    {
      type: 'object',
      required: ['generatedFiles'],
      properties: {
        generatedFiles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'content'],
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              language: { type: 'string' },
              isNew: { type: 'boolean' },
              isModified: { type: 'boolean' }
            }
          }
        },
        diffWithExisting: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              diff: { type: 'string' }
            }
          }
        },
        explanation: { type: 'string' }
      }
    }
  ]
};

/**
 * JSON Schema для входных данных шага.
 */
const StepInputSchema = {
  type: 'object',
  required: ['taskId'],
  properties: {
    taskId: { type: 'string' },
    projectId: { type: 'string' },
    task: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        priority: { type: 'string' }
      }
    }
  },
  additionalProperties: true
};

/**
 * JSON Schema для метаданных шага.
 */
const StepMetadataSchema = {
  type: 'object',
  required: ['name', 'description'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    timeout: { type: 'number' },
    maxRetries: { type: 'number' },
    requiresLLM: { type: 'boolean' },
    requiresGit: { type: 'boolean' },
    requiresExecution: { type: 'boolean' },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' }
  }
};

// Объединяем все схемы в один объект для экспорта
const schemas = {
  ContextSchema,
  StateTransitionSchema,
  BaseStepResultSchema,
  TaskUnderstandingResultSchema,
  ProjectUnderstandingResultSchema,
  TaskPlannerResultSchema,
  TechnologySuggesterResultSchema,
  CodeGeneratorResultSchema,
  StepInputSchema,
  StepMetadataSchema
};

module.exports = schemas;
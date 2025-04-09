/**
 * Модуль для экспорта всех моделей данных
 */
const Sequelize = require('sequelize');
const dbConfig = require('../config/db.config');
const logger = require('../utils/logger');

// Создаем экземпляр Sequelize
const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: 'mysql',
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    logging: process.env.NODE_ENV === 'development' 
      ? (msg) => logger.debug(msg) 
      : false
  }
);

// Инициализация моделей
const User = require('./user.model')(sequelize, Sequelize);
const Project = require('./project.model')(sequelize, Sequelize);
const Task = require('./task.model')(sequelize, Sequelize);
const Subtask = require('./subtask.model')(sequelize, Sequelize);
const Comment = require('./comment.model')(sequelize, Sequelize);
const CodeGeneration = require('./code-generation.model')(sequelize, Sequelize);
const LlmInteraction = require('./llm-interaction.model')(sequelize, Sequelize);
const LlmTokenUsage = require('./llm-token-usage.model')(sequelize, Sequelize);
const ProjectFile = require('./project-file.model')(sequelize, Sequelize);
const CodeVector = require('./code-vector.model')(sequelize, Sequelize);
const TaskQueue = require('./task-queue.model')(sequelize, Sequelize);
const TaskLog = require('./task-log.model')(sequelize, Sequelize);
const Feedback = require('./feedback.model')(sequelize, Sequelize);

// Определение ассоциаций между моделями

// Связи проектов
Project.hasMany(Task, { foreignKey: 'project_id', as: 'tasks' });
Project.hasMany(ProjectFile, { foreignKey: 'project_id', as: 'files' });

// Связи задач
Task.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Task.belongsTo(Task, { foreignKey: 'parent_task_id', as: 'parentTask' });
Task.hasMany(Task, { foreignKey: 'parent_task_id', as: 'childTasks' });
Task.hasMany(Subtask, { foreignKey: 'task_id', as: 'subtasks' });
Task.hasMany(Comment, { foreignKey: 'task_id', as: 'comments' });
Task.hasMany(CodeGeneration, { foreignKey: 'task_id', as: 'codeGenerations' });
Task.hasMany(LlmInteraction, { foreignKey: 'task_id', as: 'llmInteractions' });
Task.hasMany(TaskLog, { foreignKey: 'task_id', as: 'logs' });

// Связи подзадач
Subtask.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
Subtask.hasMany(Comment, { foreignKey: 'subtask_id', as: 'comments' });

// Связи комментариев
Comment.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
Comment.belongsTo(Subtask, { foreignKey: 'subtask_id', as: 'subtask' });
Comment.belongsTo(User, { foreignKey: 'user_id', as: 'author' });
Comment.belongsTo(Comment, { foreignKey: 'parent_comment_id', as: 'parentComment' });
Comment.hasMany(Comment, { foreignKey: 'parent_comment_id', as: 'replies' });

// Связи файлов проекта
ProjectFile.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
ProjectFile.hasMany(CodeVector, { foreignKey: 'file_id', as: 'codeVectors' });

// Связи векторов кода
CodeVector.belongsTo(ProjectFile, { foreignKey: 'file_id', as: 'file' });

// Связи генераций кода
CodeGeneration.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
CodeGeneration.hasMany(Feedback, { foreignKey: 'code_generation_id', as: 'feedback' });

// Связи отзывов
Feedback.belongsTo(CodeGeneration, { foreignKey: 'code_generation_id', as: 'codeGeneration' });
Feedback.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Связи взаимодействий с LLM
LlmInteraction.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
LlmInteraction.hasMany(LlmTokenUsage, { foreignKey: 'llm_interaction_id', as: 'tokenUsage' });

// Связи использования токенов
LlmTokenUsage.belongsTo(LlmInteraction, { foreignKey: 'llm_interaction_id', as: 'llmInteraction' });
LlmTokenUsage.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
LlmTokenUsage.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Запуск ассоциаций для моделей, которые используют метод associate
const models = {
  User,
  Project,
  Task,
  Subtask,
  Comment,
  CodeGeneration,
  LlmInteraction,
  LlmTokenUsage,
  ProjectFile,
  CodeVector,
  TaskQueue,
  TaskLog,
  Feedback
};

// Вызываем метод associate для каждой модели, если он существует
Object.values(models).forEach(model => {
  if ('associate' in model) {
    model.associate(models);
  }
});

// Экспорт моделей и экземпляра Sequelize
module.exports = {
  sequelize,
  Sequelize,
  ...models
};
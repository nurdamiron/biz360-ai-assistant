// src/config/db.initialize.js

/**
 * Модуль для инициализации структуры базы данных
 * Создает все необходимые таблицы при первом запуске
 */

const { pool } = require('./db.config');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * Создает все необходимые таблицы в базе данных
 * @returns {Promise<void>}
 */
async function initializeDatabase() {
  const connection = await pool.getConnection();
  
  try {
    logger.info('Начало инициализации базы данных...');
    
    // Получаем список существующих таблиц
    const [tables] = await connection.query(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ?",
      [process.env.DB_NAME]
    );
    
    const existingTables = tables.map(row => row.TABLE_NAME);
    logger.info(`Существующие таблицы: ${existingTables.join(', ')}`);
    
    // Запускаем создание каждой таблицы, если она еще не существует
    await createUsersTable(connection, existingTables);
    await createProjectsTable(connection, existingTables);
    await createProjectSettingsTable(connection, existingTables);
    await createTagsTable(connection, existingTables);
    await createProjectTagsTable(connection, existingTables);
    await createTasksTable(connection, existingTables);
    await createSubtasksTable(connection, existingTables);
    await createTaskQueueTable(connection, existingTables);
    await createProjectFilesTable(connection, existingTables);
    await createCodeVectorsTable(connection, existingTables);
    await createCodeGenerationsTable(connection, existingTables);
    await createCommitsTable(connection, existingTables);
    await createTestsTable(connection, existingTables);
    await createFeedbackTable(connection, existingTables);
    await createLlmInteractionsTable(connection, existingTables);
    await createLlmTokenUsageTable(connection, existingTables);
    await createApiKeysTable(connection, existingTables);
    await createApiKeyLogsTable(connection, existingTables);
    await createTaskLogsTable(connection, existingTables);
    await createSchemaTablesTable(connection, existingTables);
    await createSchemaColumnsTable(connection, existingTables);
    await createSchemaRelationsTable(connection, existingTables);
    await createMigrationsTable(connection, existingTables);

    // Проверяем наличие колонок в существующих таблицах и добавляем их, если необходимо
    await updateExistingTables(connection);
    
    logger.info('Инициализация базы данных успешно завершена');
  } catch (error) {
    logger.error('Ошибка при инициализации базы данных:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Создает таблицу пользователей
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createUsersTable(connection, existingTables) {
  if (!existingTables.includes('users')) {
    logger.info('Создание таблицы users...');
    
    await connection.query(`
      CREATE TABLE users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('user', 'manager', 'admin') NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (role)
      )
    `);
    
    // Создаем первого администратора с временным паролем
    // В реальном проекте пароль должен быть надежным и изменен после первого входа
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await connection.query(`
      INSERT INTO users (username, email, password, role, active)
      VALUES (?, ?, ?, ?, ?)
    `, ['admin', 'admin@biz360.local', hashedPassword, 'admin', true]);
    
    logger.info('Таблица users создана. Добавлен пользователь admin (admin123)');
  }
}

/**
 * Создает таблицу проектов с обновленной структурой
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createProjectsTable(connection, existingTables) {
  if (!existingTables.includes('projects')) {
    logger.info('Создание таблицы projects...');
    
    await connection.query(`
      CREATE TABLE projects (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        repository_url VARCHAR(255) NOT NULL,
        status ENUM('active', 'inactive', 'archived') DEFAULT 'active',
        github_repo_connected BOOLEAN DEFAULT FALSE,
        last_analyzed TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by INT,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX (status)
      )
    `);
    
    logger.info('Таблица projects создана');
  }
}

/**
 * Создает таблицу настроек проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createProjectSettingsTable(connection, existingTables) {
  if (!existingTables.includes('project_settings')) {
    logger.info('Создание таблицы project_settings...');
    
    await connection.query(`
      CREATE TABLE project_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        setting_key VARCHAR(50) NOT NULL,
        setting_value JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_project_setting (project_id, setting_key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);
    
    logger.info('Таблица project_settings создана');
  }
}

/**
 * Создает таблицу тегов
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createTagsTable(connection, existingTables) {
  if (!existingTables.includes('tags')) {
    logger.info('Создание таблицы tags...');
    
    await connection.query(`
      CREATE TABLE tags (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL,
        description VARCHAR(255),
        color VARCHAR(20) DEFAULT '#3498db',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_tag_name (name)
      )
    `);
    
    // Добавляем стандартные теги
    await connection.query(`
      INSERT INTO tags (name, description, color) VALUES
      ('backend', 'Backend development tasks', '#3498db'),
      ('frontend', 'Frontend development tasks', '#2ecc71'),
      ('bug', 'Bug fixes', '#e74c3c'),
      ('feature', 'New features', '#9b59b6'),
      ('enhancement', 'Enhancement of existing features', '#f1c40f'),
      ('documentation', 'Documentation tasks', '#1abc9c'),
      ('devops', 'DevOps related tasks', '#e67e22'),
      ('security', 'Security related tasks', '#c0392b'),
      ('testing', 'Testing related tasks', '#16a085'),
      ('ui', 'User interface tasks', '#d35400')
    `);
    
    logger.info('Таблица tags создана');
  }
}

/**
 * Создает таблицу тегов проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createProjectTagsTable(connection, existingTables) {
  if (!existingTables.includes('project_tags')) {
    logger.info('Создание таблицы project_tags...');
    
    await connection.query(`
      CREATE TABLE project_tags (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        tag_name VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_project_tag (project_id, tag_name),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE
      )
    `);
    
    logger.info('Таблица project_tags создана');
  }
}

/**
 * Создает таблицу задач
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createTasksTable(connection, existingTables) {
  if (!existingTables.includes('tasks')) {
    logger.info('Создание таблицы tasks...');
    
    await connection.query(`
      CREATE TABLE tasks (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
        priority ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
        parent_task_id INT NULL,
        assigned_to INT NULL,
        pull_request_number INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
        INDEX (status),
        INDEX (priority)
      )
    `);
    
    logger.info('Таблица tasks создана');
  }
}

/**
 * Создает таблицу подзадач
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createSubtasksTable(connection, existingTables) {
  if (!existingTables.includes('subtasks')) {
    logger.info('Создание таблицы subtasks...');
    
    await connection.query(`
      CREATE TABLE subtasks (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
        sequence_number INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX (status)
      )
    `);
    
    logger.info('Таблица subtasks создана');
  }
}

/**
 * Создает таблицу очереди задач
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createTaskQueueTable(connection, existingTables) {
  if (!existingTables.includes('task_queue')) {
    logger.info('Создание таблицы task_queue...');
    
    await connection.query(`
      CREATE TABLE task_queue (
        id INT PRIMARY KEY AUTO_INCREMENT,
        type VARCHAR(50) NOT NULL,
        data JSON NOT NULL,
        priority INT DEFAULT 5,
        status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        INDEX (status),
        INDEX (type)
      )
    `);
    
    logger.info('Таблица task_queue создана');
  }
}

/**
 * Создает таблицу файлов проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createProjectFilesTable(connection, existingTables) {
  if (!existingTables.includes('project_files')) {
    logger.info('Создание таблицы project_files...');
    
    await connection.query(`
      CREATE TABLE project_files (
        id INT PRIMARY KEY AUTO_INCREMENT,
        project_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        last_analyzed TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE KEY (project_id, file_path),
        INDEX (file_type)
      )
    `);
    
    logger.info('Таблица project_files создана');
  }
}

/**
 * Создает таблицу векторных представлений кода
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createCodeVectorsTable(connection, existingTables) {
  if (!existingTables.includes('code_vectors')) {
    logger.info('Создание таблицы code_vectors...');
    
    await connection.query(`
      CREATE TABLE code_vectors (
        id INT PRIMARY KEY AUTO_INCREMENT,
        file_id INT NOT NULL,
        code_segment TEXT NOT NULL,
        start_line INT NOT NULL,
        end_line INT NOT NULL,
        embedding JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
      )
    `);
    
    logger.info('Таблица code_vectors создана');
  }
}

/**
 * Создает таблицу генераций кода
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createCodeGenerationsTable(connection, existingTables) {
  if (!existingTables.includes('code_generations')) {
    logger.info('Создание таблицы code_generations...');
    
    await connection.query(`
      CREATE TABLE code_generations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        original_content TEXT,
        generated_content TEXT NOT NULL,
        status ENUM('pending_review', 'approved', 'rejected', 'implemented') DEFAULT 'pending_review',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX (status)
      )
    `);
    
    logger.info('Таблица code_generations создана');
  }
}

/**
 * Создает таблицу коммитов
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createCommitsTable(connection, existingTables) {
  if (!existingTables.includes('commits')) {
    logger.info('Создание таблицы commits...');
    
    await connection.query(`
      CREATE TABLE commits (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        commit_hash VARCHAR(64) NOT NULL,
        commit_message VARCHAR(255) NOT NULL,
        committed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX (commit_hash)
      )
    `);
    
    logger.info('Таблица commits создана');
  }
}

/**
 * Создает таблицу тестов
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createTestsTable(connection, existingTables) {
  if (!existingTables.includes('tests')) {
    logger.info('Создание таблицы tests...');
    
    await connection.query(`
      CREATE TABLE tests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code_generation_id INT NOT NULL,
        test_name VARCHAR(255) NOT NULL,
        test_content TEXT NOT NULL,
        result ENUM('pending', 'passed', 'failed') DEFAULT 'pending',
        output TEXT,
        coverage JSON,
        execution_time INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (code_generation_id) REFERENCES code_generations(id) ON DELETE CASCADE,
        INDEX (result)
      )
    `);
    
    logger.info('Таблица tests создана');
  }
}

/**
 * Создает таблицу обратной связи
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createFeedbackTable(connection, existingTables) {
  if (!existingTables.includes('feedback')) {
    logger.info('Создание таблицы feedback...');
    
    await connection.query(`
      CREATE TABLE feedback (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code_generation_id INT NOT NULL,
        feedback_text TEXT NOT NULL,
        rating INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INT,
        FOREIGN KEY (code_generation_id) REFERENCES code_generations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    
    logger.info('Таблица feedback создана');
  }
}

/**
 * Создает таблицу взаимодействий с LLM
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createLlmInteractionsTable(connection, existingTables) {
  if (!existingTables.includes('llm_interactions')) {
    logger.info('Создание таблицы llm_interactions...');
    
    await connection.query(`
      CREATE TABLE llm_interactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        model_used VARCHAR(50) NOT NULL,
        tokens_used INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      )
    `);
    
    logger.info('Таблица llm_interactions создана');
  }
}

/**
 * Создает таблицу использования токенов LLM
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createLlmTokenUsageTable(connection, existingTables) {
  if (!existingTables.includes('llm_token_usage')) {
    logger.info('Создание таблицы llm_token_usage...');
    
    await connection.query(`
      CREATE TABLE llm_token_usage (
        id INT PRIMARY KEY AUTO_INCREMENT,
        date DATE NOT NULL,
        prompt_tokens INT NOT NULL,
        completion_tokens INT NOT NULL,
        total_tokens INT NOT NULL,
        models_usage JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY (date)
      )
    `);
    
    logger.info('Таблица llm_token_usage создана');
  }
}

/**
 * Создает таблицу API ключей
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createApiKeysTable(connection, existingTables) {
  if (!existingTables.includes('api_keys')) {
    logger.info('Создание таблицы api_keys...');
    
    await connection.query(`
      CREATE TABLE api_keys (
        id INT PRIMARY KEY AUTO_INCREMENT,
        api_key VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        user_id INT,
        scope VARCHAR(255),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    logger.info('Таблица api_keys создана');
  }
}

/**
 * Создает таблицу логов использования API ключей
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createApiKeyLogsTable(connection, existingTables) {
  if (!existingTables.includes('api_key_logs')) {
    logger.info('Создание таблицы api_key_logs...');
    
    await connection.query(`
      CREATE TABLE api_key_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        api_key_id INT NOT NULL,
        method VARCHAR(10) NOT NULL,
        path VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        user_agent VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      )
    `);
    
    logger.info('Таблица api_key_logs создана');
  }
}

/**
 * Создает таблицу логов задач
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createTaskLogsTable(connection, existingTables) {
  if (!existingTables.includes('task_logs')) {
    logger.info('Создание таблицы task_logs...');
    
    await connection.query(`
      CREATE TABLE task_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        task_id INT NOT NULL,
        log_type ENUM('info', 'warning', 'error', 'progress') NOT NULL,
        message TEXT NOT NULL,
        progress INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        INDEX (log_type)
      )
    `);
    
    logger.info('Таблица task_logs создана');
  }
}

/**
 * Создает таблицу для хранения информации о таблицах БД проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createSchemaTablesTable(connection, existingTables) {
  if (!existingTables.includes('schema_tables')) {
    logger.info('Создание таблицы schema_tables...');
    
    await connection.query(`
      CREATE TABLE schema_tables (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(64) NOT NULL,
        structure JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY (name)
      )
    `);
    
    logger.info('Таблица schema_tables создана');
  }
}

/**
 * Создает таблицу для хранения информации о колонках таблиц БД проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createSchemaColumnsTable(connection, existingTables) {
  if (!existingTables.includes('schema_columns')) {
    logger.info('Создание таблицы schema_columns...');
    
    await connection.query(`
      CREATE TABLE schema_columns (
        id INT PRIMARY KEY AUTO_INCREMENT,
        table_id INT NOT NULL,
        name VARCHAR(64) NOT NULL,
        type VARCHAR(64) NOT NULL,
        nullable BOOLEAN NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (table_id) REFERENCES schema_tables(id) ON DELETE CASCADE,
        UNIQUE KEY (table_id, name)
      )
    `);
    
    logger.info('Таблица schema_columns создана');
  }
}

/**
 * Создает таблицу для хранения информации о связях между таблицами БД проекта
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createSchemaRelationsTable(connection, existingTables) {
  if (!existingTables.includes('schema_relations')) {
    logger.info('Создание таблицы schema_relations...');
    
    await connection.query(`
      CREATE TABLE schema_relations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        source_table VARCHAR(64) NOT NULL,
        source_column VARCHAR(64) NOT NULL,
        target_table VARCHAR(64) NOT NULL,
        target_column VARCHAR(64) NOT NULL,
        on_delete VARCHAR(20) NOT NULL,
        on_update VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY (source_table, source_column, target_table, target_column)
      )
    `);
    
    logger.info('Таблица schema_relations создана');
  }
}

/**
 * Создает таблицу для отслеживания применённых миграций
 * @param {Object} connection - Соединение с БД
 * @param {Array<string>} existingTables - Список существующих таблиц
 * @returns {Promise<void>}
 */
async function createMigrationsTable(connection, existingTables) {
  if (!existingTables.includes('schema_migrations')) {
    logger.info('Создание таблицы schema_migrations...');
    
    await connection.query(`
      CREATE TABLE schema_migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_migration_name (name)
      )
    `);
    
    logger.info('Таблица schema_migrations создана');
  }
}

/**
 * Проверяет наличие и добавляет недостающие колонки в существующие таблицы
 * @param {Object} connection - Соединение с БД
 * @returns {Promise<void>}
 */
async function updateExistingTables(connection) {
  try {
    logger.info('Проверка и обновление существующих таблиц...');
    
    // Проверяем наличие колонки status в таблице projects
    const [projectsColumns] = await connection.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'projects' AND COLUMN_NAME = 'status'",
      [process.env.DB_NAME]
    );
    
    if (projectsColumns.length === 0) {
      logger.info('Добавление колонки status в таблицу projects...');
      await connection.query(`
        ALTER TABLE projects
        ADD COLUMN status ENUM('active', 'inactive', 'archived') DEFAULT 'active' AFTER repository_url,
        ADD INDEX (status)
      `);
      logger.info('Колонка status добавлена в таблицу projects');
    }
    
    // Проверяем наличие колонки github_repo_connected в таблице projects
    const [githubConnectedColumns] = await connection.query(
      "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'projects' AND COLUMN_NAME = 'github_repo_connected'",
      [process.env.DB_NAME]
    );
    
    if (githubConnectedColumns.length === 0) {
      logger.info('Добавление колонки github_repo_connected в таблицу projects...');
      await connection.query(`
        ALTER TABLE projects
        ADD COLUMN github_repo_connected BOOLEAN DEFAULT FALSE AFTER status
      `);
      logger.info('Колонка github_repo_connected добавлена в таблицу projects');
    }
    
    // Добавьте здесь проверки других таблиц и колонок по мере необходимости
    
    logger.info('Обновление существующих таблиц завершено');
  } catch (error) {
    logger.error('Ошибка при обновлении существующих таблиц:', error);
    throw error;
  }
}

// Инициализируем таблицы для проектных настроек и тегов в существующих проектах
async function initializeSettingsAndTags(connection) {
  try {
    logger.info('Инициализация настроек и тегов для существующих проектов...');
    
    // Получаем список существующих проектов
    const [projects] = await connection.query('SELECT id FROM projects');
    
    if (projects.length === 0) {
      logger.info('Нет существующих проектов для инициализации настроек');
      return;
    }
    
    // Для каждого проекта добавляем настройки по умолчанию
    for (const project of projects) {
      const projectId = project.id;
      
      // Настройки анализа кода
      await connection.query(
        `INSERT IGNORE INTO project_settings (project_id, setting_key, setting_value) 
         VALUES (?, ?, ?)`,
        [projectId, 'code_analysis', JSON.stringify({
          enabled: true,
          auto_index: true,
          exclude_patterns: ['node_modules', 'dist', '.git', 'build', 'coverage']
        })]
      );
      
      // Настройки интеграции с Git
      await connection.query(
        `INSERT IGNORE INTO project_settings (project_id, setting_key, setting_value) 
         VALUES (?, ?, ?)`,
        [projectId, 'git_integration', JSON.stringify({
          auto_commit: false,
          branch_prefix: 'ai-task-',
          auto_pr: true
        })]
      );
      
      // Настройки AI-ассистента
      await connection.query(
        `INSERT IGNORE INTO project_settings (project_id, setting_key, setting_value) 
         VALUES (?, ?, ?)`,
        [projectId, 'ai_assistant', JSON.stringify({
          code_generation_enabled: true,
          code_review_enabled: true,
          max_tokens_per_request: 8000
        })]
      );
      
      // Настройки уведомлений
      await connection.query(
        `INSERT IGNORE INTO project_settings (project_id, setting_key, setting_value) 
         VALUES (?, ?, ?)`,
        [projectId, 'notifications', JSON.stringify({
          email_notifications: false,
          slack_notifications: false,
          slack_webhook: ''
        })]
      );
      
      // Настройки команды
      await connection.query(
        `INSERT IGNORE INTO project_settings (project_id, setting_key, setting_value) 
         VALUES (?, ?, ?)`,
        [projectId, 'team_settings', JSON.stringify({
          default_assignee: '',
          require_review: true,
          team_members: []
        })]
      );
    }
    
    logger.info(`Настройки по умолчанию добавлены для ${projects.length} проектов`);
  } catch (error) {
    logger.error('Ошибка при инициализации настроек и тегов:', error);
    throw error;
  }
}

module.exports = {
  initializeDatabase
};
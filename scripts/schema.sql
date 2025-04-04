-- Скрипт для инициализации базы данных Biz360 AI Assistant

-- Создание базы данных
CREATE DATABASE IF NOT EXISTS biz360_ai_assistant;
USE biz360_ai_assistant;

-- Проекты
CREATE TABLE IF NOT EXISTS projects (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  repository_url VARCHAR(255) NOT NULL,
  last_analyzed TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Файлы проекта
CREATE TABLE IF NOT EXISTS project_files (
  id INT PRIMARY KEY AUTO_INCREMENT,
  project_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  last_analyzed TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Векторные представления кода
CREATE TABLE IF NOT EXISTS code_vectors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  file_id INT NOT NULL,
  code_segment TEXT NOT NULL,
  start_line INT NOT NULL,
  end_line INT NOT NULL,
  embedding JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
);

-- Схема БД для представления в системе
CREATE TABLE IF NOT EXISTS schema_tables (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  structure JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Колонки в схеме БД
CREATE TABLE IF NOT EXISTS schema_columns (
  id INT PRIMARY KEY AUTO_INCREMENT,
  table_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  nullable BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES schema_tables(id) ON DELETE CASCADE
);

-- Отношения в схеме БД
CREATE TABLE IF NOT EXISTS schema_relations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  source_table VARCHAR(100) NOT NULL,
  source_column VARCHAR(100) NOT NULL,
  target_table VARCHAR(100) NOT NULL,
  target_column VARCHAR(100) NOT NULL,
  on_delete VARCHAR(20) DEFAULT 'RESTRICT',
  on_update VARCHAR(20) DEFAULT 'RESTRICT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Задачи
CREATE TABLE IF NOT EXISTS tasks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  project_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'medium',
  parent_task_id INT NULL,
  pull_request_number INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Подзадачи
CREATE TABLE IF NOT EXISTS subtasks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  task_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
  sequence_number INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Генерации кода
CREATE TABLE IF NOT EXISTS code_generations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  task_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  original_content TEXT,
  generated_content TEXT NOT NULL,
  status ENUM('pending_review', 'approved', 'rejected', 'implemented') DEFAULT 'pending_review',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Коммиты
CREATE TABLE IF NOT EXISTS commits (
  id INT PRIMARY KEY AUTO_INCREMENT,
  task_id INT NOT NULL,
  commit_hash VARCHAR(64) NOT NULL,
  commit_message TEXT NOT NULL,
  committed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Обратная связь
CREATE TABLE IF NOT EXISTS feedback (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code_generation_id INT NOT NULL,
  feedback_text TEXT NOT NULL,
  rating INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (code_generation_id) REFERENCES code_generations(id) ON DELETE CASCADE
);

-- Тесты
CREATE TABLE IF NOT EXISTS tests (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code_generation_id INT NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  test_content TEXT NOT NULL,
  result ENUM('pending', 'passed', 'failed') DEFAULT 'pending',
  output TEXT,
  coverage JSON,
  execution_time INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (code_generation_id) REFERENCES code_generations(id) ON DELETE CASCADE
);

-- Взаимодействия с LLM
CREATE TABLE IF NOT EXISTS llm_interactions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  task_id INT,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  model_used VARCHAR(50),
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Очередь задач системы
CREATE TABLE IF NOT EXISTS task_queue (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type VARCHAR(50) NOT NULL,
  data JSON NOT NULL,
  priority INT DEFAULT 5,
  status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  role ENUM('user', 'manager', 'admin') DEFAULT 'user',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL
);

-- Таблица API ключей
CREATE TABLE IF NOT EXISTS api_keys (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_key VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  user_id INT,
  scope VARCHAR(255),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Логи использования API ключей
CREATE TABLE IF NOT EXISTS api_key_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  api_key_id INT NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50) NOT NULL,
  user_agent VARCHAR(255),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);

-- Сессии пользователей
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  token VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50) NOT NULL,
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Создание индексов
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_key_logs_api_key_id ON api_key_logs(api_key_id);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);

-- Создание начального администратора (пароль: admin123)
-- В реальной системе пароль нужно изменить
INSERT INTO users (username, password, email, role, active)
SELECT 'admin', '$2b$10$3euPcmQFCiblsZeEu5s7p.9OVHgeHWFDk9y1mLR/qP5UmG4UrZpLm', 'admin@example.com', 'admin', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT id FROM users WHERE username = 'admin'
);

-- Создание начального API ключа для системы
INSERT INTO api_keys (api_key, name, scope, active)
SELECT '12345678abcdef0123456789abcdef0123456789abcdef0123456789abcdef0', 'System API Key', 'system', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT id FROM api_keys WHERE name = 'System API Key'
);

-- Индексы
CREATE INDEX idx_project_files_path ON project_files(file_path);
CREATE INDEX idx_code_generations_task ON code_generations(task_id);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_task_queue_status ON task_queue(status, priority);

-- Создание пользователя для приложения
-- CREATE USER IF NOT EXISTS 'biz360_admin'@'localhost' IDENTIFIED BY 'your_password';
-- GRANT ALL PRIVILEGES ON biz360_ai_assistant.* TO 'biz360_admin'@'localhost';
-- FLUSH PRIVILEGES;
-- Таблица проектов
CREATE TABLE IF NOT EXISTS `projects` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `repository_url` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Таблица файлов
CREATE TABLE IF NOT EXISTS `project_files` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `project_id` INT NOT NULL,
  `file_path` VARCHAR(512) NOT NULL,
  `file_type` VARCHAR(50) NOT NULL,
  `last_commit_hash` VARCHAR(40),
  `last_analyzed` TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);

-- Таблица с векторными представлениями кода
CREATE TABLE IF NOT EXISTS `code_vectors` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `file_id` INT NOT NULL,
  `code_segment` TEXT NOT NULL,
  `start_line` INT NOT NULL,
  `end_line` INT NOT NULL,
  `embedding` JSON,  -- Хранение векторного представления как JSON
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`file_id`) REFERENCES `project_files`(`id`) ON DELETE CASCADE
);

-- Таблица для задач
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `project_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `status` ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
  `priority` ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  `parent_task_id` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON DELETE SET NULL
);

-- Таблица для подзадач
CREATE TABLE IF NOT EXISTS `subtasks` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `status` ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
  `sequence_number` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);

-- Таблица для генерируемого кода
CREATE TABLE IF NOT EXISTS `code_generations` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `file_path` VARCHAR(512) NOT NULL,
  `original_content` TEXT,
  `generated_content` TEXT NOT NULL,
  `status` ENUM('pending_review', 'approved', 'rejected', 'implemented') DEFAULT 'pending_review',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);

-- Таблица для обратной связи
CREATE TABLE IF NOT EXISTS `feedback` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `code_generation_id` INT NOT NULL,
  `feedback_text` TEXT NOT NULL,
  `rating` TINYINT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`code_generation_id`) REFERENCES `code_generations`(`id`) ON DELETE CASCADE
);

-- Таблица для тестов
CREATE TABLE IF NOT EXISTS `tests` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `code_generation_id` INT NOT NULL,
  `test_name` VARCHAR(255) NOT NULL,
  `test_content` TEXT NOT NULL,
  `result` ENUM('passed', 'failed', 'pending') DEFAULT 'pending',
  `execution_time` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`code_generation_id`) REFERENCES `code_generations`(`id`) ON DELETE CASCADE
);

-- Таблица для коммитов
CREATE TABLE IF NOT EXISTS `commits` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `task_id` INT NOT NULL,
  `commit_hash` VARCHAR(40) NOT NULL,
  `commit_message` TEXT NOT NULL,
  `committed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);

-- Таблица для истории взаимодействия с LLM
CREATE TABLE IF NOT EXISTS `llm_interactions` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `task_id` INT,
  `prompt` TEXT NOT NULL,
  `response` TEXT NOT NULL,
  `model_used` VARCHAR(50) NOT NULL,
  `tokens_used` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE SET NULL
);

-- Индексы для оптимизации запросов
CREATE INDEX idx_project_files_project_id ON project_files(project_id);
CREATE INDEX idx_code_vectors_file_id ON code_vectors(file_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX idx_code_generations_task_id ON code_generations(task_id);
CREATE INDEX idx_feedback_code_generation_id ON feedback(code_generation_id);
CREATE INDEX idx_tests_code_generation_id ON tests(code_generation_id);
CREATE INDEX idx_commits_task_id ON commits(task_id);
CREATE INDEX idx_llm_interactions_task_id ON llm_interactions(task_id);

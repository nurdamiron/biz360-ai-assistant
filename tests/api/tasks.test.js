// tests/api/tasks.test.js

const request = require('supertest');
const app = require('../../src/app');
const { pool } = require('../../src/config/db.config');

describe('Tasks API', () => {
  let authToken;
  let testTaskId;
  let testProjectId;

  // Перед всеми тестами получаем токен аутентификации и создаем тестовые данные
  beforeAll(async () => {
    // Аутентификация
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'admin123'
      });

    authToken = loginResponse.body.token;

    // Получаем или создаем тестовый проект
    const connection = await pool.getConnection();
    
    try {
      // Проверяем наличие проекта для тестов
      const [projects] = await connection.query(
        'SELECT id FROM projects LIMIT 1'
      );
      
      if (projects.length > 0) {
        testProjectId = projects[0].id;
      } else {
        // Создаем тестовый проект
        const [result] = await connection.query(
          'INSERT INTO projects (name, description, repository_url) VALUES (?, ?, ?)',
          ['Test Project', 'Project for API tests', 'https://github.com/test/repo']
        );
        
        testProjectId = result.insertId;
      }
    } finally {
      connection.release();
    }
  });

  // Тесты для создания задачи
  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      const taskData = {
        project_id: testProjectId,
        title: 'Test Task',
        description: 'This is a test task created by API tests',
        priority: 'medium'
      };

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe(taskData.title);
      expect(response.body.description).toBe(taskData.description);
      expect(response.body.project_id).toBe(taskData.project_id);

      // Сохраняем ID созданной задачи для последующих тестов
      testTaskId = response.body.id;
    });

    it('should return 400 if required fields are missing', async () => {
      const taskData = {
        // Отсутствует project_id
        title: 'Test Task',
        description: 'This is a test task created by API tests'
      };

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${authToken}`)
        .send(taskData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  // Тесты для получения задачи
  describe('GET /api/tasks/:id', () => {
    it('should get task by ID', async () => {
      const response = await request(app)
        .get(`/api/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testTaskId);
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('description');
    });

    it('should return 404 for non-existent task', async () => {
      const nonExistentId = 999999;

      const response = await request(app)
        .get(`/api/tasks/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });

  // Тесты для обновления задачи
  describe('PUT /api/tasks/:id', () => {
    it('should update task', async () => {
      const updateData = {
        title: 'Updated Test Task',
        description: 'This task has been updated'
      };

      const response = await request(app)
        .put(`/api/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testTaskId);
      expect(response.body.title).toBe(updateData.title);
      expect(response.body.description).toBe(updateData.description);
    });
  });

  // Тесты для изменения статуса задачи
  describe('PUT /api/tasks/:id/status', () => {
    it('should change task status', async () => {
      const statusData = {
        status: 'in_progress'
      };

      const response = await request(app)
        .put(`/api/tasks/${testTaskId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testTaskId);
      expect(response.body.status).toBe(statusData.status);
    });

    it('should return 400 for invalid status', async () => {
      const statusData = {
        status: 'invalid_status'
      };

      const response = await request(app)
        .put(`/api/tasks/${testTaskId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  // Тесты для работы с подзадачами
  describe('Subtask operations', () => {
    let testSubtaskId;

    it('should create a subtask', async () => {
      const subtaskData = {
        title: 'Test Subtask',
        description: 'This is a test subtask created by API tests'
      };

      const response = await request(app)
        .post(`/api/tasks/${testTaskId}/subtasks`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(subtaskData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('task_id', testTaskId);
      expect(response.body.title).toBe(subtaskData.title);
      expect(response.body.description).toBe(subtaskData.description);

      testSubtaskId = response.body.id;
    });

    it('should get all subtasks for a task', async () => {
      const response = await request(app)
        .get(`/api/tasks/${testTaskId}/subtasks`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should change subtask status', async () => {
      const statusData = {
        status: 'completed'
      };

      const response = await request(app)
        .put(`/api/tasks/${testTaskId}/subtasks/${testSubtaskId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(statusData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testSubtaskId);
      expect(response.body.status).toBe(statusData.status);
    });
  });

  // Тесты для проверки фильтрации и поиска
  describe('Task filtering and search', () => {
    it('should filter tasks by project', async () => {
      const response = await request(app)
        .get(`/api/tasks/project/${testProjectId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeGreaterThan(0);
    });

    it('should find similar tasks', async () => {
      const response = await request(app)
        .get(`/api/tasks/${testTaskId}/similar`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // Тест для удаления задачи (выполняется последним)
  describe('DELETE /api/tasks/:id', () => {
    it('should delete task', async () => {
      const response = await request(app)
        .delete(`/api/tasks/${testTaskId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });
});
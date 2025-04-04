// src/client/components/Dashboard.jsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Container, Grid, Box, Typography, Paper, Button, 
  CircularProgress, Snackbar, Alert, Tabs, Tab
} from '@mui/material';
import TaskList from './TaskList';
import TaskDetails from './TaskDetails';
import AIAssistantStatus from './AIAssistantStatus';
import PerformanceReport from './PerformanceReport';

const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks');

  // Загрузка списка проектов при монтировании компонента
  useEffect(() => {
    fetchProjects();
  }, []);

  // Загрузка задач при выборе проекта
  useEffect(() => {
    if (selectedProject) {
      fetchTasks(selectedProject.id);
    }
  }, [selectedProject]);

  // Функция загрузки проектов
  const fetchProjects = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/projects');
      setProjects(response.data);
      
      if (response.data.length > 0) {
        setSelectedProject(response.data[0]);
      }
      
    } catch (err) {
      setError('Ошибка загрузки проектов: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Функция загрузки задач
  const fetchTasks = async (projectId) => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/tasks?project_id=${projectId}`);
      setTasks(response.data);
      setSelectedTask(null);
    } catch (err) {
      setError('Ошибка загрузки задач: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка выбора задачи
  const handleTaskSelect = (task) => {
    setSelectedTask(task);
  };

  // Обработка создания новой задачи
  const handleCreateTask = async (taskData) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/tasks', {
        ...taskData,
        project_id: selectedProject.id
      });
      
      // Обновляем список задач
      setTasks([...tasks, response.data]);
      setSuccessMessage('Задача успешно создана');
    } catch (err) {
      setError('Ошибка создания задачи: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка запуска ИИ-ассистента для задачи
  const handleRunAIAssistant = async (taskId) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/ai-assistant/process-task', {
        taskId
      });
      
      setSuccessMessage('ИИ-ассистент начал обработку задачи');
      
      // Обновляем задачу в списке
      const updatedTasks = tasks.map(task => 
        task.id === taskId ? { ...task, status: 'in_progress' } : task
      );
      setTasks(updatedTasks);
      
      // Если выбрана эта задача, обновляем и её
      if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask({ ...selectedTask, status: 'in_progress' });
      }
    } catch (err) {
      setError('Ошибка запуска ИИ-ассистента: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка отправки обратной связи
  const handleSubmitFeedback = async (generationId, feedbackText, rating) => {
    setLoading(true);
    try {
      await axios.post('/api/ai-assistant/feedback', {
        projectId: selectedProject.id,
        generationId,
        feedbackText,
        rating
      });
      
      setSuccessMessage('Обратная связь успешно отправлена');
      
      // Обновляем выбранную задачу
      if (selectedTask) {
        const response = await axios.get(`/api/tasks/${selectedTask.id}`);
        setSelectedTask(response.data);
      }
    } catch (err) {
      setError('Ошибка отправки обратной связи: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка изменения статуса генерации
  const handleUpdateGeneration = async (taskId, generationId, status, feedback) => {
    setLoading(true);
    try {
      await axios.put(`/api/tasks/${taskId}/generations/${generationId}`, {
        status,
        feedback
      });
      
      setSuccessMessage(`Статус генерации обновлен на "${status}"`);
      
      // Обновляем выбранную задачу
      if (selectedTask && selectedTask.id === taskId) {
        const response = await axios.get(`/api/tasks/${taskId}`);
        setSelectedTask(response.data);
      }
    } catch (err) {
      setError('Ошибка обновления статуса генерации: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка повторной генерации кода
  const handleRegenerateCode = async (taskId, generationId, feedback) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/ai-assistant/regenerate-code', {
        taskId,
        generationId,
        feedback
      });
      
      setSuccessMessage('Код успешно перегенерирован');
      
      // Обновляем выбранную задачу
      if (selectedTask && selectedTask.id === taskId) {
        const taskResponse = await axios.get(`/api/tasks/${taskId}`);
        setSelectedTask(taskResponse.data);
      }
    } catch (err) {
      setError('Ошибка при повторной генерации кода: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Обработка закрытия уведомления об ошибке
  const handleErrorClose = () => {
    setError(null);
  };

  // Обработка закрытия уведомления об успехе
  const handleSuccessClose = () => {
    setSuccessMessage(null);
  };

  // Обработка изменения вкладки
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Biz360 CRM - AI-ассистент разработчика
        </Typography>
        
        <Grid container spacing={3}>
          {/* Выбор проекта */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" component="h2">
                Проект: {selectedProject ? selectedProject.name : 'Не выбран'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                {projects.map(project => (
                  <Button 
                    key={project.id}
                    variant={selectedProject?.id === project.id ? "contained" : "outlined"}
                    onClick={() => setSelectedProject(project)}
                  >
                    {project.name}
                  </Button>
                ))}
              </Box>
            </Paper>
          </Grid>
          
          {/* Вкладки */}
          <Grid item xs={12}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs value={activeTab} onChange={handleTabChange}>
                <Tab label="Задачи" value="tasks" />
                <Tab label="Статус ассистента" value="status" />
                <Tab label="Отчеты" value="reports" />
              </Tabs>
            </Box>
          </Grid>
          
          {/* Содержимое вкладки "Задачи" */}
          {activeTab === 'tasks' && (
            <>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: '100%' }}>
                  <TaskList 
                    tasks={tasks}
                    selectedTaskId={selectedTask?.id}
                    onTaskSelect={handleTaskSelect}
                    onCreateTask={handleCreateTask}
                    onRunAIAssistant={handleRunAIAssistant}
                  />
                </Paper>
              </Grid>
              
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 2, height: '100%' }}>
                  {selectedTask ? (
                    <TaskDetails 
                      task={selectedTask}
                      onSubmitFeedback={handleSubmitFeedback}
                      onUpdateGeneration={handleUpdateGeneration}
                      onRegenerateCode={handleRegenerateCode}
                    />
                  ) : (
                    <Box sx={{ p: 3, textAlign: 'center' }}>
                      <Typography variant="body1">
                        Выберите задачу из списка для просмотра деталей
                      </Typography>
                    </Box>
                  )}
                </Paper>
              </Grid>
            </>
          )}
          
          {/* Содержимое вкладки "Статус ассистента" */}
          {activeTab === 'status' && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <AIAssistantStatus projectId={selectedProject?.id} />
              </Paper>
            </Grid>
          )}
          
          {/* Содержимое вкладки "Отчеты" */}
          {activeTab === 'reports' && (
            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <PerformanceReport projectId={selectedProject?.id} />
              </Paper>
            </Grid>
          )}
        </Grid>
      </Box>
      
      {/* Индикатор загрузки */}
      {loading && (
        <Box sx={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9999
        }}>
          <CircularProgress />
        </Box>
      )}
      
      {/* Уведомление об ошибке */}
      <Snackbar open={!!error} autoHideDuration={6000} onClose={handleErrorClose}>
        <Alert onClose={handleErrorClose} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      
      {/* Уведомление об успехе */}
      <Snackbar open={!!successMessage} autoHideDuration={3000} onClose={handleSuccessClose}>
        <Alert onClose={handleSuccessClose} severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Dashboard;
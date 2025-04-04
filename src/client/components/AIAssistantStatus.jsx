// src/client/components/AIAssistantStatus.jsx

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { 
  Box, Typography, Paper, Grid, CircularProgress, Button,
  Card, CardContent, Chip, List, ListItem, ListItemText, 
  Divider, Alert, LinearProgress, Table, TableBody, 
  TableCell, TableContainer, TableHead, TableRow,
  Accordion, AccordionSummary, AccordionDetails, Stack
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

/**
 * Компонент для отображения статуса ИИ-ассистента
 * @param {Object} props - Свойства компонента
 * @param {number|null} props.projectId - ID проекта
 */
const AIAssistantStatus = ({ projectId }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(null);
  const [refreshCountdown, setRefreshCountdown] = useState(0);

  // Загрузка статуса ИИ-ассистента
  const fetchStatus = async () => {
    if (!projectId) return;
    
    try {
      setLoading(true);
      const response = await axios.get('/api/ai-assistant/status');
      setStatus(response.data);
      setError(null);
    } catch (err) {
      console.error('Ошибка при получении статуса ИИ-ассистента:', err);
      setError('Не удалось получить статус ИИ-ассистента');
    } finally {
      setLoading(false);
    }
  };

  // Загрузка статуса при монтировании компонента и изменении projectId
  useEffect(() => {
    if (projectId) {
      fetchStatus();
    }
  }, [projectId]);

  // Установка интервала автообновления
  useEffect(() => {
    return () => {
      // Очистка интервала при размонтировании компонента
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [refreshInterval]);

  // Обработчик запуска контроллера
  const handleStartController = async () => {
    try {
      setLoading(true);
      await axios.post('/api/controller/start');
      await fetchStatus();
    } catch (err) {
      console.error('Ошибка при запуске контроллера:', err);
      setError('Не удалось запустить контроллер');
    } finally {
      setLoading(false);
    }
  };

  // Обработчик остановки контроллера
  const handleStopController = async () => {
    try {
      setLoading(true);
      await axios.post('/api/controller/stop');
      await fetchStatus();
    } catch (err) {
      console.error('Ошибка при остановке контроллера:', err);
      setError('Не удалось остановить контроллер');
    } finally {
      setLoading(false);
    }
  };

  // Обработчик ручного обновления статуса
  const handleRefresh = () => {
    fetchStatus();
  };

  // Обработчик включения/выключения автообновления
  const toggleAutoRefresh = () => {
    if (refreshInterval) {
      // Выключение автообновления
      clearInterval(refreshInterval);
      setRefreshInterval(null);
      setRefreshCountdown(0);
    } else {
      // Включение автообновления (каждые 10 секунд)
      const intervalTime = 10000;
      const interval = setInterval(() => {
        fetchStatus();
      }, intervalTime);
      
      setRefreshInterval(interval);
      
      // Запускаем счетчик обратного отсчета
      let countdown = intervalTime / 1000;
      setRefreshCountdown(countdown);
      
      const countdownInterval = setInterval(() => {
        countdown -= 1;
        setRefreshCountdown(countdown);
        
        if (countdown <= 0) {
          countdown = intervalTime / 1000;
          setRefreshCountdown(countdown);
        }
      }, 1000);
      
      // Сохраняем ID интервала счетчика для очистки
      return () => {
        clearInterval(interval);
        clearInterval(countdownInterval);
      };
    }
  };

  // Преобразование числа в форматированное представление
  const formatNumber = (num) => {
    return new Intl.NumberFormat().format(num);
  };

  // Если проект не выбран
  if (!projectId) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          Выберите проект для просмотра статуса ИИ-ассистента
        </Typography>
      </Box>
    );
  }

  // Отображение при загрузке
  if (loading && !status) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Отображение при ошибке
  if (error && !status) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
        <Button 
          variant="outlined" 
          size="small" 
          onClick={handleRefresh}
          sx={{ ml: 2 }}
        >
          Повторить
        </Button>
      </Alert>
    );
  }

  return (
    <Box>
      {/* Заголовок и кнопки управления */}
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          mb: 3
        }}
      >
        <Typography variant="h5" component="h2">
          Статус ИИ-ассистента
        </Typography>
        <Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            sx={{ mr: 1 }}
          >
            Обновить
          </Button>
          <Button
            variant="outlined"
            color={refreshInterval ? "error" : "primary"}
            onClick={toggleAutoRefresh}
          >
            {refreshInterval ? "Выключить автообновление" : "Включить автообновление"}
            {refreshInterval && refreshCountdown > 0 && ` (${refreshCountdown}с)`}
          </Button>
        </Box>
      </Box>

      {/* Отображение ошибки */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Основной статус */}
      {status && (
        <Grid container spacing={3}>
          {/* Карточка статуса контроллера */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6" component="div">
                    Контроллер
                  </Typography>
                  <Chip 
                    label={status.running ? "Запущен" : "Остановлен"} 
                    color={status.running ? "success" : "error"}
                    size="small"
                    sx={{ ml: 2 }}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Контроллер координирует работу всех компонентов ИИ-ассистента.
                </Typography>
                <Box sx={{ mt: 2 }}>
                  {status.running ? (
                    <Button
                      variant="contained"
                      color="error"
                      startIcon={<StopIcon />}
                      onClick={handleStopController}
                      disabled={loading}
                      fullWidth
                    >
                      Остановить
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<PlayArrowIcon />}
                      onClick={handleStartController}
                      disabled={loading}
                      fullWidth
                    >
                      Запустить
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Карточка очереди задач */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" component="div" gutterBottom>
                  Очередь задач
                </Typography>
                {status.queue && status.queue.statuses && (
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="body2" gutterBottom>
                        Ожидает: {status.queue.statuses.pending || 0}
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={100} 
                        color="warning"
                        sx={{ height: 10, borderRadius: 1 }}
                      />
                    </Box>
                    <Box>
                      <Typography variant="body2" gutterBottom>
                        В обработке: {status.queue.statuses.processing || 0}
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={100} 
                        color="primary"
                        sx={{ height: 10, borderRadius: 1 }}
                      />
                    </Box>
                    <Box>
                      <Typography variant="body2" gutterBottom>
                        Завершено: {status.queue.statuses.completed || 0}
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={100} 
                        color="success"
                        sx={{ height: 10, borderRadius: 1 }}
                      />
                    </Box>
                    <Box>
                      <Typography variant="body2" gutterBottom>
                        Не выполнено: {status.queue.statuses.failed || 0}
                      </Typography>
                      <LinearProgress 
                        variant="determinate" 
                        value={100} 
                        color="error"
                        sx={{ height: 10, borderRadius: 1 }}
                      />
                    </Box>
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Карточка статистики API */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" component="div" gutterBottom>
                  Использование LLM API
                </Typography>
                {status.tokenUsage && (
                  <TableContainer>
                    <Table size="small">
                      <TableBody>
                        <TableRow>
                          <TableCell>Всего токенов</TableCell>
                          <TableCell align="right">{formatNumber(status.tokenUsage.total)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Токены запросов</TableCell>
                          <TableCell align="right">{formatNumber(status.tokenUsage.promptTokens)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Токены ответов</TableCell>
                          <TableCell align="right">{formatNumber(status.tokenUsage.completionTokens)}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Оценка стоимости</TableCell>
                          <TableCell align="right">${status.tokenUsage.estimatedCost}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Статистика по типам задач */}
          <Grid item xs={12}>
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h6">
                  Статистика по типам задач
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                {status.queue && status.queue.types && Object.keys(status.queue.types).length > 0 ? (
                  <TableContainer component={Paper}>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Тип задачи</TableCell>
                          <TableCell align="right">Количество</TableCell>
                          <TableCell align="right">Описание</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Object.entries(status.queue.types).map(([type, count]) => (
                          <TableRow key={type}>
                            <TableCell component="th" scope="row">
                              {taskTypeToLabel(type)}
                            </TableCell>
                            <TableCell align="right">{count}</TableCell>
                            <TableCell align="right">{taskTypeDescription(type)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Нет данных о типах задач
                  </Typography>
                )}
              </AccordionDetails>
            </Accordion>
          </Grid>

          {/* Статистика по модулям */}
          <Grid item xs={12}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="h6">
                  Состояние модулей
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  {modules.map((module) => (
                    <Grid item xs={12} sm={6} md={4} key={module.id}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            {module.icon}
                            <Typography variant="h6" component="div" sx={{ ml: 1 }}>
                              {module.name}
                            </Typography>
                          </Box>
                          <Chip 
                            label={status.running ? "Активен" : "Неактивен"} 
                            color={status.running ? "success" : "default"}
                            size="small"
                            sx={{ mb: 1 }}
                          />
                          <Typography variant="body2" color="text.secondary">
                            {module.description}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </AccordionDetails>
            </Accordion>
          </Grid>
        </Grid>
      )}

      {/* Отображение при загрузке (после первоначальной загрузки) */}
      {loading && status && (
        <Box sx={{ position: 'fixed', bottom: 16, right: 16 }}>
          <CircularProgress size={20} />
        </Box>
      )}
    </Box>
  );
};

// Преобразование типа задачи в читаемую метку
const taskTypeToLabel = (type) => {
  const labels = {
    'decompose': 'Декомпозиция задачи',
    'generate_code': 'Генерация кода',
    'commit_code': 'Коммит кода',
    'analyze_project': 'Анализ проекта',
    'run_tests': 'Запуск тестов',
    'review_code': 'Код-ревью'
  };
  
  return labels[type] || type;
};

// Описание типа задачи
const taskTypeDescription = (type) => {
  const descriptions = {
    'decompose': 'Разбиение сложной задачи на подзадачи',
    'generate_code': 'Создание программного кода на основе описания',
    'commit_code': 'Сохранение изменений в репозитории',
    'analyze_project': 'Анализ структуры проекта',
    'run_tests': 'Выполнение автоматических тестов',
    'review_code': 'Проверка качества кода'
  };
  
  return descriptions[type] || 'Нет описания';
};

// Список модулей системы
const modules = [
  {
    id: 'controller',
    name: 'Контроллер',
    description: 'Координирует работу всех модулей системы',
    icon: <AccountTreeIcon color="primary" />
  },
  {
    id: 'project_understanding',
    name: 'Понимание проекта',
    description: 'Анализирует структуру и архитектуру проекта',
    icon: <AutoAwesomeIcon color="primary" />
  },
  {
    id: 'task_planner',
    name: 'Планировщик задач',
    description: 'Планирует и декомпозирует задачи на подзадачи',
    icon: <CheckCircleIcon color="primary" />
  },
  {
    id: 'code_generator',
    name: 'Генератор кода',
    description: 'Создает код на основе спецификаций',
    icon: <AccessTimeIcon color="primary" />
  },
  {
    id: 'vcs_manager',
    name: 'Менеджер VCS',
    description: 'Взаимодействует с Git репозиторием',
    icon: <ErrorIcon color="primary" />
  },
  {
    id: 'learning_system',
    name: 'Система обучения',
    description: 'Улучшает работу ассистента на основе обратной связи',
    icon: <CheckCircleIcon color="primary" />
  }
];

AIAssistantStatus.propTypes = {
  projectId: PropTypes.number
};

export default AIAssistantStatus;
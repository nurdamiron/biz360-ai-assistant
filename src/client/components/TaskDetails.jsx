// src/client/components/TaskDetails.jsx

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Box, Typography, Divider, Chip, Button, TextField, 
  Accordion, AccordionSummary, AccordionDetails, Select,
  MenuItem, Rating, Tab, Tabs, Grid, CircularProgress
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CodeEditor from './CodeEditor';

const TaskDetails = ({ task, onSubmitFeedback, onUpdateGeneration, onRegenerateCode }) => {
  const [subtasks, setSubtasks] = useState([]);
  const [generations, setGenerations] = useState([]);
  const [activeTab, setActiveTab] = useState('details');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(3);
  const [selectedSubtask, setSelectedSubtask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [expandedAccordion, setExpandedAccordion] = useState('details');

  // Загрузка подзадач и генераций при изменении задачи
  useEffect(() => {
    if (task) {
      // Если у задачи уже есть подзадачи и генерации, используем их
      if (task.subtasks) {
        setSubtasks(task.subtasks);
      }
      
      if (task.code_generations) {
        setGenerations(task.code_generations);
      }
      
      // Сбрасываем выбранную подзадачу и вкладку
      setSelectedSubtask(null);
      setActiveTab('details');
      
      // Загружаем рекомендации от ИИ
      fetchRecommendations();
    }
  }, [task]);

  // Получение рекомендаций от ИИ-ассистента
  const fetchRecommendations = async () => {
    if (!task) return;
    
    setLoading(true);
    try {
      // Получаем проект через связанные задачи
      const response = await axios.post('/api/ai-assistant/analyze-task', {
        projectId: task.project_id,
        taskId: task.id
      });
      
      setRecommendations(response.data.recommendations);
    } catch (err) {
      console.error('Ошибка получения рекомендаций:', err);
    } finally {
      setLoading(false);
    }
  };

  // Обработка одобрения генерации
  const handleApproveGeneration = (generationId) => {
    onUpdateGeneration(task.id, generationId, 'approved', 'Код одобрен');
  };

  // Обработка отклонения генерации
  const handleRejectGeneration = (generationId) => {
    onUpdateGeneration(task.id, generationId, 'rejected', feedbackText);
    setFeedbackText('');
  };

  // Обработка отправки обратной связи
  const handleFeedbackSubmit = (generationId) => {
    onSubmitFeedback(generationId, feedbackText, feedbackRating);
    setFeedbackText('');
    setFeedbackRating(3);
  };

  // Обработка повторной генерации кода
  const handleRegenerateCode = (generationId) => {
    onRegenerateCode(task.id, generationId, feedbackText);
    setFeedbackText('');
  };

  // Обработка изменения текущей вкладки
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  // Обработка изменения развернутой секции
  const handleAccordionChange = (panel) => (event, isExpanded) => {
    setExpandedAccordion(isExpanded ? panel : false);
  };

  // Форматирование даты
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  // Получение цвета для статуса
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'in_progress':
        return 'primary';
      case 'failed':
        return 'error';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      case 'pending_review':
        return 'warning';
      case 'implemented':
        return 'success';
      default:
        return 'default';
    }
  };

  // Получение перевода статуса
  const getStatusTranslation = (status) => {
    const translations = {
      'pending': 'Ожидает',
      'in_progress': 'В работе',
      'completed': 'Завершена',
      'failed': 'Не выполнена',
      'approved': 'Одобрен',
      'rejected': 'Отклонен',
      'pending_review': 'Ожидает проверки',
      'implemented': 'Внедрен'
    };
    
    return translations[status] || status;
  };

  if (!task) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Заголовок и статус */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" component="h2">
          {task.title}
        </Typography>
        <Chip 
          label={getStatusTranslation(task.status)} 
          color={getStatusColor(task.status)} 
          variant="outlined"
        />
      </Box>
      
      {/* Детали задачи */}
      <Accordion 
        expanded={expandedAccordion === 'details'} 
        onChange={handleAccordionChange('details')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Детали задачи</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body1" gutterBottom>
            {task.description}
          </Typography>
          
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Typography variant="subtitle2">Приоритет:</Typography>
                <Chip 
                  label={task.priority.toUpperCase()} 
                  color={task.priority === 'critical' ? 'error' : 
                         task.priority === 'high' ? 'warning' : 
                         task.priority === 'medium' ? 'primary' : 'default'} 
                  size="small"
                />
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle2">Создана:</Typography>
                <Typography variant="body2">{formatDate(task.created_at)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle2">Обновлена:</Typography>
                <Typography variant="body2">{formatDate(task.updated_at)}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="subtitle2">Завершена:</Typography>
                <Typography variant="body2">
                  {task.completed_at ? formatDate(task.completed_at) : 'Не завершена'}
                </Typography>
              </Grid>
            </Grid>
          </Box>
        </AccordionDetails>
      </Accordion>
      
      {/* Рекомендации ИИ */}
      <Accordion 
        expanded={expandedAccordion === 'recommendations'} 
        onChange={handleAccordionChange('recommendations')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Рекомендации ИИ-ассистента</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : recommendations ? (
            <Box>
              <Typography 
                variant="body1" 
                component="div" 
                sx={{ 
                  whiteSpace: 'pre-wrap',
                  '& h1, & h2, & h3': {
                    mt: 2,
                    mb: 1,
                    fontWeight: 'bold'
                  },
                  '& ul, & ol': {
                    pl: 2
                  }
                }}
              >
                {recommendations.split('\n').map((line, index) => {
                  if (line.startsWith('# ')) {
                    return <Typography key={index} variant="h5" sx={{ mt: 2, mb: 1 }}>{line.substring(2)}</Typography>;
                  } else if (line.startsWith('## ')) {
                    return <Typography key={index} variant="h6" sx={{ mt: 2, mb: 1 }}>{line.substring(3)}</Typography>;
                  } else if (line.startsWith('- ')) {
                    return <Typography key={index} variant="body1" sx={{ display: 'list-item', ml: 3 }}>{line.substring(2)}</Typography>;
                  } else {
                    return <Typography key={index} variant="body1">{line}</Typography>;
                  }
                })}
              </Typography>
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button 
                  variant="outlined" 
                  startIcon={<RefreshIcon />}
                  onClick={fetchRecommendations}
                >
                  Обновить рекомендации
                </Button>
              </Box>
            </Box>
          ) : (
            <Typography variant="body1">
              Нет доступных рекомендаций. Нажмите кнопку ниже, чтобы получить рекомендации от ИИ-ассистента.
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                <Button 
                  variant="contained" 
                  startIcon={<PlayArrowIcon />}
                  onClick={fetchRecommendations}
                >
                  Получить рекомендации
                </Button>
              </Box>
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
      
      {/* Подзадачи */}
      <Accordion 
        expanded={expandedAccordion === 'subtasks'} 
        onChange={handleAccordionChange('subtasks')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            Подзадачи ({subtasks.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {subtasks.length > 0 ? (
            <Box>
              {subtasks.map((subtask) => (
                <Accordion key={subtask.id}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <Typography variant="subtitle1">
                        {subtask.sequence_number}. {subtask.title}
                      </Typography>
                      <Chip 
                        label={getStatusTranslation(subtask.status)} 
                        color={getStatusColor(subtask.status)} 
                        size="small"
                        sx={{ ml: 2 }}
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography variant="body2">
                      {subtask.description}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ) : (
            <Typography variant="body1">
              Для этой задачи еще не создано подзадач.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
      
      {/* Сгенерированный код */}
      <Accordion 
        expanded={expandedAccordion === 'generations'} 
        onChange={handleAccordionChange('generations')}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">
            Сгенерированный код ({generations.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {generations.length > 0 ? (
            <Box>
              {generations.map((generation) => (
                <Accordion key={generation.id}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <Typography variant="subtitle1">
                        {generation.file_path}
                      </Typography>
                      <Chip 
                        label={getStatusTranslation(generation.status)} 
                        color={getStatusColor(generation.status)} 
                        size="small"
                        sx={{ ml: 2 }}
                      />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Tabs value={activeTab} onChange={handleTabChange}>
                      <Tab label="Сгенерированный код" value="generated" />
                      {generation.original_content && (
                        <Tab label="Исходный код" value="original" />
                      )}
                      <Tab label="Разница" value="diff" />
                      <Tab label="Обратная связь" value="feedback" />
                    </Tabs>
                    
                    <Box sx={{ mt: 2 }}>
                      {activeTab === 'generated' && (
                        <CodeEditor 
                          value={generation.generated_content} 
                          language="javascript" 
                          readOnly={true}
                        />
                      )}
                      
                      {activeTab === 'original' && generation.original_content && (
                        <CodeEditor 
                          value={generation.original_content} 
                          language="javascript" 
                          readOnly={true}
                        />
                      )}
                      
                      {activeTab === 'diff' && (
                        <Typography variant="body2">
                          Просмотр разницы пока не реализован.
                        </Typography>
                      )}
                      
                      {activeTab === 'feedback' && (
                        <Box>
                          <Typography variant="subtitle2" gutterBottom>
                            Обратная связь:
                          </Typography>
                          <TextField
                            label="Ваша обратная связь"
                            multiline
                            rows={4}
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            fullWidth
                            margin="normal"
                            variant="outlined"
                            placeholder="Опишите, что вам понравилось или не понравилось в сгенерированном коде"
                          />
                          
                          <Box sx={{ display: 'flex', alignItems: 'center', mt: 2 }}>
                            <Typography variant="subtitle2" sx={{ mr: 2 }}>
                              Оценка:
                            </Typography>
                            <Rating
                              value={feedbackRating}
                              onChange={(e, newValue) => setFeedbackRating(newValue)}
                            />
                          </Box>
                          
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
                            <Box>
                              <Button
                                variant="contained"
                                color="primary"
                                onClick={() => handleFeedbackSubmit(generation.id)}
                                disabled={!feedbackText}
                                sx={{ mr: 1 }}
                              >
                                Отправить отзыв
                              </Button>
                              
                              <Button
                                variant="outlined"
                                startIcon={<RefreshIcon />}
                                onClick={() => handleRegenerateCode(generation.id)}
                                disabled={!feedbackText}
                              >
                                Перегенерировать
                              </Button>
                            </Box>
                            
                            <Box>
                              <Button
                                variant="contained"
                                color="success"
                                startIcon={<CheckIcon />}
                                onClick={() => handleApproveGeneration(generation.id)}
                                disabled={generation.status === 'approved' || generation.status === 'implemented'}
                                sx={{ mr: 1 }}
                              >
                                Одобрить
                              </Button>
                              
                              <Button
                                variant="contained"
                                color="error"
                                startIcon={<CloseIcon />}
                                onClick={() => handleRejectGeneration(generation.id)}
                                disabled={generation.status === 'rejected'}
                              >
                                Отклонить
                              </Button>
                            </Box>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          ) : (
            <Typography variant="body1">
              Для этой задачи еще не сгенерирован код.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default TaskDetails;
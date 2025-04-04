// src/client/components/TaskList.jsx

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { 
  Box, Typography, List, ListItem, ListItemText, ListItemButton,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Chip, IconButton, Divider, FormHelperText, InputAdornment,
  Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import AccessTimeIcon from '@mui/icons-material/AccessTime';

/**
 * Компонент списка задач с возможностью фильтрации и создания новых задач
 * @param {Object} props - Свойства компонента
 * @param {Array} props.tasks - Массив задач
 * @param {number|null} props.selectedTaskId - ID выбранной задачи
 * @param {function} props.onTaskSelect - Обработчик выбора задачи
 * @param {function} props.onCreateTask - Обработчик создания задачи
 * @param {function} props.onRunAIAssistant - Обработчик запуска ИИ-ассистента
 */
const TaskList = ({ 
  tasks = [], 
  selectedTaskId = null, 
  onTaskSelect, 
  onCreateTask,
  onRunAIAssistant
}) => {
  // Состояние для диалога создания задачи
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  
  // Состояние для новой задачи
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium'
  });
  
  // Состояние для ошибок валидации
  const [validationErrors, setValidationErrors] = useState({});
  
  // Состояние для поиска и фильтрации
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  
  // Обработчик открытия диалога создания задачи
  const handleOpenCreateDialog = () => {
    setCreateDialogOpen(true);
    setNewTask({
      title: '',
      description: '',
      priority: 'medium'
    });
    setValidationErrors({});
  };
  
  // Обработчик закрытия диалога создания задачи
  const handleCloseCreateDialog = () => {
    setCreateDialogOpen(false);
  };
  
  // Обработчик изменения полей новой задачи
  const handleNewTaskChange = (field) => (event) => {
    setNewTask({
      ...newTask,
      [field]: event.target.value
    });
    
    // Сбрасываем ошибку валидации при изменении поля
    if (validationErrors[field]) {
      setValidationErrors({
        ...validationErrors,
        [field]: null
      });
    }
  };
  
  // Обработчик создания новой задачи
  const handleCreateTask = () => {
    // Валидация полей
    const errors = {};
    
    if (!newTask.title.trim()) {
      errors.title = 'Название задачи обязательно';
    }
    
    if (!newTask.description.trim()) {
      errors.description = 'Описание задачи обязательно';
    }
    
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    // Вызываем функцию создания задачи
    onCreateTask(newTask);
    
    // Закрываем диалог
    setCreateDialogOpen(false);
  };
  
  // Обработчик изменения поискового запроса
  const handleSearchChange = (event) => {
    setSearchQuery(event.target.value);
  };
  
  // Обработчик изменения фильтра по статусу
  const handleStatusFilterChange = (event) => {
    setStatusFilter(event.target.value);
  };
  
  // Обработчик изменения фильтра по приоритету
  const handlePriorityFilterChange = (event) => {
    setPriorityFilter(event.target.value);
  };
  
  // Функция фильтрации задач
  const filteredTasks = tasks.filter(task => {
    // Фильтрация по поисковому запросу
    const matchesSearch = searchQuery === '' || 
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Фильтрация по статусу
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    
    // Фильтрация по приоритету
    const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
    
    return matchesSearch && matchesStatus && matchesPriority;
  });
  
  // Сортировка задач: сначала по приоритету, затем по дате создания (новые сверху)
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    // Преобразуем приоритеты в числа для сортировки
    const priorityValues = {
      'critical': 4,
      'high': 3,
      'medium': 2,
      'low': 1
    };
    
    // Сортировка по приоритету (по убыванию)
    const priorityDiff = priorityValues[b.priority] - priorityValues[a.priority];
    
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    
    // Сортировка по дате создания (по убыванию)
    return new Date(b.created_at) - new Date(a.created_at);
  });
  
  // Получение иконки статуса задачи
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon color="success" fontSize="small" />;
      case 'in_progress':
        return <AccessTimeIcon color="primary" fontSize="small" />;
      case 'failed':
        return <ErrorIcon color="error" fontSize="small" />;
      default:
        return null;
    }
  };
  
  // Получение цвета для приоритета задачи
  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical':
        return 'error';
      case 'high':
        return 'warning';
      case 'medium':
        return 'primary';
      case 'low':
        return 'info';
      default:
        return 'default';
    }
  };
  
  // Отрисовка диалога создания задачи
  const renderCreateTaskDialog = () => (
    <Dialog 
      open={createDialogOpen} 
      onClose={handleCloseCreateDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Создание новой задачи</DialogTitle>
      <DialogContent>
        <TextField
          label="Название задачи"
          fullWidth
          margin="normal"
          value={newTask.title}
          onChange={handleNewTaskChange('title')}
          error={!!validationErrors.title}
          helperText={validationErrors.title}
        />
        
        <TextField
          label="Описание задачи"
          fullWidth
          margin="normal"
          multiline
          rows={4}
          value={newTask.description}
          onChange={handleNewTaskChange('description')}
          error={!!validationErrors.description}
          helperText={validationErrors.description}
        />
        
        <FormControl 
          fullWidth 
          margin="normal"
        >
          <InputLabel id="priority-label">Приоритет</InputLabel>
          <Select
            labelId="priority-label"
            value={newTask.priority}
            onChange={handleNewTaskChange('priority')}
            label="Приоритет"
          >
            <MenuItem value="low">Низкий</MenuItem>
            <MenuItem value="medium">Средний</MenuItem>
            <MenuItem value="high">Высокий</MenuItem>
            <MenuItem value="critical">Критический</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseCreateDialog}>Отмена</Button>
        <Button 
          onClick={handleCreateTask} 
          variant="contained"
        >
          Создать задачу
        </Button>
      </DialogActions>
    </Dialog>
  );

  return (
    <Box>
      {/* Заголовок и кнопка создания */}
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          mb: 2
        }}
      >
        <Typography variant="h6" component="h3">
          Задачи ({filteredTasks.length})
        </Typography>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />}
          onClick={handleOpenCreateDialog}
        >
          Создать
        </Button>
      </Box>
      
      {/* Поиск и фильтры */}
      <Box sx={{ mb: 2 }}>
        <TextField
          placeholder="Поиск задач..."
          fullWidth
          size="small"
          value={searchQuery}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Показать фильтры">
                  <IconButton 
                    size="small" 
                    onClick={() => setShowFilters(!showFilters)}
                    color={showFilters ? "primary" : "default"}
                  >
                    <FilterListIcon />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            )
          }}
        />
        
        {showFilters && (
          <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="status-filter-label">Статус</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="Статус"
                onChange={handleStatusFilterChange}
              >
                <MenuItem value="all">Все статусы</MenuItem>
                <MenuItem value="pending">Ожидает</MenuItem>
                <MenuItem value="in_progress">В работе</MenuItem>
                <MenuItem value="completed">Завершена</MenuItem>
                <MenuItem value="failed">Не выполнена</MenuItem>
              </Select>
            </FormControl>
            
            <FormControl size="small" fullWidth>
              <InputLabel id="priority-filter-label">Приоритет</InputLabel>
              <Select
                labelId="priority-filter-label"
                value={priorityFilter}
                label="Приоритет"
                onChange={handlePriorityFilterChange}
              >
                <MenuItem value="all">Все приоритеты</MenuItem>
                <MenuItem value="low">Низкий</MenuItem>
                <MenuItem value="medium">Средний</MenuItem>
                <MenuItem value="high">Высокий</MenuItem>
                <MenuItem value="critical">Критический</MenuItem>
              </Select>
            </FormControl>
          </Box>
        )}
      </Box>
      
      <Divider sx={{ mb: 2 }} />
      
      {/* Список задач */}
      {sortedTasks.length > 0 ? (
        <List sx={{ maxHeight: 450, overflow: 'auto' }}>
          {sortedTasks.map((task) => (
            <ListItem 
              key={task.id}
              disablePadding
              secondaryAction={
                <Tooltip title="Запустить ИИ-ассистента">
                  <IconButton 
                    edge="end" 
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunAIAssistant(task.id);
                    }}
                    disabled={task.status === 'completed' || task.status === 'in_progress'}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemButton 
                selected={task.id === selectedTaskId}
                onClick={() => onTaskSelect(task)}
                sx={{ borderLeft: 4, borderColor: `${getPriorityColor(task.priority)}.main` }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {getStatusIcon(task.status)}
                      <Typography 
                        variant="body1" 
                        component="span"
                        sx={{ 
                          ml: getStatusIcon(task.status) ? 1 : 0,
                          fontWeight: task.id === selectedTaskId ? 'bold' : 'normal'
                        }}
                      >
                        {task.title}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                      <Chip 
                        label={task.priority.toUpperCase()}
                        size="small"
                        color={getPriorityColor(task.priority)}
                        variant="outlined"
                        sx={{ mr: 1, height: 20, fontSize: '0.7rem' }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {new Date(task.created_at).toLocaleDateString()}
                      </Typography>
                    </Box>
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      ) : (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body1" color="text.secondary">
            {searchQuery || statusFilter !== 'all' || priorityFilter !== 'all'
              ? 'Нет задач, соответствующих фильтрам'
              : 'Список задач пуст. Создайте новую задачу.'}
          </Typography>
          {(searchQuery || statusFilter !== 'all' || priorityFilter !== 'all') && (
            <Button 
              sx={{ mt: 2 }}
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setPriorityFilter('all');
              }}
            >
              Сбросить фильтры
            </Button>
          )}
        </Box>
      )}
      
      {/* Диалог создания задачи */}
      {renderCreateTaskDialog()}
    </Box>
  );
};

TaskList.propTypes = {
  tasks: PropTypes.array,
  selectedTaskId: PropTypes.number,
  onTaskSelect: PropTypes.func.isRequired,
  onCreateTask: PropTypes.func.isRequired,
  onRunAIAssistant: PropTypes.func.isRequired
};

export default TaskList;
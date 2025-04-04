// src/client/components/PerformanceReport.jsx

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { 
  Box, Typography, Paper, Grid, CircularProgress, Button,
  Card, CardContent, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Divider, Alert, Tab, Tabs, Select, MenuItem, FormControl, 
  InputLabel, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import { 
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

/**
 * Компонент для отображения отчетов о производительности ИИ-ассистента
 * @param {Object} props - Свойства компонента
 * @param {number|null} props.projectId - ID проекта
 */
const PerformanceReport = ({ projectId }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState('week');
  const [activeTab, setActiveTab] = useState('overview');

  // Загрузка отчета о производительности
  const fetchReport = async () => {
    if (!projectId) return;
    
    try {
      setLoading(true);
      const response = await axios.get(`/api/ai-assistant/performance-report?projectId=${projectId}&timeframe=${timeframe}`);
      setReport(response.data);
      setError(null);
    } catch (err) {
      console.error('Ошибка при получении отчета о производительности:', err);
      setError('Не удалось получить отчет о производительности');
    } finally {
      setLoading(false);
    }
  };

  // Загрузка отчета при монтировании компонента и изменении параметров
  useEffect(() => {
    if (projectId) {
      fetchReport();
    }
  }, [projectId, timeframe]);

  // Обработчик изменения временного периода
  const handleTimeframeChange = (event, newTimeframe) => {
    if (newTimeframe !== null) {
      setTimeframe(newTimeframe);
    }
  };

  // Обработчик изменения вкладки
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  // Обработчик обновления отчета
  const handleRefresh = () => {
    fetchReport();
  };

  // Получение даты начала и конца периода в читаемом формате
  const getDateRange = () => {
    if (!report || !report.period) return 'Не определено';
    
    const startDate = new Date(report.period.start);
    const endDate = new Date(report.period.end);
    
    return `${startDate.toLocaleDateString()} — ${endDate.toLocaleDateString()}`;
  };

  // Функция для экспорта отчета в PDF
  const exportToPdf = () => {
    // Здесь будет логика экспорта в PDF
    alert('Функция экспорта в PDF будет добавлена позже');
  };

  // Функция для экспорта отчета в CSV
  const exportToCsv = () => {
    // Здесь будет логика экспорта в CSV
    alert('Функция экспорта в CSV будет добавлена позже');
  };

  // Если проект не выбран
  if (!projectId) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          Выберите проект для просмотра отчета о производительности
        </Typography>
      </Box>
    );
  }

  // Отображение при загрузке
  if (loading && !report) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Отображение при ошибке
  if (error && !report) {
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

  // Подготовка данных для графиков
  const prepareTaskChartData = () => {
    if (!report || !report.tasks) return [];
    
    return [
      { name: 'Выполнено', value: report.tasks.completed },
      { name: 'Не выполнено', value: report.tasks.failed },
      { name: 'В работе', value: report.tasks.total - report.tasks.completed - report.tasks.failed }
    ];
  };

  const prepareCodeChartData = () => {
    if (!report || !report.code_generations) return [];
    
    return [
      { name: 'Одобрено', value: report.code_generations.approved },
      { name: 'Отклонено', value: report.code_generations.rejected },
      { name: 'На рассмотрении', value: report.code_generations.total - report.code_generations.approved - report.code_generations.rejected }
    ];
  };

  // Цвета для графиков
  const COLORS = ['#00C49F', '#FF8042', '#0088FE'];

  return (
    <Box>
      {/* Заголовок и управление */}
      <Box 
        sx={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          mb: 3
        }}
      >
        <Typography variant="h5" component="h2">
          Отчет о производительности
        </Typography>
        <Box>
          <ToggleButtonGroup
            value={timeframe}
            exclusive
            onChange={handleTimeframeChange}
            size="small"
            sx={{ mr: 2 }}
          >
            <ToggleButton value="day">День</ToggleButton>
            <ToggleButton value="week">Неделя</ToggleButton>
            <ToggleButton value="month">Месяц</ToggleButton>
          </ToggleButtonGroup>
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
            startIcon={<PictureAsPdfIcon />}
            onClick={exportToPdf}
            sx={{ mr: 1 }}
          >
            PDF
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={exportToCsv}
          >
            CSV
          </Button>
        </Box>
      </Box>

      {/* Отображение ошибки */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Период отчета */}
      {report && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1">
            Период: {getDateRange()}
          </Typography>
        </Box>
      )}

      {/* Вкладки */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange}>
          <Tab label="Обзор" value="overview" />
          <Tab label="Задачи" value="tasks" />
          <Tab label="Генерации кода" value="code" />
          <Tab label="Использование API" value="api" />
        </Tabs>
      </Box>

      {/* Содержимое вкладки "Обзор" */}
      {activeTab === 'overview' && report && (
        <Grid container spacing={3}>
          {/* Карточка с основными показателями */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Ключевые показатели
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6} md={3}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h3" color="primary">
                        {report.tasks.completion_rate}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Успешность выполнения задач
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h3" color="primary">
                        {report.code_generations.approval_rate}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Одобрение генераций кода
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h3" color="primary">
                        {report.feedback.average_rating}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Средняя оценка
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={6} md={3}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Typography variant="h3" color="primary">
                        ${report.token_usage.estimatedCost}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Затраты на API
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Графики */}
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Статус задач
                </Typography>
                <Box sx={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={prepareTaskChartData()}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        fill="#8884d8"
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {prepareTaskChartData().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value}`, 'Количество']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Статус генераций кода
                </Typography>
                <Box sx={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={prepareCodeChartData()}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        fill="#8884d8"
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {prepareCodeChartData().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value}`, 'Количество']} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Содержимое вкладки "Задачи" */}
      {activeTab === 'tasks' && report && (
        <Box>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Статистика по задачам
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Показатель</TableCell>
                      <TableCell align="right">Значение</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" scope="row">Всего задач</TableCell>
                      <TableCell align="right">{report.tasks.total}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Выполнено</TableCell>
                      <TableCell align="right">{report.tasks.completed}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Не выполнено</TableCell>
                      <TableCell align="right">{report.tasks.failed}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Процент успешного выполнения</TableCell>
                      <TableCell align="right">{report.tasks.completion_rate}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mt: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Скорость выполнения задач
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary">
                Данные о скорости выполнения задач будут доступны в будущих версиях.
              </Typography>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      {/* Содержимое вкладки "Генерации кода" */}
      {activeTab === 'code' && report && (
        <Box>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Статистика по генерациям кода
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Показатель</TableCell>
                      <TableCell align="right">Значение</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" scope="row">Всего генераций</TableCell>
                      <TableCell align="right">{report.code_generations.total}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Одобрено</TableCell>
                      <TableCell align="right">{report.code_generations.approved}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Отклонено</TableCell>
                      <TableCell align="right">{report.code_generations.rejected}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Процент одобрения</TableCell>
                      <TableCell align="right">{report.code_generations.approval_rate}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mt: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Качество генерируемого кода
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  Средняя оценка качества кода: {report.feedback.average_rating}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Оценка основана на обратной связи разработчиков. Шкала оценки от 1 до 5.
                </Typography>
                <Typography variant="body2" gutterBottom>
                  Подробные метрики качества кода будут доступны в будущих версиях:
                </Typography>
                <ul>
                  <li>Покрытие кода тестами</li>
                  <li>Количество найденных ошибок</li>
                  <li>Соответствие стандартам кодирования</li>
                  <li>Удобство сопровождения</li>
                </ul>
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      {/* Содержимое вкладки "Использование API" */}
      {activeTab === 'api' && report && (
        <Box>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Статистика использования LLM API
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Показатель</TableCell>
                      <TableCell align="right">Значение</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell component="th" scope="row">Всего токенов</TableCell>
                      <TableCell align="right">{report.token_usage.total}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Токены запросов</TableCell>
                      <TableCell align="right">{report.token_usage.promptTokens}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Токены ответов</TableCell>
                      <TableCell align="right">{report.token_usage.completionTokens}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell component="th" scope="row">Оценка стоимости</TableCell>
                      <TableCell align="right">${report.token_usage.estimatedCost}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>

          <Accordion sx={{ mt: 2 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">
                Эффективность использования токенов
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box>
                <Typography variant="subtitle1" gutterBottom>
                  Анализ эффективности использования токенов
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Этот раздел показывает, насколько эффективно система использует токены API.
                </Typography>
                <Typography variant="body2" gutterBottom>
                  Соотношение токенов запроса/ответа: {
                    report.token_usage.promptTokens > 0 
                      ? (report.token_usage.completionTokens / report.token_usage.promptTokens).toFixed(2)
                      : 'Н/Д'
                  }
                </Typography>
                <Typography variant="body2" gutterBottom>
                  Стоимость на одну успешную генерацию: ${
                    report.code_generations.approved > 0
                      ? (parseFloat(report.token_usage.estimatedCost) / report.code_generations.approved).toFixed(4)
                      : 'Н/Д'
                  }
                </Typography>
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      )}

      {/* Отображение при загрузке (после первоначальной загрузки) */}
      {loading && report && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      )}
    </Box>
  );
};

PerformanceReport.propTypes = {
  projectId: PropTypes.number
};

export default PerformanceReport;
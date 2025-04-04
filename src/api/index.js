const express = require('express');
const router = express.Router();

// Подключение маршрутов
// router.use('/tasks', require('./routes/tasks'));
// router.use('/projects', require('./routes/projects'));
// router.use('/code', require('./routes/code'));

// Временный маршрут для проверки API
router.get('/status', (req, res) => {
  res.json({ status: 'API работает' });
});

module.exports = router;

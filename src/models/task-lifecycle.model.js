// src/models/task-lifecycle.model.js

/**
 * Модель для управления жизненным циклом задачи
 */
class TaskLifecycle {
    /**
     * Получает список всех возможных статусов задачи
     * @returns {Object} - Список статусов с описаниями и следующими статусами
     */
    static getStatuses() {
      return {
        'pending': {
          title: 'Ожидающая',
          description: 'Задача создана, но работа еще не начата',
          nextStatuses: ['in_progress', 'blocked', 'cancelled'],
          color: '#3498db',
          icon: 'clock'
        },
        'in_progress': {
          title: 'В работе',
          description: 'Работа над задачей активно ведется',
          nextStatuses: ['code_review', 'blocked', 'completed', 'failed'],
          color: '#f39c12',
          icon: 'activity'
        },
        'code_review': {
          title: 'Ревью кода',
          description: 'Код написан и ожидает проверки',
          nextStatuses: ['in_progress', 'testing', 'completed'],
          color: '#9b59b6',
          icon: 'check-circle'
        },
        'testing': {
          title: 'Тестирование',
          description: 'Код проходит тестирование',
          nextStatuses: ['in_progress', 'completed', 'failed'],
          color: '#2ecc71',
          icon: 'tool'
        },
        'blocked': {
          title: 'Заблокирована',
          description: 'Выполнение задачи заблокировано из-за внешних факторов',
          nextStatuses: ['pending', 'in_progress', 'cancelled'],
          color: '#e74c3c',
          icon: 'alert-circle'
        },
        'completed': {
          title: 'Завершена',
          description: 'Задача полностью выполнена',
          nextStatuses: ['in_progress', 'closed'],
          color: '#27ae60',
          icon: 'check'
        },
        'failed': {
          title: 'Не выполнена',
          description: 'Выполнение задачи завершилось неудачей',
          nextStatuses: ['in_progress', 'cancelled', 'closed'],
          color: '#c0392b',
          icon: 'x-circle'
        },
        'cancelled': {
          title: 'Отменена',
          description: 'Задача отменена и не будет выполняться',
          nextStatuses: ['pending', 'closed'],
          color: '#7f8c8d',
          icon: 'slash'
        },
        'closed': {
          title: 'Закрыта',
          description: 'Задача закрыта и архивирована',
          nextStatuses: [],
          color: '#95a5a6',
          icon: 'archive'
        }
      };
    }
  
    /**
     * Проверяет, является ли переход статуса допустимым
     * @param {string} currentStatus - Текущий статус
     * @param {string} newStatus - Новый статус
     * @returns {boolean} - true, если переход допустим
     */
    static isValidTransition(currentStatus, newStatus) {
      const statuses = this.getStatuses();
      
      // Проверяем существование статусов
      if (!statuses[currentStatus] || !statuses[newStatus]) {
        return false;
      }
      
      // Проверяем, есть ли новый статус в списке возможных переходов
      return statuses[currentStatus].nextStatuses.includes(newStatus);
    }
  
    /**
     * Получает следующие возможные статусы
     * @param {string} currentStatus - Текущий статус
     * @returns {Array<string>} - Список допустимых следующих статусов
     */
    static getNextStatuses(currentStatus) {
      const statuses = this.getStatuses();
      
      if (!statuses[currentStatus]) {
        return [];
      }
      
      return statuses[currentStatus].nextStatuses;
    }
  
    /**
     * Получает информацию о статусе
     * @param {string} status - Статус
     * @returns {Object|null} - Информация о статусе или null, если статус не найден
     */
    static getStatusInfo(status) {
      const statuses = this.getStatuses();
      return statuses[status] || null;
    }
  
    /**
     * Определяет, является ли статус конечным (задача завершена)
     * @param {string} status - Статус
     * @returns {boolean} - true, если статус конечный
     */
    static isFinalStatus(status) {
      return ['completed', 'failed', 'cancelled', 'closed'].includes(status);
    }
  
    /**
     * Получает этапы жизненного цикла задачи
     * @returns {Array<Object>} - Список этапов жизненного цикла
     */
    static getLifecycleStages() {
      return [
        {
          id: 'planning',
          title: 'Планирование',
          statuses: ['pending'],
          actions: ['create', 'decompose', 'estimate']
        },
        {
          id: 'development',
          title: 'Разработка',
          statuses: ['in_progress'],
          actions: ['code', 'generate_code', 'update']
        },
        {
          id: 'review',
          title: 'Проверка',
          statuses: ['code_review'],
          actions: ['review', 'approve', 'reject']
        },
        {
          id: 'testing',
          title: 'Тестирование',
          statuses: ['testing'],
          actions: ['test', 'report_bug']
        },
        {
          id: 'completion',
          title: 'Завершение',
          statuses: ['completed', 'failed', 'cancelled', 'closed'],
          actions: ['close', 'reopen']
        }
      ];
    }
  
    /**
     * Получает текущий этап жизненного цикла задачи по статусу
     * @param {string} status - Статус задачи
     * @returns {Object|null} - Этап жизненного цикла или null, если не найден
     */
    static getCurrentStage(status) {
      const stages = this.getLifecycleStages();
      return stages.find(stage => stage.statuses.includes(status)) || null;
    }
  
    /**
     * Получает текст для события смены статуса
     * @param {string} oldStatus - Старый статус
     * @param {string} newStatus - Новый статус
     * @returns {string} - Текст события
     */
    static getStatusChangeText(oldStatus, newStatus) {
      const statusInfo = this.getStatuses();
      
      const oldTitle = statusInfo[oldStatus]?.title || oldStatus;
      const newTitle = statusInfo[newStatus]?.title || newStatus;
      
      return `Статус изменен: ${oldTitle} → ${newTitle}`;
    }
  }
  
  module.exports = TaskLifecycle;
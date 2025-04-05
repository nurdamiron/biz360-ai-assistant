// src/models/project-search.model.js

/**
 * Модель для валидации параметров поиска и фильтрации проектов
 */
class ProjectSearch {
    /**
     * Валидирует параметры запроса для поиска проектов
     * @param {Object} query - Параметры запроса
     * @returns {Object} - Результат валидации { isValid: boolean, errors: string[] }
     */
    static validateSearchQuery(query) {
      const errors = [];
      
      // Проверка сортировки
      if (query.sortBy) {
        const allowedSortFields = ['name', 'created_at', 'updated_at', 'status'];
        
        if (!allowedSortFields.includes(query.sortBy)) {
          errors.push(`Недопустимое поле сортировки. Разрешены: ${allowedSortFields.join(', ')}`);
        }
      }
      
      // Проверка направления сортировки
      if (query.sortOrder && !['asc', 'desc'].includes(query.sortOrder.toLowerCase())) {
        errors.push('Направление сортировки должно быть "asc" или "desc"');
      }
      
      // Проверка пагинации
      if (query.page && (isNaN(parseInt(query.page)) || parseInt(query.page) < 1)) {
        errors.push('Номер страницы должен быть положительным числом');
      }
      
      if (query.limit && (isNaN(parseInt(query.limit)) || parseInt(query.limit) < 1 || parseInt(query.limit) > 100)) {
        errors.push('Лимит должен быть числом от 1 до 100');
      }
      
      // Проверка статуса
      if (query.status && !['active', 'inactive', 'archived'].includes(query.status)) {
        errors.push('Статус должен быть "active", "inactive" или "archived"');
      }
      
      // Проверка тегов
      if (query.tags) {
        if (!Array.isArray(query.tags) && typeof query.tags !== 'string') {
          errors.push('Теги должны быть строкой или массивом строк');
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors
      };
    }
    
    /**
     * Нормализует параметры запроса для поиска проектов
     * @param {Object} query - Исходные параметры запроса
     * @returns {Object} - Нормализованные параметры
     */
    static normalizeSearchQuery(query) {
      const normalized = {
        page: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 10,
        sortBy: query.sortBy || 'updated_at',
        sortOrder: (query.sortOrder || 'desc').toLowerCase(),
        search: query.search || '',
        status: query.status || null,
        tags: null
      };
      
      // Преобразуем camelCase в snake_case для совместимости с БД
      if (normalized.sortBy === 'createdAt') normalized.sortBy = 'created_at';
      if (normalized.sortBy === 'updatedAt') normalized.sortBy = 'updated_at';
      
      // Обработка тегов
      if (query.tags) {
        if (Array.isArray(query.tags)) {
          normalized.tags = query.tags;
        } else if (typeof query.tags === 'string') {
          normalized.tags = query.tags.split(',').map(tag => tag.trim());
        }
      }
      
      return normalized;
    }
    
    /**
     * Создает условия SQL для поиска и фильтрации проектов
     * @param {Object} normalizedQuery - Нормализованные параметры запроса
     * @returns {Object} - Объект с условиями SQL и параметрами
     */
    static buildSearchConditions(normalizedQuery) {
      const conditions = [];
      const params = [];
      
      // Добавляем условие поиска
      if (normalizedQuery.search) {
        conditions.push('(name LIKE ? OR description LIKE ?)');
        params.push(`%${normalizedQuery.search}%`, `%${normalizedQuery.search}%`);
      }
      
      // Добавляем условие фильтрации по статусу
      if (normalizedQuery.status) {
        conditions.push('status = ?');
        params.push(normalizedQuery.status);
      }
      
      // Добавляем условие фильтрации по тегам
      if (normalizedQuery.tags && normalizedQuery.tags.length > 0) {
        // Для работы с тегами предполагается, что в базе данных есть таблица project_tags
        // и связь многие-ко-многим с таблицей projects
        // Это потребует JOIN с таблицей project_tags
        
        // Тут заглушка для примера
        // В реальном приложении нужно будет адаптировать под конкретную схему БД
        conditions.push('EXISTS (SELECT 1 FROM project_tags WHERE project_id = projects.id AND tag_name IN (?))');
        params.push(normalizedQuery.tags);
      }
      
      return {
        whereClause: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
        params
      };
    }
  }
  
  module.exports = ProjectSearch;
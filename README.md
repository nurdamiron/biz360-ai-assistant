# Biz360 CRM AI-Ассистент Разработчика

Интеллектуальная система автоматизации разработки Biz360 CRM, способная самостоятельно анализировать требования, планировать задачи, писать и исправлять код, создавать тесты и интегрироваться с системами контроля версий.

## Описание

Biz360 CRM AI-Ассистент представляет собой модульную систему, которая помогает разработчикам автоматизировать рутинные задачи и ускорить процесс разработки. Система использует современные модели искусственного интеллекта (Claude от Anthropic) для анализа кода, генерации новых компонентов и автоматизации процесса разработки.

### Ключевые возможности

- **Анализ проекта**: автоматическое сканирование и понимание структуры проекта
- **Декомпозиция задач**: разбиение сложных задач на понятные подзадачи
- **Генерация кода**: создание нового кода на основе спецификаций
- **Автоматическое тестирование**: создание и запуск модульных тестов
- **Интеграция с Git**: автоматическое создание веток, коммитов и PR
- **Самообучение**: улучшение работы на основе обратной связи
- **Веб-интерфейс**: удобный интерфейс для взаимодействия с системой

## Архитектура

Система состоит из следующих основных компонентов:

1. **Центр управления (Controller)** - координирует работу всех модулей
2. **Система понимания проекта (Project Understanding)** - анализирует структуру проекта
3. **Планировщик задач (Task Planner)** - декомпозирует задачи
4. **Генератор кода (Code Generator)** - создает и улучшает код
5. **Система тестирования (Testing System)** - создает и запускает тесты
6. **Менеджер VCS (VCS Manager)** - интегрируется с системами контроля версий
7. **Система обучения (Learning System)** - анализирует обратную связь для улучшения
8. **Система саморефлексии (Self-Reflection System)** - оценивает эффективность и предлагает улучшения
9. **Веб-интерфейс (UI)** - предоставляет пользовательский интерфейс

## Требования

- Node.js 14+ 
- MySQL 5.7+
- Git
- API ключ для Anthropic Claude

## Установка

1. Клонировать репозиторий:
```bash
git clone https://github.com/biz360/ai-assistant.git
cd ai-assistant
```

2. Запустить скрипт установки:
```bash
npm run setup
```

Скрипт установки выполнит следующие действия:
- Проверит наличие необходимых зависимостей
- Настроит переменные окружения (создаст файл .env)
- Создаст и настроит базу данных
- Создаст необходимые директории
- Инициализирует компоненты системы

## Конфигурация

Основные настройки хранятся в файле `.env`:

```
# Основные настройки
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Настройки базы данных
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=biz360_ai_assistant

# Настройки LLM API
LLM_API_KEY=your_anthropic_api_key
LLM_MODEL=claude-3-opus-20240229
LLM_API_URL=https://api.anthropic.com
LLM_MAX_TOKENS=4000
LLM_TEMPERATURE=0.7

# Настройки для работы с Git
GIT_USERNAME=your_github_username
GIT_TOKEN=your_github_token
```

## Запуск

Запуск в обычном режиме:
```bash
npm start
```

Запуск в режиме разработки (с автоматической перезагрузкой при изменении файлов):
```bash
npm run dev
```

После запуска API будет доступен по адресу: `http://localhost:3000`

## Использование

### Веб-интерфейс

После запуска сервера откройте `http://localhost:3000` в браузере для доступа к веб-интерфейсу AI-ассистента.

### API

Основные API эндпоинты:

- `GET /api/status` - получить общий статус системы
- `GET /api/tasks` - получить список задач
- `POST /api/tasks` - создать новую задачу
- `GET /api/tasks/:id` - получить информацию о задаче
- `POST /api/tasks/:id/decompose` - декомпозировать задачу
- `POST /api/tasks/:id/generate` - сгенерировать код для задачи

AI-ассистент API:
- `GET /api/ai-assistant/status` - получить статус AI-ассистента
- `POST /api/ai-assistant/analyze-task` - получить рекомендации для задачи
- `POST /api/ai-assistant/process-task` - автоматически обработать задачу
- `POST /api/ai-assistant/feedback` - отправить обратную связь
- `GET /api/ai-assistant/performance-report` - получить отчет о производительности
- `POST /api/ai-assistant/analyze-failed-generation` - анализировать неудачную генерацию
- `POST /api/ai-assistant/regenerate-code` - повторно сгенерировать код

### Автоматизация рабочего процесса

Типичный рабочий процесс с AI-ассистентом:

1. Создать задачу через веб-интерфейс или API
2. AI-ассистент анализирует задачу и декомпозирует её на подзадачи
3. Система генерирует код для каждой подзадачи
4. Для сгенерированного кода создаются автоматические тесты
5. Код коммитится в репозиторий и создается Pull Request
6. Разработчик проверяет PR и предоставляет обратную связь
7. Система самообучается на основе обратной связи

## Расширение функциональности

Система спроектирована модульно, что позволяет легко расширять её функциональность:

1. Для добавления поддержки новых языков программирования, добавьте соответствующие валидаторы в `src/core/code-generator/code-validator.js`
2. Для интеграции с другими системами контроля версий, расширьте `src/core/vcs-manager/`
3. Для поддержки новых моделей ИИ, модифицируйте `src/utils/llm-client.js`

## Мониторинг и управление

Система предоставляет интерфейс для мониторинга производительности и управления:

- Панель управления с общей статистикой
- Отчеты об использовании ресурсов и эффективности
- Контроль за расходом токенов LLM API
- Анализ успешных и неуспешных генераций

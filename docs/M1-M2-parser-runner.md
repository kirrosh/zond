# M1: Parser + M2: Runner

Модули парсинга YAML-тестов и их выполнения.

## Быстрый старт

```bash
bun add zod
bun test
```

Программный запуск:

```typescript
import { parseFile } from "./src/core/parser/index.ts";
import { runSuite } from "./src/core/runner/index.ts";

const suite = await parseFile("examples/jsonplaceholder.yaml");
const result = await runSuite(suite);

console.log(`${result.passed}/${result.total} passed`);
```

## YAML-формат тестов

### Минимальный пример

```yaml
name: Health Check
tests:
  - name: "API is alive"
    GET: /health
    expect:
      status: 200
```

### Полный пример (CRUD-цепочка с captures)

```yaml
name: Users CRUD
base_url: "{{base}}"
headers:
  Authorization: "Bearer {{token}}"
  Content-Type: application/json

config:
  timeout: 10000
  retries: 1
  retry_delay: 1000

tests:
  - name: "Create user"
    POST: /users
    json:
      name: "{{$randomName}}"
      email: "{{$randomEmail}}"
    expect:
      status: 201
      body:
        id: { capture: user_id, type: integer }
        name: { type: string }
      duration: 2000

  - name: "Get created user"
    GET: /users/{{user_id}}
    expect:
      status: 200
      body:
        id: { equals: "{{user_id}}" }

  - name: "Delete user"
    DELETE: /users/{{user_id}}
    expect:
      status: 204
```

### Формат шагов

HTTP-метод указывается как ключ: `GET: /path`, `POST: /path`, `PUT:`, `PATCH:`, `DELETE:`.

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Название шага (обязательное) |
| `GET/POST/PUT/PATCH/DELETE` | string | HTTP-метод + путь (обязательное) |
| `headers` | Record | Заголовки запроса |
| `json` | any | JSON-тело (auto Content-Type: application/json) |
| `form` | Record | Form-urlencoded тело |
| `query` | Record | Query-параметры |
| `expect` | object | Блок assertions |

### Assertions (блок expect)

| Поле | Описание |
|------|----------|
| `status` | Ожидаемый HTTP-код (exact match) |
| `duration` | Максимальное время ответа в мс |
| `headers` | Проверка заголовков ответа (exact match) |
| `body` | Проверка полей JSON-ответа по dot-path |

### Assertion rules (правила для body-полей)

```yaml
body:
  id: { type: integer }              # проверка типа
  name: { equals: "John" }           # точное совпадение
  email: { matches: ".+@.+" }        # regex
  bio: { contains: "developer" }     # подстрока
  age: { gt: 18, lt: 100 }           # числовые сравнения
  avatar: { exists: true }           # поле существует
  id: { capture: user_id }           # сохранить в переменную
```

Поддерживаемые типы: `string`, `integer`, `number`, `boolean`, `array`, `object`.

Вложенные поля через dot-path: `data.user.name`, `items.0.id`.

### Переменные

Синтаксис: `{{variable_name}}`

Источники значений (приоритет):
1. CLI-флаги (`--auth-token` → `auth_token`)
2. Environment (из `.env.yaml` или программно)
3. Captures из предыдущих шагов
4. Встроенные генераторы (с префиксом `$`)

### Встроенные генераторы

| Генератор | Пример | Тип |
|-----------|--------|-----|
| `{{$uuid}}` | `550e8400-e29b-41d4-a716-446655440000` | string |
| `{{$timestamp}}` | `1708876800` | number |
| `{{$randomName}}` | `John Smith` | string |
| `{{$randomEmail}}` | `xk92m@test.com` | string |
| `{{$randomInt}}` | `4217` | number |
| `{{$randomString}}` | `aBcDeFgH` | string |

### Config

```yaml
config:
  timeout: 30000        # мс, таймаут запроса (default: 30000)
  retries: 0            # повторы при сетевой ошибке (default: 0)
  retry_delay: 1000     # задержка между повторами (default: 1000)
  follow_redirects: true
  verify_ssl: true
```

Retry срабатывает только на сетевые ошибки (fetch throws). HTTP 4xx/5xx — валидные ответы для assertions.

## Архитектура

### Parser (src/core/parser/)

```
parseFile("test.yaml") → Bun.file() → Bun.YAML.parse() → Zod validate → TestSuite
```

- `types.ts` — интерфейсы TypeScript
- `schema.ts` — Zod-схемы, method-as-key transform (`POST: /path` → `{method, path}`)
- `variables.ts` — подстановка `{{var}}`, генераторы, загрузка `.env.yaml`
- `yaml-parser.ts` — чтение файлов/директорий

### Runner (src/core/runner/)

```
runSuite(suite, env) → для каждого step: substitute → fetch → captures → assertions → StepResult
```

- `http-client.ts` — fetch-обёртка с timeout (AbortController) и retry
- `assertions.ts` — проверка всех assertion rules + извлечение captures
- `executor.ts` — оркестратор: sequential steps, capture propagation, skip logic

### Логика выполнения

1. Для каждого шага проверяется, не зависит ли он от failed capture → skip
2. Подстановка переменных (env + captures) в path, headers, body, query
3. HTTP-запрос через fetch с timeout/retry
4. Извлечение captures из ответа
5. Проверка assertions
6. Если step failed/error — его captures помечаются как failed

Suites выполняются параллельно (`Promise.all`), steps внутри suite — последовательно (из-за captures).

## Environment файлы

```yaml
# .env.yaml (по умолчанию)
base: http://localhost:3000/api
token: dev-token-123
```

Загрузка:

```typescript
import { loadEnvironment } from "./src/core/parser/index.ts";

const env = await loadEnvironment();           // .env.yaml
const env = await loadEnvironment("staging");  // .env.staging.yaml
```

## Зависимости

- **zod** — валидация YAML-схемы
- Всё остальное — Bun built-in: `Bun.YAML`, `Bun.Glob`, `Bun.file()`, `Bun.sleep()`, native `fetch`

## Тесты

```bash
bun test                    # все тесты (100 tests)
bun test tests/parser/      # только парсер (43 tests)
bun test tests/runner/      # только раннер (55 tests)
bun test tests/integration/ # интеграционные (2 tests, real HTTP)
```

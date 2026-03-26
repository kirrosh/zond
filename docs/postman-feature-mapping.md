# Zond ↔ Postman Feature Mapping

Ресерч для развития `zond export postman`. Документирует полные соответствия, частичные и несоответствия между zond и Postman Collection v2.1 / Newman.

---

## 1. ПОЛНЫЕ СООТВЕТСТВИЯ (конвертируются 1-в-1)

### HTTP-запросы

| Zond | Postman | Статус |
|------|---------|--------|
| `GET/POST/PUT/PATCH/DELETE: /path` | `request.method` + `request.url` | ✅ |
| `base_url: "{{base_url}}"` | `url.raw`, `url.host` | ✅ |
| `headers: { Key: Value }` | `request.header[]` | ✅ |
| `query: { param: value }` | `url.query[]` | ✅ |
| `json: { ... }` | `body.mode: "raw"`, language: json | ✅ |
| `form: { key: val }` | `body.mode: "urlencoded"` | ✅ |
| Suite-level headers + step-level headers (merge) | `request.header[]` (merged) | ✅ |

### Переменные

| Zond | Postman | Статус |
|------|---------|--------|
| `{{variable}}` | `{{variable}}` | ✅ Синтаксис идентичен |
| `{{$randomEmail}}` | `{{$randomEmail}}` | ✅ |
| `{{$randomInt}}` | `{{$randomInt}}` | ✅ |
| `{{$timestamp}}` | `{{$timestamp}}` | ✅ |
| `{{$isoTimestamp}}` | `{{$isoTimestamp}}` | ✅ |
| `{{$randomString}}` | `{{$randomAlphaNumeric}}` | ✅ (маппинг имён) |
| `{{$randomName}}` | `{{$randomFullName}}` | ✅ (маппинг имён) |
| `{{$uuid}}` | `{{$guid}}` | ✅ (маппинг имён) |
| `.env.yaml` переменные | Postman Environment JSON | ✅ через `--env` |

### Assertions → pm.test()

| Zond assertion | Postman | Статус |
|----------------|---------|--------|
| `status: 200` | `pm.response.to.have.status(200)` | ✅ |
| `status: [200, 201]` | `pm.expect(pm.response.code).to.be.oneOf([200,201])` | ✅ |
| `duration: 2000` | `pm.expect(pm.response.responseTime).to.be.below(2000)` | ✅ |
| `expect.headers: { X-H: v }` | `pm.response.to.have.header('X-H', 'v')` | ✅ |
| `body.field.type: string` | `pm.expect(field).to.be.a('string')` | ✅ |
| `body.field.type: integer` | `pm.expect(field).to.be.a('number')` | ✅ (number — суперсет) |
| `body.field.type: boolean/array/object` | Chai .a() | ✅ |
| `body.field.equals: val` | `pm.expect(field).to.deep.equal(val)` | ✅ |
| `body.field.not_equals: val` | `.to.not.deep.equal(val)` | ✅ |
| `body.field.contains: "str"` | `.to.include('str')` | ✅ |
| `body.field.not_contains: "str"` | `.to.not.include('str')` | ✅ |
| `body.field.matches: "regex"` | `.to.match(/regex/)` | ✅ |
| `body.field.exists: true` | `.to.have.property('field')` | ✅ |
| `body.field.exists: false` | `.to.not.have.property('field')` | ✅ |
| `body.field.gt: N` | `.to.be.above(N)` | ✅ |
| `body.field.lt: N` | `.to.be.below(N)` | ✅ |
| `body.field.gte: N` | `.to.be.at.least(N)` | ✅ |
| `body.field.lte: N` | `.to.be.at.most(N)` | ✅ |
| `body.field.length: N` | `.to.have.lengthOf(N)` | ✅ |
| `body.field.length_gt/gte/lt/lte: N` | `.length > N` etc. | ✅ |
| `body.field.capture: "var"` | `pm.environment.set("var", field)` | ✅ |

### Организация

| Zond | Postman | Статус |
|------|---------|--------|
| TestSuite → папка | Folder | ✅ |
| TestStep → запрос | Item | ✅ |
| `setup: true` → первым | Папка идёт первой в коллекции | ✅ (порядок гарантирован) |
| Captures между шагами | `pm.environment.set()` → доступно в следующих requests | ✅ |
| Captures из setup-сьюта | `pm.environment.set()` в первой папке | ✅ |

### CI/CD

| Zond | Newman/Postman | Статус |
|------|----------------|--------|
| `--report junit` | `-r junit` | ✅ Оба JUnit XML |
| `--report json` | `-r json` | ✅ |
| `--bail` | `--bail` | ✅ |
| Exit code 0/1 | Exit code 0/1 | ✅ |

---

## 2. ЧАСТИЧНЫЕ СООТВЕТСТВИЯ (конвертируются с потерями)

### type: integer

| Zond | Postman | Потеря |
|------|---------|--------|
| `type: "integer"` — проверяет, что число целое (Number.isInteger) | `pm.expect(x).to.be.a('number')` — любое число | ⚠️ Не различает integer vs float |

**Решение**: `pm.expect(Number.isInteger(field)).to.be.true` — уже точнее.

### Числовое сравнение в `equals`

| Zond | Postman | Потеря |
|------|---------|--------|
| `equals: "123"` совпадает с `123` (числовая конверсия) | `deep.equal("123")` — строгое равенство | ⚠️ Семантика разная |

### `body.field.contains` для массивов

| Zond | Postman | Потеря |
|------|---------|--------|
| `contains` работает только для строк | `pm.expect(arr).to.include(item)` работает и для массивов | ℹ️ Postman шире, zond уже |

### Переменные в capture + failed steps

| Zond | Postman | Потеря |
|------|---------|--------|
| Если шаг упал — capture не попадает в среду, зависимые шаги пропускаются | В Postman capture выполняется всегда, даже если pm.test() упал | ⚠️ Поведение разное при ошибках |

### `config.retries`

| Zond | Postman | Потеря |
|------|---------|--------|
| `config.retries: 3` — повторяет все шаги сьюта при failure | Нет нативного retry на уровне коллекции/папки | ⚠️ Не конвертируется |

### `config.verify_ssl: false`

| Zond | Postman | Потеря |
|------|---------|--------|
| `verify_ssl: false` отключает проверку SSL | В Newman: `--ssl-extra-ca-certs` или `--insecure` | ⚠️ Не конвертируется в коллекцию |

### `config.follow_redirects: false`

| Zond | Postman | Потеря |
|------|---------|--------|
| `follow_redirects: false` — не следовать 3xx | В Postman: настройка глобальная, не per-collection | ⚠️ Не конвертируется |

---

## 3. ZOND ФИЧИ БЕЗ АНАЛОГА В POSTMAN

### `each` — итерация по массиву с assertions

```yaml
body:
  items:
    each:
      id: { type: integer }
      name: { type: string }
```

**В Postman**: нет нативного `each` в assertions. Нужен ручной JS:
```javascript
jsonData.items.forEach((item, i) => {
  pm.test(`items[${i}].id is integer`, () => pm.expect(Number.isInteger(item.id)).to.be.true);
  pm.test(`items[${i}].name is string`, () => pm.expect(item.name).to.be.a('string'));
});
```
→ **Можно реализовать в экспортере** — сгенерировать forEach в exec.

### `contains_item` — массив содержит объект с полями

```yaml
body:
  users:
    contains_item:
      name: { equals: "John" }
      active: { equals: true }
```

**В Postman**: нет нативного. Нужен JS:
```javascript
pm.test('users contains item with name=John', () => {
  const found = jsonData.users.some(item => item.name === 'John' && item.active === true);
  pm.expect(found).to.be.true;
});
```
→ **Можно реализовать в экспортере**.

### `set_equals` — равенство массивов как множеств

```yaml
body:
  tags:
    set_equals: ["admin", "user"]
```

**В Postman**: нет нативного. JS:
```javascript
pm.test('tags set equals', () => {
  const expected = ["admin", "user"];
  const actual = jsonData.tags;
  pm.expect(actual.slice().sort()).to.deep.equal(expected.slice().sort());
});
```
→ **Можно реализовать в экспортере**.

### `skip_if` — условный пропуск шага

```yaml
- name: Delete user
  DELETE: /users/{{user_id}}
  skip_if: "user_id == ''"
```

**В Postman**: нет нативного skip_if.
Ближайший аналог — `pm.execution.setNextRequest(null)` или перейти к следующему запросу, но это меняет глобальный поток.

**Обходной путь**: pre-request script с условным setNextRequest:
```javascript
// Pre-request script
if (pm.environment.get("user_id") === "") {
  pm.execution.setNextRequest("Next Request Name");
}
```
→ **Можно реализовать в экспортере** как pre-request event.

### `retry_until` — повторять до условия

```yaml
retry_until:
  condition: "status == 200"
  max_attempts: 10
  delay_ms: 2000
```

**В Postman**: нет нативного. Ближайший аналог — `setNextRequest` с счётчиком:
```javascript
const attempts = pm.environment.get("__retry_count") || 0;
if (pm.response.code !== 200 && attempts < 10) {
  pm.environment.set("__retry_count", attempts + 1);
  pm.execution.setNextRequest("Request Name");
} else {
  pm.environment.unset("__retry_count");
  pm.test("Status is 200", () => pm.response.to.have.status(200));
}
```
→ **Можно реализовать в экспортере** (сложно, меняет поток коллекции).

### `for_each` — loop по массиву

```yaml
- name: Get user {{item}}
  GET: /users/{{item}}
  for_each:
    var: item
    in: [1, 2, 3]
```

**В Postman**: нет нативного for_each в запросе.
- В Collection Runner есть data files (CSV/JSON) — каждая строка = итерация, но для всей коллекции, не одного запроса.
- `setNextRequest` loop — обходной путь.
→ **Не конвертируется** напрямую. Можно развернуть в несколько отдельных запросов.

### `set` шаги — присваивание переменных

```yaml
- name: Set credentials
  set:
    username: "admin"
    password: "secret123"
```

**В Postman**: нет "set-only" запроса. Ближайший аналог — pre-request script в следующем запросе или collection variable.
→ **Частично**: можно эмулировать через pre-request script с `pm.environment.set()`, но нет standalone "step".

### `config.timeout` per-suite

```yaml
config:
  timeout: 5000
```

**В Postman**: timeout — глобальная настройка коллекции или Newman CLI `--timeout-request`. Нет per-folder timeout.
→ **Не конвертируется** per-suite.

### Transform-функции (`concat`, `append`, `length`, `get`, `first`, `map_field`)

Используются в `set:` и `json:` для трансформации данных.

**В Postman**: только через JavaScript в pre-request scripts.
→ **Не конвертируется** декларативно.

### `suite.description`

```yaml
description: "Tests for user CRUD operations"
```

**В Postman**: папки имеют `description` — но текущий экспортер не передаёт его.
→ **Легко добавить** в экспортер.

### `_body` — assertion на всё тело

```yaml
expect:
  body:
    _body: { type: string }  # Всё тело — строка
```

**В Postman**: `pm.response.text()` или `pm.response.body`.
→ **Можно реализовать** в экспортере как специальный случай.

---

## 4. POSTMAN ФИЧИ БЕЗ АНАЛОГА В ZOND

### Pre-request scripts на уровне коллекции/папки

**Postman**: Collection-level pre-request → Folder-level → Request-level (цепочка)

**Zond**: нет pre-request скриптов. Только `set` шаги и переменные.

**Потенциал**: setup suite захватывает auth и кладёт в env — это аналог collection-level setup.

### `setNextRequest` — нелинейный поток

**Postman**: `pm.execution.setNextRequest("Name")` — прыгнуть к любому запросу.

**Zond**: только линейный поток + `skip_if` (пропустить) + `retry_until` (повторить текущий).

### Data files (CSV/JSON) в Collection Runner

**Postman**: запустить коллекцию N раз с разными данными из CSV/JSON-файла.

**Zond**: `for_each` loop для одного шага, но нет data-driven runner для всей коллекции.

### Cookies

**Postman**: `pm.cookies.get()`, `pm.cookies.has()`, куки хранятся между запросами.

**Zond**: нет управления куками.

### Auth типы (OAuth 2.0, AWS Signature, Hawk, NTLM, Digest)

**Postman**: 10+ типов аутентификации с UI-конфигурацией.

**Zond**: auth через обычные headers (`Authorization: Bearer {{token}}`). Нет нативных OAuth flow.

### Binary body

**Postman**: `body.mode: "binary"` — файлы, изображения.

**Zond**: нет бинарных тел.

### GraphQL body

**Postman**: нативный GraphQL mode (query + variables).

**Zond**: нет GraphQL поддержки.

### pm.visualizer — визуализация ответа

**Postman**: HTML-дашборды прямо в интерфейсе.

**Zond**: CLI + web UI (serve), но не в рамках тест-файлов.

### Monitors — scheduled runs

**Postman**: запускать коллекцию по расписанию, уведомления в Slack/email.

**Zond**: нет scheduled runs (только CI/CD).

### Mock servers

**Postman**: создать mock на основе примеров ответов.

**Zond**: нет mock-сервера.

### Collection-level variables

**Postman**: переменные, привязанные к коллекции (не к environment), доступны везде в коллекции.

**Zond**: все переменные — environment-level.

### Multiple authentication per request

**Postman**: можно переопределить auth на уровне папки или запроса, наследовать от родителя.

**Zond**: auth — просто header, нет иерархии.

### Iteration data (`pm.iterationData`)

**Postman**: при запуске с data file — `pm.iterationData.get("key")`.

**Zond**: нет.

### pm.globals — workspace-wide переменные

**Postman**: глобальные переменные доступны во всех коллекциях воркспейса.

**Zond**: нет эквивалента.

### Примеры ответов (saved responses)

**Postman**: сохранять пример ответа к запросу для документации и mock.

**Zond**: нет.

### HTTP HEAD, OPTIONS, TRACE

**Postman**: поддерживает все HTTP-методы.

**Zond**: только GET, POST, PUT, PATCH, DELETE.

---

## 5. КАРТА КОНВЕРТИРУЕМОСТИ

```
┌─────────────────────────────────────────────────────────────────┐
│                    СТЕПЕНЬ КОНВЕРТАЦИИ                           │
├──────────────────────────┬──────────────────────────────────────┤
│  Реализовано (текущий    │  HTTP запросы, headers, query,       │
│  экспортер)              │  json/form body, все assertions       │
│                          │  кроме each/contains_item/set_equals, │
│                          │  captures, setup ordering, env export │
├──────────────────────────┼──────────────────────────────────────┤
│  Можно реализовать       │  each → forEach в pm.test()          │
│  в экспортере            │  contains_item → .some() в pm.test() │
│                          │  set_equals → sort+deep.equal         │
│                          │  skip_if → pre-request setNextRequest │
│                          │  retry_until → setNextRequest loop    │
│                          │  for_each → развернуть в N запросов  │
│                          │  set steps → pre-request script       │
│                          │  suite.description → folder.desc      │
│                          │  type:integer → Number.isInteger()    │
│                          │  config.verify_ssl → Newman флаг      │
│                          │  config.timeout → Newman флаг         │
├──────────────────────────┼──────────────────────────────────────┤
│  Конвертируется          │  config.retries → нет аналога         │
│  только частично         │  config.follow_redirects → нет        │
│  или не конвертируется   │  transforms (concat/append/etc.)      │
│                          │  binary/GraphQL body                  │
│                          │  Postman OAuth/AWS/NTLM auth types    │
│                          │  Postman Monitors/Mocks               │
│                          │  Data files (CSV/JSON iteration)       │
│                          │  pm.globals, cookies                  │
└──────────────────────────┴──────────────────────────────────────┘
```

---

## 6. ПРИОРИТЕТНЫЕ УЛУЧШЕНИЯ ЭКСПОРТЕРА

### Высокий приоритет (часто нужны, реализуемы)

1. **`each` → `forEach` в pm.test()**
   ```javascript
   pm.test("items[0].id is integer", () => pm.expect(Number.isInteger(jsonData.items[0].id)).to.be.true);
   // или forEach loop
   jsonData.items.forEach((item, i) => {
     pm.test(`items[${i}].id is integer`, () => ...);
   });
   ```

2. **`contains_item` → `.some()` проверка**
   ```javascript
   pm.test("users contains item", () => {
     pm.expect(jsonData.users.some(i => i.name === "John")).to.be.true;
   });
   ```

3. **`set_equals` → sort + deep.equal**
   ```javascript
   pm.test("tags set equals", () => {
     pm.expect([...jsonData.tags].sort()).to.deep.equal([...["admin","user"]].sort());
   });
   ```

4. **`type: "integer"` → `Number.isInteger()`**
   ```javascript
   pm.test("id is integer", () => pm.expect(Number.isInteger(jsonData.id)).to.be.true);
   ```

5. **`suite.description` → folder description**

6. **`set` шаги → pre-request script в следующем запросе**

### Средний приоритет

7. **`skip_if` → pre-request event с `setNextRequest`**
   ```javascript
   // pre-request script
   if (!pm.environment.get("user_id")) {
     pm.execution.setNextRequest("NextRequestName");
   }
   ```
   Сложность: нужно знать имя следующего запроса при генерации.

8. **`config.verify_ssl: false` → комментарий с Newman флагом** (`# run with: newman run ... --insecure`)

9. **`config.timeout` → комментарий с Newman флагом** (`# run with: newman run ... --timeout-request 5000`)

10. **`for_each` → развернуть в N запросов** (если `in` — статический массив)

### Низкий приоритет

11. **`retry_until` → setNextRequest loop** (сложная логика, может ломать порядок)

12. **Newman script generation** — генерировать `package.json` / `newman-run.sh` с нужными флагами из suite config.

---

## 7. АРХИТЕКТУРНЫЕ ВОЗМОЖНОСТИ ДАЛЬНЕЙШЕГО РАЗВИТИЯ

### A. Импорт из Postman в zond (обратная конвертация)

Postman Collection → YAML тесты zond.

- `request.*` → TestStep (метод, path, headers, json/form body)
- `event[test].script.exec` → нельзя автоматически → нужен AI-парсинг JS assertions
- Переменные: `{{var}}` → прямой маппинг
- Папки → Suites

**Сложность**: JS test scripts → декларативные assertions — требует NLP/AI или эвристик.

### B. Newman config generation

При экспорте генерировать скрипт запуска, учитывающий suite config:

```bash
#!/bin/bash
# Generated by zond export postman
newman run collection.postman.json \
  -e collection.postman_environment.json \
  --timeout-request 5000 \
  --bail \
  -r junit,cli \
  --reporter-junit-export results.xml
```

### C. Postman Environment per zond --env

Поддержка нескольких окружений: `zond export postman ... --env staging` → создать `staging.postman_environment.json`.

### D. Collection-level pre-request script

Для setup-сьюта с captures — добавить collection-level pre-request script, который проверяет наличие обязательных переменных и выдаёт понятные ошибки.

### E. Request examples (saved responses)

Сохранять example responses из исторических запусков (zond.db) как Postman examples — для mock-сервера.

---

## 8. ОГРАНИЧЕНИЯ POSTMAN, КОТОРЫХ НЕТ В ZOND

| Ограничение Postman | Zond |
|--------------------|------|
| Только 25 коллекции-ранов/мес на free | Нет лимитов (локально) |
| Нет per-suite timeout | `config.timeout` per suite |
| Нет natively HEAD/OPTIONS в assertions | Нет таких методов в zond тоже |
| Нет async/await в test scripts | Не применимо (YAML декларативно) |
| Нет `require()` в sandbox | Не применимо |
| Нет встроенной coverage | `zond coverage` — полноценный анализ |
| Нет истории runs с SQLite | `zond db` — история, diff, diagnose |
| Нет генератора тестов из OpenAPI | `zond generate` |
| Нет `for_each` loop | `for_each` step |
| Нет `retry_until` | `retry_until` step |
| Нет `skip_if` | `skip_if` step |

---

*Дата: 2026-03-26. Версия zond: fix/generator-quality-improvements.*

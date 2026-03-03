# Проблемы при первичной генерации тестов

## 1. `writeSuites` возвращал пустой массив при incremental generation

**Проблема:** Функция `writeSuites` возвращала только новые файлы. При повторной генерации (incremental mode) существующие файлы пропускались и не попадали в результат — MCP-инструмент `generate_tests` возвращал `files: []`, хотя файлы на диске есть.

**Исправление:** `writeSuites` теперь возвращает `{ written: string[], skipped: string[] }`. MCP и CLI используют оба списка для полного отчёта.

**Файлы:** `src/core/generator/serializer.ts` (ранее skeleton.ts)

---

## 2. `getDb()` не восстанавливался после удаления файла БД

**Проблема:** Синглтон `_db` кешировал соединение. Если файл `apitool.db` удалялся (при пересоздании проекта), последующие вызовы `getDb()` возвращали "disk I/O error" — соединение было протухшим.

**Исправление:** `getDb()` теперь проверяет `existsSync(path)` перед возвратом кешированного соединения. Если файл удалён — соединение пересоздаётся.

**Файлы:** `src/db/schema.ts`

---

## 3. MCP `generate_tests` не создавал коллекцию и окружение в БД

**Проблема:** Блок создания коллекции/окружения падал в `catch` из-за проблемы #2 (протухшее DB-соединение). Ошибка тихо проглатывалась.

**Исправление:** Исправлен `getDb()` (проблема #2). Добавлено логирование ошибок в `catch` вместо тихого игнорирования.

**Примечание:** MCP tool `generate_tests` удалён в M21. AI-генерация доступна через `apitool ai-generate` и WebUI.

**Файлы:** `src/db/schema.ts`

---

## 4. Относительный `base_url` из спецификации ломал Explorer и тесты

**Проблема:** Swagger-спецификация содержит `servers[0].url = "/docgen2/docgen-ui-service/"` — относительный URL. При Try it в Explorer этот URL конкатенировался с path, давая невалидный URL для `fetch()`. В тестах (runner) аналогично — URL без хоста невалиден.

**Исправление:**
- Explorer: если `base_url` относительный — поле остаётся пустым с placeholder `https://your-host/...`
- Explorer: если в окружении БД есть абсолютный `base_url` — подставляется автоматически
- `/api/try`: добавлена валидация — возвращает понятную ошибку, если URL не абсолютный

**Файлы:** `src/web/routes/explorer.ts`, `src/web/routes/api.ts`, `src/web/server.ts`

---

## 5. HTMX загружался с CDN (unpkg.com)

**Проблема:** HTMX подгружался с `https://unpkg.com/htmx.org@2.0.4`. В корпоративных сетях CDN может быть заблокирован → кнопка "Try it" и все HTMX-элементы не работают (JS не загрузился).

**Исправление:** HTMX скачан локально в `src/web/static/htmx.min.js` и сервируется с `/static/htmx.min.js`.

**Файлы:** `src/web/static/htmx.min.js`, `src/web/server.ts`, `src/web/views/layout.ts`

---

## 6. Self-signed сертификаты блокировали запросы

**Проблема:** Внутренние API используют self-signed сертификаты. `fetch()` в Bun по умолчанию отклоняет такие соединения с ошибкой `self signed certificate in certificate chain`.

**Исправление:** Добавлен `tls: { rejectUnauthorized: false }` во все `fetch()`:
- Explorer Try it (`/api/try`)
- Explorer authorize proxy (`/api/authorize`)
- Test runner (`http-client.ts`)

**Файлы:** `src/web/routes/api.ts`, `src/core/runner/http-client.ts`

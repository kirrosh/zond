# Раунд 3 — фидбэк после m-8 HIGH-задач

> Дата: 2026-05-05 (пост-TASK-138)
> Контекст: повторный проход аудит-флоу с обновлёнными CLI-командами
> (`zond discover`, `probe-validation --use-real-parents`,
> `probe-mass-assignment --discover-fk`, `zond probe-security`,
> `zond generate --explain`).

## Остаточные пробелы

### §J — cleanup на PUT-rename'ах не восстанавливает оригинал

probe-security сейчас делает `cleanup = DELETE-if-2xx`. На POST это
работает. На PUT `update` — ломает живые данные: probe переименовал
DSN-ключ в `"zond-safe%0d%0a…"` и не вернул обратно.

**Нужно:** на stateful PUT endpoint'ах
`cleanup = snapshot-before (GET) + PUT-original-after`. До этой правки
probe-security нельзя запускать на чужих prod-org'ах без присмотра.

Закрыто как **TASK-151** (HIGH, блокер для unattended prod-use).

### §K — false-negative из-за слишком жадного baseline body

`PUT /projects/{org}/{proj}/` — на нём в раунде 2 ручной CRLF на
`subjectPrefix` дал HIGH (proven). После TASK-138 та же ручка
попала в `INCONCLUSIVE-BASELINE`: автоген собрал «полный» body со всеми
полями → API отдал 400 → атаки не пошли.

Sentry поддерживает partial PUT (только то, что меняется). Нужен
**fallback с минимальным body**, содержащим только атакуемое поле,
если baseline на полном body даёт 4xx.

Закрыто как **TASK-152** (HIGH, false-negative в proven HIGH-кейсе).

### §L — fuzzy-echo: верный CRLF классифицируется как LOW

Текущий классификатор сравнивает payload в response через
`JSON.stringify(body).includes(needle)`. Если бэк стрипит `\r`, но
оставляет `\n`, или URL-декодирует `%0d%0a` → `\r\n` — sub-string не
матчится → severity = LOW вместо HIGH.

**Нужно:** сравнивать после нормализации:
- URL-decode (`%0d%0a` ↔ `\r\n`).
- Strip-CR / strip-LF варианты (если хоть один из символов остался —
  уже инъекция).
- Случай частичного echo полей вокруг payload (subject="x\r\n…" → в
  ответе только "…" без префикса).

Закрыто как **TASK-153** (MEDIUM).

### §M — в конце digest нет готовой команды для CI

После прогона probe-security печатается digest. Нет последней строки
вида `Run regression suite on CI: zond run apis/<name>/probes/security-emit/`.
Сейчас нужно вручную дописать команду в issue.

### §N — в HIGH-строке нет конкретного payload'а

HIGH-finding в digest пишется как
`url / ssrf → 500 (high) — 5xx unhandled`. Но не показано, какой именно
payload триггернул (`http://127.0.0.1` vs `file:///etc/passwd` vs
`http://169.254.169.254/...`) — приходится копать в emit-tests/YAML.

§M + §N → **TASK-154** (LOW, UX-полировка digest'а).

## По скиллу

### Хорошо

- Command-first переписан Phase 5.2 — правильное направление, не нужно
  больше копипастить YAML-шаблоны.

### Можно улучшить

1. **Явный warning о мутации state.** В Phase 5.2 после `zond probe-security`
   добавить блок:

   > ⚠️ `probe-security` мутирует state на PUT (rename / overwrite полей).
   > Перед прогоном на чужой / shared org обязательно сначала
   > `--dry-run` — проверить, что среди endpoint'ов нет тех, чьё текущее
   > значение нужно сохранить (DSN-keys, team-names, webhook URLs).

   Я как раз нарвался на DSN-rename без cleanup'а. До TASK-151
   восстановление — manual.

2. **Entry points table.** Добавить отдельный путь:

   > `security-only audit → zond probe-security (skip Phase 1–4)`

   Сейчас непонятно, можно ли пропустить smoke / CRUD / probe-validation,
   когда задача узкая («проверь только SSRF/CRLF на этом проде»).

§K-skill + §entry-points → **TASK-155** (MEDIUM, skill update).

## Чистый итог

Фича разошлась с подтверждённым ручным CRLF-finding'ом ровно в одном
месте (§K). Минимальный fallback body даст полное покрытие.

Cleanup-restore (§J) — **единственная вещь**, из-за которой я бы пока
не запускал `probe-security` без присмотра на чужой prod-org.

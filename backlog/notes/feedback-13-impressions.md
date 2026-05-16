# Feedback-13 — общие впечатления (Sentry, after coverage-union/cascade-skip)

Saved 2026-05-08. Сессия после TASK-259/256/255/263/257.

## Что zond делает хорошо (закреплённое)

- Probes за бесплатно — 86 endpoints на 4xx-классе, экономия ~5 часов ручной работы.
- `generate --explain` — нужная таблица **до** прогона, не после.
- `coverage --union session` (TASK-255) — без неё прогресс не виден: одиночный run давал 55%, депрессивно.
- Cascade-skip «Depends on missing capture: X» (TASK-114) — ушёл шум из 50 false-fail.
- `zond db diagnose <id>` показывает фактический response_body — нет нужды переоткрывать в curl.
- Generator с pattern/enum awareness (TASK-252/253) — `slug: $randomSlug`, `schedule_type: crontab` из коробки; CRUD-create начали отдавать 201 без правки бодей.

## Где было проще руками (gaps)

- 60 negative-by-id хитов (`/replays/00000.../`, `/issues/99999/`) → +11% coverage за 5 минут копипасты. Generator такое не знает, потому что это бизнес-логика тестировщика. → **TASK-275** (negative-hits / probe-by-bogus-id).
- Conditional-required по domain knowledge (`POST monitors` → `owner: "type:id"`; `POST notifications/actions` с `service_type=slack` → `integration_id required`). Generator видит enum, но не conditional. Открытый вопрос: где этому жить — в `seed-hints.yaml` per-API или в spec'е через `x-zond-conditional`.
- Bulk fix `extras-coverage.yaml` точечно через Edit/Write был в 5 раз быстрее, чем `--explain` + регенерация всего каталога. (Возможный follow-up: `generate --merge` без перезаписи руками отредактированных секций.)

## Затыки этого раунда → tasks

1. zod-stack на `expect.status` (`oneOf` написан по привычке) — пришлось sed'ить 4 места. → **TASK-249** обновлён, priority bump low → medium, добавлен expect.status spot-message.
2. Coverage — одно слово, две метрики (hit-coverage 91% vs pass-coverage с `uncovered=0` vs одиночный run с 6 uncovered). → **TASK-270**.
3. `bootstrap --apply --seed` непрозрачен: `Filled 4/6` без декомпозиции, no-op неотличим от successful, неясно сколько пасов. → **TASK-271**.
4. `zond request --body` блочится sandbox при shell-substitution для secrets, но не подсказывает «используй `--api <name>` для auto-auth». → **TASK-272**.
5. `discover` на пустом workspace → `miss-no-id` без подсказки «send an event/file/replay first». → **TASK-273**.

## TL;DR по продукту

- Capture-fix + cascade-skip — bigest-win этой итерации. Без них CRUD chains были бы бесполезны.
- Coverage union нужна шире, чем `session` — нужно `since:<dur>` / `tag:` / `runs:A,B`. → **TASK-274**.
- Negative-by-id паттерн нужно вынести в команду — это самый дешёвый way to close coverage gap. → **TASK-275**.
- Validation-сообщения в zod нужно человекочитать (TASK-249 — приоритет поднят).

## Найденные баги Sentry API (target, не zond) — для отдельного отчёта

- PUT `/organizations/{org}/issues/` → 502 на `{"status":"resolved"}`.
- PUT `/projects/{org}/{proj}/issues/` → 502 на том же payload.
- PUT `/teams/{org}/{team}/` → 404, endpoint в spec, но не роутится.
- GET `/sessions/` → 400, обязательные query помечены optional (schema drift).
- POST `/user-feedback/` → 200 вместо 201 (schema drift).
- GET `/scim/v2/Groups/{slug}` → 404 «did you forget a trailing slash?» — spec без слеша, Sentry хочет со слешем.
- 17 endpoints с 5xx из probes — системно ловятся probe-validation.

(Дальше — кандидаты в `apis/sentry/api-bugs-13.md` если будем заводить per-round bug-list.)

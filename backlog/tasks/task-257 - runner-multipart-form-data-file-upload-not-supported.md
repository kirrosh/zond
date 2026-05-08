---
id: TASK-257
title: 'runner: multipart/form-data с file upload не поддерживается, hint указывает только на `form:`'
status: Done
assignee: []
created_date: '2026-05-08 14:30'
updated_date: '2026-05-08 17:00'
labels:
  - feedback-loop
  - api-sentry
  - runner
  - body-format
dependencies:
  - TASK-244
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F3, class missing-feature.

TASK-244 даёт hint, что `raw:` не поддерживается, и предлагает `form:`. Но `form:` — это `application/x-www-form-urlencoded`, а не multipart. Документированного способа отправить `multipart/form-data` с file upload нет — ни в `--help`, ни в hint-сообщении. Из-за этого `POST /api/0/organizations/{org}/releases/{ver}/files/` (Sentry release artifacts) недостижим — единственный реальный endpoint, не покрытый из-за zond-ограничения.

Repro:
```
cat > /tmp/_up.yaml <<'EOF'
name: up
tests:
  - name: upload file
    POST: /api/0/organizations/{{org}}/releases/{{ver}}/files/
    headers: {"Content-Type": "multipart/form-data; boundary=----b"}
    raw: |
      ------b
      Content-Disposition: form-data; name="name"
      ...
    expect: {status: 201}
EOF
zond validate /tmp/_up.yaml
# → "Unknown step key 'raw'. Did you mean 'json (raw bodies are not supported; serialize to JSON or use form)'?"
```

Expected (любой из): 
- блок `multipart: {parts: [{name, value}, {name, file: <path>, content_type}]}`,
- или `file: <path>` synth для одного файла,
- или строка в `--help` / hint, что multipart не поддерживается и какая альтернатива (e.g. external curl).

Actual: hint указывает только на `form:`, что вводит в заблуждение (это не multipart).

Log: /tmp/zond-fb/sentry/rounds/raw-12.log (`zond validate /tmp/_up.yaml`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] Поддержан `multipart:` блок с text-полями и file-полями `{file, filename?, content_type?}` — функционально уже было реализовано (`schema.ts:172`, `executor.ts:329-343`), задача закрывает discoverability-gap.
- [x] `Content-Type` boundary генерируется автоматически (Bun `FormData` + `fetch`) — пользователю не нужно задавать вручную, явно описано в ZOND.md.
- [x] ZOND.md → новая секция "Body formats" с таблицей json/form/multipart + полным примером file upload (Sentry release artifacts).
- [x] Verify на httpbin.org: `POST /post` с text-частью + file-частью → 200, `files.attachment` содержит контент, `form.title` равно отправленному.
- [x] Hint для `raw:` обновлён: теперь явно упоминает `multipart: { field: { file: <path> } } for file upload` вместо ввода в заблуждение `form:`. Покрыт parser-тестами в `tests/parser/schema.test.ts` (3 кейса: raw, body, payload).
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- Обнаружено в ходе работы: multipart полностью реализован (`MultipartFieldSchema` в parser, `formData = new FormData()` в executor с file-loading через `Bun.file().arrayBuffer()` и `new Blob([buf], {type})`). Generator также эмитит `multipart:` для OpenAPI endpoints с `requestBodyContentType === "multipart/form-data"`.
- Корневая причина бага feedback-12#F3: ZOND.md ничего не говорит про multipart, а hint TASK-244 на `raw:` рекомендовал `form:` — что для file upload бесполезно. Пользователь и тестер не нашли feature, потому что её не было видно.
- Изменения: `BODY_KEY_HINTS.raw` обновлён в `src/core/parser/schema.ts:201`, добавлена секция "Body formats" в ZOND.md, добавлены parser-тесты на все три hint-варианта.
<!-- SECTION:NOTES:END -->

---
id: TASK-244
title: 'runner+validate: ключ `body:` молча игнорируется (вместо `json:`) — body теряется без warning'
status: Done
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-08 13:35'
labels:
  - feedback-loop
  - api-sentry
  - validate
  - runner
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-09#F2, re-confirmed feedback-10 (NOT fixed), class ux-papercut + likely_bug.

Repro:
```
cat > /tmp/_probe.yaml <<EOF
name: probe
base_url: "{{base_url}}"
headers: {Authorization: "Bearer {{auth_token}}"}
tests:
  - name: create team
    POST: /api/0/organizations/{{organization_id_or_slug}}/teams/
    body: {slug: zond-test, name: zond-test}     # ← должно быть json:
    expect: {status: [201, 400, 403]}
EOF
zond validate /tmp/_probe.yaml   # passes silently
zond run    /tmp/_probe.yaml --report json --report-out /tmp/x.json
jq '.[].steps[].request' /tmp/x.json
# → request {method, url, headers}: NO body field; server получил пустой POST → 400
```

Expected: либо `validate` ругается «unknown key `body` (did you mean `json`?)», либо runner отправляет body, либо warning на этапе run «request body 'body:' detected — use 'json:' for JSON or 'raw:' for raw». Сейчас тихо роняет данные на пол.

Actual: zond молча игнорирует `body:` ключ, отправляет пустой POST.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `validate` reports unknown step-key `body:` с явной подсказкой (`Did you mean 'json'?`).
- [x] Покрыты также `data`, `payload`, `raw` (близкие по смыслу опечатки).
- [x] runner тоже падает (parser is shared) — body больше не теряется молча.

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `src/core/parser/schema.ts`: в preprocess `TestStepSchema` добавлен detector `BODY_KEY_HINTS` ({body, data, payload, raw} → подсказка `json/form/multipart`). При наличии любого ключа throw с указанием step-name.
- Не делал blanket `.strict()`: source-metadata legitimately passthrough'ит unknown extension keys (`x-*`); поломались бы probe-suite'ы.
- Verify: `zond validate /tmp/_probe-body.yaml` (с `body:`) → `Error: Unknown step key 'body' in step "create team". Did you mean 'json...'?`
<!-- SECTION:NOTES:END -->
<!-- SECTION:ACCEPTANCE:END -->

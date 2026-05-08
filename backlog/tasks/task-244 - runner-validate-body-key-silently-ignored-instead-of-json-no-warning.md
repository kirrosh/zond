---
id: TASK-244
title: 'runner+validate: ключ `body:` молча игнорируется (вместо `json:`) — body теряется без warning'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
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
- [ ] `validate` reports unknown step-key `body:` с suggestion (`did you mean 'json'?`) — strict-mode по умолчанию.
- [ ] Альтернативно: runner emits warning при нераспознанных top-level step-keys.
- [ ] Regression-test: yaml с `body:` → validate fail или run warning.
<!-- SECTION:ACCEPTANCE:END -->

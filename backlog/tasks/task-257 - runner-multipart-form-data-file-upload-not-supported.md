---
id: TASK-257
title: 'runner: multipart/form-data с file upload не поддерживается, hint указывает только на `form:`'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
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
- [ ] Поддержан хотя бы один способ отправить `multipart/form-data` с file и текстовыми частями (рекомендуется `multipart:` блок с `parts: [...]`).
- [ ] `Content-Type` boundary генерируется автоматически — пользователю не нужно его вручную задавать.
- [ ] `--help` / docs описывают синтаксис.
- [ ] Verify: `POST /api/0/organizations/{org}/releases/{ver}/files/` на Sentry → 201 (или подтверждённый skip по плану), без обходных curl.
- [ ] Если решение — не поддерживать, то hint при `raw:` явно говорит «multipart not supported» вместо предложения `form:`.
<!-- SECTION:ACCEPTANCE:END -->

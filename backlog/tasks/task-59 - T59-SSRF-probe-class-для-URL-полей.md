---
id: TASK-59
title: 'T59: SSRF probe class для URL-полей'
status: To Do
assignee: []
created_date: '2026-04-29 08:34'
labels:
  - bug-hunting
  - security
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Round 2 live-сессии: вручную проверены 10 SSRF-пейлоадов на webhooks endpoint, все отбиты 4xx — на Resend класс закрыт. На других API yield может быть высокий. Сейчас probe-validation для URL-полей шлёт $randomUrl — не проверяет SSRF-вектор.

## Что сделать

Расширить `zond probe-validation` новым классом или добавить отдельный `zond probe-ssrf`:

Для каждого поля с `format: uri` / `format: url` или эвристикой по имени (webhook_url, callback_url, endpoint, redirect_uri, image_url):
1. Подставить payload-set:
   - `http://localhost`, `http://127.0.0.1`, `http://0.0.0.0`
   - `http://169.254.169.254/` (AWS metadata)
   - `http://[::1]`, RFC1918: `http://10.0.0.1`, `192.168.0.1`
   - `file:///etc/passwd`, `gopher://`, `dict://`
   - DNS-rebinding: `localtest.me`, `spoofed.burpcollaborator.net`
   - Redirect-chain через bit.ly-style сокращалки (опционально)
2. Ожидаемый ответ: 4xx (reject as invalid URL or private network).
3. Алёрт-условия:
   - 2xx — сервер принял, потенциально пытался стучаться.
   - 5xx — баг (любой 5xx на невалидном вводе).
   - duration_ms аномально высокое — сервер реально пытался установить соединение (требует T66 timing-assertions).
4. CLI: `zond probe-ssrf <spec> --output bugs/ssrf/`

## Acceptance

- Поддержка как минимум 10 payload-классов.
- Опционально интегрируется с T66 для timing-detection.
- Документация + конкретные находки на тестовом vulnerable target.

## Связь

T49 (probe-validation) — родственная команда; T66 (duration_ms assertions) — для timing-channel detection.
<!-- SECTION:DESCRIPTION:END -->

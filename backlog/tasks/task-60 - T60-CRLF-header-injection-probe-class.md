---
id: TASK-60
title: 'T60: CRLF / header-injection probe class'
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

Round 2 live-сессии: 5 пейлоадов с \r\n / \n в from/to/subject/reply_to отбиты 4xx (на Resend класс закрыт; часть отбивается раньше через 403 unverified-from). На других email/SMS API класс часто открыт.

## Что сделать

Расширить `zond probe-validation` или новая команда `zond probe-injection`:

Для каждого строкового поля с эвристикой по имени (email, from, to, cc, bcc, reply_to, subject, header_*, name) или `format: email`:
1. Payload-set:
   - `victim@example.com\r\nBcc: attacker@evil.com`
   - `victim@example.com%0d%0aX-Header: injected`
   - `victim@example.com\nBcc:attacker@evil.com`
   - `subject\r\nSet-Cookie: x=1` (response-splitting)
   - `name\r\n\r\n<html>injected</html>` (для HTML-based)
   - URL-encoded и raw варианты
2. Ожидание: 4xx (валидация отбила).
3. Failure: 2xx — потенциально server-side обработал — нужен дополнительный verify через email-sink (T52).

## Acceptance

- Покрытие email-полей (from/to/cc/bcc/reply_to) и subject/name.
- Различает sync-reject (4xx сразу) vs нужна async-проверка (письмо реально отправлено?).
- Документация.

## Связь

T52 (email sink) — для верификации, было ли письмо реально доставлено с injected заголовком.
<!-- SECTION:DESCRIPTION:END -->

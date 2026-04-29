---
id: TASK-63
title: 'T63: Auth-scope матрица probe'
status: To Do
assignee: []
created_date: '2026-04-29 08:35'
labels:
  - bug-hunting
  - security
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Многие API имеют scoped API keys (Resend: full_access / sending_access; Stripe: read-only / restricted; etc.). Дрейф между документированной матрицей разрешений и реальной — частая security-находка. zond сейчас работает с одним ключом и не проверяет boundaries.

## Что сделать

1. Поддержка нескольких ключей в .env.yaml (схожее со T47):
   ```yaml
   keys:
     full_access: re_xxx
     sending_access: re_yyy
     read_only: re_zzz
   ```
2. В spec — описание ожидаемой матрицы через x-required-scope или эвристика по тегу/path.
3. Probe для каждой пары (scope, endpoint+method):
   - С scope X пытаемся выполнить endpoint требующий scope Y (Y > X).
   - Ожидание: 401/403.
   - Алёрт: 2xx (privilege-escalation) или 5xx (auth-check вылетает в exception).
4. Output — markdown матрица allow/deny actual vs documented.

## Acceptance

- Поддержка 2+ ключей.
- На API с явной scope-документацией строит матрицу.
- 2xx на cross-scope попытке → critical finding.
- Документация.
<!-- SECTION:DESCRIPTION:END -->

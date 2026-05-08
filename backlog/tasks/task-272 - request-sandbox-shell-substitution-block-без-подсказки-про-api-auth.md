---
id: TASK-272
title: 'zond request: sandbox блочит shell-substitution для secrets, но не подсказывает про --api auto-auth'
status: To Do
assignee: []
created_date: '2026-05-08 18:00'
labels:
  - feedback-loop
  - api-sentry
  - cli
  - ux
  - secrets
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13#F4, class ux-papercut.

`zond request --body` блокируется песочницей, если пользователь пытается достать токен из `.secrets.yaml` через shell-substitution (`Authorization: Bearer $(yq ... .secrets.yaml)` и подобные). Это разумный safety-check (не палить секреты в shell history), но в сообщении об ошибке нет подсказки, что **`--api <name>` сам подтянет auth-headers** из `.env.yaml`/`.secrets.yaml` без shell-магии.

Impact: новичок пытается обойти sandbox, теряет 5–15 минут, не понимая, что zond уже умеет авторизовываться сам.

Expected: при блокировке shell-substitution в `--body`/headers — однострочная подсказка:

```
zond request: shell substitution blocked (would leak secrets to history).
Hint: use --api <name> to auto-load Authorization from apis/<name>/.secrets.yaml.
```

Actual: сухой sandbox-error без указателя на правильный путь.

Связано: TASK-89 (exit-code taxonomy для sandbox), TASK-170/175 (.secrets.yaml).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Sandbox-block для `--body`/header value содержит явный hint про `--api <name>` auto-auth.
- [ ] Hint показывается только если в cwd обнаружен `apis/*/` workspace (иначе нерелевантно).
- [ ] `zond request --help` явно отмечает: «`--api <name>` auto-loads `Authorization` and base headers from `apis/<name>/.secrets.yaml`».
- [ ] Regression: попытка `--body '{"token": "$(cat secret)"}'` → блок + hint.
<!-- SECTION:ACCEPTANCE:END -->

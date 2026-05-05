---
id: TASK-154
title: 'probe-security digest: payload в HIGH-строке + run-cmd в конце'
status: To Do
assignee: []
labels:
  - probe
  - probe-security
  - ux
milestone: m-8
dependencies:
  - TASK-138
priority: low
---

## Description

## Контекст

Источник: [m-8 feedback round 3 §M+§N](../notes/m-8-audit-cli-gaps/feedback-round3.md).

Две UX-полировки digest'а после прогона `zond probe-security`.

### §N — payload в HIGH-строке

Сейчас HIGH-finding печатается как
```
- url / ssrf → 500 (high) — 5xx unhandled
```

Не понятно, какой именно payload триггернул (`http://127.0.0.1` vs
`file:///etc/passwd` vs `http://169.254.169.254/...`). Для написания
issue/case-study нужно копать в `--emit-tests` YAML.

**Нужно:** в строке finding'а печатать сокращённый payload:
```
- url / ssrf [http://127.0.0.1:80/] → 500 (high) — 5xx unhandled
```
Длинные payload'ы (`file:///etc/passwd?…`) обрезать до 60 символов с `…`.

### §M — ready-to-run команда в конце digest'а

Когда `--emit-tests <dir>` указан, в конце digest'а должна появиться
одна строка-предложение, готовая для копирования в issue / CI:

```
Run regression suite on CI: zond run apis/<name>/probes/security-emit/ --env apis/<name>/.env.yaml
```

Если `--emit-tests` не указан — строка не печатается.

## Что сделать

1. В `formatSecurityDigest` для каждого finding'а добавить
   `[<short-payload>]` после `<class>`.
2. В CLI-обвязке (`probe-security.ts`) после печати digest'а, если
   `options.emitTests` — печатать строку с готовой командой `zond run`.
3. Учитывать, что `--env` может быть не задан (тогда подставлять
   `--env apis/<api>/.env.yaml` если резолвится apiDir, иначе просто
   `zond run <emit-dir>`).

## Acceptance Criteria

- [ ] HIGH/LOW-строка содержит `[<payload>]` (truncated к 60 символам).
- [ ] При `--emit-tests` после digest'а печатается одна строка с
      готовой командой `zond run`.
- [ ] Тесты на формат (snapshot или substring match).
- [ ] CHANGELOG.

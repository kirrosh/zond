---
id: TASK-145
title: 'zond doctor --missing-only + canonical --json shape'
status: To Do
assignee: []
labels:
  - doctor
  - cli
  - dx
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §I раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

`zond doctor --json`: пользователь несколько раз промахнулся на
`jq '.diagnostics.fixtures'`, потому что в фактической структуре
`.data.fixtures.required` (нет `.diagnostics` на верхнем уровне). В
подсказке/help структура указана иначе.

## Что сделать

1. **Привести JSON к canonical-форме**: либо везде `.diagnostics.<group>`,
   либо везде `.data.<group>` — выбрать одну схему, документировать в
   `--help` `zond doctor`. Текущий путь в `.data.fixtures.required` —
   зафиксировать как канон, исправить рассинхрон с подсказкой.
2. **`--missing-only`** — флаг, выводящий только проблемные пункты
   (то, что doctor пометил как "missing" / "needs attention"). Без
   шума о том, что и так всё ок.
3. **Query helper** (опционально, если просто): `--query <dotpath>` —
   вытащить одно поле без jq (`zond doctor --query fixtures.required`).
4. Обновить markdown-help / `ZOND.md` с canonical путями.

## Acceptance Criteria

- [ ] `zond doctor --json` имеет одну каноническую схему, описанную в
      help.
- [ ] `--missing-only` показывает только missing/issue items в обоих
      форматах (text + json).
- [ ] `--query <dotpath>` (если включено) корректно резолвит вложенные
      поля.
- [ ] Тесты на схему JSON (snapshot) и на --missing-only.
- [ ] CHANGELOG.

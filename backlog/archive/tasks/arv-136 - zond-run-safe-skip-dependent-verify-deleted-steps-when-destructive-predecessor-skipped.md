---
id: ARV-136
title: >-
  zond run --safe: skip dependent verify-deleted steps when destructive
  predecessor skipped
status: To Do
assignee: []
created_date: '2026-05-11 17:54'
labels:
  - feedback-loop
  - api-resend
  - m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11 (fb-01), finding F5, severity MEDIUM, class quirk.

Repro:
  zond run apis/resend/tests --safe --report json --output safe.json
  jq -r '.[] | .suite_name as $s | .steps[]? | select(.status=="fail" and (.name|contains("Verify")))' safe.json
  # webhooks-crud / segments-crud / domains-crud / contacts-crud:
  # шаг «Verify ... deleted» падает с expect:404, реальный статус 200.
  # DELETE skipped (--safe), а GET «уже удалено» отрабатывает как обычная GET
  # → объект на месте → fail. 4 из 7 fail в smoke-прогоне — именно эта природа.

Expected: --safe должен либо
  (a) пропускать всю CRUD-цепочку как единицу (setup→...→cleanup), либо
  (b) помечать verify-шаги, зависящие от destructive предшественника, как `skipped` с reason `depends-on-skipped-destructive`.
Вариант (b) предпочтительнее: позволяет smoke-проверять non-destructive часть цепочки без false-failures.

Actual: false failures засоряют smoke-репорт; пользователь читает failed-list и тратит время на отсутствующий баг.

Log: ~/Projects/zond-test/.fb-loop/rounds/run-safe.json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 generator помечает verify-шаги, зависящие от DELETE/PUT/PATCH/POST, явным «depends_on: <prev_step_id>» либо тегом destructive_followup
- [ ] #2 runner при --safe для skipped destructive step каскадно skip-ит все шаги с depends_on на него (status=skipped, reason=depends-on-skipped-destructive)
- [ ] #3 regression: resend --safe smoke перестаёт показывать «Verify ... deleted» в fail-list (ожидание: 0 fail этого класса)
- [ ] #4 не-зависимые verify-шаги (например read-back после POST, который --safe тоже скипнул) тоже корректно скипаются
<!-- AC:END -->

---
id: TASK-152
title: 'probe-security: minimal-body fallback для partial PUT (false-negative fix)'
status: To Do
assignee: []
labels:
  - probe
  - probe-security
  - recall
milestone: m-8
dependencies:
  - TASK-138
priority: high
---

## Description

## Контекст

Источник: [m-8 feedback round 3 §K](../notes/m-8-audit-cli-gaps/feedback-round3.md).

`PUT /projects/{org}/{proj}/` — на нём в раунде 2 ручной CRLF на
`subjectPrefix` дал **proven HIGH** (stored CRLF injection). После
реализации TASK-138 та же ручка попала в `INCONCLUSIVE-BASELINE`:
автогенератор собрал «полный» body из всех полей схемы, Sentry отклонил
(он принимает только partial PUT), и атаки не запустились.

Результат: фича пропускает уже подтверждённый HIGH-finding. Нужен
fallback на минимальный body.

## Что сделать

Когда baseline на «полном» body отвечает 4xx, а method ∈ {PUT, PATCH}:

1. **Попробовать partial-body.** Перебрать атакуемые поля — для каждого
   запустить baseline с body, содержащим **только** это поле (и
   обязательные path-params уже есть в URL).
   - Если partial-baseline 2xx → атаковать только это поле.
   - Если partial-baseline 4xx → пометить как `INCONCLUSIVE-BASELINE`
     (как сейчас), но в reason указать «full-body & partial-body both
     rejected» — пользователь видит, что fallback пробовался.

2. **Не делать fallback для POST.** POST требует все required-поля по
   спеке; partial-body на нём бессмыслен.

3. **Поддержать `--prefer-partial-put`** (или сделать поведением по
   умолчанию, если method PUT/PATCH): сразу пробовать partial-body
   первым шагом, без полного. Sentry / Stripe-style API стандартно
   используют partial PUT — это часто правильнее.

4. **Логирование:** в digest отметить, какой режим сработал
   (`baseline=full-200` vs `baseline=partial-200(field=subjectPrefix)`).

## Acceptance Criteria

- [ ] При baseline-полным-body 4xx на PUT/PATCH пробуется partial-body
      по каждому атакуемому полю.
- [ ] Если хотя бы одно partial-baseline дало 2xx — endpoint не идёт
      в INCONCLUSIVE-BASELINE, атакуется именно это поле.
- [ ] POST не использует fallback (partial body нарушит required).
- [ ] Тест: фикстура где `PUT /things/{id}` с full body отдаёт 422,
      с partial body (только `subject`) отдаёт 200 → атака на `subject`
      запускается, прошлый INCONCLUSIVE-baseline исчезает.
- [ ] Тест на фикстуре где partial тоже падает → INCONCLUSIVE-BASELINE
      с reason "full & partial both rejected".
- [ ] CHANGELOG.

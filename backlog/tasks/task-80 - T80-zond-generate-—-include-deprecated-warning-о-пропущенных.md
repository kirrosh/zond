---
id: TASK-80
title: 'T80: zond generate — --include-deprecated + warning о пропущенных'
status: To Do
assignee: []
created_date: '2026-04-29 08:40'
updated_date: '2026-05-07 14:21'
labels:
  - generator
  - ux
milestone: m-1
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Coverage показал 4 непокрытых эндпоинта /audiences — все deprecated. zond сам решил их не генерировать. Поведение разумное по умолчанию, но **молчит** — пользователь не отличает 'deprecated by design' от 'случайно выпали'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 По умолчанию deprecated: true пропускаются (как сейчас)
- [ ] #2 В конце генерации warning: 'Skipped 4 deprecated endpoints: /audiences/{id}, ... — pass --include-deprecated to include'
- [ ] #3 Флаг --include-deprecated включает их
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
feedback round 02 F10: deprecated endpoints silently skipped, no warning in zond generate stdout (visible only via zond coverage). Resend: /audiences/* deprecated -> 4 uncovered.
<!-- SECTION:NOTES:END -->

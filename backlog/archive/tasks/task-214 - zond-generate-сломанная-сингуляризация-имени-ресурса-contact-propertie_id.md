---
id: TASK-214
title: 'zond generate: сломанная сингуляризация имени ресурса (contact-propertie_id)'
status: Done
assignee: []
created_date: '2026-05-07 14:21'
updated_date: '2026-05-07 14:23'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F6, class definitely_bug
Repro: zond generate apis/resend/spec.json --output apis/resend/tests
  -> tests/crud-contact-properties.yaml содержит:
     capture: contact-propertie_id
     GET: /contact-properties/{{contact-propertie_id}}
     test names: 'Read created contact-propertie', 'Verify contact-propertie deleted'
Expected: contact_property_id (правильная сингуляризация + underscore) или contact_properties_id
Actual: алгоритм снимает суффикс ies -> ie, оставляет дефис из пути -> contact-propertie. Дефис в имени переменной может ломать парсинг шаблона; имя семантически сломано
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

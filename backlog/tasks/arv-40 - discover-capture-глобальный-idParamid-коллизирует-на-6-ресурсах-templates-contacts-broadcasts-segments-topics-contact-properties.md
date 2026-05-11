---
id: ARV-40
title: >-
  discover/capture: глобальный idParam=id коллизирует на 6 ресурсах
  (templates/contacts/broadcasts/segments/topics/contact-properties)
status: Done
assignee: []
created_date: '2026-05-10 11:30'
updated_date: '2026-05-11 18:03'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11 (fb-01), finding F1, severity HIGH, class definitely_bug.

Repro:
  grep -E "^  - resource:|^    idParam:" apis/resend/.api-resources.yaml
  # 6 ресурсов c idParam: id (templates, contacts, broadcasts, segments, topics, contact-properties)
  # vs emails/domains/api-keys/webhooks/automations — у тех per-resource id_param.

Manifest (.api-fixtures.yaml) собирает один глобальный var {{id}}; .env.yaml хранит одно значение. `zond generate` подставляет {{id}} во все CRUD-сьюты этих 6 ресурсов → 5 из 6 получают чужой uuid → 404 или (хуже) фальш-pass: GET читает не тот объект и возвращает 200 на uuid из соседнего ресурса.

Expected: per-resource fixture var (template_id, contact_id, broadcast_id, segment_id, topic_id, contact_property_id) — паттерн уже применён к emails/domains/api-keys/webhooks. Либо context-aware {{id}} per-suite через .api-resources.yaml.

Actual: один глобальный id; ручной workaround (Edit .env.yaml перед каждой сьютой) непрактичен.

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log; apis/resend/.env.yaml:6; apis/resend/.api-resources.yaml.

Related: ARV-69 (harvest per-resource done), ARV-122 (layered spec model).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 .api-fixtures.yaml manifest пишет per-resource var вместо одного глобального id
- [x] #2 generate подставляет соответствующий per-resource var в CRUD-сьюты, generated тесты не делят один uuid между 6 ресурсами
- [x] #3 regression: existing per-resource entries (email_id, domain_id) не переименовываются и не дублируются
- [x] #4 resource-builder при collision на path-param id синтезирует уникальное имя вида <resource>_id (snake-case, suffix _id)
<!-- AC:END -->

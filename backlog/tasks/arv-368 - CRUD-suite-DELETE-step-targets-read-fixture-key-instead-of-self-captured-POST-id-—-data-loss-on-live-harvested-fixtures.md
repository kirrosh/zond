---
id: ARV-368
title: >-
  CRUD-suite DELETE step targets read-fixture {{key}} instead of self-captured
  POST id — data-loss on live-harvested fixtures
status: Done
assignee: []
created_date: '2026-07-08 09:43'
updated_date: '2026-07-08 10:03'
labels:
  - m-25
  - bug
  - zond-core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено при docgen-скане (warm-up + cleanup). zond generate эмитит CRUD-чейн (напр. crud-attributes.yaml): POST создаёт ресурс со случайным ключом, но GET/PUT/DELETE-шаги адресуют {{key}}-фикстуру. Когда {{key}} — реальный harvested-ключ из живого API (напр. key=GenerateToPdf, взятый из шаблона для покрытия read-эндпоинтов), DELETE-шаг удаляет ПРЕД-СУЩЕСТВУЮЩИЙ ресурс, а не тот, что POST-нул сам чейн.

Воспроизведено: 2-й прогон docgen с code=ds_tranch_s_dop, key=GenerateToPdf → suite удалил реальный атрибут GenerateToPdf=true, оставив свой orphan ceo1ZMbx. Данные пришлось восстанавливать вручную POST'ом.

Impact: прямой data-loss на любом API, где read-фикстура указывает на реальный ключ/id. Особо опасно в связке с warm-up-target (ARV-366): harvested живой id → destructive DELETE живого ресурса. Прямо противоречит 'zond безопасен на sandbox'.

Fix: DELETE-шаг CRUD-чейна должен адресовать id/ключ, captured из собственного POST-response этого же чейна (self-captured), не переиспользовать read-фикстуру. Либо не эмитить DELETE-шаг вовсе, если create-id не был captured. Детерминированно, ложится в генератор (core/generator/suite-generator.ts).

Контекст: ~/Projects/zond-scans/reports/docgen/20260708-120124/report-zond.md (MF3). Смежное: MF4 (defaultHeaders в .env.yaml для currentrole) — можно добить в ARV-367 или отдельно.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CRUD-чейн DELETE-шаг адресует id/ключ, captured из POST-response того же чейна — не read-фикстуру {{key}}/{{id}}
- [ ] #2 если create-id не captured (POST не вернул id) — DELETE-шаг не эмитится (нет слепого удаления по фикстуре)
- [ ] #3 регресс-тест: сгенерить CRUD-suite с read-фикстурой, совпадающей с реальным ключом → прогон НЕ удаляет пред-существующий ресурс
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in src/core/generator/suite-generator.ts: added createCapturesId(create, captureField) — gates PUT/DELETE chain steps on the create's success-response schema actually declaring the capture field. When create yields no id (204 / no-schema, as docgen's attribute POST), the runtime capture is empty and {{captureVar}} (== idParam, shared with the read-fixture per ARV-137) would fall back to a live harvested value → PUT/DELETE hits pre-existing data. Now those steps are skipped; POST+GET (non-destructive) retained. Regression test added (tests/generator/suite-generator.test.ts 'ARV-368: no PUT/DELETE when create yields no id'). Verified on live docgen: crud-attributes suite no longer emits DELETE. Full suite green (2421). Namespace-decoupling of captureVar rejected — collides with ARV-137 manifest contract.
<!-- SECTION:NOTES:END -->

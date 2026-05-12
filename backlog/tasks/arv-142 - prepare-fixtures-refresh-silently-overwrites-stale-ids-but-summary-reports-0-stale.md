---
id: ARV-142
title: >-
  prepare-fixtures --refresh: silently overwrites stale ids but summary reports
  '0 stale'
status: Done
assignee: []
created_date: '2026-05-12 07:40'
updated_date: '2026-05-12 08:03'
labels:
  - bug
  - prepare-fixtures
  - telemetry
  - trust
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-02: между round-01 и round-02 probe security удалил team_id_or_slug=aqoereaf через свой собственный cleanup. zond prepare-fixtures --api sentry --refresh в round-02 написал на disk новое значение (bgu41ku2), но summary показал '4 live, 0 stale, 0 unknown'. Старый id больше не GET'ит 200 → должен был классифицироваться как stale (а перезапись считаться fix).

Сейчас summary врёт: невозможно по telemetry отличить 'refresh ничего не починил' от 'refresh починил один stale'. Для CI dashboard и trust в команде — критично. Source: feedback-02 F11.

Гипотеза: refresh-pass делает verify-live, ловит non-200 на старом значении, перезаписывает на свежий, но не инкрементирует stale counter в summary (видимо classify происходит ПОСЛЕ перезаписи, на новом значении, которое уже live).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 verify-live классифицирует ДО перезаписи (на текущем on-disk значении)
- [ ] #2 summary разделяет 'stale-fixed' и 'still-stale' counters
- [ ] #3 JSON envelope summary.stale_fixed >= 1 после описанного сценария
<!-- AC:END -->

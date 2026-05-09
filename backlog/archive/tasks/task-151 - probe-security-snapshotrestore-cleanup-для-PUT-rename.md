---
id: TASK-151
title: 'probe-security: snapshot+restore cleanup для PUT-rename'
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-05 13:30'
labels:
  - probe
  - probe-security
  - safety
milestone: m-8
dependencies:
  - TASK-138
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback round 3 §J](../notes/m-8-audit-cli-gaps/feedback-round3.md).

После TASK-138 probe-security делает `cleanup = DELETE-if-2xx`. Это
работает на POST (создал → удалил), но **ломает живые данные на PUT**:
в раунде 3 probe переименовал DSN-ключ в `"zond-safe%0d%0a…"` и не вернул
обратно. Пользователь вынужден руками восстанавливать каждый
переписанный ресурс.

Это **блокер** для unattended-прогона на чужой / shared prod-org. До
фикса в скилле должен висеть warning (TASK-155), но единственное
правильное решение — snapshot+restore.

## Что сделать

1. **Snapshot перед атакой.** Если method ∈ {PUT, PATCH} и есть
   GET-counterpart на том же path (`findGetByIdCounterpart`-логика):
   - Сделать GET до baseline → cache `originalBody`.
   - Если GET 4xx — суть PUT'а — создание (upsert), не rename. В этом
     случае поведение остаётся как сейчас (DELETE cleanup, если есть
     DELETE-counterpart).

2. **Restore после атаки.** После каждого 2xx-attack-response (и
   после baseline тоже, если он не идемпотентен) — выполнить PUT с
   `originalBody`, чтобы вернуть ресурс в исходное состояние.

3. **Edge cases:**
   - Если original GET вернул `etag` / `version` — пробросить в restore
     PUT (учесть `requiresEtag` флаг с EndpointInfo).
   - Если restore PUT сам падает — пометить verdict.cleanup
     `error: "restore failed: <status>"` и в digest вывести красным.
   - Если `--no-cleanup` — пропустить и snapshot, и restore (текущее
     поведение).

4. **Cleanup-step в emit-tests.** В сгенерированном YAML добавить
   `setup` шаг (capture original) и `always: true` шаг restore, чтобы
   regression-сьют тоже не оставлял повреждённых данных.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Для PUT/PATCH endpoints с GET-counterpart probe-security делает
      GET до baseline и сохраняет `originalBody`.
- [ ] #2 После 2xx attack-response делается restore PUT с `originalBody`.
- [ ] #3 При `requiresEtag` правильно пробрасывается `If-Match`.
- [ ] #4 Restore-failure отдельно логируется в `verdict.cleanup.error`.
- [ ] #5 Тест: фикстура с PUT /things/{id} и GET /things/{id}, проверить,
      что после probe текущее значение возвращено к исходному
      (mock-сервер записывает state).
- [ ] #6 `--emit-tests` выгружает setup+always:true restore.
- [ ] #7 `--no-cleanup` отключает обе ветки.
- [ ] #8 CHANGELOG, обновление skill/Phase 5.2 (убрать warning после
      реализации).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
snapshotOriginal делает GET до baseline, кэширует body+ETag, restoreOriginal делает PUT/PATCH с original'ом после каждого 2xx (баseline и атак). Стрипает read-only поля (id, created_at, updated_at) из restore body, проставляет If-Match при requiresEtag. Restore-failure → verdict.cleanup.error. POST остаётся на DELETE-cleanup (нет GET-counterpart на collection). 4 теста: state-roundtrip / POST DELETE-fallback / --no-cleanup / restore failure.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-151: snapshot+restore cleanup для PUT/PATCH. Закрывает блокер для unattended prod-use.
<!-- SECTION:FINAL_SUMMARY:END -->

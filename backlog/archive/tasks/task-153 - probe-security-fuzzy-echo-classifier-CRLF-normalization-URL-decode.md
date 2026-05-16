---
id: TASK-153
title: 'probe-security: fuzzy-echo classifier (CRLF normalization, URL-decode)'
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-08 15:37'
labels:
  - probe
  - probe-security
  - classifier
milestone: m-8
dependencies:
  - TASK-138
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback round 3 §L](../notes/m-8-audit-cli-gaps/feedback-round3.md).

Текущий classifier использует verbatim substring match
(`JSON.stringify(body).includes(payload)`). Это пропускает реальные
инъекции, когда бэкенд:

- Стрипит `\r`, но оставляет `\n` (или наоборот).
- URL-декодирует `%0d%0a` → `\r\n` перед сохранением (распространено в
  query/header chains).
- Возвращает только хвост поля (без префикса до `\r\n`), потому что
  парсер «обрезал» на newline.

Все три случая — реальные стoring-CRLF баги, но текущая реализация
помечает их LOW («2xx accepted but no echo»), что в digest даёт ложное
ощущение «безопасно».

## Что сделать

Расширить `bodyContains` (или вынести в `classifyEcho`):

1. **URL-decode payload и body.** Сравнивать обе пары: raw vs raw,
   decoded vs raw, raw vs decoded. Если хотя бы одна пара даёт substring —
   echo считается обнаруженным.

2. **CR/LF normalization variants.** Для CRLF-классов — генерить
   варианты payload'а: `\r\n`, `\n`, `\r`, `%0d%0a`, `%0a`, `%0d`. Если
   хотя бы один найден в response — это HIGH.

3. **Tail-substring match.** Брать хвост payload'а после `\r\n` /`%0d%0a`
   (для CRLF) и проверять, появился ли он в response отдельно. Это
   ловит «парсер обрезал на newline, в БД попал хвост».

4. **Не ломать SSRF / open-redirect classifier.** Для них verbatim
   match достаточен (URL обычно сохраняется как есть). Решение —
   ветвление по классу.

5. **Логирование:** в `finding.reason` указать, какая ветка матча
   сработала: `"payload echoed verbatim"` vs
   `"payload echoed after CRLF strip (\\r removed)"` — это даёт
   аналитику для investigation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Для CRLF-finding с payload `"x\r\nY"` и response, где сохранилось
      только `"\nY"` — severity = HIGH (не LOW).
- [ ] #2 URL-decoded match: payload `"x%0d%0aY"` echo'нутый как `"x\r\nY"` —
      HIGH.
- [ ] #3 Tail-only match: payload `"x\r\nY"`, в response только `"Y"` без
      префикса — HIGH.
- [ ] #4 Verbatim match по-прежнему работает (regression-тест).
- [ ] #5 SSRF / open-redirect classifier не меняется (verbatim only).
- [ ] #6 `finding.reason` содержит ярлык типа матча.
- [ ] #7 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fuzzy-echo classifier: CRLF получает URL-decode, CR/LF normalization variants, tail-after-CRLF; SSRF/open-redirect остались verbatim. finding.reason содержит match-kind. body walked tree-style.
<!-- SECTION:NOTES:END -->

---
id: ARV-253
title: >-
  pivot: CRLF / storage-injection probe → evidence-chain (reflection check,
  silent without reflection)
status: To Do
assignee: []
created_date: '2026-05-15 07:04'
labels:
  - m-21
  - pivot
  - probe
  - crlf
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас "сервер хранит \\r\\n в строке" бьёт HIGH. Это не security per se — это hygiene-сигнал. HIGH должен быть ТОЛЬКО если зонд сам нашёл reflection в опасном контексте.

## Цель

Второй пилот evidence-chain принципа (после mass-assignment). После двух проб переписанных таким образом — обобщить паттерн в helper для остальных классов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После storage-проба (POST с CRLF/спецсимволами в строковом поле) — follow-up GET и анализ response: попадает ли сохранённое значение в response header (Location, Link, custom), text/plain рендер, RSS/Atom, HTML.
- [ ] #2 Reflection в опасном контексте (header / unescaped HTML) → HIGH с evidence-chain в отчёте.
- [ ] #3 Reflection в JSON body без escape-проблем → LOW (storage без exploit pathway).
- [ ] #4 Нет reflection → INFO 'санитизация не сделана, проверь рендеры вручную'; за default не выпускается в основной отчёт (только --verbose / hygiene category).
- [ ] #5 Regression-fixture: mock с reflected header даёт HIGH; mock с stored-but-not-reflected даёт INFO.
<!-- AC:END -->

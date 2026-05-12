---
id: m-8
title: "audit-cli-gaps"
---

## Description

Закрытие CLI-пробелов, выявленных в двух реальных dogfooding-аудитах
(JSONPlaceholder — раунд 1, Sentry Public API — раунд 2, ~30 минут аудита →
7 находок, 3 × P0/HIGH). Источник правды:
[notes/m-8-audit-cli-gaps/feedback-original.md](../notes/m-8-audit-cli-gaps/feedback-original.md).

Главный вывод аудита: скилл `zond` — лучший из «инструкций для ассистента»,
но его узкое место не в описании, а в **отсутствии CLI-команд под уже
описанные паттерны**. Слишком много ручного бойлерплейта, который должен
жить в подкомандах: `zond discover`, `zond probe-security`,
`probe-mass-assignment --discover-fk`, `--use-real-parents` и т.п.

### Цели майлстоуна

1. **Probe-recall на реальных данных.** `probe-validation` и
   `probe-mass-assignment` должны находить 5xx, которые видит smoke с
   настоящим org-slug — а не выдавать 404 на `nonexistent-zzzzz` parent'ах
   или 51 INCONCLUSIVE из-за фикстур.
2. **Discovery-фаза в CLI, не вручную.** Заполнение `.env.yaml` реальными
   id из list-endpoints — `zond discover --api <name>` вместо ручных
   `zond request GET /organizations/`.
3. **Security-probes как подкоманда.** SSRF / CRLF / open-redirect — из
   markdown-шаблонов скилла в `zond probe-security <classes>` с
   автоопределением полей и baseline-OK проверкой.
4. **CRUD-чейны без слепых зон.** `zond generate` находит десятки реальных
   ресурсов, а не только классическую REST-форму. `--explain` показывает,
   что было отвергнуто и почему.
5. **Триаж-эргономика.** `--status 5xx`, `--body-cap`, `--retry-on-network`,
   `--validate-against`, `report bundle <range>` — мелочи, но каждая
   сокращает аудит на минуты.
6. **Skill catch-up.** Iron rule про env_issue early-stop, явное упоминание
   `zond db compare` в Phase 4, baseline-OK pattern для security-probes.

### Не покрывает

- Новые UI-фичи в `zond serve`.
- Изменения в формате артефактов (`.api-catalog/resources/fixtures.yaml`).
- Расширение probe-классов помимо security (mass-assignment + validation +
  методы — уже есть, дотачиваем; новые классы — отдельный m-5).

### Точка входа для агента

При старте задач из этого майлстоуна — сначала прочитать
[feedback-original.md](../notes/m-8-audit-cli-gaps/feedback-original.md),
секции «Затыки и проблемы» (раунд 1) и «Чего реально не хватило» (раунд 2):
там полные репро-кейсы с конкретными endpoint'ами.

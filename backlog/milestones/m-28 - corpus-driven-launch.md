---
id: m-28
title: "corpus-driven-launch"
---

## Цель

Первые **внешние** пользователи zond. Двигатель — серия публичных аудитов
(corpus runs): каждый прогон на известном публичном API даёт одновременно
(а) **case study** с реальными находками — топливо для launch-контента, и
(б) **feedback-задачи** для движка — engine чинится по вскрытому, не по
спекуляции. Финал — Show HN с материалом, а не с «поставьте мой сканер».

Выбрано на развилке post-m-27 (см. close-out m-27): чистый launch без свежих
кейсов пуст, чистый engine — полировка в вакууме. Гибрид повторяет самый
продуктивный паттерн проекта (feedback-12/13/14 дали основную массу ценных
задач) и добавляет ему дистрибуционный выхлоп.

decision-8 (positioning: hygiene scanner, no evidence → no high severity),
decision-10 (no MCP) и литмус-тест — в силе.

## Что уже стоит (база на 2026-07-10)

- Все каналы дистрибуции живые (m-27): npm v0.27.1, plugin marketplace,
  Context7/DeepWiki, llms.txt; recall скиллов 100% (eval/skill-recall).
- Конвенция прогона готова: /zond-scan → report-api.md + report-zond.md +
  backlog-задачи по findings (литмус). Nightly fb-loop на Sentry как образец.
- Сравнительная база с Schemathesis: m-18 parity-baseline.
- Формы в claude-plugins-community / awesome-claude-code на ревью.

## Bucket A — Corpus runs (двигатель вехи)

- **Shortlist целей**: 3–5 публичных API. Критерии: публичный OpenAPI-спек,
  sandbox/free-tier (live-mode без риска: только свои ресурсы,
  no-delete-foreign), узнаваемость имени (кейс должен продавать), разнообразие
  форм (auth-модель, pagination, вложенность CRUD). Sentry/Resend уже
  исследованы — брать преимущественно новые цели.
- **Прогон #1** — полный цикл /zond-scan на первой цели; калибровка формата
  кейса; report-zond findings → задачи.
- **Прогоны #2–3(+)** — серия после калибровки; каждый прогон = день, не неделя.

## Bucket B — Case studies + контент (из прогонов, не из головы)

- **Формат + первые 2 кейса**: публикуемый case study из report-api
  («N находок в API X за 20 минут агентом»), Dev.to/blog + ссылка из README.
  Canonical tagline дословно (ARV-398 поглощается сюда на период вехи).
- **Сравнение с инкумбентом**: zond vs Schemathesis на одном и том же
  corpus-API, честный gap-лист в обе стороны (база — m-18).

## Bucket C — Engine по вскрытому

- ARV-370 (error_response_disclosure), ARV-371 (optional-but-required),
  ARV-373/374 (fixture naming) — промотируются в работу, **когда прогон
  их подтверждает** (evidence-first, тот же принцип, что ARV-376).
- Новые задачи из report-zond.md каждого прогона — по литмусу: детерминированное
  → в zond, суждение → агенту.

## Bucket D — Launch

- **Show HN**: пост с реальными кейсами, демо (svg/asciinema есть), FAQ
  (safe-by-default, чем не Schemathesis/Postman), тайминг — после ≥2 кейсов.
  Параллельно r/ClaudeAI (+ r/programming по ситуации).
- **Метрики**: baseline (stars/npm downloads/installs) до launch → снятие
  после; связка с ARV-399 (recall-probe по триггеру).

## Definition of done

- A: ≥3 публичных аудита; на каждый — report-api + report-zond + задачи.
- B: ≥2 опубликованных case study + 1 сравнение с инкумбентом.
- C: подтверждённые прогонами engine-задачи закрыты или запланированы
  с evidence; спекулятивные — не промотированы.
- D: Show HN опубликован; метрики сняты до/после; первый внешний сигнал
  (звезда/установка/issue от чужого человека) зафиксирован.

## Контекст

Открыта 2026-07-10 после закрытия m-27. Задачи помечаются ярлыком `m-28`.
LOW-хвосты m-27 (ARV-398/399/401/402/387) остаются в своих триггерах;
ARV-398 фактически исполняется через Bucket B этой вехи.

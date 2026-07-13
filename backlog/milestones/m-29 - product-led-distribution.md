---
id: m-29
title: "product-led-distribution"
---

## Цель

Рост через **встроенную ценность и охват каналов**, а не через разовое
PR-событие. Прямой вывод из разбора rtk (backlog/docs/rtk-growth-teardown.md):
rtk набрал ~70k★ за 6 мес. product-led — HN им не дал ничего; работали
осязаемый value-hook (`gain`), нулевое трение установки, native-интеграция в
агентов и попадание в дефолтные каналы. m-29 применяет эти рычаги к zond.

decision-8 (hygiene scanner, no evidence → no high), decision-10 (no MCP),
литмус-тест — в силе.

## Что уже стоит

- m-28 закрыта: 4 аудита, 3 кейса + сравнение, ~25 engine-задач, v0.28.0.
- Каналы живые (m-27): npm, plugin marketplace, Context7 (ARV-401 in progress),
  llms.txt; recall скиллов 100% на Claude Code (eval/skill-recall).
- ARV-437 заведён: scorecard value-hook.

## Bucket A — Value hook (осязаемая ценность прогона)

- **ARV-437 — scorecard**: одна строка-результат прогона
  (`N drift-находок · X% honest-2xx · M/T ops за t`). Аналог `rtk gain`.
  Детерминированный агрегат готовых артефактов → литмус-clean. Готов к работе.

## Bucket B — Охват агентов (breadth за пределы Claude Code)

- **Multi-agent recall**: скиллы zond уже есть под Claude Code; расширить
  дистрибуцию/recall на Cursor, kilocode, antigravity (rtk поддерживает 9+).
  Мерить recall тем же харнессом (eval/skill-recall), что и по Claude Code.

## Bucket C — Каналы установки

- **homebrew-core** (апгрейд ARV-387): не свой tap, а официальная формула —
  именно core дал rtk органический ~18k/мес tail. **Gated**: homebrew/core
  требует notability (звёзды/форки), которой у zond пока нет. Триггер —
  первая база пользователей после launch. До триггера ARV-387 (tap) остаётся
  как есть.
- Держать `curl | sh` и npm тривиальными — не растить onboarding-трение.

## Bucket D — Discovery-хвост (подтягивается)

- ARV-401 (Context7), ARV-402 (DeepWiki/Ref.tools/Chroma), ARV-399
  (recall-probe мониторинг) — LOW, по своим триггерам.

## Definition of done

- A: scorecard-хук в релизе; выводится одной строкой на прогоне и в кейсах.
- B: скиллы zond ставятся и recall'ятся ≥1 не-Claude-Code агентом; замер есть.
- C: путь в homebrew-core задокументирован; подан, когда notability пройдена
  (иначе честно отмечен как ждущий триггера).
- D: discovery-хвост закрыт или явно оставлен в триггерах.

## Контекст

Открыта 2026-07-13 после функционального закрытия m-28 (launch ARV-408 —
ручной шаг пользователя). Направление выбрано пользователем на развилке
post-m-28. Задачи помечаются ярлыком `m-29`.

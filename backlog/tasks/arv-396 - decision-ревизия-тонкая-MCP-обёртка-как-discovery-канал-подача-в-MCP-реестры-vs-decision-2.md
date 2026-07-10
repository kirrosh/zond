---
id: ARV-396
title: >-
  decision-ревизия: тонкая MCP-обёртка как discovery-канал + подача в
  MCP-реестры (vs decision-2)
status: Done
assignee: []
created_date: '2026-07-09 14:18'
updated_date: '2026-07-10 07:14'
labels:
  - m-27
dependencies:
  - ARV-393
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
КОНФЛИКТ С decision-2 (2026-04-28): MCP-сервер выпилен как integration surface. Research-пак предлагает вернуть его НЕ как интеграцию, а как канал дистрибуции: реестры (mcp.so 20k+ серверов, smithery.ai, glama.ai/mcp, registry.modelcontextprotocol.io) — самый прямой программный канал обнаружения агентами; новая спека MCP закрепляет registry-based discovery.

Сначала решение: перевешивает ли discovery-ценность ту стоимость (SDK-зависимость, drift, два surface), из-за которой MCP выпилили. Возможный компромисс: обёртка-луковица в отдельном репо/пакете, не в ядре zond — ядро остаётся CLI+skills. Если нет — зафиксировать отказ и закрыть.

Если да: минимальная обёртка + один metadata-pack (ARV-393) на все четыре реестра.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый decision-док: подтверждение decision-2 либо его ревизия с явными границами (discovery-only, вне ядра)
- [ ] #2 Если ревизия: обёртка подана в mcp.so, smithery.ai, glama.ai и официальный MCP Registry с единым metadata-pack
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Решение: decision-10 (2026-07-10) — подтверждение decision-2, MCP-обёртку не делаем. Основание: recall скиллов 100% (ARV-397), Context7 уже отдаёт доки zond, self-serve marketplace живой — MCP не добавляет непокрытого канала. AC#2 (подача в реестры) не применим по решению.
<!-- SECTION:NOTES:END -->

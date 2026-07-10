---
id: decision-10
title: 'Подтверждение decision-2: MCP-обёртку не возвращаем даже как discovery-канал'
date: '2026-07-10 07:13'
status: accepted
---
## Context

Research-пак по agentic distribution (m-27 Bucket E) предлагал вернуть тонкую
MCP-обёртку НЕ как integration surface (это закрыл decision-2), а чисто как
канал дистрибуции: MCP-реестры (mcp.so, smithery, glama, официальный registry)
— программный канал обнаружения инструментов агентами. ARV-396 требовала
решить: перевешивает ли discovery-ценность стоимость, из-за которой MCP
выпилили (SDK-зависимость, второй surface, drift).

К моменту решения Bucket E дал измеримые данные:

- **Agent recall скиллов = 100%** (eval ARV-397, 12 задачных фраз против
  5 дистракторов, false-activation 0%) — скилл-канал уже находит zond по
  любой целевой формулировке.
- **Context7 индексирует zond** (118 snippets) — агент получает доки zond
  on-demand без всякого MCP со стороны zond; librarian-MCP уже существуют
  и работают НА zond, не требуя кода В zond.
- **Self-serve plugin marketplace живой** (`/plugin marketplace add
  kirrosh/zond`), SkillsMP/skills.sh индексируют SKILL.md автоматически;
  SKILL.md-формат кросс-харнессный (Codex CLI читает его нативно).
- npm search post-2024 — чистый text-match: закрыт метаданными (ARV-393/400).

MCP-обёртка не добавляет ни одного канала, который чем-то не покрыт: агент,
которому нужен zond, находит его через скиллы (100% recall), реестры скиллов,
Context7/DeepWiki или npm/GitHub-поиск.

## Decision

decision-2 остаётся в силе без исключений: никакой MCP-обёртки, ни в ядре,
ни в отдельном пакете. Поверхности zond — CLI + agent skills, точка.
Дистрибуция — по каналам Bucket E (skill-маркетплейсы, авто-индексаторы,
librarian-индексы, npm/GitHub метаданные).

## Consequences

- ARV-396 закрыта без кода.
- MCP-реестры исключены из distribution-roadmap; поддерживать метаданные
  нужно только в одном формате (SKILL.md + package.json + llms.txt +
  context7.json).
- Триггер пересмотра: если крупный харнесс сделает MCP *единственной*
  поверхностью discovery (скиллы/плагины перестанут быть каналом) — завести
  новую decision-задачу с этим evidence, не реанимировать эту.

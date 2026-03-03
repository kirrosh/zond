# Документация APITOOL

| Документ | Описание |
|----------|----------|
| [APITOOL.md](../APITOOL.md) | Полный справочник — MCP tools, CLI команды, YAML формат, окружения |
| [mcp-guide.md](mcp-guide.md) | Руководство для MCP-агента — флоу, примеры, советы, troubleshooting |
| [BACKLOG.md](../BACKLOG.md) | Актуальный бэклог задач |
| [GLOSSARY.md](GLOSSARY.md) | Тезаурус сущностей — Collection, Suite, Run, Environment и др. |
| [agent.md](agent.md) | Agent Module — AI Chat Assistant (AI SDK v6, tools, провайдеры) |
| [ci.md](ci.md) | CI/CD интеграция — GitHub Actions, GitLab CI, Jenkins, триггеры, секреты |

## Где обновлять при изменениях

| Что изменилось | Где обновить |
|----------------|-------------|
| Описание MCP-инструмента | `src/mcp/descriptions.ts` |
| Hints/nextSteps в ответах | `src/mcp/tools/<tool>.ts` |
| Справочник команд и флагов | `APITOOL.md` |
| User flow и troubleshooting | `docs/mcp-guide.md` |
| Быстрый старт | `README.md` |

## Архив

Исторические snapshot'ы. Актуальная информация — в [APITOOL.md](../APITOOL.md).

- [generation-issues.md](archive/generation-issues.md) — исторические фиксы багов при первичной генерации
- [BACKLOG-AI-NATIVE.md](archive/BACKLOG-AI-NATIVE.md) — завершённые milestone'ы M22-M27, стратегия
- [APITOOL-pre-M22](archive/APITOOL-pre-M22.md) — полная техдока до M22 (модули M1-M21, DB schema, WebUI routes)
- [M1-M2: Parser + Runner](archive/M1-M2-parser-runner.md)
- [M4-M7: Reporter + CLI](archive/M4-M7-reporter-cli.md)
- [M5-M7: Storage + JUnit](archive/M5-M7-storage-junit.md)
- [M6: WebUI](archive/M6-webui.md)

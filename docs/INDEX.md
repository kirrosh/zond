# Документация ZOND

| Документ | Описание |
|----------|----------|
| [quickstart.md](quickstart.md) | **Быстрый старт** — пошаговая инструкция: установка, настройка, первые тесты |
| [ZOND.md](../ZOND.md) | Полный справочник — MCP tools, CLI команды, YAML формат, окружения |
| [mcp-guide.md](mcp-guide.md) | Руководство для MCP-агента — флоу, примеры, советы, troubleshooting |
| [GLOSSARY.md](GLOSSARY.md) | Тезаурус сущностей — Collection, Suite, Run, Environment и др. |
| [ci.md](ci.md) | CI/CD интеграция — GitHub Actions, GitLab CI, Jenkins, триггеры, секреты |

## Где обновлять при изменениях

| Что изменилось | Где обновить |
|----------------|-------------|
| Описание MCP-инструмента | `src/mcp/descriptions.ts` |
| Hints/nextSteps в ответах | `src/mcp/tools/<tool>.ts` |
| Справочник команд и флагов | `ZOND.md` |
| User flow и troubleshooting | `docs/mcp-guide.md` |
| Быстрый старт | `docs/quickstart.md`, `README.md` |

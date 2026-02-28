# Agent Module — AI Chat Assistant

Интерактивный AI-агент для управления API-тестами через диалог в терминале.

## Архитектура

```
┌──────────────┐
│  CLI: chat   │  src/cli/commands/chat.ts
└──────┬───────┘
       │
┌──────▼───────┐
│   Chat UI    │  src/tui/chat-ui.ts — readline TUI, ANSI colors
└──────┬───────┘
       │  ModelMessage[]
┌──────▼───────────────────────────────────────────┐
│              Agent Loop                           │
│  src/core/agent/agent-loop.ts                     │
│                                                   │
│  ┌─────────────┐  ┌───────────────┐              │
│  │ buildModel  │  │ prepareMessages│              │
│  │  (provider) │  │  (sys prompt)  │              │
│  └──────┬──────┘  └───────┬───────┘              │
│         │                 │                       │
│         ▼                 ▼                       │
│     generateText({ model, messages, tools,       │
│                    stopWhen: stepCountIs(N) })    │
│         │                                         │
│         ▼                                         │
│  ┌──────────────────────────────────────┐        │
│  │           6 Agent Tools              │        │
│  │  run_tests    validate_tests         │        │
│  │  generate_tests  query_results       │        │
│  │  manage_environment  diagnose_failure│        │
│  └──────────────────────────────────────┘        │
└───────────────────────────────────────────────────┘
       │
┌──────▼──────┐
│  Core APIs  │  runner, parser, generator, db
└─────────────┘
```

## Запуск

```bash
# Ollama (default: qwen3:4b)
apitool chat

# Другая модель
apitool chat --model llama3.2:3b

# OpenAI
apitool chat --provider openai --model gpt-4o --api-key sk-...

# Anthropic
apitool chat --provider anthropic --api-key sk-ant-...

# Safe mode — только GET тесты
apitool chat --safe
```

## Зависимости

- `ai@^6` — Vercel AI SDK v6 (`generateText`, `tool`, `stepCountIs`)
- `@ai-sdk/openai@^2` — провайдер для OpenAI/Ollama/Custom
- `@ai-sdk/anthropic@^2` — провайдер для Anthropic

## Провайдеры

| Провайдер | API | Модель по умолчанию | Примечания |
|-----------|-----|---------------------|------------|
| `ollama` | OpenAI-compatible (.chat) | `qwen3:4b` | System prompt инжектируется в user message |
| `openai` | OpenAI Responses API | `gpt-4o` | Нативная поддержка system prompt |
| `anthropic` | Anthropic API | `claude-sonnet-4-20250514` | Нативная поддержка system prompt |
| `custom` | OpenAI-compatible (.chat) | — | Требуется `--base-url` и `--model` |

### Quirk: Ollama + system prompt

Некоторые модели (qwen3 в thinking mode) не вызывают tools при наличии отдельного `system` сообщения.
Решение: для `ollama`/`custom` провайдеров system prompt инжектируется в первое user-сообщение.
Для `openai`/`anthropic` используется стандартный `system` параметр.

## Tools

Каждый tool — AI SDK `tool()` с Zod `inputSchema`. Ошибки валидации аргументов автоматически возвращаются LLM для retry (фича AI SDK v6).

| Tool | Описание | Ключевые параметры |
|------|----------|--------------------|
| `run_tests` | Запуск тестов | `testPath`, `envName?`, `safe?` |
| `validate_tests` | Валидация YAML | `testPath` |
| `generate_tests` | Генерация из OpenAPI | `specPath`, `outputDir?` |
| `query_results` | Запрос к БД | `action`: `list_runs` / `get_run` / `list_collections` |
| `manage_environment` | Управление окружениями | `action`: `list` / `get` / `set` |
| `diagnose_failure` | Анализ падений | `runId` |

### Safe Mode

При `--safe` флаге `run_tests` принудительно получает `safe: true` — выполняются только GET-тесты.

## Context Manager

`context-manager.ts` управляет длиной диалога:
- До 20 сообщений — без изменений
- Более 20 — старые сообщения сжимаются в summary, последние 6 ходов сохраняются полностью
- Summary использует `role: "user"` для совместимости с API, требующими начала с user-сообщения

## Файлы модуля

```
src/core/agent/
├── agent-loop.ts        # buildProvider, buildModel, prepareMessages, runAgentTurn
├── context-manager.ts   # trimContext — управление длиной диалога
├── system-prompt.ts     # AGENT_SYSTEM_PROMPT — инструкции и примеры
├── types.ts             # AgentConfig, ToolEvent, AgentTurnResult
└── tools/
    ├── index.ts          # buildAgentTools — фабрика с safe mode wrapping
    ├── run-tests.ts      # tool() — запуск тестов
    ├── validate-tests.ts # tool() — валидация YAML
    ├── generate-tests.ts # tool() — генерация из OpenAPI
    ├── query-results.ts  # tool() — запросы к БД
    ├── manage-environment.ts # tool() — управление окружениями
    └── diagnose-failure.ts   # tool() — анализ падений

src/tui/
└── chat-ui.ts           # readline TUI — ввод, вывод, tool events

src/cli/commands/
└── chat.ts              # CLI command — парсинг аргументов, запуск UI

tests/agent/             # 53 теста
tests/cli/chat.test.ts   # 5 тестов CLI arg parsing
```

# Каналы дистрибуции скиллов для zond: каталог + гайды публикации

Deep-research отчёт (2026-07-09, m-27 Bucket E, 105 агентов, 25 claims → 21
подтверждено adversarial-верификацией, 4 отсеяно). Скоуп: skills/plugins/rules,
MCP-реестры исключены. Сестринский отчёт про discovery-MCP и поисковые
алгоритмы — `agentic-discovery-mcp-report.md`.

## Картина: три яруса

1. **Экосистема Anthropic** — official + community маркетплейсы (форма, ревью).
2. **Self-serve** — свой репо = свой маркетплейс, без чьего-либо одобрения.
3. **Кросс-харнесс агрегаторы** — авто-индексация SKILL.md (SkillsMP, skills.sh)
   и курируемые awesome-списки (issue-форма / PR с гейтом на adoption).

---

## Ярус 1 — Anthropic

### claude-plugins-official (курируемый, self-serve НЕВОЗМОЖЕН)

- **Что**: официальный маркетплейс, авто-доступен каждой установке Claude Code
  (`/plugin > Discover`), публичный каталог claude.com/plugins с install-counts
  (топы >1M installs). Репо ~31.9k stars, обновляется ежедневно.
- **Подача**: заявок НЕТ — «There is no application process, and the submission
  form does not add plugins to the official marketplace». Курируется Anthropic;
  партнёрский листинг — через partner manager. Все формы подачи ведут только в
  community (ниже).
- **Бонус официального листинга**: hint-протокол — CLI вендора может эмитить
  `<claude-code-hint type="plugin"/>` в stderr при `CLAUDECODE=1`, и Claude Code
  сам предложит установку. Работает ТОЛЬКО для Anthropic-маркетплейсов.
- **Механика включения third-party**: каталог = `.claude-plugin/marketplace.json`,
  внешние плагины ссылаются на репо автора с пином на SHA (все 204 внешних
  записи запинены; обновление = bump SHA).
- Источники: code.claude.com/docs/en/plugins, …/discover-plugins,
  …/plugin-hints, github.com/anthropics/claude-plugins-official.

### claude-plugins-community (форма, реальный путь)

- **Что**: второй публичный маркетплейс Anthropic; пользователи добавляют его
  вручную (`/plugin marketplace add anthropics/claude-plugins-community`).
- **Подача — форма, не PR** (PR в репо авто-закрываются, это read-only зеркало):
  - индивидуальные авторы: **platform.claude.com/plugins/submit** (Console);
  - Team/Enterprise: claude.ai/admin-settings/directory/submissions/plugins/new.
  - (URL `claude.ai/settings/plugins/submit` из ранних заметок устарел.)
- **Требования**: публичный GitHub-репо; automated validation + safety
  screening (тот же чек, что `claude plugin validate`); пин на commit SHA,
  обновления зеркалятся автоматически без повторной подачи. Ручное ревью —
  только для опционального бейджа «Anthropic Verified».
- **Гайд**: 1) собрать плагин (формат ниже) → 2) `claude plugin validate` →
  3) форма Console → 4) ждать automated screening.

### Формат плагина (общий для яруса 1 и self-serve)

- Манифест `.claude-plugin/plugin.json`; `name` задаёт namespace команд
  (`/zond:scan`). Формально опционален при default-layout.
- `skills/`, `commands/`, `agents/`, `hooks/` — в **корне** плагина, НЕ внутри
  `.claude-plugin/` (частая ошибка).
- Каждый скилл = папка с `SKILL.md` (YAML frontmatter: name + description).
- Перед любой подачей: `claude plugin validate`.

---

## Ярус 2 — Self-serve: свой репо = маркетплейс (самый быстрый путь)

- ЛЮБОЙ GitHub-репо (или git URL/локальный путь) с `.claude-plugin/marketplace.json`
  — полноценный маркетплейс: пользователи ставят через
  `/plugin marketplace add kirrosh/zond` → `/plugin install zond@...`.
  Docs прямо называют это путём независимой дистрибуции.
- **Гайд для zond**: добавить в репо `.claude-plugin/marketplace.json` +
  `plugin.json`, скиллы из `src/cli/commands/init/templates/skills/` оформить
  как plugin-skills; однострочник установки — в README и llms.txt.
- **Подводные камни**: URL-based (не-git) маркетплейсы глючат с relative paths;
  enterprise может блокировать произвольные маркетплейсы
  (`strictKnownMarketplaces`).

---

## Ярус 3 — Кросс-харнесс агрегаторы и каталоги

### SkillsMP (skillsmp.com) — авто-индексация, подачи нет

- Агрегатор «2M+ SKILL.md из публичных GitHub-репо» (число завышено —
  авто-скрейп). Совместимость: Claude Code, Codex CLI (официально читает тот же
  SKILL.md-формат из `.agents/skills`), ChatGPT (слабо подтверждено).
- **Листинг**: опубликовать SKILL.md в публичном репо и дождаться индексации.
  Формы/PR нет.
- **Для агентов-роутеров**: REST API `GET /api/v1/skills/search` (+ MCP,
  skillsmp.com/mcp); 50 req/day анонимно / 500 с ключом. Т.е. description
  скилла — это и поисковый сниппет внутри SkillsMP.

### skills.sh (Vercel) — авто-листинг по install-телеметрии

- «The Agent Skills Directory»; листинг и leaderboard растут из установок
  `npx skills add owner/repo`. Формы подачи нет.
- **Гайд**: публичный SKILL.md с валидным frontmatter → продвигать команду
  `npx skills add kirrosh/zond` (README, посты) → позиция растёт сама.

### awesome-claude-code (~49.6k stars) — ТОЛЬКО issue-форма

- Крупнейший community-каталог Claude Code-ресурсов, живой.
- **Ловушка**: подача ТОЛЬКО через GitHub web-UI issue-форму
  (recommend-resource.yml). PR запрещены («Do not open a PR»), gh CLI не
  подходит, нарушителям — временный бан на взаимодействие.
- Структуру секций (есть ли отдельная Skills) проверить вручную перед подачей —
  claim о секциях верификацию не прошёл.

### VoltAgent/awesome-agent-skills (~27.7k stars, 8 харнессов) — PR с гейтом

- Один листинг покрывает Claude Code, Codex, Antigravity, Gemini CLI, Cursor,
  GitHub Copilot, OpenCode, Windsurf.
- **Подача**: PR «Add skill: author/skill-name» (каталог хранит ссылки).
- **Гейт**: «Brand new skills that were just created are not accepted» —
  требуется реальное community usage. Для zond — подача ПОСЛЕ накопления
  установок (trigger event, см. feedback_low_priority_trigger_events).
- Веб-зеркала (officialskills.sh) у каталога нет — claim отсеян 0-3.

### Отсеянное / не подтверждено живым

- claudemarketplaces.com и аналогичные агрегаторы — заявленные в ранних
  заметках объёмы/механика не подтвердились верификацией; в план не включать
  без повторной проверки.
- cursor.directory / opencode registry как отдельные skill-каналы — не
  подтверждены как живые каналы для SKILL.md-формата; Cursor/opencode
  покрываются листингом в VoltAgent.

---

## План для zond (порядок исполнения)

| Шаг | Канал | Действие | Гейт |
|---|---|---|---|
| 1 | Self-serve (ярус 2) | `.claude-plugin/{plugin,marketplace}.json` в репо + `claude plugin validate` | нет — сразу |
| 2 | SkillsMP + skills.sh | публичный SKILL.md уже в репо → авто-индексация; продвигать `npx skills add kirrosh/zond` | нет — сразу |
| 3 | claude-plugins-community | форма platform.claude.com/plugins/submit | automated screening |
| 4 | awesome-claude-code | issue-форма (web-UI!) | ревью мейнтейнера |
| 5 | VoltAgent/awesome-agent-skills | PR | **trigger: реальные установки** |
| — | claude-plugins-official | недостижим self-serve; hint-протокол — если Anthropic сам залистит | партнёрство |

Шаги 1–2 — упаковочная часть ARV-395; шаги 3–4 — подача (нужен владелец
аккаунта); шаг 5 — отложен до adoption-сигнала.

# Discovery-инструменты для coding-агентов: что индексируют, как ранжируют, что подкручено в zond

Research-отчёт (2026-07-09, m-27 Bucket E, контекст ARV-395/396). По каждому
каналу: что индексирует → как ранжирует (с источниками) → действия для zond.
Сводный чек-лист и статус применения — в конце.

---

## 0. Найденные дыры в базовой обвязке (важнее алгоритмов)

- **npm (`@kirrosh/zond`)**: опубликованная версия несёт старое описание
  («API testing platform…») и generic-keywords — новые метаданные из ARV-393
  лежат только в git. → задача на publish.
- **`package.json` не содержал `repository`/`homepage`/`bugs`** — npm-страница
  не линковалась на GitHub, а на эту связку опираются Context7/DeepWiki/Chroma.
  → исправлено 2026-07-09.
- **GitHub `kirrosh/zond`**: `description: null`, `topics: []`, `homepage: null` —
  репо было невидимо для GitHub best-match поиска. → заполнено 2026-07-09.
- `llms.txt` в корне есть (ARV-394) ✓; `context7.json` не было → добавлен.

## 1. Context7 (Upstash) — самый управляемый канал

**Индексирует:** публичные GitHub-репо (submit кто угодно через
context7.com/add-library), websites, llms.txt, OpenAPI-спеки. Парсит только
doc-файлы (`.md .mdx .rst .txt .ipynb`); код — fallback при бедных доках.
Источники: [adding-libraries.mdx](https://github.com/upstash/context7/blob/master/docs/adding-libraries.mdx),
[library-updates.mdx](https://github.com/upstash/context7/blob/master/docs/library-updates.mdx).

**Ранжирует** двухступенчато: серверный `resolve-library-id` (закрыт) + LLM-сторона,
где description тула инструктирует модель выбирать по (дословно из
[packages/mcp/src/index.ts](https://github.com/upstash/context7/blob/master/packages/mcp/src/index.ts)):
name similarity (exact prioritized) · description relevance to the query's
intent · documentation coverage (**higher Code Snippet counts**) · source
reputation · benchmark score.

**Trust/verification** ([verification.mdx](https://github.com/upstash/context7/blob/master/docs/howto/verification.mdx)):
trust score по GitHub-профилю владельца; авто-верификация при trust>7 / 250+
stars / top-1% / 200+ referring domains; иначе — ручная заявка (реальный путь
для zond). Verified «prioritized in search results».

**Свежесть:** авто-refresh (top-100 — 1 день, прочие — 45 дней) + официальный
[GitHub Action](https://github.com/upstash/context7/blob/master/docs/integrations/github-actions.mdx) на push.

**Конфиг `context7.json`** ([library-owners.mdx](https://github.com/upstash/context7/blob/master/docs/library-owners.mdx)):
projectTitle, description, folders, excludeFolders/Files, **rules (инжектятся
в контекст чужого агента!)**, previousVersions.

**Действия:** context7.json в корне (сделано) → submit → нарастить
code-snippet-плотность в docs/*.md → claim + manual verification → GH Action.

## 2. Package Search MCP (Chroma)

Кураторные «3K+ packages» (npm/PyPI/crates/…): **полный код**, чанки в Chroma,
ежедневная переиндексация. НЕ discovery — агент должен уже знать имя пакета;
ценность: агент читает код zond без установки. Попадание: PR в
[chroma-core/package-search](https://github.com/chroma-core/package-search/)
(`npm/@kirrosh/zond/config.json` + запись в index.json); отбор по
«relevance, popularity, community value» — риск отказа по popularity.

## 3. DeepWiki (Cognition)

AI-wiki поверх публичного GitHub-репо; индексация бесплатна и по запросу —
открыть `deepwiki.com/kirrosh/zond`. MCP (`mcp.deepwiki.com`) отвечает по
конкретному репо, глобального discovery нет. Качество wiki = качество
структуры кода/доков. Бейдж в README → авто-обновление (вторичные источники:
[mcp.directory](https://mcp.directory/blog/deepwiki-mcp-complete-guide-2026),
[codersera](https://codersera.com/blog/deepwiki-complete-developer-guide-2026/);
в официальном блоге явно не подтверждено).
Источники: [cognition.com/blog/deepwiki](https://cognition.com/blog/deepwiki),
[deepwiki-mcp-server](https://cognition.com/blog/deepwiki-mcp-server).

## 4. Агентские поисковики: Exa / Tavily / Perplexity

- **Exa exa-code** ([blog](https://exa.ai/blog/exa-code), [docs](https://docs.exa.ai/reference/context)):
  hybrid search по 1B+ страниц → извлечение **code examples** → ensemble
  reranking; «heavily prioritizes putting code examples into the context».
  Submit-канала нет; сигнал — страницы с реальными код-примерами под целевые
  фразы.
- **Tavily** ([docs](https://docs.tavily.com/documentation/api-reference/endpoint/search)):
  real-time crawl + cosine similarity + проприетарный скоринг; llms.txt
  специально не обрабатывает.
- **Perplexity Sonar**: полностью закрыт; фактически web-SEO + семантика.

Единственный рычаг — контент: README/docs/посты с плотными рабочими
код-примерами, сформулированными под интенты («test a REST API against its
OpenAPI spec» и т.п.).

## 5. npm search — алгоритм сменился в декабре 2024

npms.io-скоринг (quality/popularity/maintenance) **демонтирован**. Сейчас:
«keyword matching from the package's **title, description, readme, and
keywords**. No subjective ranking criteria… minimal boost to deprioritize
spammy or entirely new packages» (OpenSearch). Deprecated исключаются; новые
пакеты в поиске — с лагом до 2 недель. CLI `npm search` бьёт в тот же endpoint.
Источники: [docs.npmjs.com](https://docs.npmjs.com/searching-for-and-choosing-packages-to-download/),
[socket.dev](https://socket.dev/blog/npm-updates-search-experience).

**Автор контролирует все четыре поля.** README пакета — полноценный
ранжирующий корпус: целевые фразы должны встречаться буквально.

## 6. GitHub-поиск (gh search repos / web)

Best-match формула закрыта ([docs](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/sorting-search-results));
эмпирика [markepear.dev](https://www.markepear.dev/blog/github-search-engine-optimization):
- Поля: **Name, About, Topics**, затем stars; README почти не влияет.
- Keyword в Name перевешивает 4x разницу в звёздах.
- About: работает плотность search-термов → короткое плотное описание.
- Topics: только точное совпадение терма (дефисы значимы).

Имя `zond` без keywords — компенсируется About/Topics, переименование не нужно.

## 7. Остальные живые «librarian»-инструменты

| Инструмент | Суть | Действие |
|---|---|---|
| [GitMCP](https://github.com/idosal/git-mcp) | on-the-fly по любому репо: приоритет **llms.txt** → llms-full.txt → README | llms.txt есть ✓; рассмотреть llms-full.txt |
| [Ref.tools](https://ref.tools/blog/how-does-ref-mcp) | краулит doc-сайты/репо, проприетарный поиск | письмо на hello@ref.tools с просьбой добавить |
| [langchain mcpdoc](https://github.com/langchain-ai/mcpdoc) | user-defined список llms.txt | стабильный URL llms.txt (raw.githubusercontent ок) |
| [arabold/docs-mcp-server](https://github.com/arabold/docs-mcp-server) | self-hosted скрейпер | сабмитить некуда; выигрывает структура доков |

Отсеяны: npms.io (демонтирован), npm.io (зеркало), однодневные
package-registry-MCP (обёртки над registry API — влияет то же, что на §5).

## Сводный чек-лист (по убыванию ROI) и статус

1. ✅ package.json: `repository`/`homepage`/`bugs` добавлены (2026-07-09).
2. ✅ GitHub About + 12 topics + homepage→npm заполнены (2026-07-09).
3. ✅ context7.json в корне (с `rules`).
4. ⏳ npm publish новых метаданных — ARV-400 (лаг индексации до 2 недель).
5. ⏳ Context7 submit + claim + verification + GH Action + snippet-density — ARV-401.
6. ⏳ DeepWiki индексация + бейдж; Ref.tools email; Chroma PR — ARV-402.
7. ⏳ Контент под Exa/веб-поиск — покрывается ARV-398 (корпус-трек).

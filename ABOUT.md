# FinAgent

> **The unified financial AI platform.** Upload any financial file. Watch an agent pipeline clean it, map it, validate it, and load it. See it on a live dashboard. Ask plain-English questions and get answers backed by source data and a confidence score.

FinAgent is a single-service web app that packages four tightly-integrated capabilities into one tool: **data ingestion**, **data workspace**, **intelligence layer**, and **conversational brain**. Each pillar is independently useful; together they give finance teams the full loop — load the data, see the data, make sense of the data, ask questions about the data — without ever leaving the browser.

---

## The problem

A finance analyst who wants to answer a simple question ("how is ACME-NA tracking against budget this quarter?") typically has to:

1. Hunt down the right Excel file.
2. Figure out which sheets and columns matter.
3. Copy/paste into a BI tool or a working spreadsheet.
4. Clean it (rename columns, fix dates, normalise currencies, resolve FK mismatches).
5. Build a chart or pivot.
6. Write a short narrative for the deck.

Every step introduces friction, errors, and opacity. Answers arrive hours or days after the question was asked, and the people who read the answer can't see the working.

FinAgent collapses the whole loop into **upload → see → ask**. Every number is traceable back to a row; every answer carries a confidence score; every dashboard insight regenerates the moment new data lands.

---

## The four pillars

### Pillar 1 — Data Ingestion

A **6-agent AI pipeline** turns messy financial files into clean, structured data in 30–60 seconds:

| Stage | Agent | Time | Responsibility |
|---|---|---|---|
| 1 | **File Parser** | 1–3s | Reads Excel / CSV / PDF / JSON. Detects sheets, headers, merged cells, finds the actual data table inside each sheet. |
| 2 | **Sheet Classifier** | 5–10s | LLM agent — decides what each sheet is. GL? Budget? Revenue? Ignore? |
| 3 | **Schema Mapper** | 10–20s | LLM agent — maps source columns to canonical fields, proposes transformations (date formats, unit conversions, FK lookups), synthesises missing primary keys. Reuses prior mappings automatically. |
| 4 | **Data Validator** | 5–15s | Two-layer validation: mechanical (types, FKs, required fields, duplicates) then semantic (outliers, sign anomalies, period gaps). |
| 5 | **Reconciler** | 5–10s | Compares validated data against what already exists. Auto-dedupes exact matches; surfaces value conflicts for your decision. |
| 6 | **Loader** | 1–2s | Writes everything in a single transaction — all or nothing. Stamps provenance, creates audit entries, saves mapping memory, triggers insight regen. |

**Key property: mapping memory.** The first time you upload a file with a given column shape, stage 3 costs an LLM call. Every subsequent upload with the same headers reuses the prior mapping — zero tokens, zero latency. You can confirm/tweak before commit; the confirmed mapping becomes the new default.

**Key property: human-in-the-loop checkpoints.** The pipeline pauses after mapping (so you can review column assignments) and again after reconciliation (so you can choose how to handle conflicts). You stay in control at every step.

### Pillar 2 — Data Workspace

A **spreadsheet-grade table editor** for the 6 canonical tables. This is the trust layer — finance people need to *see* the data to trust the answers.

- Virtualised rendering so large tables scroll smoothly
- Inline editing with **50-step undo/redo**
- **Find & replace**, column resize, keyboard navigation (↑↓←→, Enter to edit, Tab to commit)
- **Bulk paste** from Excel (multi-row, multi-column)
- Per-row **data-quality indicators** sourced from the validator's issue log
- Row details panel showing every system column (source, provenance, confidence, who edited it)
- Pre-loaded with **3,900+ rows** of realistic sample data across 4 entities and 24 months, so you can explore immediately

### Pillar 3 — Intelligence Layer

An **insight generator agent** continuously scans the canonical data using an 11-rule registry, narrates what matters, and pushes it to a live dashboard. **Auto-regenerates on every successful upload** — your dashboard is never stale.

**The curated dashboard** — 6 hero KPI tiles + 9 charts:

- **KPI strip**: Revenue YTD, Net Cash, Budget Attainment, Net Margin, AR Outstanding, Open Alerts. Each with delta arrow + 12-period sparkline.
- **Revenue trend by entity** — line chart, last 12 periods.
- **Entity concentration** — donut showing trailing-3-month revenue share.
- **Cash flow by category** — stacked area (operating / investing / financing).
- **AR aging** — current / 30 / 60 / 90+ buckets.
- **P&L waterfall** — revenue → expense lines → net income for the latest period.
- **YoY revenue** — paired bars per entity.
- **Top variances** — horizontal bar, colored by favorable/unfavorable.
- **Variance heatmap** — accounts × periods, color intensity = variance severity.
- **Data freshness** — chips showing row count + last-updated timestamp per table.

**The 11-rule insight engine** — each rule is a pluggable module emitting signals with `severity`, `impact_dollars`, `trend_data`, `sources`, `confidence`:

| Rule | What it watches for |
|---|---|
| **Top Variances** | Accounts missing budget beyond the table's 75th-percentile variance |
| **Budget Attainment** | Per-entity % of plan, trailing 3 months |
| **Revenue Trend** | Recent-3 vs prior-3 month revenue shift per entity |
| **Year-over-Year** | Same-month comparison vs prior year |
| **Margin Compression** | Net margin delta (pp) vs prior 3-month window |
| **Concentration Risk** | Entity or BU dominance of total revenue |
| **AR Aging** | Over-60-day share of outstanding receivables |
| **DSO** | Days Sales Outstanding per active entity |
| **Cash Flow Direction** | Operating cash trend + category mix |
| **GL Outliers** | Journal entries 3–5× the entity's median transaction size |
| **Data Quality** | Empty tables + period-gap detection |

**The narrator agent** dedupes overlapping signals, ranks them by severity × $-impact, caps at the top 12, then composes insight cards with punchy titles, impact chips, sparklines, source row references, and a "drill into chat" question. A **data-context prefix** in the prompt tells the narrator how much history exists and where user data begins, so it doesn't mistake seeded baselines for genuine YoY collapses.

### Pillar 4 — Conversational Brain

A **two-tier chat agent** that answers questions with tables, context, and a full audit trail.

```
User question
   │
   ▼
┌────────────────────────────────────────┐
│ Tier 1 — Router (light model)          │
│ Classifies intent: data_lookup,        │
│ comparison, computation, trend_analysis│
│ meta, data_management, unsupported     │
└────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────┐
│ Tier 2 — Worker (heavy model)          │
│ Runs a tool loop with 6 whitelisted    │
│ tools. Typically 3–5 calls per answer. │
│                                        │
│   • query_table                        │
│   • join_query (predefined joins only) │
│   • calculate (JS, not LLM math)       │
│   • get_metadata                       │
│   • lookup_canonical_values            │
│   • describe_schema                    │
└────────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────────┐
│ Synthesizer (light model)              │
│ Writes the final answer + 3 follow-up  │
│ suggestions. No tools — just prose.    │
└────────────────────────────────────────┘
   │
   ▼
Answer with:
  • 5-factor confidence score (green/amber/red)
  • Clickable source chips linking back to tables
  • "Show work" panel — router decision + every tool call,
    input, output, and latency
```

**5-factor confidence scoring:**

| Factor | Weight | Question |
|---|---|---|
| Data Completeness | 30% | Are all required fields present? |
| Data Freshness | 20% | How recent is the underlying data? |
| Assumptions | 20% | Did the AI make assumptions? |
| Cross-Validation | 15% | Do multiple sources agree? |
| Benchmark Deviation | 15% | Are values within expected ranges? |

**Safety rails:**

- **All math in code, never in the LLM.** The `calculate` tool dispatches to named expressions (growth_rate, variance, margin, ratio, CAGR, etc.).
- **SQL is never LLM-generated.** Tool inputs pass a strict whitelist — table names, field names, and operators are all validated against explicit allow-lists. Joins are predefined, not constructed.
- **Tool outputs cap at 100KB each** to prevent prompt-stuffing attacks.

---

## The canonical data model

Everything lands in one of these 6 tables (every table also carries system columns for provenance: `source`, `source_row_ref`, `created_at`, `updated_at`, `created_by`, `updated_by`, `confidence`, `is_dummy`):

| Table | Purpose | Primary Key |
|---|---|---|
| `entity_master` | Legal entities, regions, currencies | `entity_id` |
| `chart_of_accounts` | Account codes, types, hierarchy | `account_code` |
| `general_ledger` | The transactional spine — every period × entity × account | `entry_id` |
| `revenue_billing` | Billed, collected, outstanding per BU/product | `record_id` |
| `budget_vs_actuals` | Budget, actual, variance per account | `record_id` |
| `cash_flow` | Operating, investing, financing line items | `record_id` |

Plus 6 platform tables for runtime state: `upload_jobs`, `schema_mappings`, `chat_conversations`, `chat_messages`, `tool_call_log`, `audit_log`, `data_quality_issues`, `dashboard_insights`.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser                                                       │
│  • React + Vite + Recharts + Lucide                            │
│  • localStorage holds LLM API key (never sent to server for    │
│    storage — only per-request via x-llm-api-key header)        │
└────────────────┬──────────────────────────────────────────────┘
                 │ HTTPS / JSON
                 ▼
┌───────────────────────────────────────────────────────────────┐
│  Express backend (single process, single port)                 │
│  • Rate-limited routes (/chat, /uploads)                       │
│  • In-process job queue (no Redis)                             │
│  • WASM SQLite (sql.js) — no native bindings                   │
│  • All LLM calls proxied through /agents/llm.js                │
│                                                                │
│  /routes                                                       │
│    tables.js         → CRUD over canonical tables              │
│    uploads.js        → triggers the 6-agent pipeline           │
│    chat.js           → orchestrates Router → Worker → Synth   │
│    chat.js           → /dashboard/kpis + /dashboard/curated    │
│                        + /dashboard/insights{,/generate}       │
│                                                                │
│  /agents                                                       │
│    ingestion/        → 6 pipeline stages                       │
│    chat/             → orchestrator                            │
│    insights/         → 11 rules + narrator                     │
│    llm.js            → multi-provider fan-out                  │
│    loop.js           → generic tool-use loop                   │
└────────────────┬──────────────────────────────────────────────┘
                 │
                 ▼
┌───────────────────────────────────────────────────────────────┐
│  LLM Provider (user's choice)                                  │
│  Anthropic · OpenAI · Google · DeepSeek                        │
└───────────────────────────────────────────────────────────────┘
```

**Deployment profile.** One node process, one SQLite file, one port. Frontend builds to `frontend/dist` and Express serves it statically on the same port as the API. No native bindings anywhere — `sql.js`, `papaparse`, `xlsx`, `pdf-parse`, `jimp` all install cleanly on a corporate machine without `node-gyp`.

---

## What makes FinAgent different

- **One tool, not three.** Most "AI for finance" products are either an ingestion tool OR a BI tool OR a chatbot. FinAgent is all three with shared state — the ingestion pipeline writes rows, the insight engine narrates them, the chat brain queries them, the dashboard visualises them, and every layer links back to the underlying rows.

- **Every answer is auditable.** The chat shows you the router decision, every tool call, every tool input and output, and the latency for each. The "Show work" panel is a debugging tool and a trust tool.

- **Mapping memory that actually saves work.** Second upload with the same header signature skips the LLM mapper entirely and reuses the prior mapping. Third upload = same. This is the feature that makes repeat usage feel cheap.

- **Bring-your-own key.** API keys stay in the user's browser. No server-side key storage, no credential handoff. Operators can optionally enable a server fallback for single-user deployments via `ALLOW_SERVER_API_KEY=true`, but it's off by default.

- **No lock-in on the model.** Swap between Anthropic / OpenAI / Google / DeepSeek in Settings. The abstraction lives in one file (`agents/llm.js`).

- **Safe math.** The chat brain never does arithmetic in its head. Every calculation dispatches to a named JS function. This isn't performance optimisation — it's correctness.

- **The dashboard rebuilds itself.** Every successful upload triggers the insight engine. You don't re-run anything. The dashboard is a live window into the canonical data, not a static report.

---

## Typical workflow

```
1. Open /settings, paste your Anthropic (or OpenAI/Google/DeepSeek) API key.
2. Open /dashboard — pre-seeded data already produces live charts + insights.
3. Open /chat — ask "What was total revenue Q4 2024 by entity?"
   → Get a confident answer with sources and a "Show work" trail.
4. Open /workspace → Upload your own file (Excel / CSV / PDF / JSON).
   → The 6-agent pipeline runs; you confirm the mapping; rows load.
   → Insights auto-regenerate. The dashboard reflects the new data.
5. Go back to /chat and ask a question about the new data.
```

---

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node 20+, Express | Simple, single-process, no cluster needed for prototype scale |
| Database | SQLite via `sql.js` (WASM) | Zero native deps, deploys on Render free tier |
| LLM | Anthropic (Haiku 4.5 + Sonnet 4.6), or OpenAI / Google / DeepSeek | User-configurable |
| File parsing | `xlsx`, `papaparse`, `pdf-parse`, `jimp` | Pure JS, no `node-gyp` |
| Frontend | React 18 + Vite 5 | Fast dev loop, small bundle |
| Charts | Recharts | Declarative, composable, fits React model |
| Icons | Lucide | 1k+ icons, tree-shaken |
| Styling | Single `global.css`, CSS variables | No Tailwind / no CSS-in-JS overhead |
| Build | Vite build → `frontend/dist`, served by Express | One port, one process |
| Deploy | Render (free tier works) | `render.yaml` included |

---

## Security posture

- **No API keys server-side by default.** Users paste their key in Settings; it lives in browser `localStorage` and travels on the `x-llm-api-key` header.
- **Header-only.** Backend reads keys from headers only, never from request bodies (after the security audit).
- **Rate-limited** on LLM-heavy routes (`/api/chat`, `/api/uploads`) — 30 req/min per IP.
- **SQL-injection-proof chat tools.** Identifier and operator whitelists on every tool input.
- **Audit trail** on every row write, with actor, old value, new value, and source job ID.
- **`.gitignore` excludes** `.env`, `.claude/`, `*.pem`, `*.key`, all local test artifacts, and the SQLite DB file.

---

## Project layout

```
finagent/
├── backend/
│   ├── server.js                   Express boot + env loader + rate limiter
│   ├── database.js                 sql.js wrapper with debounced autosave
│   ├── schema.js                   All 12 tables + field definitions
│   ├── seed.js                     Dummy data generator (~3,900 rows)
│   ├── test.js                     23-test smoke suite
│   ├── agents/
│   │   ├── llm.js                  Multi-provider LLM router
│   │   ├── loop.js                 Generic tool-use loop
│   │   ├── confidence.js           5-factor confidence scoring
│   │   ├── chat/orchestrator.js    Router + Worker + Synthesizer
│   │   ├── insights/
│   │   │   ├── index.js            Rule orchestrator + narrator
│   │   │   ├── helpers.js          Money, pct, percentile, data-context
│   │   │   └── rules/              11 signal rules, one file each
│   │   └── ingestion/              6-agent pipeline, one file each
│   ├── tools/chatTools.js          Whitelisted tools for the chat worker
│   ├── jobs/queue.js               In-process job queue (no Redis)
│   ├── routes/                     tables, uploads, chat, dashboard, admin
│   ├── storage/                    Uploaded files (gitignored)
│   └── data/                       SQLite persistence (gitignored)
└── frontend/
    ├── vite.config.js              Dev proxy /api → :8000
    └── src/
        ├── App.jsx                 Layout + routing
        ├── api.js                  Axios + LLM key injection
        ├── components/
        │   ├── TableEditor/        Custom virtualized editor
        │   ├── UploadModal/        Stepper + mapping review + conflicts
        │   └── Chat/ChatView.jsx   Messages + show-work + followups
        ├── pages/
        │   ├── OverviewPage.jsx    4-pillar explainer with live data strip
        │   ├── DashboardPage.jsx   KPI strip + 9 charts + AI insights tab
        │   ├── WorkspacePage.jsx   Table editor + upload
        │   ├── ChatPage.jsx        Chat UI with conversation list
        │   └── SettingsPage.jsx    API key management
        └── styles/global.css       Single stylesheet
```

---

## Running locally

See [README.md](README.md) for setup. Two-terminal summary:

```cmd
:: Terminal 1 — Backend
cd backend && node server.js

:: Terminal 2 — Frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`. First thing: go to **Settings** and paste your API key.

---

## Roadmap / known gaps

- **"Show work" execution-graph rendering** could be prettier — currently a flat list, could be a tree.
- **Layer B semantic validation** only does outlier detection. Could add cross-field consistency checks (e.g., `billed = collected + outstanding`).
- **Per-insight drill-through** — sources show `table (N rows)` but don't yet link directly to the workspace filtered to those row IDs.
- **Currency normalisation** — the dashboard displays whatever currency the source row uses. A `reporting_currency` conversion layer would be a real upgrade.
- **Budget/forecast editing in workspace** — read-only for budget tables today; inline editing only wired for the data tables.

---

## Credits

Built in collaboration between **[@RakboPerera](https://github.com/RakboPerera)** and **Claude** (Anthropic). Live at [github.com/RakboPerera/finagent](https://github.com/RakboPerera/finagent).

# FinAgent — Tool 1: Gen AI Financial Chatbot

Single-service web app: Express backend + React frontend, all pure JavaScript per the JKH stack constraints.

## What's in this build

- **6 canonical tables** (entity_master, chart_of_accounts, general_ledger, revenue_billing, budget_vs_actuals, cash_flow) + 6 platform tables (uploads, mappings, conversations, messages, tool calls, audit log, data quality issues)
- **3,894 dummy rows** seeded on first boot, with deliberate anomalies (Q4 revenue spike, ACME-LA discontinuation mid-2024, Q3 marketing overrun, APAC revenue shortfall)
- **6-agent ingestion pipeline**: File Parser → Sheet Classifier → Schema Mapper → Validator (mechanical + semantic) → Reconciler → Loader, with a stepper UI and human-in-the-loop checkpoints
- **2-tier chat brain**: Router (light model) + Worker agent with tools (heavy model) + Synthesizer, all math in pure JS
- **4 LLM providers** (Anthropic, OpenAI, Google, DeepSeek) with keys in browser localStorage
- **Custom virtualized table editor** (no AG Grid / TanStack), inline editing, sort, filter, multi-select, sample-data indicators
- **Curated dashboard** with 4 Recharts charts (revenue trend, top variances, cash position, data freshness)
- **Confidence scoring** (5 factors) on every chat answer
- **Full audit trail** ("Show work" panel) — router decision + tool calls + tokens + latency

## Local setup

### 1. Install dependencies

**CMD:**
```cmd
cd /d "C:\Users\rakbop\OneDrive - John Keells Holdings PLC\Claude presentations\finagent"
cd backend && npm install
cd ..\frontend && npm install
cd ..
```

**PowerShell:**
```powershell
cd "C:\Users\rakbop\OneDrive - John Keells Holdings PLC\Claude presentations\finagent"
cd backend; npm install
cd ..\frontend; npm install
cd ..
```

### 2. Run in dev mode (two terminals)

**Terminal 1 — Backend (CMD):**
```cmd
cd backend && node server.js
```
**Terminal 1 — Backend (PowerShell):**
```powershell
cd backend; node server.js
```

**Terminal 2 — Frontend (CMD):**
```cmd
cd frontend && npm run dev
```
**Terminal 2 — Frontend (PowerShell):**
```powershell
cd frontend; npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the backend on port 8000.

### 3. First-run flow

1. The backend creates `backend/data/finagent.db` and seeds 3,894 dummy rows on first boot.
2. Open the app → you land on the Dashboard with charts populated by dummy data.
3. Go to **Settings** and add an LLM API key for at least one provider.
4. Set that provider as active.
5. Try the **Chat** view: "What was total revenue across all entities for Q4 2024?" or "Compare cash flow trends between ACME-NA and ACME-EU."
6. Try the **Data Workspace**: browse the 6 tables, edit cells inline, click **Upload file** to test the ingestion pipeline with a real Excel.

## Run in production-style mode

```cmd
cd frontend && npm run build
cd ..\backend && node server.js
```

The Express server serves `frontend/dist` automatically on `http://localhost:8000`. Single port, single process.

## Run tests

```cmd
cd backend && node test.js
```

23 tests cover schema, seed anomalies, chat tool security (operator/identifier whitelisting, predefined joins), validator (FK violations, duplicate PKs, missing required fields), and reconciler.

## Deploy to Render

1. Push to GitHub:
```cmd
git init
git add .
git commit -m "Initial FinAgent build"
git remote add origin https://github.com/RakboPerera/finagent.git
git branch -M main
git push -u origin main
```

2. On render.com → New → Web Service → connect the repo.
3. Render will pick up `render.yaml` automatically. If it doesn't:
   - **Build:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start:** `cd backend && node server.js`
4. Free tier is fine for testing.
5. LLM keys are user-supplied per memory — no env vars needed in Render.

## Project layout

```
finagent/
├── backend/
│   ├── server.js                   # Express boot, async DB init
│   ├── database.js                 # sql.js wrapper with auto-save
│   ├── schema.js                   # All 12 tables
│   ├── seed.js                     # Dummy data generator (~3,900 rows)
│   ├── test.js                     # Smoke test suite (23 tests)
│   ├── agents/
│   │   ├── llm.js                  # Multi-provider LLM router
│   │   ├── loop.js                 # Generic tool-use loop
│   │   ├── confidence.js           # 5-factor confidence scoring
│   │   ├── chat/orchestrator.js    # Router + Workers + Synthesizer
│   │   └── ingestion/
│   │       ├── parser.js           # Agent 1: File Parser
│   │       ├── classifier.js       # Agent 2: Sheet Classifier
│   │       ├── mapper.js           # Agent 3: Schema Mapper
│   │       ├── validator.js        # Agent 4: Validator
│   │       ├── reconciler.js       # Agent 5: Reconciler
│   │       └── loader.js           # Agent 6: Loader
│   ├── tools/chatTools.js          # query_table, join_query, calculate, etc.
│   ├── jobs/queue.js               # In-process job queue (no Redis)
│   ├── routes/                     # tables, uploads, chat, settings, dashboard
│   ├── storage/                    # Uploaded files (gitignored)
│   └── data/                       # SQLite persistence (gitignored)
└── frontend/
    ├── vite.config.js              # Dev proxy /api → :8000
    └── src/
        ├── App.jsx                 # Layout + routing
        ├── api.js                  # Axios + LLM key injection
        ├── components/
        │   ├── TableEditor/        # Custom virtualized editor
        │   ├── UploadModal/        # Stepper + mapping review + conflicts
        │   └── Chat/ChatView.jsx   # Messages + show-work + followups
        ├── pages/                  # Workspace, Chat, Dashboard, Settings
        └── styles/global.css       # Single stylesheet, no Tailwind
```

## Architecture notes

- **No native bindings anywhere.** sql.js (WASM SQLite), papaparse, xlsx, pdf-parse, jimp etc. would all install cleanly on a JKH machine without `node-gyp`.
- **Two-tier chat keeps tool counts bounded per call** — Router has zero tools, Worker has six, Synthesizer has zero.
- **Joins are predefined** in `tools/chatTools.js` — the LLM cannot construct an arbitrary join, only pick from `general_ledger ↔ entity_master/chart_of_accounts`, `budget_vs_actuals ↔ entity_master/chart_of_accounts`, etc.
- **Identifiers and operators are tightly whitelisted** — table names, field names, and SQL operators must pass `[a-zA-Z_][a-zA-Z0-9_]*` and an explicit set respectively. Tested.
- **Calculations are JS, not LLM** — the `calculate` tool dispatches to named expressions (growth_rate, variance, margin, ratio, cagr, etc.).
- **OneDrive path warning:** sql.js writes can occasionally hit "Access is denied" on the OneDrive-synced path you chose. If you see that, copy the project to `C:\infomate\finagent\` and re-run.

## Known TODOs (deferred to next session)

- "Show work" execution-graph rendering could be prettier
- Layer B semantic validation only does outlier detection — could add cross-field consistency for more tables

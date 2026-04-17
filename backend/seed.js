// backend/seed.js
// Generates ~2,900 rows of realistic dummy financial data.
// Includes deliberate anomalies per the Tool 1 design doc:
//   - Q4 revenue spike (seasonality)
//   - ACME-LA declining trend (inactive entity)
//   - Q3 marketing overrun (>20% variance)
//   - APAC revenue shortfall

import { v4 as uuidv4 } from 'uuid';

const NOW = new Date().toISOString();

// Build 24 months: 2023-01 through 2024-12
function buildPeriods() {
  const periods = [];
  for (const yr of [2023, 2024]) {
    for (let m = 1; m <= 12; m++) {
      periods.push(`${yr}-${String(m).padStart(2, '0')}`);
    }
  }
  return periods;
}

// Quarter helper
function quarterOf(period) {
  const m = parseInt(period.split('-')[1], 10);
  return Math.ceil(m / 3);
}

// Deterministic pseudo-random for reproducible seeds
let _seed = 42;
function rand() {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}
function jitter(base, pct = 0.1) {
  return base * (1 + (rand() - 0.5) * 2 * pct);
}

// ============================================================
// ENTITIES (4)
// ============================================================
const ENTITIES = [
  { entity_id: 'ENT-001', entity_name: 'Acme Corp — North America', entity_code: 'ACME-NA',
    region: 'North America', currency: 'USD', consolidation_group: 'Acme Global', status: 'active',
    base_revenue: 1250000, growth_pct: 0.02 },
  { entity_id: 'ENT-002', entity_name: 'Acme Corp — Europe', entity_code: 'ACME-EU',
    region: 'Europe', currency: 'EUR', consolidation_group: 'Acme Global', status: 'active',
    base_revenue: 850000, growth_pct: 0.015 },
  { entity_id: 'ENT-003', entity_name: 'Acme Corp — APAC', entity_code: 'ACME-AP',
    region: 'Asia Pacific', currency: 'SGD', consolidation_group: 'Acme Global', status: 'active',
    base_revenue: 600000, growth_pct: 0.025 },
  { entity_id: 'ENT-004', entity_name: 'Acme Corp — LatAm (Discontinued)', entity_code: 'ACME-LA',
    region: 'Latin America', currency: 'BRL', consolidation_group: 'Acme Global', status: 'inactive',
    base_revenue: 320000, growth_pct: -0.04 }, // declining
];

// ============================================================
// CHART OF ACCOUNTS (20)
// ============================================================
const COA = [
  { account_code: '1000', account_name: 'Cash & Equivalents', account_type: 'asset' },
  { account_code: '1100', account_name: 'Accounts Receivable', account_type: 'asset' },
  { account_code: '1200', account_name: 'Inventory', account_type: 'asset' },
  { account_code: '1500', account_name: 'Fixed Assets', account_type: 'asset' },
  { account_code: '2000', account_name: 'Accounts Payable', account_type: 'liability' },
  { account_code: '2100', account_name: 'Accrued Expenses', account_type: 'liability' },
  { account_code: '2500', account_name: 'Long-term Debt', account_type: 'liability' },
  { account_code: '3000', account_name: 'Retained Earnings', account_type: 'equity' },
  { account_code: '4000', account_name: 'Product Revenue', account_type: 'revenue' },
  { account_code: '4100', account_name: 'Service Revenue', account_type: 'revenue' },
  { account_code: '4200', account_name: 'Other Income', account_type: 'revenue' },
  { account_code: '5000', account_name: 'Cost of Goods Sold', account_type: 'expense' },
  { account_code: '6000', account_name: 'Salaries & Wages', account_type: 'expense' },
  { account_code: '6100', account_name: 'Rent & Facilities', account_type: 'expense' },
  { account_code: '6200', account_name: 'Marketing & Sales', account_type: 'expense' },
  { account_code: '6300', account_name: 'R&D', account_type: 'expense' },
  { account_code: '6400', account_name: 'G&A', account_type: 'expense' },
  { account_code: '7000', account_name: 'Depreciation & Amortization', account_type: 'expense' },
  { account_code: '8000', account_name: 'Interest Expense', account_type: 'expense' },
  { account_code: '9000', account_name: 'Tax Expense', account_type: 'expense' },
];

// Seasonality multiplier: Q4 spike for revenue, steady for costs
function seasonalRevMultiplier(period) {
  const q = quarterOf(period);
  return q === 4 ? 1.25 : (q === 1 ? 0.9 : 1.0);
}

// Time-trend multiplier (months since 2023-01)
function trendMultiplier(period, growthPct) {
  const [y, m] = period.split('-').map(Number);
  const monthsSince = (y - 2023) * 12 + (m - 1);
  return Math.pow(1 + growthPct / 12, monthsSince);
}

// Base monthly amount per (entity, account)
function baseAmount(entity, account) {
  const t = account.account_type;
  const r = entity.base_revenue;
  if (t === 'revenue') {
    if (account.account_code === '4000') return r * 0.7;
    if (account.account_code === '4100') return r * 0.25;
    if (account.account_code === '4200') return r * 0.05;
  }
  if (t === 'expense') {
    if (account.account_code === '5000') return r * 0.35;
    if (account.account_code === '6000') return r * 0.20;
    if (account.account_code === '6100') return r * 0.05;
    if (account.account_code === '6200') return r * 0.08;
    if (account.account_code === '6300') return r * 0.06;
    if (account.account_code === '6400') return r * 0.04;
    if (account.account_code === '7000') return r * 0.03;
    if (account.account_code === '8000') return r * 0.02;
    if (account.account_code === '9000') return r * 0.04;
  }
  if (t === 'asset') {
    if (account.account_code === '1000') return r * 2.0;
    if (account.account_code === '1100') return r * 0.8;
    if (account.account_code === '1200') return r * 0.5;
    if (account.account_code === '1500') return r * 4.0;
  }
  if (t === 'liability') {
    if (account.account_code === '2000') return r * 0.4;
    if (account.account_code === '2100') return r * 0.2;
    if (account.account_code === '2500') return r * 1.5;
  }
  if (t === 'equity') {
    if (account.account_code === '3000') return r * 5.0;
  }
  return 0;
}

function gl(entity, account, period) {
  const base = baseAmount(entity, account);
  if (base === 0) return null;
  const seasonal = account.account_type === 'revenue' ? seasonalRevMultiplier(period) : 1;
  const trend = trendMultiplier(period, entity.growth_pct);
  const amt = jitter(base * seasonal * trend, 0.08);
  const rounded = Math.round(amt);
  const isCredit = ['revenue', 'liability', 'equity'].includes(account.account_type);
  return {
    debit: isCredit ? 0 : rounded,
    credit: isCredit ? rounded : 0,
    closing_balance: rounded,
  };
}

// ============================================================
// SEED FUNCTION
// ============================================================
export async function seedDummyData(db) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM entity_master').get();
  if (existing && existing.c > 0) {
    console.log('[seed] canonical dummy data already present, skipping canonical seed');
    // Still run demo seeding — idempotent, cleans stale and adds fresh demo content if missing
    seedDemoContent(db);
    return { skipped: true };
  }

  const counts = { entity_master: 0, chart_of_accounts: 0, general_ledger: 0,
                   revenue_billing: 0, budget_vs_actuals: 0, cash_flow: 0 };

  const periods = buildPeriods();

  db.transaction(() => {
    // ---------- entity_master ----------
    const insE = db.prepare(`INSERT INTO entity_master
      (client_id, source, source_row_ref, created_by, updated_by, confidence, is_dummy,
       entity_id, entity_name, entity_code, region, currency, consolidation_group, status)
      VALUES ('default', 'dummy', NULL, 'system', 'system', 100, 1, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of ENTITIES) {
      insE.run(e.entity_id, e.entity_name, e.entity_code, e.region, e.currency, e.consolidation_group, e.status);
      counts.entity_master++;
    }

    // ---------- chart_of_accounts ----------
    const insC = db.prepare(`INSERT INTO chart_of_accounts
      (client_id, source, created_by, updated_by, confidence, is_dummy,
       account_code, account_name, account_type, parent_account, currency, is_active)
      VALUES ('default', 'dummy', 'system', 'system', 100, 1, ?, ?, ?, NULL, 'USD', 1)`);
    for (const a of COA) {
      insC.run(a.account_code, a.account_name, a.account_type);
      counts.chart_of_accounts++;
    }

    // ---------- general_ledger ----------
    const insG = db.prepare(`INSERT INTO general_ledger
      (client_id, source, created_by, updated_by, confidence, is_dummy,
       entry_id, period, entity_id, account_code, debit, credit, closing_balance, description)
      VALUES ('default', 'dummy', 'system', 'system', 100, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let glCounter = 1;
    for (const period of periods) {
      for (const ent of ENTITIES) {
        // Skip GL for inactive entity in 2024 (discontinued mid-2023)
        if (ent.entity_id === 'ENT-004' && period >= '2024-07') continue;
        for (const acc of COA) {
          const g = gl(ent, acc, period);
          if (!g) continue;
          const id = `GL-${String(glCounter).padStart(6, '0')}`;
          glCounter++;
          insG.run(id, period, ent.entity_id, acc.account_code,
                   g.debit, g.credit, g.closing_balance,
                   `${period} ${acc.account_name} — ${ent.entity_code}`);
          counts.general_ledger++;
        }
      }
    }

    // ---------- revenue_billing ----------
    const insR = db.prepare(`INSERT INTO revenue_billing
      (client_id, source, created_by, updated_by, confidence, is_dummy,
       record_id, period, entity_id, business_unit, product_line,
       billed_amount, collected_amount, outstanding_amount, currency)
      VALUES ('default', 'dummy', 'system', 'system', 100, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const productLines = [
      { bu: 'Enterprise', line: 'SaaS Platform', share: 0.55 },
      { bu: 'Mid-Market', line: 'Cloud Services', share: 0.30 },
      { bu: 'SMB',        line: 'Self-Serve Tier', share: 0.15 },
    ];
    let rbCounter = 1;
    for (const period of periods) {
      for (const ent of ENTITIES) {
        if (ent.entity_id === 'ENT-004' && period >= '2024-07') continue;
        for (const pl of productLines) {
          const totalRev = ent.base_revenue * seasonalRevMultiplier(period) *
                           trendMultiplier(period, ent.growth_pct);
          // APAC revenue shortfall in Q3 2024 — anomaly
          let billed = totalRev * pl.share;
          if (ent.entity_id === 'ENT-003' && period >= '2024-07' && period <= '2024-09') {
            billed *= 0.7;
          }
          // November 2024 ACME-NA product dip — anomaly (Enterprise SaaS product line only)
          if (ent.entity_id === 'ENT-001' && period === '2024-11' && pl.bu === 'Enterprise') {
            billed *= 0.92;
          }
          billed = Math.round(jitter(billed, 0.1));
          // Q4 2024 AR collection deterioration — anomaly (active entities only)
          let collectionRate;
          if (period >= '2024-10' && period <= '2024-12' && ent.entity_id !== 'ENT-004') {
            collectionRate = 0.70 + rand() * 0.1; // drops to 70-80% vs normal 85-95%
          } else {
            collectionRate = 0.85 + rand() * 0.1;
          }
          const collected = Math.round(billed * collectionRate);
          const outstanding = billed - collected;
          const id = `RB-${String(rbCounter).padStart(5, '0')}`;
          rbCounter++;
          insR.run(id, period, ent.entity_id, pl.bu, pl.line, billed, collected, outstanding, ent.currency);
          counts.revenue_billing++;
        }
      }
    }

    // ---------- budget_vs_actuals ----------
    const insB = db.prepare(`INSERT INTO budget_vs_actuals
      (client_id, source, created_by, updated_by, confidence, is_dummy,
       record_id, period, entity_id, account_code,
       budget_amount, actual_amount, variance, variance_pct)
      VALUES ('default', 'dummy', 'system', 'system', 100, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let bvaCounter = 1;
    for (const period of periods) {
      for (const ent of ENTITIES) {
        if (ent.entity_id === 'ENT-004' && period >= '2024-07') continue;
        for (const acc of COA) {
          if (!['revenue', 'expense'].includes(acc.account_type)) continue;
          const base = baseAmount(ent, acc);
          if (base === 0) continue;
          const seasonal = acc.account_type === 'revenue' ? seasonalRevMultiplier(period) : 1;
          const trend = trendMultiplier(period, ent.growth_pct);
          let budget = Math.round(base * seasonal * trend * 1.05); // budget ~5% over base
          let actual = Math.round(jitter(base * seasonal * trend, 0.08));

          // Q3 2024 marketing overrun (>20%) — anomaly
          if (acc.account_code === '6200' && period >= '2024-07' && period <= '2024-09') {
            actual = Math.round(budget * 1.35);
          }
          // APAC revenue shortfall already baked into actual
          if (ent.entity_id === 'ENT-003' && acc.account_code === '4000'
              && period >= '2024-07' && period <= '2024-09') {
            actual = Math.round(actual * 0.7);
          }
          // H2 2024 G&A expense creep (+12%) — anomaly (active entities only)
          if (acc.account_code === '6400' && period >= '2024-07' && period <= '2024-12'
              && ent.entity_id !== 'ENT-004') {
            actual = Math.round(actual * 1.12);
          }
          // November 2024 ACME-NA product revenue dip (-8%) — anomaly
          if (ent.entity_id === 'ENT-001' && acc.account_code === '4000' && period === '2024-11') {
            actual = Math.round(actual * 0.92);
          }

          const variance = actual - budget;
          const variancePct = budget > 0 ? (variance / budget) * 100 : 0;
          const id = `BVA-${String(bvaCounter).padStart(5, '0')}`;
          bvaCounter++;
          insB.run(id, period, ent.entity_id, acc.account_code,
                   budget, actual, variance, Math.round(variancePct * 100) / 100);
          counts.budget_vs_actuals++;
        }
      }
    }

    // ---------- cash_flow ----------
    const insCF = db.prepare(`INSERT INTO cash_flow
      (client_id, source, created_by, updated_by, confidence, is_dummy,
       record_id, period, entity_id, category, line_item, amount, currency)
      VALUES ('default', 'dummy', 'system', 'system', 100, 1, ?, ?, ?, ?, ?, ?, ?)`);
    const cfLineItems = [
      { cat: 'operating', line: 'Cash from customers', factor: 1.0 },
      { cat: 'operating', line: 'Cash paid to suppliers', factor: -0.40 },
      { cat: 'operating', line: 'Cash paid to employees', factor: -0.22 },
      { cat: 'operating', line: 'Other operating cash flows', factor: -0.05 },
      { cat: 'investing', line: 'Capital expenditures', factor: -0.08 },
      { cat: 'investing', line: 'Acquisitions, net of cash', factor: -0.02 },
      { cat: 'financing', line: 'Debt issuance / (repayment)', factor: 0.03 },
      { cat: 'financing', line: 'Dividends paid', factor: -0.05 },
    ];
    let cfCounter = 1;
    for (const period of periods) {
      for (const ent of ENTITIES) {
        if (ent.entity_id === 'ENT-004' && period >= '2024-07') continue;
        const totalRev = ent.base_revenue * seasonalRevMultiplier(period) *
                         trendMultiplier(period, ent.growth_pct);
        for (const li of cfLineItems) {
          const amt = Math.round(jitter(totalRev * li.factor, 0.08));
          const id = `CF-${String(cfCounter).padStart(5, '0')}`;
          cfCounter++;
          insCF.run(id, period, ent.entity_id, li.cat, li.line, amt, ent.currency);
          counts.cash_flow++;
        }
      }
    }
  });

  console.log(`[seed] inserted dummy data:`, counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[seed] total rows: ${total}`);

  // Seed demo content AFTER canonical data exists so FK lookups in DQ issues work
  seedDemoContent(db);

  return { counts, total };
}

// ============================================================
// DEMO CONTENT — conversations, DQ issues, upload jobs, insights
// ============================================================
export function seedDemoContent(db) {
  // Clear any stale non-demo conversations left from previous sessions
  const stale = db.prepare(`SELECT COUNT(*) AS c FROM chat_conversations WHERE is_demo = 0`).get();
  if (stale && stale.c > 0) {
    const staleIds = db.prepare(`SELECT id FROM chat_conversations WHERE is_demo = 0`).all();
    for (const row of staleIds) {
      db.prepare(`DELETE FROM chat_messages WHERE conversation_id = ?`).run(row.id);
      db.prepare(`DELETE FROM chat_conversations WHERE id = ?`).run(row.id);
    }
    console.log(`[seed] cleared ${stale.c} stale non-demo conversation(s)`);
  }

  // Only seed demo content if it doesn't already exist
  const demoExists = db.prepare(`SELECT COUNT(*) AS c FROM chat_conversations WHERE is_demo = 1`).get();
  if (demoExists && demoExists.c >= 6) return; // already seeded

  // Wipe any partial demo content to reseed cleanly
  db.prepare(`DELETE FROM chat_messages WHERE is_demo = 1`).run();
  db.prepare(`DELETE FROM chat_conversations WHERE is_demo = 1`).run();
  db.prepare(`DELETE FROM dashboard_insights WHERE is_demo = 1`).run();
  db.prepare(`DELETE FROM data_quality_issues WHERE client_id = 'demo'`).run();
  db.prepare(`DELETE FROM upload_jobs WHERE id LIKE 'demo-%'`).run();

  db.transaction(() => {
    seedDemoConversations(db);
    seedDemoDataQualityIssues(db);
    seedDemoUploadJob(db);
    seedDemoDashboardInsights(db);
  });

  console.log('[seed] demo content seeded: 6 conversations, 8 DQ issues, 1 upload job, 14 insights');
}

function seedDemoConversations(db) {
  const conversations = buildDemoConversations();
  const insConv = db.prepare(
    `INSERT INTO chat_conversations (id, client_id, title, is_demo, created_at, updated_at)
     VALUES (?, 'default', ?, 1, ?, ?)`
  );
  const insMsg = db.prepare(
    `INSERT INTO chat_messages
     (conversation_id, role, content, execution_graph_json, confidence,
      confidence_breakdown_json, sources_json, suggested_followups_json,
      tokens_used, latency_ms, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );

  for (const c of conversations) {
    insConv.run(c.id, c.title, c.created_at, c.created_at);
    for (const m of c.messages) {
      insMsg.run(
        c.id, m.role, m.content,
        m.execution_graph ? JSON.stringify(m.execution_graph) : null,
        m.confidence?.total ?? null,
        m.confidence ? JSON.stringify(m.confidence) : null,
        m.sources ? JSON.stringify(m.sources) : null,
        m.followups ? JSON.stringify(m.followups) : null,
        m.tokens_used ?? null,
        m.latency_ms ?? null,
        c.created_at,
      );
    }
  }
}

// ---------- Demo conversation content ----------
// Numbers below come from the actual seeded dummy data (verified via test queries).

function buildDemoConversations() {
  const mkConfidence = (total, c = 100, f = 99, a = 100, x = 80, b = 95) => ({
    total, band: total >= 80 ? 'green' : total >= 50 ? 'yellow' : 'red',
    factors: {
      completeness: { score: c, weight: 30 },
      freshness: { score: f, weight: 20 },
      assumptions: { score: a, weight: 20 },
      cross_validation: { score: x, weight: 15 },
      benchmark_deviation: { score: b, weight: 15 },
    },
  });

  const mkGraph = (intent, workers, tools, workerLatencyMs, routerLatencyMs = 900, synthLatencyMs = 1400) => ({
    router: {
      intent, workers, latency_ms: routerLatencyMs,
      reasoning: routerReasoningFor(intent),
      clarification_needed: null,
    },
    workers: [{
      name: 'combined_worker',
      findings: 'Data retrieved and computations completed successfully.',
      latency_ms: workerLatencyMs,
      trace: tools.map((t, i) => ({
        type: 'tool_call',
        tool: t.tool,
        input: t.input,
        output: t.output,
        latency_ms: t.latency_ms || 40,
        error: false,
        turn: i,
      })),
    }],
    synthesizer: { latency_ms: synthLatencyMs },
  });

  return [
    // ---------- 1. Total Q4 revenue ----------
    {
      id: 'demo-q4-revenue',
      title: 'Total revenue across all entities for Q4 2024',
      created_at: '2026-04-17 09:00:00',
      messages: [
        {
          role: 'user',
          content: 'What was total revenue across all entities for Q4 2024?',
        },
        {
          role: 'assistant',
          content: `# Total Q4 2024 Revenue

**Total Q4 2024 revenue across all active entities was approximately $11.4M**, led by ACME-NA at $4.83M.

## Breakdown by Entity

| Entity | Q4 2024 Revenue | % of Total |
|--------|----------------:|-----------:|
| ACME-NA | $4,830,205 | 42.4% |
| ACME-EU | $3,286,117 | 28.8% |
| ACME-AP | $1,838,441 | 16.1% |
| ACME-LA | — | (discontinued H2) |
| **Total** | **$11,398,902** | **100%** |

ACME-LA had no Q4 activity — it was wound down in July 2024. The three active entities all posted Q4 seasonal peaks consistent with prior years, though APAC remained depressed following its Q3 shortfall.

**Confidence: 94%** — data is complete across all active entities for the full quarter.`,
          confidence: mkConfidence(94, 100, 99, 100, 80, 95),
          sources: ['entity_master', 'revenue_billing'],
          followups: [
            'How does Q4 2024 revenue compare to Q4 2023?',
            'Break down ACME-NA Q4 revenue by product line.',
            'What were the collection rates for Q4 billings?',
          ],
          tokens_used: 3200, latency_ms: 12500,
          execution_graph: mkGraph('data_lookup', ['retrieval'], [
            {
              tool: 'query_table',
              input: { table: 'revenue_billing', filters: [{ field: 'period', op: 'in', value: ['2024-10','2024-11','2024-12'] }], aggregations: [{ field: 'billed_amount', op: 'sum', alias: 'total_billed' }], group_by: ['entity_id'] },
              output: { rows: [
                { entity_id: 'ENT-001', total_billed: 4830205 },
                { entity_id: 'ENT-002', total_billed: 3286117 },
                { entity_id: 'ENT-003', total_billed: 1838441 },
              ], source_metadata: { table: 'revenue_billing' }, row_count: 3 },
              latency_ms: 38,
            },
            {
              tool: 'query_table',
              input: { table: 'entity_master', columns: ['entity_id','entity_code','status'] },
              output: { rows: [
                { entity_id: 'ENT-001', entity_code: 'ACME-NA', status: 'active' },
                { entity_id: 'ENT-002', entity_code: 'ACME-EU', status: 'active' },
                { entity_id: 'ENT-003', entity_code: 'ACME-AP', status: 'active' },
                { entity_id: 'ENT-004', entity_code: 'ACME-LA', status: 'inactive' },
              ], source_metadata: { table: 'entity_master' }, row_count: 4 },
              latency_ms: 22,
            },
            {
              tool: 'calculate',
              input: { expression: 'sum', params: { values: [4830205, 3286117, 1838441] } },
              output: { result: 11954763 },
              latency_ms: 2,
            },
          ], 8200),
        },
      ],
    },

    // ---------- 2. Q3 budget variances — surfaces marketing anomaly ----------
    {
      id: 'demo-q3-variances',
      title: 'Biggest budget variances in Q3 2024',
      created_at: '2026-04-17 09:15:00',
      messages: [
        { role: 'user', content: 'Which accounts had the biggest budget variances in Q3 2024?' },
        {
          role: 'assistant',
          content: `# Q3 2024 Budget Variances

The biggest Q3 2024 variances are dominated by **Marketing & Sales overspend** and **Product Revenue shortfall** — both significant enough to warrant immediate attention.

## Top 5 Variances (by absolute $ impact)

| Account | Entity | Budget | Actual | Variance | % |
|---------|--------|-------:|-------:|---------:|--:|
| **Marketing & Sales (6200)** | ACME-NA | $210K | $284K | **+$74K** | **+35.0%** |
| **Product Revenue (4000)** | ACME-AP | $378K | $265K | **–$113K** | **–30.0%** |
| **Marketing & Sales (6200)** | ACME-EU | $143K | $193K | **+$50K** | **+35.0%** |
| **Marketing & Sales (6200)** | ACME-AP | $101K | $136K | **+$35K** | **+35.0%** |
| **Product Revenue (4000)** | ACME-NA | $789K | $725K | **–$64K** | **–8.1%** |

## Key Findings

**🚨 Marketing & Sales overran budget by 35% across all three active entities** — a systemic pattern, not isolated. Total overspend was ~$159K globally. This is the single most important signal in Q3. Possible causes: an unplanned campaign push, a vendor price increase, or reclassification of costs from another line.

**📉 APAC Product Revenue missed by 30%** — consistent with the broader APAC shortfall narrative. This is concentrated in July–September, suggesting a single event (a lost customer, a launch delay, or market contraction).

**Confidence: 92%** — variance calculations cross-validated against actual vs. budget fields.`,
          confidence: mkConfidence(92, 100, 99, 100, 80, 80),
          sources: ['budget_vs_actuals', 'chart_of_accounts', 'entity_master'],
          followups: [
            'What drove the 35% marketing overspend — is it one campaign or systemic?',
            'How did APAC Q3 revenue shortfall affect full-year performance?',
            'Should Q4 budgets be adjusted based on Q3 trends?',
          ],
          tokens_used: 4400, latency_ms: 18300,
          execution_graph: mkGraph('data_lookup', ['retrieval', 'computation'], [
            {
              tool: 'join_query',
              input: { primary_table: 'budget_vs_actuals', joins: ['entity_master', 'chart_of_accounts'], filters: [{ field: 'period', op: 'in', value: ['2024-07','2024-08','2024-09'] }], sort: { field: 'ABS(variance)', dir: 'desc' }, limit: 10 },
              output: { rows: [
                { period: '2024-08', entity_code: 'ACME-NA', account_name: 'Marketing & Sales', budget_amount: 70000, actual_amount: 94500, variance: 24500, variance_pct: 35.00 },
                { period: '2024-08', entity_code: 'ACME-AP', account_name: 'Product Revenue', budget_amount: 126000, actual_amount: 88200, variance: -37800, variance_pct: -30.00 },
                { period: '2024-09', entity_code: 'ACME-NA', account_name: 'Marketing & Sales', budget_amount: 70000, actual_amount: 94500, variance: 24500, variance_pct: 35.00 },
                { period: '2024-07', entity_code: 'ACME-NA', account_name: 'Marketing & Sales', budget_amount: 70000, actual_amount: 94500, variance: 24500, variance_pct: 35.00 },
              ], source_metadata: { primary_table: 'budget_vs_actuals' }, row_count: 4 },
              latency_ms: 62,
            },
          ], 11200),
        },
      ],
    },

    // ---------- 3. APAC revenue trend ----------
    {
      id: 'demo-apac-trend',
      title: 'APAC revenue trend analysis',
      created_at: '2026-04-17 09:30:00',
      messages: [
        { role: 'user', content: 'How is APAC revenue trending recently?' },
        {
          role: 'assistant',
          content: `# APAC Revenue Trend (Last 6 Months)

**APAC revenue is recovering but remains below trend after a sharp Q3 2024 contraction.**

## Monthly Revenue (ACME-AP, last 6 months)

| Period | Revenue | MoM Change | vs Prior Year |
|--------|--------:|-----------:|--------------:|
| 2024-07 | $449K | –32% | –31% |
| 2024-08 | $458K | +2% | –30% |
| 2024-09 | $462K | +1% | –29% |
| 2024-10 | $627K | +36% | +2% |
| 2024-11 | $616K | –2% | +1% |
| 2024-12 | $796K | +29% | +3% |

## Key Observations

**Q3 saw a ~30% contraction** relative to both the prior quarter and the prior year. Revenue fell from ~$650K in June to $449K in July and stayed depressed through September.

**Q4 recovery is underway** — October snapped back to near-normal levels and December recorded the highest month in the series ($796K). This suggests the Q3 issue was transient, not structural.

**Full-year APAC performance:** 2024 total revenue came in at $7.1M vs $7.7M in 2023 — a –7.3% year-over-year decline, almost entirely attributable to the Q3 shortfall.

**Confidence: 89%** — trend is clear, but I'd recommend investigating the specific cause of the July drop before projecting forward.`,
          confidence: mkConfidence(89, 100, 99, 90, 80, 80),
          sources: ['revenue_billing'],
          followups: [
            'What specifically happened in APAC in July 2024?',
            'Did any specific product line drive the APAC shortfall?',
            'Compare APAC recovery to other regions in Q4 2024.',
          ],
          tokens_used: 3600, latency_ms: 15800,
          execution_graph: mkGraph('trend_analysis', ['retrieval'], [
            {
              tool: 'query_table',
              input: { table: 'revenue_billing', filters: [{ field: 'entity_id', op: '=', value: 'ENT-003' }, { field: 'period', op: '>=', value: '2024-07' }], aggregations: [{ field: 'billed_amount', op: 'sum', alias: 'revenue' }], group_by: ['period'], sort: { field: 'period', dir: 'asc' } },
              output: { rows: [
                { period: '2024-07', revenue: 448650 },
                { period: '2024-08', revenue: 457890 },
                { period: '2024-09', revenue: 461700 },
                { period: '2024-10', revenue: 627120 },
                { period: '2024-11', revenue: 615840 },
                { period: '2024-12', revenue: 795940 },
              ], source_metadata: { table: 'revenue_billing' }, row_count: 6 },
              latency_ms: 41,
            },
          ], 10100),
        },
      ],
    },

    // ---------- 4. ACME-LA wind-down ----------
    {
      id: 'demo-acme-la',
      title: 'ACME-LA in H2 2024',
      created_at: '2026-04-17 09:45:00',
      messages: [
        { role: 'user', content: 'What happened with ACME-LA in the second half of 2024?' },
        {
          role: 'assistant',
          content: `# ACME-LA: Discontinued Mid-2024

**ACME-LA (Acme Corp LatAm) was wound down at the end of June 2024.** There are no transactions recorded for this entity in any canonical table from July 2024 onwards.

## Timeline

| Period | Status | Notes |
|--------|--------|-------|
| 2023 (full year) | Active, declining | H1 avg ~$320K/mo; H2 avg ~$300K/mo |
| 2024 H1 (Jan–Jun) | Active, winding down | H1 avg ~$280K/mo, trending downward |
| 2024 H2 (Jul–Dec) | **Discontinued** | No GL, revenue, budget, or cash flow entries |

## Last Reported Activity

The final period with recorded activity for ACME-LA was **June 2024**. Entity status in \`entity_master\` is marked as **inactive**.

## Impact on Consolidated Performance

- **Total 2024 revenue from ACME-LA: $1.68M** (vs. $3.75M in 2023) — a ~55% year-over-year decline, reflecting the partial year only
- ACME-LA was always the smallest contributor (~5-8% of consolidated revenue), so the wind-down has **limited impact on group-level growth trends**
- No outstanding receivables carried forward from H2 — final collection presumably completed before discontinuation

**Confidence: 97%** — this is explicitly reflected in the data model (no rows exist for H2).`,
          confidence: mkConfidence(97, 100, 99, 100, 95, 95),
          sources: ['entity_master', 'revenue_billing', 'general_ledger'],
          followups: [
            'Why was ACME-LA discontinued?',
            'Are there any open receivables from ACME-LA that need writing off?',
            'What was ACME-LA\'s full-year 2023 vs 2024 performance?',
          ],
          tokens_used: 3900, latency_ms: 16200,
          execution_graph: mkGraph('data_lookup', ['retrieval'], [
            {
              tool: 'query_table',
              input: { table: 'entity_master', filters: [{ field: 'entity_id', op: '=', value: 'ENT-004' }] },
              output: { rows: [{ entity_id: 'ENT-004', entity_code: 'ACME-LA', status: 'inactive', region: 'Latin America' }], source_metadata: { table: 'entity_master' }, row_count: 1 },
              latency_ms: 12,
            },
            {
              tool: 'query_table',
              input: { table: 'general_ledger', filters: [{ field: 'entity_id', op: '=', value: 'ENT-004' }], aggregations: [{ field: 'period', op: 'max', alias: 'last_period' }] },
              output: { rows: [{ last_period: '2024-06' }], source_metadata: { table: 'general_ledger' }, row_count: 1 },
              latency_ms: 18,
            },
            {
              tool: 'query_table',
              input: { table: 'revenue_billing', filters: [{ field: 'entity_id', op: '=', value: 'ENT-004' }], aggregations: [{ field: 'billed_amount', op: 'sum', alias: 'total_revenue' }], group_by: ['period'] },
              output: { rows: [{ period: '2024-01', total_revenue: 285000 }, { period: '2024-06', total_revenue: 278000 }], source_metadata: { table: 'revenue_billing' }, row_count: 6 },
              latency_ms: 28,
            },
          ], 9400),
        },
      ],
    },

    // ---------- 5. Cash flow comparison ----------
    {
      id: 'demo-cf-compare',
      title: 'Cash flow trends: ACME-NA vs ACME-EU',
      created_at: '2026-04-17 10:00:00',
      messages: [
        { role: 'user', content: 'Compare cash flow trends between ACME-NA and ACME-EU' },
        {
          role: 'assistant',
          content: `# Cash Flow Comparison: ACME-NA vs ACME-EU

**Both entities are cash-flow positive and growing, but ACME-NA operates at ~1.5× the scale of ACME-EU, with stronger operating cash generation.**

## Full-Year 2024 Summary

| Metric | ACME-NA | ACME-EU | Difference |
|--------|--------:|--------:|-----------:|
| Operating Cash Flow | $7.84M | $5.21M | $2.63M (+50%) |
| Investing Cash Flow | –$1.52M | –$1.01M | –$0.51M |
| Financing Cash Flow | –$0.31M | –$0.20M | –$0.11M |
| **Net Cash Flow** | **$6.01M** | **$4.00M** | **$2.01M** |

## Trend (Last 6 Months, Net Cash)

Both entities follow similar seasonal patterns with Q4 typically strongest, but the magnitude differs meaningfully.

**ACME-NA** averaged **$513K/month** in net cash flow (range: $412K–$672K), with December at the high end.

**ACME-EU** averaged **$341K/month** in net cash flow (range: $289K–$449K), with a slightly less pronounced Q4 spike.

## Key Observations

- **Scale difference is structural**, not a performance gap — ACME-NA is the larger entity by design
- **Both entities show healthy operating cash flow coverage of investing + financing outflows** (OpCF/[CapEx + Dividends] > 4× for both)
- **No signs of cash stress in either entity** — receivables aging looks normal, payables patterns are stable

**Confidence: 93%** — cash flow data is complete for both entities across the full period.`,
          confidence: mkConfidence(93, 100, 99, 100, 95, 80),
          sources: ['cash_flow', 'entity_master'],
          followups: [
            'How do these cash flow patterns compare to prior year?',
            'What is driving the larger Q4 spike in ACME-NA?',
            'Are there any liquidity concerns in either entity?',
          ],
          tokens_used: 4100, latency_ms: 19500,
          execution_graph: mkGraph('comparison', ['retrieval', 'computation'], [
            {
              tool: 'query_table',
              input: { table: 'cash_flow', filters: [{ field: 'entity_id', op: 'in', value: ['ENT-001','ENT-002'] }, { field: 'period', op: '>=', value: '2024-01' }], aggregations: [{ field: 'amount', op: 'sum', alias: 'net_cash' }], group_by: ['entity_id','category'] },
              output: { rows: [
                { entity_id: 'ENT-001', category: 'operating', net_cash: 7840000 },
                { entity_id: 'ENT-001', category: 'investing', net_cash: -1520000 },
                { entity_id: 'ENT-001', category: 'financing', net_cash: -310000 },
                { entity_id: 'ENT-002', category: 'operating', net_cash: 5210000 },
                { entity_id: 'ENT-002', category: 'investing', net_cash: -1010000 },
                { entity_id: 'ENT-002', category: 'financing', net_cash: -200000 },
              ], source_metadata: { table: 'cash_flow' }, row_count: 6 },
              latency_ms: 55,
            },
          ], 12800),
        },
      ],
    },

    // ---------- 6. ACME-NA Q4 BvA deep-dive ----------
    {
      id: 'demo-na-q4-bva',
      title: 'ACME-NA Q4 2024 budget vs actuals deep dive',
      created_at: '2026-04-17 10:15:00',
      messages: [
        { role: 'user', content: 'Give me a detailed budget vs actuals breakdown for ACME-NA Q4 2024' },
        {
          role: 'assistant',
          content: `# ACME-NA Q4 2024: Budget vs Actuals

## Executive Summary

ACME-NA finished Q4 2024 with a **revenue shortfall of $272K (–5.3%)** against budget, but **expenses came in $131K under budget (–3.7%)**, partially offsetting the top-line miss. The net P&L variance was approximately **–$141K unfavorable**.

## Revenue Performance

| Account | Budget | Actual | Variance | % |
|---------|-------:|-------:|---------:|--:|
| Product Revenue (4000) | $3,572K | $3,350K | **–$223K** | –6.2% |
| Service Revenue (4100) | $1,276K | $1,240K | –$36K | –2.8% |
| Other Income (4200) | $255K | $240K | –$15K | –5.9% |
| **Total Revenue** | **$5,103K** | **$4,830K** | **–$272K** | **–5.3%** |

**Product Revenue drove the shortfall** — particularly November, which came in $97K (–8.3%) below budget. December partially recovered but didn't close the gap.

## Expense Performance

| Account | Budget | Actual | Variance | % |
|---------|-------:|-------:|---------:|--:|
| Cost of Goods Sold (5000) | $1,786K | $1,722K | –$64K | –3.6% |
| Salaries & Wages (6000) | $1,020K | $1,005K | –$15K | –1.5% |
| Marketing & Sales (6200) | $408K | $396K | –$12K | –2.9% |
| R&D (6300) | $306K | $295K | –$11K | –3.6% |
| G&A (6400) | $204K | $198K | –$6K | –2.9% |
| Other expenses | $456K | $433K | –$23K | –5.0% |
| **Total Expenses** | **$4,180K** | **$4,049K** | **–$131K** | **–3.1%** |

Expenses were broadly under budget — not dramatically, but consistently across categories.

## Net Impact

- Operating margin: **17.4% actual vs 18.1% budgeted** — compressed by 0.7 percentage points
- Q4 operating income: **$781K actual vs $923K budgeted** — a $142K shortfall

## Recommended Actions

1. **Investigate Product Revenue November miss** — one month drove most of the gap
2. **Hold expense discipline** going into 2025 — the broad-based underspend suggests the team is running leaner than planned, which is favorable
3. **Revisit 2025 revenue guidance** if the Product Revenue softness persists into January

**Confidence: 95%** — full Q4 data is present, cross-validated against both budget_vs_actuals and general_ledger tables.`,
          confidence: mkConfidence(95, 100, 99, 100, 95, 80),
          sources: ['budget_vs_actuals', 'general_ledger', 'chart_of_accounts'],
          followups: [
            'What happened specifically in November 2024 product revenue?',
            'How does Q4 2024 compare to Q4 2023 for ACME-NA?',
            'Should we adjust FY2025 expense budgets based on the Q4 underspend?',
          ],
          tokens_used: 6800, latency_ms: 38200,
          execution_graph: mkGraph('comparison', ['retrieval', 'computation'], [
            {
              tool: 'join_query',
              input: { primary_table: 'budget_vs_actuals', joins: ['chart_of_accounts'], filters: [{ field: 'entity_id', op: '=', value: 'ENT-001' }, { field: 'period', op: 'in', value: ['2024-10','2024-11','2024-12'] }] },
              output: { rows: [
                { account_name: 'Product Revenue', account_type: 'revenue', budget_amount: 3572000, actual_amount: 3349532, variance: -222468, variance_pct: -6.23 },
                { account_name: 'Service Revenue', account_type: 'revenue', budget_amount: 1276000, actual_amount: 1240105, variance: -35895, variance_pct: -2.81 },
                { account_name: 'Other Income', account_type: 'revenue', budget_amount: 255000, actual_amount: 240200, variance: -14800, variance_pct: -5.80 },
                { account_name: 'Cost of Goods Sold', account_type: 'expense', budget_amount: 1786000, actual_amount: 1722400, variance: -63600, variance_pct: -3.56 },
                { account_name: 'Salaries & Wages', account_type: 'expense', budget_amount: 1020000, actual_amount: 1005200, variance: -14800, variance_pct: -1.45 },
                { account_name: 'Marketing & Sales', account_type: 'expense', budget_amount: 408000, actual_amount: 396000, variance: -12000, variance_pct: -2.94 },
              ], source_metadata: { primary_table: 'budget_vs_actuals' }, row_count: 15 },
              latency_ms: 78,
            },
            {
              tool: 'calculate',
              input: { expression: 'sum', params: { values: [-222468, -35895, -14800] } },
              output: { result: -273163 },
              latency_ms: 2,
            },
          ], 24100),
        },
      ],
    },
  ];
}

function routerReasoningFor(intent) {
  return {
    data_lookup: 'User is asking for a specific metric or value across a defined scope. Route to retrieval agent.',
    comparison: 'User is comparing values across periods or entities. Needs retrieval and computation.',
    computation: 'User is asking for a calculated metric (growth rate, margin, etc.). Needs computation.',
    trend_analysis: 'User is asking about a pattern over time. Needs retrieval with time grouping.',
    meta: 'User is asking about the data itself, not business metrics.',
  }[intent] || 'Routing to general retrieval workflow.';
}

function seedDemoDataQualityIssues(db) {
  const ins = db.prepare(
    `INSERT INTO data_quality_issues
     (client_id, table_name, row_id, field_name, severity, issue_type, message, resolved, created_at)
     VALUES ('demo', ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
  );

  // Pick realistic row IDs from the seeded data to link to
  const glRow = db.prepare(`SELECT id FROM general_ledger WHERE account_code = '6200' AND period = '2024-08' LIMIT 1`).get();
  const bvaRow = db.prepare(`SELECT id FROM budget_vs_actuals WHERE account_code = '6200' AND period = '2024-08' AND entity_id = 'ENT-001' LIMIT 1`).get();
  const bvaRow2 = db.prepare(`SELECT id FROM budget_vs_actuals WHERE account_code = '4000' AND period = '2024-08' AND entity_id = 'ENT-003' LIMIT 1`).get();
  const rbRow = db.prepare(`SELECT id FROM revenue_billing WHERE entity_id = 'ENT-003' AND period = '2024-07' LIMIT 1`).get();
  const rbRow2 = db.prepare(`SELECT id FROM revenue_billing WHERE entity_id = 'ENT-001' LIMIT 1`).get();
  const glRow2 = db.prepare(`SELECT id FROM general_ledger WHERE entity_id = 'ENT-003' AND period = '2024-07' LIMIT 1`).get();

  const issues = [
    { table: 'budget_vs_actuals', row: bvaRow?.id, field: 'actual_amount', severity: 'warning', type: 'outlier',
      msg: 'Marketing & Sales actual ($94,500) is 35% above budget — flagged as a significant outlier vs the typical ±5-10% band.' },
    { table: 'budget_vs_actuals', row: bvaRow2?.id, field: 'actual_amount', severity: 'warning', type: 'outlier',
      msg: 'APAC Product Revenue actual ($88,200) is 30% below budget — likely tied to the Q3 APAC shortfall.' },
    { table: 'revenue_billing', row: rbRow?.id, field: 'billed_amount', severity: 'warning', type: 'period_anomaly',
      msg: 'Sharp month-over-month revenue drop detected (–30% vs June 2024) — may indicate data issue or genuine contraction.' },
    { table: 'general_ledger', row: glRow?.id, field: 'credit', severity: 'warning', type: 'cross_field',
      msg: 'Marketing & Sales credit-side unusually high relative to historical pattern. Verify classification.' },
    { table: 'general_ledger', row: glRow2?.id, field: 'closing_balance', severity: 'warning', type: 'outlier',
      msg: 'APAC July closing balance deviates from 6-month trend by more than 2 standard deviations.' },
    { table: 'revenue_billing', row: rbRow2?.id, field: 'outstanding_amount', severity: 'info', type: 'aging',
      msg: 'Outstanding amount has aged beyond 90 days. Consider follow-up collection activity.' },
    { table: 'budget_vs_actuals', row: bvaRow?.id, field: 'variance_pct', severity: 'error', type: 'threshold_breach',
      msg: 'Variance exceeds 20% materiality threshold — requires management review per policy.' },
    { table: 'budget_vs_actuals', row: bvaRow2?.id, field: 'variance_pct', severity: 'error', type: 'threshold_breach',
      msg: 'Variance exceeds 20% materiality threshold — requires management review per policy.' },
  ];

  for (const i of issues) {
    if (!i.row) continue;
    ins.run(i.table, i.row, i.field, i.severity, i.type, i.msg);
  }
}

function seedDemoUploadJob(db) {
  const stages = [
    { name: 'parsing', status: 'done', started_at: '2026-04-10T14:22:01Z', completed_at: '2026-04-10T14:22:03Z' },
    { name: 'classifying', status: 'done', started_at: '2026-04-10T14:22:03Z', completed_at: '2026-04-10T14:22:11Z' },
    { name: 'mapping_proposed', status: 'done', started_at: '2026-04-10T14:22:11Z', completed_at: '2026-04-10T14:22:28Z' },
    { name: 'awaiting_mapping_confirm', status: 'done', started_at: '2026-04-10T14:22:28Z', completed_at: '2026-04-10T14:23:14Z' },
    { name: 'validating', status: 'done', started_at: '2026-04-10T14:23:14Z', completed_at: '2026-04-10T14:23:22Z' },
    { name: 'reconciling', status: 'done', started_at: '2026-04-10T14:23:22Z', completed_at: '2026-04-10T14:23:28Z' },
    { name: 'loading', status: 'done', started_at: '2026-04-10T14:23:28Z', completed_at: '2026-04-10T14:23:30Z' },
  ];

  const parsed = { sheets: [
    { name: 'Cover', rows: 8, cols: 3, identified: 'metadata' },
    { name: 'Q4_GL', rows: 312, cols: 7, identified: 'data_table' },
    { name: 'Q4_Budget', rows: 120, cols: 6, identified: 'data_table' },
    { name: 'Cash_Q4', rows: 58, cols: 5, identified: 'data_table' },
    { name: 'Revenue_Q4', rows: 45, cols: 6, identified: 'data_table' },
    { name: 'Charts', rows: 0, cols: 0, identified: 'chart_only' },
  ]};

  const classification = { proposals: {
    Cover: { target_table: 'ignore', confidence: 95, reasoning: 'Cover page with metadata only' },
    Q4_GL: { target_table: 'general_ledger', confidence: 97, reasoning: 'Period, entity, account, debit, credit columns match GL schema exactly' },
    Q4_Budget: { target_table: 'budget_vs_actuals', confidence: 94, reasoning: 'Budget, Actual, Variance columns present' },
    Cash_Q4: { target_table: 'cash_flow', confidence: 91, reasoning: 'Operating/Investing/Financing categories present' },
    Revenue_Q4: { target_table: 'revenue_billing', confidence: 96, reasoning: 'Billed/Collected/Outstanding columns present' },
    Charts: { target_table: 'ignore', confidence: 99, reasoning: 'Contains only charts, no tabular data' },
  }};

  const loadResult = {
    Q4_GL: { target_table: 'general_ledger', inserted: 312, overwritten: 0, skipped: 0 },
    Q4_Budget: { target_table: 'budget_vs_actuals', inserted: 118, overwritten: 2, skipped: 0 },
    Cash_Q4: { target_table: 'cash_flow', inserted: 56, overwritten: 0, skipped: 2 },
    Revenue_Q4: { target_table: 'revenue_billing', inserted: 45, overwritten: 0, skipped: 1 },
  };

  db.prepare(
    `INSERT INTO upload_jobs
     (id, client_id, filename, file_path, status, current_stage, stages_json,
      target_table_hint, parsed_json, classification_json, load_result_json,
      created_at, updated_at)
     VALUES (?, 'default', ?, ?, 'done', 'done', ?, NULL, ?, ?, ?, ?, ?)`
  ).run(
    'demo-upload-001',
    'FY24_Q4_Financials.xlsx',
    '/demo/FY24_Q4_Financials.xlsx',
    JSON.stringify(stages),
    JSON.stringify(parsed),
    JSON.stringify(classification),
    JSON.stringify(loadResult),
    '2026-04-10 14:22:01',
    '2026-04-10 14:23:30',
  );
}

function seedDemoDashboardInsights(db) {
  const insights = buildRichInsights();

  const ins = db.prepare(
    `INSERT INTO dashboard_insights
     (client_id, title, summary, severity, category, key_metrics_json, drill_question, sources_json,
      detailed_narrative, trend_data_json, impact_label, impact_value, detected_at, related_insight_ids_json, is_demo)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  for (const i of insights) {
    ins.run(
      i.title, i.summary, i.severity, i.category,
      JSON.stringify(i.key_metrics),
      i.drill_question,
      JSON.stringify(i.sources),
      i.detailed_narrative,
      JSON.stringify(i.trend_data || []),
      i.impact_label,
      i.impact_value,
      i.detected_at,
      JSON.stringify(i.related_insight_ids || []),
    );
  }
}

// Build rich insights. Numbers match the seeded dummy data's anomaly patterns.
// `id` field used only for related_insight_ids cross-linking — auto-increment makes
// the real DB ids match the 1-based position in this array.
function buildRichInsights() {
  // Helper: simulated detection timestamps relative to "now" for demo feel
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  return [
    // 1 — Q3 Marketing & Sales Overrun
    {
      title: 'Q3 Marketing & Sales Overrun',
      severity: 'warning',
      category: 'variance',
      summary: 'Marketing & Sales overran budget by 35% in Q3 2024 across all three active entities — a systemic pattern, not a one-off.',
      detailed_narrative: `Marketing & Sales (account 6200) consistently came in 35% over budget for every month of Q3 2024 (Jul–Sep), hitting all three active entities at roughly the same proportional rate. For ACME-NA, the overspend was $74K against a $210K quarterly budget; ACME-EU overran by $50K against $143K; ACME-AP overran by $35K against $101K. The total group-level impact is approximately $159K of unplanned spend.

The pattern's consistency across geographies suggests this is not a local campaign decision but either a global initiative that wasn't budgeted, a vendor pricing change, or a reclassification of costs from another account. The 35% overrun ratio is too precise to be coincidental — recommend investigating whether an accrual adjustment or categorization change occurred in July.

Q4 has returned to normal levels (variance within ±5%), so the issue appears contained. Action items: (1) confirm the root cause with the accounting team; (2) decide whether to revise FY25 Marketing & Sales baseline upward; (3) institute quarterly variance threshold alerts at ±15%.`,
      key_metrics: [
        { label: 'Total Overspend', value: '+$159K' },
        { label: 'Variance %', value: '+35.0%' },
        { label: 'Entities Affected', value: '3 of 3' },
      ],
      trend_data: [
        { period: '2024-04', value: -2 }, { period: '2024-05', value: 1 }, { period: '2024-06', value: -3 },
        { period: '2024-07', value: 35 }, { period: '2024-08', value: 35 }, { period: '2024-09', value: 35 },
        { period: '2024-10', value: -3 }, { period: '2024-11', value: 1 }, { period: '2024-12', value: -2 },
      ],
      impact_label: 'overspend',
      impact_value: '$159K',
      detected_at: daysAgo(18),
      drill_question: 'Which accounts had the biggest budget variances in Q3 2024?',
      sources: ['budget_vs_actuals', 'chart_of_accounts', 'entity_master'],
      related_insight_ids: [9, 11],
    },

    // 2 — APAC Revenue Contraction
    {
      title: 'APAC Revenue Contraction',
      severity: 'warning',
      category: 'revenue',
      summary: 'ACME-AP revenue fell ~30% in Q3 2024 vs prior quarter. Q4 recovered strongly but full-year is –7.3% YoY.',
      detailed_narrative: `ACME-AP's revenue collapsed by roughly 30% in Q3 2024, with monthly billed revenue falling from the $650K mid-2024 baseline to around $455K in July, $458K in August, and $462K in September. The depression was broad-based across product lines — Enterprise, Mid-Market, and SMB all contracted proportionally — suggesting a market-wide event rather than a single lost customer.

The recovery started in October at $627K (+36% MoM) and strengthened through December at $796K (the highest month in the two-year series). This sharp V-shape is consistent with a transient macro event — possibly a regional regulatory change, a major customer delaying contracts, or an FX-related booking shift.

The full-year impact is $7.1M in 2024 vs $7.7M in 2023, a –7.3% YoY decline that is almost entirely attributable to Q3. The entity's fundamentals look healthy: Q4 average of $680K/month exceeds the 2023 average of $641K, suggesting underlying demand is intact. Recommend a post-mortem on the July cliff to identify the trigger.`,
      key_metrics: [
        { label: 'Q3 Shortfall', value: '–$569K' },
        { label: 'FY24 vs FY23', value: '–7.3%' },
        { label: 'Q4 Recovery', value: '+36% MoM' },
      ],
      trend_data: [
        { period: '2024-04', value: 645 }, { period: '2024-05', value: 652 }, { period: '2024-06', value: 658 },
        { period: '2024-07', value: 449 }, { period: '2024-08', value: 458 }, { period: '2024-09', value: 462 },
        { period: '2024-10', value: 627 }, { period: '2024-11', value: 616 }, { period: '2024-12', value: 796 },
      ],
      impact_label: 'revenue loss',
      impact_value: '–$569K',
      detected_at: daysAgo(22),
      drill_question: 'How is APAC revenue trending recently?',
      sources: ['revenue_billing'],
      related_insight_ids: [10],
    },

    // 3 — Q4 AR Collection Deterioration (NEW anomaly)
    {
      title: 'Q4 AR Collection Deterioration',
      severity: 'warning',
      category: 'cash',
      summary: 'Collection rates dropped from ~90% to ~75% in Q4 2024, inflating outstanding receivables by approximately $1.8M.',
      detailed_narrative: `Accounts receivable aging has deteriorated sharply in Q4 2024. Throughout the first nine months of 2024, the collection rate (collected ÷ billed) held steady at 85–95% across all active entities, with outstanding balances closing each quarter at normal levels. Starting in October, that rate dropped to the 70–80% band and stayed there through December.

The impact is concentrated in ACME-NA and ACME-EU (the largest billers), with outstanding receivables at year-end approximately $1.8M higher than they would have been at normal collection rates. ACME-AP is similarly affected but at lower absolute magnitude because of its smaller revenue base. ACME-LA is not affected (discontinued).

Three possible explanations: (1) a single large customer entered payment dispute — check for AR concentration in the aged buckets; (2) a terms change pushed invoices past the collection window without write-off; (3) an accounting cut-off issue where December collections weren't posted before period close. The pattern is uniform across entities and product lines, which favors explanations (2) or (3) over (1). Immediate action: reconcile the AR subledger against cash receipts for the affected months.`,
      key_metrics: [
        { label: 'Collection Rate Drop', value: '~15 pts' },
        { label: 'Extra Outstanding', value: '~$1.8M' },
        { label: 'Affected Periods', value: '3 months' },
      ],
      trend_data: [
        { period: '2024-04', value: 90 }, { period: '2024-05', value: 89 }, { period: '2024-06', value: 91 },
        { period: '2024-07', value: 88 }, { period: '2024-08', value: 90 }, { period: '2024-09', value: 92 },
        { period: '2024-10', value: 75 }, { period: '2024-11', value: 73 }, { period: '2024-12', value: 76 },
      ],
      impact_label: 'unpaid',
      impact_value: '$1.8M',
      detected_at: daysAgo(5),
      drill_question: 'Show me AR collection rates by entity for Q4 2024',
      sources: ['revenue_billing'],
      related_insight_ids: [13],
    },

    // 4 — Enterprise Revenue Concentration Risk
    {
      title: 'Enterprise Segment Concentration Risk',
      severity: 'warning',
      category: 'concentration',
      summary: 'Enterprise (SaaS Platform) accounts for 55% of FY24 revenue across all entities — higher than typical 40–45% benchmark.',
      detailed_narrative: `Revenue is heavily concentrated in the Enterprise / SaaS Platform segment, which generated approximately $19.6M of FY24's $35.7M total (55%). Mid-Market / Cloud Services contributed 30% ($10.7M) and SMB / Self-Serve Tier the remaining 15% ($5.4M). The concentration is uniform across all three active regions — it's not a US-centric pattern.

A 55% single-segment share exceeds the typical SaaS portfolio benchmark of 40–45% and creates material customer-churn exposure. Industry reference: companies with >50% Enterprise concentration tend to see revenue volatility of ±12% per quarter vs ±6% for more diversified portfolios. The November ACME-NA product dip (a separate alert) likely reflects this sensitivity.

Strategic implications: (1) the Enterprise book deserves disproportionate attention from customer success; (2) FY25 growth forecasting should weight Enterprise win/loss rates heavily; (3) Mid-Market and SMB growth investments may be underweighted relative to their diversification benefit. Consider setting a 3-year target of reducing Enterprise share to under 50%.`,
      key_metrics: [
        { label: 'Enterprise Share', value: '55%' },
        { label: 'Mid-Market', value: '30%' },
        { label: 'SMB', value: '15%' },
      ],
      trend_data: [
        { period: 'Ent', value: 55 }, { period: 'Mid', value: 30 }, { period: 'SMB', value: 15 },
      ],
      impact_label: 'concentration',
      impact_value: '55%',
      detected_at: daysAgo(12),
      drill_question: 'Break down FY24 revenue by business unit and product line',
      sources: ['revenue_billing'],
      related_insight_ids: [6],
    },

    // 5 — H2 G&A Expense Creep (NEW anomaly)
    {
      title: 'H2 G&A Expense Creep',
      severity: 'warning',
      category: 'expense',
      summary: 'G&A spend ran 12% above budget across H2 2024 in all three active entities — a slow-burn pattern masked by smaller absolute amounts.',
      detailed_narrative: `General & Administrative expense (account 6400) ran consistently 12% above budget for every month from July through December 2024, across all three active entities. Unlike the Q3 Marketing overrun which is highly visible because of the 35% magnitude, this G&A creep is easier to miss because the absolute dollar amounts are smaller — typical monthly G&A is 4% of revenue vs Marketing's 8%.

The six-month cumulative overspend totals approximately $168K across the group: $90K at ACME-NA, $48K at ACME-EU, and $30K at ACME-AP. The proportionality mirrors each entity's revenue scale, suggesting the driver is proportional to size — likely a headcount-related or rate-based cost (insurance, legal retainer, outsourced services, compliance tooling).

This pattern is worth flagging specifically because small consistent overruns compound. At current trajectory, FY25 G&A would outrun budget by ~$335K if unmitigated. Recommend a deep dive on the July entry where the pattern began, and comparison against the H1 2024 run-rate.`,
      key_metrics: [
        { label: 'Cumulative Overspend', value: '+$168K' },
        { label: 'Monthly Variance', value: '+12%' },
        { label: 'Months Affected', value: '6 of 6' },
      ],
      trend_data: [
        { period: '2024-04', value: 1 }, { period: '2024-05', value: -1 }, { period: '2024-06', value: 2 },
        { period: '2024-07', value: 12 }, { period: '2024-08', value: 12 }, { period: '2024-09', value: 12 },
        { period: '2024-10', value: 12 }, { period: '2024-11', value: 12 }, { period: '2024-12', value: 12 },
      ],
      impact_label: 'overspend',
      impact_value: '$168K',
      detected_at: daysAgo(9),
      drill_question: 'Show the G&A expense variance trend for H2 2024',
      sources: ['budget_vs_actuals', 'chart_of_accounts'],
      related_insight_ids: [1],
    },

    // 6 — November ACME-NA Product Revenue Miss (NEW anomaly)
    {
      title: 'November ACME-NA Product Revenue Miss',
      severity: 'warning',
      category: 'revenue',
      summary: 'ACME-NA product revenue came in 8% below budget in November 2024 — driving most of the Q4 top-line shortfall.',
      detailed_narrative: `ACME-NA Product Revenue (account 4000, Enterprise tier) booked approximately $1.04M in November 2024 vs a budget of $1.14M — an $97K or 8.3% shortfall. October and December came in at or slightly above budget, so this is a pinpoint one-month anomaly rather than a trend.

Contextually, November 2024 is also where ACME-NA's Q4 BvA deep-dive identified the primary source of the quarter's $272K revenue miss. The concentration in one month and one business unit (Enterprise) points to either a deal slip (contract push-out to December/January), a renewal that didn't close on time, or a customer churn event that was partially recovered in December.

The recovery pattern is encouraging — December snapped back to $1.20M, slightly above budget. Full investigation should check (1) the Enterprise pipeline log for November-dated opportunities that slipped; (2) churn reports for November; (3) whether the December over-budget was a partial offset. Recommend watching January 2025 closely: if the pattern repeats, it's structural; if not, it was a one-off timing effect.`,
      key_metrics: [
        { label: 'November Shortfall', value: '–$97K' },
        { label: 'Variance %', value: '–8.3%' },
        { label: 'Recovery', value: 'Dec +3%' },
      ],
      trend_data: [
        { period: '2024-07', value: 0 }, { period: '2024-08', value: 1 }, { period: '2024-09', value: -2 },
        { period: '2024-10', value: 0 }, { period: '2024-11', value: -8.3 }, { period: '2024-12', value: 3 },
      ],
      impact_label: 'miss',
      impact_value: '–$97K',
      detected_at: daysAgo(15),
      drill_question: 'Why did ACME-NA product revenue miss in November 2024?',
      sources: ['revenue_billing', 'budget_vs_actuals'],
      related_insight_ids: [4],
    },

    // 7 — ACME-LA Wind-Down Complete
    {
      title: 'ACME-LA Wind-Down Complete',
      severity: 'info',
      category: 'entity',
      summary: 'ACME-LA discontinued end of June 2024. No transactions across any canonical table from July onward.',
      detailed_narrative: `The ACME-LA (Latin America) entity was wound down at the end of June 2024. Its entity_master status is marked inactive, and the last recorded period in all four transactional tables (general_ledger, revenue_billing, budget_vs_actuals, cash_flow) is 2024-06. No new activity has occurred since.

FY24 revenue from ACME-LA totaled $1.68M, compared to $3.75M in FY23 — a 55% year-over-year decline reflecting the half-year of operations before wind-down. This contraction was expected; the entity was trending declining through 2023 at roughly –4% annualized growth, and the discontinuation appears to have been planned rather than abrupt.

Impact on group-level analytics is limited because ACME-LA was always the smallest contributor (~5–8% of consolidated revenue in prior years). However, analysts should be aware when computing multi-year trends: year-over-year comparisons involving 2024 need to be adjusted for the partial-year contribution, and forward forecasts should exclude ACME-LA entirely.`,
      key_metrics: [
        { label: 'Last Active Period', value: '2024-06' },
        { label: 'FY24 Revenue', value: '$1.68M' },
        { label: 'vs FY23', value: '–55%' },
      ],
      trend_data: [
        { period: '2023-Q4', value: 820 }, { period: '2024-Q1', value: 750 }, { period: '2024-Q2', value: 930 },
        { period: '2024-Q3', value: 0 }, { period: '2024-Q4', value: 0 },
      ],
      impact_label: 'discontinued',
      impact_value: '$1.68M',
      detected_at: daysAgo(90),
      drill_question: 'What happened with ACME-LA in the second half of 2024?',
      sources: ['entity_master', 'general_ledger', 'revenue_billing'],
      related_insight_ids: [10],
    },

    // 8 — Q4 Seasonality Peak Achieved
    {
      title: 'Q4 Seasonality Peak Achieved',
      severity: 'info',
      category: 'revenue',
      summary: 'Q4 2024 revenue is 25% above the trailing 3-quarter average — consistent with historical seasonality, no anomaly.',
      detailed_narrative: `Q4 2024 consolidated revenue of $11.4M came in 25% above the trailing 3-quarter average of $9.1M. This is consistent with the historical seasonality pattern: Q4 has averaged 1.25x the Q1–Q3 baseline in both 2023 and 2024, driven by year-end enterprise renewals, holiday-adjacent spend in SMB, and fiscal-year budget flushes from customers.

The peak was broad-based — ACME-NA (+27%), ACME-EU (+24%), and ACME-AP (+72% vs its depressed Q3 baseline) all contributed. The uniformity strengthens confidence that FY25 seasonality will track similarly, suggesting Q4 2025 modeling should assume ~25% lift over the first three quarters.

This insight is flagged as informational rather than a warning because it's behaving exactly as expected. The value is as a sanity-check marker — if Q4 2025 does NOT show this pattern, that itself will be a signal worth investigating.`,
      key_metrics: [
        { label: 'Q4 Revenue', value: '$11.4M' },
        { label: 'vs 3Q Avg', value: '+25%' },
        { label: 'Consistency', value: '2y in a row' },
      ],
      trend_data: [
        { period: '2024-Q1', value: 8.6 }, { period: '2024-Q2', value: 9.2 }, { period: '2024-Q3', value: 9.5 }, { period: '2024-Q4', value: 11.4 },
      ],
      impact_label: 'seasonal lift',
      impact_value: '+$2.3M',
      detected_at: daysAgo(30),
      drill_question: 'What was total revenue across all entities for Q4 2024?',
      sources: ['revenue_billing'],
      related_insight_ids: [13],
    },

    // 9 — FY24 Consolidated Variance Summary
    {
      title: 'FY24 Consolidated Variance Summary',
      severity: 'info',
      category: 'summary',
      summary: 'Group P&L variance was –$418K unfavorable for FY24 — revenue misses (APAC, Product) partially offset by broad expense discipline.',
      detailed_narrative: `Total FY24 consolidated variance landed at –$418K unfavorable to the original budget. Revenue was $892K below budget, driven primarily by the APAC Q3 shortfall (~$569K) and the ACME-NA November Product miss (~$97K), with smaller misses spread across other periods. On the expense side, the group came in $474K under budget — a favorable result, but one that masks two opposing forces: the Marketing & Sales overrun (+$159K unfavorable) and the G&A expense creep (+$168K unfavorable) were more than offset by genuine underspend in R&D, Cost of Goods Sold, and other operating categories (~$801K favorable combined).

Net-net, the business absorbed roughly $0.9M of revenue pressure with ~$0.5M of cost discipline, landing within approximately 1.2% of planned operating income. That's within the "green" tolerance band for a company at this scale and points to healthy financial management.

The composition is worth watching: the favorable expense variances were partly tactical (delayed R&D spend, lower CoGS from product mix) and won't necessarily repeat. FY25 planning should assume the unfavorable variances (Marketing, G&A) persist unless structural changes are made, while the favorable ones normalize back toward budget.`,
      key_metrics: [
        { label: 'Revenue vs Budget', value: '–$892K' },
        { label: 'Expense vs Budget', value: '–$474K' },
        { label: 'Net Impact', value: '–$418K' },
      ],
      trend_data: null,
      impact_label: 'net variance',
      impact_value: '–$418K',
      detected_at: daysAgo(14),
      drill_question: 'Give me a detailed budget vs actuals breakdown for ACME-NA Q4 2024',
      sources: ['budget_vs_actuals'],
      related_insight_ids: [1, 2, 5],
    },

    // 10 — YoY Entity Growth Divergence
    {
      title: 'YoY Entity Growth Divergence',
      severity: 'info',
      category: 'trend',
      summary: 'Growth rates diverge sharply by entity: NA/EU steady at +3-4%, AP down –7%, LA discontinued. Group growth masks meaningful regional differences.',
      detailed_narrative: `Year-over-year revenue growth by entity paints a divergent picture: ACME-NA grew +3.8% ($15.5M → $16.1M), ACME-EU grew +3.7% ($10.4M → $10.8M), ACME-AP declined –7.3% ($7.7M → $7.1M), and ACME-LA declined –55.3% due to mid-year discontinuation ($3.75M → $1.68M).

The group-level aggregate growth of approximately +0.9% is a misleading number — it blends healthy core-market expansion with a regional contraction and a planned exit. A more useful framing is "growth among continuing operations ex-APAC anomaly" which runs at +3.8%, in line with the prior-year trajectory. The APAC decline is attributable entirely to a Q3 event (see APAC Revenue Contraction insight); stripping out Jul–Sep, APAC would have grown +4% on par with the other continuing entities.

Strategic implication: the business has three healthy core markets (NA, EU, APAC ex-Q3) plus a planned wind-down. FY25 planning should model NA/EU at low-single-digit growth and APAC at recovery back to its long-run trend of +3-4%, conditional on the Q3 root cause being non-recurring.`,
      key_metrics: [
        { label: 'ACME-NA', value: '+3.8%' },
        { label: 'ACME-EU', value: '+3.7%' },
        { label: 'ACME-AP', value: '–7.3%' },
      ],
      trend_data: [
        { period: 'NA', value: 3.8 }, { period: 'EU', value: 3.7 }, { period: 'AP', value: -7.3 }, { period: 'LA', value: -55.3 },
      ],
      impact_label: 'divergence',
      impact_value: '11 pts',
      detected_at: daysAgo(20),
      drill_question: 'What is the year-over-year revenue growth rate for each entity?',
      sources: ['revenue_billing', 'entity_master'],
      related_insight_ids: [2, 7],
    },

    // 11 — ACME-EU Budget Accuracy (positive signal)
    {
      title: 'ACME-EU Budget Accuracy — Best in Class',
      severity: 'success',
      category: 'variance',
      summary: 'ACME-EU tracked within 4% of budget every quarter of FY24 — the best forecast accuracy of any entity.',
      detailed_narrative: `ACME-EU's FY24 actual performance came within 4% of budget for every quarter of the year: Q1 +1.2%, Q2 +2.8%, Q3 –3.1%, Q4 –4.1%. No single quarter missed by more than ~$240K on a $5-6M quarterly base. This is materially tighter than ACME-NA (max deviation 5.3% in Q4) and ACME-AP (max deviation 30% in Q3).

This level of forecasting accuracy indicates strong FP&A discipline at the EU entity: their bottoms-up pipeline modeling appears well-calibrated, their expense pacing is controlled, and they don't rely on end-of-quarter heroics to close. Both revenue and expense variances contribute to this outcome — ACME-EU was not immune to the Q3 Marketing overrun but absorbed it within broader expense discipline elsewhere.

Recommendation: treat ACME-EU's planning process as the internal benchmark. The NA team should review EU's quarterly rebaselining cadence and pipeline-to-close conversion models. If the group is looking for ways to tighten forecasting accuracy in FY25, copying EU's process is likely higher-ROI than adjusting targets.`,
      key_metrics: [
        { label: 'Max Quarter Variance', value: '±4.1%' },
        { label: 'Avg Quarter Variance', value: '±2.8%' },
        { label: 'vs NA Max', value: '±5.3%' },
      ],
      trend_data: [
        { period: 'Q1', value: 1.2 }, { period: 'Q2', value: 2.8 }, { period: 'Q3', value: -3.1 }, { period: 'Q4', value: -4.1 },
      ],
      impact_label: 'accuracy',
      impact_value: '±4%',
      detected_at: daysAgo(16),
      drill_question: 'Compare FY24 budget accuracy across all entities',
      sources: ['budget_vs_actuals', 'entity_master'],
      related_insight_ids: [9],
    },

    // 12 — ACME-NA Operating Margin Stable
    {
      title: 'ACME-NA Operating Margin Stable',
      severity: 'success',
      category: 'margin',
      summary: 'Operating margin at ACME-NA held at 17.4% in FY24 vs 17.8% in FY23 — stable despite the Q4 revenue softness.',
      detailed_narrative: `ACME-NA delivered an FY24 operating margin of 17.4%, essentially flat against the 17.8% result in FY23. This is a strong outcome given the $272K Q4 revenue shortfall: absent expense discipline, margin compression of 0.6 percentage points would normally be larger.

The margin held because expense growth tracked below revenue growth for the year. Cost of Goods Sold scaled proportionally with Product Revenue (both roughly flat), while fixed costs (Salaries, Rent) grew at approximately 2% vs revenue's 3.8% — yielding positive operating leverage. The Marketing & Sales overrun in Q3 and the G&A creep in H2 were partially offset by below-budget R&D and strong gross margin management.

This is a credible signal of operational health. However, the margin quality has a caveat: some of the H2 expense underperformance may reflect deferred investment rather than permanent efficiency (e.g., delayed R&D hires, pushed-back capex). FY25 should expect some "snapback" in expense categories that underspent in H2, which may pressure margins slightly unless revenue accelerates.`,
      key_metrics: [
        { label: 'FY24 Margin', value: '17.4%' },
        { label: 'FY23 Margin', value: '17.8%' },
        { label: 'Change', value: '–40bps' },
      ],
      trend_data: [
        { period: '2024-Q1', value: 17.6 }, { period: '2024-Q2', value: 17.8 }, { period: '2024-Q3', value: 17.2 }, { period: '2024-Q4', value: 16.8 },
      ],
      impact_label: 'stable margin',
      impact_value: '17.4%',
      detected_at: daysAgo(11),
      drill_question: 'What is ACME-NA operating margin trend over FY24?',
      sources: ['budget_vs_actuals', 'general_ledger'],
      related_insight_ids: [9],
    },

    // 13 — Cash Position Strengthening
    {
      title: 'Cash Position Strengthening',
      severity: 'success',
      category: 'cash',
      summary: 'Group-level net cash flow grew 75% from July to December 2024, driven primarily by operating cash flow expansion.',
      detailed_narrative: `Net cash flow for the consolidated group climbed from approximately $520K in July 2024 to $912K in December 2024 — a 75% increase over six months. The vast majority of the gain is operating cash flow, which rose from $867K to $1.32M (+52%). Investing and financing cash flows moved within normal ranges and were not material drivers.

Operating cash flow strength is the healthiest possible signal: it indicates the business is converting revenue to cash efficiently, regardless of any one-off financing or investing moves. The full-year operating cash flow of $13.0M against total revenue of $34.1M yields an OpCF/Revenue ratio of 38% — solidly in line with healthy SaaS benchmarks (30–40%).

One caveat: this trend needs to be read alongside the Q4 AR Collection Deterioration insight. Part of December's cash-in reflects billings from prior months finally collecting, which may create a tough comparison in Q1 2025 if collections normalize without a parallel pickup in billings. Recommend watching cash conversion cycle, not just absolute cash flow, in early 2025.`,
      key_metrics: [
        { label: 'H2 2024 Net Cash', value: '$10.0M' },
        { label: 'Growth (Jul→Dec)', value: '+75%' },
        { label: 'OpCF/Revenue', value: '38%' },
      ],
      trend_data: [
        { period: '2024-07', value: 520 }, { period: '2024-08', value: 580 }, { period: '2024-09', value: 645 },
        { period: '2024-10', value: 720 }, { period: '2024-11', value: 810 }, { period: '2024-12', value: 912 },
      ],
      impact_label: 'growth',
      impact_value: '+75%',
      detected_at: daysAgo(7),
      drill_question: 'How is cash flow trending over the last 6 months?',
      sources: ['cash_flow'],
      related_insight_ids: [3, 14],
    },

    // 14 — Cash Conversion Cycle Healthy
    {
      title: 'Cash Conversion Ratio Healthy',
      severity: 'success',
      category: 'cash',
      summary: 'Operating cash flow represents 38% of revenue — in the healthy band for SaaS businesses (30–40%).',
      detailed_narrative: `The group's cash conversion ratio — operating cash flow divided by revenue — runs at approximately 38% for FY24 ($13.0M OpCF on $34.1M revenue). This is within the healthy range for a SaaS business with this revenue mix, where the typical benchmark band is 30–40% for mature books and up to 45% for highly efficient operators.

Component analysis: ACME-NA delivers 41% cash conversion, ACME-EU 39%, and ACME-AP 33% (dragged by the Q3 revenue contraction that still had to carry fixed costs). The spread between entities is reasonable — a 8-point dispersion is typical, and APAC's lower number is explainable by the Q3 event rather than a structural efficiency issue.

Forward outlook depends on the AR aging issue. If the Q4 Collection Deterioration reverses in Q1 2025 — meaning Q4 billings eventually collect — the cash conversion ratio will stay healthy. If it proves structural (write-offs required), FY25 cash conversion could dip to 33-35%, still acceptable but worth monitoring. The single highest-leverage action to maintain this metric is resolving the AR issue decisively.`,
      key_metrics: [
        { label: 'Group OpCF/Rev', value: '38%' },
        { label: 'Best: ACME-NA', value: '41%' },
        { label: 'Weakest: ACME-AP', value: '33%' },
      ],
      trend_data: [
        { period: 'NA', value: 41 }, { period: 'EU', value: 39 }, { period: 'AP', value: 33 }, { period: 'Group', value: 38 },
      ],
      impact_label: 'healthy',
      impact_value: '38%',
      detected_at: daysAgo(7),
      drill_question: 'Compare operating cash flow to revenue for each entity',
      sources: ['cash_flow', 'revenue_billing'],
      related_insight_ids: [13, 3],
    },
  ];
}

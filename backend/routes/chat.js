// backend/routes/chat.js
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runChat } from '../agents/chat/orchestrator.js';
import { testConnectivity } from '../agents/llm.js';
import { generateInsights } from '../agents/insights/index.js';

export function createChatRouter(db) {
  const router = Router();

  // List conversations — demos first, then user conversations by recency
  router.get('/conversations', (req, res) => {
    const rows = db.prepare(
      `SELECT * FROM chat_conversations ORDER BY is_demo DESC, updated_at DESC LIMIT 50`
    ).all();
    res.json(rows);
  });

  // Get one conversation with messages
  router.get('/conversations/:id', (req, res) => {
    const conv = db.prepare(`SELECT * FROM chat_conversations WHERE id = ?`).get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const messages = db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC`).all(req.params.id);
    const parsed = messages.map(m => ({
      ...m,
      execution_graph_json: m.execution_graph_json ? JSON.parse(m.execution_graph_json) : null,
      confidence_breakdown_json: m.confidence_breakdown_json ? JSON.parse(m.confidence_breakdown_json) : null,
      sources_json: m.sources_json ? JSON.parse(m.sources_json) : null,
      suggested_followups_json: m.suggested_followups_json ? JSON.parse(m.suggested_followups_json) : null,
    }));
    res.json({ conversation: conv, messages: parsed });
  });

  // Delete conversation
  router.delete('/conversations/:id', (req, res) => {
    db.prepare(`DELETE FROM chat_messages WHERE conversation_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM chat_conversations WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Bulk clear all non-demo conversations — keeps the 6 seeded demos intact.
  // Useful for presenters who want to reset between demo runs without wiping data.
  router.delete('/conversations-non-demo/all', (req, res) => {
    const stale = db.prepare(`SELECT id FROM chat_conversations WHERE is_demo = 0`).all();
    db.transaction(() => {
      for (const row of stale) {
        db.prepare(`DELETE FROM chat_messages WHERE conversation_id = ?`).run(row.id);
        db.prepare(`DELETE FROM chat_conversations WHERE id = ?`).run(row.id);
      }
    });
    res.json({ deleted: stale.length });
  });

  // Send a message → run the chat orchestrator → save & return
  router.post('/messages', async (req, res) => {
    const provider = req.headers['x-llm-provider'] || 'anthropic';
    const apiKey = req.headers['x-llm-api-key'];
    if (!apiKey) return res.status(400).json({ error: 'No LLM API key. Add one in Settings.' });

    let conversationId = req.body.conversation_id;
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ error: 'message required' });

    // Create conversation if new
    if (!conversationId) {
      conversationId = uuidv4();
      const title = userMessage.slice(0, 60);
      db.prepare(`INSERT INTO chat_conversations (id, title) VALUES (?, ?)`).run(conversationId, title);
    } else {
      const exists = db.prepare(`SELECT id FROM chat_conversations WHERE id = ?`).get(conversationId);
      if (!exists) return res.status(404).json({ error: 'conversation not found' });
    }

    // Insert user message
    db.prepare(`INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, 'user', ?)`)
      .run(conversationId, userMessage);

    // Build history
    const history = db.prepare(`SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC`).all(conversationId);
    const contextHistory = history.slice(0, -1).map(h => ({ role: h.role, content: h.content }));

    try {
      // Collect tool calls in memory so we can link them to the assistant message_id.
      const bufferedToolCalls = [];
      const result = await runChat({
        db, provider, apiKey, userMessage, history: contextHistory,
        onToolCall: (agent, tool, input, output, latency) => {
          bufferedToolCalls.push({ agent, tool, input, output, latency });
        },
      });
      const insRes = db.prepare(`INSERT INTO chat_messages
        (conversation_id, role, content, execution_graph_json, confidence, confidence_breakdown_json, sources_json, suggested_followups_json, latency_ms)
        VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, ?)`).run(
        conversationId, result.answer,
        JSON.stringify(result.execution_graph),
        result.confidence?.total || null,
        JSON.stringify(result.confidence),
        JSON.stringify(result.sources),
        JSON.stringify(result.suggested_followups),
        result.latency_ms,
      );
      // Now persist the buffered tool calls with the real message_id
      const toolStmt = db.prepare(`INSERT INTO tool_call_log
        (conversation_id, message_id, agent_name, tool_name, input_json, output_json, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const t of bufferedToolCalls) {
        toolStmt.run(
          conversationId, insRes.lastInsertRowid, t.agent, t.tool,
          JSON.stringify(t.input), JSON.stringify(t.output).slice(0, 100000), t.latency
        );
      }
      db.prepare(`UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(conversationId);
      res.json({
        conversation_id: conversationId,
        message_id: insRes.lastInsertRowid,
        ...result,
      });
    } catch (e) {
      console.error('[chat] error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// ----- Settings router -----
export function createSettingsRouter() {
  const router = Router();
  router.post('/test-connection', async (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) return res.status(400).json({ error: 'provider and apiKey required' });
    const result = await testConnectivity(provider, apiKey);
    res.json(result);
  });
  return router;
}

// ----- Dashboard router -----
export function createDashboardRouter(db) {
  const router = Router();

  // Generate fresh AI insights by scanning canonical data and narrating via LLM.
  router.post('/insights/generate', async (req, res) => {
    const provider = req.headers['x-llm-provider'] || 'anthropic';
    const apiKey = req.headers['x-llm-api-key'];
    if (!apiKey) return res.status(400).json({ error: 'No LLM API key. Add one in Settings.' });
    try {
      const result = await generateInsights({ db, provider, apiKey });
      res.json(result);
    } catch (e) {
      console.error('[dashboard/insights/generate] failed:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // AI-Generated narrative insights (reads from dashboard_insights)
  router.get('/insights', (req, res) => {
    const rows = db.prepare(
      `SELECT id, title, summary, severity, category, key_metrics_json, drill_question, sources_json,
              detailed_narrative, trend_data_json, impact_label, impact_value, detected_at, related_insight_ids_json,
              is_demo, created_at
       FROM dashboard_insights ORDER BY
         CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 WHEN 'success' THEN 2 ELSE 3 END,
         id ASC LIMIT 50`
    ).all();
    const parsed = rows.map(r => ({
      ...r,
      key_metrics: r.key_metrics_json ? JSON.parse(r.key_metrics_json) : [],
      sources: r.sources_json ? JSON.parse(r.sources_json) : [],
      trend_data: r.trend_data_json ? JSON.parse(r.trend_data_json) : [],
      related_insight_ids: r.related_insight_ids_json ? JSON.parse(r.related_insight_ids_json) : [],
    }));
    res.json(parsed);
  });

  router.get('/curated', (req, res) => {
    // Optional filters
    const entityFilter = req.query.entity || null;
    const periodFromFilter = req.query.period_from || null;
    const periodToFilter = req.query.period_to || null;

    const entClause = entityFilter ? ` AND e.entity_code = '${String(entityFilter).replace(/'/g, "''")}'` : '';
    const periodClause = (table) => {
      const parts = [];
      if (periodFromFilter) parts.push(`${table}.period >= '${String(periodFromFilter).replace(/'/g, "''")}'`);
      if (periodToFilter) parts.push(`${table}.period <= '${String(periodToFilter).replace(/'/g, "''")}'`);
      return parts.length ? ' AND ' + parts.join(' AND ') : '';
    };

    // Revenue trend (from revenue_billing for real totals — more accurate than GL credit)
    const revenueTrend = db.prepare(`
      SELECT r.period, e.entity_code, SUM(r.billed_amount) AS revenue
      FROM revenue_billing r JOIN entity_master e ON r.entity_id = e.entity_id
      WHERE 1=1 ${entClause} ${periodClause('r')}
      GROUP BY r.period, e.entity_code
      ORDER BY r.period DESC LIMIT 96
    `).all();

    const latestPeriod = db.prepare(`SELECT MAX(period) AS p FROM budget_vs_actuals`).get()?.p;
    const variances = latestPeriod ? db.prepare(`
      SELECT b.period, e.entity_code, a.account_name, a.account_code, a.account_type,
             b.budget_amount, b.actual_amount, b.variance, b.variance_pct
      FROM budget_vs_actuals b
      JOIN entity_master e ON b.entity_id = e.entity_id
      JOIN chart_of_accounts a ON b.account_code = a.account_code
      WHERE b.period = ? ${entClause}
      ORDER BY ABS(b.variance) DESC LIMIT 10
    `).all(latestPeriod) : [];

    // Cash by category (stacked area)
    const cashByCat = db.prepare(`
      SELECT c.period, c.category, SUM(c.amount) AS amount
      FROM cash_flow c JOIN entity_master e ON c.entity_id = e.entity_id
      WHERE 1=1 ${entClause} ${periodClause('c')}
      GROUP BY c.period, c.category
      ORDER BY c.period DESC LIMIT 72
    `).all();

    // Net cash (for back-compat)
    const netCash = db.prepare(`
      SELECT c.period, SUM(c.amount) AS net_cash
      FROM cash_flow c JOIN entity_master e ON c.entity_id = e.entity_id
      WHERE 1=1 ${entClause} ${periodClause('c')}
      GROUP BY c.period ORDER BY c.period DESC LIMIT 24
    `).all();

    // Entity concentration (trailing-3-month revenue share)
    const recentPeriodsRows = db.prepare(`SELECT DISTINCT period FROM revenue_billing ORDER BY period DESC LIMIT 3`).all();
    const recentPeriods = recentPeriodsRows.map(r => r.period);
    const entityConcentration = recentPeriods.length ? db.prepare(`
      SELECT e.entity_code, SUM(r.billed_amount) AS revenue
      FROM revenue_billing r JOIN entity_master e ON r.entity_id = e.entity_id
      WHERE r.period IN (${recentPeriods.map(() => '?').join(',')})
      GROUP BY e.entity_code ORDER BY revenue DESC
    `).all(...recentPeriods) : [];

    // P&L waterfall for latest period (from GL: revenue → expense categories → net)
    const latestGL = db.prepare(`SELECT MAX(period) AS p FROM general_ledger`).get()?.p;
    const pnlWaterfall = latestGL ? (() => {
      const parts = [];
      const revR = db.prepare(`SELECT COALESCE(SUM(g.credit),0) AS s FROM general_ledger g
        JOIN entity_master e ON g.entity_id = e.entity_id
        JOIN chart_of_accounts a ON g.account_code = a.account_code
        WHERE a.account_type = 'revenue' AND g.period = ? ${entClause}`).get(latestGL).s;
      parts.push({ label: 'Revenue', value: revR, kind: 'total' });
      // Expenses by account (not account_type — richer breakdown)
      const expenses = db.prepare(`SELECT a.account_name, COALESCE(SUM(g.debit),0) AS s
        FROM general_ledger g
        JOIN chart_of_accounts a ON g.account_code = a.account_code
        JOIN entity_master e ON g.entity_id = e.entity_id
        WHERE a.account_type = 'expense' AND g.period = ? ${entClause}
        GROUP BY a.account_name HAVING s > 0 ORDER BY s DESC LIMIT 6`).all(latestGL);
      for (const ex of expenses) parts.push({ label: ex.account_name, value: -ex.s, kind: 'sub' });
      const totalExp = expenses.reduce((a, b) => a + b.s, 0);
      parts.push({ label: 'Net Income', value: revR - totalExp, kind: 'total' });
      return { period: latestGL, items: parts };
    })() : null;

    // AR aging
    const arLatestRow = db.prepare(`SELECT MAX(period) AS p FROM revenue_billing`).get();
    const arLatest = arLatestRow?.p;
    let arAging = null;
    if (arLatest) {
      const rows = db.prepare(`SELECT period, SUM(outstanding_amount) AS s FROM revenue_billing WHERE outstanding_amount > 0 GROUP BY period`).all();
      const [y, m] = arLatest.split('-').map(Number);
      const buckets = { current: 0, '30': 0, '60': 0, '90+': 0 };
      for (const r of rows) {
        const [py, pm] = r.period.split('-').map(Number);
        const mo = (y - py) * 12 + (m - pm);
        if (mo <= 0) buckets.current += r.s;
        else if (mo === 1) buckets['30'] += r.s;
        else if (mo === 2) buckets['60'] += r.s;
        else buckets['90+'] += r.s;
      }
      arAging = { period: arLatest, buckets };
    }

    // YoY comparison (same month prior year)
    let yoy = null;
    if (arLatest) {
      const [y, m] = arLatest.split('-');
      const priorKey = `${Number(y) - 1}-${m}`;
      const pairs = db.prepare(`SELECT e.entity_code,
          SUM(CASE WHEN r.period = ? THEN r.billed_amount ELSE 0 END) AS current,
          SUM(CASE WHEN r.period = ? THEN r.billed_amount ELSE 0 END) AS prior
        FROM revenue_billing r JOIN entity_master e ON r.entity_id = e.entity_id
        WHERE r.period IN (?, ?) GROUP BY e.entity_code`).all(arLatest, priorKey, arLatest, priorKey);
      yoy = { current_period: arLatest, prior_period: priorKey, entities: pairs };
    }

    // Variance heatmap (accounts × periods, last 6 periods)
    const heatPeriodsRows = db.prepare(`SELECT DISTINCT period FROM budget_vs_actuals ORDER BY period DESC LIMIT 6`).all();
    const heatPeriods = heatPeriodsRows.map(r => r.period).reverse();
    const heatmapRows = heatPeriods.length ? db.prepare(`
      SELECT a.account_name, b.period, SUM(b.variance_pct * b.budget_amount) / NULLIF(SUM(b.budget_amount), 0) AS weighted_pct
      FROM budget_vs_actuals b
      JOIN chart_of_accounts a ON b.account_code = a.account_code
      JOIN entity_master e ON b.entity_id = e.entity_id
      WHERE b.period IN (${heatPeriods.map(() => '?').join(',')}) ${entClause}
      GROUP BY a.account_name, b.period
    `).all(...heatPeriods) : [];

    // Data freshness
    const freshness = [];
    for (const t of ['entity_master', 'chart_of_accounts', 'general_ledger', 'revenue_billing', 'budget_vs_actuals', 'cash_flow']) {
      const r = db.prepare(`SELECT COUNT(*) AS c, MAX(updated_at) AS u FROM ${t}`).get();
      freshness.push({ table: t, rows: r.c, last_updated: r.u });
    }

    // Available entity codes (for filter UI)
    const entities = db.prepare(`SELECT entity_code, entity_name FROM entity_master WHERE status = 'active'`).all();

    res.json({
      revenue_trend: revenueTrend.reverse(),
      latest_period: latestPeriod,
      top_variances: variances,
      cash_by_category: cashByCat.reverse(),
      cash_position: netCash.reverse(),
      entity_concentration: entityConcentration,
      pnl_waterfall: pnlWaterfall,
      ar_aging: arAging,
      yoy,
      variance_heatmap: { periods: heatPeriods, rows: heatmapRows },
      data_freshness: freshness,
      available_entities: entities,
    });
  });

  // Hero KPIs for the dashboard strip
  router.get('/kpis', (req, res) => {
    const kpis = [];
    const curYear = new Date().getUTCFullYear();
    const latestRevRow = db.prepare(`SELECT MAX(period) AS p FROM revenue_billing`).get();
    const latestRev = latestRevRow?.p;

    // Revenue YTD
    if (latestRev) {
      const [y] = latestRev.split('-');
      const ytd = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE period LIKE ?`).get(`${y}-%`).s;
      const priorYtd = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE period LIKE ?`).get(`${Number(y) - 1}-%`).s;
      const yoyPct = priorYtd > 0 ? ((ytd - priorYtd) / priorYtd) * 100 : null;
      const trend = db.prepare(`SELECT period AS label, SUM(billed_amount) AS value FROM revenue_billing GROUP BY period ORDER BY period DESC LIMIT 12`).all().reverse();
      kpis.push({ key: 'revenue_ytd', label: `Revenue ${y}`, value: ytd, format: 'money', delta: yoyPct, delta_label: 'YoY', trend });
    }
    // Net cash (latest)
    const latestCashRow = db.prepare(`SELECT MAX(period) AS p FROM cash_flow`).get();
    if (latestCashRow?.p) {
      const net = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM cash_flow WHERE period = ?`).get(latestCashRow.p).s;
      const prior = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM cash_flow WHERE period = (SELECT MAX(period) FROM cash_flow WHERE period < ?)`).get(latestCashRow.p).s;
      const delta = prior !== 0 ? ((net - prior) / Math.abs(prior)) * 100 : null;
      const trend = db.prepare(`SELECT period AS label, SUM(amount) AS value FROM cash_flow GROUP BY period ORDER BY period DESC LIMIT 12`).all().reverse();
      kpis.push({ key: 'net_cash', label: `Net Cash (${latestCashRow.p})`, value: net, format: 'money', delta, delta_label: 'vs prior mo', trend });
    }
    // Budget attainment (trailing 3 months)
    const bvPeriods = db.prepare(`SELECT DISTINCT period FROM budget_vs_actuals ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (bvPeriods.length) {
      const r = db.prepare(`SELECT COALESCE(SUM(budget_amount),0) AS b, COALESCE(SUM(actual_amount),0) AS a FROM budget_vs_actuals WHERE period IN (${bvPeriods.map(() => '?').join(',')})`).get(...bvPeriods);
      const att = r.b > 0 ? (r.a / r.b) * 100 : null;
      const trend = db.prepare(`SELECT period AS label, (COALESCE(SUM(actual_amount),0) / NULLIF(SUM(budget_amount), 0)) * 100 AS value FROM budget_vs_actuals GROUP BY period ORDER BY period DESC LIMIT 12`).all().reverse();
      kpis.push({ key: 'budget_attainment', label: 'Budget Attainment (TTM-3)', value: att, format: 'pct', delta: att !== null ? att - 100 : null, delta_label: 'vs target', trend });
    }
    // Net margin (trailing 3 months from GL)
    const glPeriods = db.prepare(`SELECT DISTINCT period FROM general_ledger ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (glPeriods.length) {
      const pList = glPeriods.map(() => '?').join(',');
      const rev = db.prepare(`SELECT COALESCE(SUM(g.credit),0) AS s FROM general_ledger g JOIN chart_of_accounts a ON g.account_code=a.account_code WHERE a.account_type='revenue' AND g.period IN (${pList})`).get(...glPeriods).s;
      const exp = db.prepare(`SELECT COALESCE(SUM(g.debit),0) AS s FROM general_ledger g JOIN chart_of_accounts a ON g.account_code=a.account_code WHERE a.account_type='expense' AND g.period IN (${pList})`).get(...glPeriods).s;
      const margin = rev > 0 ? ((rev - exp) / rev) * 100 : null;
      const trend = db.prepare(`SELECT g.period AS label,
          (COALESCE(SUM(CASE WHEN a.account_type='revenue' THEN g.credit ELSE 0 END),0)
           - COALESCE(SUM(CASE WHEN a.account_type='expense' THEN g.debit ELSE 0 END),0))
          / NULLIF(SUM(CASE WHEN a.account_type='revenue' THEN g.credit ELSE 0 END), 0) * 100 AS value
          FROM general_ledger g JOIN chart_of_accounts a ON g.account_code=a.account_code
          GROUP BY g.period ORDER BY g.period DESC LIMIT 12`).all().reverse();
      kpis.push({ key: 'net_margin', label: 'Net Margin (TTM-3)', value: margin, format: 'pct', delta: null, delta_label: null, trend });
    }
    // AR balance
    if (latestRev) {
      const ar = db.prepare(`SELECT COALESCE(SUM(outstanding_amount),0) AS s FROM revenue_billing WHERE outstanding_amount > 0`).get().s;
      const priorMonth = db.prepare(`SELECT MAX(period) AS p FROM revenue_billing WHERE period < ?`).get(latestRev)?.p;
      const priorAr = priorMonth ? db.prepare(`SELECT COALESCE(SUM(outstanding_amount),0) AS s FROM revenue_billing WHERE period <= ? AND outstanding_amount > 0`).get(priorMonth).s : null;
      const delta = priorAr ? ((ar - priorAr) / priorAr) * 100 : null;
      const trend = db.prepare(`SELECT period AS label, SUM(outstanding_amount) AS value FROM revenue_billing WHERE outstanding_amount > 0 GROUP BY period ORDER BY period DESC LIMIT 12`).all().reverse();
      kpis.push({ key: 'ar_balance', label: 'AR Outstanding', value: ar, format: 'money', delta, delta_label: 'vs prior mo', trend });
    }
    // Count of active alerts (non-success insights)
    const alertCount = db.prepare(`SELECT COUNT(*) AS c FROM dashboard_insights WHERE severity IN ('warning','error')`).get().c;
    kpis.push({ key: 'alerts', label: 'Open Alerts', value: alertCount, format: 'count', delta: null });

    res.json({ kpis });
  });

  return router;
}

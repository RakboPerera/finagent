// backend/agents/insights/helpers.js
// Shared utilities used by multiple insight rules.

// Format a number to a compact $ string (e.g. 1523421 → "$1.52M").
export function money(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Percent with 1 decimal and sign.
export function pct(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// Given an array of numbers, return their 25/50/75/90 percentiles.
export function percentiles(values) {
  const sorted = [...values].filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { p25: 0, p50: 0, p75: 0, p90: 0 };
  const at = (q) => sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)];
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) };
}

// Periods are YYYY-MM strings; return them sorted ascending.
export function sortedPeriods(db, table) {
  const rows = db.prepare(`SELECT DISTINCT period FROM ${table} ORDER BY period ASC`).all();
  return rows.map(r => r.period);
}

// Take the last N periods of a table.
export function lastNPeriods(db, table, n) {
  return sortedPeriods(db, table).slice(-n);
}

// Describe the data context — used in the narrator prompt to avoid hallucinations.
export function describeDataContext(db) {
  const ctx = { tables: {}, first_period: null, last_period: null };
  for (const t of ['general_ledger', 'revenue_billing', 'budget_vs_actuals', 'cash_flow']) {
    const r = db.prepare(`SELECT COUNT(*) AS total, SUM(is_dummy) AS dummy, MIN(period) AS min_p, MAX(period) AS max_p FROM ${t}`).get();
    ctx.tables[t] = { total: r.total, dummy: r.dummy, user: r.total - r.dummy, min: r.min_p, max: r.max_p };
    if (r.min_p && (!ctx.first_period || r.min_p < ctx.first_period)) ctx.first_period = r.min_p;
    if (r.max_p && (!ctx.last_period || r.max_p > ctx.last_period)) ctx.last_period = r.max_p;
  }
  // Detect where user-uploaded data begins (rough heuristic: min period with is_dummy=0)
  const userStart = db.prepare(`
    SELECT MIN(min_p) AS p FROM (
      SELECT MIN(period) AS min_p FROM revenue_billing WHERE is_dummy = 0
      UNION ALL SELECT MIN(period) AS min_p FROM general_ledger WHERE is_dummy = 0
      UNION ALL SELECT MIN(period) AS min_p FROM budget_vs_actuals WHERE is_dummy = 0
      UNION ALL SELECT MIN(period) AS min_p FROM cash_flow WHERE is_dummy = 0
    )`).get()?.p;
  ctx.user_data_starts_at = userStart;
  return ctx;
}

// Build a short monthly trend series from a table+aggregate for the last N periods.
// Returns [{ period, value }].
export function buildTrendSeries(db, { table, value_expr, where = '1=1', params = [], periods = 12 }) {
  const all = db.prepare(`SELECT period, ${value_expr} AS value FROM ${table} WHERE ${where} GROUP BY period ORDER BY period DESC LIMIT ?`).all(...params, periods);
  return all.reverse();
}

// Convert an array of values to a fingerprint for dedup.
export function signalKey(sig) {
  return [sig.category, sig.entity || '*', sig.period_start || sig.period || '*', sig.account || sig.line_item || '*'].join('|');
}

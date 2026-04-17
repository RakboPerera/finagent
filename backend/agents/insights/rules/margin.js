// Rule: Margin compression — compare current vs prior 3-month margin from GL.
// Margin = (revenue - expense) / revenue, using account_type rollups in general_ledger.
import { money, pct } from '../helpers.js';

export default {
  id: 'margin_compression',
  category: 'expense',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM general_ledger ORDER BY period DESC LIMIT 6`).all().map(r => r.period);
    if (periods.length < 6) return [];
    const [recent, prior] = [periods.slice(0, 3), periods.slice(3, 6)];
    const signals = [];
    // Overall + per entity
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    // Add a synthetic "all entities" row
    const scopes = [{ entity_id: null, entity_code: 'ALL' }, ...entities];
    for (const s of scopes) {
      const marginFor = (window) => {
        const params = [...window];
        let clause = `period IN (${window.map(() => '?').join(',')})`;
        if (s.entity_id) { clause += ' AND entity_id = ?'; params.push(s.entity_id); }
        const rev = db.prepare(`SELECT COALESCE(SUM(credit),0) AS s FROM general_ledger g
          JOIN chart_of_accounts a ON g.account_code = a.account_code
          WHERE a.account_type = 'revenue' AND ${clause}`).get(...params).s;
        const exp = db.prepare(`SELECT COALESCE(SUM(debit),0) AS s FROM general_ledger g
          JOIN chart_of_accounts a ON g.account_code = a.account_code
          WHERE a.account_type = 'expense' AND ${clause}`).get(...params).s;
        if (rev <= 0) return null;
        return { revenue: rev, expense: exp, margin_pct: ((rev - exp) / rev) * 100 };
      };
      const r = marginFor(recent);
      const p = marginFor(prior);
      if (!r || !p) continue;
      const delta = r.margin_pct - p.margin_pct;
      if (Math.abs(delta) < 2) continue; // under 2pp is noise
      const severity = Math.abs(delta) >= 8 ? 'error' : (Math.abs(delta) >= 4 ? 'warning' : 'info');
      const trend = [];
      for (const prd of periods.reverse()) {
        const params = [prd];
        let clause = 'period = ?';
        if (s.entity_id) { clause += ' AND entity_id = ?'; params.push(s.entity_id); }
        const rev = db.prepare(`SELECT COALESCE(SUM(credit),0) AS s FROM general_ledger g JOIN chart_of_accounts a ON g.account_code=a.account_code WHERE a.account_type='revenue' AND ${clause}`).get(...params).s;
        const exp = db.prepare(`SELECT COALESCE(SUM(debit),0) AS s FROM general_ledger g JOIN chart_of_accounts a ON g.account_code=a.account_code WHERE a.account_type='expense' AND ${clause}`).get(...params).s;
        trend.push({ period: prd, value: rev > 0 ? ((rev - exp) / rev) * 100 : 0 });
      }
      signals.push({
        kind: 'margin',
        category: 'expense',
        entity: s.entity_code,
        period_start: prior[0], period_end: recent[recent.length - 1],
        recent_margin_pct: r.margin_pct,
        prior_margin_pct: p.margin_pct,
        delta_pp: delta,
        revenue: r.revenue, expense: r.expense,
        severity: delta > 0 ? 'success' : severity,
        impact_dollars: Math.abs(r.revenue * (delta / 100)),
        trend_data: trend,
        sources: [{ table: 'general_ledger', row_ids: [], period: recent[recent.length - 1] }],
        confidence: 85,
        narrator_headline: `${s.entity_code} net margin ${delta > 0 ? 'expanded' : 'compressed'} ${Math.abs(delta).toFixed(1)}pp — ${pct(p.margin_pct)} → ${pct(r.margin_pct)}.`,
      });
    }
    return signals;
  },
};

// Rule: Budget attainment score per entity for the latest 3 months.
import { money, pct } from '../helpers.js';

export default {
  id: 'budget_attainment',
  category: 'variance',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM budget_vs_actuals ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (periods.length < 1) return [];
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    const signals = [];
    const pList = periods.map(() => '?').join(',');
    for (const ent of entities) {
      const r = db.prepare(`SELECT COALESCE(SUM(budget_amount),0) AS b, COALESCE(SUM(actual_amount),0) AS a
        FROM budget_vs_actuals WHERE entity_id = ? AND period IN (${pList})`).get(ent.entity_id, ...periods);
      if (r.b <= 0) continue;
      const attainment = (r.a / r.b) * 100;
      const delta = attainment - 100;
      if (Math.abs(delta) < 5) continue; // within 5% is on-track
      const severity = Math.abs(delta) >= 20 ? 'error' : (Math.abs(delta) >= 10 ? 'warning' : 'info');
      const trend = db.prepare(`SELECT period, (COALESCE(SUM(actual_amount),0) / NULLIF(SUM(budget_amount),0)) * 100 AS value
        FROM budget_vs_actuals WHERE entity_id = ? GROUP BY period ORDER BY period DESC LIMIT 6`).all(ent.entity_id).reverse();
      signals.push({
        kind: 'budget_attainment',
        category: 'variance',
        entity: ent.entity_code,
        period_start: periods[periods.length - 1], period_end: periods[0],
        attainment_pct: attainment,
        delta_pct: delta,
        total_budget: r.b, total_actual: r.a,
        severity: delta > 0 ? (severity === 'error' ? 'warning' : 'success') : severity,
        impact_dollars: Math.abs(r.a - r.b),
        trend_data: trend,
        sources: [{ table: 'budget_vs_actuals', row_ids: [], period: periods[0] }],
        confidence: 90,
        narrator_headline: `${ent.entity_code} is at ${attainment.toFixed(0)}% of budget across trailing 3 months (${pct(delta)} vs plan).`,
      });
    }
    return signals;
  },
};

// Rule: Year-over-year same-period revenue comparison.
import { money, pct } from '../helpers.js';

export default {
  id: 'yoy',
  category: 'revenue',
  gather(db) {
    const latestRow = db.prepare(`SELECT MAX(period) AS p FROM revenue_billing`).get();
    const latest = latestRow?.p;
    if (!latest) return [];
    const [y, m] = latest.split('-');
    const priorYear = `${Number(y) - 1}-${m}`;
    // Check prior year same month exists
    const existsPrior = db.prepare(`SELECT COUNT(*) AS c FROM revenue_billing WHERE period = ?`).get(priorYear).c;
    if (existsPrior === 0) return [];
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    const signals = [];
    for (const ent of entities) {
      const cur = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE entity_id = ? AND period = ?`).get(ent.entity_id, latest).s;
      const pri = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE entity_id = ? AND period = ?`).get(ent.entity_id, priorYear).s;
      if (pri <= 0) continue;
      const deltaPct = ((cur - pri) / pri) * 100;
      if (Math.abs(deltaPct) < 5) continue;
      const severity = Math.abs(deltaPct) >= 20 ? 'error' : (Math.abs(deltaPct) >= 10 ? 'warning' : 'info');
      // 12-month trend for context
      const trend = db.prepare(`SELECT period, SUM(billed_amount) AS value FROM revenue_billing
        WHERE entity_id = ? GROUP BY period ORDER BY period DESC LIMIT 12`).all(ent.entity_id).reverse();
      const rowIds = db.prepare(`SELECT id FROM revenue_billing WHERE entity_id = ? AND period IN (?, ?) LIMIT 20`).all(ent.entity_id, latest, priorYear).map(r => r.id);
      signals.push({
        kind: 'yoy',
        category: 'revenue',
        entity: ent.entity_code,
        period: latest, prior_period: priorYear,
        current_revenue: cur, prior_year_revenue: pri,
        delta_pct: deltaPct,
        severity: deltaPct > 0 ? (Math.abs(deltaPct) >= 10 ? 'success' : 'info') : severity,
        impact_dollars: Math.abs(cur - pri),
        trend_data: trend,
        sources: [{ table: 'revenue_billing', row_ids: rowIds, period: latest }],
        confidence: 90,
        narrator_headline: `${ent.entity_code} revenue in ${latest} was ${pct(deltaPct)} YoY vs ${priorYear} (${money(cur)} vs ${money(pri)}).`,
      });
    }
    return signals;
  },
};

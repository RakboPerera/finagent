// Rule: Revenue trend comparison — recent window vs prior window, per entity.
import { money, pct } from '../helpers.js';

export default {
  id: 'revenue_trend',
  category: 'revenue',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM revenue_billing ORDER BY period DESC LIMIT 6`).all().map(r => r.period);
    if (periods.length < 6) return [];
    const [recent3, prior3] = [periods.slice(0, 3), periods.slice(3, 6)];
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    const signals = [];
    for (const ent of entities) {
      const recSum = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE entity_id = ? AND period IN (${recent3.map(() => '?').join(',')})`).get(ent.entity_id, ...recent3).s;
      const priSum = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS s FROM revenue_billing WHERE entity_id = ? AND period IN (${prior3.map(() => '?').join(',')})`).get(ent.entity_id, ...prior3).s;
      if (priSum <= 0) continue;
      const deltaPct = ((recSum - priSum) / priSum) * 100;
      if (Math.abs(deltaPct) < 8) continue;
      const severity = Math.abs(deltaPct) >= 25 ? 'error' : (Math.abs(deltaPct) >= 15 ? 'warning' : 'info');
      const trend = db.prepare(`SELECT period, SUM(billed_amount) AS value FROM revenue_billing
        WHERE entity_id = ? GROUP BY period ORDER BY period DESC LIMIT 8`).all(ent.entity_id).reverse();
      const rowIds = db.prepare(`SELECT id FROM revenue_billing WHERE entity_id = ? AND period IN (${recent3.map(() => '?').join(',')})`).all(ent.entity_id, ...recent3).map(r => r.id);
      signals.push({
        kind: 'revenue_trend',
        category: 'revenue',
        entity: ent.entity_code,
        period_start: prior3[0], period_end: recent3[recent3.length - 1],
        recent_window: recent3, prior_window: prior3,
        recent_revenue: recSum, prior_revenue: priSum,
        delta_pct: deltaPct,
        severity: deltaPct > 0 && Math.abs(deltaPct) >= 15 ? 'success' : severity,
        impact_dollars: Math.abs(recSum - priSum),
        trend_data: trend,
        sources: [{ table: 'revenue_billing', row_ids: rowIds.slice(0, 10), period: recent3[recent3.length - 1] }],
        confidence: 85,
        narrator_headline: `${ent.entity_code} revenue ${deltaPct > 0 ? 'grew' : 'declined'} ${pct(deltaPct)} in the last 3 months vs the prior 3 (${money(recSum)} vs ${money(priSum)}).`,
      });
    }
    return signals;
  },
};

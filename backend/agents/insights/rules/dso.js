// Rule: DSO (Days Sales Outstanding) — collection efficiency per entity.
// Approximation: outstanding_amount / avg_daily_billed_last_90d.
import { money, pct, buildTrendSeries } from '../helpers.js';

export default {
  id: 'dso',
  category: 'cash',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM revenue_billing ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (periods.length < 1) return [];
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    const signals = [];
    for (const ent of entities) {
      const recent = db.prepare(`SELECT COALESCE(SUM(billed_amount),0) AS billed, COALESCE(SUM(outstanding_amount),0) AS outstanding
        FROM revenue_billing WHERE entity_id = ? AND period IN (${periods.map(() => '?').join(',')})`).get(ent.entity_id, ...periods);
      if (recent.billed <= 0) continue;
      // ~ (outstanding / billed) * 90 days
      const dso = (recent.outstanding / recent.billed) * 90;
      const collectionRate = ((recent.billed - recent.outstanding) / recent.billed) * 100;
      if (dso < 15) continue; // Ignore entities with fast collection
      const severity = dso >= 75 ? 'error' : (dso >= 45 ? 'warning' : 'info');
      const trend = db.prepare(`SELECT period, SUM(outstanding_amount) AS value FROM revenue_billing
        WHERE entity_id = ? GROUP BY period ORDER BY period DESC LIMIT 8`).all(ent.entity_id).reverse();
      const rowIds = db.prepare(`SELECT id FROM revenue_billing WHERE entity_id = ? AND period = ? AND outstanding_amount > 0`)
        .all(ent.entity_id, periods[0]).map(r => r.id).slice(0, 10);
      signals.push({
        kind: 'dso',
        category: 'cash',
        entity: ent.entity_code,
        period: periods[0],
        dso_days: dso,
        outstanding: recent.outstanding,
        billed: recent.billed,
        collection_rate_pct: collectionRate,
        severity,
        impact_dollars: recent.outstanding,
        trend_data: trend,
        sources: [{ table: 'revenue_billing', row_ids: rowIds, period: periods[0] }],
        confidence: 80,
        narrator_headline: `${ent.entity_code} DSO is ~${dso.toFixed(0)} days — ${money(recent.outstanding)} outstanding, ${pct(collectionRate)} collected.`,
      });
    }
    return signals;
  },
};

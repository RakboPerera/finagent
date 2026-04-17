// Rule: Revenue concentration risk — % of total revenue by entity / BU / product.
import { money, pct } from '../helpers.js';

export default {
  id: 'concentration',
  category: 'concentration',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM revenue_billing ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (periods.length < 1) return [];
    const signals = [];
    const pList = periods.map(() => '?').join(',');

    // Entity concentration
    const entityRows = db.prepare(`SELECT e.entity_code, SUM(r.billed_amount) AS s
      FROM revenue_billing r JOIN entity_master e ON r.entity_id = e.entity_id
      WHERE r.period IN (${pList}) GROUP BY e.entity_code ORDER BY s DESC`).all(...periods);
    const entityTotal = entityRows.reduce((a, b) => a + b.s, 0);
    if (entityTotal > 0 && entityRows.length > 0) {
      const top = entityRows[0];
      const pctTop = (top.s / entityTotal) * 100;
      if (pctTop >= 40 && entityRows.length > 1) {
        const severity = pctTop >= 65 ? 'error' : (pctTop >= 50 ? 'warning' : 'info');
        signals.push({
          kind: 'concentration_entity',
          category: 'concentration',
          entity: top.entity_code,
          period_start: periods[periods.length - 1], period_end: periods[0],
          top_share_pct: pctTop,
          top_revenue: top.s, total_revenue: entityTotal,
          distribution: entityRows.map(r => ({ label: r.entity_code, value: r.s })),
          severity,
          impact_dollars: top.s,
          trend_data: entityRows.slice(0, 5).map(r => ({ period: r.entity_code, value: r.s })),
          sources: [{ table: 'revenue_billing', row_ids: [], period: periods[0] }],
          confidence: 95,
          narrator_headline: `${top.entity_code} contributes ${pct(pctTop)} of total revenue — potential concentration risk.`,
        });
      }
    }

    // Business unit concentration (if data exists)
    const buRows = db.prepare(`SELECT business_unit AS bu, SUM(billed_amount) AS s FROM revenue_billing
      WHERE period IN (${pList}) AND business_unit IS NOT NULL AND business_unit != '' GROUP BY business_unit ORDER BY s DESC`).all(...periods);
    const buTotal = buRows.reduce((a, b) => a + b.s, 0);
    if (buTotal > 0 && buRows.length > 1) {
      const topBu = buRows[0];
      const pctBu = (topBu.s / buTotal) * 100;
      if (pctBu >= 50) {
        signals.push({
          kind: 'concentration_bu',
          category: 'concentration',
          business_unit: topBu.bu,
          period_start: periods[periods.length - 1], period_end: periods[0],
          top_share_pct: pctBu,
          top_revenue: topBu.s, total_revenue: buTotal,
          distribution: buRows.map(r => ({ label: r.bu, value: r.s })),
          severity: pctBu >= 75 ? 'warning' : 'info',
          impact_dollars: topBu.s,
          trend_data: buRows.slice(0, 5).map(r => ({ period: r.bu, value: r.s })),
          sources: [{ table: 'revenue_billing', row_ids: [], period: periods[0] }],
          confidence: 85,
          narrator_headline: `${topBu.bu} business unit drives ${pct(pctBu)} of trailing-3-month revenue.`,
        });
      }
    }
    return signals;
  },
};

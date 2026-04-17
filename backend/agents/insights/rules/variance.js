// Rule: Top unfavorable + favorable variances in the latest period.
import { money, pct, percentiles, buildTrendSeries } from '../helpers.js';

export default {
  id: 'top_variances',
  category: 'variance',
  gather(db) {
    const latestPeriod = db.prepare(`SELECT MAX(period) AS p FROM budget_vs_actuals`).get()?.p;
    if (!latestPeriod) return [];
    // Use percentile of absolute variance as the cutoff — avoids fixed dollar thresholds.
    const allVars = db.prepare(`SELECT ABS(variance) AS v FROM budget_vs_actuals WHERE period = ?`).all(latestPeriod).map(r => r.v);
    const { p75 } = percentiles(allVars);
    const cutoff = Math.max(p75, 1000); // don't flag noise below $1K
    const rows = db.prepare(`
      SELECT b.period, e.entity_code, e.entity_name, a.account_name, a.account_code, a.account_type,
             b.budget_amount, b.actual_amount, b.variance, b.variance_pct
      FROM budget_vs_actuals b
      JOIN entity_master e ON b.entity_id = e.entity_id
      JOIN chart_of_accounts a ON b.account_code = a.account_code
      WHERE b.period = ? AND ABS(b.variance) >= ?
      ORDER BY ABS(b.variance) DESC LIMIT 5
    `).all(latestPeriod, cutoff);
    return rows.map(r => {
      const unfavorable = (r.account_type === 'revenue' && r.variance < 0) ||
                          ((r.account_type === 'expense' || r.account_type === 'liability') && r.variance > 0);
      const severity = Math.abs(r.variance_pct) >= 20 ? 'error' : (Math.abs(r.variance_pct) >= 10 ? 'warning' : 'info');
      // 6-period trend of actual vs budget for this account+entity
      const trend = db.prepare(`SELECT period, actual_amount AS value FROM budget_vs_actuals
        WHERE account_code = ? AND entity_id = (SELECT entity_id FROM entity_master WHERE entity_code = ?)
        ORDER BY period DESC LIMIT 6`).all(r.account_code, r.entity_code).reverse();
      const sourceRowIds = db.prepare(`SELECT b.id FROM budget_vs_actuals b
        JOIN entity_master e ON b.entity_id = e.entity_id
        WHERE b.period = ? AND e.entity_code = ? AND b.account_code = ? LIMIT 5`)
        .all(r.period, r.entity_code, r.account_code).map(x => x.id);
      return {
        kind: 'variance',
        category: 'variance',
        period: r.period, entity: r.entity_code, account: r.account_name,
        budget: r.budget_amount, actual: r.actual_amount,
        variance: r.variance, variance_pct: r.variance_pct,
        unfavorable, severity: unfavorable ? severity : 'success',
        impact_dollars: Math.abs(r.variance),
        trend_data: trend,
        sources: [{ table: 'budget_vs_actuals', row_ids: sourceRowIds, period: r.period }],
        confidence: Math.abs(r.variance_pct) >= 15 ? 95 : 75,
        narrator_headline: `${r.entity_code} ${r.account_name} ${unfavorable ? 'missed' : 'beat'} budget in ${r.period} by ${pct(r.variance_pct)} (${money(r.variance)}).`,
      };
    });
  },
};

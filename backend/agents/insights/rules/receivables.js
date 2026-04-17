// Rule: Aging-bucket view of outstanding AR.
import { money } from '../helpers.js';

export default {
  id: 'receivables',
  category: 'cash',
  gather(db) {
    const latestRow = db.prepare(`SELECT MAX(period) AS p FROM revenue_billing`).get();
    const latest = latestRow?.p;
    if (!latest) return [];
    // Compute aging buckets relative to `latest` (as months).
    const all = db.prepare(`SELECT period, entity_id, SUM(outstanding_amount) AS s FROM revenue_billing WHERE outstanding_amount > 0 GROUP BY period, entity_id`).all();
    const [y, m] = latest.split('-').map(Number);
    const buckets = { current: 0, '30': 0, '60': 0, '90+': 0 };
    for (const r of all) {
      const [py, pm] = r.period.split('-').map(Number);
      const monthsAgo = (y - py) * 12 + (m - pm);
      if (monthsAgo <= 0) buckets.current += r.s;
      else if (monthsAgo === 1) buckets['30'] += r.s;
      else if (monthsAgo === 2) buckets['60'] += r.s;
      else buckets['90+'] += r.s;
    }
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (total <= 0) return [];
    const over60 = buckets['60'] + buckets['90+'];
    const over60Pct = (over60 / total) * 100;
    const severity = over60Pct >= 30 ? 'error' : (over60Pct >= 15 ? 'warning' : 'info');
    const sig = {
      kind: 'ar_aging',
      category: 'cash',
      period: latest,
      buckets,
      total_outstanding: total,
      over_60_pct: over60Pct,
      severity,
      impact_dollars: total,
      trend_data: [
        { period: 'Current', value: buckets.current },
        { period: '30d', value: buckets['30'] },
        { period: '60d', value: buckets['60'] },
        { period: '90+', value: buckets['90+'] },
      ],
      sources: [{ table: 'revenue_billing', row_ids: [], period: latest }],
      confidence: 90,
      narrator_headline: `${money(total)} outstanding across AR — ${over60Pct.toFixed(0)}% aged over 60 days.`,
    };
    return [sig];
  },
};

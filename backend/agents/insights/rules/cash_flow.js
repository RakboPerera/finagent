// Rule: Cash flow direction + operating cash trend.
import { money, pct } from '../helpers.js';

export default {
  id: 'cash_flow',
  category: 'cash',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM cash_flow ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (periods.length < 1) return [];
    const signals = [];
    // Operating cash flow trend (aggregate) — flag if it swings negative or drops materially.
    const opTrend = db.prepare(`SELECT period, SUM(amount) AS value FROM cash_flow
      WHERE category = 'operating' GROUP BY period ORDER BY period DESC LIMIT 6`).all().reverse();
    if (opTrend.length >= 2) {
      const recent = opTrend[opTrend.length - 1];
      const prior = opTrend[opTrend.length - 2];
      const delta = recent.value - prior.value;
      const deltaPct = prior.value !== 0 ? (delta / Math.abs(prior.value)) * 100 : 0;
      if (Math.abs(deltaPct) >= 15 || recent.value < 0) {
        const severity = recent.value < 0 ? 'error' : (Math.abs(deltaPct) >= 30 ? 'warning' : 'info');
        signals.push({
          kind: 'operating_cash',
          category: 'cash',
          period: recent.period,
          recent_value: recent.value, prior_value: prior.value,
          delta_pct: deltaPct,
          severity,
          impact_dollars: Math.abs(delta),
          trend_data: opTrend,
          sources: [{ table: 'cash_flow', row_ids: [], period: recent.period }],
          confidence: 85,
          narrator_headline: recent.value < 0
            ? `Operating cash turned negative in ${recent.period} at ${money(recent.value)}.`
            : `Operating cash ${deltaPct > 0 ? 'improved' : 'weakened'} ${pct(deltaPct)} in ${recent.period} (${money(prior.value)} → ${money(recent.value)}).`,
        });
      }
    }
    // Category breakdown for latest period (for context only — low-severity)
    const latest = periods[0];
    const breakdown = db.prepare(`SELECT category, SUM(amount) AS s FROM cash_flow WHERE period = ? GROUP BY category`).all(latest);
    const net = breakdown.reduce((a, b) => a + b.s, 0);
    signals.push({
      kind: 'cash_mix',
      category: 'cash',
      period: latest,
      net,
      by_category: Object.fromEntries(breakdown.map(b => [b.category, b.s])),
      severity: 'info',
      impact_dollars: Math.abs(net),
      trend_data: opTrend,
      sources: [{ table: 'cash_flow', row_ids: [], period: latest }],
      confidence: 95,
      narrator_headline: `Net cash in ${latest} was ${money(net)} across operating/investing/financing.`,
    });
    return signals;
  },
};

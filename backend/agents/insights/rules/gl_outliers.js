// Rule: GL transaction outliers — entries that are 3× larger than the entity's median.
import { money } from '../helpers.js';

export default {
  id: 'gl_outliers',
  category: 'variance',
  gather(db) {
    const periods = db.prepare(`SELECT DISTINCT period FROM general_ledger ORDER BY period DESC LIMIT 3`).all().map(r => r.period);
    if (periods.length < 1) return [];
    const pList = periods.map(() => '?').join(',');
    // For each entity, find entries where abs(debit+credit) > 3× that entity's 12-month median.
    const entities = db.prepare(`SELECT DISTINCT e.entity_id, e.entity_code FROM entity_master e WHERE e.status = 'active'`).all();
    const signals = [];
    for (const ent of entities) {
      const sizes = db.prepare(`SELECT ABS(COALESCE(debit,0) - COALESCE(credit,0)) AS s FROM general_ledger WHERE entity_id = ?`).all(ent.entity_id).map(r => r.s).filter(s => s > 0).sort((a, b) => a - b);
      if (sizes.length < 10) continue;
      const median = sizes[Math.floor(sizes.length / 2)];
      const threshold = median * 3;
      const outliers = db.prepare(`SELECT g.id, g.period, g.description, g.debit, g.credit, a.account_name
        FROM general_ledger g JOIN chart_of_accounts a ON g.account_code = a.account_code
        WHERE g.entity_id = ? AND g.period IN (${pList})
          AND ABS(COALESCE(g.debit,0) - COALESCE(g.credit,0)) > ?
        ORDER BY ABS(COALESCE(g.debit,0) - COALESCE(g.credit,0)) DESC LIMIT 3`).all(ent.entity_id, ...periods, threshold);
      for (const o of outliers) {
        const amount = Math.abs((o.debit || 0) - (o.credit || 0));
        if (amount < median * 5) continue; // only really strong outliers
        signals.push({
          kind: 'gl_outlier',
          category: 'variance',
          entity: ent.entity_code,
          period: o.period,
          account: o.account_name,
          amount,
          multiplier: (amount / median).toFixed(1),
          severity: 'warning',
          impact_dollars: amount,
          trend_data: [],
          sources: [{ table: 'general_ledger', row_ids: [o.id], period: o.period }],
          confidence: 75,
          narrator_headline: `${ent.entity_code} ${o.period} — unusually large ${o.account_name} entry of ${money(amount)} (${(amount / median).toFixed(1)}× the entity median).`,
        });
      }
    }
    return signals.slice(0, 5); // cap to avoid noise
  },
};

// Rule: Data freshness + empty tables.
export default {
  id: 'data_quality',
  category: 'freshness',
  gather(db) {
    const signals = [];
    const tables = ['entity_master', 'chart_of_accounts', 'general_ledger', 'revenue_billing', 'budget_vs_actuals', 'cash_flow'];
    const empty = [];
    for (const t of tables) {
      const r = db.prepare(`SELECT COUNT(*) AS c, MAX(updated_at) AS u FROM ${t}`).get();
      if (r.c === 0) empty.push(t);
    }
    if (empty.length > 0) {
      signals.push({
        kind: 'empty_tables',
        category: 'freshness',
        empty_tables: empty,
        severity: 'error',
        impact_dollars: 0,
        confidence: 100,
        trend_data: [],
        sources: [],
        narrator_headline: `${empty.length} table${empty.length > 1 ? 's are' : ' is'} empty: ${empty.join(', ')}.`,
      });
    }
    // Period gaps — if a table's max period is older than the overall latest, flag it.
    const periodTables = ['general_ledger', 'revenue_billing', 'budget_vs_actuals', 'cash_flow'];
    const maxes = {};
    for (const t of periodTables) {
      const p = db.prepare(`SELECT MAX(period) AS p FROM ${t}`).get()?.p;
      if (p) maxes[t] = p;
    }
    const overallMax = Object.values(maxes).sort().reverse()[0];
    const stale = Object.entries(maxes).filter(([_, p]) => p < overallMax);
    if (stale.length > 0) {
      signals.push({
        kind: 'period_gap',
        category: 'freshness',
        overall_max: overallMax,
        stale,
        severity: 'warning',
        impact_dollars: 0,
        confidence: 100,
        trend_data: [],
        sources: [],
        narrator_headline: `${stale.length} table${stale.length > 1 ? 's are' : ' is'} behind on data: ${stale.map(([t, p]) => `${t}@${p}`).join(', ')} (latest elsewhere: ${overallMax}).`,
      });
    }
    return signals;
  },
};

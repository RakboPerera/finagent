// backend/agents/confidence.js
// 5-factor confidence score per the Tool 1 design doc.

export function scoreConfidence({
  rowsConsidered = 0,
  rowsWithAllRequired = 0,
  dataAgeDays = null,
  assumptionsMade = 0,
  crossValidationAgreement = null, // 0..1 or null
  benchmarkDeviation = null, // 0..1, where 0=on-target, 1=very off
}) {
  // Completeness (30%)
  const completeness = rowsConsidered > 0 ? (rowsWithAllRequired / rowsConsidered) * 100 : 100;

  // Freshness (20%) — linear decay 0d=100, 90d=0
  let freshness;
  if (dataAgeDays == null) freshness = 80;
  else freshness = Math.max(0, 100 - (dataAgeDays / 90) * 100);

  // Assumption count (20%) — 100 minus 10 per assumption
  const assumptions = Math.max(0, 100 - assumptionsMade * 10);

  // Cross-validation (15%)
  const crossVal = crossValidationAgreement == null ? 80 : crossValidationAgreement * 100;

  // Benchmark deviation (15%)
  const benchmark = benchmarkDeviation == null ? 80 : Math.max(0, (1 - benchmarkDeviation) * 100);

  const total = Math.round(
    completeness * 0.30 + freshness * 0.20 + assumptions * 0.20 + crossVal * 0.15 + benchmark * 0.15
  );

  return {
    total,
    band: total >= 80 ? 'green' : total >= 50 ? 'yellow' : 'red',
    factors: {
      completeness: { score: Math.round(completeness), weight: 30 },
      freshness: { score: Math.round(freshness), weight: 20 },
      assumptions: { score: Math.round(assumptions), weight: 20 },
      cross_validation: { score: Math.round(crossVal), weight: 15 },
      benchmark_deviation: { score: Math.round(benchmark), weight: 15 },
    },
  };
}

// Compute confidence from an agent execution trace — improved extraction
export function scoreFromTrace(trace) {
  let rowsConsidered = 0;
  let rowsWithAllRequired = 0;
  let assumptionsMade = 0;
  let tablesUsed = new Set();
  let totalValues = [];
  let dataAgeDays = null;

  for (const t of trace) {
    if (t.type === 'tool_call' && t.output) {
      // Track tables for cross-validation
      if (t.input?.table) tablesUsed.add(t.input.table);
      if (t.output?.source_metadata?.table) tablesUsed.add(t.output.source_metadata.table);
      if (t.output?.source_metadata?.primary_table) tablesUsed.add(t.output.source_metadata.primary_table);

      // Count rows and check completeness
      if (Array.isArray(t.output.rows)) {
        rowsConsidered += t.output.rows.length;
        for (const row of t.output.rows) {
          const hasNulls = Object.values(row).some(v => v == null || v === '');
          if (!hasNulls) rowsWithAllRequired++;
        }
        // Collect numeric values for benchmark deviation
        for (const row of t.output.rows) {
          for (const v of Object.values(row)) {
            if (typeof v === 'number' && Number.isFinite(v)) totalValues.push(v);
          }
        }
      }

      // Extract data freshness from metadata calls
      if (t.tool === 'get_metadata' && t.output.last_updated) {
        const lastUpdated = new Date(t.output.last_updated);
        if (!isNaN(lastUpdated.getTime())) {
          const ageDays = Math.max(0, (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
          if (dataAgeDays === null || ageDays > dataAgeDays) dataAgeDays = ageDays;
        }
      }
    }

    // Count assumption language in LLM text
    if (t.text && typeof t.text === 'string') {
      const matches = t.text.match(/\b(assumed|estimated|approximately|roughly|probably|likely|might be|could be|unclear)\b/gi);
      if (matches) assumptionsMade += matches.length;
    }
  }

  // Cross-validation: multiple tables = higher confidence
  // 1 table = 0.6, 2 = 0.8, 3+ = 0.95
  let crossValidationAgreement = null;
  if (tablesUsed.size >= 3) crossValidationAgreement = 0.95;
  else if (tablesUsed.size === 2) crossValidationAgreement = 0.80;
  else if (tablesUsed.size === 1) crossValidationAgreement = 0.60;

  // Benchmark deviation: check if values are within reasonable financial ranges
  let benchmarkDeviation = null;
  if (totalValues.length > 0) {
    // Simple heuristic: if any value is > 1 billion or negative where unexpected, flag slightly
    const absValues = totalValues.map(Math.abs);
    const maxVal = Math.max(...absValues);
    if (maxVal > 1e12) benchmarkDeviation = 0.5; // unreasonably large
    else if (maxVal > 1e9) benchmarkDeviation = 0.2;
    else benchmarkDeviation = 0.05; // normal range
  }

  return scoreConfidence({
    rowsConsidered,
    rowsWithAllRequired,
    dataAgeDays: dataAgeDays ?? 1,
    assumptionsMade,
    crossValidationAgreement,
    benchmarkDeviation,
  });
}

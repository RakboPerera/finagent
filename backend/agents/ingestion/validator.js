// backend/agents/ingestion/validator.js
// Agent 4: Validation. Layer A is pure JS (mechanical). Layer B is semantic checks (outlier, sign, period, cross-field).
import { CANONICAL_SCHEMAS } from '../../schema.js';

export async function validate({ db, provider, apiKey, targetTable, mappedRows }) {
  const def = CANONICAL_SCHEMAS[targetTable];
  if (!def) return { error: `Unknown table: ${targetTable}` };

  const issues = []; // { row_index, field, severity, type, message }
  const validatedRows = [];

  // Build lookup sets for FK fields
  const fkLookups = {};
  for (const f of def.fields) {
    if (f.references) {
      const [refTable, refField] = f.references.split('.');
      const rows = db.prepare(`SELECT DISTINCT ${refField} AS v FROM ${refTable}`).all();
      fkLookups[f.name] = new Set(rows.map(r => r.v));
    }
  }

  // PK uniqueness within upload
  const pkSeen = new Set();

  // Layer A: Mechanical
  for (let i = 0; i < mappedRows.length; i++) {
    const row = mappedRows[i];
    const rowIssues = [];

    for (const f of def.fields) {
      const v = row[f.name];

      // Required
      if (f.required && (v == null || v === '')) {
        rowIssues.push({ row_index: i, field: f.name, severity: 'error', type: 'required_missing', message: `Required field ${f.name} is missing` });
        continue;
      }
      if (v == null || v === '') continue;

      // Type
      if (f.type === 'REAL' || f.type === 'INTEGER') {
        const n = Number(v);
        if (Number.isNaN(n)) {
          rowIssues.push({ row_index: i, field: f.name, severity: 'error', type: 'type_mismatch', message: `${f.name}: expected number, got "${v}"` });
        } else {
          row[f.name] = f.type === 'INTEGER' ? Math.round(n) : n;
        }
      }

      // Enum
      if (f.enum && !f.enum.includes(String(v).toLowerCase())) {
        const lower = String(v).toLowerCase();
        if (f.enum.includes(lower)) {
          row[f.name] = lower;
        } else {
          rowIssues.push({ row_index: i, field: f.name, severity: 'warning', type: 'enum_violation', message: `${f.name}: "${v}" not in [${f.enum.join(', ')}]` });
        }
      }

      // FK
      if (fkLookups[f.name] && !fkLookups[f.name].has(v)) {
        rowIssues.push({ row_index: i, field: f.name, severity: 'error', type: 'fk_violation', message: `${f.name}: "${v}" does not exist in referenced table` });
      }

      // Period format
      if (f.name === 'period' && typeof v === 'string' && !/^\d{4}-\d{2}$/.test(v)) {
        rowIssues.push({ row_index: i, field: f.name, severity: 'warning', type: 'format_anomaly', message: `Period "${v}" is not in YYYY-MM format` });
      }
    }

    // PK uniqueness
    const pkField = def.primary_key;
    if (pkField && row[pkField] != null) {
      if (pkSeen.has(row[pkField])) {
        rowIssues.push({ row_index: i, field: pkField, severity: 'error', type: 'duplicate_pk', message: `Duplicate primary key: ${row[pkField]}` });
      }
      pkSeen.add(row[pkField]);
    }

    issues.push(...rowIssues);
    validatedRows.push({ row, has_error: rowIssues.some(x => x.severity === 'error'), issues: rowIssues });
  }

  // Layer B: Semantic
  const semanticIssues = runSemanticChecks({ targetTable, validatedRows, def });
  issues.push(...semanticIssues);

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const validRowCount = validatedRows.filter(r => !r.has_error).length;

  return {
    target_table: targetTable,
    total_rows: mappedRows.length,
    valid_rows: validRowCount,
    error_count: errorCount,
    warning_count: warningCount,
    issues,
    rows: validatedRows,
  };
}

function runSemanticChecks({ targetTable, validatedRows, def }) {
  const issues = [];
  if (!def) return issues;

  // 1. Outlier detection on numeric fields (IQR-based)
  const numericFields = def.fields.filter(f => f.type === 'REAL' || f.type === 'INTEGER').map(f => f.name);
  for (const field of numericFields) {
    const values = validatedRows.map(r => Number(r.row[field])).filter(v => Number.isFinite(v));
    if (values.length < 5) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const upperBound = q3 + iqr * 3;
    const lowerBound = q1 - iqr * 3;
    for (let i = 0; i < validatedRows.length; i++) {
      const v = Number(validatedRows[i].row[field]);
      if (!Number.isFinite(v)) continue;
      if (v > upperBound || v < lowerBound) {
        issues.push({
          row_index: i, field, severity: 'warning', type: 'outlier',
          message: `${field}: value ${v.toLocaleString()} is far outside the typical range (${q1.toFixed(0)}–${q3.toFixed(0)})`,
        });
      }
    }
  }

  // 2. Sign anomaly detection — detect when a numeric field has mixed signs and one sign is rare (<15%)
  for (const field of numericFields) {
    const values = validatedRows.map((r, i) => ({ v: Number(r.row[field]), i })).filter(x => Number.isFinite(x.v) && x.v !== 0);
    if (values.length < 5) continue;
    const positives = values.filter(x => x.v > 0);
    const negatives = values.filter(x => x.v < 0);
    const minority = positives.length < negatives.length ? positives : negatives;
    const ratio = minority.length / values.length;
    if (ratio > 0 && ratio < 0.15) {
      for (const m of minority) {
        issues.push({
          row_index: m.i, field, severity: 'warning', type: 'sign_anomaly',
          message: `${field}: value ${m.v.toLocaleString()} has unusual sign — ${positives.length} positive vs ${negatives.length} negative values in this column`,
        });
      }
    }
  }

  // 3. Period anomaly detection
  const periodField = def.fields.find(f => f.name === 'period');
  if (periodField) {
    const periods = validatedRows.map((r, i) => ({ p: r.row.period, i })).filter(x => typeof x.p === 'string' && /^\d{4}-\d{2}$/.test(x.p));
    for (const { p, i } of periods) {
      const [year, month] = p.split('-').map(Number);
      // Future date check
      const now = new Date();
      const periodDate = new Date(year, month - 1, 1);
      if (periodDate > new Date(now.getFullYear(), now.getMonth() + 3, 1)) {
        issues.push({
          row_index: i, field: 'period', severity: 'warning', type: 'period_future',
          message: `Period "${p}" is more than 3 months in the future`,
        });
      }
      // Invalid month
      if (month < 1 || month > 12) {
        issues.push({
          row_index: i, field: 'period', severity: 'error', type: 'period_invalid',
          message: `Period "${p}" has invalid month (${month})`,
        });
      }
    }

    // Period gap detection — find missing months in the sequence
    if (periods.length >= 6) {
      const sortedPeriods = [...new Set(periods.map(x => x.p))].sort();
      for (let i = 1; i < sortedPeriods.length; i++) {
        const [y1, m1] = sortedPeriods[i - 1].split('-').map(Number);
        const [y2, m2] = sortedPeriods[i].split('-').map(Number);
        const monthDiff = (y2 - y1) * 12 + (m2 - m1);
        if (monthDiff > 1 && monthDiff <= 3) {
          issues.push({
            row_index: -1, field: 'period', severity: 'warning', type: 'period_gap',
            message: `Gap detected: no data between ${sortedPeriods[i - 1]} and ${sortedPeriods[i]} (${monthDiff - 1} missing month${monthDiff > 2 ? 's' : ''})`,
          });
        }
      }
    }
  }

  // 4. Cross-field consistency checks
  if (targetTable === 'budget_vs_actuals') {
    for (let i = 0; i < validatedRows.length; i++) {
      const r = validatedRows[i].row;
      const actual = Number(r.actual_amount);
      const budget = Number(r.budget_amount);
      const variance = Number(r.variance);
      if (Number.isFinite(actual) && Number.isFinite(budget) && Number.isFinite(variance)) {
        const computed = actual - budget;
        if (Math.abs(computed - variance) > 1) {
          issues.push({
            row_index: i, field: 'variance', severity: 'warning', type: 'cross_field',
            message: `variance (${variance}) does not equal actual_amount - budget_amount (${computed.toFixed(2)})`,
          });
        }
      }
      // Variance percentage check
      const vpct = Number(r.variance_pct);
      if (Number.isFinite(vpct) && Number.isFinite(variance) && Number.isFinite(budget) && Math.abs(budget) > 0) {
        const computedPct = (variance / Math.abs(budget)) * 100;
        if (Math.abs(computedPct - vpct) > 2) {
          issues.push({
            row_index: i, field: 'variance_pct', severity: 'warning', type: 'cross_field',
            message: `variance_pct (${vpct}%) does not match computed ${computedPct.toFixed(1)}%`,
          });
        }
      }
    }
  }

  if (targetTable === 'revenue_billing') {
    for (let i = 0; i < validatedRows.length; i++) {
      const r = validatedRows[i].row;
      const billed = Number(r.billed_amount);
      const collected = Number(r.collected_amount);
      const outstanding = Number(r.outstanding_amount);
      if (Number.isFinite(billed) && Number.isFinite(collected) && Number.isFinite(outstanding)) {
        const expected = billed - collected;
        if (Math.abs(expected - outstanding) > 1) {
          issues.push({
            row_index: i, field: 'outstanding_amount', severity: 'warning', type: 'cross_field',
            message: `outstanding_amount (${outstanding}) does not equal billed - collected (${expected.toFixed(2)})`,
          });
        }
        // Collected should not exceed billed
        if (collected > billed * 1.05) {
          issues.push({
            row_index: i, field: 'collected_amount', severity: 'warning', type: 'cross_field',
            message: `collected_amount (${collected}) exceeds billed_amount (${billed}) by more than 5%`,
          });
        }
      }
    }
  }

  if (targetTable === 'general_ledger') {
    for (let i = 0; i < validatedRows.length; i++) {
      const r = validatedRows[i].row;
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      // Both debit and credit should not be non-zero simultaneously
      if (Number.isFinite(debit) && Number.isFinite(credit) && debit > 0 && credit > 0) {
        issues.push({
          row_index: i, field: 'debit', severity: 'warning', type: 'cross_field',
          message: `Both debit (${debit}) and credit (${credit}) are non-zero — typically only one should be populated per entry`,
        });
      }
    }
  }

  return issues;
}

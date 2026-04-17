// backend/agents/ingestion/reconciler.js
// Agent 5: Reconciliation. Compare validated upload against existing canonical data.
import { CANONICAL_SCHEMAS } from '../../schema.js';

// Conflict-detection keys per table — what makes a "duplicate" or a "conflict"
const CONFLICT_KEYS = {
  entity_master: ['entity_id'],
  chart_of_accounts: ['account_code'],
  general_ledger: ['period', 'entity_id', 'account_code'],
  revenue_billing: ['period', 'entity_id', 'business_unit', 'product_line'],
  budget_vs_actuals: ['period', 'entity_id', 'account_code'],
  cash_flow: ['period', 'entity_id', 'category', 'line_item'],
};

// Numeric "value" fields whose disagreement counts as a conflict
const VALUE_FIELDS = {
  entity_master: ['entity_name', 'currency', 'status'],
  chart_of_accounts: ['account_name', 'account_type'],
  general_ledger: ['debit', 'credit', 'closing_balance'],
  revenue_billing: ['billed_amount', 'collected_amount', 'outstanding_amount'],
  budget_vs_actuals: ['budget_amount', 'actual_amount'],
  cash_flow: ['amount'],
};

export function reconcile({ db, targetTable, validatedRows }) {
  const conflictKeys = CONFLICT_KEYS[targetTable];
  const valueFields = VALUE_FIELDS[targetTable] || [];
  if (!conflictKeys) return { error: `No conflict-detection rule defined for ${targetTable}` };

  const conflicts = [];
  const exact_duplicates = [];
  const new_rows = [];

  for (let i = 0; i < validatedRows.length; i++) {
    const vr = validatedRows[i];
    if (vr.has_error) continue; // skip errored rows
    const row = vr.row;

    // Build lookup query
    const whereClauses = conflictKeys.map(k => `${k} = ?`).join(' AND ');
    const params = conflictKeys.map(k => row[k]);
    const existing = db.prepare(`SELECT * FROM ${targetTable} WHERE ${whereClauses} LIMIT 5`).all(...params);

    if (existing.length === 0) {
      new_rows.push({ row_index: i, row });
      continue;
    }

    // Check for exact match on value fields
    let isExactMatch = false;
    let conflictingExisting = null;
    for (const ex of existing) {
      let allMatch = true;
      for (const vf of valueFields) {
        const a = row[vf], b = ex[vf];
        if (typeof a === 'number' || typeof b === 'number') {
          if (Math.abs(Number(a || 0) - Number(b || 0)) > 0.01) { allMatch = false; break; }
        } else if (String(a ?? '') !== String(b ?? '')) {
          allMatch = false; break;
        }
      }
      if (allMatch) { isExactMatch = true; break; }
      if (!conflictingExisting) conflictingExisting = ex;
    }

    if (isExactMatch) {
      exact_duplicates.push({ row_index: i, row });
    } else {
      conflicts.push({
        row_index: i,
        new_row: row,
        existing_row: conflictingExisting,
        conflict_keys: Object.fromEntries(conflictKeys.map(k => [k, row[k]])),
        differing_fields: valueFields.filter(vf => {
          const a = row[vf], b = conflictingExisting?.[vf];
          if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a || 0) - Number(b || 0)) > 0.01;
          return String(a ?? '') !== String(b ?? '');
        }),
      });
    }
  }

  return {
    target_table: targetTable,
    total_considered: validatedRows.filter(r => !r.has_error).length,
    new_rows_count: new_rows.length,
    exact_duplicates_count: exact_duplicates.length,
    conflicts_count: conflicts.length,
    new_rows,
    exact_duplicates,
    conflicts,
  };
}

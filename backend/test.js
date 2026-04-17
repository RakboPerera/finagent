// backend/test.js
// Smoke tests for non-LLM paths. Run with: node test.js
import { getDb } from './database.js';
import { ensureSchema } from './schema.js';
import { seedDummyData } from './seed.js';
import { makeChatTools } from './tools/chatTools.js';
import { validate } from './agents/ingestion/validator.js';
import { reconcile } from './agents/ingestion/reconciler.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r === false) { console.log(`✗ ${name}`); failed++; }
    else { console.log(`✓ ${name}`); passed++; }
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failed++;
  }
}
async function testAsync(name, fn) {
  try {
    const r = await fn();
    if (r === false) { console.log(`✗ ${name}`); failed++; }
    else { console.log(`✓ ${name}`); passed++; }
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

async function main() {
  // Use a fresh in-memory-ish DB for testing — delete persisted db
  const fs = await import('fs');
  const path = await import('path');
  const dbPath = path.join(process.cwd(), 'data', 'finagent.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = await getDb();
  await ensureSchema(db);
  await seedDummyData(db);

  console.log('\n--- Schema & seed ---');
  test('6 entities... no, 4 entities seeded', () => {
    const r = db.prepare('SELECT COUNT(*) AS c FROM entity_master').get();
    return r.c === 4;
  });
  test('20 accounts seeded', () => {
    const r = db.prepare('SELECT COUNT(*) AS c FROM chart_of_accounts').get();
    return r.c === 20;
  });
  test('GL has rows', () => {
    const r = db.prepare('SELECT COUNT(*) AS c FROM general_ledger').get();
    return r.c > 1500;
  });
  test('All seeded rows are flagged is_dummy=1', () => {
    const r = db.prepare('SELECT COUNT(*) AS c FROM general_ledger WHERE is_dummy = 0').get();
    return r.c === 0;
  });
  test('ACME-LA discontinued mid-2024 (no 2024-12 GL)', () => {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM general_ledger WHERE entity_id = 'ENT-004' AND period >= '2024-07'`).get();
    return r.c === 0;
  });
  test('Q3 2024 marketing overrun anomaly present (>20% variance)', () => {
    const r = db.prepare(`SELECT variance_pct FROM budget_vs_actuals WHERE account_code = '6200' AND period = '2024-08' AND entity_id = 'ENT-001'`).get();
    return r && r.variance_pct >= 20;
  });

  console.log('\n--- Chat tools ---');
  const tools = makeChatTools(db);

  await testAsync('query_table returns rows', async () => {
    const r = await tools.query_table({ table: 'entity_master' });
    return r.rows && r.rows.length === 4 && r.source_metadata?.table === 'entity_master';
  });
  await testAsync('query_table with filter', async () => {
    const r = await tools.query_table({ table: 'entity_master', filters: [{ field: 'status', op: '=', value: 'active' }] });
    return r.rows.length === 3;
  });
  await testAsync('query_table aggregation', async () => {
    const r = await tools.query_table({
      table: 'general_ledger',
      filters: [{ field: 'account_code', op: '=', value: '4000' }, { field: 'period', op: 'between', value: ['2024-01', '2024-12'] }],
      aggregations: [{ fn: 'sum', field: 'credit', alias: 'total_revenue' }],
    });
    return r.rows.length === 1 && r.rows[0].total_revenue > 0;
  });
  await testAsync('query_table rejects bad operator', async () => {
    const r = await tools.query_table({ table: 'entity_master', filters: [{ field: 'status', op: 'DROP', value: 'x' }] });
    return r.error && /not allowed/i.test(r.error);
  });
  await testAsync('query_table rejects bad identifier', async () => {
    const r = await tools.query_table({ table: 'entity_master; DROP TABLE entity_master--' });
    return r.error;
  });
  await testAsync('join_query works', async () => {
    const r = await tools.query_table; // sanity import check
    const r2 = await tools.join_query({
      primary_table: 'general_ledger',
      joins: [{ join_to: 'entity_master' }, { join_to: 'chart_of_accounts' }],
      filters: [{ table: 'chart_of_accounts', field: 'account_type', op: '=', value: 'revenue' }, { table: 'general_ledger', field: 'period', op: '=', value: '2024-03' }],
      aggregations: [{ fn: 'sum', table: 'general_ledger', field: 'credit', alias: 'rev' }],
      group_by: [{ table: 'entity_master', field: 'entity_code', alias: 'entity' }],
    });
    return r2.rows.length > 0 && r2.rows[0].rev > 0;
  });
  await testAsync('join_query rejects undefined join', async () => {
    const r = await tools.join_query({
      primary_table: 'general_ledger',
      joins: [{ join_to: 'audit_log' }],
    });
    return r.error && /not allowed/i.test(r.error);
  });
  await testAsync('calculate growth_rate', async () => {
    const r = await tools.calculate({ expression: 'growth_rate', params: { current: 110, previous: 100 } });
    return r.result === 10;
  });
  await testAsync('calculate variance', async () => {
    const r = await tools.calculate({ expression: 'variance', params: { actual: 90, budget: 100 } });
    return r.result === -10;
  });
  await testAsync('calculate margin', async () => {
    const r = await tools.calculate({ expression: 'margin', params: { numerator: 25, denominator: 100 } });
    return r.result === 25;
  });
  await testAsync('get_metadata works', async () => {
    const r = await tools.get_metadata({ table: 'general_ledger' });
    return r.total_rows === 1800 && r.dummy_rows === 1800 && r.source_breakdown.length > 0;
  });
  await testAsync('lookup_canonical_values works', async () => {
    const r = await tools.lookup_canonical_values({ table: 'entity_master', column: 'entity_code' });
    return r.values && r.values.length === 4;
  });

  console.log('\n--- Validator (Layer A mechanical) ---');
  await testAsync('validator catches missing required field', async () => {
    const r = await validate({
      db, provider: 'anthropic', apiKey: null, targetTable: 'entity_master',
      mappedRows: [{ entity_id: 'TEST-1', entity_name: 'Test' /* missing entity_code, currency, status */ }],
    });
    return r.error_count >= 3;
  });
  await testAsync('validator catches FK violation', async () => {
    const r = await validate({
      db, provider: 'anthropic', apiKey: null, targetTable: 'general_ledger',
      mappedRows: [{ entry_id: 'GL-T1', period: '2024-01', entity_id: 'NONEXISTENT', account_code: '4000', closing_balance: 100 }],
    });
    return r.issues.some(i => i.type === 'fk_violation');
  });
  await testAsync('validator detects duplicate PK in upload', async () => {
    const r = await validate({
      db, provider: 'anthropic', apiKey: null, targetTable: 'entity_master',
      mappedRows: [
        { entity_id: 'DUP-1', entity_name: 'A', entity_code: 'A', currency: 'USD', status: 'active' },
        { entity_id: 'DUP-1', entity_name: 'B', entity_code: 'B', currency: 'USD', status: 'active' },
      ],
    });
    return r.issues.some(i => i.type === 'duplicate_pk');
  });

  console.log('\n--- Reconciler ---');
  await testAsync('reconciler finds existing entity as conflict/duplicate', async () => {
    const r = reconcile({
      db, targetTable: 'entity_master',
      validatedRows: [{ has_error: false, row: { entity_id: 'ENT-001', entity_name: 'CHANGED NAME', entity_code: 'ACME-NA', currency: 'USD', status: 'active' } }],
    });
    return r.conflicts_count === 1 || r.exact_duplicates_count === 1;
  });
  await testAsync('reconciler categorises new rows correctly', async () => {
    const r = reconcile({
      db, targetTable: 'entity_master',
      validatedRows: [{ has_error: false, row: { entity_id: 'NEW-X', entity_name: 'Newco', entity_code: 'NEW', currency: 'USD', status: 'active' } }],
    });
    return r.new_rows_count === 1;
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

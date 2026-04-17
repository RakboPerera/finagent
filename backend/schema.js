// backend/schema.js
// All 12 tables. System columns (id, client_id, source, source_row_ref,
// created_at, updated_at, created_by, updated_by, confidence, is_dummy)
// are added to every canonical table.

// Canonical table field definitions (used by API + ingestion agents)
export const CANONICAL_SCHEMAS = {
  entity_master: {
    label: 'Entity Master',
    description: 'Legal entities, regions, currencies, and consolidation groups.',
    primary_key: 'entity_id',
    fields: [
      { name: 'entity_id', type: 'TEXT', required: true, description: 'Unique entity identifier' },
      { name: 'entity_name', type: 'TEXT', required: true, description: 'Legal or operating name' },
      { name: 'entity_code', type: 'TEXT', required: true, description: 'Short code' },
      { name: 'region', type: 'TEXT', required: false, description: 'Geographic region' },
      { name: 'currency', type: 'TEXT', required: true, description: 'Reporting currency (ISO 4217)' },
      { name: 'consolidation_group', type: 'TEXT', required: false, description: 'Parent group for consolidation' },
      { name: 'status', type: 'TEXT', required: true, description: 'active / inactive / archived', enum: ['active', 'inactive', 'archived'] },
    ],
  },
  chart_of_accounts: {
    label: 'Chart of Accounts',
    description: 'Account codes, types, and hierarchy.',
    primary_key: 'account_code',
    fields: [
      { name: 'account_code', type: 'TEXT', required: true, description: 'Unique account code' },
      { name: 'account_name', type: 'TEXT', required: true, description: 'Descriptive name' },
      { name: 'account_type', type: 'TEXT', required: true, description: 'asset / liability / equity / revenue / expense', enum: ['asset', 'liability', 'equity', 'revenue', 'expense'] },
      { name: 'parent_account', type: 'TEXT', required: false, description: 'Parent account code for hierarchy' },
      { name: 'currency', type: 'TEXT', required: true, description: 'Account currency' },
      { name: 'is_active', type: 'INTEGER', required: true, description: 'Whether account is in use (0/1)' },
    ],
  },
  general_ledger: {
    label: 'General Ledger',
    description: 'Transactional spine — every period/entity/account combination.',
    primary_key: 'entry_id',
    fields: [
      { name: 'entry_id', type: 'TEXT', required: true, description: 'Unique entry ID' },
      { name: 'period', type: 'TEXT', required: true, description: 'Reporting period (YYYY-MM)' },
      { name: 'entity_id', type: 'TEXT', required: true, description: 'Reference to entity_master', references: 'entity_master.entity_id' },
      { name: 'account_code', type: 'TEXT', required: true, description: 'Reference to chart_of_accounts', references: 'chart_of_accounts.account_code' },
      { name: 'debit', type: 'REAL', required: false, description: 'Debit amount' },
      { name: 'credit', type: 'REAL', required: false, description: 'Credit amount' },
      { name: 'closing_balance', type: 'REAL', required: true, description: 'Period-end balance' },
      { name: 'description', type: 'TEXT', required: false, description: 'Transaction description' },
    ],
  },
  revenue_billing: {
    label: 'Revenue & Billing',
    description: 'Billed/collected/outstanding by entity, BU, and product.',
    primary_key: 'record_id',
    fields: [
      { name: 'record_id', type: 'TEXT', required: true, description: 'Unique record ID' },
      { name: 'period', type: 'TEXT', required: true, description: 'Reporting period (YYYY-MM)' },
      { name: 'entity_id', type: 'TEXT', required: true, description: 'Reference to entity_master', references: 'entity_master.entity_id' },
      { name: 'business_unit', type: 'TEXT', required: false, description: 'BU or department' },
      { name: 'product_line', type: 'TEXT', required: false, description: 'Product or service line' },
      { name: 'billed_amount', type: 'REAL', required: true, description: 'Amount invoiced' },
      { name: 'collected_amount', type: 'REAL', required: true, description: 'Amount received' },
      { name: 'outstanding_amount', type: 'REAL', required: true, description: 'Amount still due' },
      { name: 'currency', type: 'TEXT', required: true, description: 'Transaction currency' },
    ],
  },
  budget_vs_actuals: {
    label: 'Budget vs Actuals',
    description: 'Budget, actual, and variance per account/period/entity.',
    primary_key: 'record_id',
    fields: [
      { name: 'record_id', type: 'TEXT', required: true, description: 'Unique record ID' },
      { name: 'period', type: 'TEXT', required: true, description: 'Reporting period (YYYY-MM)' },
      { name: 'entity_id', type: 'TEXT', required: true, description: 'Reference to entity_master', references: 'entity_master.entity_id' },
      { name: 'account_code', type: 'TEXT', required: true, description: 'Reference to chart_of_accounts', references: 'chart_of_accounts.account_code' },
      { name: 'budget_amount', type: 'REAL', required: true, description: 'Budgeted amount' },
      { name: 'actual_amount', type: 'REAL', required: true, description: 'Actual amount' },
      { name: 'variance', type: 'REAL', required: true, description: 'Actual minus budget' },
      { name: 'variance_pct', type: 'REAL', required: true, description: 'Variance as percentage' },
    ],
  },
  cash_flow: {
    label: 'Cash Flow',
    description: 'Operating, investing, and financing cash flow line items.',
    primary_key: 'record_id',
    fields: [
      { name: 'record_id', type: 'TEXT', required: true, description: 'Unique record ID' },
      { name: 'period', type: 'TEXT', required: true, description: 'Reporting period (YYYY-MM)' },
      { name: 'entity_id', type: 'TEXT', required: true, description: 'Reference to entity_master', references: 'entity_master.entity_id' },
      { name: 'category', type: 'TEXT', required: true, description: 'operating / investing / financing', enum: ['operating', 'investing', 'financing'] },
      { name: 'line_item', type: 'TEXT', required: true, description: 'Cash flow line item' },
      { name: 'amount', type: 'REAL', required: true, description: 'Cash flow amount' },
      { name: 'currency', type: 'TEXT', required: true, description: 'Currency' },
    ],
  },
};

// System columns added to every canonical table
const SYSTEM_COLUMNS_SQL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL DEFAULT 'manual',
  source_row_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT DEFAULT 'system',
  updated_by TEXT DEFAULT 'system',
  confidence INTEGER DEFAULT 100,
  is_dummy INTEGER NOT NULL DEFAULT 0
`;

function fieldsToSql(fields) {
  return fields.map(f => {
    const notNull = f.required ? ' NOT NULL' : '';
    return `  ${f.name} ${f.type}${notNull}`;
  }).join(',\n');
}

export function buildCreateStatements() {
  const statements = [];

  // 6 canonical tables
  for (const [tableName, def] of Object.entries(CANONICAL_SCHEMAS)) {
    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
${SYSTEM_COLUMNS_SQL},
${fieldsToSql(def.fields)}
);`;
    statements.push(sql);
  }

  // 6 platform tables
  statements.push(`CREATE TABLE IF NOT EXISTS upload_jobs (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL DEFAULT 'default',
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    current_stage TEXT,
    stages_json TEXT,
    error TEXT,
    target_table_hint TEXT,
    parsed_json TEXT,
    classification_json TEXT,
    mapping_json TEXT,
    validation_json TEXT,
    reconciliation_json TEXT,
    load_result_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS schema_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    target_table TEXT NOT NULL,
    source_signature TEXT NOT NULL,
    mapping_json TEXT NOT NULL,
    use_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL DEFAULT 'default',
    title TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    execution_graph_json TEXT,
    confidence INTEGER,
    confidence_breakdown_json TEXT,
    sources_json TEXT,
    suggested_followups_json TEXT,
    tokens_used INTEGER,
    latency_ms INTEGER,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS dashboard_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    category TEXT,
    key_metrics_json TEXT,
    drill_question TEXT,
    sources_json TEXT,
    detailed_narrative TEXT,
    trend_data_json TEXT,
    impact_label TEXT,
    impact_value TEXT,
    detected_at TEXT,
    related_insight_ids_json TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS tool_call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    conversation_id TEXT,
    message_id INTEGER,
    agent_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    table_name TEXT NOT NULL,
    row_id INTEGER,
    action TEXT NOT NULL,
    old_value_json TEXT,
    new_value_json TEXT,
    actor TEXT DEFAULT 'system',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  statements.push(`CREATE TABLE IF NOT EXISTS data_quality_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL DEFAULT 'default',
    table_name TEXT NOT NULL,
    row_id INTEGER,
    field_name TEXT,
    severity TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    message TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  );`);

  // Useful indexes
  statements.push(`CREATE INDEX IF NOT EXISTS idx_gl_period_entity ON general_ledger(period, entity_id);`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_gl_account ON general_ledger(account_code);`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_bva_period_entity ON budget_vs_actuals(period, entity_id);`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_rb_period_entity ON revenue_billing(period, entity_id);`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_cf_period_entity ON cash_flow(period, entity_id);`);
  statements.push(`CREATE INDEX IF NOT EXISTS idx_chat_msgs_conv ON chat_messages(conversation_id);`);

  return statements;
}

export async function ensureSchema(db) {
  for (const sql of buildCreateStatements()) {
    db.exec(sql);
  }
  // Migrations for existing DBs — add columns if missing
  for (const { table, column, ddl } of [
    { table: 'chat_conversations', column: 'is_demo', ddl: "ALTER TABLE chat_conversations ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0" },
    { table: 'chat_messages', column: 'is_demo', ddl: "ALTER TABLE chat_messages ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0" },
    { table: 'dashboard_insights', column: 'detailed_narrative', ddl: "ALTER TABLE dashboard_insights ADD COLUMN detailed_narrative TEXT" },
    { table: 'dashboard_insights', column: 'trend_data_json', ddl: "ALTER TABLE dashboard_insights ADD COLUMN trend_data_json TEXT" },
    { table: 'dashboard_insights', column: 'impact_label', ddl: "ALTER TABLE dashboard_insights ADD COLUMN impact_label TEXT" },
    { table: 'dashboard_insights', column: 'impact_value', ddl: "ALTER TABLE dashboard_insights ADD COLUMN impact_value TEXT" },
    { table: 'dashboard_insights', column: 'detected_at', ddl: "ALTER TABLE dashboard_insights ADD COLUMN detected_at TEXT" },
    { table: 'dashboard_insights', column: 'related_insight_ids_json', ddl: "ALTER TABLE dashboard_insights ADD COLUMN related_insight_ids_json TEXT" },
  ]) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.some(c => c.name === column)) db.exec(ddl);
    } catch (e) {
      // table might not exist yet on a totally fresh DB — the CREATE above handles that
    }
  }
}

// Helper: get all column names (including system) for a canonical table
export function getAllColumns(tableName) {
  const def = CANONICAL_SCHEMAS[tableName];
  if (!def) return null;
  const systemCols = ['id', 'client_id', 'source', 'source_row_ref', 'created_at', 'updated_at',
                      'created_by', 'updated_by', 'confidence', 'is_dummy'];
  return [...systemCols, ...def.fields.map(f => f.name)];
}

export function getCanonicalTableNames() {
  return Object.keys(CANONICAL_SCHEMAS);
}

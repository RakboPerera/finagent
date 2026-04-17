// backend/tools/chatTools.js
// Tools the chat agents use. Pure JS — Claude never does math in its head.
// Joins are predefined, so the LLM cannot construct invalid joins.

import { CANONICAL_SCHEMAS, getCanonicalTableNames } from '../schema.js';

const ALLOWED_OPERATORS = new Set(['=', '!=', '>', '<', '>=', '<=', 'in', 'between', 'like']);

const PREDEFINED_JOINS = {
  // primary table → list of allowed joins
  general_ledger: [
    { join_to: 'entity_master', on: 'entity_id' },
    { join_to: 'chart_of_accounts', on: 'account_code' },
  ],
  budget_vs_actuals: [
    { join_to: 'entity_master', on: 'entity_id' },
    { join_to: 'chart_of_accounts', on: 'account_code' },
  ],
  revenue_billing: [
    { join_to: 'entity_master', on: 'entity_id' },
  ],
  cash_flow: [
    { join_to: 'entity_master', on: 'entity_id' },
  ],
};

function escapeIdent(s) {
  // Tight whitelist: alphanumeric + underscore only
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Invalid identifier: ${s}`);
  }
  return s;
}

function buildWhereClause(filters, paramArr, tablePrefix = '') {
  if (!filters || !Array.isArray(filters) || filters.length === 0) return '';
  const clauses = [];
  for (const f of filters) {
    const op = (f.op || '=').toLowerCase();
    if (!ALLOWED_OPERATORS.has(op)) throw new Error(`Operator not allowed: ${op}`);
    const col = tablePrefix ? `${tablePrefix}.${escapeIdent(f.field)}` : escapeIdent(f.field);
    if (op === 'in') {
      if (!Array.isArray(f.value)) throw new Error('IN requires array value');
      const placeholders = f.value.map(v => { paramArr.push(v); return '?'; }).join(',');
      clauses.push(`${col} IN (${placeholders})`);
    } else if (op === 'between') {
      if (!Array.isArray(f.value) || f.value.length !== 2) throw new Error('BETWEEN requires [low, high]');
      paramArr.push(f.value[0], f.value[1]);
      clauses.push(`${col} BETWEEN ? AND ?`);
    } else if (op === 'like') {
      paramArr.push(f.value);
      clauses.push(`${col} LIKE ?`);
    } else {
      paramArr.push(f.value);
      clauses.push(`${col} ${op} ?`);
    }
  }
  return ' WHERE ' + clauses.join(' AND ');
}

function aggregationsToSelect(aggs, tablePrefix = '') {
  if (!aggs || !aggs.length) return null;
  return aggs.map(a => {
    const fn = (a.fn || 'sum').toUpperCase();
    if (!['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].includes(fn)) {
      throw new Error(`Aggregation not allowed: ${fn}`);
    }
    const col = tablePrefix ? `${tablePrefix}.${escapeIdent(a.field)}` : escapeIdent(a.field);
    const alias = escapeIdent(a.alias || `${fn.toLowerCase()}_${a.field}`);
    return `${fn}(${col}) AS ${alias}`;
  }).join(', ');
}

// ---------------- Tool implementations ----------------

export function makeChatTools(db) {
  return {
    query_table: async (input) => {
      const { table, filters = [], columns = ['*'], group_by = null, aggregations = [], sort = null, limit = 100 } = input;
      if (!CANONICAL_SCHEMAS[table]) {
        return { error: `Unknown table: ${table}. Available: ${getCanonicalTableNames().join(', ')}` };
      }
      let sql, params;
      try {
        const tableEsc = escapeIdent(table);
        params = [];
        let select;
        if (aggregations.length) {
          const aggSel = aggregationsToSelect(aggregations);
          const groupSel = group_by ? group_by.map(escapeIdent).join(', ') : null;
          select = groupSel ? `${groupSel}, ${aggSel}` : aggSel;
        } else {
          select = columns.includes('*') ? '*' : columns.map(escapeIdent).join(', ');
        }
        sql = `SELECT ${select} FROM ${tableEsc}`;
        sql += buildWhereClause(filters, params);
        if (group_by && group_by.length) {
          sql += ` GROUP BY ${group_by.map(escapeIdent).join(', ')}`;
        }
        if (sort) {
          const dir = (sort.dir || 'asc').toUpperCase();
          if (!['ASC', 'DESC'].includes(dir)) throw new Error('Invalid sort direction');
          sql += ` ORDER BY ${escapeIdent(sort.field)} ${dir}`;
        }
        sql += ` LIMIT ${Math.min(parseInt(limit, 10) || 100, 1000)}`;
      } catch (e) {
        return { error: e.message };
      }

      try {
        const rows = db.prepare(sql).all(...params);
        return {
          rows,
          row_count: rows.length,
          source_metadata: {
            table,
            executed_at: new Date().toISOString(),
            query_summary: `${aggregations.length ? 'aggregated' : 'filtered'} ${rows.length} rows`,
          },
        };
      } catch (e) {
        return { error: e.message, sql_attempted: sql };
      }
    },

    join_query: async (input) => {
      const { primary_table, joins = [], filters = [], columns = [], aggregations = [], group_by = null, limit = 100 } = input;
      const allowedJoins = PREDEFINED_JOINS[primary_table];
      if (!allowedJoins) {
        return { error: `Joins not defined for ${primary_table}` };
      }
      const tableEsc = escapeIdent(primary_table);
      const joinClauses = [];
      for (const j of joins) {
        const allowed = allowedJoins.find(a => a.join_to === j.join_to);
        if (!allowed) {
          return { error: `Join from ${primary_table} to ${j.join_to} not allowed. Allowed: ${allowedJoins.map(a => a.join_to).join(', ')}` };
        }
        joinClauses.push(`LEFT JOIN ${escapeIdent(j.join_to)} ON ${tableEsc}.${escapeIdent(allowed.on)} = ${escapeIdent(j.join_to)}.${escapeIdent(allowed.on)}`);
      }
      const params = [];
      let select;
      if (aggregations.length) {
        const aggSel = aggregations.map(a => {
          const fn = (a.fn || 'sum').toUpperCase();
          const tbl = a.table ? escapeIdent(a.table) + '.' : '';
          const alias = escapeIdent(a.alias || `${fn.toLowerCase()}_${a.field}`);
          return `${fn}(${tbl}${escapeIdent(a.field)}) AS ${alias}`;
        }).join(', ');
        const groupSel = group_by ? group_by.map(g => {
          const tbl = g.table ? escapeIdent(g.table) + '.' : '';
          const alias = g.alias || g.field;
          return `${tbl}${escapeIdent(g.field)} AS ${escapeIdent(alias)}`;
        }).join(', ') : null;
        select = groupSel ? `${groupSel}, ${aggSel}` : aggSel;
      } else {
        select = columns.length ? columns.map(c => {
          const tbl = c.table ? escapeIdent(c.table) + '.' : '';
          return `${tbl}${escapeIdent(c.field)}`;
        }).join(', ') : `${tableEsc}.*`;
      }
      let sql = `SELECT ${select} FROM ${tableEsc}`;
      if (joinClauses.length) sql += ' ' + joinClauses.join(' ');
      // filters: { table, field, op, value }
      if (filters && filters.length) {
        const cls = [];
        for (const f of filters) {
          const op = (f.op || '=').toLowerCase();
          if (!ALLOWED_OPERATORS.has(op)) throw new Error(`Op not allowed: ${op}`);
          const col = (f.table ? escapeIdent(f.table) + '.' : tableEsc + '.') + escapeIdent(f.field);
          if (op === 'in') {
            const ph = f.value.map(v => { params.push(v); return '?'; }).join(',');
            cls.push(`${col} IN (${ph})`);
          } else if (op === 'between') {
            params.push(f.value[0], f.value[1]);
            cls.push(`${col} BETWEEN ? AND ?`);
          } else { params.push(f.value); cls.push(`${col} ${op} ?`); }
        }
        sql += ' WHERE ' + cls.join(' AND ');
      }
      if (group_by && group_by.length) {
        sql += ' GROUP BY ' + group_by.map(g => {
          const tbl = g.table ? escapeIdent(g.table) + '.' : '';
          return `${tbl}${escapeIdent(g.field)}`;
        }).join(', ');
      }
      sql += ` LIMIT ${Math.min(parseInt(limit, 10) || 100, 1000)}`;

      try {
        const rows = db.prepare(sql).all(...params);
        return {
          rows, row_count: rows.length,
          source_metadata: { primary_table, joins: joins.map(j => j.join_to), executed_at: new Date().toISOString() },
        };
      } catch (e) {
        return { error: e.message, sql_attempted: sql };
      }
    },

    calculate: async (input) => {
      const { expression, params = {} } = input;
      try {
        const result = evaluateNamedExpression(expression, params);
        return { result, expression, params };
      } catch (e) {
        return { error: e.message, expression };
      }
    },

    get_metadata: async (input) => {
      const { table } = input;
      if (!CANONICAL_SCHEMAS[table]) return { error: `Unknown table: ${table}` };
      const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM ${escapeIdent(table)}`).get();
      const dummyRow = db.prepare(`SELECT COUNT(*) AS c FROM ${escapeIdent(table)} WHERE is_dummy = 1`).get();
      const userRow = db.prepare(`SELECT COUNT(*) AS c FROM ${escapeIdent(table)} WHERE is_dummy = 0`).get();
      const lastRow = db.prepare(`SELECT MAX(updated_at) AS u FROM ${escapeIdent(table)}`).get();
      const sourceBreakdownRows = db.prepare(`SELECT source, COUNT(*) AS c FROM ${escapeIdent(table)} GROUP BY source`).all();
      const def = CANONICAL_SCHEMAS[table];
      return {
        table, label: def.label, description: def.description,
        total_rows: totalRow.c, dummy_rows: dummyRow.c, user_rows: userRow.c,
        last_updated: lastRow.u, source_breakdown: sourceBreakdownRows,
      };
    },

    lookup_canonical_values: async (input) => {
      const { table, column } = input;
      if (!CANONICAL_SCHEMAS[table]) return { error: `Unknown table: ${table}` };
      const t = escapeIdent(table);
      const c = escapeIdent(column);
      try {
        const rows = db.prepare(`SELECT ${c} AS value, COUNT(*) AS count FROM ${t} GROUP BY ${c} ORDER BY count DESC LIMIT 200`).all();
        return { table, column, values: rows };
      } catch (e) { return { error: e.message }; }
    },

    describe_schema: async (input) => {
      const { table } = input;
      if (table) {
        const def = CANONICAL_SCHEMAS[table];
        if (!def) return { error: `Unknown table: ${table}` };
        return { table, ...def };
      }
      const all = {};
      for (const [name, def] of Object.entries(CANONICAL_SCHEMAS)) {
        all[name] = { label: def.label, description: def.description, fields: def.fields.map(f => ({ name: f.name, type: f.type, description: f.description })) };
      }
      return { tables: all };
    },
  };
}

// Named-expression calculator. All financial math here.
function evaluateNamedExpression(expression, params) {
  const e = (expression || '').toLowerCase();
  switch (e) {
    case 'growth_rate': {
      const { current, previous } = params;
      if (previous === 0 || previous == null) return null;
      return ((current - previous) / Math.abs(previous)) * 100;
    }
    case 'variance': {
      const { actual, budget } = params;
      return actual - budget;
    }
    case 'variance_pct': {
      const { actual, budget } = params;
      if (budget === 0) return null;
      return ((actual - budget) / Math.abs(budget)) * 100;
    }
    case 'margin': {
      const { numerator, denominator } = params;
      if (denominator === 0) return null;
      return (numerator / denominator) * 100;
    }
    case 'ratio': {
      const { numerator, denominator } = params;
      if (denominator === 0) return null;
      return numerator / denominator;
    }
    case 'cagr': {
      const { start, end, years } = params;
      if (start <= 0 || years <= 0) return null;
      return (Math.pow(end / start, 1 / years) - 1) * 100;
    }
    case 'moving_average': {
      const { values, window = 3 } = params;
      if (!Array.isArray(values) || values.length < window) return null;
      const slice = values.slice(-window);
      return slice.reduce((a, b) => a + b, 0) / window;
    }
    case 'sum': {
      const { values } = params;
      return (values || []).reduce((a, b) => a + (Number(b) || 0), 0);
    }
    case 'avg': {
      const { values } = params;
      if (!values || !values.length) return null;
      return values.reduce((a, b) => a + (Number(b) || 0), 0) / values.length;
    }
    case 'percent_of': {
      const { part, whole } = params;
      if (whole === 0) return null;
      return (part / whole) * 100;
    }
    default:
      throw new Error(`Unknown calculation: ${expression}. Available: growth_rate, variance, variance_pct, margin, ratio, cagr, moving_average, sum, avg, percent_of`);
  }
}

// Tool specs (for LLM)
export const CHAT_TOOL_SPECS = [
  {
    name: 'query_table',
    description: 'Query a single canonical table. Supports filters, columns, group_by, aggregations, sort, and limit. Use this for any single-table data lookup.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name: entity_master, chart_of_accounts, general_ledger, revenue_billing, budget_vs_actuals, cash_flow' },
        filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'in', 'between', 'like'] }, value: {} } } },
        columns: { type: 'array', items: { type: 'string' } },
        group_by: { type: 'array', items: { type: 'string' } },
        aggregations: { type: 'array', items: { type: 'object', properties: { fn: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] }, field: { type: 'string' }, alias: { type: 'string' } } } },
        sort: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'integer' },
      },
      required: ['table'],
    },
  },
  {
    name: 'join_query',
    description: 'Run a query that joins a primary table with related tables. Joins are predefined: general_ledger and budget_vs_actuals can join entity_master and chart_of_accounts; revenue_billing and cash_flow can join entity_master.',
    input_schema: {
      type: 'object',
      properties: {
        primary_table: { type: 'string' },
        joins: { type: 'array', items: { type: 'object', properties: { join_to: { type: 'string' } } } },
        filters: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, field: { type: 'string' }, op: { type: 'string' }, value: {} } } },
        columns: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, field: { type: 'string' } } } },
        aggregations: { type: 'array', items: { type: 'object', properties: { fn: { type: 'string' }, table: { type: 'string' }, field: { type: 'string' }, alias: { type: 'string' } } } },
        group_by: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, field: { type: 'string' }, alias: { type: 'string' } } } },
        limit: { type: 'integer' },
      },
      required: ['primary_table'],
    },
  },
  {
    name: 'calculate',
    description: 'Perform a financial calculation. Available expressions: growth_rate, variance, variance_pct, margin, ratio, cagr, moving_average, sum, avg, percent_of.',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
        params: { type: 'object' },
      },
      required: ['expression', 'params'],
    },
  },
  {
    name: 'get_metadata',
    description: 'Get metadata about a canonical table: row counts, freshness, source breakdown.',
    input_schema: { type: 'object', properties: { table: { type: 'string' } }, required: ['table'] },
  },
  {
    name: 'lookup_canonical_values',
    description: 'List the distinct values in a column with their counts. Useful for finding what entities, periods, or accounts exist.',
    input_schema: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' } }, required: ['table', 'column'] },
  },
  {
    name: 'describe_schema',
    description: 'Describe one table or all tables — fields, types, descriptions, and relationships.',
    input_schema: { type: 'object', properties: { table: { type: 'string' } } },
  },
];

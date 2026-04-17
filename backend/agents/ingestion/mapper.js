// backend/agents/ingestion/mapper.js
// Agent 3: Schema Mapping. For each classified sheet, propose column-to-field mappings + transformations.
import { callLLM } from '../llm.js';
import { CANONICAL_SCHEMAS } from '../../schema.js';
import crypto from 'crypto';

const SYSTEM = `You are the Schema Mapping Agent in the FinAgent ingestion pipeline.

Your job: map each source column in the user's sheet to a field in the target canonical table, OR mark it as "ignore" if it doesn't fit.

Specify any transformations needed:
- multiply: numeric (e.g., for unit conversion: thousands to raw → multiply by 1000)
- divide: numeric
- absolute: numeric (take abs value)
- sign_flip: numeric (multiply by -1)
- format_date: string→date (formats: YYYY-MM, FY-YYYY, MMM-YYYY, Q-YYYY, excel_serial)
- trim: string
- uppercase: string
- lookup: resolve a name to an ID via a canonical table (e.g., entity_name → entity_id via entity_master)

IMPORTANT — synthesized fields:
If a REQUIRED field (especially the primary key like record_id, entry_id) has NO source column, do NOT leave it unmapped. Instead add it to "synthesized_fields":
- strategy "uuid" → generate a unique id per row (safe default for surrogate PKs).
- strategy "composite" → concatenate values of other mapped target_fields with a separator (good when a natural key exists, e.g. period + entity_id + account_code + business_unit).
Prefer "composite" when the combination of other mapped fields is guaranteed unique per row; otherwise use "uuid".

Target table schema:
{SCHEMA}

Past confirmed mappings for this client (use these as priors when columns match):
{PRIOR_MAPPINGS}

Output JSON ONLY:
{
  "target_table": "...",
  "column_mappings": [
    { "source_column": "Net Sales (USD M)", "target_field": "billed_amount", "confidence": 95, "transformations": [{ "type": "multiply", "value": 1000000 }], "reasoning": "..." },
    { "source_column": "Q4 2023", "target_field": "period", "confidence": 90, "transformations": [{ "type": "format_date", "from": "Q-YYYY", "to": "YYYY-MM" }], "reasoning": "..." },
    { "source_column": "Notes", "target_field": null, "confidence": 100, "transformations": [], "reasoning": "Free-text notes column has no canonical field" }
  ],
  "synthesized_fields": [
    { "target_field": "record_id", "strategy": "composite", "source_fields": ["period","entity_id","account_code"], "separator": "-", "prefix": "RB", "reasoning": "No source PK column; natural key is period + entity + account." }
  ],
  "questions_for_user": [
    "Column 'GP%' could mean gross_margin or another margin field. Please confirm."
  ],
  "overall_confidence": 0-100
}`;

export async function proposeMapping({ provider, apiKey, sheet, targetTable, priorMappings = [] }) {
  if (!CANONICAL_SCHEMAS[targetTable]) {
    return { error: `Unknown target table: ${targetTable}` };
  }
  const def = CANONICAL_SCHEMAS[targetTable];
  const schemaText = `Table: ${targetTable}\n${def.description}\nFields:\n${def.fields.map(f =>
    `  - ${f.name} (${f.type}${f.required ? ', required' : ''}): ${f.description}${f.enum ? ' [enum: ' + f.enum.join(', ') + ']' : ''}${f.references ? ' [FK: ' + f.references + ']' : ''}`
  ).join('\n')}`;

  const priorText = priorMappings.length
    ? priorMappings.map(p => `Source signature: ${p.source_signature} → ${JSON.stringify(p.mapping_json).slice(0, 500)}`).join('\n')
    : '(no past mappings)';

  const userMsg = `Sheet name: ${sheet.name}
Source columns: ${JSON.stringify(sheet.headers)}
Sample rows (first 5): ${JSON.stringify(sheet.sample_rows.slice(0, 5), null, 2)}
Total rows: ${sheet.row_count}

Map these source columns to the ${targetTable} table.`;

  const result = await callLLM({
    provider, apiKey, tier: 'heavy',
    system: SYSTEM.replace('{SCHEMA}', schemaText).replace('{PRIOR_MAPPINGS}', priorText),
    messages: [{ role: 'user', content: userMsg }],
    max_tokens: 2500,
  });

  let parsed;
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : result.text);
  } catch (e) {
    return { error: 'Mapping output unparseable: ' + e.message, raw_text: result.text };
  }

  return { ...parsed, latency_ms: result.latency_ms };
}

// Apply a confirmed mapping to raw sheet data → produces canonical-shaped rows
export function applyMapping({ sheet, mapping }) {
  const rows = [];
  const errors = [];
  const synthesized = Array.isArray(mapping.synthesized_fields) ? mapping.synthesized_fields : [];
  for (let i = 0; i < sheet.data.length; i++) {
    const sourceRow = sheet.data[i];
    const out = {};
    let rowError = null;
    for (const cm of mapping.column_mappings) {
      if (!cm.target_field) continue;
      let val = sourceRow[cm.source_column];
      try {
        val = applyTransformations(val, cm.transformations || []);
      } catch (e) {
        rowError = `Row ${i + 1}, column "${cm.source_column}": ${e.message}`;
        break;
      }
      out[cm.target_field] = val;
    }
    if (rowError) { errors.push(rowError); continue; }
    // Apply synthesized fields (after column mappings so composite keys can reference them)
    for (const sf of synthesized) {
      if (!sf.target_field || out[sf.target_field] != null) continue;
      out[sf.target_field] = synthesizeValue(sf, out, i);
    }
    out._source_row_ref = `${sheet.name}:row${i + 2}`;
    rows.push(out);
  }
  return { rows, errors };
}

function synthesizeValue(spec, row, rowIndex) {
  const strategy = spec.strategy || 'uuid';
  const prefix = spec.prefix ? `${spec.prefix}-` : '';
  if (strategy === 'composite') {
    const parts = (spec.source_fields || [])
      .map(f => row[f])
      .filter(v => v != null && v !== '')
      .map(v => String(v).replace(/\s+/g, '_'));
    const sep = spec.separator || '-';
    if (parts.length === 0) return `${prefix}row${rowIndex + 1}-${crypto.randomBytes(3).toString('hex')}`;
    return `${prefix}${parts.join(sep)}`;
  }
  // Default: uuid-style short id
  return `${prefix}${crypto.randomBytes(6).toString('hex')}`;
}

function applyTransformations(value, transforms) {
  let v = value;
  for (const t of transforms) {
    if (v == null || v === '') continue;
    switch (t.type) {
      case 'multiply': v = Number(v) * t.value; break;
      case 'divide': v = Number(v) / t.value; break;
      case 'absolute': v = Math.abs(Number(v)); break;
      case 'sign_flip': v = -Number(v); break;
      case 'trim': v = String(v).trim(); break;
      case 'uppercase': v = String(v).toUpperCase(); break;
      case 'format_date': v = formatDate(v, t.from, t.to); break;
      case 'lookup': /* resolved at load time */ break;
      default: throw new Error(`Unknown transformation: ${t.type}`);
    }
  }
  return v;
}

function formatDate(value, from, to) {
  // Most common conversions for financial data
  const s = String(value).trim();
  // Excel serial date
  if (from === 'excel_serial' && /^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return formatDateOut(d, to);
  }
  // YYYY-MM passthrough
  if (from === 'YYYY-MM' && /^\d{4}-\d{2}$/.test(s)) return s;
  // FY-YYYY → YYYY (annual)
  if (from === 'FY-YYYY' || /^FY[-_ ]?\d{4}$/i.test(s)) {
    const m = s.match(/(\d{4})/);
    return m ? `${m[1]}-12` : s;
  }
  // Q1 2024 / Q1-2024 / 2024-Q1 → first month of quarter
  const qm = s.match(/Q([1-4])[-_ /]?(\d{4})|(\d{4})[-_ /]?Q([1-4])/i);
  if (qm) {
    const q = parseInt(qm[1] || qm[4], 10);
    const y = qm[2] || qm[3];
    const startMonth = (q - 1) * 3 + 1;
    return `${y}-${String(startMonth).padStart(2, '0')}`;
  }
  // MMM-YYYY
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const mm = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-_ ](\d{4})$/i);
  if (mm) return `${mm[2]}-${months[mm[1].slice(0,3).replace(/^\w/, c => c.toUpperCase())]}`;
  // Date object
  if (value instanceof Date) return formatDateOut(value, to);
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  return s;
}

function formatDateOut(d, to) {
  if (to === 'YYYY-MM') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return d.toISOString().slice(0, 10);
}

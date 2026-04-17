// backend/agents/ingestion/classifier.js
// Agent 2: Sheet Classifier. One Claude call per upload, batched across sheets.
import { callLLM } from '../llm.js';
import { CANONICAL_SCHEMAS, getCanonicalTableNames } from '../../schema.js';

const SYSTEM = `You are the Sheet Classifier in the FinAgent ingestion pipeline.

You receive: a list of parsed sheets, each with its name, headers, and 5-20 sample rows.

You decide: which canonical table (if any) each sheet maps to. Sheets that are cover pages, charts, summaries, or notes should be marked "ignore".

Available canonical tables:
{TABLES_DESCRIPTION}

Output JSON ONLY:
{
  "classifications": [
    { "sheet_name": "...", "target_table": "general_ledger" | "entity_master" | "chart_of_accounts" | "revenue_billing" | "budget_vs_actuals" | "cash_flow" | "ignore", "confidence": 0-100, "reasoning": "short explanation" }
  ]
}`;

export async function classifySheets({ provider, apiKey, parsedFile, targetTableHint = null }) {
  const dataSheets = parsedFile.sheets.filter(s => s.row_count > 0);
  if (dataSheets.length === 0) {
    return { classifications: [], skipped_all_empty: true };
  }

  const tablesDesc = Object.entries(CANONICAL_SCHEMAS).map(([name, def]) =>
    `- ${name}: ${def.description}\n  Fields: ${def.fields.map(f => f.name).join(', ')}`
  ).join('\n');

  const sheetSummaries = dataSheets.map(s => ({
    sheet_name: s.name,
    headers: s.headers,
    row_count: s.row_count,
    sample_rows: s.sample_rows.slice(0, 5),
  }));

  const userMsg = `${targetTableHint ? `User hinted the target table is: ${targetTableHint}\n\n` : ''}Sheets to classify:\n${JSON.stringify(sheetSummaries, null, 2)}`;

  const result = await callLLM({
    provider, apiKey, tier: 'light',
    system: SYSTEM.replace('{TABLES_DESCRIPTION}', tablesDesc),
    messages: [{ role: 'user', content: userMsg }],
    max_tokens: 1500,
  });

  let parsed;
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : result.text);
  } catch (e) {
    // Fallback: mark everything as ignore + low confidence
    parsed = {
      classifications: dataSheets.map(s => ({
        sheet_name: s.name, target_table: 'ignore', confidence: 0,
        reasoning: 'Classifier output unparseable: ' + e.message,
      })),
    };
  }

  return { ...parsed, latency_ms: result.latency_ms, raw_text: result.text };
}

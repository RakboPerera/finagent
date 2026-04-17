// backend/agents/insights/index.js
// Insight generator: iterates a rule registry to gather signals, dedups, ranks,
// then passes them to a per-category narrator to produce polished insight cards.

import { callLLM } from '../llm.js';
import { describeDataContext, signalKey, money, pct } from './helpers.js';

import variance from './rules/variance.js';
import revenueTrend from './rules/revenue_trend.js';
import margin from './rules/margin.js';
import yoy from './rules/yoy.js';
import concentration from './rules/concentration.js';
import budgetAttainment from './rules/budget_attainment.js';
import dso from './rules/dso.js';
import cashFlow from './rules/cash_flow.js';
import receivables from './rules/receivables.js';
import glOutliers from './rules/gl_outliers.js';
import dataQuality from './rules/data_quality.js';

const RULES = [
  variance, revenueTrend, margin, yoy, concentration, budgetAttainment,
  dso, cashFlow, receivables, glOutliers, dataQuality,
];

// Narrator prompt — per-category nuances are folded in via the template.
const NARRATOR_SYSTEM = `You are the FinAgent Dashboard Narrator.

You receive:
1. A brief DATA CONTEXT describing what's loaded.
2. A JSON array of SIGNALS. Each signal already has:
   - a kind, category, severity
   - raw numbers + a narrator_headline to anchor the framing
   - trend_data (a 6–12 point series)
   - sources (which rows underpin it)

Your job: turn each signal into a polished insight card.

Strict rules:
- ONE card per signal — do not merge or drop signals.
- Keep the narrator_headline as the basis for the summary; you may polish phrasing but NOT change numbers.
- NEVER invent figures outside the signal.
- If the DATA CONTEXT says user-uploaded data is newer than the baseline, acknowledge that baseline may be dummy when reporting big YoY or QoQ swings (e.g. "Comparing against seeded baseline data — expect real comparisons once prior-period user data is loaded").
- Title: 5–8 words, punchy. Start with the entity/metric, not a verb.
- Summary: 1 sentence, ≤30 words, $-impact in the first half.
- detailed_narrative: 2–3 sentences, plain prose, NO bullets.
- drill_question: a specific question a user could paste into chat (e.g. "Why did ACME-NA marketing actuals overrun 22% in 2024-Q4?").
- key_metrics: 2–4 entries, {label, value}. Values must be short strings (e.g. "+$159K", "+22%", "3 months").
- impact_label / impact_value: 1–2 word chip (e.g. "overspend" / "$159K").

Category-specific style guides:
- variance: Lead with $, then %. Mention the account + entity.
- revenue: Lead with direction (growth/decline) then window, then $-size.
- cash: Lead with the cash number, then what it signals for liquidity.
- concentration: Mention the % share + what would happen if the top dependency fell.
- expense (margin): Mention the pp shift and what drove it if obvious.
- freshness: Tell the user exactly what to upload or investigate.

Output JSON ONLY:
{
  "insights": [
    {
      "signal_index": 0,
      "title": "...",
      "summary": "...",
      "severity": "error|warning|success|info",
      "category": "variance|revenue|cash|expense|concentration|freshness",
      "key_metrics": [{"label":"Variance","value":"+$159K"}],
      "drill_question": "...",
      "impact_label": "overspend",
      "impact_value": "$159K",
      "detailed_narrative": "..."
    }
  ]
}`;

// Parse the narrator's output, tolerating truncation. First tries to parse the whole
// {insights: [...]} object; if that fails, extracts each insight object individually by
// walking the text for `{ "signal_index": N, ... }` blocks that balance brackets.
function parseNarratorOutput(raw) {
  // Strip markdown fences
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  try {
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);
    if (Array.isArray(parsed.insights)) return parsed.insights;
  } catch { /* fall through */ }
  // Fallback: extract individual insight objects by balancing braces
  const out = [];
  const arr = cleaned.indexOf('"insights"');
  if (arr < 0) return out;
  let i = cleaned.indexOf('[', arr);
  if (i < 0) return out;
  i++;
  while (i < cleaned.length) {
    // Skip whitespace/commas
    while (i < cleaned.length && /[\s,]/.test(cleaned[i])) i++;
    if (cleaned[i] !== '{') break;
    let depth = 0, start = i, inStr = false, esc = false;
    for (; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
    }
    if (depth === 0) {
      try { out.push(JSON.parse(cleaned.slice(start, i))); } catch { /* skip bad block */ }
    } else {
      break; // truncation — stop
    }
  }
  return out;
}

// Dedup signals that describe the same thing from different rules.
function dedup(signals) {
  const seen = new Map();
  for (const s of signals) {
    const k = signalKey(s);
    const existing = seen.get(k);
    if (!existing || (s.impact_dollars || 0) > (existing.impact_dollars || 0)) {
      seen.set(k, s);
    }
  }
  return Array.from(seen.values());
}

// Rank by severity + $-impact + confidence.
function rank(signals) {
  const severityWeight = { error: 4, warning: 3, success: 2, info: 1 };
  return [...signals].sort((a, b) => {
    const sa = severityWeight[a.severity] || 0;
    const sb = severityWeight[b.severity] || 0;
    if (sa !== sb) return sb - sa;
    const ia = a.impact_dollars || 0;
    const ib = b.impact_dollars || 0;
    if (ia !== ib) return ib - ia;
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

// Compute related_insight_ids post-hoc — same entity OR same category.
function linkRelated(insights, signals) {
  for (let i = 0; i < insights.length; i++) {
    const sigA = signals[insights[i].signal_index];
    const related = [];
    for (let j = 0; j < insights.length; j++) {
      if (i === j) continue;
      const sigB = signals[insights[j].signal_index];
      if (sigA.entity && sigA.entity === sigB.entity && sigA.category !== sigB.category) related.push(insights[j]);
      else if (sigA.category === sigB.category && sigA.entity !== sigB.entity) related.push(insights[j]);
    }
    insights[i]._related = related.slice(0, 3); // cap
  }
}

// Look for "is this a recurring problem?" — scan prior insights for a same entity+category match.
function recurrenceCallout(db, signal) {
  if (!signal.entity || !signal.category) return null;
  const prior = db.prepare(`SELECT title, detected_at FROM dashboard_insights
    WHERE is_demo = 0 AND category = ? AND title LIKE ? AND detected_at < ?
    ORDER BY detected_at DESC LIMIT 3`).all(signal.category, `%${signal.entity}%`, new Date().toISOString());
  if (prior.length >= 2) return `This is the ${prior.length + 1}${['st', 'nd', 'rd'][prior.length] || 'th'} time in recent history — flagged on ${prior.map(p => p.detected_at?.slice(0, 10)).join(', ')}.`;
  return null;
}

export async function generateInsights({ db, provider, apiKey }) {
  // 1. Gather signals from all rules.
  const rawSignals = [];
  for (const rule of RULES) {
    try {
      const sigs = rule.gather(db) || [];
      for (const s of sigs) rawSignals.push({ ...s, _rule_id: rule.id });
    } catch (e) {
      console.error(`[insights] rule "${rule.id}" failed:`, e.message);
    }
  }
  if (rawSignals.length === 0) {
    return { insights: [], signals_count: 0, note: 'No notable signals found.' };
  }

  // 2. Dedup + rank, cap to 12 to control LLM cost/latency.
  const ranked = rank(dedup(rawSignals)).slice(0, 12);

  // 3. Build data context for the narrator prompt.
  const ctx = describeDataContext(db);
  const ctxText = `Months of data: ${ctx.first_period} → ${ctx.last_period}. User-uploaded data starts at: ${ctx.user_data_starts_at || 'none (all seeded baseline)'}. Table row counts (user/dummy): ${Object.entries(ctx.tables).map(([t, v]) => `${t}=${v.user}/${v.dummy}`).join(', ')}.`;

  // 4. Narrate via LLM.
  const narratorInput = `DATA CONTEXT:\n${ctxText}\n\nSIGNALS (index = signal_index to reference):\n${JSON.stringify(ranked.map((s, i) => ({ signal_index: i, ...s })), null, 2)}\n\nNarrate each signal as an insight card.`;
  const result = await callLLM({
    provider, apiKey, tier: 'heavy',
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: narratorInput }],
    max_tokens: 8000,
  });
  const insights = parseNarratorOutput(result.text);
  if (insights.length === 0) {
    return { error: 'Narrator returned no parseable insights', raw_text: result.text.slice(0, 2000), signals_count: ranked.length };
  }

  // 5. Post-process: attach trend_data, sources, confidence from the signal.
  for (const ins of insights) {
    const sig = ranked[ins.signal_index];
    if (!sig) continue;
    ins._signal = sig;
    ins.trend_data = sig.trend_data || [];
    ins.sources = sig.sources || [];
    ins.confidence = sig.confidence || 80;
    // History callout
    const rec = recurrenceCallout(db, sig);
    if (rec) ins.detailed_narrative = (ins.detailed_narrative || '') + '\n\n' + rec;
  }

  // 6. Compute related_insight_ids (post-insert; see step 7).
  linkRelated(insights, ranked);

  // 7. Persist — replace non-demo rows in one tx, then do a second pass to link related_insight_ids.
  const insertedIds = [];
  db.transaction(() => {
    db.prepare(`DELETE FROM dashboard_insights WHERE is_demo = 0`).run();
    const ins = db.prepare(`INSERT INTO dashboard_insights
      (title, summary, severity, category, key_metrics_json, drill_question, sources_json,
       detailed_narrative, trend_data_json, impact_label, impact_value, detected_at, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`);
    const detectedAt = new Date().toISOString();
    for (const i of insights) {
      const r = ins.run(
        i.title || 'Untitled insight',
        i.summary || '',
        i.severity || 'info',
        i.category || null,
        JSON.stringify(i.key_metrics || []),
        i.drill_question || null,
        JSON.stringify(i.sources || []),
        i.detailed_narrative || null,
        JSON.stringify(i.trend_data || []),
        i.impact_label || null,
        i.impact_value || null,
        detectedAt,
      );
      insertedIds.push(r.lastInsertRowid);
      i._db_id = r.lastInsertRowid;
    }
    // Second pass: resolve related_insight_ids (now that we have real ids)
    const upd = db.prepare(`UPDATE dashboard_insights SET related_insight_ids_json = ? WHERE id = ?`);
    for (let i = 0; i < insights.length; i++) {
      const related = (insights[i]._related || []).map(r => r._db_id).filter(Boolean);
      upd.run(JSON.stringify(related), insertedIds[i]);
    }
  });

  return {
    insights: insights.map(i => ({
      id: i._db_id,
      title: i.title, summary: i.summary, severity: i.severity, category: i.category,
      key_metrics: i.key_metrics || [],
      drill_question: i.drill_question,
      impact_label: i.impact_label, impact_value: i.impact_value,
      confidence: i.confidence,
      trend_data: i.trend_data || [],
      sources: i.sources || [],
    })),
    signals_count: rawSignals.length,
    ranked_count: ranked.length,
    inserted: insertedIds.length,
    latency_ms: result.latency_ms,
    data_context: ctx,
  };
}

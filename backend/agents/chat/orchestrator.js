// backend/agents/chat/orchestrator.js
// Two-tier chat brain:
//   Tier 1: Router (one fast call) classifies intent
//   Tier 2: Worker agents (Retrieval, Computation, Metadata) with tool access
//   Final: Response Synthesizer formats the answer

import { callLLM } from '../llm.js';
import { runAgentLoop } from '../loop.js';
import { makeChatTools, CHAT_TOOL_SPECS } from '../../tools/chatTools.js';
import { scoreFromTrace } from '../confidence.js';

const ROUTER_SYSTEM = `You are the Router for the FinAgent Financial Chatbot. Your only job is to classify the user's question into one intent and choose worker agents.

Intents:
- data_lookup: Single table lookup ("What was Q3 revenue?")
- comparison: Comparing values across periods/entities ("Q3 vs Q2 by entity")
- computation: Arithmetic/financial calculation needed ("EBITDA margin", "growth rate")
- trend_analysis: Multi-period trend ("revenue trend last 4 quarters")
- meta: Question about the data itself ("what data do I have", "when was X loaded")
- data_management: User wants to upload or edit data
- ambiguous: Need to clarify
- unsupported: Outside scope (forecasting, opinions, non-financial)

Workers available:
- retrieval: Pulls data via query_table / join_query
- computation: Does math via calculate
- metadata: Answers data-about-data questions

Output JSON ONLY, no prose:
{"intent": "...", "workers": ["retrieval", "computation"], "reasoning": "...", "clarification_needed": null or "question to ask user"}`;

const WORKER_SYSTEM_BASE = `You are a worker agent in the FinAgent Financial Chatbot.

Available canonical tables:
- entity_master (entity_id, entity_name, entity_code, region, currency, consolidation_group, status)
- chart_of_accounts (account_code, account_name, account_type [asset/liability/equity/revenue/expense], parent_account, currency, is_active)
- general_ledger (entry_id, period [YYYY-MM], entity_id, account_code, debit, credit, closing_balance, description)
- revenue_billing (record_id, period, entity_id, business_unit, product_line, billed_amount, collected_amount, outstanding_amount, currency)
- budget_vs_actuals (record_id, period, entity_id, account_code, budget_amount, actual_amount, variance, variance_pct)
- cash_flow (record_id, period, entity_id, category [operating/investing/financing], line_item, amount, currency)

EFFICIENCY RULES (follow these to avoid wasted turns):
- FIRST, if the question mentions relative periods ("recently", "last 6 months", "current quarter") or ambiguous entity names, start by calling get_metadata on the primary table to see what period range exists — DON'T guess.
- Use join_query when you need data spanning multiple tables (e.g. variance + account name + entity code). Don't chain 3 separate query_table calls.
- When the question asks for "the biggest" / "top N" / "largest variances", use aggregations + sort + limit in ONE query_table or join_query call.
- Target 3-5 tool calls per question. If you've made 6+ and still don't have the answer, stop and return what you have with a caveat.

ACCURACY RULES:
1. NEVER invent data. If a tool returns nothing, say so clearly.
2. NEVER do math in your head — always use the calculate tool for growth rates, sums, averages, ratios.
3. Always cite which table and which periods/entities you used.
4. If the question references a name like "Acme NA", use lookup_canonical_values to find the actual entity_id first.
5. Periods are YYYY-MM format. "Q3 2024" = ['2024-07','2024-08','2024-09']. "Q4" without year = the most recent Q4 in the data.
6. Return findings as concise plain text the synthesizer will turn into the final answer. Do not format markdown tables yet.`;

const SYNTHESIZER_SYSTEM = `You are the Response Synthesizer for the FinAgent Financial Chatbot.

You will receive:
- The user's original question
- Findings from one or more worker agents
- The data those workers retrieved

Your job: write a clear, concise natural-language answer.

Rules:
1. Lead with the direct answer. Numbers up front.
2. Add 1-2 sentences of context if it helps interpretation.
3. Use markdown tables ONLY when comparing 3+ rows of multi-column data.
4. Never invent figures. Only use numbers from the worker findings.
5. If workers reported missing data or errors, acknowledge it plainly.
6. End with a "suggested_followups" JSON block: \`\`\`followups
["Question 1?", "Question 2?", "Question 3?"]
\`\`\`
The followups should be specific to what was just answered.

Format your response as natural prose, then the followups block.`;

export async function runChat({ db, provider, apiKey, userMessage, history = [], onToolCall = null }) {
  const tools = makeChatTools(db);
  const toolHandlers = {
    query_table: tools.query_table,
    join_query: tools.join_query,
    calculate: tools.calculate,
    get_metadata: tools.get_metadata,
    lookup_canonical_values: tools.lookup_canonical_values,
    describe_schema: tools.describe_schema,
  };

  const executionGraph = { router: null, workers: [], synthesizer: null };
  const allSources = new Set();
  let totalLatency = 0;
  let totalTokens = { input: 0, output: 0 };

  // ---------- TIER 1: ROUTER ----------
  const routerResult = await callLLM({
    provider, apiKey, tier: 'light',
    system: ROUTER_SYSTEM,
    messages: [...history, { role: 'user', content: userMessage }],
    max_tokens: 400,
  });
  totalLatency += routerResult.latency_ms;
  if (routerResult.usage.input_tokens) totalTokens.input += routerResult.usage.input_tokens;
  if (routerResult.usage.output_tokens) totalTokens.output += routerResult.usage.output_tokens;

  let routerDecision;
  try {
    const jsonMatch = routerResult.text.match(/\{[\s\S]*\}/);
    routerDecision = JSON.parse(jsonMatch ? jsonMatch[0] : routerResult.text);
  } catch {
    routerDecision = { intent: 'ambiguous', workers: ['retrieval'], reasoning: 'Router output unparseable', clarification_needed: null };
  }
  executionGraph.router = { ...routerDecision, latency_ms: routerResult.latency_ms };

  // Handle clarification or unsupported up-front
  if (routerDecision.intent === 'ambiguous' && routerDecision.clarification_needed) {
    return {
      answer: routerDecision.clarification_needed,
      execution_graph: executionGraph,
      confidence: { total: 100, band: 'green', factors: {} },
      sources: [],
      suggested_followups: [],
      latency_ms: totalLatency,
      tokens_used: totalTokens.input + totalTokens.output,
    };
  }
  if (routerDecision.intent === 'unsupported') {
    return {
      answer: "That question is outside what I can help with right now. I can answer questions about your loaded financial data — revenues, expenses, budgets, cash flow, variances, trends, and entity comparisons.",
      execution_graph: executionGraph,
      confidence: { total: 100, band: 'green', factors: {} },
      sources: [], suggested_followups: [], latency_ms: totalLatency,
      tokens_used: totalTokens.input + totalTokens.output,
    };
  }

  // ---------- TIER 2: WORKERS ----------
  // For simplicity in MVP, run a single combined worker with all tools.
  // The router classification helps the worker know what to focus on.
  const workerSystem = `${WORKER_SYSTEM_BASE}\n\nThe Router classified this question as: ${routerDecision.intent}.\nReasoning: ${routerDecision.reasoning}\n\nUse the available tools to gather data and (if needed) compute results. When you have enough, return a concise plain-text findings summary that the Response Synthesizer will turn into the final answer.`;

  const workerResult = await runAgentLoop({
    provider, apiKey, tier: 'heavy',
    system: workerSystem,
    initialMessages: [...history, { role: 'user', content: userMessage }],
    tools: CHAT_TOOL_SPECS,
    toolHandlers,
    maxTurns: 10,
    onToolCall,
    agentName: 'worker',
  });
  totalLatency += workerResult.latency_ms;
  if (workerResult.usage.input_tokens) totalTokens.input += workerResult.usage.input_tokens;
  if (workerResult.usage.output_tokens) totalTokens.output += workerResult.usage.output_tokens;

  // Track sources from tool calls
  for (const t of workerResult.trace) {
    if (t.type === 'tool_call' && t.output) {
      if (t.output.source_metadata?.table) allSources.add(t.output.source_metadata.table);
      if (t.output.source_metadata?.primary_table) allSources.add(t.output.source_metadata.primary_table);
      if (t.input?.table) allSources.add(t.input.table);
    }
  }
  executionGraph.workers.push({
    name: 'combined_worker',
    findings: workerResult.final_text,
    trace: workerResult.trace,
    latency_ms: workerResult.latency_ms,
  });

  // ---------- SYNTHESIZER ----------
  const synthInput = `User question: "${userMessage}"\n\nWorker findings:\n${workerResult.final_text}\n\nWrite the final answer for the user now.`;
  const synthResult = await callLLM({
    provider, apiKey, tier: 'light',
    system: SYNTHESIZER_SYSTEM,
    messages: [{ role: 'user', content: synthInput }],
    max_tokens: 1500,
  });
  totalLatency += synthResult.latency_ms;
  if (synthResult.usage.input_tokens) totalTokens.input += synthResult.usage.input_tokens;
  if (synthResult.usage.output_tokens) totalTokens.output += synthResult.usage.output_tokens;

  // Extract followups
  let answer = synthResult.text;
  let followups = [];
  const followupMatch = answer.match(/```followups\s*([\s\S]*?)```/);
  if (followupMatch) {
    try {
      followups = JSON.parse(followupMatch[1].trim());
    } catch { /* ignore */ }
    answer = answer.replace(/```followups[\s\S]*?```/, '').trim();
  }

  executionGraph.synthesizer = { latency_ms: synthResult.latency_ms };

  // Confidence
  const confidence = scoreFromTrace(workerResult.trace);

  return {
    answer,
    execution_graph: executionGraph,
    confidence,
    sources: Array.from(allSources),
    suggested_followups: followups,
    latency_ms: totalLatency,
    tokens_used: totalTokens.input + totalTokens.output,
  };
}

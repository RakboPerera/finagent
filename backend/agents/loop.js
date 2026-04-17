// backend/agents/loop.js
// Generic tool-use loop. Calls LLM, executes tools, feeds results back, repeats until stop.
import { callLLM } from './llm.js';

export async function runAgentLoop({
  provider, apiKey, tier = 'light',
  system, initialMessages, tools, toolHandlers,
  maxTurns = 8,
  onToolCall = null, // (agent, tool, input, output, latency) => void
  agentName = 'agent',
}) {
  const messages = [...initialMessages];
  const trace = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let totalLatency = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await callLLM({
      provider, apiKey, tier, system, messages, tools, max_tokens: 2500,
    });
    totalLatency += result.latency_ms;
    if (result.usage.input_tokens) totalUsage.input_tokens += result.usage.input_tokens;
    if (result.usage.output_tokens) totalUsage.output_tokens += result.usage.output_tokens;

    trace.push({ type: 'llm_call', turn, text: result.text, tool_uses: result.tool_uses, stop_reason: result.stop_reason });

    // No tools requested → done
    if (!result.tool_uses || result.tool_uses.length === 0) {
      return { final_text: result.text, messages, trace, usage: totalUsage, latency_ms: totalLatency };
    }

    // Add assistant message with the tool_use blocks (Anthropic format)
    const assistantContent = [];
    if (result.text) assistantContent.push({ type: 'text', text: result.text });
    for (const tu of result.tool_uses) {
      assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool, build tool_result blocks
    const toolResultBlocks = [];
    for (const tu of result.tool_uses) {
      const handler = toolHandlers[tu.name];
      const t0 = Date.now();
      let output, isError = false;
      if (!handler) {
        output = { error: `Tool '${tu.name}' not available` };
        isError = true;
      } else {
        try {
          output = await handler(tu.input);
        } catch (e) {
          output = { error: e.message };
          isError = true;
        }
      }
      const latency = Date.now() - t0;
      trace.push({ type: 'tool_call', tool: tu.name, input: tu.input, output, latency_ms: latency, error: isError });
      if (onToolCall) onToolCall(agentName, tu.name, tu.input, output, latency);
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: typeof output === 'string' ? output : JSON.stringify(output),
        is_error: isError,
      });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  return {
    final_text: '(agent loop reached maxTurns without final answer)',
    messages, trace, usage: totalUsage, latency_ms: totalLatency,
    truncated: true,
  };
}

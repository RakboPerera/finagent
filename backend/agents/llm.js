// backend/agents/llm.js
// Multi-provider LLM router. Keys come from the frontend (localStorage) on every request.
// Providers: anthropic, openai, google, deepseek.
// Models: claude-haiku-4-5 (light), claude-sonnet-4-6 (heavy), or equivalents per provider.

const PROVIDER_DEFAULTS = {
  anthropic: {
    light: 'claude-haiku-4-5-20251001',
    heavy: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    light: 'gpt-4o-mini',
    heavy: 'gpt-4o',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  google: {
    light: 'gemini-2.0-flash',
    heavy: 'gemini-2.0-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
  deepseek: {
    light: 'deepseek-chat',
    heavy: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
  },
};

// Normalize a tool spec into the provider's required shape.
// tools: [{ name, description, input_schema: { type:'object', properties:{...}, required:[...] } }]
function adaptToolsAnthropic(tools) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

function adaptToolsOpenAI(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// Fetch with timeout helper
async function fetchWithTimeout(url, opts, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`LLM request timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Unified call. Returns { text, tool_uses: [{id,name,input}], stop_reason, raw, usage }
export async function callLLM({
  provider = 'anthropic',
  apiKey,
  tier = 'light', // 'light' | 'heavy'
  system = '',
  messages = [],
  tools = null,
  max_tokens = 2000,
  temperature = 0,
  timeoutMs = 90_000,
}) {
  if (!apiKey) {
    throw new Error(`No API key provided for provider "${provider}". Add it in Settings.`);
  }

  const cfg = PROVIDER_DEFAULTS[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  const model = tier === 'heavy' ? cfg.heavy : cfg.light;
  const t0 = Date.now();

  if (provider === 'anthropic') {
    const body = {
      model,
      max_tokens,
      temperature,
      system,
      messages,
    };
    if (tools && tools.length) body.tools = adaptToolsAnthropic(tools);

    const res = await fetchWithTimeout(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input }));
    return {
      text: textBlocks.join('\n'),
      tool_uses: toolBlocks,
      stop_reason: data.stop_reason,
      raw: data,
      usage: data.usage || {},
      latency_ms: Date.now() - t0,
      model,
      provider,
    };
  }

  if (provider === 'openai') {
    const oaiMessages = [];
    if (system) oaiMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      oaiMessages.push(_anthropicMsgToOpenAI(m));
    }
    const body = { model, messages: oaiMessages, max_tokens, temperature };
    if (tools && tools.length) {
      body.tools = adaptToolsOpenAI(tools);
      body.tool_choice = 'auto';
    }
    const res = await fetchWithTimeout(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    const tool_uses = (choice?.message?.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    }));
    return {
      text,
      tool_uses,
      stop_reason: choice?.finish_reason,
      raw: data,
      usage: data.usage || {},
      latency_ms: Date.now() - t0,
      model,
      provider,
    };
  }

  if (provider === 'google') {
    // Gemini API
    const url = `${cfg.endpoint}/${model}:generateContent?key=${apiKey}`;
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));
    const body = {
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { maxOutputTokens: max_tokens, temperature },
    };
    if (tools && tools.length) {
      body.tools = [{ functionDeclarations: tools.map(t => ({
        name: t.name, description: t.description, parameters: t.input_schema,
      })) }];
    }
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google API ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter(p => p.text).map(p => p.text).join('\n');
    const tool_uses = parts.filter(p => p.functionCall).map((p, i) => ({
      id: `call_${i}`, name: p.functionCall.name, input: p.functionCall.args || {},
    }));
    return {
      text, tool_uses, stop_reason: data.candidates?.[0]?.finishReason,
      raw: data, usage: data.usageMetadata || {},
      latency_ms: Date.now() - t0, model, provider,
    };
  }

  if (provider === 'deepseek') {
    // DeepSeek follows OpenAI format
    const oaiMessages = [];
    if (system) oaiMessages.push({ role: 'system', content: system });
    for (const m of messages) oaiMessages.push(_anthropicMsgToOpenAI(m));
    const body = { model, messages: oaiMessages, max_tokens, temperature };
    if (tools && tools.length) { body.tools = adaptToolsOpenAI(tools); body.tool_choice = 'auto'; }
    const res = await fetchWithTimeout(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    const tool_uses = (choice?.message?.tool_calls || []).map(tc => ({
      id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}'),
    }));
    return {
      text, tool_uses, stop_reason: choice?.finish_reason, raw: data,
      usage: data.usage || {}, latency_ms: Date.now() - t0, model, provider,
    };
  }

  throw new Error(`Provider ${provider} not implemented`);
}

function _anthropicMsgToOpenAI(m) {
  // m.content can be string or array of blocks. Flatten to string for OpenAI.
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  if (Array.isArray(m.content)) {
    // Tool result blocks need special handling for OpenAI
    const toolResults = m.content.filter(b => b.type === 'tool_result');
    if (toolResults.length && m.role === 'user') {
      // OpenAI uses role: 'tool' for tool results
      return {
        role: 'tool',
        tool_call_id: toolResults[0].tool_use_id,
        content: typeof toolResults[0].content === 'string'
          ? toolResults[0].content
          : JSON.stringify(toolResults[0].content),
      };
    }
    const textParts = m.content.filter(b => b.type === 'text').map(b => b.text);
    return { role: m.role, content: textParts.join('\n') };
  }
  return { role: m.role, content: String(m.content) };
}

// Connectivity test — tiny call to verify a key works
export async function testConnectivity(provider, apiKey) {
  try {
    const r = await callLLM({
      provider, apiKey, tier: 'light',
      messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
      max_tokens: 10,
    });
    return { ok: true, model: r.model, response: r.text.trim(), latency_ms: r.latency_ms };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

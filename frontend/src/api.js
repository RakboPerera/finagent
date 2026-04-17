import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

// Provider keys live in localStorage
const KEYS_STORAGE = 'finagent_llm_keys';
const ACTIVE_PROVIDER = 'finagent_active_provider';

export function getLlmConfig() {
  const raw = localStorage.getItem(KEYS_STORAGE);
  const keys = raw ? JSON.parse(raw) : {};
  const provider = localStorage.getItem(ACTIVE_PROVIDER) || 'anthropic';
  const apiKey = keys[provider] || '';
  return { provider, apiKey, allKeys: keys };
}

export function setLlmKey(provider, apiKey) {
  const raw = localStorage.getItem(KEYS_STORAGE);
  const keys = raw ? JSON.parse(raw) : {};
  if (apiKey) keys[provider] = apiKey;
  else delete keys[provider];
  localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
}

export function setActiveProvider(provider) {
  localStorage.setItem(ACTIVE_PROVIDER, provider);
}

// Only attach the LLM key on endpoints that actually proxy to the provider.
// This keeps the key out of GET /tables, /dashboard/insights, etc., reducing its
// exposure surface in browser dev-tools, request logs, and network traces.
const LLM_PROXY_ENDPOINTS = [
  '/chat/messages',       // chat orchestrator (router + worker + synthesizer)
  '/uploads',             // multipart upload (classifier/mapper/validator all need key)
  '/uploads/jobs',        // job polling + confirm-mapping / resolve-conflicts
  '/settings/test-connection', // connectivity test from Settings page
];

api.interceptors.request.use((config) => {
  const url = config.url || '';
  const needsKey = LLM_PROXY_ENDPOINTS.some(p => url.includes(p));
  if (!needsKey) return config;
  const { provider, apiKey } = getLlmConfig();
  if (provider) config.headers['X-LLM-Provider'] = provider;
  if (apiKey) config.headers['X-LLM-Api-Key'] = apiKey;
  return config;
});

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
  { id: 'openai', name: 'OpenAI (GPT)', placeholder: 'sk-...' },
  { id: 'google', name: 'Google (Gemini)', placeholder: 'AIza...' },
  { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...' },
];

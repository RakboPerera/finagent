import React, { useState, useEffect } from 'react';
import { Check, X, Loader, RefreshCw, AlertTriangle } from 'lucide-react';
import { api, getLlmConfig, setLlmKey, setActiveProvider, PROVIDERS } from '../api';

export default function SettingsPage() {
  const [keys, setKeys] = useState({});
  const [active, setActive] = useState('anthropic');
  const [testStatus, setTestStatus] = useState({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = getLlmConfig();
    setKeys(cfg.allKeys || {});
    setActive(cfg.provider);
  }, []);

  const onKeyChange = (provider, value) => {
    setKeys(k => ({ ...k, [provider]: value }));
    setLlmKey(provider, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const onActiveChange = (provider) => {
    setActive(provider);
    setActiveProvider(provider);
  };

  const test = async (provider) => {
    const apiKey = keys[provider];
    if (!apiKey) {
      setTestStatus(s => ({ ...s, [provider]: { ok: false, error: 'No key set' } }));
      return;
    }
    setTestStatus(s => ({ ...s, [provider]: { loading: true } }));
    try {
      const res = await api.post('/settings/test-connection', { provider, apiKey });
      setTestStatus(s => ({ ...s, [provider]: res.data }));
    } catch (e) {
      setTestStatus(s => ({ ...s, [provider]: { ok: false, error: e.response?.data?.error || e.message } }));
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Configure LLM provider keys. Keys are stored only in your browser (localStorage).</div>
        </div>
      </div>
      <div className="page-body">
        <div className="settings-page">
          <div className="settings-section">
            <h3>Active provider</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 12px 0' }}>
              The provider to use for chat queries and ingestion agents.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className={'btn' + (active === p.id ? ' btn-primary' : '')}
                  onClick={() => onActiveChange(p.id)}
                  disabled={!keys[p.id]}
                  title={!keys[p.id] ? 'Set a key first' : ''}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <h3>Provider API keys {saved && <span style={{ fontSize: 11, color: 'var(--c-success)', marginLeft: 8 }}>✓ saved</span>}</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 8px 0' }}>
              Keys never leave your browser except to call the corresponding provider API. They are sent on each request via headers.
            </p>
            {PROVIDERS.map(p => {
              const status = testStatus[p.id];
              return (
                <div key={p.id} className="provider-row">
                  <div style={{ fontWeight: 500 }}>{p.name}</div>
                  <input
                    type="password"
                    placeholder={p.placeholder}
                    value={keys[p.id] || ''}
                    onChange={e => onKeyChange(p.id, e.target.value)}
                  />
                  <button className="btn btn-sm" onClick={() => test(p.id)}>
                    {status?.loading ? <Loader size={12} className="spin" /> : 'Test'}
                  </button>
                  {status && !status.loading && (
                    status.ok
                      ? <span className="provider-status ok"><Check size={11} style={{ verticalAlign: -1 }} /> {status.model}</span>
                      : <span className="provider-status fail"><X size={11} style={{ verticalAlign: -1 }} /> {status.error?.slice(0, 50)}</span>
                  )}
                </div>
              );
            })}
          </div>

          <DemoResetSection />

          <div className="settings-section">
            <h3>About</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>
              FinAgent — Tool 1: Gen AI Financial Chatbot. Single-service deployment on Render.com. Pure JavaScript stack: Node.js + Express + sql.js + React + Vite.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function DemoResetSection() {
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState(null);

  const handleReset = async () => {
    if (!confirm('Reset all demo data?\n\nThis will:\n  • Delete all canonical table rows\n  • Delete all chat conversations (including demos)\n  • Delete all upload jobs\n  • Re-seed fresh sample data and demo content\n\nYour API key settings will not be affected.')) return;
    setResetting(true); setResult(null);
    try {
      const res = await api.post('/admin/reset-demo');
      setResult({ ok: true, message: res.data.message || 'Reset complete' });
    } catch (e) {
      setResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="settings-section">
      <h3>Demo</h3>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '0 0 12px 0' }}>
        Restore the app to its initial state — useful if you've been exploring and want to start fresh.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn" onClick={handleReset} disabled={resetting}>
          {resetting ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
          {resetting ? ' Resetting...' : ' Reset demo data'}
        </button>
        {result && (
          <span className={'provider-status ' + (result.ok ? 'ok' : 'fail')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {result.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {result.message}
            {result.ok && <a href="/" style={{ marginLeft: 6 }}>Go to Overview</a>}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 10 }}>
        Resets: 6 canonical tables (3,894 rows), 6 demo conversations, 8 data quality issues, 1 upload job, 5 AI insights.
      </div>
    </div>
  );
}

// frontend/src/components/Chat/ChatView.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Info, ChevronDown, ChevronRight, Database, Sparkles, Lock, AlertTriangle } from 'lucide-react';
import { api, getLlmConfig } from '../../api';

export default function ChatView({ conversationId, onConversationCreated, initialQuestion }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState(conversationId);
  const [progressStage, setProgressStage] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [conversationIsDemo, setConversationIsDemo] = useState(false);
  const messagesRef = useRef(null);
  const navigate = useNavigate();
  const { apiKey } = getLlmConfig();

  useEffect(() => {
    setConvId(conversationId);
    if (conversationId) {
      api.get(`/chat/conversations/${conversationId}`).then(r => {
        setMessages(r.data.messages);
        setConversationIsDemo(r.data.conversation?.is_demo === 1);
      });
    } else {
      setMessages([]);
      setConversationIsDemo(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  // Handle initial question from dashboard drill
  useEffect(() => {
    if (initialQuestion && !sending && messages.length === 0) {
      send(initialQuestion);
    }
  }, [initialQuestion]);

  // Time-based progress stage indicator (no backend changes needed).
  // Backend chat latency is typically 15-50s for complex questions. We keep users
  // on "Querying" for most of that window since that's where the real work happens,
  // then only flip to "Composing" near the end. If the query runs >60s we show an
  // amber long-running notice so users know it's still active.
  useEffect(() => {
    if (!sending) { setProgressStage(null); setElapsedSec(0); return; }
    const started = Date.now();
    const tick = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      setElapsedSec(sec);
      if (sec < 3) {
        setProgressStage({ label: 'Classifying question', sub: 'Router is analyzing intent...', num: 1 });
      } else if (sec < 50) {
        setProgressStage({
          label: 'Querying your data',
          sub: sec < 10
            ? 'Worker agents running tools...'
            : `Worker agents running tools · ${sec}s elapsed`,
          num: 2,
          longRunning: sec >= 45,
        });
      } else {
        setProgressStage({
          label: 'Composing answer',
          sub: `Synthesizer formatting response · ${sec}s elapsed`,
          num: 3,
          longRunning: sec >= 60,
        });
      }
    }, 500);
    return () => clearInterval(tick);
  }, [sending]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || sending) return;
    if (!apiKey) return; // Should be disabled, but safety net
    setInput('');
    setSending(true);
    setMessages(m => [...m, { role: 'user', content: msg, _pending: true }]);
    try {
      const res = await api.post('/chat/messages', { conversation_id: convId, message: msg });
      const newConvId = res.data.conversation_id;
      if (!convId) {
        setConvId(newConvId);
        onConversationCreated?.(newConvId);
      }
      setMessages(m => [
        ...m.filter(x => !x._pending),
        { role: 'user', content: msg },
        {
          role: 'assistant',
          content: res.data.answer,
          execution_graph_json: res.data.execution_graph,
          confidence: res.data.confidence?.total,
          confidence_breakdown_json: res.data.confidence,
          sources_json: res.data.sources,
          suggested_followups_json: res.data.suggested_followups,
          latency_ms: res.data.latency_ms,
        },
      ]);
    } catch (e) {
      const errMsg = e.response?.data?.error || e.message;
      setMessages(m => [
        ...m.filter(x => !x._pending),
        { role: 'user', content: msg },
        { role: 'assistant', content: `Error: ${errMsg}`, _error: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-layout">
      <div className="chat-messages" ref={messagesRef}>
        {conversationIsDemo && (
          <div className="demo-badge-banner">
            <Sparkles size={14} />
            <span><strong>Demo conversation</strong> — this is a pre-recorded example showing how the agents answer questions about your data. Add an API key to ask your own.</span>
          </div>
        )}
        {messages.length === 0 && !initialQuestion && (
          <div className="empty-state">
            <h3>Start a conversation</h3>
            <p>Ask about your loaded financial data — try one of these to see the agents dig into the seeded data anomalies:</p>
            <div className="followups" style={{ maxWidth: 520, margin: '20px auto 0' }}>
              {[
                'Which accounts had the biggest budget variances in Q3 2024?',
                'What happened with ACME-LA in H2 2024?',
                'Is APAC revenue underperforming?',
                'Compare ACME-NA Q4 2024 budget vs actual',
              ].map(q => (
                <button
                  key={q}
                  className="followup-btn"
                  onClick={() => send(q)}
                  disabled={!apiKey}
                  title={!apiKey ? 'Add an API key in Settings to ask new questions' : ''}
                >
                  {q}
                </button>
              ))}
            </div>
            {!apiKey && (
              <div className="banner banner-info" style={{ maxWidth: 520, margin: '24px auto 0', justifyContent: 'center' }}>
                <Lock size={14} /> Add an API key in <a href="/settings">Settings</a> to ask your own questions. Meanwhile, open a demo conversation from the sidebar to see the agents in action.
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} m={m} onFollowup={send} navigate={navigate} />
        ))}
        {sending && progressStage && (
          <div className="chat-message assistant">
            <div className="chat-bubble chat-progress">
              <div className="chat-progress-header">
                <span className="spinner-inline" />
                <span className="chat-progress-label">{progressStage.label}</span>
                <span className="chat-progress-elapsed">{elapsedSec}s</span>
              </div>
              <div className="chat-progress-steps">
                {[
                  { n: 1, name: 'Classifying' },
                  { n: 2, name: 'Querying' },
                  { n: 3, name: 'Composing' },
                ].map(s => (
                  <div key={s.n} className={
                    'chat-progress-step' +
                    (progressStage.num === s.n ? ' active' : '') +
                    (progressStage.num > s.n ? ' done' : '')
                  }>
                    <span className="chat-progress-step-num">{s.n}</span>
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
              <div className="chat-progress-sub">{progressStage.sub}</div>
              {progressStage.longRunning && (
                <div className="chat-progress-longnote">
                  <AlertTriangle size={11} /> This question is taking longer than usual. Complex multi-table queries can take 60-90s — still working...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-bar">
        <textarea
          rows={1}
          placeholder={apiKey ? 'Ask about your data...' : 'Add an API key in Settings to ask new questions'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          disabled={sending || !apiKey}
        />
        <button
          className="btn btn-primary"
          disabled={sending || !input.trim() || !apiKey}
          onClick={() => send()}
          title={!apiKey ? 'Add an API key in Settings to chat' : ''}
        >
          {!apiKey ? <><Lock size={14} /> Add key to chat</> : <><Send size={14} /> Send</>}
        </button>
      </div>
    </div>
  );
}

function Message({ m, onFollowup, navigate }) {
  const [showWork, setShowWork] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  if (m.role === 'user') {
    return <div className="chat-message user"><div className="chat-bubble">{m.content}</div></div>;
  }
  const conf = m.confidence;
  const confBand = conf == null ? null : (conf >= 80 ? 'green' : conf >= 50 ? 'yellow' : 'red');
  const sources = m.sources_json || [];
  const followups = m.suggested_followups_json || [];

  const navigateToTable = (tableName) => {
    navigate(`/workspace/${tableName}`);
  };

  return (
    <div className="chat-message assistant">
      <div className="chat-bubble">
        <RenderedMarkdown text={m.content} />
        {(conf != null || sources.length > 0 || m.latency_ms) && (
          <div className="chat-meta" style={{ marginTop: 10 }}>
            {conf != null && (
              <span className={`confidence-badge ${confBand}`} onClick={() => setShowBreakdown(s => !s)} title="Confidence (click for breakdown)">
                <Info size={11} /> {conf}%
              </span>
            )}
            {sources.map(s => (
              <span
                key={s}
                className="source-chip source-chip-clickable"
                onClick={() => navigateToTable(s)}
                title={`View ${s} in Data Workspace`}
              >
                <Database size={10} style={{ marginRight: 3 }} /> {s}
              </span>
            ))}
            {m.latency_ms && <span>{(m.latency_ms / 1000).toFixed(1)}s</span>}
            <button className="btn btn-sm" onClick={() => setShowWork(s => !s)} style={{ marginLeft: 'auto' }}>
              {showWork ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Show work
            </button>
          </div>
        )}
        {showBreakdown && m.confidence_breakdown_json && (
          <div className="show-work-panel">
            <div className="show-work-label">Confidence breakdown</div>
            {Object.entries(m.confidence_breakdown_json.factors || {}).map(([f, v]) => (
              <div key={f} className="confidence-factor-row">
                <span className="confidence-factor-name">{f.replace(/_/g, ' ')}</span>
                <div className="confidence-factor-bar-bg">
                  <div className="confidence-factor-bar" style={{ width: `${v.score}%`, background: v.score >= 80 ? '#16a34a' : v.score >= 50 ? '#d97706' : '#dc2626' }} />
                </div>
                <span className="confidence-factor-score">{v.score}%</span>
                <span className="confidence-factor-weight">({v.weight}%)</span>
              </div>
            ))}
          </div>
        )}
        {showWork && m.execution_graph_json && (
          <div className="show-work-panel">
            <div className="show-work-section">
              <div className="show-work-label">Router decision</div>
              <div style={{ fontSize: 12 }}>
                <strong>Intent:</strong> {m.execution_graph_json.router?.intent}
                {' '}<strong>Workers:</strong> {(m.execution_graph_json.router?.workers || []).join(', ')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>
                {m.execution_graph_json.router?.reasoning}
              </div>
            </div>
            {(m.execution_graph_json.workers || []).map((w, i) => (
              <div key={i} className="show-work-section">
                <div className="show-work-label">{w.name} — {(w.latency_ms/1000).toFixed(1)}s</div>
                <pre>{w.findings}</pre>
                <div className="show-work-label" style={{ marginTop: 8, fontSize: 11 }}>Tool calls ({(w.trace || []).filter(t => t.type === 'tool_call').length})</div>
                {(w.trace || []).filter(t => t.type === 'tool_call').map((t, j) => (
                  <details key={j} style={{ marginBottom: 4 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                      {t.tool} ({t.latency_ms}ms) {t.error ? ' [ERROR]' : ''}
                    </summary>
                    <pre style={{ fontSize: 10, paddingLeft: 12 }}>input: {JSON.stringify(t.input, null, 1)}{'\n\n'}output: {JSON.stringify(t.output).slice(0, 500)}{JSON.stringify(t.output).length > 500 ? '...' : ''}</pre>
                  </details>
                ))}
              </div>
            ))}
            {m.execution_graph_json.synthesizer && (
              <div className="show-work-section">
                <div className="show-work-label">Synthesizer — {(m.execution_graph_json.synthesizer.latency_ms/1000).toFixed(1)}s</div>
              </div>
            )}
          </div>
        )}
      </div>
      {followups.length > 0 && (
        <div className="followups">
          {followups.map((q, i) => (
            <button key={i} className="followup-btn" onClick={() => onFollowup(q)}>{q}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Markdown renderer — handles headings, paragraphs, **bold**, tables, lists, code
function RenderedMarkdown({ text }) {
  if (!text) return null;
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, i) => {
        // Heading detection
        const headingMatch = block.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const Tag = `h${level + 1}`; // h1 in doc -> h2 in UI, etc.
          return <Tag key={i} style={{ margin: '12px 0 6px', fontSize: level === 1 ? 16 : level === 2 ? 14 : 13 }}>{inline(headingMatch[2])}</Tag>;
        }

        // Table
        if (/^\s*\|.*\|/.test(block) && /\|\s*-+/.test(block)) {
          const lines = block.split('\n').filter(l => l.trim());
          const header = lines[0].split('|').map(s => s.trim()).filter(Boolean);
          const rows = lines.slice(2).map(l => l.split('|').map(c => c.trim()).filter((cell, j, a) => (j === 0 || j === a.length - 1) ? cell !== '' : true));
          return (
            <table key={i}>
              <thead><tr>{header.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead>
              <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
            </table>
          );
        }
        // Numbered list
        if (/^\s*\d+[\.\)]\s/.test(block)) {
          const items = block.split('\n').filter(Boolean).map(l => l.replace(/^\s*\d+[\.\)]\s/, ''));
          return <ol key={i} style={{ margin: '4px 0 8px 20px' }}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
        }
        // Bullet list
        if (/^\s*[-*]\s/.test(block)) {
          const items = block.split('\n').filter(Boolean).map(l => l.replace(/^\s*[-*]\s/, ''));
          return <ul key={i} style={{ margin: '4px 0 8px 20px' }}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
        }
        return <p key={i}>{inline(block)}</p>;
      })}
    </>
  );
}

function inline(s) {
  const parts = [];
  let key = 0;
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let m, last = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<code key={key++}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

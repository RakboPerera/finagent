import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  MessageSquare, Database, Upload, Brain, FileSearch, Layers, CheckCircle,
  GitMerge, ArrowRight, Sparkles, Shield, BarChart3, Settings, Zap,
  TrendingUp, TrendingDown, Target, ChevronRight, Bot, AlertTriangle,
  DollarSign, Wallet, Percent, Activity, PieChart as PieIcon, Repeat,
} from 'lucide-react';
import { api, getLlmConfig } from '../api';

// ── Scope & agent-type badge data ──────────────────────────────
const featurePillars = [
  {
    icon: <Brain size={22} />,
    title: 'Data Ingestion',
    subtitle: 'Pillar 1',
    color: '#3b82f6',
    description: 'A 6-agent pipeline that takes any financial file — messy GL exports, budget spreadsheets, billing reports — and turns it into clean, structured, canonical data. No config screens, no IT.',
    agents: [
      { icon: <FileSearch size={13} />, name: 'File Parser',       type: 'code', scope: 'enhance', desc: 'Reads Excel, CSV, PDF, JSON. Detects sheets, headers, merged cells.' },
      { icon: <Layers size={13} />,     name: 'Sheet Classifier',  type: 'ai',   scope: 'in',     desc: 'LLM decides what each sheet is — GL, budget, revenue, or ignore.' },
      { icon: <Target size={13} />,     name: 'Schema Mapper',     type: 'ai',   scope: 'in',     desc: 'LLM maps source columns to canonical fields. Reuses prior mappings automatically.' },
      { icon: <Shield size={13} />,     name: 'Data Validator',    type: 'code', scope: 'in',     desc: 'Mechanical + semantic checks: types, FKs, outliers, sign anomalies, period gaps.' },
      { icon: <GitMerge size={13} />,   name: 'Reconciler',        type: 'code', scope: 'enhance', desc: 'Compares against existing data. Auto-dedupes; surfaces conflicts for your decision.' },
      { icon: <CheckCircle size={13} />,name: 'Loader',            type: 'code', scope: 'enhance', desc: 'Single-transaction write. Stamps provenance, saves mapping memory, triggers insight regen.' },
    ],
    capabilities: [
      { text: 'Upload any financial file — Excel, CSV, PDF, JSON',                                            scope: 'in' },
      { text: 'LLM auto-classifies each sheet (GL? Budget? Revenue? Ignore?)',                               scope: 'in' },
      { text: 'LLM maps source columns to the canonical schema',                                              scope: 'in' },
      { text: 'Two-layer validation — mechanical checks then AI semantic checks',                             scope: 'in' },
      { text: 'Mapping memory — repeat uploads reuse the prior mapping (zero LLM tokens, zero latency)',      scope: 'enhance' },
      { text: 'Human-in-the-loop — pipeline pauses for mapping review and conflict resolution',               scope: 'enhance' },
      { text: 'Single-transaction load with full provenance stamping and audit trail',                        scope: 'enhance' },
    ],
  },
  {
    icon: <Database size={22} />,
    title: 'Data Workspace',
    subtitle: 'Pillar 2',
    color: '#10b981',
    description: 'A spreadsheet-grade table editor for the 6 canonical tables. The trust layer — finance teams need to see the data to trust the answers.',
    agents: [],
    capabilities: [
      { text: '6 canonical financial tables, 3,900+ rows of realistic seeded data',                          scope: 'enhance' },
      { text: 'Inline editing with 50-step undo/redo',                                                       scope: 'enhance' },
      { text: 'Find & replace, keyboard navigation, column resize',                                          scope: 'enhance' },
      { text: 'Bulk paste from Excel (multi-row, multi-column via Ctrl+V)',                                  scope: 'enhance' },
      { text: 'Per-row data-quality indicators from the validator\'s issue log',                             scope: 'enhance' },
      { text: 'Row detail panel — source file, confidence score, who edited, timestamps',                    scope: 'enhance' },
      { text: 'Download templates as Excel or JSON',                                                          scope: 'enhance' },
    ],
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Intelligence Layer',
    subtitle: 'Pillar 3',
    color: '#f59e0b',
    description: 'An insight engine and narrator agent that continuously scan your canonical data, rank what matters by $-impact, and push it to a live dashboard. Auto-regenerates on every upload.',
    agents: [
      { icon: <Sparkles size={13} />, name: 'Insight Engine (11 rules)', type: 'code', scope: 'enhance', desc: 'Runs 11 signal rules in parallel — variance, YoY, margin, DSO, AR aging, outliers, concentration.' },
      { icon: <Bot size={13} />,      name: 'Narrator Agent',            type: 'ai',   scope: 'enhance', desc: 'LLM ranks signals by severity × $-impact, dedupes overlaps, writes insight cards. Top 12 only.' },
    ],
    capabilities: [
      { text: '6 hero KPI tiles — each with delta arrow and 12-period sparkline',                            scope: 'enhance' },
      { text: '9 curated financial charts (revenue trend, waterfall, AR aging, YoY, heatmap, …)',            scope: 'enhance' },
      { text: '11 automated insight rules — variance, budget attainment, margin, DSO, concentration, outliers, …', scope: 'enhance' },
      { text: 'Narrator agent ranks signals by $-impact, caps at top 12 — no noise',                         scope: 'enhance' },
      { text: 'Every insight card has sparkline + source row references + "ask in chat" button',              scope: 'enhance' },
      { text: 'Dashboard auto-regenerates on every successful upload',                                        scope: 'enhance' },
    ],
  },
  {
    icon: <MessageSquare size={22} />,
    title: 'Conversational Brain',
    subtitle: 'Pillar 4',
    color: '#8b5cf6',
    description: 'A three-tier AI chat agent that answers financial questions with a full audit trail, source provenance, and a 5-factor confidence score on every answer.',
    agents: [
      { icon: <Bot size={13} />,     name: 'Router',          type: 'ai', scope: 'in', desc: 'LLM classifies your question into 7 intent types in ~1–2s.' },
      { icon: <Zap size={13} />,     name: 'Worker + 6 Tools',type: 'ai', scope: 'in', desc: 'LLM runs a tool loop with 6 whitelisted tools. Typically 3–5 calls per answer.' },
      { icon: <Sparkles size={13} />,name: 'Synthesizer',     type: 'ai', scope: 'in', desc: 'LLM writes the final answer + 3 follow-up suggestions + confidence breakdown.' },
    ],
    capabilities: [
      { text: 'Natural-language queries over your financial data',                                            scope: 'in' },
      { text: '5-factor confidence scoring on every answer — green ≥80, amber 50–79, red <50',               scope: 'in' },
      { text: '"Show Work" panel — every tool call, input, output, and latency visible',                      scope: 'in' },
      { text: 'Clickable source chips linking back to the exact workspace rows',                              scope: 'in' },
      { text: 'All math executed in code (JS expressions), never in the LLM\'s head',                        scope: 'in' },
      { text: '6 whitelisted tools with SQL injection-proof identifier validation',                           scope: 'enhance' },
      { text: '3-tier architecture — Router classifies, Worker queries, Synthesizer writes',                  scope: 'enhance' },
      { text: '3 smart follow-up suggestions generated per answer',                                           scope: 'enhance' },
    ],
  },
];

const enhancementHighlights = [
  { icon: <Repeat size={14} />,   text: 'Mapping memory — zero LLM cost on repeat uploads' },
  { icon: <Zap size={14} />,      text: '4 AI providers — Anthropic, OpenAI, Google, DeepSeek. No lock-in.' },
  { icon: <Shield size={14} />,   text: 'Bring-your-own-key — API key never stored on the server' },
  { icon: <Sparkles size={14} />, text: '3,900 seeded rows + 6 demo conversations + 14 insight cards, live from day one' },
];

// ── Main page ───────────────────────────────────────────────────
export default function OverviewPage() {
  const navigate = useNavigate();
  const { apiKey } = getLlmConfig();
  const [activeAgent, setActiveAgent] = useState(null);
  const [live, setLive] = useState(null);
  const [animated, setAnimated] = useState({ tables: 0, agents: 0, rules: 0, charts: 0 });

  useEffect(() => {
    Promise.all([
      api.get('/tables/').catch(() => ({ data: [] })),
      api.get('/dashboard/insights').catch(() => ({ data: [] })),
      api.get('/dashboard/kpis').catch(() => ({ data: { kpis: [] } })),
      api.get('/dashboard/curated').catch(() => ({ data: {} })),
    ]).then(([tablesR, insightsR, kpisR, curR]) => {
      const totalRows = tablesR.data.reduce((a, t) => a + (t.row_count || 0), 0);
      const userRows  = tablesR.data.reduce((a, t) => a + (t.user_count || 0), 0);
      setLive({
        total_rows: totalRows, user_rows: userRows,
        table_count: tablesR.data.length,
        insights_total: insightsR.data.length,
        insights_alerts: insightsR.data.filter(i => i.severity === 'warning' || i.severity === 'error').length,
        kpis: kpisR.data.kpis || [],
        entity_concentration: curR.data.entity_concentration || [],
        revenue_trend: curR.data.revenue_trend || [],
      });
    });
  }, []);

  useEffect(() => {
    const targets = { tables: 6, agents: 11, rules: 11, charts: 9 };
    const duration = 1100;
    const steps = 30;
    let step = 0;
    const t = setInterval(() => {
      step++;
      const progress = Math.min(step / steps, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setAnimated({
        tables:  Math.round(targets.tables  * ease),
        agents:  Math.round(targets.agents  * ease),
        rules:   Math.round(targets.rules   * ease),
        charts:  Math.round(targets.charts  * ease),
      });
      if (step >= steps) clearInterval(t);
    }, duration / steps);
    return () => clearInterval(t);
  }, []);

  const agents = [
    { icon: <FileSearch size={20} />, name: 'File Parser',      stage: 1, time: '1-3s',   color: '#3b82f6',
      description: 'Reads Excel, CSV, PDF, or JSON. Detects sheets, headers, merged cells, finds the actual data tables within each sheet.',
      output: 'Raw DataFrames with metadata per sheet' },
    { icon: <Layers size={20} />,     name: 'Sheet Classifier', stage: 2, time: '5-10s',  color: '#6366f1',
      description: 'Looks at each parsed sheet and determines what kind of financial data it contains — GL, budget, revenue, or ignore.',
      output: 'Classification per sheet' },
    { icon: <Target size={20} />,     name: 'Schema Mapper',    stage: 3, time: '10-20s', color: '#8b5cf6',
      description: 'Maps every source column to the correct canonical field. Proposes unit conversions, date format changes, PK synthesis. Reuses prior mappings automatically.',
      output: 'Column mappings with transformations' },
    { icon: <Shield size={20} />,     name: 'Data Validator',   stage: 4, time: '5-15s',  color: '#ec4899',
      description: 'Two-layer validation: mechanical checks (types, FKs, required fields, duplicates) then semantic checks (outliers, sign anomalies, period gaps).',
      output: 'Validation report with errors + warnings' },
    { icon: <GitMerge size={20} />,   name: 'Reconciler',       stage: 5, time: '5-10s',  color: '#f59e0b',
      description: 'Compares validated data against what already exists. Auto-dedupes exact matches; surfaces value conflicts for your decision.',
      output: 'Conflict report with resolution options' },
    { icon: <CheckCircle size={20} />,name: 'Loader',           stage: 6, time: '1-2s',   color: '#10b981',
      description: 'Writes everything in a single transaction — all or nothing. Stamps provenance, creates audit entries, saves mapping memory, triggers insight regen.',
      output: 'Rows loaded + insights refreshed' },
  ];

  const tables = [
    { name: 'Entity Master',      desc: 'Legal entities, regions, currencies', icon: '🏢' },
    { name: 'Chart of Accounts',  desc: 'Account codes, types, hierarchy',     icon: '📊' },
    { name: 'General Ledger',     desc: 'The transactional spine',             icon: '📒' },
    { name: 'Revenue & Billing',  desc: 'Billed, collected, outstanding',      icon: '💰' },
    { name: 'Budget vs Actuals',  desc: 'Variance tracking per period',        icon: '📋' },
    { name: 'Cash Flow',          desc: 'Operating, investing, financing',      icon: '💵' },
  ];

  return (
    <div className="page-body">
      <div className="overview">

        {/* ── HERO ─────────────────────────────────────────────── */}
        <div className="overview-hero">
          <div className="overview-hero-badge">The Unified Financial AI Platform</div>
          <h1 className="overview-hero-title">
            Upload. See. Ask.<br />
            <span className="overview-hero-accent">All your finance data, understood.</span>
          </h1>
          <p className="overview-hero-subtitle">
            Finance teams spend hours hunting the right file, cleaning it, and rebuilding charts
            before a routine question gets answered. FinAgent collapses that into under a minute —
            upload any financial file, watch a live dashboard build itself, and ask questions in
            plain English. Every answer is traceable back to a source row.
          </p>
          <div className="overview-hero-actions">
            {!apiKey ? (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => navigate('/dashboard')}>
                  <BarChart3 size={16} /> Explore the Dashboard
                </button>
                <button className="btn btn-lg" onClick={() => navigate('/chat')}>
                  <MessageSquare size={16} /> Try Demo Chat
                </button>
                <button className="btn btn-lg" onClick={() => navigate('/settings')}>
                  <Settings size={16} /> Add API Key
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => navigate('/chat')}>
                  <MessageSquare size={16} /> Start Chatting
                </button>
                <button className="btn btn-lg" onClick={() => navigate('/dashboard')}>
                  <BarChart3 size={16} /> View Dashboard
                </button>
                <button className="btn btn-lg" onClick={() => navigate('/workspace')}>
                  <Upload size={16} /> Upload Data
                </button>
              </>
            )}
          </div>
          {!apiKey && (
            <div className="overview-demo-hint">
              No API key needed to explore — 6 pre-recorded demo conversations,{' '}
              {live ? `${live.insights_total} ` : ' '}insight cards, and a live dashboard are already seeded with sample data.
            </div>
          )}
          <div className="overview-stats">
            <div className="overview-stat">
              <span className="overview-stat-number">{animated.tables}</span>
              <span className="overview-stat-label">Canonical Tables</span>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-number">{animated.agents}</span>
              <span className="overview-stat-label">AI &amp; Code Agents</span>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-number">{animated.rules}</span>
              <span className="overview-stat-label">Insight Rules</span>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-number">{animated.charts}</span>
              <span className="overview-stat-label">Dashboard Charts</span>
            </div>
          </div>
        </div>

        {/* ── LIVE SNAPSHOT ─────────────────────────────────────── */}
        {live && <LiveSnapshot live={live} onNav={navigate} />}

        {/* ── KEY FEATURES & CAPABILITIES ───────────────────────── */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2>Key Features &amp; Capabilities</h2>
            <p>
              11 agents working across data ingestion, intelligence, and conversation. Each capability is tagged:&nbsp;
              <span className="scope-tag scope-tag-in">✅ In Scope</span>
              &nbsp;= directly answered the original brief &nbsp;·&nbsp;
              <span className="scope-tag scope-tag-enhance">⚡ Enhancement</span>
              &nbsp;= built beyond it.
            </p>
          </div>

          <div className="features-grid">
            {featurePillars.map((pillar, i) => (
              <PillarBlock key={i} pillar={pillar} />
            ))}
          </div>

          <div className="enhancement-strip">
            <div className="enhancement-strip-label">
              <span className="scope-tag scope-tag-enhance">⚡ Enhancement</span>
              &nbsp;Highlights
            </div>
            <div className="enhancement-chips">
              {enhancementHighlights.map((e, i) => (
                <div key={i} className="enhancement-chip">
                  <span className="enhancement-chip-icon">{e.icon}</span>
                  {e.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 6-AGENT PIPELINE ──────────────────────────────────── */}
        <div className="overview-section overview-section-dark">
          <div className="overview-section-header">
            <h2><Bot size={22} style={{ verticalAlign: -4, marginRight: 8 }} />The 6-Agent Ingestion Pipeline</h2>
            <p>Click any agent to see what it does. Clean files complete in 30–60 seconds. The whole thing is pausable — you stay in control at every step.</p>
          </div>
          <div className="overview-pipeline">
            {agents.map((a, i) => (
              <React.Fragment key={i}>
                <div
                  className={`overview-agent-card ${activeAgent === i ? 'active' : ''}`}
                  onClick={() => setActiveAgent(activeAgent === i ? null : i)}
                  style={{ '--agent-color': a.color }}
                >
                  <div className="overview-agent-icon" style={{ background: a.color }}>{a.icon}</div>
                  <div className="overview-agent-stage">Stage {a.stage}</div>
                  <div className="overview-agent-name">{a.name}</div>
                  <div className="overview-agent-time">{a.time}</div>
                  {activeAgent === i && (
                    <div className="overview-agent-detail">
                      <p>{a.description}</p>
                      <div className="overview-agent-output"><ArrowRight size={12} /> <strong>Output:</strong> {a.output}</div>
                    </div>
                  )}
                </div>
                {i < agents.length - 1 && <div className="overview-pipeline-arrow"><ChevronRight size={16} /></div>}
              </React.Fragment>
            ))}
          </div>
          <div className="overview-pipeline-note">
            <Zap size={14} /> Every successful upload also triggers the insight engine — so your dashboard is never stale.
          </div>
        </div>

        {/* ── HOW TO USE ────────────────────────────────────────── */}
        <HowToUse navigate={navigate} />

        {/* ── CANONICAL TABLES ──────────────────────────────────── */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2><Database size={22} style={{ verticalAlign: -4, marginRight: 8 }} />6 Canonical Tables</h2>
            <p>All your financial data maps into these six standardised tables. Pre-loaded with realistic sample data — 24 months across 4 entities — so you can explore immediately.</p>
          </div>
          <div className="overview-tables-grid">
            {tables.map((t, i) => (
              <div key={i} className="overview-table-card" onClick={() => navigate('/workspace')}>
                <span className="overview-table-icon">{t.icon}</span>
                <div>
                  <div className="overview-table-name">{t.name}</div>
                  <div className="overview-table-desc">{t.desc}</div>
                </div>
                <ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--c-text-muted)' }} />
              </div>
            ))}
          </div>
        </div>

        {/* ── CHAT BRAIN ────────────────────────────────────────── */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2><MessageSquare size={22} style={{ verticalAlign: -4, marginRight: 8 }} />How the Chat Brain Works</h2>
            <p>A three-tier architecture keeps answers accurate, fast, and transparent — with every step fully visible.</p>
          </div>
          <div className="overview-chat-flow">
            <div className="overview-flow-step">
              <div className="overview-flow-num">1</div>
              <div>
                <h4>Router <span className="scope-tag scope-tag-in" style={{ fontSize: 10, verticalAlign: 2 }}>✅ In Scope</span></h4>
                <p>A fast AI call classifies your question — data lookup, comparison, computation, trend, meta, or unsupported — and picks the right worker.</p>
              </div>
            </div>
            <div className="overview-flow-connector" />
            <div className="overview-flow-step">
              <div className="overview-flow-num">2</div>
              <div>
                <h4>Worker Agent <span className="scope-tag scope-tag-in" style={{ fontSize: 10, verticalAlign: 2 }}>✅ In Scope</span></h4>
                <p>Runs a tool loop with 6 whitelisted tools: query_table, join_query, calculate, get_metadata, lookup_canonical_values, describe_schema. All math happens in code, never in the model's head.</p>
              </div>
            </div>
            <div className="overview-flow-connector" />
            <div className="overview-flow-step">
              <div className="overview-flow-num">3</div>
              <div>
                <h4>Synthesizer <span className="scope-tag scope-tag-in" style={{ fontSize: 10, verticalAlign: 2 }}>✅ In Scope</span></h4>
                <p>Turns raw findings into a clean answer with tables, context, and 3 smart follow-up suggestions. Every answer includes a 5-factor confidence score.</p>
              </div>
            </div>
          </div>
          <div className="overview-confidence-preview">
            <h4>5-Factor Confidence Scoring</h4>
            <div className="overview-confidence-factors">
              {[
                { name: 'Data Completeness', weight: '30%', desc: 'Are all required fields present?' },
                { name: 'Data Freshness',    weight: '20%', desc: 'How recent is the underlying data?' },
                { name: 'Assumptions',       weight: '20%', desc: 'Did the AI make assumptions?' },
                { name: 'Cross-Validation',  weight: '15%', desc: 'Do multiple sources agree?' },
                { name: 'Benchmark Deviation',weight: '15%',desc: 'Are values within expected ranges?' },
              ].map((f, i) => (
                <div key={i} className="overview-confidence-factor">
                  <div className="overview-cf-header"><span>{f.name}</span><span className="overview-cf-weight">{f.weight}</span></div>
                  <div className="overview-cf-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── PROVIDERS ─────────────────────────────────────────── */}
        <div className="overview-section overview-section-dark">
          <div className="overview-section-header">
            <h2>Bring Your Own AI Provider <span className="scope-tag scope-tag-enhance" style={{ fontSize: 11, verticalAlign: 2 }}>⚡ Enhancement</span></h2>
            <p>Your API key stays in your browser — never stored on the server. Switch providers anytime in Settings.</p>
          </div>
          <div className="overview-providers">
            {[
              { name: 'Anthropic', model: 'Claude Haiku 4.5 + Sonnet 4.6', color: '#d4a574' },
              { name: 'OpenAI',    model: 'GPT-4o-mini + GPT-4o',          color: '#10a37f' },
              { name: 'Google',    model: 'Gemini 2.0 Flash',              color: '#4285f4' },
              { name: 'DeepSeek', model: 'DeepSeek Chat',                  color: '#5b6ee1' },
            ].map((p, i) => (
              <div key={i} className="overview-provider-card">
                <div className="overview-provider-dot" style={{ background: p.color }} />
                <div className="overview-provider-name">{p.name}</div>
                <div className="overview-provider-model">{p.model}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────── */}
        <div className="overview-section overview-cta">
          <h2>Ready to explore?</h2>
          <p>The app is pre-loaded with 24 months of sample data across 4 entities, 14 demo insight cards, and 6 pre-recorded demo chats. Start exploring immediately, then upload your own files.</p>
          <div className="overview-hero-actions" style={{ justifyContent: 'center' }}>
            {!apiKey ? (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => navigate('/dashboard')}><BarChart3 size={16} /> See the Dashboard</button>
                <button className="btn btn-lg" onClick={() => navigate('/chat')}><MessageSquare size={16} /> Open Demo Chat</button>
                <button className="btn btn-lg" onClick={() => navigate('/settings')}><Settings size={16} /> Add API Key</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => navigate('/chat')}><MessageSquare size={16} /> Chat with Your Data</button>
                <button className="btn btn-lg" onClick={() => navigate('/dashboard')}><BarChart3 size={16} /> View Dashboard</button>
                <button className="btn btn-lg" onClick={() => navigate('/workspace')}><Database size={16} /> Browse Data</button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── PillarBlock ─────────────────────────────────────────────────
function PillarBlock({ pillar }) {
  return (
    <div className="features-pillar" style={{ '--pillar-color': pillar.color }}>
      <div className="features-pillar-header">
        <div className="features-pillar-icon" style={{ background: pillar.color }}>{pillar.icon}</div>
        <div>
          <div className="features-pillar-subtitle">{pillar.subtitle}</div>
          <h3 className="features-pillar-title">{pillar.title}</h3>
        </div>
      </div>
      <p className="features-pillar-desc">{pillar.description}</p>

      {pillar.agents.length > 0 && (
        <div className="features-subsection">
          <div className="features-subsection-label">Agents</div>
          <div className="features-agents-list">
            {pillar.agents.map((agent, i) => (
              <div key={i} className="features-agent-row">
                <div className={`features-agent-icon feat-scope-${agent.scope}`}>{agent.icon}</div>
                <div className="features-agent-info">
                  <div className="features-agent-name">{agent.name}</div>
                  <div className="features-agent-desc">{agent.desc}</div>
                </div>
                <div className="features-agent-badges">
                  <span className={`agent-type-badge agent-type-${agent.type}`}>
                    {agent.type === 'ai' ? 'AI Agent' : 'Code'}
                  </span>
                  <span className={`scope-tag scope-tag-${agent.scope}`}>
                    {agent.scope === 'in' ? '✅ In Scope' : '⚡ Enhancement'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="features-subsection">
        <div className="features-subsection-label">Capabilities</div>
        <ul className="features-cap-list">
          {pillar.capabilities.map((cap, i) => (
            <li key={i} className="features-cap-item">
              <span className={`cap-scope-dot cap-scope-${cap.scope}`}>
                {cap.scope === 'in' ? '✅' : '⚡'}
              </span>
              <span>{cap.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── HowToUse ────────────────────────────────────────────────────
function HowToUse({ navigate }) {
  const steps = [
    {
      num: 1,
      icon: <Settings size={18} />,
      title: 'Set Up',
      pageLabel: 'Settings',
      pagePath: '/settings',
      action: 'Paste your API key — Anthropic, OpenAI, Google, or DeepSeek.',
      outcome: 'AI features unlock. Or skip this entirely — demo mode works without a key.',
      color: '#3b82f6',
    },
    {
      num: 2,
      icon: <BarChart3 size={18} />,
      title: 'Explore the Dashboard',
      pageLabel: 'Dashboard',
      pagePath: '/dashboard',
      action: 'Open the live dashboard.',
      outcome: '6 KPI tiles + 9 financial charts + AI insight cards, all built from seeded data.',
      color: '#f59e0b',
    },
    {
      num: 3,
      icon: <MessageSquare size={18} />,
      title: 'Ask a Question',
      pageLabel: 'Chat',
      pagePath: '/chat',
      action: 'Type any financial question in plain English.',
      outcome: 'Router classifies → Worker runs tool calls → Synthesizer writes an answer with confidence score, source chips, and Show Work.',
      color: '#8b5cf6',
    },
    {
      num: 4,
      icon: <Upload size={18} />,
      title: 'Upload Your Data',
      pageLabel: 'Workspace',
      pagePath: '/workspace',
      action: 'Drop your own Excel, CSV, or PDF file.',
      outcome: 'Parse → classify → map (you review) → validate → reconcile (you decide) → load. Dashboard auto-refreshes.',
      color: '#10b981',
    },
    {
      num: 5,
      icon: <Sparkles size={18} />,
      title: 'Act on Insights',
      pageLabel: 'Dashboard + Chat',
      pagePath: '/dashboard',
      action: 'Return to chat and ask about your uploaded data.',
      outcome: 'Every number traces back to a source row in your file. Click any source chip to jump to it.',
      color: '#ec4899',
    },
  ];

  return (
    <div className="overview-section overview-section-dark">
      <div className="overview-section-header">
        <h2>How to Use FinAgent</h2>
        <p>Five steps from zero to answers. Each step unlocks the next.</p>
      </div>
      <div className="howto-steps">
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            <div className="howto-step" style={{ '--step-color': step.color }}
              onClick={() => navigate(step.pagePath)}>
              <div className="howto-step-num" style={{ background: step.color }}>{step.num}</div>
              <div className="howto-step-icon" style={{ color: step.color }}>{step.icon}</div>
              <div className="howto-step-title">{step.title}</div>
              <div className="howto-step-page" style={{ color: step.color }}>{step.pageLabel}</div>
              <div className="howto-step-action">{step.action}</div>
              <div className="howto-step-outcome">{step.outcome}</div>
            </div>
            {i < steps.length - 1 && (
              <div className="howto-connector"><ChevronRight size={14} /></div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Live snapshot strip ─────────────────────────────────────────
function LiveSnapshot({ live, onNav }) {
  const fmt = (n) => {
    if (n == null) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toLocaleString();
  };
  const moneyKpi = live.kpis.find(k => k.key === 'revenue_ytd');
  const cashKpi  = live.kpis.find(k => k.key === 'net_cash');
  const attKpi   = live.kpis.find(k => k.key === 'budget_attainment');
  return (
    <div className="overview-live-strip">
      <div className="overview-live-head">
        <span className="overview-live-dot" />
        <span className="overview-live-label">LIVE — pulled from your backend</span>
        <button className="btn btn-sm" onClick={() => onNav('/dashboard')}>
          Open full dashboard <ChevronRight size={11} />
        </button>
      </div>
      <div className="overview-live-grid">
        <LiveTile icon={<Database size={14} />} label="Rows loaded" value={fmt(live.total_rows)}
          sub={`${live.user_rows} user · ${live.total_rows - live.user_rows} seeded`} color="#3b82f6" />
        {moneyKpi && <LiveTile icon={<DollarSign size={14} />} label={moneyKpi.label} value={`$${fmt(moneyKpi.value)}`}
          trend={moneyKpi.trend} color="#10b981" delta={moneyKpi.delta} />}
        {cashKpi && <LiveTile icon={<Wallet size={14} />} label={cashKpi.label} value={`$${fmt(cashKpi.value)}`}
          trend={cashKpi.trend} color="#f59e0b" delta={cashKpi.delta} />}
        {attKpi && <LiveTile icon={<Target size={14} />} label="Budget Attainment" value={`${attKpi.value?.toFixed?.(0)}%`}
          trend={attKpi.trend} color="#8b5cf6" delta={attKpi.delta} />}
        <LiveTile icon={<AlertTriangle size={14} />} label="AI Insight Cards" value={live.insights_total}
          sub={`${live.insights_alerts} need attention`} color="#dc2626" />
      </div>
    </div>
  );
}

function LiveTile({ icon, label, value, sub, trend, color, delta }) {
  return (
    <div className="overview-live-tile">
      <div className="overview-live-tile-top" style={{ color }}>{icon} <span>{label}</span></div>
      <div className="overview-live-tile-value">{value}</div>
      <div className="overview-live-tile-bottom">
        {delta != null && (
          <span style={{ color: delta > 0 ? '#16a34a' : '#dc2626', fontSize: 11, fontWeight: 600 }}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
        {sub && <span style={{ fontSize: 10, color: 'var(--c-text-muted)' }}>{sub}</span>}
        {trend?.length > 1 && (
          <div style={{ flex: 1, minWidth: 60 }}>
            <ResponsiveContainer width="100%" height={22}>
              <AreaChart data={trend} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
                  fill={color} fillOpacity={0.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

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

export default function OverviewPage() {
  const navigate = useNavigate();
  const { apiKey } = getLlmConfig();
  const [activePillar, setActivePillar] = useState(0);
  const [activeAgent, setActiveAgent] = useState(null);
  const [live, setLive] = useState(null); // live counts pulled from backend
  const [animated, setAnimated] = useState({ tables: 0, agents: 0, rules: 0, charts: 0 });

  // Fetch real counts so the hero isn't lying
  useEffect(() => {
    Promise.all([
      api.get('/tables/').catch(() => ({ data: [] })),
      api.get('/dashboard/insights').catch(() => ({ data: [] })),
      api.get('/dashboard/kpis').catch(() => ({ data: { kpis: [] } })),
      api.get('/dashboard/curated').catch(() => ({ data: {} })),
    ]).then(([tablesR, insightsR, kpisR, curR]) => {
      const totalRows = tablesR.data.reduce((a, t) => a + (t.row_count || 0), 0);
      const userRows = tablesR.data.reduce((a, t) => a + (t.user_count || 0), 0);
      setLive({
        total_rows: totalRows, user_rows: userRows,
        table_count: tablesR.data.length,
        insights_total: insightsR.data.length,
        insights_alerts: insightsR.data.filter(i => i.severity === 'warning' || i.severity === 'error').length,
        kpis: kpisR.data.kpis || [],
        entity_concentration: curR.data.entity_concentration || [],
        revenue_trend: curR.data.revenue_trend || [],
        cash_position: curR.data.cash_position || [],
      });
    });
  }, []);

  // Animate hero counters
  useEffect(() => {
    const targets = { tables: 6, agents: 6, rules: 11, charts: 9 };
    const duration = 1100;
    const steps = 30;
    let step = 0;
    const t = setInterval(() => {
      step++;
      const progress = Math.min(step / steps, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setAnimated({
        tables: Math.round(targets.tables * ease),
        agents: Math.round(targets.agents * ease),
        rules: Math.round(targets.rules * ease),
        charts: Math.round(targets.charts * ease),
      });
      if (step >= steps) clearInterval(t);
    }, duration / steps);
    return () => clearInterval(t);
  }, []);

  // ---------- pillar + agent content ----------
  const pillars = [
    {
      icon: <Brain size={28} />,
      title: 'Data Ingestion',
      subtitle: 'Pillar 1',
      color: '#3b82f6',
      description: 'A 6-agent pipeline that takes any financial file — messy GL exports, budget spreadsheets, billing reports — and turns them into clean, structured data. No config screens, no IT.',
      features: [
        'Multi-format: Excel, CSV, PDF, JSON',
        'Auto-detects sheet types and maps columns to the canonical schema',
        '2-layer validation (mechanical + AI semantic checks)',
        'Reconciles conflicts with existing data',
        'Mapping memory: second upload with same headers skips the LLM entirely',
      ],
      preview: <IngestionPreview />,
    },
    {
      icon: <Database size={28} />,
      title: 'Data Workspace',
      subtitle: 'Pillar 2',
      color: '#10b981',
      description: 'A spreadsheet-grade table editor where you can see, edit, and manage everything in your canonical tables. The trust layer — you need to see your data to trust the answers.',
      features: [
        '6 canonical financial tables, 3,900+ rows of seeded data',
        'Inline editing with undo/redo + 50-step history',
        'Find & replace, column resize, keyboard navigation',
        'Bulk paste from Excel (multi-row, multi-column)',
        'Per-row data-quality indicators + details panel',
      ],
      preview: <WorkspacePreview />,
    },
    {
      icon: <BarChart3 size={28} />,
      title: 'Intelligence Layer',
      subtitle: 'Pillar 3',
      color: '#f59e0b',
      description: 'An insight-generator agent continuously scans your canonical data with 11 rules, narrates what matters, and pushes it to a live dashboard. Auto-regenerates on every upload.',
      features: [
        '6 hero KPI tiles + 9 curated financial charts',
        '11-rule insight engine (variance, YoY, margin, DSO, concentration, outliers, …)',
        'Every insight carries trend-data sparkline + row-level sources + confidence',
        'Dedup + $-impact ranking — top 12 insights, not a wall of noise',
        'Auto-regenerates on every successful upload',
      ],
      preview: <IntelligencePreview live={live} />,
    },
    {
      icon: <MessageSquare size={28} />,
      title: 'Conversational Brain',
      subtitle: 'Pillar 4',
      color: '#8b5cf6',
      description: 'A two-tier chat agent that answers questions, performs computations, and shows its work. Every answer comes with a confidence score, source provenance, and a full audit trail.',
      features: [
        'Natural-language queries over your canonical data',
        '5-factor confidence scoring on every answer',
        '"Show work" panel with router decision + tool calls + latency',
        'Clickable source chips linking back to the underlying tables',
        'Smart follow-up suggestions per answer',
      ],
      preview: <ChatPreview />,
    },
  ];

  const agents = [
    { icon: <FileSearch size={20} />, name: 'File Parser', stage: 1, time: '1-3s', color: '#3b82f6',
      description: 'Reads Excel, CSV, PDF, or JSON. Detects sheets, headers, merged cells, finds the actual data tables within each sheet.',
      output: 'Raw DataFrames with metadata per sheet' },
    { icon: <Layers size={20} />, name: 'Sheet Classifier', stage: 2, time: '5-10s', color: '#6366f1',
      description: 'Looks at each parsed sheet and determines what kind of financial data it contains — GL, budget, revenue, or ignore.',
      output: 'Classification per sheet' },
    { icon: <Target size={20} />, name: 'Schema Mapper', stage: 3, time: '10-20s', color: '#8b5cf6',
      description: 'Maps every source column to the correct canonical field. Proposes unit conversions, date format changes, PK synthesis. Reuses prior mappings automatically.',
      output: 'Column mappings with transformations' },
    { icon: <Shield size={20} />, name: 'Data Validator', stage: 4, time: '5-15s', color: '#ec4899',
      description: 'Two-layer validation: mechanical checks (types, FKs, required fields, duplicates) then semantic checks (outliers, sign anomalies, period gaps).',
      output: 'Validation report with errors + warnings' },
    { icon: <GitMerge size={20} />, name: 'Reconciler', stage: 5, time: '5-10s', color: '#f59e0b',
      description: 'Compares validated data against what already exists. Auto-dedupes exact matches; surfaces value conflicts for your decision.',
      output: 'Conflict report with resolution options' },
    { icon: <CheckCircle size={20} />, name: 'Loader', stage: 6, time: '1-2s', color: '#10b981',
      description: 'Writes everything in a single transaction — all or nothing. Stamps provenance, creates audit entries, saves mapping memory, triggers insight regen.',
      output: 'Rows loaded + insights refreshed' },
  ];

  const tables = [
    { name: 'Entity Master', desc: 'Legal entities, regions, currencies', icon: '🏢' },
    { name: 'Chart of Accounts', desc: 'Account codes, types, hierarchy', icon: '📊' },
    { name: 'General Ledger', desc: 'The transactional spine', icon: '📒' },
    { name: 'Revenue & Billing', desc: 'Billed, collected, outstanding', icon: '💰' },
    { name: 'Budget vs Actuals', desc: 'Variance tracking per period', icon: '📋' },
    { name: 'Cash Flow', desc: 'Operating, investing, financing', icon: '💵' },
  ];

  return (
    <div className="page-body">
      <div className="overview">
        {/* ---------- HERO ---------- */}
        <div className="overview-hero">
          <div className="overview-hero-badge">The Unified Financial AI Platform</div>
          <h1 className="overview-hero-title">
            Upload. See. Ask.<br />
            <span className="overview-hero-accent">All your finance data, understood.</span>
          </h1>
          <p className="overview-hero-subtitle">
            One place to load any financial file, browse every row, watch a live dashboard build itself,
            and ask plain-English questions — each answer backed by source data and a confidence score.
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
              No API key needed to explore — 6 pre-recorded demo conversations,
              {live ? ` ${live.insights_total} `: ' '}
              insight cards, and a live dashboard are already seeded with sample data.
            </div>
          )}

          {/* Animated hero stats */}
          <div className="overview-stats">
            <div className="overview-stat"><span className="overview-stat-number">{animated.tables}</span><span className="overview-stat-label">Canonical Tables</span></div>
            <div className="overview-stat"><span className="overview-stat-number">{animated.agents}</span><span className="overview-stat-label">Ingestion Agents</span></div>
            <div className="overview-stat"><span className="overview-stat-number">{animated.rules}</span><span className="overview-stat-label">Insight Rules</span></div>
            <div className="overview-stat"><span className="overview-stat-number">{animated.charts}</span><span className="overview-stat-label">Dashboard Charts</span></div>
          </div>
        </div>

        {/* ---------- LIVE DATA SNAPSHOT ---------- */}
        {live && <LiveSnapshot live={live} onNav={navigate} />}

        {/* ---------- FOUR PILLARS ---------- */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2>Built on Four Pillars</h2>
            <p>Each pillar is independently useful — together they give you the full loop: load data, see it, make sense of it, ask about it.</p>
          </div>
          <div className="overview-pillars overview-pillars-4">
            {pillars.map((p, i) => (
              <div
                key={i}
                className={`overview-pillar-card ${activePillar === i ? 'active' : ''}`}
                onClick={() => setActivePillar(i)}
                style={{ '--pillar-color': p.color }}
              >
                <div className="overview-pillar-icon" style={{ background: p.color }}>{p.icon}</div>
                <div className="overview-pillar-subtitle">{p.subtitle}</div>
                <h3>{p.title}</h3>
                <p>{p.description}</p>
                {activePillar === i ? (
                  <>
                    <ul className="overview-pillar-features">
                      {p.features.map((f, j) => (
                        <li key={j}><CheckCircle size={13} style={{ color: p.color, flexShrink: 0 }} /> {f}</li>
                      ))}
                    </ul>
                    <div className="overview-pillar-preview">{p.preview}</div>
                  </>
                ) : (
                  <div className="overview-pillar-expand">Click to explore <ChevronRight size={12} /></div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ---------- 6-AGENT PIPELINE ---------- */}
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

        {/* ---------- CANONICAL TABLES ---------- */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2><Database size={22} style={{ verticalAlign: -4, marginRight: 8 }} />6 Canonical Tables</h2>
            <p>All your financial data maps into these six standardized tables. Pre-loaded with realistic sample data — 24 months across 4 entities — so you can explore immediately.</p>
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

        {/* ---------- INSIGHT ENGINE DEEP DIVE ---------- */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2><Sparkles size={22} style={{ verticalAlign: -4, marginRight: 8 }} />The 11-Rule Insight Engine</h2>
            <p>Every rule scans the canonical data for a specific signal, then the narrator agent ranks them by $-impact and writes the insight cards.</p>
          </div>
          <InsightRulesGrid />
        </div>

        {/* ---------- CHAT BRAIN ---------- */}
        <div className="overview-section">
          <div className="overview-section-header">
            <h2><MessageSquare size={22} style={{ verticalAlign: -4, marginRight: 8 }} />How the Chat Brain Works</h2>
            <p>A two-tier architecture keeps answers accurate, fast, and transparent.</p>
          </div>
          <div className="overview-chat-flow">
            <div className="overview-flow-step">
              <div className="overview-flow-num">1</div>
              <div><h4>Router (Tier 1)</h4><p>A fast AI call classifies your question — data lookup, comparison, computation, trend, meta, or unsupported — and picks the right worker.</p></div>
            </div>
            <div className="overview-flow-connector" />
            <div className="overview-flow-step">
              <div className="overview-flow-num">2</div>
              <div><h4>Worker Agent (Tier 2)</h4><p>Runs a tool loop with 6 whitelisted tools: query_table, join_query, calculate, get_metadata, lookup_canonical_values, describe_schema. All math happens in code, never in the model's head.</p></div>
            </div>
            <div className="overview-flow-connector" />
            <div className="overview-flow-step">
              <div className="overview-flow-num">3</div>
              <div><h4>Synthesizer (Tier 1)</h4><p>Turns raw findings into a clean answer with tables, context, and 3 smart follow-up suggestions. Every answer includes a 5-factor confidence score.</p></div>
            </div>
          </div>
          <div className="overview-confidence-preview">
            <h4>5-Factor Confidence Scoring</h4>
            <div className="overview-confidence-factors">
              {[
                { name: 'Data Completeness', weight: '30%', desc: 'Are all required fields present?' },
                { name: 'Data Freshness', weight: '20%', desc: 'How recent is the underlying data?' },
                { name: 'Assumptions', weight: '20%', desc: 'Did the AI make assumptions?' },
                { name: 'Cross-Validation', weight: '15%', desc: 'Do multiple sources agree?' },
                { name: 'Benchmark Deviation', weight: '15%', desc: 'Are values within expected ranges?' },
              ].map((f, i) => (
                <div key={i} className="overview-confidence-factor">
                  <div className="overview-cf-header"><span>{f.name}</span><span className="overview-cf-weight">{f.weight}</span></div>
                  <div className="overview-cf-desc">{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---------- PROVIDERS ---------- */}
        <div className="overview-section overview-section-dark">
          <div className="overview-section-header">
            <h2>Bring Your Own AI Provider</h2>
            <p>Your API key stays in your browser — never stored on the server. Switch providers anytime in Settings.</p>
          </div>
          <div className="overview-providers">
            {[
              { name: 'Anthropic', model: 'Claude Haiku 4.5 + Sonnet 4.6', color: '#d4a574' },
              { name: 'OpenAI', model: 'GPT-4o-mini + GPT-4o', color: '#10a37f' },
              { name: 'Google', model: 'Gemini 2.0 Flash', color: '#4285f4' },
              { name: 'DeepSeek', model: 'DeepSeek Chat', color: '#5b6ee1' },
            ].map((p, i) => (
              <div key={i} className="overview-provider-card">
                <div className="overview-provider-dot" style={{ background: p.color }} />
                <div className="overview-provider-name">{p.name}</div>
                <div className="overview-provider-model">{p.model}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- CTA ---------- */}
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

// ============================================================
// Live snapshot strip — pulled from the running backend
// ============================================================
function LiveSnapshot({ live, onNav }) {
  const fmt = (n) => {
    if (n == null) return '—';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return n.toLocaleString();
  };
  const moneyKpi = live.kpis.find(k => k.key === 'revenue_ytd');
  const cashKpi = live.kpis.find(k => k.key === 'net_cash');
  const attKpi = live.kpis.find(k => k.key === 'budget_attainment');
  return (
    <div className="overview-live-strip">
      <div className="overview-live-head">
        <span className="overview-live-dot" />
        <span className="overview-live-label">LIVE — pulled from your backend</span>
        <button className="btn btn-sm" onClick={() => onNav('/dashboard')}>Open full dashboard <ChevronRight size={11} /></button>
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
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Pillar preview mini-viz
// ============================================================
function IngestionPreview() {
  return (
    <div className="pillar-preview-box">
      <div className="pillar-preview-label">Mapping memory in action</div>
      <div className="pillar-preview-flow">
        <div className="pillar-flow-item"><Upload size={12} /> Upload 1</div>
        <ArrowRight size={11} />
        <div className="pillar-flow-item active">LLM mapper (18s)</div>
        <ArrowRight size={11} />
        <div className="pillar-flow-item success"><CheckCircle size={11} /> Loaded</div>
      </div>
      <div className="pillar-preview-flow">
        <div className="pillar-flow-item"><Upload size={12} /> Upload 2 (same shape)</div>
        <ArrowRight size={11} />
        <div className="pillar-flow-item success"><Repeat size={11} /> Reused (0s, 0 tokens)</div>
        <ArrowRight size={11} />
        <div className="pillar-flow-item success"><CheckCircle size={11} /> Loaded</div>
      </div>
    </div>
  );
}

function WorkspacePreview() {
  return (
    <div className="pillar-preview-box">
      <div className="pillar-preview-label">Keyboard shortcuts</div>
      <div className="pillar-shortcut-list">
        <div><kbd>Ctrl+Z</kbd> Undo</div>
        <div><kbd>Ctrl+Y</kbd> Redo</div>
        <div><kbd>Ctrl+F</kbd> Find / Replace</div>
        <div><kbd>Ctrl+V</kbd> Bulk paste</div>
        <div><kbd>↑ ↓ ← →</kbd> Navigate cells</div>
        <div><kbd>Enter</kbd> Edit / commit</div>
      </div>
    </div>
  );
}

function IntelligencePreview({ live }) {
  const trend = live?.revenue_trend || [];
  // Build a simple series: total by period
  const byPeriod = {};
  for (const r of trend) byPeriod[r.period] = (byPeriod[r.period] || 0) + (r.revenue || 0);
  const series = Object.entries(byPeriod).sort().slice(-12).map(([period, value]) => ({ period, value }));
  const conc = live?.entity_concentration || [];
  const COLORS = ['#1e3a5f', '#3b82f6', '#10b981', '#f59e0b'];
  return (
    <div className="pillar-preview-box">
      <div className="pillar-preview-label">Revenue trend · Entity mix (live data)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
        <div style={{ height: 80 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={1.5} fill="#f59e0b" fillOpacity={0.25} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ height: 80 }}>
          {conc.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={conc} dataKey="revenue" nameKey="entity_code" cx="50%" cy="50%" innerRadius={18} outerRadius={35} paddingAngle={1}>
                  {conc.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatPreview() {
  return (
    <div className="pillar-preview-box">
      <div className="pillar-preview-label">Sample answer trace</div>
      <div className="pillar-chat-trace">
        <div className="pillar-chat-q">"What was Q4 2024 revenue by entity?"</div>
        <div className="pillar-chat-row"><span className="pillar-chat-tag router">ROUTER</span> classified as <strong>data_lookup</strong> · 1.7s</div>
        <div className="pillar-chat-row"><span className="pillar-chat-tag worker">WORKER</span> get_metadata → query_table · 3 tool calls · 4.2s</div>
        <div className="pillar-chat-row"><span className="pillar-chat-tag synth">SYNTH</span> answer written · confidence 96% (green)</div>
      </div>
    </div>
  );
}

// ============================================================
// Insight Rules Grid
// ============================================================
function InsightRulesGrid() {
  const rules = [
    { icon: <BarChart3 size={16} />, name: 'Top Variances', desc: 'Accounts missing budget by more than the table-wide 75th-percentile.', color: '#dc2626' },
    { icon: <Target size={16} />, name: 'Budget Attainment', desc: 'Per-entity % of plan, trailing 3 months.', color: '#8b5cf6' },
    { icon: <TrendingUp size={16} />, name: 'Revenue Trend', desc: 'Recent 3 months vs prior 3 months per entity.', color: '#10b981' },
    { icon: <Repeat size={16} />, name: 'Year-over-Year', desc: 'Same-month comparison vs prior year, per entity.', color: '#3b82f6' },
    { icon: <Percent size={16} />, name: 'Margin Compression', desc: 'Net margin delta (pp) vs the prior 3-month window.', color: '#f59e0b' },
    { icon: <PieIcon size={16} />, name: 'Concentration Risk', desc: 'Flags when one entity or BU dominates revenue.', color: '#ef4444' },
    { icon: <Activity size={16} />, name: 'AR Aging', desc: 'Current / 30 / 60 / 90+ day outstanding buckets.', color: '#6366f1' },
    { icon: <Wallet size={16} />, name: 'DSO', desc: 'Days Sales Outstanding per active entity.', color: '#0891b2' },
    { icon: <DollarSign size={16} />, name: 'Cash Flow Direction', desc: 'Operating cash trend + category mix.', color: '#059669' },
    { icon: <AlertTriangle size={16} />, name: 'GL Outliers', desc: 'Journal entries 3–5× larger than the entity median.', color: '#d97706' },
    { icon: <Shield size={16} />, name: 'Data Quality', desc: 'Empty tables + period-gap detection.', color: '#7c3aed' },
  ];
  return (
    <div className="overview-rules-grid">
      {rules.map((r, i) => (
        <div key={i} className="overview-rule-card" style={{ '--rule-color': r.color }}>
          <div className="overview-rule-icon" style={{ background: r.color }}>{r.icon}</div>
          <div>
            <div className="overview-rule-name">{r.name}</div>
            <div className="overview-rule-desc">{r.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

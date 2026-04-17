import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  Sparkles, MessageSquare, TrendingUp, TrendingDown, BarChart3, DollarSign, Clock,
  AlertTriangle, CheckCircle, Info, ChevronDown, ChevronRight, ArrowRight,
  Filter, RefreshCw, Percent, Wallet, Target, PieChart as PieIcon, Activity,
} from 'lucide-react';
import { api } from '../api';

// ---------- formatters ----------
const fmtMoney = (n) => {
  if (n == null || isNaN(n)) return '—';
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const fmtPct = (n) => (n == null || isNaN(n)) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtAxis = (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`;

const SEVERITY_COLORS = { error: '#dc2626', warning: '#d97706', success: '#16a34a', info: '#3b82f6' };
const ENTITY_COLORS = ['#1e3a5f', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const CASH_CAT_COLORS = { operating: '#10b981', investing: '#3b82f6', financing: '#f59e0b' };

// ---------- top-level ----------
export default function DashboardPage() {
  const [tab, setTab] = useState('curated');
  const [filters, setFilters] = useState({ entity: '', period_from: '', period_to: '' });
  const navigate = useNavigate();
  const drillToChat = (q) => navigate(`/chat?q=${encodeURIComponent(q)}`);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">Auto-generated views of your loaded financial data.</div>
        </div>
      </div>
      <div className="page-body">
        <div className="dashboard">
          <div className="dashboard-tabs">
            <div className={'dashboard-tab' + (tab === 'curated' ? ' active' : '')} onClick={() => setTab('curated')}>
              <BarChart3 size={12} style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />
              Curated
            </div>
            <div className={'dashboard-tab' + (tab === 'ai' ? ' active' : '')} onClick={() => setTab('ai')}>
              <Sparkles size={12} style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />
              AI-Generated
            </div>
          </div>
          {tab === 'curated' && <CuratedDashboard filters={filters} setFilters={setFilters} onDrill={drillToChat} />}
          {tab === 'ai' && <AIInsightsPanel onDrill={drillToChat} />}
        </div>
      </div>
    </>
  );
}

// ============================================================
// Curated dashboard
// ============================================================
function CuratedDashboard({ filters, setFilters, onDrill }) {
  const [kpis, setKpis] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.entity) q.set('entity', filters.entity);
    if (filters.period_from) q.set('period_from', filters.period_from);
    if (filters.period_to) q.set('period_to', filters.period_to);
    const qs = q.toString() ? `?${q.toString()}` : '';
    Promise.all([
      api.get(`/dashboard/curated${qs}`),
      api.get('/dashboard/kpis'),
    ]).then(([c, k]) => { setData(c.data); setKpis(k.data.kpis); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(fetchAll, [filters.entity, filters.period_from, filters.period_to]);

  if (loading && !data) return <div className="loading-page"><span className="spinner-inline" /> &nbsp; Loading dashboard...</div>;
  if (!data) return <EmptyDashboard />;

  return (
    <div className="curated-dashboard">
      {/* KPI strip */}
      {kpis && <KpiStrip kpis={kpis} />}

      {/* Filter bar */}
      <FilterBar
        filters={filters} setFilters={setFilters} entities={data.available_entities || []}
        onRefresh={fetchAll}
      />

      {/* Chart grid */}
      <div className="dashboard-grid">
        <RevenueTrendCard data={data} onDrill={onDrill} />
        <EntityConcentrationCard data={data} onDrill={onDrill} />
        <CashByCategoryCard data={data} onDrill={onDrill} />
        <ArAgingCard data={data} onDrill={onDrill} />
        <PnlWaterfallCard data={data} onDrill={onDrill} />
        <YoYCard data={data} onDrill={onDrill} />
        <VarianceBarCard data={data} onDrill={onDrill} />
        <VarianceHeatmapCard data={data} onDrill={onDrill} />
        <DataFreshnessCard data={data} onDrill={onDrill} />
      </div>
    </div>
  );
}

// ---------- KPI strip ----------
function KpiStrip({ kpis }) {
  return (
    <div className="kpi-strip">
      {kpis.map(k => <KpiTile key={k.key} k={k} />)}
    </div>
  );
}

function KpiTile({ k }) {
  const fmt = k.format === 'money' ? fmtMoney : k.format === 'pct' ? (v) => v == null ? '—' : `${v.toFixed(1)}%` : (v) => v?.toLocaleString?.() || v;
  const positive = (k.delta ?? 0) > 0;
  const deltaColor = k.delta == null ? '#6b7280' : (positive ? '#16a34a' : '#dc2626');
  const DeltaIcon = positive ? TrendingUp : TrendingDown;
  const iconMap = { revenue_ytd: DollarSign, net_cash: Wallet, budget_attainment: Target, net_margin: Percent, ar_balance: Activity, alerts: AlertTriangle };
  const Icon = iconMap[k.key] || Sparkles;
  return (
    <div className="kpi-tile">
      <div className="kpi-tile-top">
        <div className="kpi-tile-icon"><Icon size={14} /></div>
        <div className="kpi-tile-label">{k.label}</div>
      </div>
      <div className="kpi-tile-value">{fmt(k.value)}</div>
      <div className="kpi-tile-bottom">
        {k.delta != null && (
          <span className="kpi-tile-delta" style={{ color: deltaColor }}>
            <DeltaIcon size={10} /> {fmtPct(k.delta)} <span className="kpi-tile-delta-label">{k.delta_label}</span>
          </span>
        )}
        {k.trend && k.trend.length > 1 && (
          <div className="kpi-tile-spark">
            <ResponsiveContainer width="100%" height={26}>
              <AreaChart data={k.trend} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
                <Area type="monotone" dataKey="value" stroke={deltaColor} strokeWidth={1.4} fill={deltaColor} fillOpacity={0.15} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Filter bar ----------
function FilterBar({ filters, setFilters, entities, onRefresh }) {
  return (
    <div className="filter-bar">
      <Filter size={13} style={{ color: 'var(--c-text-muted)' }} />
      <select value={filters.entity} onChange={e => setFilters(f => ({ ...f, entity: e.target.value }))}>
        <option value="">All entities</option>
        {entities.map(e => <option key={e.entity_code} value={e.entity_code}>{e.entity_code} — {e.entity_name}</option>)}
      </select>
      <input placeholder="From (YYYY-MM)" value={filters.period_from} onChange={e => setFilters(f => ({ ...f, period_from: e.target.value }))} />
      <input placeholder="To (YYYY-MM)" value={filters.period_to} onChange={e => setFilters(f => ({ ...f, period_to: e.target.value }))} />
      {(filters.entity || filters.period_from || filters.period_to) && (
        <button className="btn btn-sm" onClick={() => setFilters({ entity: '', period_from: '', period_to: '' })}>Clear</button>
      )}
      <div style={{ flex: 1 }} />
      <button className="btn btn-sm" onClick={onRefresh}><RefreshCw size={11} /> Refresh</button>
    </div>
  );
}

// ---------- individual cards ----------
function RevenueTrendCard({ data, onDrill }) {
  const periods = Array.from(new Set(data.revenue_trend.map(r => r.period))).sort();
  const entities = Array.from(new Set(data.revenue_trend.map(r => r.entity_code))).sort();
  const revData = periods.map(p => {
    const row = { period: p };
    for (const e of entities) {
      const m = data.revenue_trend.find(r => r.period === p && r.entity_code === e);
      row[e] = m ? m.revenue : 0;
    }
    return row;
  });
  return (
    <div className="dashboard-card full">
      <div className="dashboard-card-header">
        <h3><TrendingUp size={14} /> Revenue Trend by Entity</h3>
        <button className="btn btn-sm" onClick={() => onDrill('Show me the revenue trend for all entities over the last 12 months')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={revData} onClick={e => e?.activeLabel && onDrill(`What drove revenue in ${e.activeLabel}?`)} style={{ cursor: 'pointer' }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <Tooltip formatter={fmtMoney} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {entities.map((e, i) => <Line key={e} type="monotone" dataKey={e} stroke={ENTITY_COLORS[i % ENTITY_COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EntityConcentrationCard({ data, onDrill }) {
  const items = (data.entity_concentration || []).map((e, i) => ({
    name: e.entity_code, value: e.revenue, color: ENTITY_COLORS[i % ENTITY_COLORS.length],
  }));
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!items.length) return null;
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <h3><PieIcon size={14} /> Entity Concentration (trailing 3 mo)</h3>
        <button className="btn btn-sm" onClick={() => onDrill('Which entity contributes the most revenue and is there concentration risk?')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={items} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}
            label={(p) => `${p.name} ${((p.value / total) * 100).toFixed(0)}%`} labelLine={false}>
            {items.map((it, i) => <Cell key={i} fill={it.color} />)}
          </Pie>
          <Tooltip formatter={fmtMoney} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function CashByCategoryCard({ data, onDrill }) {
  if (!data.cash_by_category?.length) return null;
  const periods = Array.from(new Set(data.cash_by_category.map(r => r.period))).sort();
  const byPeriod = periods.map(p => {
    const row = { period: p };
    for (const r of data.cash_by_category) {
      if (r.period === p) row[r.category] = r.amount;
    }
    return row;
  });
  const cats = Array.from(new Set(data.cash_by_category.map(r => r.category)));
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <h3><DollarSign size={14} /> Cash Flow by Category</h3>
        <button className="btn btn-sm" onClick={() => onDrill('Break down cash flow by operating, investing, and financing activities')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={byPeriod}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <Tooltip formatter={fmtMoney} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {cats.map(c => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={CASH_CAT_COLORS[c] || '#6b7280'} fill={CASH_CAT_COLORS[c] || '#6b7280'} fillOpacity={0.5} />)}
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ArAgingCard({ data, onDrill }) {
  if (!data.ar_aging) return null;
  const b = data.ar_aging.buckets;
  const rows = [
    { bucket: 'Current', value: b.current, color: '#10b981' },
    { bucket: '30 days', value: b['30'], color: '#3b82f6' },
    { bucket: '60 days', value: b['60'], color: '#f59e0b' },
    { bucket: '90+ days', value: b['90+'], color: '#dc2626' },
  ];
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <h3><Activity size={14} /> AR Aging ({data.ar_aging.period})</h3>
        <button className="btn btn-sm" onClick={() => onDrill('What does the AR aging profile look like and which entities are slowest?')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <Tooltip formatter={fmtMoney} />
          <Bar dataKey="value">
            {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PnlWaterfallCard({ data, onDrill }) {
  if (!data.pnl_waterfall?.items?.length) return null;
  // Running cumulative for waterfall effect
  let running = 0;
  const items = data.pnl_waterfall.items.map((it, i, arr) => {
    const isTotal = it.kind === 'total';
    if (isTotal && i === 0) { running = it.value; return { ...it, base: 0, value: it.value, total: it.value }; }
    if (isTotal && i === arr.length - 1) return { ...it, base: 0, value: it.value, total: it.value };
    const newRunning = running + it.value;
    const step = { ...it, base: it.value < 0 ? newRunning : running, value: Math.abs(it.value), total: running + it.value, sign: it.value };
    running = newRunning;
    return step;
  });
  return (
    <div className="dashboard-card full">
      <div className="dashboard-card-header">
        <h3><BarChart3 size={14} /> P&L Waterfall — {data.pnl_waterfall.period}</h3>
        <button className="btn btn-sm" onClick={() => onDrill(`Give me a P&L summary for ${data.pnl_waterfall.period}`)}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={items} margin={{ top: 20, right: 20, bottom: 20, left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <Tooltip formatter={(_, __, p) => fmtMoney(p.payload.sign ?? p.payload.total)} labelFormatter={(l) => l} />
          <Bar dataKey="base" stackId="w" fill="transparent" />
          <Bar dataKey="value" stackId="w">
            {items.map((it, i) => {
              const color = it.kind === 'total' ? '#1e3a5f' : ((it.sign ?? 1) < 0 ? '#dc2626' : '#10b981');
              return <Cell key={i} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function YoYCard({ data, onDrill }) {
  if (!data.yoy?.entities?.length) return null;
  const rows = data.yoy.entities.map(e => ({
    entity: e.entity_code,
    [data.yoy.prior_period]: e.prior,
    [data.yoy.current_period]: e.current,
  }));
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <h3><BarChart3 size={14} /> YoY Revenue — {data.yoy.prior_period} vs {data.yoy.current_period}</h3>
        <button className="btn btn-sm" onClick={() => onDrill(`Show me year-over-year revenue by entity for ${data.yoy.current_period}`)}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis dataKey="entity" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <Tooltip formatter={fmtMoney} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={data.yoy.prior_period} fill="#94a3b8" />
          <Bar dataKey={data.yoy.current_period} fill="#1e3a5f" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VarianceBarCard({ data, onDrill }) {
  if (!data.top_variances?.length) return null;
  return (
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <h3><BarChart3 size={14} /> Top Variances ({data.latest_period})</h3>
        <button className="btn btn-sm" onClick={() => onDrill(`Which accounts had the biggest budget variances in ${data.latest_period}?`)}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data.top_variances.slice(0, 8)} layout="vertical" margin={{ left: 70 }}
          onClick={e => e?.activePayload?.[0]?.payload?.account_name && onDrill(`Explain the budget variance for ${e.activePayload[0].payload.account_name}`)} style={{ cursor: 'pointer' }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e6eb" />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtAxis} />
          <YAxis type="category" dataKey="account_name" tick={{ fontSize: 10 }} width={120} />
          <Tooltip formatter={fmtMoney} />
          <Bar dataKey="variance">
            {data.top_variances.slice(0, 8).map((v, i) => {
              const unfav = (v.account_type === 'revenue' && v.variance < 0) || ((v.account_type === 'expense' || v.account_type === 'liability') && v.variance > 0);
              return <Cell key={i} fill={unfav ? '#dc2626' : '#10b981'} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function VarianceHeatmapCard({ data, onDrill }) {
  if (!data.variance_heatmap?.rows?.length) return null;
  const periods = data.variance_heatmap.periods;
  const accounts = Array.from(new Set(data.variance_heatmap.rows.map(r => r.account_name)));
  const cellColor = (pct) => {
    if (pct == null) return '#f3f4f6';
    const clamped = Math.max(-40, Math.min(40, pct));
    const intensity = Math.min(1, Math.abs(clamped) / 40);
    if (clamped > 0) return `rgba(16, 185, 129, ${intensity})`;
    return `rgba(220, 38, 38, ${intensity})`;
  };
  const cellMap = new Map();
  for (const r of data.variance_heatmap.rows) cellMap.set(`${r.account_name}|${r.period}`, r.weighted_pct);
  return (
    <div className="dashboard-card full">
      <div className="dashboard-card-header">
        <h3><BarChart3 size={14} /> Variance Heatmap — Accounts × Periods</h3>
        <button className="btn btn-sm" onClick={() => onDrill('Which accounts have been consistently over or under budget?')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <div className="heatmap-wrapper">
        <table className="variance-heatmap">
          <thead>
            <tr>
              <th>Account</th>
              {periods.map(p => <th key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a}>
                <td className="heatmap-label">{a}</td>
                {periods.map(p => {
                  const v = cellMap.get(`${a}|${p}`);
                  return <td key={p} style={{ background: cellColor(v), color: v != null && Math.abs(v) > 20 ? '#fff' : '#111' }} title={v != null ? `${v.toFixed(1)}%` : ''}>{v != null ? `${v.toFixed(0)}%` : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataFreshnessCard({ data, onDrill }) {
  return (
    <div className="dashboard-card full">
      <div className="dashboard-card-header">
        <h3><Clock size={14} /> Data Freshness</h3>
        <button className="btn btn-sm" onClick={() => onDrill('What data do I have loaded? Show me a summary of all tables.')}><MessageSquare size={11} /> Ask AI</button>
      </div>
      <div className="freshness-chips">
        {data.data_freshness.map(f => {
          const empty = f.rows === 0;
          const hoursOld = f.last_updated ? (Date.now() - new Date(f.last_updated.replace(' ', 'T') + 'Z').getTime()) / 3.6e6 : null;
          const stale = hoursOld != null && hoursOld > 24 * 30 * 6;
          const cls = empty ? 'err' : stale ? 'warn' : 'ok';
          return (
            <div key={f.table} className={`freshness-chip ${cls}`}>
              <span className="freshness-chip-label">{f.table}</span>
              <span className="freshness-chip-count">{f.rows.toLocaleString()} rows</span>
              <span className="freshness-chip-time">{f.last_updated?.slice(0, 10) || '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyDashboard() {
  return (
    <div className="empty-state">
      <BarChart3 size={40} style={{ color: 'var(--c-text-muted)', marginBottom: 12 }} />
      <h3>No data to display</h3>
      <p>Load some financial data via the <a href="/workspace">Data Workspace</a> to see dashboard charts.</p>
    </div>
  );
}

// ============================================================
// AI-Generated panel
// ============================================================
function AIInsightsPanel({ onDrill }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('severity');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [regenerating, setRegenerating] = useState(false);
  const [regenNote, setRegenNote] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/dashboard/insights').then(r => { setInsights(r.data); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const regenerate = async () => {
    setRegenerating(true);
    setRegenNote(null);
    try {
      const r = await api.post('/dashboard/insights/generate');
      setRegenNote(`Generated ${r.data.inserted} insights from ${r.data.signals_count} signals in ${(r.data.latency_ms / 1000).toFixed(1)}s.`);
      load();
    } catch (e) {
      setRegenNote(`Failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <div className="loading-page"><span className="spinner-inline" /> &nbsp; Loading insights...</div>;

  const safeInsights = insights || [];
  const bySev = safeInsights.reduce((acc, i) => { acc[i.severity] = (acc[i.severity] || 0) + 1; return acc; }, {});
  const warnings = (bySev.warning || 0) + (bySev.error || 0);
  const successes = bySev.success || 0;
  const infos = bySev.info || 0;

  const allCategories = Array.from(new Set(safeInsights.map(i => i.category))).filter(Boolean);
  const CATEGORY_GROUPS = [
    { id: 'all', label: 'All', match: () => true },
    { id: 'alerts', label: 'Alerts', match: (i) => i.severity === 'warning' || i.severity === 'error' },
    { id: 'wins', label: 'Improving', match: (i) => i.severity === 'success' },
    { id: 'variance', label: 'Variance', match: (i) => i.category === 'variance' },
    { id: 'revenue', label: 'Revenue', match: (i) => i.category === 'revenue' },
    { id: 'cash', label: 'Cash', match: (i) => i.category === 'cash' },
    { id: 'expense', label: 'Margin/Expense', match: (i) => i.category === 'expense' },
    { id: 'concentration', label: 'Concentration', match: (i) => i.category === 'concentration' },
    { id: 'freshness', label: 'Data Quality', match: (i) => i.category === 'freshness' },
  ].filter(g => ['all', 'alerts', 'wins'].includes(g.id) || allCategories.includes(g.id));

  const active = CATEGORY_GROUPS.find(g => g.id === categoryFilter) || CATEGORY_GROUPS[0];
  let filtered = safeInsights.filter(i => active.match(i) && (severityFilter === 'all' || i.severity === severityFilter));
  if (sortBy === 'severity') {
    const w = { error: 4, warning: 3, success: 2, info: 1 };
    filtered = [...filtered].sort((a, b) => (w[b.severity] || 0) - (w[a.severity] || 0));
  } else if (sortBy === 'recent') {
    filtered = [...filtered].sort((a, b) => (b.detected_at || '').localeCompare(a.detected_at || ''));
  }

  const toggleExpand = (id) => setExpandedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const scrollToInsight = (id) => {
    const el = document.getElementById(`insight-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('insight-card-highlight'); setTimeout(() => el.classList.remove('insight-card-highlight'), 1800); }
  };

  return (
    <div className="insights-panel">
      <div className="insights-summary-strip">
        <div className="insights-summary-item alerts"><AlertTriangle size={14} /> <strong>{warnings}</strong> alert{warnings !== 1 ? 's' : ''}</div>
        <div className="insights-summary-item wins"><CheckCircle size={14} /> <strong>{successes}</strong> improving signal{successes !== 1 ? 's' : ''}</div>
        <div className="insights-summary-item infos"><Info size={14} /> <strong>{infos}</strong> informational</div>
        <div className="insights-summary-meta">
          <button className="btn btn-sm" onClick={regenerate} disabled={regenerating}>
            {regenerating ? <><span className="spinner-inline" /> &nbsp;Generating…</> : <><Sparkles size={11} /> Regenerate</>}
          </button>
        </div>
      </div>
      {regenNote && <div className="banner banner-info" style={{ marginBottom: 12 }}>{regenNote}</div>}

      <div className="insights-category-tabs">
        {CATEGORY_GROUPS.map(g => {
          const count = safeInsights.filter(g.match).length;
          return <button key={g.id} className={'insights-category-tab' + (categoryFilter === g.id ? ' active' : '')} onClick={() => setCategoryFilter(g.id)}>{g.label} <span className="insights-category-count">{count}</span></button>;
        })}
        <div style={{ flex: 1 }} />
        <select className="insights-severity-filter" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="severity">Sort: severity</option>
          <option value="recent">Sort: recency</option>
        </select>
        <select className="insights-severity-filter" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
          <option value="all">All severities</option>
          <option value="error">Error only</option>
          <option value="warning">Warning only</option>
          <option value="success">Success only</option>
          <option value="info">Info only</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <p>No insights match the current filters.</p>
          <button className="btn" onClick={() => { setCategoryFilter('all'); setSeverityFilter('all'); }}>Reset filters</button>
        </div>
      )}

      <div className="insights-grid">
        {filtered.map(ins => (
          <InsightCard key={ins.id} ins={ins} insights={safeInsights} expanded={expandedIds.has(ins.id)} onToggleExpand={() => toggleExpand(ins.id)} onDrill={onDrill} onRelatedClick={scrollToInsight} />
        ))}
      </div>
    </div>
  );
}

function InsightCard({ ins, insights, expanded, onToggleExpand, onDrill, onRelatedClick }) {
  const color = SEVERITY_COLORS[ins.severity] || '#6b7280';
  const iconMap = { error: <AlertTriangle size={14} />, warning: <AlertTriangle size={14} />, success: <CheckCircle size={14} />, info: <Info size={14} /> };
  const icon = iconMap[ins.severity] || <Sparkles size={14} />;
  const rel = (ins.related_insight_ids || []).map(id => insights.find(x => x.id === id)).filter(Boolean);
  const relative = (ds) => {
    if (!ds) return null;
    const d = new Date(ds);
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    if (days < 1) return 'Today'; if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`; if (days < 30) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
  };
  return (
    <div id={`insight-${ins.id}`} className="insight-card" style={{ borderLeftColor: color }}>
      <div className="insight-card-header">
        <span className="insight-severity" style={{ color }}>{icon} <span style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5, marginLeft: 4 }}>{ins.severity}</span></span>
        {ins.category && <span className="insight-category">{ins.category}</span>}
        {ins.detected_at && <span className="insight-detected-at" title={ins.detected_at}><Clock size={10} /> {relative(ins.detected_at)}</span>}
        {ins.confidence != null && <span className="insight-confidence" title="Agent confidence in this insight">{ins.confidence}%</span>}
      </div>
      <h3>{ins.title}</h3>
      <div className="insight-hero-row">
        {ins.impact_value && (
          <div className="insight-impact-chip" style={{ background: color + '15', color, borderColor: color + '40' }}>
            <strong>{ins.impact_value}</strong>
            {ins.impact_label && <span className="insight-impact-label">{ins.impact_label}</span>}
          </div>
        )}
        {ins.trend_data?.length > 1 && (
          <div className="insight-sparkline">
            <ResponsiveContainer width="100%" height={42}>
              <AreaChart data={ins.trend_data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.6} fill={color} fillOpacity={0.18} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <p>{ins.summary}</p>
      {ins.key_metrics?.length > 0 && (
        <div className="insight-metrics">
          {ins.key_metrics.map((m, i) => (
            <div key={i} className="insight-metric"><div className="insight-metric-value">{m.value}</div><div className="insight-metric-label">{m.label}</div></div>
          ))}
        </div>
      )}
      {ins.detailed_narrative && (
        <>
          <button className="insight-expand-btn" onClick={onToggleExpand}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {expanded ? 'Hide detailed analysis' : 'Read detailed analysis'}
          </button>
          {expanded && <div className="insight-narrative">{ins.detailed_narrative.split(/\n\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>}
        </>
      )}
      {rel.length > 0 && (
        <div className="insight-related">
          <span className="insight-related-label">Related:</span>
          {rel.map(r => <button key={r.id} className="insight-related-chip" onClick={() => onRelatedClick(r.id)} title={r.summary}>{r.title} <ArrowRight size={10} /></button>)}
        </div>
      )}
      <div className="insight-card-footer">
        <div className="insight-sources">
          {(ins.sources || []).map((s, i) => <span key={i} className="source-chip-mini">{s.table} ({s.row_ids?.length || 0} rows)</span>)}
        </div>
        {ins.drill_question && <button className="btn btn-sm" onClick={() => onDrill(ins.drill_question)}><MessageSquare size={11} /> Ask AI</button>}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, useParams } from 'react-router-dom';
import { Home, Database, MessageSquare, BarChart3, Settings as SettingsIcon, Upload } from 'lucide-react';
import { api } from './api';
import OverviewPage from './pages/OverviewPage.jsx';
import WorkspacePage from './pages/WorkspacePage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

export default function App() {
  const [tables, setTables] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.get('/tables').then(r => setTables(r.data)).catch(() => {});
  }, [refreshKey]);

  const refreshTables = () => setRefreshKey(k => k + 1);

  return (
    <div className="app-layout">
      <Sidebar tables={tables} />
      <div className="main-content">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspace" element={<WorkspacePage tables={tables} onRefresh={refreshTables} />} />
          <Route path="/workspace/:tableName" element={<WorkspacePage tables={tables} onRefresh={refreshTables} />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}

function Sidebar({ tables }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        FinAgent <span className="tag">Tool 1</span>
      </div>
      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
          <Home size={16} /> Overview
        </NavLink>
        <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
          <BarChart3 size={16} /> Dashboard
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => isActive ? 'active' : ''}>
          <MessageSquare size={16} /> Chat
        </NavLink>
        <NavLink to="/workspace" end className={({ isActive }) => isActive ? 'active' : ''}>
          <Database size={16} /> Data Workspace
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
          <SettingsIcon size={16} /> Settings
        </NavLink>
      </nav>
      <div className="sidebar-section">Canonical Tables</div>
      <div className="sidebar-tables-list">
        {tables.map(t => (
          <NavLink
            key={t.name}
            to={`/workspace/${t.name}`}
            className={({ isActive }) => 'sidebar-table-item' + (isActive ? ' active' : '')}
          >
            <span className="dot" style={{ background: t.has_dummy ? '#fbbf24' : '#16a34a' }} title={t.has_dummy ? 'Has sample data' : 'Real data only'} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</span>
            <span className="row-count">{t.row_count}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}

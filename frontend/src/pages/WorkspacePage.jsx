import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Upload, Trash2, AlertTriangle, Download, ChevronDown } from 'lucide-react';
import { api } from '../api';
import TableEditor from '../components/TableEditor/TableEditor.jsx';
import UploadModal from '../components/UploadModal/UploadModal.jsx';
import DataQualityBar from '../components/DataQualityBar.jsx';
import RowDetailPanel from '../components/RowDetailPanel.jsx';

export default function WorkspacePage({ tables, onRefresh }) {
  const { tableName } = useParams();
  const navigate = useNavigate();
  const [schema, setSchema] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const downloadMenuRef = useRef(null);

  useEffect(() => {
    if (!tableName && tables.length > 0) {
      navigate(`/workspace/${tables[0].name}`);
    }
  }, [tableName, tables, navigate]);

  useEffect(() => {
    if (!tableName) return;
    api.get(`/tables/${tableName}/schema`).then(r => setSchema(r.data));
    setSelectedRowId(null);
    setShowDetailPanel(false);
  }, [tableName]);

  useEffect(() => {
    const onClick = (e) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target)) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const tableInfo = tables.find(t => t.name === tableName);

  const clearSampleData = async () => {
    if (!confirm(`Delete all sample (dummy) rows from ${tableInfo.label}? Your own data will not be affected.`)) return;
    await api.post(`/tables/${tableName}/clear-sample-data`);
    onRefresh?.();
    setReloadKey(k => k + 1);
  };

  const downloadTemplate = (mode) => {
    setDownloadMenuOpen(false);
    window.location.href = `/api/tables/${tableName}/download?mode=${mode}`;
  };

  if (!tableName || !schema || !tableInfo) {
    return <div className="loading-page"><span className="spinner-inline" /> &nbsp; Loading...</div>;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{tableInfo.label}</h1>
          <div className="page-subtitle">{tableInfo.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tableInfo.has_dummy && (
            <button className="btn" onClick={clearSampleData}>
              <Trash2 size={14} /> Clear sample data
            </button>
          )}
          <div ref={downloadMenuRef} style={{ position: 'relative' }}>
            <button className="btn" onClick={() => setDownloadMenuOpen(o => !o)}>
              <Download size={14} /> Download <ChevronDown size={12} />
            </button>
            {downloadMenuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4,
                background: '#fff', border: '1px solid var(--c-border-strong)',
                borderRadius: 6, boxShadow: 'var(--shadow-md)', zIndex: 10,
                minWidth: 240, overflow: 'hidden',
              }}>
                <div onClick={() => downloadTemplate('template')}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--c-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--c-row-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Empty template (.xlsx)</div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
                    Headers + instructions sheet. Fill in your data and re-upload.
                  </div>
                </div>
                <div onClick={() => downloadTemplate('data')}
                  style={{ padding: '10px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--c-row-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Current data (.xlsx)</div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 2 }}>
                    All rows currently in this table. Edit offline, then re-upload.
                  </div>
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            <Upload size={14} /> Upload file
          </button>
        </div>
      </div>
      {tableInfo.has_dummy && tableInfo.user_count === 0 && (
        <div className="banner banner-warn" style={{ margin: '12px 24px' }}>
          <AlertTriangle size={14} /> This table contains <strong>sample data</strong> — yellow rows are dummy data shown so you can explore. Replace with your own via upload or by editing rows directly.
        </div>
      )}
      <DataQualityBar key={`dq-${tableName}-${reloadKey}`} tableName={tableName} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TableEditor
            key={`${tableName}-${reloadKey}`}
            tableName={tableName}
            schema={schema}
            onChanged={onRefresh}
            onRowSelect={(rowId) => { setSelectedRowId(rowId); setShowDetailPanel(true); }}
          />
        </div>
        {showDetailPanel && selectedRowId && (
          <RowDetailPanel
            tableName={tableName}
            rowId={selectedRowId}
            onClose={() => setShowDetailPanel(false)}
          />
        )}
      </div>
      <UploadModal
        open={showUpload}
        suggestedTable={tableName}
        onClose={() => setShowUpload(false)}
        onCompleted={() => { onRefresh?.(); setReloadKey(k => k + 1); }}
      />
    </>
  );
}

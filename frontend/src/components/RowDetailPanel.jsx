import React, { useEffect, useState } from 'react';
import { X, Clock, AlertTriangle, FileText } from 'lucide-react';
import { api } from '../api';

export default function RowDetailPanel({ tableName, rowId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tableName || !rowId) return;
    setLoading(true);
    api.get(`/tables/${tableName}/rows/${rowId}/detail`)
      .then(r => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tableName, rowId]);

  if (!rowId) return null;

  return (
    <div className="row-detail-panel">
      <div className="row-detail-header">
        <span style={{ fontWeight: 600, fontSize: 13 }}>Row Details</span>
        <button className="close-x" onClick={onClose} style={{ width: 22, height: 22, fontSize: 16 }}><X size={14} /></button>
      </div>
      {loading ? (
        <div style={{ padding: 16, color: 'var(--c-text-muted)' }}><span className="spinner-inline" /> Loading...</div>
      ) : data ? (
        <div className="row-detail-body">
          {/* Source info */}
          <div className="row-detail-section">
            <div className="row-detail-section-title"><FileText size={12} /> Source</div>
            <div className="row-detail-kv">
              <span>Source</span><span>{data.row.source || 'manual'}</span>
            </div>
            {data.row.source_row_ref && (
              <div className="row-detail-kv">
                <span>Original ref</span><span>{data.row.source_row_ref}</span>
              </div>
            )}
            <div className="row-detail-kv">
              <span>Confidence</span><span>{data.row.confidence ?? '—'}%</span>
            </div>
            <div className="row-detail-kv">
              <span>Created</span><span>{data.row.created_at || '—'}</span>
            </div>
            <div className="row-detail-kv">
              <span>Updated</span><span>{data.row.updated_at || '—'}</span>
            </div>
            <div className="row-detail-kv">
              <span>Type</span><span>{data.row.is_dummy ? 'Sample data' : 'User data'}</span>
            </div>
          </div>

          {/* Issues */}
          {data.issues.length > 0 && (
            <div className="row-detail-section">
              <div className="row-detail-section-title"><AlertTriangle size={12} /> Issues ({data.issues.length})</div>
              {data.issues.map((iss, i) => (
                <div key={i} className={`row-detail-issue ${iss.severity}`}>
                  <span className="row-detail-issue-type">{iss.issue_type}</span>
                  <span>{iss.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Audit history */}
          <div className="row-detail-section">
            <div className="row-detail-section-title"><Clock size={12} /> Audit History ({data.audit_history.length})</div>
            {data.audit_history.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--c-text-muted)', padding: '4px 0' }}>No changes recorded.</div>
            )}
            {data.audit_history.map((entry, i) => (
              <div key={i} className="row-detail-audit">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ fontWeight: 500 }}>{entry.action}</span>
                  <span style={{ color: 'var(--c-text-muted)' }}>{entry.created_at}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>by {entry.actor || 'system'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, color: 'var(--c-text-muted)' }}>Failed to load details.</div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '../api';

export default function DataQualityBar({ tableName, onFilterIssues }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tableName) return;
    setLoading(true);
    api.get(`/tables/${tableName}/issues`)
      .then(r => { setIssues(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tableName]);

  if (loading) return null;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const total = issues.length;

  if (total === 0) {
    return (
      <div className="dq-bar zero">
        <CheckCircle size={13} style={{ marginRight: 6 }} />
        No data quality issues found.
      </div>
    );
  }

  return (
    <div className="dq-bar">
      <AlertTriangle size={13} style={{ marginRight: 6 }} />
      <strong>{errors.length} error{errors.length !== 1 ? 's' : ''}</strong>,{' '}
      <strong>{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</strong>
      {' '}&mdash;{' '}
      <button
        onClick={() => onFilterIssues?.(issues)}
        style={{ background: 'none', border: 'none', color: '#92400e', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}
      >
        review
      </button>
    </div>
  );
}

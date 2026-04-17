// frontend/src/components/UploadModal/UploadModal.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Check, AlertTriangle, Loader, Upload, X, Circle } from 'lucide-react';
import { api, getLlmConfig } from '../../api';

export default function UploadModal({ open, onClose, onCompleted, suggestedTable = null }) {
  const [phase, setPhase] = useState('upload'); // upload | running | mapping | conflicts | done | error
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [confirmedMappings, setConfirmedMappings] = useState({});
  const [conflictResolutions, setConflictResolutions] = useState({});
  const pollRef = useRef(null);

  const reset = () => {
    setPhase('upload'); setJobId(null); setJob(null); setError(null);
    setConfirmedMappings({}); setConflictResolutions({});
    if (pollRef.current) clearInterval(pollRef.current);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const res = await api.get(`/uploads/jobs/${jobId}`);
        setJob(res.data);
        const status = res.data.status;
        if (status === 'awaiting_user') {
          if (res.data.current_stage === 'awaiting_mapping_confirm') {
            setPhase('mapping');
            // Initialize confirmedMappings from the proposed
            const proposed = res.data.mapping_json?.proposals || {};
            const init = {};
            for (const [sheet, p] of Object.entries(proposed)) {
              if (p.proposal && !p.proposal.error) {
                init[sheet] = { target_table: p.target_table, column_mappings: p.proposal.column_mappings || [] };
              }
            }
            setConfirmedMappings(init);
            clearInterval(pollRef.current);
          } else if (res.data.current_stage === 'awaiting_conflict_resolution') {
            setPhase('conflicts');
            clearInterval(pollRef.current);
          }
        } else if (status === 'done') {
          setPhase('done');
          clearInterval(pollRef.current);
          onCompleted?.();
        } else if (status === 'error') {
          setPhase('error');
          setError(res.data.error || 'Unknown error');
          clearInterval(pollRef.current);
        }
      } catch (e) { /* keep trying */ }
    };
    pollRef.current = setInterval(tick, 1000);
    tick();
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const onDrop = useCallback(async (files) => {
    if (!files.length) return;
    const { provider, apiKey } = getLlmConfig();
    if (!apiKey) {
      setError('No LLM API key. Add one in Settings before uploading.');
      setPhase('error'); return;
    }
    const fd = new FormData();
    fd.append('file', files[0]);
    fd.append('provider', provider);
    fd.append('apiKey', apiKey);
    if (suggestedTable) fd.append('targetTable', suggestedTable);
    try {
      setPhase('running');
      const res = await api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setJobId(res.data.job_id);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setPhase('error');
    }
  }, [suggestedTable]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'application/pdf': ['.pdf'],
    },
  });

  const submitMapping = async () => {
    setPhase('running');
    // Restart polling
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/uploads/jobs/${jobId}`);
        setJob(res.data);
        if (res.data.status === 'awaiting_user' && res.data.current_stage === 'awaiting_conflict_resolution') {
          setPhase('conflicts'); clearInterval(pollRef.current);
        } else if (res.data.status === 'done') {
          setPhase('done'); clearInterval(pollRef.current); onCompleted?.();
        } else if (res.data.status === 'error') {
          setPhase('error'); setError(res.data.error); clearInterval(pollRef.current);
        }
      } catch {}
    }, 1000);
    try {
      await api.post(`/uploads/jobs/${jobId}/confirm-mapping`, { confirmed_mappings: confirmedMappings });
    } catch (e) {
      setError(e.response?.data?.error || e.message); setPhase('error');
    }
  };

  const submitConflicts = async () => {
    setPhase('running');
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/uploads/jobs/${jobId}`);
        setJob(res.data);
        if (res.data.status === 'done') { setPhase('done'); clearInterval(pollRef.current); onCompleted?.(); }
        else if (res.data.status === 'error') { setPhase('error'); setError(res.data.error); clearInterval(pollRef.current); }
      } catch {}
    }, 1000);
    try {
      await api.post(`/uploads/jobs/${jobId}/resolve-conflicts`, { resolutions: conflictResolutions });
    } catch (e) {
      setError(e.response?.data?.error || e.message); setPhase('error');
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2>Upload data</h2>
          <button className="close-x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {phase === 'upload' && <UploadDropzone {...{ getRootProps, getInputProps, isDragActive, suggestedTable }} />}
          {(phase === 'running' || phase === 'mapping' || phase === 'conflicts' || phase === 'done') && job && <Stepper job={job} />}
          {phase === 'mapping' && job && (
            <MappingReview
              job={job}
              confirmedMappings={confirmedMappings}
              setConfirmedMappings={setConfirmedMappings}
            />
          )}
          {phase === 'conflicts' && job && (
            <ConflictResolution
              job={job}
              resolutions={conflictResolutions}
              setResolutions={setConflictResolutions}
            />
          )}
          {phase === 'done' && job && <DoneSummary job={job} />}
          {phase === 'error' && (
            <div className="banner" style={{ background: 'var(--c-red-bg)', borderColor: 'var(--c-red-border)', color: '#7f1d1d' }}>
              <AlertTriangle size={16} /> {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {phase === 'mapping' && (
            <button className="btn btn-primary" onClick={submitMapping}>Confirm mapping & continue</button>
          )}
          {phase === 'conflicts' && (
            <button className="btn btn-primary" onClick={submitConflicts}>Apply resolutions & load</button>
          )}
          {phase === 'done' && (
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          )}
          {(phase === 'error' || phase === 'upload') && (
            <button className="btn" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadDropzone({ getRootProps, getInputProps, isDragActive, suggestedTable }) {
  return (
    <>
      {suggestedTable && (
        <div className="banner banner-info">
          Uploading to: <strong>{suggestedTable}</strong>. The pipeline will still detect mismatches.
        </div>
      )}
      <div {...getRootProps()} className={'dropzone' + (isDragActive ? ' active' : '')}>
        <input {...getInputProps()} />
        <Upload className="dropzone-icon" size={36} />
        <p style={{ margin: '8px 0 4px' }}><strong>Drop a file here, or click to browse</strong></p>
        <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>
          Excel (.xlsx, .xls), CSV, JSON, or PDF — up to 50 MB
        </p>
      </div>
    </>
  );
}

function Stepper({ job }) {
  const stages = job.stages_json || [];
  const labels = {
    parsing: 'Parsing file',
    classifying: 'Classifying sheets',
    mapping_proposed: 'Proposing schema mapping',
    awaiting_mapping_confirm: 'Awaiting mapping confirmation',
    validating: 'Validating data',
    awaiting_validation_review: 'Awaiting validation review',
    reconciling: 'Reconciling with existing data',
    awaiting_conflict_resolution: 'Awaiting conflict resolution',
    loading: 'Loading into tables',
    done: 'Complete',
    error: 'Error',
  };
  return (
    <div className="stepper">
      {stages.filter(s => s.name !== 'error' || s.status !== 'pending').map(s => (
        <div key={s.name} className={`step ${s.status}`}>
          <span className="step-icon">
            {s.status === 'running' && <Loader className="spin" size={18} />}
            {s.status === 'done' && <Check size={18} color="#16a34a" />}
            {s.status === 'awaiting_user' && <AlertTriangle size={18} color="#d97706" />}
            {s.status === 'error' && <AlertTriangle size={18} color="#dc2626" />}
            {s.status === 'pending' && <Circle size={14} color="#cbd5e1" />}
          </span>
          <span className="step-name">{labels[s.name] || s.name}</span>
          <span className="step-status">{s.status}</span>
        </div>
      ))}
    </div>
  );
}

function confidencePill(c) {
  const cls = c >= 80 ? 'high' : c >= 50 ? 'med' : 'low';
  return <span className={`confidence-pill ${cls}`}>{c}%</span>;
}

function MappingReview({ job, confirmedMappings, setConfirmedMappings }) {
  const proposals = job.mapping_json?.proposals || {};
  return (
    <div className="mapping-review">
      <div className="banner banner-info">Review the proposed mapping for each sheet. Edit target fields if needed, then continue.</div>
      {Object.entries(proposals).map(([sheetName, p]) => {
        const cm = confirmedMappings[sheetName]?.column_mappings || [];
        return (
          <div key={sheetName} className="mapping-sheet">
            <div className="mapping-sheet-header">
              <span>📄 {sheetName} → <strong>{p.target_table}</strong></span>
              {p.proposal?.auto_applied && (
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: 'var(--c-accent-bg, #e6f2ff)', color: 'var(--c-accent, #0a66c2)',
                  border: '1px solid var(--c-accent-border, #bcd9f7)', marginLeft: 8,
                }} title={p.proposal.auto_applied_source}>
                  ✓ Auto-applied from prior upload
                </span>
              )}
              {p.proposal?.overall_confidence != null && confidencePill(p.proposal.overall_confidence)}
            </div>
            {p.proposal?.error ? (
              <div style={{ padding: 12, color: 'var(--c-danger)' }}>Mapping failed: {p.proposal.error}</div>
            ) : (
              <table className="mapping-table">
                <thead>
                  <tr>
                    <th>Source column</th>
                    <th>→ Target field</th>
                    <th>Confidence</th>
                    <th>Transformations</th>
                  </tr>
                </thead>
                <tbody>
                  {cm.map((m, idx) => (
                    <tr key={idx}>
                      <td><code>{m.source_column}</code></td>
                      <td>
                        <input
                          value={m.target_field || ''}
                          onChange={e => {
                            const updated = [...cm];
                            updated[idx] = { ...m, target_field: e.target.value || null };
                            setConfirmedMappings({
                              ...confirmedMappings,
                              [sheetName]: { ...confirmedMappings[sheetName], column_mappings: updated },
                            });
                          }}
                          placeholder="(skip)"
                          style={{ padding: '4px 8px', border: '1px solid var(--c-border-strong)', borderRadius: 4, width: '100%' }}
                        />
                      </td>
                      <td>{confidencePill(m.confidence ?? 0)}</td>
                      <td style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>
                        {(m.transformations || []).map(t => t.type + (t.value ? `:${t.value}` : '')).join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.proposal?.questions_for_user?.length > 0 && (
              <div style={{ padding: 12, background: 'var(--c-yellow-bg)', borderTop: '1px solid var(--c-yellow-border)', fontSize: 12 }}>
                <strong>Questions:</strong>
                <ul style={{ margin: '4px 0 0 16px' }}>
                  {p.proposal.questions_for_user.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConflictResolution({ job, resolutions, setResolutions }) {
  const recon = job.reconciliation_json || {};
  return (
    <div>
      <div className="banner banner-info">Resolve each conflict. Skip = keep existing; Use new = overwrite with uploaded value.</div>
      {Object.entries(recon).map(([sheetName, r]) => {
        const conflicts = r.reconciliation?.conflicts || [];
        if (conflicts.length === 0) return null;
        const sheetRes = resolutions[sheetName] || {};
        return (
          <div key={sheetName} style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 8 }}>{sheetName} → {r.target_table} ({conflicts.length} conflict{conflicts.length > 1 ? 's' : ''})</h3>
            {conflicts.map(c => {
              const choice = sheetRes[c.row_index] || 'skip';
              return (
                <div key={c.row_index} className="conflict-card">
                  <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 6 }}>
                    Conflict on: {Object.entries(c.conflict_keys).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                  <div className="conflict-side-by-side">
                    <div className="conflict-col">
                      <h4>Existing</h4>
                      {c.differing_fields.map(f => <div key={f}>{f}: <span className="val">{String(c.existing_row[f])}</span></div>)}
                    </div>
                    <div className="conflict-col">
                      <h4>New (uploaded)</h4>
                      {c.differing_fields.map(f => <div key={f}>{f}: <span className="val">{String(c.new_row[f])}</span></div>)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`btn btn-sm ${choice === 'skip' ? 'btn-primary' : ''}`}
                      onClick={() => setResolutions({ ...resolutions, [sheetName]: { ...sheetRes, [c.row_index]: 'skip' } })}>Skip</button>
                    <button className={`btn btn-sm ${choice === 'use_new' ? 'btn-primary' : ''}`}
                      onClick={() => setResolutions({ ...resolutions, [sheetName]: { ...sheetRes, [c.row_index]: 'use_new' } })}>Use new</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function DoneSummary({ job }) {
  const lr = job.load_result_json || {};
  return (
    <div>
      <div className="banner" style={{ background: 'var(--c-green-bg)', borderColor: 'var(--c-green-border)', color: '#14532d' }}>
        <Check size={16} /> Upload complete.
      </div>
      <table className="mapping-table">
        <thead><tr><th>Sheet</th><th>Target</th><th>Inserted</th><th>Overwritten</th><th>Skipped</th></tr></thead>
        <tbody>
          {Object.entries(lr).map(([sheet, r]) => (
            <tr key={sheet}><td>{sheet}</td><td>{r.target_table}</td><td>{r.inserted}</td><td>{r.overwritten}</td><td>{r.skipped}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

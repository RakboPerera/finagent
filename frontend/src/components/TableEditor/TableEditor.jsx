// frontend/src/components/TableEditor/TableEditor.jsx
// Spreadsheet-grade virtualized table editor with undo/redo, paste, keyboard nav, column resize, find/replace.
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../../api';

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 36;
const BUFFER_ROWS = 5;
const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 160;

export default function TableEditor({ tableName, schema, onChanged, onRowSelect }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { rowId, field, value }
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeCell, setActiveCell] = useState(null); // { rowId, colIdx }
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [colWidths, setColWidths] = useState({});
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findMatches, setFindMatches] = useState([]);
  const [findIdx, setFindIdx] = useState(-1);
  const [colMenuOpen, setColMenuOpen] = useState(null);
  const containerRef = useRef(null);
  const resizingRef = useRef(null);

  const dataFields = schema.fields.map(f => f.name);
  const visibleFields = dataFields.filter(f => !hiddenCols.has(f));
  const allColumns = ['__source__', ...visibleFields];

  const getColWidth = (col) => {
    if (col === '__source__') return 40;
    return colWidths[col] || DEFAULT_COL_WIDTH;
  };

  const gridTemplate = useMemo(() => {
    return allColumns.map(c => `${getColWidth(c)}px`).join(' ');
  }, [allColumns, colWidths]);

  const reload = useCallback(() => {
    setLoading(true);
    api.get(`/tables/${tableName}/rows?limit=5000`)
      .then(r => { setRows(r.data.rows); setTotal(r.data.total); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tableName]);

  useEffect(() => {
    reload();
    setSelectedIds(new Set());
    setActiveCell(null);
    setSortField(null);
    setFilter('');
    setUndoStack([]);
    setRedoStack([]);
  }, [tableName, reload]);

  useEffect(() => {
    if (containerRef.current) setContainerHeight(containerRef.current.clientHeight);
    const ro = new ResizeObserver(() => {
      if (containerRef.current) setContainerHeight(containerRef.current.clientHeight);
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
        if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); handleRedo(); return; }
        if (e.key === 'f') { e.preventDefault(); setShowFindReplace(true); return; }
        if (e.key === 'c' && activeCell) { e.preventDefault(); handleCopy(); return; }
      }
      // Arrow key navigation when not editing
      if (editing) return;
      if (!activeCell) return;
      const { rowId, colIdx } = activeCell;
      const rowIndex = sortedRows.findIndex(r => r.id === rowId);
      if (rowIndex < 0) return;

      if (e.key === 'ArrowDown') { e.preventDefault(); navigateCell(rowIndex + 1, colIdx); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navigateCell(rowIndex - 1, colIdx); }
      else if (e.key === 'ArrowRight' || e.key === 'Tab') { e.preventDefault(); navigateCell(rowIndex, colIdx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); navigateCell(rowIndex, colIdx - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const field = visibleFields[colIdx];
        if (field) {
          const row = sortedRows[rowIndex];
          startEdit(row, field);
        }
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const field = visibleFields[colIdx];
        if (field) {
          const row = sortedRows[rowIndex];
          commitCellChange(row.id, field, '', row[field]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const navigateCell = (rowIdx, colIdx) => {
    const clampedRow = Math.max(0, Math.min(sortedRows.length - 1, rowIdx));
    const clampedCol = Math.max(0, Math.min(visibleFields.length - 1, colIdx));
    const row = sortedRows[clampedRow];
    if (row) setActiveCell({ rowId: row.id, colIdx: clampedCol });
  };

  // Filtered + sorted rows
  const filteredRows = useMemo(() => {
    if (!filter) return rows;
    const f = filter.toLowerCase();
    return rows.filter(r => dataFields.some(field => String(r[field] ?? '').toLowerCase().includes(f)));
  }, [rows, filter, dataFields]);

  const sortedRows = useMemo(() => {
    if (!sortField) return filteredRows;
    const sorted = [...filteredRows].sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [filteredRows, sortField, sortDir]);

  // Virtualization
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + BUFFER_ROWS * 2;
  const endIdx = Math.min(sortedRows.length, startIdx + visibleCount);
  const visibleRows = sortedRows.slice(startIdx, endIdx);
  const offsetTop = startIdx * ROW_HEIGHT;
  const totalRowsHeight = sortedRows.length * ROW_HEIGHT;

  const handleScroll = (e) => setScrollTop(e.target.scrollTop);
  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  // Undo/Redo
  const pushUndo = (action) => {
    setUndoStack(prev => [...prev.slice(-50), action]);
    setRedoStack([]);
  };
  const handleUndo = () => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      applyUndoAction(action);
      setRedoStack(r => [...r, action]);
      return prev.slice(0, -1);
    });
  };
  const handleRedo = () => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      applyRedoAction(action);
      setUndoStack(u => [...u, action]);
      return prev.slice(0, -1);
    });
  };
  const applyUndoAction = async (action) => {
    if (action.type === 'edit') {
      try {
        const res = await api.patch(`/tables/${tableName}/rows/${action.rowId}`, { [action.field]: action.oldValue });
        setRows(rs => rs.map(r => r.id === action.rowId ? res.data : r));
        onChanged?.();
      } catch {}
    }
  };
  const applyRedoAction = async (action) => {
    if (action.type === 'edit') {
      try {
        const res = await api.patch(`/tables/${tableName}/rows/${action.rowId}`, { [action.field]: action.newValue });
        setRows(rs => rs.map(r => r.id === action.rowId ? res.data : r));
        onChanged?.();
      } catch {}
    }
  };

  // Cell editing
  const startEdit = (row, field) => setEditing({ rowId: row.id, field, value: row[field] ?? '' });
  const commitEdit = async () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    const row = rows.find(r => r.id === e.rowId);
    if (row && row[e.field] === e.value) return;
    await commitCellChange(e.rowId, e.field, e.value, row?.[e.field]);
  };
  const commitCellChange = async (rowId, field, newValue, oldValue) => {
    if (oldValue === newValue) return;
    pushUndo({ type: 'edit', rowId, field, oldValue, newValue });
    try {
      const res = await api.patch(`/tables/${tableName}/rows/${rowId}`, { [field]: newValue });
      setRows(rs => rs.map(r => r.id === rowId ? res.data : r));
      onChanged?.();
    } catch (err) { alert('Update failed: ' + err.message); }
  };

  // Bulk paste from clipboard
  useEffect(() => {
    const onPaste = async (e) => {
      if (editing || !activeCell) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();

      const pasteRows = text.split('\n').filter(Boolean).map(line => line.split('\t'));
      const startRowIdx = sortedRows.findIndex(r => r.id === activeCell.rowId);
      const startColIdx = activeCell.colIdx;
      if (startRowIdx < 0) return;

      for (let ri = 0; ri < pasteRows.length; ri++) {
        const targetRowIdx = startRowIdx + ri;
        if (targetRowIdx >= sortedRows.length) break;
        const targetRow = sortedRows[targetRowIdx];
        for (let ci = 0; ci < pasteRows[ri].length; ci++) {
          const targetColIdx = startColIdx + ci;
          if (targetColIdx >= visibleFields.length) break;
          const field = visibleFields[targetColIdx];
          const val = pasteRows[ri][ci];
          await commitCellChange(targetRow.id, field, val, targetRow[field]);
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // Copy active cell
  const handleCopy = () => {
    if (!activeCell) return;
    const row = sortedRows.find(r => r.id === activeCell.rowId);
    const field = visibleFields[activeCell.colIdx];
    if (row && field) navigator.clipboard?.writeText(String(row[field] ?? ''));
  };

  // Row operations
  const handleAddRow = async () => {
    try {
      const res = await api.post(`/tables/${tableName}/rows`, {});
      setRows(rs => [...rs, res.data]);
      onChanged?.();
    } catch (err) { alert('Add failed: ' + err.message); }
  };
  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} row(s)?`)) return;
    try {
      await api.delete(`/tables/${tableName}/rows`, { data: { ids: Array.from(selectedIds) } });
      setRows(rs => rs.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      onChanged?.();
    } catch (err) { alert('Delete failed: ' + err.message); }
  };
  const handleDuplicate = async () => {
    if (selectedIds.size === 0) return;
    const toDup = rows.filter(r => selectedIds.has(r.id));
    for (const row of toDup) {
      const data = {};
      for (const f of dataFields) data[f] = row[f];
      try {
        const res = await api.post(`/tables/${tableName}/rows`, data);
        setRows(rs => [...rs, res.data]);
      } catch {}
    }
    onChanged?.();
  };

  const toggleSelect = (id, e) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (next.has(id)) next.delete(id); else next.add(id);
      } else {
        if (next.has(id) && next.size === 1) next.delete(id);
        else { next.clear(); next.add(id); }
      }
      return next;
    });
    onRowSelect?.(id);
  };

  // Column resize
  const startResize = (col, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = getColWidth(col);
    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      setColWidths(prev => ({ ...prev, [col]: Math.max(MIN_COL_WIDTH, startW + delta) }));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Column hide/show
  const toggleColumnVisibility = (col) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
    setColMenuOpen(null);
  };

  // Find & Replace
  useEffect(() => {
    if (!findText) { setFindMatches([]); setFindIdx(-1); return; }
    const ft = findText.toLowerCase();
    const matches = [];
    for (let ri = 0; ri < sortedRows.length; ri++) {
      for (let ci = 0; ci < visibleFields.length; ci++) {
        if (String(sortedRows[ri][visibleFields[ci]] ?? '').toLowerCase().includes(ft)) {
          matches.push({ rowId: sortedRows[ri].id, colIdx: ci, rowIdx: ri });
        }
      }
    }
    setFindMatches(matches);
    setFindIdx(matches.length > 0 ? 0 : -1);
  }, [findText, sortedRows, visibleFields]);

  const findNext = () => {
    if (findMatches.length === 0) return;
    const next = (findIdx + 1) % findMatches.length;
    setFindIdx(next);
    setActiveCell({ rowId: findMatches[next].rowId, colIdx: findMatches[next].colIdx });
  };
  const findPrev = () => {
    if (findMatches.length === 0) return;
    const prev = (findIdx - 1 + findMatches.length) % findMatches.length;
    setFindIdx(prev);
    setActiveCell({ rowId: findMatches[prev].rowId, colIdx: findMatches[prev].colIdx });
  };
  const replaceOne = async () => {
    if (findIdx < 0 || !findMatches[findIdx]) return;
    const m = findMatches[findIdx];
    const row = rows.find(r => r.id === m.rowId);
    const field = visibleFields[m.colIdx];
    const oldVal = String(row[field] ?? '');
    const newVal = oldVal.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), replaceText);
    await commitCellChange(row.id, field, newVal, row[field]);
  };
  const replaceAll = async () => {
    for (const m of findMatches) {
      const row = rows.find(r => r.id === m.rowId);
      const field = visibleFields[m.colIdx];
      const oldVal = String(row[field] ?? '');
      const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const newVal = oldVal.replace(re, replaceText);
      if (newVal !== oldVal) await commitCellChange(row.id, field, newVal, row[field]);
    }
  };

  const sourceDot = (row) => {
    let cls = 'user', label = 'Y';
    if (row.is_dummy) { cls = 'dummy'; label = 'S'; }
    else if (row.source && row.source.startsWith('upload:')) { cls = 'upload'; label = 'U'; }
    return <span className={`te-source-dot ${cls}`} title={row.source}>{label}</span>;
  };

  const isFindMatch = (rowId, colIdx) => {
    return findMatches.some(m => m.rowId === rowId && m.colIdx === colIdx);
  };

  return (
    <>
      <div className="workspace-toolbar">
        <input
          className="filter-input"
          placeholder="Filter rows..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button className="btn" onClick={handleAddRow}>+ Add row</button>
        <button className="btn" disabled={selectedIds.size === 0} onClick={handleDelete}>
          Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
        </button>
        <button className="btn" disabled={selectedIds.size === 0} onClick={handleDuplicate}>
          Duplicate
        </button>
        <button className="btn" onClick={() => setShowFindReplace(s => !s)} title="Find & Replace (Ctrl+F)">
          <Search size={13} /> Find
        </button>
        {hiddenCols.size > 0 && (
          <button className="btn" onClick={() => setHiddenCols(new Set())}>
            Show all columns ({hiddenCols.size} hidden)
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
          {filteredRows.length} of {total} rows
          {sortField && ` | sorted by ${sortField} ${sortDir}`}
          {undoStack.length > 0 && ` | ${undoStack.length} undo`}
        </span>
      </div>

      {showFindReplace && (
        <div className="find-replace-bar">
          <input
            autoFocus
            placeholder="Find..."
            value={findText}
            onChange={e => setFindText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') setShowFindReplace(false); }}
          />
          <input
            placeholder="Replace..."
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
          />
          <span style={{ fontSize: 11, color: 'var(--c-text-muted)', minWidth: 60 }}>
            {findMatches.length > 0 ? `${findIdx + 1}/${findMatches.length}` : 'No matches'}
          </span>
          <button className="btn btn-sm" onClick={findPrev} disabled={findMatches.length === 0}>Prev</button>
          <button className="btn btn-sm" onClick={findNext} disabled={findMatches.length === 0}>Next</button>
          <button className="btn btn-sm" onClick={replaceOne} disabled={findIdx < 0}>Replace</button>
          <button className="btn btn-sm" onClick={replaceAll} disabled={findMatches.length === 0}>All</button>
          <button className="btn btn-sm" onClick={() => { setShowFindReplace(false); setFindText(''); setReplaceText(''); }}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="te-container" ref={containerRef} onScroll={handleScroll} tabIndex={0}>
        {loading ? (
          <div className="loading-page"><span className="spinner-inline" /> &nbsp; Loading rows...</div>
        ) : (
          <div style={{ minWidth: 'max-content', position: 'relative' }}>
            {/* Header row */}
            <div
              style={{
                display: 'grid', gridTemplateColumns: gridTemplate,
                position: 'sticky', top: 0, zIndex: 3, background: '#f9fafb', height: HEADER_HEIGHT,
              }}
            >
              {allColumns.map((col, ci) => {
                if (col === '__source__') {
                  return <div key={col} className="te-header-cell" style={{ background: '#f9fafb', position: 'sticky', left: 0, zIndex: 4 }}></div>;
                }
                const def = schema.fields.find(f => f.name === col);
                return (
                  <div
                    key={col}
                    className="te-header-cell"
                    onClick={() => handleSort(col)}
                    onContextMenu={(e) => { e.preventDefault(); setColMenuOpen(colMenuOpen === col ? null : col); }}
                    style={{ position: 'relative' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{col}</span>
                    {def?.required && <span className="req">*</span>}
                    <span className="type-tag">{def?.type}</span>
                    {sortField === col && <span style={{ marginLeft: 'auto', fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    {/* Resize handle */}
                    <div
                      className="col-resize-handle"
                      onMouseDown={(e) => startResize(col, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {/* Column context menu */}
                    {colMenuOpen === col && (
                      <div className="col-context-menu" onClick={e => e.stopPropagation()}>
                        <div onClick={() => { handleSort(col); setColMenuOpen(null); }}>Sort {sortDir === 'asc' && sortField === col ? 'descending' : 'ascending'}</div>
                        <div onClick={() => toggleColumnVisibility(col)}>Hide column</div>
                        <div onClick={() => setColMenuOpen(null)}>Cancel</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Scroll spacer + visible rows */}
            <div style={{ height: totalRowsHeight, position: 'relative' }}>
              <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
                {visibleRows.map(row => {
                  const isSel = selectedIds.has(row.id);
                  const rowBg = isSel ? 'var(--c-row-selected)' : row.is_dummy ? 'var(--c-row-dummy)' : 'var(--c-row-user)';
                  return (
                    <div
                      key={row.id}
                      style={{
                        display: 'grid', gridTemplateColumns: gridTemplate,
                        height: ROW_HEIGHT, background: rowBg,
                      }}
                      onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--c-row-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}
                    >
                      {allColumns.map((col, ci) => {
                        if (col === '__source__') {
                          return (
                            <div
                              key={col}
                              className="te-cell"
                              onClick={(e) => toggleSelect(row.id, e)}
                              style={{ justifyContent: 'center', cursor: 'pointer', position: 'sticky', left: 0, zIndex: 1, background: 'inherit' }}
                            >
                              {sourceDot(row)}
                            </div>
                          );
                        }
                        const fieldIdx = ci - 1; // -1 for __source__
                        const isEditing = editing?.rowId === row.id && editing.field === col;
                        const isActive = activeCell?.rowId === row.id && activeCell?.colIdx === fieldIdx;
                        const isMatch = isFindMatch(row.id, fieldIdx);
                        return (
                          <div
                            key={col}
                            className={
                              'te-cell' +
                              (isEditing ? ' te-cell-edit' : '') +
                              (isActive ? ' te-cell-active' : '') +
                              (isMatch ? ' te-cell-match' : '')
                            }
                            onClick={() => setActiveCell({ rowId: row.id, colIdx: fieldIdx })}
                            onDoubleClick={() => startEdit(row, col)}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                className="te-cell-input"
                                value={editing.value ?? ''}
                                onChange={e => setEditing({ ...editing, value: e.target.value })}
                                onBlur={commitEdit}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitEdit();
                                  if (e.key === 'Escape') setEditing(null);
                                  if (e.key === 'Tab') {
                                    e.preventDefault();
                                    commitEdit();
                                    navigateCell(
                                      sortedRows.findIndex(r => r.id === row.id),
                                      e.shiftKey ? fieldIdx - 1 : fieldIdx + 1
                                    );
                                  }
                                }}
                              />
                            ) : (
                              <span
                                title={String(row[col] ?? '')}
                                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {formatCell(row[col])}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function formatCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) >= 1000) return v.toLocaleString();
    if (!Number.isInteger(v)) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return String(v);
  }
  return String(v);
}

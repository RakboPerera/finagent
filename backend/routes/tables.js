// backend/routes/tables.js
import { Router } from 'express';
import { CANONICAL_SCHEMAS, getCanonicalTableNames, getAllColumns } from '../schema.js';

export function createTablesRouter(db) {
  const router = Router();

  // List all tables with metadata
  router.get('/', (req, res) => {
    const out = [];
    for (const name of getCanonicalTableNames()) {
      const total = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
      const dummy = db.prepare(`SELECT COUNT(*) AS c FROM ${name} WHERE is_dummy = 1`).get().c;
      const user = db.prepare(`SELECT COUNT(*) AS c FROM ${name} WHERE is_dummy = 0`).get().c;
      const lastRow = db.prepare(`SELECT MAX(updated_at) AS u FROM ${name}`).get();
      const issuesRow = db.prepare(`SELECT COUNT(*) AS c FROM data_quality_issues WHERE table_name = ? AND resolved = 0`).get(name);
      out.push({
        name,
        label: CANONICAL_SCHEMAS[name].label,
        description: CANONICAL_SCHEMAS[name].description,
        row_count: total,
        dummy_count: dummy,
        user_count: user,
        last_updated: lastRow.u,
        open_issues: issuesRow.c,
        has_dummy: dummy > 0,
      });
    }
    res.json(out);
  });

  // Get table schema
  router.get('/:name/schema', (req, res) => {
    const def = CANONICAL_SCHEMAS[req.params.name];
    if (!def) return res.status(404).json({ error: 'Unknown table' });
    res.json({ name: req.params.name, ...def });
  });

  // Get rows (paginated)
  router.get('/:name/rows', (req, res) => {
    const name = req.params.name;
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
    const rows = db.prepare(`SELECT * FROM ${name} ORDER BY id LIMIT ? OFFSET ?`).all(limit, offset);
    res.json({ rows, total, limit, offset });
  });

  // Update single cell
  router.patch('/:name/rows/:id', (req, res) => {
    const name = req.params.name;
    const id = parseInt(req.params.id, 10);
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const updates = req.body || {};
    const def = CANONICAL_SCHEMAS[name];
    const allowedFields = new Set(def.fields.map(f => f.name));
    const sets = [];
    const params = [];
    const oldRow = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    if (!oldRow) return res.status(404).json({ error: 'Row not found' });
    for (const [k, v] of Object.entries(updates)) {
      if (!allowedFields.has(k)) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields' });
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    sets.push(`updated_by = ?`);
    params.push('user');
    params.push(id);
    db.prepare(`UPDATE ${name} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    db.prepare(`INSERT INTO audit_log (table_name, row_id, action, old_value_json, new_value_json, actor)
      VALUES (?, ?, 'update', ?, ?, ?)`).run(name, id, JSON.stringify(oldRow), JSON.stringify(updates), 'user');
    const newRow = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    res.json(newRow);
  });

  // Add row
  router.post('/:name/rows', (req, res) => {
    const name = req.params.name;
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const def = CANONICAL_SCHEMAS[name];
    const body = req.body || {};
    const fieldNames = def.fields.map(f => f.name);
    const sysCols = ['client_id', 'source', 'created_by', 'updated_by', 'confidence', 'is_dummy'];
    const placeholders = fieldNames.map(() => '?').join(', ');
    const sql = `INSERT INTO ${name} (${sysCols.join(', ')}, ${fieldNames.join(', ')})
                 VALUES ('default', 'manual', 'user', 'user', 100, 0, ${placeholders})`;
    const vals = fieldNames.map(f => body[f] ?? null);
    const result = db.prepare(sql).run(...vals);
    const newRow = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(result.lastInsertRowid);
    db.prepare(`INSERT INTO audit_log (table_name, row_id, action, new_value_json, actor)
      VALUES (?, ?, 'insert', ?, 'user')`).run(name, result.lastInsertRowid, JSON.stringify(newRow));
    res.json(newRow);
  });

  // Delete rows (single or bulk)
  router.delete('/:name/rows', (req, res) => {
    const name = req.params.name;
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const ids = req.body?.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No ids provided' });
    let deleted = 0;
    db.transaction(() => {
      for (const id of ids) {
        const old = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
        if (!old) continue;
        db.prepare(`DELETE FROM ${name} WHERE id = ?`).run(id);
        db.prepare(`INSERT INTO audit_log (table_name, row_id, action, old_value_json, actor)
          VALUES (?, ?, 'delete', ?, 'user')`).run(name, id, JSON.stringify(old));
        deleted++;
      }
    });
    res.json({ deleted });
  });

  // Clear all sample data for one table
  router.post('/:name/clear-sample-data', (req, res) => {
    const name = req.params.name;
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const result = db.prepare(`DELETE FROM ${name} WHERE is_dummy = 1`).run();
    db.prepare(`INSERT INTO audit_log (table_name, action, new_value_json, actor)
      VALUES (?, 'clear_sample_data', ?, 'user')`).run(name, JSON.stringify({ deleted: result.changes }));
    res.json({ deleted: result.changes });
  });

  // Get data quality issues for a table
  router.get('/:name/issues', (req, res) => {
    const name = req.params.name;
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const resolved = req.query.resolved === 'true';
    const issues = db.prepare(
      `SELECT * FROM data_quality_issues WHERE table_name = ? AND resolved = ? ORDER BY severity DESC, id DESC LIMIT 200`
    ).all(name, resolved ? 1 : 0);
    res.json(issues);
  });

  // Get row detail with audit history
  router.get('/:name/rows/:id/detail', (req, res) => {
    const name = req.params.name;
    const id = parseInt(req.params.id, 10);
    if (!CANONICAL_SCHEMAS[name]) return res.status(404).json({ error: 'Unknown table' });
    const row = db.prepare(`SELECT * FROM ${name} WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'Row not found' });
    const auditHistory = db.prepare(
      `SELECT * FROM audit_log WHERE table_name = ? AND row_id = ? ORDER BY id DESC LIMIT 20`
    ).all(name, id);
    const issues = db.prepare(
      `SELECT * FROM data_quality_issues WHERE table_name = ? AND row_id = ? ORDER BY id DESC`
    ).all(name, id);
    res.json({ row, audit_history: auditHistory, issues });
  });

  // Get upload jobs list
  router.get('/upload-history', (req, res) => {
    const jobs = db.prepare(`SELECT * FROM upload_jobs ORDER BY created_at DESC LIMIT 50`).all();
    const parsed = jobs.map(j => ({
      ...j,
      parsed_json: j.parsed_json ? JSON.parse(j.parsed_json) : null,
      classification_json: j.classification_json ? JSON.parse(j.classification_json) : null,
      load_result_json: j.load_result_json ? JSON.parse(j.load_result_json) : null,
    }));
    res.json(parsed);
  });

  // Clear ALL sample data across all tables
  router.post('/clear-all-sample-data', (req, res) => {
    const results = {};
    db.transaction(() => {
      for (const name of getCanonicalTableNames()) {
        const result = db.prepare(`DELETE FROM ${name} WHERE is_dummy = 1`).run();
        results[name] = result.changes;
      }
    });
    res.json(results);
  });

  return router;
}

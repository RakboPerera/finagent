// backend/agents/ingestion/loader.js
// Agent 6: Loader. Transactional writes + audit log + saves mapping memory.
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { CANONICAL_SCHEMAS } from '../../schema.js';

export function load({
  db, targetTable, sourceLabel, mappingUsed,
  newRows, conflictResolutions = {}, // { row_index: 'overwrite' | 'skip' | 'use_new' }
  conflicts = [],
  jobId,
}) {
  const def = CANONICAL_SCHEMAS[targetTable];
  if (!def) return { error: `Unknown table: ${targetTable}` };

  const fieldNames = def.fields.map(f => f.name);
  const placeholders = fieldNames.map(() => '?').join(', ');
  const sysCols = ['client_id', 'source', 'source_row_ref', 'created_by', 'updated_by', 'confidence', 'is_dummy'];

  let inserted = 0;
  let overwritten = 0;
  let skipped = 0;

  db.transaction(() => {
    const insertSql = `INSERT INTO ${targetTable}
      (${sysCols.join(', ')}, ${fieldNames.join(', ')})
      VALUES (?, ?, ?, ?, ?, ?, ?, ${placeholders})`;
    const insStmt = db.prepare(insertSql);

    // Insert new rows
    for (const nr of newRows) {
      const row = nr.row;
      const vals = fieldNames.map(f => row[f] ?? null);
      const sourceRowRef = row._source_row_ref || null;
      insStmt.run('default', sourceLabel, sourceRowRef, 'upload', 'upload', 90, 0, ...vals);
      inserted++;
    }

    // Handle conflicts per resolution
    for (const c of conflicts) {
      const resolution = conflictResolutions[c.row_index] || 'skip';
      if (resolution === 'skip') { skipped++; continue; }
      if (resolution === 'use_new' || resolution === 'overwrite') {
        // Delete existing row(s), then insert new
        const conflictKeys = Object.entries(c.conflict_keys);
        const where = conflictKeys.map(([k]) => `${k} = ?`).join(' AND ');
        const params = conflictKeys.map(([, v]) => v);
        const existingRows = db.prepare(`SELECT * FROM ${targetTable} WHERE ${where}`).all(...params);
        for (const er of existingRows) {
          db.prepare(`DELETE FROM ${targetTable} WHERE id = ?`).run(er.id);
          // Audit log: deletion
          db.prepare(`INSERT INTO audit_log (table_name, row_id, action, old_value_json, actor)
            VALUES (?, ?, 'delete_for_overwrite', ?, ?)`).run(targetTable, er.id, JSON.stringify(er), 'upload');
        }
        const row = c.new_row;
        const vals = fieldNames.map(f => row[f] ?? null);
        const sourceRowRef = row._source_row_ref || null;
        insStmt.run('default', sourceLabel, sourceRowRef, 'upload', 'upload', 90, 0, ...vals);
        overwritten++;
      }
    }

    // Save the mapping to schema_mappings for future use — but only if something was actually loaded.
    // This keeps mapping memory from getting polluted by failed/rejected uploads.
    if (mappingUsed && (inserted + overwritten) > 0) {
      const sourceSig = computeSourceSignature(mappingUsed.column_mappings.map(m => m.source_column));
      const existing = db.prepare(`SELECT id, use_count FROM schema_mappings WHERE target_table = ? AND source_signature = ?`)
        .get(targetTable, sourceSig);
      if (existing) {
        db.prepare(`UPDATE schema_mappings SET use_count = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(existing.use_count + 1, existing.id);
      } else {
        db.prepare(`INSERT INTO schema_mappings (target_table, source_signature, mapping_json) VALUES (?, ?, ?)`)
          .run(targetTable, sourceSig, JSON.stringify(mappingUsed));
      }
    }

    // Audit log entry for the load
    db.prepare(`INSERT INTO audit_log (table_name, action, new_value_json, actor)
      VALUES (?, ?, ?, ?)`).run(
      targetTable, 'bulk_load',
      JSON.stringify({ job_id: jobId, source: sourceLabel, inserted, overwritten, skipped }),
      'upload'
    );
  });

  return { inserted, overwritten, skipped, target_table: targetTable };
}

function computeSourceSignature(columns) {
  const sorted = [...columns].map(c => String(c).trim().toLowerCase()).sort();
  return crypto.createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 16);
}

export function lookupPriorMappings(db, targetTable, sourceColumns) {
  const sourceSig = computeSourceSignature(sourceColumns);
  const exact = db.prepare(`SELECT * FROM schema_mappings WHERE target_table = ? AND source_signature = ? ORDER BY use_count DESC LIMIT 1`)
    .get(targetTable, sourceSig);
  if (exact) return [{ ...exact, mapping_json: JSON.parse(exact.mapping_json), source_signature: exact.source_signature, exact: true }];
  // Otherwise, return recent for this table
  const recent = db.prepare(`SELECT * FROM schema_mappings WHERE target_table = ? ORDER BY last_used_at DESC LIMIT 3`).all(targetTable);
  return recent.map(r => ({ ...r, mapping_json: JSON.parse(r.mapping_json) }));
}

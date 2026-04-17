// backend/jobs/queue.js
// In-process job queue. Tracks status in upload_jobs table; runner is a setInterval.

import { v4 as uuidv4 } from 'uuid';
import { parseFile } from '../agents/ingestion/parser.js';
import { classifySheets } from '../agents/ingestion/classifier.js';
import { proposeMapping, applyMapping } from '../agents/ingestion/mapper.js';
import { validate } from '../agents/ingestion/validator.js';
import { reconcile } from '../agents/ingestion/reconciler.js';
import { load, lookupPriorMappings } from '../agents/ingestion/loader.js';
import { generateInsights } from '../agents/insights/index.js';

// Standard pipeline stages
const STAGES = ['parsing', 'classifying', 'mapping_proposed', 'awaiting_mapping_confirm',
                'validating', 'awaiting_validation_review', 'reconciling',
                'awaiting_conflict_resolution', 'loading', 'done', 'error'];

class JobQueue {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.running = false;
    this.providerKeyCache = new Map(); // jobId → { provider, apiKey }
  }

  createJob({ filename, filePath, targetTableHint, provider, apiKey }) {
    const id = uuidv4();
    const stages = STAGES.map(s => ({ name: s, status: 'pending' }));
    stages[0].status = 'queued';
    this.db.prepare(`INSERT INTO upload_jobs
      (id, filename, file_path, status, current_stage, stages_json, target_table_hint)
      VALUES (?, ?, ?, 'queued', 'parsing', ?, ?)`)
      .run(id, filename, filePath, JSON.stringify(stages), targetTableHint || null);
    this.providerKeyCache.set(id, { provider, apiKey });
    this.queue.push(id);
    if (!this.running) this._runNext();
    return id;
  }

  getJob(id) {
    const row = this.db.prepare(`SELECT * FROM upload_jobs WHERE id = ?`).get(id);
    if (!row) return null;
    return {
      ...row,
      stages_json: row.stages_json ? JSON.parse(row.stages_json) : [],
      parsed_json: row.parsed_json ? JSON.parse(row.parsed_json) : null,
      classification_json: row.classification_json ? JSON.parse(row.classification_json) : null,
      mapping_json: row.mapping_json ? JSON.parse(row.mapping_json) : null,
      validation_json: row.validation_json ? JSON.parse(row.validation_json) : null,
      reconciliation_json: row.reconciliation_json ? JSON.parse(row.reconciliation_json) : null,
      load_result_json: row.load_result_json ? JSON.parse(row.load_result_json) : null,
    };
  }

  listJobs(limit = 20) {
    const rows = this.db.prepare(`SELECT id, filename, status, current_stage, created_at, updated_at FROM upload_jobs ORDER BY created_at DESC LIMIT ?`).all(limit);
    return rows;
  }

  _updateStage(jobId, stageName, status, extras = {}) {
    const job = this.getJob(jobId);
    if (!job) return;
    const stages = job.stages_json;
    const idx = stages.findIndex(s => s.name === stageName);
    if (idx >= 0) stages[idx].status = status;
    const sets = ['stages_json = ?', 'current_stage = ?', 'status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [JSON.stringify(stages), stageName, status === 'awaiting_user' ? 'awaiting_user' : (status === 'error' ? 'error' : (stageName === 'done' ? 'done' : 'running'))];
    for (const [k, v] of Object.entries(extras)) {
      sets.push(`${k} = ?`);
      params.push(typeof v === 'string' ? v : JSON.stringify(v));
    }
    params.push(jobId);
    this.db.prepare(`UPDATE upload_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  async _runNext() {
    if (this.running) return;
    if (this.queue.length === 0) return;
    this.running = true;
    const jobId = this.queue.shift();
    try {
      await this._processJob(jobId);
    } catch (e) {
      console.error(`[job ${jobId}] crashed:`, e);
      this._updateStage(jobId, 'error', 'error', { error: e.message });
    } finally {
      this.running = false;
      if (this.queue.length > 0) setImmediate(() => this._runNext());
    }
  }

  async _processJob(jobId) {
    const job = this.getJob(jobId);
    const { provider, apiKey } = this.providerKeyCache.get(jobId) || {};

    // STAGE 1: Parse
    this._updateStage(jobId, 'parsing', 'running');
    const parsed = await parseFile(job.file_path, job.filename);
    if (parsed.errors.length && parsed.data_sheet_count === 0) {
      this._updateStage(jobId, 'error', 'error', { error: parsed.errors.join('; '), parsed_json: parsed });
      return;
    }
    this._updateStage(jobId, 'parsing', 'done', { parsed_json: parsed });

    // STAGE 2: Classify
    this._updateStage(jobId, 'classifying', 'running');
    const classification = await classifySheets({ provider, apiKey, parsedFile: parsed, targetTableHint: job.target_table_hint });
    this._updateStage(jobId, 'classifying', 'done', { classification_json: classification });

    // STAGE 3: Propose mapping for each non-ignored sheet (in parallel)
    this._updateStage(jobId, 'mapping_proposed', 'running');
    const mappingsPerSheet = {};
    const classifications = classification.classifications || [];
    const mappingPromises = classifications
      .filter(c => c.target_table && c.target_table !== 'ignore')
      .map(async (c) => {
        const sheet = parsed.sheets.find(s => s.name === c.sheet_name);
        if (!sheet || sheet.row_count === 0) return null;
        const priors = lookupPriorMappings(this.db, c.target_table, sheet.headers);
        // If we have an EXACT match on the source header signature, reuse the prior
        // mapping directly — skip the LLM call entirely. This is the real payoff of mapping memory.
        const exactPrior = priors.find(p => p.exact);
        if (exactPrior) {
          return {
            sheet_name: c.sheet_name, target_table: c.target_table,
            proposal: {
              ...exactPrior.mapping_json,
              auto_applied: true,
              auto_applied_source: `Reused from a prior upload (used ${exactPrior.use_count}× before).`,
              overall_confidence: 100,
              latency_ms: 0,
            },
          };
        }
        const proposal = await proposeMapping({ provider, apiKey, sheet, targetTable: c.target_table, priorMappings: priors });
        return { sheet_name: c.sheet_name, target_table: c.target_table, proposal };
      });
    const settled = await Promise.all(mappingPromises);
    for (const r of settled) {
      if (r) mappingsPerSheet[r.sheet_name] = r;
    }
    this._updateStage(jobId, 'mapping_proposed', 'done', { mapping_json: { proposals: mappingsPerSheet } });

    // PAUSE here for user to confirm mapping. The user will POST /api/upload-jobs/:id/confirm-mapping
    this._updateStage(jobId, 'awaiting_mapping_confirm', 'awaiting_user');
  }

  // Called when user confirms the mapping → continue with validation, reconciliation, loading
  async continueAfterMapping(jobId, confirmedMappings) {
    const job = this.getJob(jobId);
    const { provider, apiKey } = this.providerKeyCache.get(jobId) || {};
    if (!job) throw new Error('Job not found');
    const parsed = job.parsed_json;
    if (!parsed) throw new Error('No parsed data');

    this._updateStage(jobId, 'awaiting_mapping_confirm', 'done', { mapping_json: { confirmed: confirmedMappings } });

    // STAGE 4: Validate each confirmed sheet
    this._updateStage(jobId, 'validating', 'running');
    const validationResults = {};
    for (const [sheetName, mapping] of Object.entries(confirmedMappings)) {
      const sheet = parsed.sheets.find(s => s.name === sheetName);
      if (!sheet) continue;
      const { rows: mappedRows, errors: mapErrors } = applyMapping({ sheet, mapping });
      const validation = await validate({ db: this.db, provider, apiKey, targetTable: mapping.target_table, mappedRows });
      validation.mapping_errors = mapErrors;
      validationResults[sheetName] = { target_table: mapping.target_table, validation };
    }
    this._updateStage(jobId, 'validating', 'done', { validation_json: validationResults });

    // STAGE 5: Reconcile
    this._updateStage(jobId, 'reconciling', 'running');
    const reconciliations = {};
    for (const [sheetName, vres] of Object.entries(validationResults)) {
      const recon = reconcile({ db: this.db, targetTable: vres.target_table, validatedRows: vres.validation.rows });
      reconciliations[sheetName] = { target_table: vres.target_table, reconciliation: recon };
    }
    this._updateStage(jobId, 'reconciling', 'done', { reconciliation_json: reconciliations });

    // If any conflicts, await user; otherwise auto-load
    const totalConflicts = Object.values(reconciliations).reduce((sum, r) => sum + (r.reconciliation.conflicts_count || 0), 0);
    if (totalConflicts > 0) {
      this._updateStage(jobId, 'awaiting_conflict_resolution', 'awaiting_user');
      return { awaiting: 'conflicts', total_conflicts: totalConflicts };
    }
    return await this.continueAfterReconciliation(jobId, {});
  }

  async continueAfterReconciliation(jobId, resolutions) {
    // resolutions: { sheetName: { row_index: 'overwrite'|'skip'|'use_new' } }
    const job = this.getJob(jobId);
    if (!job) throw new Error('Job not found');
    const reconciliations = job.reconciliation_json;
    const mappingData = job.mapping_json;
    const confirmedMappings = mappingData.confirmed || {};

    this._updateStage(jobId, 'loading', 'running');
    const loadResults = {};
    for (const [sheetName, recon] of Object.entries(reconciliations)) {
      const conflicts = recon.reconciliation.conflicts || [];
      const newRows = recon.reconciliation.new_rows || [];
      const result = load({
        db: this.db,
        targetTable: recon.target_table,
        sourceLabel: `upload:${job.filename}`,
        mappingUsed: confirmedMappings[sheetName],
        newRows,
        conflicts,
        conflictResolutions: (resolutions || {})[sheetName] || {},
        jobId,
      });
      loadResults[sheetName] = result;
    }
    this._updateStage(jobId, 'loading', 'done', { load_result_json: loadResults });
    this._updateStage(jobId, 'done', 'done');

    // Auto-regenerate dashboard insights in the background (fire-and-forget).
    // The upload loaded new data, so stale insights would be misleading.
    const totalInserted = Object.values(loadResults).reduce((a, r) => a + (r.inserted || 0) + (r.overwritten || 0), 0);
    if (totalInserted > 0) {
      const { provider, apiKey } = this.providerKeyCache.get(jobId) || {};
      if (apiKey) {
        generateInsights({ db: this.db, provider, apiKey })
          .then(r => console.log(`[job ${jobId}] auto-regenerated ${r.inserted ?? 0} insights from ${r.signals_count ?? 0} signals.`))
          .catch(e => console.error(`[job ${jobId}] insight regen failed:`, e.message));
      }
    }

    return { ok: true, load_results: loadResults };
  }
}

let _instance = null;
export function getJobQueue(db) {
  if (!_instance) _instance = new JobQueue(db);
  return _instance;
}

// backend/routes/uploads.js
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getJobQueue } from '../jobs/queue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: STORAGE_DIR,
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

export function createUploadsRouter(db) {
  const router = Router();
  const queue = getJobQueue(db);

  router.post('/', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const provider = req.headers['x-llm-provider'] || 'anthropic';
    const apiKey = req.headers['x-llm-api-key'];
    if (!apiKey) {
      // Allow upload but warn — ingestion needs key
      return res.status(400).json({ error: 'No LLM API key provided. Set one in Settings before uploading.' });
    }
    const targetTableHint = req.body.targetTable || null;
    const jobId = queue.createJob({
      filename: req.file.originalname,
      filePath: req.file.path,
      targetTableHint,
      provider, apiKey,
    });
    res.json({ job_id: jobId });
  });

  // Get a single job's full state (for polling)
  router.get('/jobs/:id', (req, res) => {
    const job = queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  router.get('/jobs', (req, res) => {
    res.json(queue.listJobs(parseInt(req.query.limit, 10) || 20));
  });

  // User confirms mapping → continue pipeline
  router.post('/jobs/:id/confirm-mapping', async (req, res) => {
    const { confirmed_mappings } = req.body;
    if (!confirmed_mappings) return res.status(400).json({ error: 'confirmed_mappings required' });
    try {
      const result = await queue.continueAfterMapping(req.params.id, confirmed_mappings);
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // User resolves conflicts → continue
  router.post('/jobs/:id/resolve-conflicts', async (req, res) => {
    const { resolutions } = req.body;
    try {
      const result = await queue.continueAfterReconciliation(req.params.id, resolutions || {});
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

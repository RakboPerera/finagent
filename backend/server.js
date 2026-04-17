// backend/server.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import { ensureSchema } from './schema.js';
import { seedDummyData } from './seed.js';
import { createTablesRouter } from './routes/tables.js';
import { createUploadsRouter } from './routes/uploads.js';
import { createChatRouter, createSettingsRouter, createDashboardRouter } from './routes/chat.js';
import { createDownloadsRouter } from './routes/downloads.js';
import { getCanonicalTableNames } from './schema.js';
import { seedDemoContent } from './seed.js';
import { Router as ExpressRouter } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file if present (simple key=value parser, no dependency)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Simple rate limiter: per-IP, max requests per window
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute for LLM endpoints
function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before trying again.' });
  }
  next();
}

async function main() {
  // Warn if running from a OneDrive-synced path — sql.js writes can hit "Access denied" there.
  if (/OneDrive|SharePoint/i.test(__dirname)) {
    console.warn('[finagent] WARNING: running from a OneDrive/SharePoint path. SQLite writes may intermittently fail with EACCES.');
    console.warn('[finagent]          If you see "Access is denied" errors on upload/save, copy the project to a local path (e.g. C:\\finagent\\).');
  }
  const app = express();
  const PORT = process.env.PORT || 8000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Init DB
  const db = await getDb();
  await ensureSchema(db);
  await seedDummyData(db);

  // Health
  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'finagent', ts: new Date().toISOString() }));

  // Optional env-key fallback — DISABLED by default. Users should supply their own
  // key via the Settings UI (stored in browser localStorage, sent per-request via
  // the x-llm-api-key header). To enable server-side fallback for a single-user
  // deployment, set ALLOW_SERVER_API_KEY=true AND LLM_API_KEY=sk-... in .env.
  const SERVER_KEY_FALLBACK = process.env.ALLOW_SERVER_API_KEY === 'true';
  if (SERVER_KEY_FALLBACK && process.env.LLM_API_KEY) {
    console.warn('[finagent] WARNING: ALLOW_SERVER_API_KEY=true — server-side LLM key fallback is ENABLED.');
    console.warn('[finagent]          Any /api request without x-llm-api-key will use the server key. Do NOT enable this in multi-user deployments.');
    app.use('/api', (req, res, next) => {
      if (!req.headers['x-llm-api-key']) {
        req.headers['x-llm-api-key'] = process.env.LLM_API_KEY;
        if (!req.headers['x-llm-provider']) {
          req.headers['x-llm-provider'] = process.env.LLM_PROVIDER || 'anthropic';
        }
      }
      next();
    });
  }

  // Routes
  app.use('/api/tables', createTablesRouter(db));
  app.use('/api/tables', createDownloadsRouter(db));
  app.use('/api/uploads', rateLimiter, createUploadsRouter(db));
  app.use('/api/chat', rateLimiter, createChatRouter(db));
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/dashboard', createDashboardRouter(db));
  app.use('/api/admin', createAdminRouter(db));

  // Serve frontend build in production
  const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[express error]', err);
    res.status(500).json({ error: err.message });
  });

  app.listen(PORT, () => {
    console.log(`[finagent] running on http://localhost:${PORT}`);
  });
}

main().catch(e => { console.error('[boot error]', e); process.exit(1); });

// Admin router — demo reset and other housekeeping
function createAdminRouter(db) {
  const router = ExpressRouter();

  router.post('/reset-demo', async (req, res) => {
    try {
      db.transaction(() => {
        // Wipe canonical tables
        for (const t of getCanonicalTableNames()) {
          db.prepare(`DELETE FROM ${t}`).run();
        }
        // Wipe platform tables that hold runtime state
        db.prepare(`DELETE FROM chat_messages`).run();
        db.prepare(`DELETE FROM chat_conversations`).run();
        db.prepare(`DELETE FROM tool_call_log`).run();
        db.prepare(`DELETE FROM data_quality_issues`).run();
        db.prepare(`DELETE FROM audit_log`).run();
        db.prepare(`DELETE FROM upload_jobs`).run();
        db.prepare(`DELETE FROM schema_mappings`).run();
        db.prepare(`DELETE FROM dashboard_insights`).run();
      });
      // Re-seed canonical data + demo content
      const { seedDummyData } = await import('./seed.js');
      await seedDummyData(db);
      seedDemoContent(db);
      res.json({ ok: true, message: 'Demo data reset successfully.' });
    } catch (e) {
      console.error('[admin/reset-demo] failed:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

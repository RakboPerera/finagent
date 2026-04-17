// backend/database.js
// sql.js wrapper. Async init (loads WASM), auto-saves to disk after every write.
// Provides better-sqlite3-style API: db.prepare(sql).run/get/all
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'finagent.db');

let _db = null;
let _wrapper = null;
let _saveTimer = null;

function debouncedSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      const buf = Buffer.from(_db.export());
      fs.writeFileSync(DB_PATH, buf);
    } catch (e) {
      console.error('[db] save failed:', e.message);
    }
  }, 100);
}

class PreparedStatement {
  constructor(sql) {
    this.sql = sql;
  }

  run(...params) {
    const stmt = _db.prepare(this.sql);
    try {
      stmt.bind(this._flatten(params));
      stmt.step();
      // Capture lastInsertRowid IMMEDIATELY before any other write
      const lastRow = _db.exec('SELECT last_insert_rowid() AS id')[0];
      const lastInsertRowid = lastRow ? lastRow.values[0][0] : null;
      const changesRow = _db.exec('SELECT changes() AS c')[0];
      const changes = changesRow ? changesRow.values[0][0] : 0;
      debouncedSave();
      return { lastInsertRowid, changes };
    } finally {
      stmt.free();
    }
  }

  get(...params) {
    const stmt = _db.prepare(this.sql);
    try {
      stmt.bind(this._flatten(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    const stmt = _db.prepare(this.sql);
    const rows = [];
    try {
      stmt.bind(this._flatten(params));
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  _flatten(params) {
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
      return params[0]; // named params object
    }
    return params;
  }
}

function makeWrapper() {
  return {
    prepare: (sql) => new PreparedStatement(sql),
    exec: (sql) => {
      _db.exec(sql);
      debouncedSave();
    },
    transaction: (fn) => {
      _db.exec('BEGIN');
      try {
        const result = fn();
        _db.exec('COMMIT');
        debouncedSave();
        return result;
      } catch (e) {
        _db.exec('ROLLBACK');
        throw e;
      }
    },
    save: () => {
      const buf = Buffer.from(_db.export());
      fs.writeFileSync(DB_PATH, buf);
    },
    raw: () => _db,
  };
}

export async function getDb() {
  if (_wrapper) return _wrapper;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const SQL = await initSqlJs({
    // sql.js loads its wasm from node_modules at runtime
    locateFile: (file) => {
      const sqlJsDir = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
      return path.join(sqlJsDir, file);
    },
  });

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(new Uint8Array(buf));
    console.log(`[db] loaded existing db from ${DB_PATH}`);
  } else {
    _db = new SQL.Database();
    console.log(`[db] created new in-memory db (will persist to ${DB_PATH})`);
  }

  _wrapper = makeWrapper();
  return _wrapper;
}

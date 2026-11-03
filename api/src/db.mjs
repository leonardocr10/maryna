// Embedded SQLite database (node:sqlite, Node 22.13+): a single file inside the project folder.
// Exposes the small subset of the mysql2 pool API the server uses: execute/query -> [rows] or [{affectedRows,insertId}].
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const bind = v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof Date ? v.toISOString() : v;
const returnsRows = sql => /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

export function openDatabase(file, schemaFile) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  // Rollback journal (not WAL): every commit lands in the .db file itself, so copying the folder never misses recent data.
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (schemaFile) db.exec(fs.readFileSync(schemaFile, 'utf8'));

  function run(sql, params = []) {
    // CURRENT_TIMESTAMP in SQLite is 'YYYY-MM-DD HH:MM:SS'; keep timestamps ISO like the column defaults.
    const st = db.prepare(sql.replace(/\bCURRENT_TIMESTAMP\b/g, "strftime('%Y-%m-%dT%H:%M:%SZ','now')"));
    const args = params.map(bind);
    if (returnsRows(sql)) return [st.all(...args).map(r => ({...r}))];
    const r = st.run(...args);
    return [{affectedRows: Number(r.changes), insertId: Number(r.lastInsertRowid)}];
  }
  const api = {
    file,
    execute: async (sql, params) => run(sql, params),
    query: async (sql, params) => run(sql, params),
    // Statements are synchronous, so a "connection" is the same handle; transactions use BEGIN/COMMIT.
    getConnection: async () => ({
      execute: async (sql, params) => run(sql, params),
      beginTransaction: async () => db.exec('BEGIN IMMEDIATE'),
      commit: async () => db.exec('COMMIT'),
      rollback: async () => { try { db.exec('ROLLBACK'); } catch {} },
      release: () => {},
    }),
    // Adds columns introduced after a database file was created.
    ensureColumns(table, columns) {
      const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const [name, def] of columns) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    },
    close: () => db.close(),
  };
  return api;
}

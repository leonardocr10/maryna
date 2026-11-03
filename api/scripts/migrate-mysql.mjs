// One-time copy of an existing MySQL database (old versions) into the embedded SQLite file.
// Usage (from api/): npm run db:migrar-mysql   — reads DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD from api/.env.
// The MySQL database is only read, never changed. Refuses to run if the SQLite file already has users (use --force).
import 'dotenv/config';
import mysql from 'mysql2/promise';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLES = ['users', 'patients', 'evaluations', 'documents', 'sections', 'section_history', 'prompt_templates', 'ai_settings', 'ai_usage', 'audit_logs'];
const iso = v => v instanceof Date ? v.toISOString().replace(/\.\d{3}Z$/, 'Z') : v;

const target = openDatabase(path.resolve(process.env.DB_FILE || './data/neurolaudos.db'), path.resolve(here, '../../db/schema.sql'));
const [[{n}]] = await target.query('SELECT COUNT(*) n FROM users');
if (n && !process.argv.includes('--force')) {
  console.error(`O banco SQLite (${target.file}) já tem ${n} usuário(s). Nada foi copiado. Use --force para substituir pelos dados do MySQL.`);
  process.exit(1);
}

const src = await mysql.createConnection({host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'neurolaudos', dateStrings: ['DATE']});
const conn = await target.getConnection();
await target.execute('PRAGMA foreign_keys=OFF');
await conn.beginTransaction();
try {
  for (const t of [...TABLES].reverse()) await conn.execute(`DELETE FROM ${t}`);
  for (const t of TABLES) {
    const [[exists]] = await src.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [t]);
    if (!exists.n) { console.log(`${t}: não existe no MySQL, pulando`); continue; }
    const [rows] = await src.query(`SELECT * FROM ${t}`);
    const [cols] = await target.query(`PRAGMA table_info(${t})`);
    const names = cols.map(c => c.name);
    for (const r of rows) {
      const keys = names.filter(k => k in r);
      await conn.execute(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(k => iso(r[k])));
    }
    console.log(`${t}: ${rows.length} registro(s)`);
  }
  await conn.commit();
} catch (e) {
  await conn.rollback();
  console.error('Migração cancelada, nada foi gravado:', e.message);
  process.exitCode = 1;
} finally {
  await target.execute('PRAGMA foreign_keys=ON');
  await src.end();
  target.close();
}
if (!process.exitCode) console.log(`Pronto. Dados copiados para ${target.file}. O MySQL não foi alterado.`);

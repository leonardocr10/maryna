// Restores a NeuroLaudos backup (.nlbk) into this computer. Close the system first (iniciar.bat window).
// Usage (from the project folder): npm run backup:restaurar -- <arquivo.nlbk>
// A password backup asks for its password (or reads BACKUP_PASSWORD). The current database and documents are moved
// aside with the suffix "antes-restauracao-<data>", never deleted.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {backupMode, restoreBackup} from '../src/backup.mjs';

// npm runs this inside api/; the path the person typed is relative to where they ran it (INIT_CWD)
const file = process.argv[2] && path.resolve(process.env.INIT_CWD || '.', process.argv[2]);
if (!file || !fs.existsSync(file)) { console.error('Informe o arquivo do backup: npm run backup:restaurar -- <arquivo.nlbk>'); process.exit(1); }
const port = Number(process.env.PORT || 3001);
try { await fetch(`http://127.0.0.1:${port}/api/health`, {signal: AbortSignal.timeout(1500)}); console.error('O sistema está aberto. Feche a janela do iniciar.bat e rode de novo.'); process.exit(1); } catch {}

const buf = fs.readFileSync(file);
const mode = backupMode(buf);
if (!mode) { console.error('Este arquivo não é um backup do NeuroLaudos.'); process.exit(1); }
let password = process.env.BACKUP_PASSWORD;
if (mode === 2 && !password) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  password = await rl.question('Senha do backup: '); rl.close();
}
const dbFile = path.resolve(process.env.DB_FILE || './data/neurolaudos.db');
const storageDir = path.resolve(process.env.STORAGE_DIR || './storage');
try {
  const r = restoreBackup(buf, {dbFile, storageDir, machineKey: process.env.FILE_ENCRYPTION_KEY, password});
  // A backup from another computer brings its file key: the documents only open with it.
  if (r.fileKey && r.fileKey !== process.env.FILE_ENCRYPTION_KEY) {
    const env = path.resolve('.env');
    if (fs.existsSync(env)) { fs.copyFileSync(env, env + '.antes-restauracao'); fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^FILE_ENCRYPTION_KEY=.*$/m, 'FILE_ENCRYPTION_KEY=' + r.fileKey)); }
    console.log('A chave dos documentos do backup foi gravada no api/.env (o anterior ficou em .env.antes-restauracao).');
  }
  console.log(`Backup de ${r.manifest.created_at} restaurado: ${r.manifest.counts?.evaluations ?? '?'} avaliações, ${r.manifest.counts?.documents ?? '?'} documentos.`);
  if (r.moved.length) console.log('Os dados anteriores foram guardados em:\n  ' + r.moved.join('\n  '));
  console.log('Abra o iniciar.bat de novo.');
} catch (e) { console.error(e.message); process.exit(1); }

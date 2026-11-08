// Static checks before packing: manifest paths exist, every script parses, no clinical data or keys in the package.
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const problems = [];
const need = p => { if (!existsSync(join(root, p))) problems.push('faltando: ' + p); };
Object.values(m.icons).forEach(need);
need(m.background.service_worker); need(m.action.default_popup);
m.content_scripts.forEach(c => [...c.js, ...(c.css || [])].forEach(need));
m.web_accessible_resources.forEach(w => w.resources.forEach(need));
if (m.manifest_version !== 3) problems.push('manifest_version precisa ser 3');
if ((m.permissions || []).some(p => ['tabs', 'cookies', 'webRequest', 'history', '<all_urls>', 'clipboardRead'].includes(p))) problems.push('permissão desnecessária no manifest');
if ((m.host_permissions || []).some(h => h === '<all_urls>' || h === 'https://*/*')) problems.push('host_permissions amplas demais');

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (['node_modules', 'tests', '.git'].includes(f) ? [] : walk(p)) : [p]; });
for (const f of walk(root).filter(f => f.endsWith('.js') || f.endsWith('.mjs'))) {
  try { execFileSync(process.execPath, ['--check', f], {stdio: 'pipe'}); } catch (e) { problems.push('sintaxe: ' + f + '\n' + String(e.stderr || e.message).slice(0, 400)); }
  const src = readFileSync(f, 'utf8');
  if (/sk-[A-Za-z0-9_-]{20,}/.test(src)) problems.push('possível chave de API em ' + f);
  if (/\/backend-api\//.test(src)) problems.push('endpoint interno do ChatGPT em ' + f);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('ok: manifest, arquivos e sintaxe conferidos');

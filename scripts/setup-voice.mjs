// Downloads the local Piper pt-BR voices (about 60 MB each, once) used by "Ouvir" and the reading and edit modes.
// They are not in git (too big): every installation, the server included, runs this (npm run setup / iniciar.bat).
// Runs offline afterwards; the text read aloud never leaves the computer with these voices.
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker/voices');
const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/';
// faber is the default voice (worker/tts_worker.py); cadu and jeff are the other Brazilian Portuguese voices offered
const VOICES = ['faber', 'cadu', 'jeff'];
mkdirSync(dir, {recursive: true});
let failed = 0;
for (const v of VOICES) {
  for (const name of [`pt_BR-${v}-medium.onnx`, `pt_BR-${v}-medium.onnx.json`]) {
    const file = path.join(dir, name);
    if (existsSync(file)) continue;
    try {
      console.log('Baixando voz local: ' + name);
      const r = await fetch(`${base}${v}/medium/${name}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // written under a temporary name first, so an interrupted download is never taken as a voice
      writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
      renameSync(file + '.part', file);
    } catch (e) {
      failed++;
      console.warn('Falha ao baixar ' + name + ': ' + (e instanceof Error ? e.message : e));
    }
  }
}
if (failed) { console.warn('Algumas vozes locais não foram baixadas; rode de novo: node scripts/setup-voice.mjs'); process.exitCode = 1; }
else console.log('Vozes locais prontas em worker/voices: ' + VOICES.join(', ') + '.');

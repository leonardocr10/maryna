// Downloads the local Piper pt-BR voice (about 60 MB, once) used by "Ouvir" (read aloud). Runs offline afterwards.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker/voices');
const base = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/faber/medium/';
mkdirSync(dir, {recursive: true});
for (const name of ['pt_BR-faber-medium.onnx', 'pt_BR-faber-medium.onnx.json']) {
  const file = path.join(dir, name);
  if (existsSync(file)) continue;
  console.log('Baixando voz local: ' + name);
  const r = await fetch(base + name);
  if (!r.ok) throw new Error('Falha ao baixar ' + name + ': HTTP ' + r.status);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
console.log('Voz local pronta em worker/voices.');

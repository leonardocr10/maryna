// Packs the extension (manifest.json at the root of the ZIP) into ../dist/neurolaudos-modo-automatico.zip (Windows).
import {mkdirSync, rmSync, copyFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '..', 'dist', 'neurolaudos-modo-automatico.zip');
mkdirSync(dirname(out), {recursive: true});
rmSync(out, {force: true});
// Windows' own bsdtar writes a standard ZIP (forward slashes), unlike Compress-Archive on PowerShell 5.1.
const tar = join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', out, '-C', root, 'manifest.json', 'README.md', 'background', 'content', 'modules', 'ui', 'popup', 'assets'], {stdio: 'inherit'});
// Same file served by the app (download link in "Instalar o Modo automático").
const served = join(root, '..', 'web', 'src', 'assets', 'extensao', 'neurolaudos-modo-automatico.zip');
mkdirSync(dirname(served), {recursive: true});
copyFileSync(out, served);
console.log(`ZIP: ${out}`);
console.log(`Cópia servida pelo app: ${served}`);

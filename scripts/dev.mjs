// Starts the whole stack: API (node, embedded SQLite) and Angular dev server.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const win=process.platform==='win32';
const ps=f=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',f)],{stdio:'inherit'});

if(!win){console.error('scripts/dev.mjs usa os scripts PowerShell do Windows; em outro SO rode npm start em api/ e web/.');process.exit(1)}
if(!existsSync(path.join(root,'api','.env'))&&ps('setup-env.ps1').status)process.exit(1);
const children=[];
function run(name,cwd,script='start'){
 const p=spawn('npm',['run',script],{cwd:path.join(root,cwd),shell:true});
 const tag=`[${name}] `;
 for(const s of [p.stdout,p.stderr])s.on('data',d=>process.stdout.write(String(d).replace(/^(?=.)/gm,tag)));
 p.on('exit',code=>{console.log(`${tag}encerrado (${code})`);shutdown(code||0)});
 children.push(p);
}
function shutdown(code){for(const p of children)if(p.exitCode===null)spawnSync('taskkill',['/pid',String(p.pid),'/T','/F']);process.exit(code)}
process.on('SIGINT',()=>shutdown(0));

run('api','api');
const lan=process.argv.includes('--lan');
run('web','web',lan?'start:lan':'start');
if(lan){const ips=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);console.log('MODO REDE: outros computadores da mesma rede acessam em '+ips.map(ip=>`http://${ip}:4200`).join(' ou '))}
console.log('API http://localhost:3001  •  UI http://localhost:4200  •  Ctrl+C para parar');

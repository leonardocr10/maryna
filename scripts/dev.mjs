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
// Opens the browser once the Angular dev server prints its address (no extra console window).
let opened=process.argv.includes('--no-browser');
function openBrowser(){opened=true;spawn('cmd',['/c','start','','http://localhost:4200'],{detached:true,stdio:'ignore',windowsHide:true}).unref()}
function run(name,cwd,script='start'){
 const p=spawn(`npm run ${script}`,{cwd:path.join(root,cwd),shell:true});
 const tag=`[${name}] `;
 for(const s of [p.stdout,p.stderr])s.on('data',d=>{const text=String(d);process.stdout.write(text.replace(/^(?=.)/gm,tag));if(name==='web'&&!opened&&/Local:/.test(text))openBrowser()});
 p.on('exit',code=>{console.log(`${tag}encerrado (${code})`);shutdown(code||0)});
 children.push(p);
}
function shutdown(code){for(const p of children)if(p.exitCode===null)spawnSync('taskkill',['/pid',String(p.pid),'/T','/F']);process.exit(code)}
process.on('SIGINT',()=>shutdown(0));

run('api','api','dev');  // restarts itself when the API code changes, like the web server does
const lan=process.argv.includes('--lan');
run('web','web',lan?'start:lan':'start');
if(lan){
 // Skip virtual adapters (VirtualBox, Hyper-V/WSL, VMware): other PCs cannot reach those addresses.
 const ips=Object.entries(os.networkInterfaces()).filter(([name])=>!/virtualbox|vethernet|vmware|wsl|loopback|docker/i.test(name)).flatMap(([,list])=>list||[]).filter(i=>i.family==='IPv4'&&!i.internal&&!/^(192\.168\.56\.|169\.254\.)/.test(i.address)).map(i=>i.address); // 192.168.56.x = VirtualBox host-only default
 console.log('Neste computador: http://localhost:4200');
 console.log(ips.length?'Outros computadores da rede: '+ips.map(ip=>`http://${ip}:4200`).join(' ou '):'Nenhuma rede local encontrada; acesso só neste computador.');
}
console.log('API http://localhost:3001  •  UI http://localhost:4200  •  Ctrl+C para parar');

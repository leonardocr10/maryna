// Starts the whole stack without Docker: database check, API (node) and Angular dev server.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const win=process.platform==='win32';
const ps=f=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',f)],{stdio:'inherit'});

if(!win){console.error('scripts/dev.mjs usa os scripts PowerShell do Windows; em outro SO rode MySQL e npm start em api/ e web/.');process.exit(1)}
if(!existsSync(path.join(root,'api','.env'))&&ps('setup-env.ps1').status)process.exit(1);
// Portable MariaDB only when api/.env points to it (port 3307); otherwise use the existing MySQL.
const env=Object.fromEntries(readFileSync(path.join(root,'api','.env'),'utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
if(env.DB_PORT==='3307'&&ps('start-db.ps1').status)process.exit(1);
const dbUp=await new Promise(r=>net.connect(Number(env.DB_PORT||3306),env.DB_HOST||'127.0.0.1').on('connect',function(){this.end();r(true)}).on('error',()=>r(false)));
if(!dbUp){console.error(`MySQL não responde em ${env.DB_HOST}:${env.DB_PORT}. Inicie o serviço (ex.: net start MySQL80) e rode "npm --prefix api run db:init".`);process.exit(1)}

const children=[];
function run(name,cwd){
 const p=spawn('npm',['start'],{cwd:path.join(root,cwd),shell:true});
 const tag=`[${name}] `;
 for(const s of [p.stdout,p.stderr])s.on('data',d=>process.stdout.write(String(d).replace(/^(?=.)/gm,tag)));
 p.on('exit',code=>{console.log(`${tag}encerrado (${code})`);shutdown(code||0)});
 children.push(p);
}
function shutdown(code){for(const p of children)if(p.exitCode===null)spawnSync('taskkill',['/pid',String(p.pid),'/T','/F']);process.exit(code)}
process.on('SIGINT',()=>shutdown(0));

run('api','api');
run('web','web');
console.log('API http://localhost:3001  •  UI http://localhost:4200  •  Ctrl+C para parar (o banco continua rodando)');

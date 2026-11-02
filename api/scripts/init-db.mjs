// Prepares an existing MySQL 8 server: creates database + app user (optional) and applies db/schema.sql.
// Usage (from api/): npm run db:init
//   With an admin account (creates DB and DB_USER):  asks for the password of DB_ADMIN_USER (default root)
//   Without admin (DB and DB_USER already exist):     npm run db:init -- --no-admin
import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const host=process.env.DB_HOST||'127.0.0.1',port=Number(process.env.DB_PORT||3306);
const db=process.env.DB_NAME||'neurolaudos',user=process.env.DB_USER,password=process.env.DB_PASSWORD||'';
if(!user)throw new Error('Defina DB_USER e DB_PASSWORD em api/.env');
if(!/^[A-Za-z0-9_]+$/.test(db)||!/^[A-Za-z0-9_]+$/.test(user))throw new Error('DB_NAME/DB_USER: use apenas letras, números e _');

function askHidden(question){
 return new Promise(resolve=>{
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  rl._writeToOutput=s=>{if(s.includes(question))process.stdout.write(s)};
  rl.question(question,answer=>{rl.close();process.stdout.write('\n');resolve(answer)});
 });
}

// schema.sql targets the "neurolaudos" database; run it inside DB_NAME instead.
const schema=(await fs.readFile(path.resolve(here,'../../db/schema.sql'),'utf8'))
 .split('\n').filter(l=>!/^\s*(CREATE DATABASE|USE)\b/i.test(l)).join('\n');

if(!process.argv.includes('--no-admin')){
 const adminUser=process.env.DB_ADMIN_USER||'root';
 const adminPassword=process.env.DB_ADMIN_PASSWORD??await askHidden(`Senha do MySQL para ${adminUser}@${host}:${port}: `);
 const admin=await mysql.createConnection({host,port,user:adminUser,password:adminPassword});
 await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
 for(const h of ['localhost','127.0.0.1']){
  await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?',[user,h,password]);
  await admin.query('ALTER USER ?@? IDENTIFIED BY ?',[user,h,password]);
  await admin.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@?`,[user,h]);
 }
 await admin.end();
 console.log(`Banco ${db} e usuário ${user} prontos.`);
}

const conn=await mysql.createConnection({host,port,user,password,database:db,multipleStatements:true});
await conn.query(schema);
const [[{n}]]=await conn.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=?',[db]);
await conn.end();
console.log(`Schema aplicado em ${host}:${port}/${db} (${n} tabelas).`);

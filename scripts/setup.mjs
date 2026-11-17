import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {root,local,pgBin,run,backendEnv,startDatabase,settings} from './common.mjs';
fs.mkdirSync(local,{recursive:true,mode:0o700});
const data=path.join(local,'postgres'),envPath=path.join(root,'backend/.env');
if(!fs.existsSync(path.join(local,'settings.json'))){
 if(fs.existsSync(envPath)||fs.existsSync(data))throw new Error('Existing local state found. Review it before initializing.');
 const password=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');
 fs.writeFileSync(path.join(local,'settings.json'),JSON.stringify({pgBin,pgPort:55433}),{mode:0o600});
 fs.writeFileSync(envPath,`PGHOST=127.0.0.1\nPGPORT=55433\nPGDATABASE=student_cupboard\nPGUSER=cupboard_local\nPGPASSWORD=${password}\nHOST=127.0.0.1\nPORT=3000\nOPENAI_API_KEY=\nOPENAI_VISION_MODEL=gpt-5-mini\nSTAFF_API_TOKENS=${JSON.stringify([{id:'local-developer',role:'staff',token}])}\n`,{mode:0o600});
 fs.writeFileSync(path.join(local,'staff-token.txt'),token+'\n',{mode:0o600});
}
const env=backendEnv(),s=settings();
if(!fs.existsSync(path.join(data,'PG_VERSION'))){
 const pwfile=path.join(local,'init-password');fs.writeFileSync(pwfile,env.PGPASSWORD,{mode:0o600});
 try{run(path.join(s.pgBin,'initdb'),['-D',data,'-U',env.PGUSER,'--auth=scram-sha-256','--pwfile='+pwfile,'--no-locale','--encoding=UTF8'])}finally{fs.unlinkSync(pwfile)}
}
startDatabase();
const {spawnSync}=await import('node:child_process');
const check=spawnSync(path.join(s.pgBin,'psql'),['-h','127.0.0.1','-p',String(s.pgPort),'-U',env.PGUSER,'-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='student_cupboard'"],{env:{...process.env,PGPASSWORD:env.PGPASSWORD},encoding:'utf8'});
if(check.status!==0)throw new Error('Could not inspect local database');
if(check.stdout.trim()!=='1')run(path.join(s.pgBin,'createdb'),['-h','127.0.0.1','-p',String(s.pgPort),'-U',env.PGUSER,'student_cupboard'],{env:{...process.env,PGPASSWORD:env.PGPASSWORD}});
run(process.execPath,['--import','tsx','scripts/migrate.ts'],{cwd:path.join(root,'backend'),env:{...process.env,...env}});
console.log('Local database is ready. Staff token is saved privately in .local/staff-token.txt.');

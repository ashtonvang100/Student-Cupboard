import fs from 'node:fs';
import path from 'node:path';
import {local,settings,run} from './common.mjs';
const pidFile=path.join(local,'processes.json');
if(fs.existsSync(pidFile)){const p=JSON.parse(fs.readFileSync(pidFile,'utf8'));try{process.kill(p.launcher,'SIGTERM')}catch{}fs.unlinkSync(pidFile)}
const s=settings();run(path.join(s.pgBin,'pg_ctl'),['-D',path.join(local,'postgres'),'-m','fast','-w','stop']);

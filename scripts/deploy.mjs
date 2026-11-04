import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';
function run(args){const r=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--no-install','wrangler',...args],{stdio:'inherit',env:process.env});if(r.status!==0)throw Error('Comando de publicação falhou.');}
try{
 const c=config();
 // Secrets must already be installed by setup; deploy never invents credentials.
 for(const name of ['check','test']){const r=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run',name],{stdio:'inherit'});if(r.status)process.exit(r.status);}
 run(['d1','migrations','apply','DB','--remote','--config','wrangler.generated.json']);
 run(['deploy','--config','wrangler.generated.json']);
 console.log('Worker enviado. Verifique /api/health e conclua o primeiro acesso em '+c.vars.APP_ORIGIN);
}catch(error){console.error(error.message);process.exitCode=1;}

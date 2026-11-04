import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync } from 'node:fs';
import { migrate } from './migrate-postgres.mjs';
import { neon } from '@neondatabase/serverless';
function run(args,extra={}) {
  const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,...extra}});
  if(r.status!==0)process.exit(r.status||1);
}
run(['scripts/check.mjs']);
if(!process.env.DATABASE_URL)throw new Error('Conecte o Neon ao projeto antes do build.');
if(!/^[a-f0-9]{64}$/i.test(process.env.VAULT_KEY||''))throw new Error('Configure VAULT_KEY antes do build.');
if(!process.env.CRON_SECRET||process.env.CRON_SECRET.length<32)throw new Error('Configure CRON_SECRET antes do build.');
await migrate(neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL));
if(process.env.VERCEL_ENV==='preview')run(['--test','tests/core.test.mjs','tests/farm-publish.test.mjs'],{TEST_DATABASE:'neon'});
mkdirSync('vercel-static',{recursive:true});
writeFileSync('vercel-static/.gitkeep','');

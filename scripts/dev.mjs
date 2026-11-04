import { spawn, spawnSync } from 'node:child_process';
// Local preview launchers pass Vite-style flags; only host and port apply here.
const args=process.argv.slice(2);
const option=(name,fallback)=>{const exact=args.indexOf(name);return exact>=0&&args[exact+1]&&!args[exact+1].startsWith('-')?args[exact+1]:args.find(x=>x.startsWith(name+'='))?.slice(name.length+1)||fallback;};
const host=option('--host','0.0.0.0'),port=option('--port',process.env.PORT||'8787');
const migration=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(migration.status)process.exit(migration.status);
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--local','--ip',host,'--port',port],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));

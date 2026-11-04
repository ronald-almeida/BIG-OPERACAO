import { readdirSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(dir+'/'+x.name):[dir+'/'+x.name]);}
for(const file of [...walk('src'),...walk('shared'),...walk('scripts'),...walk('public'),...walk('api')].filter(x=>/\.(m?js)$/.test(x))){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status);}
const client=readFileSync('public/app.js','utf8');assert(!/localStorage|demo12345|demo-admin|findLogin/.test(client),'Código demonstrativo no cliente');
assert(!/CLOUDFLARE_API_TOKEN|BOOTSTRAP_TOKEN=|VAULT_KEY=/.test(client),'Segredo no bundle público');
console.log('Sintaxe e separação entre cliente e servidor verificadas.');

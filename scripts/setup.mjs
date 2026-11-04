import { spawnSync } from 'node:child_process';
import { config } from './config.mjs';
import { randomBytes } from 'node:crypto';
import { writeFileSync,existsSync } from 'node:fs';
try{
 config();
 // Preserve an existing key. Rotating it would make stored profile passwords unreadable.
 const output='.env.production-secrets';
 if(existsSync(output))throw Error(output+' já existe. Reutilize os segredos salvos; não gere outra chave.');
 const list=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--no-install','wrangler','secret','list','--config','wrangler.generated.json'],{encoding:'utf8',env:process.env});
 if(list.status!==0)throw Error('Não foi possível verificar os segredos existentes. Crie/verifique o Worker no painel Cloudflare antes de continuar.');
 const existing=JSON.parse(list.stdout);if(existing.some(x=>['VAULT_KEY','BOOTSTRAP_TOKEN'].includes(x.name)))throw Error('O Worker já possui segredos. Configure apenas as chaves faltantes manualmente.');
 const secrets={VAULT_KEY:randomBytes(32).toString('hex'),BOOTSTRAP_TOKEN:randomBytes(32).toString('base64url')};
 writeFileSync(output,Object.entries(secrets).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
 const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['--no-install','wrangler','secret','bulk','--config','wrangler.generated.json'],{input:JSON.stringify(secrets),encoding:'utf8',env:process.env});
 if(result.status!==0)throw Error('Falha ao instalar os segredos. Os valores foram preservados no arquivo local para tentar novamente.');
 console.log('Segredos instalados. Guarde '+output+' em um gerenciador seguro e use o BOOTSTRAP_TOKEN no primeiro acesso. Não envie esse arquivo ao GitHub.');
}catch(error){console.error(error.message);process.exitCode=1;}

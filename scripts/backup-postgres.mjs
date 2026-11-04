import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { postgres } from '../src/postgres.mjs';
export async function backupDatabase(db,path) {
if(!path)throw new Error('Uso: node scripts/backup-postgres.mjs caminho-fora-do-repositorio.json');
const tables=['workspace','records','requests'];
const results=await db.batch(tables.map(t=>db.prepare('SELECT * FROM '+t)));
const data=Object.fromEntries(tables.map((t,i)=>[t,results[i].results]));
const payload=JSON.stringify(data);
await writeFile(path,JSON.stringify({format:'big-operacao-postgres-v1',created:new Date().toISOString(),sha256:createHash('sha256').update(payload).digest('hex'),data}),{flag:'wx',mode:0o600});
console.log('Backup criado. Guarde-o criptografado e separado da VAULT_KEY. Sessões de login não são exportadas.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await backupDatabase(postgres(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL),process.argv[2]);

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { postgres } from '../src/postgres.mjs';
import { unseal } from '../src/security.mjs';
export async function restoreDatabase(db,path,env) {
if(!path||env.RESTORE_EMPTY_DATABASE!=='yes')throw new Error('Defina RESTORE_EMPTY_DATABASE=yes e informe um backup. Use outro banco vazio com migrations aplicadas.');
const backup=JSON.parse(await readFile(path,'utf8'));
if(backup.format!=='big-operacao-postgres-v1'||createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')!==backup.sha256)throw new Error('Backup inválido.');
// Validate the separately supplied key BEFORE changing the destination.
for(const r of backup.data.records){const p=JSON.parse(r.data);if(r.collection==='profiles'&&p.vault)await unseal(p.vault,p.id,env);}
const statements=[db.prepare("DO $restore$ BEGIN IF EXISTS(SELECT 1 FROM records) OR EXISTS(SELECT 1 FROM requests) OR EXISTS(SELECT 1 FROM auth_sessions) THEN RAISE EXCEPTION 'Restore destination must be empty'; END IF; END; $restore$")];
statements.unshift(db.prepare('LOCK TABLE workspace,records,requests,auth_sessions IN ACCESS EXCLUSIVE MODE'));
for(const r of backup.data.records)statements.push(db.prepare('INSERT INTO records(collection,id,data) VALUES(?,?,?)').bind(r.collection,r.id,r.data));
for(const r of backup.data.requests)statements.push(db.prepare('INSERT INTO requests(id,actor,fingerprint,result,created) VALUES(?,?,?,?,?)').bind(r.id,r.actor,r.fingerprint,r.result,r.created));
statements.push(db.prepare('UPDATE workspace SET revision=?,mutation_id=? WHERE id=1').bind(backup.data.workspace[0].revision,backup.data.workspace[0].mutation_id));
await db.batch(statements);
console.log('Backup restaurado em banco vazio; cofre validado com a chave separada. Entre novamente nas contas.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await restoreDatabase(postgres(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL),process.argv[2],process.env);

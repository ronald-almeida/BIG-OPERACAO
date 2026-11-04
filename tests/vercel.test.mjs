import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, assets } from '../src/vercel.mjs';
import { database } from './postgres-fixture.mjs';
import { loadState, mutate } from '../src/store.mjs';
import { serveFarm } from '../src/farm-public.mjs';
import { postgresSql } from '../src/postgres.mjs';
import { seal, unseal } from '../src/security.mjs';
import { mkdtemp,rm,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from '../scripts/backup-postgres.mjs';
import { restoreDatabase } from '../scripts/restore-postgres.mjs';
import { migrate } from '../scripts/migrate-postgres.mjs';
import { PGlite } from '@electric-sql/pglite';
const origin = 'https://operacao.example';

test('PostgreSQL migration is repeatable and refuses a modified applied migration',async()=>{
  const pg=new PGlite();
  const sql={query:(text,args=[])=>({text,args,then:(a,b)=>pg.query(text,args).then(a,b)}),transaction:queries=>pg.transaction(async tx=>{const out=[];for(const q of queries)out.push(await tx.query(q.text,q.args));return out;})};
  try{
    await migrate(sql);await migrate(sql);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,1);
    await pg.query("UPDATE schema_migrations SET checksum='changed'");
    await assert.rejects(migrate(sql),/checksum mismatch/);
  }finally{await pg.close();}
});

test('Vercel preserves cookies, origin, trusted IP and cron authorization on PostgreSQL', async () => {
  const env = { DB: await database(), APP_ORIGIN: origin, ASSETS: assets, BOOTSTRAP_TOKEN: 't'.repeat(40), VAULT_KEY: 'f'.repeat(64), CRON_SECRET: 's'.repeat(40) };
  const request = (path, data, headers={}) => new Request(origin+path, { method: data ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
  assert.equal((await handle(new Request('https://evil.example/api/health'),env)).status,404);
  assert.equal((await handle(request('/api/cron'),env)).status,401);
  assert.equal((await handle(request('/api/cron',null,{Authorization:'Bearer '+env.CRON_SECRET}),env)).status,200);
  assert.equal((await handle(request('/api/setup',{name:'Admin',username:'admin',password:'test-password-123',token:env.BOOTSTRAP_TOKEN},{'x-vercel-forwarded-for':'203.0.113.1','cf-connecting-ip':'evil'}),env)).status,200);
  const login=await handle(request('/api/login',{username:'admin',password:'test-password-123'}),env);
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/__Host-big-session=.*HttpOnly; Secure; SameSite=Strict/);
  const state=await handle(request('/api/state',null,{Cookie:login.headers.get('set-cookie').split(';')[0]}),env);
  assert.equal(state.status,200);assert(!(await state.text()).includes('passwordHash'));
  assert.equal((await handle(request('/api/login',{username:'admin',password:'test-password-123'},{Origin:'https://evil.example'}),env)).status,403);
  assert.match((await handle(request('/'),env)).headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('PostgreSQL rollback, JSON unique constraints, concurrency and published view', async () => {
  const db=await database();
  await assert.rejects(db.batch([db.prepare("INSERT INTO records VALUES('settings','main','{}')"),db.prepare('INSERT INTO missing VALUES(1)')]));
  assert.equal((await loadState(db)).state.settings.mode,'variable');
  await Promise.all(['one','two'].map(label=>mutate(db,label,crypto.randomUUID(),label,s=>{s.tasks.push({id:label,text:label});return {};})));
  assert.equal((await loadState(db)).state.tasks.length,2);
  await db.prepare('INSERT INTO records VALUES(?,?,?)').bind('people','1',JSON.stringify({username:'Alice'})).run();
  await assert.rejects(db.prepare('INSERT INTO records VALUES(?,?,?)').bind('people','2',JSON.stringify({username:'alice'})).run());
  const snapshot={hostname:'empresa.example',version:1,data:{razao:'Publicado',cnpj:'53749174000118'},theme:'id01',head:''};
  await mutate(db,'test',crypto.randomUUID(),'publish',s=>{s.farm.domains.push({id:'d',active:true});s.farm.sites.push({id:'s',domain_id:'d',snapshot,data:{razao:'Rascunho novo'}});});
  const lookup=async hostname=>(await db.pg.query("SELECT * FROM public_farm_sites WHERE snapshot->>'hostname'=$1",[hostname])).rows[0];
  await db.pg.exec('CREATE ROLE farm_reader; GRANT USAGE ON SCHEMA public TO farm_reader; GRANT SELECT ON public_farm_sites TO farm_reader; SET ROLE farm_reader');
  assert.equal((await lookup('empresa.example')).id,'s');
  await assert.rejects(db.pg.query('SELECT * FROM records'),/permission denied/);
  await assert.rejects(db.pg.query('SELECT * FROM auth_sessions'),/permission denied/);
  await db.pg.exec('RESET ROLE');
  const publicResponse=await serveFarm(new Request('https://empresa.example/'),lookup,origin);
  const html=await publicResponse.text();assert.match(html,/Publicado/);assert(!html.includes('Rascunho novo'));
  for(const path of ['/api/state','/api/login','/app.js']) assert.equal((await serveFarm(new Request('https://empresa.example'+path),lookup,origin)).status,404);
  assert.equal((await serveFarm(new Request('https://other.example/'),lookup,origin)).status,404);
  await mutate(db,'test',crypto.randomUUID(),'unpublish',s=>{s.farm.sites[0].snapshot=null;});
  assert.equal((await serveFarm(new Request('https://empresa.example/'),lookup,origin)).status,404);
});

test('PostgreSQL record backup restores vault with the separate original key',async()=>{
  const source=await database(), restored=await database(),env={VAULT_KEY:'a'.repeat(64)};
  const vault=await seal('recovery-secret','PRF-1',env);
  await mutate(source,'test',crypto.randomUUID(),'seed',s=>{s.profiles.push({id:'PRF-1',vault,meta:'backup-profile'});});
  const directory=await mkdtemp(join(tmpdir(),'big-operacao-backup-'));
  try {
    const path=join(directory,'backup.json');
    await backupDatabase(source,path);
    await assert.rejects(restoreDatabase(restored,path,{...env,VAULT_KEY:'b'.repeat(64),RESTORE_EMPTY_DATABASE:'yes'}));
    await restoreDatabase(restored,path,{...env,RESTORE_EMPTY_DATABASE:'yes'});
    await assert.rejects(restoreDatabase(restored,path,{...env,RESTORE_EMPTY_DATABASE:'yes'}),/must be empty/);
  } finally { await rm(join(directory,'backup.json'),{force:true}); await rmdir(directory); }
  const profile=(await loadState(restored)).state.profiles[0];
  assert.equal(await unseal(profile.vault,profile.id,env),'recovery-secret');
  await assert.rejects(unseal(profile.vault,profile.id,{VAULT_KEY:'b'.repeat(64)}));
  assert.equal(postgresSql("SELECT '?' AS value WHERE id=?"),"SELECT '?' AS value WHERE id=$1");
});

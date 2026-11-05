import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import { database as sqliteDatabase } from './d1.mjs';
const database = process.env.TEST_DATABASE === 'neon' ? (await import('./neon-fixture.mjs')).database : process.env.TEST_DATABASE === 'postgres' ? (await import('./postgres-fixture.mjs')).database : sqliteDatabase;
import { loadState,mutate,emptyState } from '../src/store.mjs';
import { command,timeCommand,settle } from '../src/domain.mjs';
import { payroll,monthBounds } from '../src/payroll.mjs';
import { farmCommand } from '../src/farm.mjs';
import { seal,unseal } from '../src/security.mjs';
const origin='https://operacao.example';
async function fixture(){
 const env={DB:await database(),APP_ORIGIN:origin,VAULT_KEY:'1'.repeat(64),BOOTSTRAP_TOKEN:'setup-test-'.repeat(4),ASSETS:{fetch:async()=>new Response('app')}};
 const call=async(path,data,auth={},extra={})=>{const headers={...extra};if(data!==undefined){headers['Content-Type']='application/json';headers.Origin=extra.Origin||origin;headers['X-CSRF-Token']=auth.csrf||'';headers['X-Request-Id']=extra['X-Request-Id']||crypto.randomUUID();}if(auth.cookie)headers.Cookie=auth.cookie;const response=await worker.fetch(new Request((extra.url||origin)+'/api/'+path,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)}),env);const body=await response.json();return {status:response.status,body,headers:response.headers};};
 assert.equal((await call('setup',{token:env.BOOTSTRAP_TOKEN,name:'Administrador QA',username:'admin',password:'Admin-test-pass-123'})).status,200);
 const login=async(username,password)=>{const r=await call('login',{username,password});assert.equal(r.status,200,JSON.stringify(r.body));const auth={cookie:r.headers.get('set-cookie').split(';')[0]};const s=await call('state',undefined,auth);auth.csrf=s.body.csrf;return auth;};
 const admin=await login('admin','Admin-test-pass-123');
 const run=(cmd,id,data={},auth=admin,extra)=>call('command',{cmd,id,data},auth,extra);
 const employee=async(username)=>{const r=await run('person',null,{name:username,username,accessPassword:'Employee-test-123',accessEnabled:'yes',month:'2026-11',fixed:2000,hours:160,overtimeRate:20});assert.equal(r.status,200,JSON.stringify(r.body));return {id:r.body.result.id,auth:await login(username,'Employee-test-123')};};
 return {env,call,login,admin,run,employee};
}
test('bootstrap is one-time; auth, CSRF, session and origin boundaries',async()=>{
 const f=await fixture();assert.equal((await f.call('setup',{token:f.env.BOOTSTRAP_TOKEN})).status,409);
 assert.equal((await f.call('state')).status,401);
 assert.equal((await f.call('login',{username:'admin',password:'wrong'})).status,401);
 assert.equal((await f.run('settings',null,{},{})).status,401);
 assert.equal((await f.run('settings',null,{}, {cookie:f.admin.cookie})).status,403);
 assert.equal((await f.run('settings',null,{},f.admin,{Origin:'https://evil.example'})).status,403);
 const before=await f.call('state',undefined,f.admin);assert(!JSON.stringify(before.body).includes('passwordHash'));assert(!JSON.stringify(before.body).includes('credentialVersion'));
 assert.equal((await f.call('account-password',{currentPassword:'Admin-test-pass-123',password:'Another-admin-pass-123'},f.admin)).status,200);
 assert.equal((await f.call('state',undefined,f.admin)).status,401);
 await f.login('admin','Another-admin-pass-123');
});
test('employee ownership, vault encryption, sales and idempotent atomic mutations',async()=>{
 const f=await fixture(),a=await f.employee('alice'),b=await f.employee('bruno');
 const profile={name:'Perfil A',meta:'meta-a',login:'a',email:'',backup:'',status:'Ativo',proxy:'',created:'2026-11-01',note:'',demoPassword:'profile-secret-123',owner:b.id};
 const p=await f.run('profile',null,profile,a.auth);assert.equal(p.status,200);const pid=p.body.result.id;
 assert.equal(p.body.state.profiles[0].owner,a.id);assert(!JSON.stringify(p.body).includes('profile-secret-123'));assert(!('vault' in p.body.state.profiles[0]));
 assert.equal((await f.call('credential',{id:pid},a.auth)).body.password,'profile-secret-123');
 assert.equal((await f.call('credential',{id:pid},b.auth)).status,403);
 assert.equal((await f.run('profile',pid,profile,b.auth)).status,403);
 assert.equal((await f.run('cost',null,{},a.auth)).status,403);
 const bm={name:'BM A',meta:'meta-bm-a',profiles:[pid],status:'Ativa',capacity:100000,owner:b.id,purpose:'Revenda',stock:'Disponível',origin:'new',created:'2026-11-01',note:''};
 const created=await f.run('bm',null,bm,a.auth);assert.equal(created.status,200,JSON.stringify(created.body));const bid=created.body.result.id;
 const receiptId=crypto.randomUUID();const sell={bm:bid,profile:pid,client:'Cliente',amount:500,date:'2026-11-01',paid:'no'};
 const [s1,s2]=await Promise.all([f.run('sale',null,sell,f.admin,{'X-Request-Id':receiptId}),f.run('sale',null,sell,f.admin,{'X-Request-Id':receiptId})]);
 assert.equal(s1.status,200,JSON.stringify(s1.body));assert.equal(s2.status,200,JSON.stringify(s2.body));assert.equal(s1.body.result.id,s2.body.result.id);
 assert.equal((await f.run('sale',null,sell)).status,409);
 assert.equal((await f.run('sale',null,{...sell,amount:700},f.admin,{'X-Request-Id':receiptId})).status,409);
 const adminState=(await f.call('state',undefined,f.admin)).body.state;assert.equal(adminState.sales.length,1);assert.equal(adminState.bms[0].stock,'Vendida');
 const employeeState=(await f.call('state',undefined,b.auth)).body.state;assert.equal(employeeState.profiles.length,0);assert.equal(employeeState.sales.length,0);assert.equal(employeeState.people.length,1);
 assert.equal((await f.run('person',a.id,{name:'Alice',username:'alice',accessPassword:'',accessEnabled:'no',month:'2026-11',fixed:2000,hours:160,overtimeRate:20})).status,200);
 assert.equal((await f.call('state',undefined,a.auth)).status,401);
});
test('duplicate sale returns its receipt when the original commits before the state read',async()=>{
 const db=await database(),actor={id:'ADMIN',role:'admin',name:'Administrador QA'};
 await mutate(db,actor.id,crypto.randomUUID(),'seed',state=>{
  state.admin={id:actor.id,name:actor.name,username:'admin'};
  state.bms.push({id:'BM-RACE',status:'Ativa',stock:'Disponível',profiles:['PRF-RACE']});
  state.costs.push({id:'CST-RACE',target:'BM-RACE',amount:30});
  return {};
 });
 const requestId=crypto.randomUUID(),fingerprint='sale-race';
 const data={bm:'BM-RACE',profile:'PRF-RACE',client:'Cliente',amount:500,date:'2026-11-01',paid:'no'};
 let applied=0,committed,interleaved=false;
 const sell=state=>{applied++;return command(state,actor,'sale',null,data,{});};
 const delayed={...db,async batch(statements){
  // The first request finishes while the duplicate is about to read current state.
  if(!interleaved&&statements.some(s=>s.sql.includes('SELECT revision FROM workspace'))){
   interleaved=true;
   committed=await mutate(db,actor.id,requestId,fingerprint,sell);
  }
  return db.batch(statements);
 }};
 const repeated=await mutate(delayed,actor.id,requestId,fingerprint,sell);
 assert.equal(interleaved,true);assert.deepEqual(repeated,committed);assert.equal(applied,1);
 const {state}=await loadState(db);
 assert.equal(state.sales.length,1);assert.equal(state.sales[0].cost,30);
 assert.equal(state.bms[0].stock,'Vendida');assert.equal(state.events.filter(e=>e.type==='Venda').length,1);
 assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM requests WHERE id=?').bind(actor.id+':'+requestId).first()).count),1);
 await assert.rejects(()=>mutate(db,actor.id,requestId,'different-payload',sell),error=>error.status===409);
 await assert.rejects(()=>mutate(db,actor.id,crypto.randomUUID(),fingerprint,sell),error=>error.status===409);
});
test('170 hours: 160 normal, 10 extra, monthly edges and presence timeout',()=>{
 const s=emptyState(),actor={id:'EMP-A',role:'employee',name:'A'};s.people=[{id:actor.id,payPlans:{'2026-11':{fixed:2000,hours:160,overtimeRate:20}}}];
 const [a,b]=monthBounds('2026-11');s.journal=[{id:'J',employee:actor.id,start:a,end:a+170*3600000,duration:170*3600000}];
 let q=payroll(s,actor.id,'2026-11',b);assert.equal(q.normalAmount,2000);assert.equal(q.normalHours,160);assert.equal(q.extra,10);assert.equal(q.extraAmount,200);assert.equal(q.amount,2200);
 s.people[0].payPlans['2026-11'].overtimeRate=null;q=payroll(s,actor.id,'2026-11',b);assert.equal(q.extraAmount,null);assert.equal(q.overtimePending,true);
 s.settings={mode:'fixed',fixed:60,grace:2};const now=a+180*3600000;timeCommand(s,actor,'start',now);timeCommand(s,actor,'start',now+1000);assert.equal(s.sessions[actor.id].start,now);
 settle(s,now+63*60000);assert.equal(s.sessions[actor.id].status,'paused');assert.equal(s.journal.at(-1).duration,3600000);assert.equal(payroll(s,actor.id,'2026-11',b).hours,171);
 timeCommand(s,actor,'start',now+70*60000);timeCommand(s,actor,'end',now+100*60000);assert.equal(payroll(s,actor.id,'2026-11',b).hours,171.5);
 s.journal=[{employee:actor.id,start:a-3600000,end:a+3600000,duration:7200000}];s.sessions={};assert.equal(payroll(s,actor.id,'2026-11',b).hours,1);
});
test('employee state caps totals and omits overtime rates; server controls timestamps',async()=>{
 const f=await fixture(),a=await f.employee('alice'),[start]=monthBounds('2026-11');
 await mutate(f.env.DB,'test',crypto.randomUUID(),'ledger',s=>{s.journal.push({id:'J',employee:a.id,start,end:start+170*3600000,duration:170*3600000,reason:'Teste'});return {};});
 // Use a completed historical month so the test does not depend on today's day.
 await mutate(f.env.DB,'test',crypto.randomUUID(),'month',s=>{const p=s.people.find(p=>p.id===a.id);p.payPlans['2026-10']={...p.payPlans['2026-11']};s.journal[0].start=Date.parse('2026-10-01T03:00Z');s.journal[0].end=s.journal[0].start+170*3600000;return {};});
 const view=(await f.call('state',undefined,a.auth)).body.state,q=view.serverPayroll[a.id]['2026-10'];assert.equal(q.hours,160);assert.equal(q.amount,2000);assert.equal(q.overtimeRate,null);assert.equal(view.journal.reduce((a,j)=>a+j.duration,0),160*3600000);
 const ad=(await f.call('state',undefined,f.admin)).body.state.serverPayroll[a.id]['2026-10'];assert.equal(ad.extra,10);assert.equal(ad.amount,2200);
 await f.run('start',null,{start:0},a.auth);const server=(await loadState(f.env.DB)).state;assert(server.sessions[a.id].start>Date.now()-5000);
});
test('farm validates ownership, shared capacity, reserved host and public isolation',async()=>{
 const f=await fixture(),a=await f.employee('alice'),b=await f.employee('bruno');
 assert.equal((await f.run('farm-domain',null,{hostname:'operacao.example',site_limit:''})).status,400);
 const domain=await f.run('farm-domain',null,{hostname:'empresa.example',site_limit:1},a.auth);assert.equal(domain.status,200);const did=domain.body.result.id;
 const input={data:{cnpj:'53749174000118',razao:'Empresa A'},theme:'id01',publish_mode:'subdomain',subdomain:'empresa',domain_id:did,head:'',owner:b.id,bm:''};
 const site=await f.run('farm-site',null,input,a.auth);assert.equal(site.status,200,JSON.stringify(site.body));const sid=site.body.result.id;
 assert.equal((await f.run('farm-site',null,{...input,subdomain:'segunda'},b.auth)).status,400);
 assert.equal((await f.run('farm-site',sid,input,b.auth)).status,403);
 assert.equal((await f.call('farm-publish',{cmd:'farm-publish',id:sid},a.auth)).status,503);
 assert.equal((await f.call('state',undefined,b.auth)).body.state.farm.domains[0].site_count,1);
 const response=await worker.fetch(new Request('https://empresa.empresa.example/api/state',{headers:{Cookie:f.admin.cookie}}),f.env);assert.equal(response.status,404);
});
test('AES-GCM vault rejects tampering and credential swaps',async()=>{
 const env={VAULT_KEY:'a'.repeat(64)},encrypted=await seal('secret-value','PRF-A',env);assert(!encrypted.includes('secret-value'));assert.equal(await unseal(encrypted,'PRF-A',env),'secret-value');await assert.rejects(()=>unseal(encrypted,'PRF-B',env));
});
test('failed multi-row transaction rolls back and retry keeps both concurrent writes',async()=>{
 const DB=await database();await assert.rejects(()=>DB.batch([DB.prepare("INSERT INTO records VALUES('settings','main','{}')"),DB.prepare('INSERT INTO nonexistent VALUES(1)')]));assert.equal((await loadState(DB)).state.settings.mode,'variable');
 await Promise.all(['one','two'].map(label=>mutate(DB,label,crypto.randomUUID(),label,s=>{s.tasks.push({id:label,text:label});return {};})));assert.equal((await loadState(DB)).state.tasks.length,2);
});

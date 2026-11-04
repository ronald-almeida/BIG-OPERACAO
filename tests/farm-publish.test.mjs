import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1.mjs';
import { mutate,loadState } from '../src/store.mjs';
import { publishCommand,farmCommand } from '../src/farm.mjs';
import worker from '../src/worker.mjs';
test('real publication adapter: snapshot, HTTPS check, root ownership and safe removal',async()=>{
 const DB=database(),env={DB,APP_ORIGIN:'https://panel.example',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token',FARM_WORKER_SERVICE:'big-operacao'};
 const a={id:'EMP-A',role:'employee',name:'A'},b={id:'EMP-B',role:'employee',name:'B'},admin={id:'ADMIN',role:'admin',name:'Admin'};
 await mutate(DB,'seed',crypto.randomUUID(),'seed',s=>{s.admin={id:'ADMIN'};s.people=[{id:a.id},{id:b.id}];s.farm.domains=[{id:'D',owner:a.id,hostname:'company.example',active:true,site_limit:null}];s.farm.sites=['S1','S2'].map((id,i)=>({id,owner:i?b.id:a.id,domain_id:'D',publish_mode:'root',subdomain:null,data:{cnpj:'53749174000118',razao:id,atividade:'Teste'},theme:'id01',head:'',version:1,status:'draft',snapshot:null}));return {};});
 const originalFetch=globalThis.fetch;let bound=false,deletes=0;
 globalThis.fetch=async(url,options={})=>{
  if(String(url)==='https://company.example/__farm-check')return worker.fetch(new Request(url),env);
  const path=new URL(url).pathname;
  if(path==='/client/v4/zones')return Response.json({success:true,result:[{id:'zone',name:'company.example',status:'active',account:{id:env.CLOUDFLARE_ACCOUNT_ID}}]});
  if(path.endsWith('/dns_records'))return Response.json({success:true,result:[]});
  if(path.endsWith('/workers/domains')){
    if(options.method==='PUT'){bound=true;return Response.json({success:true,result:{id:'binding',service:'big-operacao'}});}
    return Response.json({success:true,result:bound?[{id:'binding',service:'big-operacao',hostname:'company.example'}]:[]});
  }
  if(path.endsWith('/workers/domains/binding')&&options.method==='DELETE'){bound=false;deletes++;return Response.json({success:true,result:{}});}
  throw Error('Unexpected request: '+url);
 };
 try{
  assert.equal((await publishCommand(env,a,'farm-publish','S1')).ready,true);
  assert((await (await worker.fetch(new Request('https://company.example/'),env)).text()).includes('S1'));
  await mutate(DB,'edit',crypto.randomUUID(),'draft',s=>{s.farm.sites[0].data.razao='Rascunho novo';s.farm.sites[0].version=2;return {};});
  assert(!(await (await worker.fetch(new Request('https://company.example/'),env)).text()).includes('Rascunho novo'));
  await assert.rejects(()=>publishCommand(env,b,'farm-publish','S2',true),e=>e.status===403);
  await assert.rejects(()=>publishCommand(env,b,'farm-unpublish','S2'),/não tem publicação/);assert.equal(deletes,0);
  await assert.rejects(()=>publishCommand(env,admin,'farm-publish','S2'),e=>e.status===409);
  assert.equal((await publishCommand(env,admin,'farm-publish','S2',true)).ready,true);
  const state=(await loadState(DB)).state;assert.equal(state.farm.sites.find(s=>s.id==='S1').snapshot,null);
  await publishCommand(env,b,'farm-unpublish','S2');assert.equal(deletes,1);assert.equal((await worker.fetch(new Request('https://company.example/'),env)).status,404);
  await DB.prepare('INSERT INTO external_locks VALUES(?,?,?)').bind('farm','busy',Date.now()+10000).run();
  await assert.rejects(()=>farmCommand((structuredClone(state)),a,'farm-domain-toggle','D',{active:false},env),e=>e.status===409);
 }finally{globalThis.fetch=originalFetch;}
});

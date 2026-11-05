import test from 'node:test';
import assert from 'node:assert/strict';
import {attachFarm,externalFarmCommand} from '../src/farm-bridge.mjs';
import {emptyState} from '../src/store.mjs';

test('external Farm uses a server credential, trusted actor, scoped URL and read-only preview boundary',async()=>{
  const original=globalThis.fetch,actor={id:'EMP-alice',role:'employee',name:'Alice'},state=emptyState();
  state.people.push({id:actor.id,accessEnabled:true});
  const env={FARM_BRIDGE_URL:'https://farm-api.example/api/operacao-farm',FARM_BRIDGE_SECRET:'s'.repeat(64)};
  let requests=0;
  globalThis.fetch=async(url,options)=>{requests++;assert.equal(String(url),env.FARM_BRIDGE_URL);assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+env.FARM_BRIDGE_SECRET);const body=JSON.parse(options.body);assert.deepEqual(body.actor,actor);assert.equal(body.data.owner,actor.id);return Response.json({id:'saved'});};
  try{
    const result=await externalFarmCommand(env,actor,state,{cmd:'farm-site',data:{owner:'ADMIN'}},crypto.randomUUID());assert.equal(result.id,'saved');
    await assert.rejects(externalFarmCommand({...env,FARM_BRIDGE_READ_ONLY:'true'},actor,state,{cmd:'farm-delete',id:'site'},crypto.randomUUID()),e=>e.status===409);assert.equal(requests,1);
    await assert.rejects(externalFarmCommand(env,actor,state,{cmd:'farm-site',data:{bm:'unowned'}},crypto.randomUUID()),e=>e.status===404);assert.equal(requests,1);
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://other.example'}});
    await assert.rejects(externalFarmCommand(env,actor,state,{cmd:'farm-delete',id:'site'},crypto.randomUUID()),e=>e.status===503);
  }finally{globalThis.fetch=original;}
});
test('Farm deliveries are projected from D1 without overwriting operational events or exposing secrets',async()=>{
  const original=globalThis.fetch,state=emptyState();state.events=[{id:'EVT-1',at:1},{id:'FARM-old',at:0}];
  const farm={source:'cloudflare-d1',sites:[{id:'preserved'}],domains:[],history:[],available:true,writable:true};
  globalThis.fetch=async()=>Response.json({farm,events:[{id:'FARM-1',at:2}]});
  try{
    await attachFarm({FARM_BRIDGE_URL:'https://farm-api.example/api/operacao-farm',FARM_BRIDGE_SECRET:'s'.repeat(64),FARM_BRIDGE_READ_ONLY:'true'},{id:'ADMIN',role:'admin',name:'Admin'},state);
    assert.deepEqual(state.events.map(e=>e.id),['FARM-1','EVT-1']);assert.equal(state.farm.writable,false);assert.equal(state.farm.sites[0].id,'preserved');assert(!JSON.stringify(state).includes('s'.repeat(64)));
  }finally{globalThis.fetch=original;}
});

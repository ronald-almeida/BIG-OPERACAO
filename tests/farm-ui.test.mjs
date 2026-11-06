import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function ui(){
 const root={addEventListener(){},querySelector(){return null}};
 const context={document:{getElementById:()=>root,addEventListener(){},hidden:false},setInterval(){},setTimeout(){},structuredClone,console};
 vm.createContext(context);
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace('\ninitialize();','\nglobalThis.ui={accept,farmSites,farmDetail,farmById,farmCanEdit,refresh,view:()=>state.farm,select:id=>farmUI.view=id,setPage:p=>page=p};');
 vm.runInContext(source,context);return {app:context.ui,context};
}
const response=(farm,id='alice')=>({user:{id,role:'employee',name:id},csrf:'test',now:Date.now(),state:{people:[{id,name:id}],bms:[],events:[],sessions:{},farm}});
const farm=()=>({available:true,writable:true,fetchedAt:Date.now(),domains:[{id:'d',hostname:'example.com',active:true}],history:[],sites:['alice','bob'].map(owner=>({id:owner,owner,ownerName:owner,company:'Empresa '+owner,data:{cnpj:'123'},domain_id:'d',subdomain:owner,theme:'id01',status:'draft',version:1}))});
test('employee sees all sites and can inspect a colleague site without mutation controls',()=>{
 const {app}=ui();app.accept(response(farm()));
 assert(app.farmSites().includes('Empresa alice'));assert(app.farmSites().includes('Empresa bob'));
 app.select('bob');const detail=app.farmDetail();assert(detail.includes('Somente consulta'));assert(!detail.includes('farm-delete:bob'));assert(!detail.includes('farm-edit:bob'));assert(app.farmCanEdit(app.farmById('alice')));
});
test('temporary outage preserves last good list, marks it stale and blocks writes; account change clears it',()=>{
 const {app}=ui();app.accept(response(farm()));
 app.accept(response({available:false,sites:[],domains:[],history:[],error:'Limite diário',errorCode:'FARM_D1_READ_LIMIT'}));
 assert.equal(app.view().sites.length,2);assert.equal(app.view().stale,true);assert.equal(app.view().writable,false);assert.equal(app.farmCanEdit(app.farmById('alice')),false);
 app.accept(response({notRequested:true,available:false,sites:[],domains:[],history:[]}));assert.equal(app.view().sites.length,2);
 app.accept(response({notRequested:true,available:false,sites:[],domains:[],history:[]},'other'));assert.equal(app.view().sites.length,0);
});
test('background refresh outside Farm skips the D1 integration and overlapping requests coalesce',async()=>{
 const {app,context}=ui();app.accept(response(farm()));let requests=[];
 context.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>response({available:false,notRequested:true,sites:[],domains:[],history:[]})};};
 await Promise.all([app.refresh(),app.refresh()]);assert.deepEqual(requests,['/api/state?farm=0']);
 app.setPage('farm');await app.refresh(true);assert.equal(requests.at(-1),'/api/state');
});

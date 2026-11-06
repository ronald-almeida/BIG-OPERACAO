import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {emptyState} from '../src/store.mjs';
function ui(){
 const listeners={},root={innerHTML:'',addEventListener:(event,fn)=>listeners[event]=fn,querySelector:()=>null,querySelectorAll:()=>[],setAttribute(){},removeAttribute(){}};
 const context={document:{getElementById:()=>root,addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},structuredClone,console,crypto,Date};
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace('\ninitialize();','\nglobalThis.ui={accept,currentSessionMs,team,bms,renderEditor,renderDetail,setEditor:e=>editor=e,setDetail:d=>detail=d,activePeople};');
 vm.createContext(context);vm.runInContext(source,context);return {app:context.ui,context,listeners,root};
}
function fixture(){const s=emptyState();s.people=[{id:'EMP-A',name:'Alice',username:'alice',payPlans:{}},{id:'EMP-B',name:'Bruno',username:'bruno',removedAt:Date.now(),accessEnabled:false,payPlans:{}}];s.integrations={};s.serverPayroll={};s.profiles=[{id:'PRF-A',owner:'EMP-A',name:'Perfil'}];s.bms=[{id:'BM-A',owner:'EMP-A',name:'BM A',profiles:['PRF-A'],status:'Ativa',stock:'Disponível',capacity:250,created:'2026-11-01',registered:'2026-11-01',capacitySince:'2026-11-01',verificationStatus:'Não verificada',apiStatus:'Em análise'}];return s;}
test('journey clock resumes at 90 seconds and freezes while paused or awaiting presence',()=>{
 const {app}=ui(),now=Date.now();app.accept({state:fixture(),user:{id:'EMP-A',role:'employee',name:'Alice'},now});
 assert.equal(app.currentSessionMs({status:'paused',lastSessionMs:90000}),90000);
 const resumed=app.currentSessionMs({status:'active',accumulatedMs:90000,start:now,due:now+60000});assert(resumed>=90000&&resumed<91000);
 assert.equal(app.currentSessionMs({status:'pending',accumulatedMs:90000,start:now-30000,pending:now-10000}),110000);
 assert.equal(app.currentSessionMs({status:'paused',accumulatedMs:120000}),120000);
 assert.equal(app.currentSessionMs({status:'ended',accumulatedMs:120000}),120000);
});
test('admin removal controls preserve a separate archive and exclude removed teammates from new assignments',()=>{
 const {app}=ui();app.accept({state:fixture(),user:{id:'ADMIN',role:'admin',name:'Admin'},now:Date.now()});
 const screen=app.team();assert(screen.includes('person-remove:EMP-A'));assert(!screen.includes('person-remove:EMP-B'));assert(screen.includes('Cadastros removidos'));assert(screen.includes('person-restore:EMP-B'));
 app.setEditor({kind:'task'});assert(!app.renderEditor().includes('value="EMP-B"'));assert(app.renderEditor().includes('value="EMP-A"'));
});
test('both roles see separate BM and API statuses in inventory, detail and editor',()=>{
 for(const role of ['admin','employee']){
  const {app}=ui();app.accept({state:fixture(),user:{id:role==='admin'?'ADMIN':'EMP-A',role,name:'QA'},now:Date.now()});
  const inventory=app.bms();assert(inventory.includes('Verificação BM'));assert(inventory.includes('Não verificada'));assert(inventory.includes('Em análise'));
  app.setDetail({kind:'bm',id:'BM-A'});assert(app.renderDetail().includes('Status da API'));assert(app.renderDetail().includes('Verificação da BM'));
  app.setEditor({kind:'bm',id:'BM-A'});const editor=app.renderEditor();assert(editor.includes('name="verificationStatus" required'));assert(editor.includes('name="apiStatus" required'));assert(editor.includes('value="Não verificada" selected'));assert(editor.includes('value="Em análise" selected'));
 }
});

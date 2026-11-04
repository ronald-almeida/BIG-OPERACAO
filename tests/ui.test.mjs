import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {emptyState} from '../src/store.mjs';
test('all operational screens render with server state and no demo login',()=>{
 const root={innerHTML:'',addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},setAttribute(){},removeAttribute(){}};
 let source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 source=source.slice(0,source.lastIndexOf('\ninitialize();'))+`\nglobalThis.qa={accept,render,renderEditor,settings,loginScreen,setPage:p=>{page=p;editor=detail=null},setEditor:e=>editor=e,clearEditor:()=>editor=null};})();`;
 const context={document:{getElementById:()=>root,addEventListener(){}},crypto:globalThis.crypto,TextEncoder,Uint8Array,Date,Intl,structuredClone,console,setTimeout(){},clearTimeout(){}};
 vm.createContext(context);vm.runInContext(source,context);const q=context.qa;
 const state=emptyState();state.people=[{id:'EMP-A',name:'Alice',username:'alice',payPlans:{'2026-11':{fixed:2000,hours:160,overtimeRate:20}}}];state.integrations={vault:true,cloudflare:false};state.serverPayroll={};
 state.profiles=[{id:'PRF-A',name:'Perfil A',meta:'meta',login:'login',email:'',backup:'',owner:'EMP-A',status:'Ativo',proxy:'',created:'2026-11-01',note:''}];
 state.bms=[{id:'BM-A',name:'BM A',meta:'bmmeta',profiles:['PRF-A'],owner:'EMP-A',status:'Ativa',capacity:100000,capacitySince:'2026-11-01',created:'2026-11-01',registered:'2026-11-01',stock:'Disponível',purpose:'Revenda',producer:'EMP-A'}];
 q.accept({state,user:{id:'ADMIN',role:'admin',name:'Admin'},csrf:'test',now:Date.now()});
 for(const page of ['dashboard','profiles','bms','proxies','sales','costs','team','tasks','history','settings','farm','account']){q.setPage(page);assert.doesNotThrow(()=>q.render(),page);assert(root.innerHTML.includes('Big Operação'));}
 for(const kind of ['person','profile','bm','proxy','cost','sale','task']){q.setEditor({kind});assert.doesNotThrow(()=>q.render(),kind);assert(root.innerHTML.includes('<form'));}q.clearEditor();
 q.accept({state,user:{id:'EMP-A',role:'employee',name:'Alice'},csrf:'test',now:Date.now()});
 for(const page of ['journey','payments','profiles','bms','tasks','farm','account']){q.setPage(page);assert.doesNotThrow(()=>q.render(),page);assert(!root.innerHTML.includes('CONTROLES DA DEMONSTRAÇÃO'));}
 assert(!q.loginScreen().includes('demo12345'));
});

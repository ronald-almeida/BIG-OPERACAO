import { assert,HttpError,digest,token,hashPassword,verifyPassword,unseal,readBody,originCheck,throttle,cookie,identify } from './security.mjs';
import { loadState,mutate } from './store.mjs';
import { command,event,actorCheck,ownerCheck,settle,pause,dateAt } from './domain.mjs';
import { payroll,monthBounds } from './payroll.mjs';
import { farmCommand,publishCommand,connected } from './farm.mjs';
import { renderFarm } from './farm/farm-render.mjs';
import { lookupFarmCnpj } from './farm/farm-cnpj.mjs';

const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
function secure(response,panel=true){const r=new Response(response.body,response);for(const [k,v] of Object.entries({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Strict-Transport-Security':'max-age=31536000'}))r.headers.set(k,v);if(panel){r.headers.set('X-Frame-Options','DENY');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");}return r;}
function userView(state,actor,env,now){
  settle(state,now);const copy=structuredClone(state);delete copy.admin;
  copy.people=copy.people.map(({passwordHash,credentialVersion,planHistory,...p})=>p);
  copy.profiles=copy.profiles.map(({vault,...p})=>({...p,hasPassword:!!vault}));
  copy.integrations={cloudflare:connected(env),vault:/^[a-f0-9]{64}$/i.test(env.VAULT_KEY||'')};
  copy.serverPayroll={};
  for(const p of state.people)if(actor.role==='admin'||p.id===actor.id){copy.serverPayroll[p.id]={};for(const month of Object.keys(p.payPlans||{})){const q=payroll(state,p.id,month,now);if(actor.role!=='admin'){q.hours=q.normalHours;q.amount=q.normalAmount;q.extra=0;q.extraAmount=0;q.overtimeRate=null;q.overtimePending=false;q.plan={...q.plan,overtimeRate:null};}copy.serverPayroll[p.id][month]=q;}}
  if(actor.role==='admin')return copy;
  copy.people=copy.people.filter(p=>p.id===actor.id).map(p=>({...p,payPlans:Object.fromEntries(Object.entries(p.payPlans||{}).map(([m,v])=>[m,{...v,overtimeRate:null}]))}));
  copy.profiles=copy.profiles.filter(p=>p.owner===actor.id);
  copy.bms=copy.bms.filter(b=>b.owner===actor.id).map(b=>({...b,profiles:b.profiles.filter(pid=>copy.profiles.some(p=>p.id===pid))}));
  copy.proxies=copy.proxies.map(({id,name})=>({id,name}));copy.costs=[];copy.sales=[];
  copy.tasks=copy.tasks.filter(t=>t.owner===actor.id);copy.events=copy.events.filter(e=>e.employee===actor.id);
  copy.sessions=copy.sessions[actor.id]?{[actor.id]:copy.sessions[actor.id]}:{};
  // Send only normal credited intervals; the administrator retains the complete ledger.
  copy.journal=[];const p=state.people.find(x=>x.id===actor.id);
  for(const [month,plan] of Object.entries(p.payPlans||{})){
    const [a,b]=monthBounds(month);let used=0;
    for(const j of state.journal.filter(j=>j.employee===actor.id&&j.end>a&&j.start<b).sort((x,y)=>x.start-y.start)){
      const start=Math.max(j.start,a),end=Math.min(j.end,b),duration=j.end>j.start?j.duration*(end-start)/(j.end-j.start):0,credited=Math.max(0,Math.min(duration,plan.hours*3600000-used));used+=duration;
      if(credited)copy.journal.push({id:j.id+':'+month,employee:actor.id,start,end,duration:credited,reason:j.reason});
    }
  }
  copy.farm.domains=copy.farm.domains.map(d=>({...d,site_count:state.farm.sites.filter(s=>s.domain_id===d.id).length,otherSites:state.farm.sites.some(s=>s.domain_id===d.id&&s.owner!==actor.id),rootOccupied:state.farm.sites.some(s=>s.domain_id===d.id&&s.publish_mode==='root'&&s.snapshot)}));
  copy.farm.sites=copy.farm.sites.filter(s=>s.owner===actor.id);
  copy.farm.history=copy.farm.history.filter(h=>h.owner===actor.id);
  return copy;
}
async function stateResponse(env,actor,extra={}){const {state}=await loadState(env.DB);actorCheck(state,actor);const now=Date.now();return json({state:userView(state,actor,env,now),user:{id:actor.id,role:actor.role,name:actor.name},csrf:actor.session.csrf,now,...extra});}
async function api(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method,now=Date.now();
  assert(env.DB,'Banco de dados não configurado.',503);
  if(path==='/api/health'&&method==='GET'){await env.DB.prepare('SELECT id FROM workspace WHERE id=1').first();return json({ok:true});}
  if(method!=='GET')originCheck(request,env);
  const {state}=await loadState(env.DB);
  if(path==='/api/setup-status'&&method==='GET')return json({required:!state.admin,configured:!!env.BOOTSTRAP_TOKEN&&/^[a-f0-9]{64}$/i.test(env.VAULT_KEY||'')});
  if(path==='/api/setup'&&method==='POST'){
    await throttle(env.DB,'setup:'+request.headers.get('cf-connecting-ip'),5,900000);
    const d=await readBody(request);assert(!state.admin,'O administrador já foi criado.',409);assert(env.BOOTSTRAP_TOKEN?.length>=32&&typeof d.token==='string'&&digest(d.token)===digest(env.BOOTSTRAP_TOKEN),'Código de configuração inválido.',403);
    assert(/^[a-f0-9]{64}$/i.test(env.VAULT_KEY||''),'Configure VAULT_KEY antes de criar o administrador.',503);
    const username=String(d.username||'').trim().toLowerCase();assert(/^[a-z0-9._-]{3,40}$/.test(username),'Usuário inválido.');assert(typeof d.name==='string'&&d.name.trim().length>0&&d.name.length<=80,'Nome inválido.');const passwordHash=await hashPassword(d.password);
    await mutate(env.DB,'setup',crypto.randomUUID(),'setup',current=>{assert(!current.admin,'O administrador já foi criado.',409);current.admin={id:'ADMIN',name:d.name.trim(),username,passwordHash,credentialVersion:crypto.randomUUID(),accessEnabled:true};return {};});return json({ok:true});
  }
  if(path==='/api/login'&&method==='POST'){
    const d=await readBody(request),username=String(d.username||'').toLowerCase().trim();
    await throttle(env.DB,'login-ip:'+request.headers.get('cf-connecting-ip'),30,900000);
    await throttle(env.DB,'login-user:'+username,10,900000);
    const user=[state.admin,...state.people].find(p=>p?.username===username);
    const valid=await verifyPassword(d.password,user?.passwordHash);assert(valid&&user?.accessEnabled!==false,'Usuário ou senha inválidos.',401);
    const raw=token(),csrf=token();await env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,credential_version,expires,csrf) VALUES(?,?,?,?,?)').bind(digest(raw),user.id,user.credentialVersion,now+43200000,csrf).run();
    return json({ok:true},200,{'Set-Cookie':cookie(raw,43200,request)});
  }
  const actor=await identify(request,env.DB,state);assert(actor,'Entre na sua conta para continuar.',401);
  if(method!=='GET')assert(request.headers.get('x-csrf-token')===actor.session.csrf,'A sessão precisa ser atualizada.',403);
  if(path==='/api/state'&&method==='GET')return stateResponse(env,actor);
  if(path==='/api/logout'&&method==='POST'){
    await mutate(env.DB,actor.id,crypto.randomUUID(),'logout',current=>{if(actor.role==='employee')pause(current,actor.id,'Saída do sistema',now);return {};});
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(actor.session.token_hash).run();return json({ok:true},200,{'Set-Cookie':cookie('',0,request)});
  }
  if(path==='/api/account-password'&&method==='POST'){
    const d=await readBody(request),account=actor.id==='ADMIN'?state.admin:state.people.find(p=>p.id===actor.id);
    await throttle(env.DB,'password:'+actor.id,5,900000);assert(await verifyPassword(d.currentPassword,account.passwordHash),'Senha atual inválida.',403);const passwordHash=await hashPassword(d.password);
    await mutate(env.DB,actor.id,crypto.randomUUID(),'password',current=>{actorCheck(current,actor);const p=actor.id==='ADMIN'?current.admin:current.people.find(x=>x.id===actor.id);p.passwordHash=passwordHash;p.credentialVersion=crypto.randomUUID();event(current,actor,actor.id,'Acesso','Senha de acesso alterada');return {};});return json({ok:true},200,{'Set-Cookie':cookie('',0,request)});
  }
  if(path==='/api/credential'&&method==='POST'){
    const d=await readBody(request);await throttle(env.DB,'vault:'+actor.id,30,60000);ownerCheck(state.profiles.find(p=>p.id===d.id),actor);
    await mutate(env.DB,actor.id,crypto.randomUUID(),'reveal',current=>{actorCheck(current,actor);ownerCheck(current.profiles.find(p=>p.id===d.id),actor);event(current,actor,d.id,'Acesso','Consulta da credencial');return {};});
    const current=(await loadState(env.DB)).state;actorCheck(current,actor);const p=ownerCheck(current.profiles.find(p=>p.id===d.id),actor);return json({password:await unseal(p.vault,p.id,env)});
  }
  if(path==='/api/cnpj'&&method==='POST'){await throttle(env.DB,'cnpj:'+actor.id,10,60000);const d=await readBody(request);return json(await lookupFarmCnpj(d.cnpj));}
  if(path==='/api/command'&&method==='POST'){
    await throttle(env.DB,'command:'+actor.id,120,60000);const d=await readBody(request);
    assert(typeof d.cmd==='string'&&d.cmd.length<80&&(!d.id||typeof d.id==='string'),'Comando inválido.');
    const result=await mutate(env.DB,actor.id,request.headers.get('x-request-id'),digest(JSON.stringify(d)),async current=>d.cmd.startsWith('farm-')?farmCommand(current,actor,d.cmd,d.id,d.data||{},env,now):command(current,actor,d.cmd,d.id,d.data||{},env,now));
    return stateResponse(env,actor,{result});
  }
  if(path==='/api/farm-publish'&&method==='POST'){
    await throttle(env.DB,'publish:'+actor.id,20,60000);const d=await readBody(request);assert(['farm-publish','farm-unpublish','farm-verify'].includes(d.cmd),'Comando inválido.');
    const result=await publishCommand(env,actor,d.cmd,d.id,d.replace===true);return stateResponse(env,actor,{result});
  }
  throw new HttpError(404,'Rota não encontrada.');
}
async function publicFarm(request,env){
  if(!['GET','HEAD'].includes(request.method))return new Response('Método não permitido',{status:405});
  const url=new URL(request.url);if(!['/','/__farm-check'].includes(url.pathname))return new Response('Não encontrado',{status:404});
  const {state}=await loadState(env.DB);const site=state.farm.sites.find(s=>s.snapshot?.hostname===url.hostname&&state.farm.domains.some(d=>d.id===s.domain_id&&d.active));
  if(!site)return new Response('Site não publicado',{status:404,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/__farm-check')return json({service:'big-cloack-farm',site_id:site.id,version:site.snapshot.version});
  return new Response(request.method==='HEAD'?null:renderFarm(site.snapshot.data,site.snapshot.theme,site.snapshot.head),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
export default {
  async fetch(request,env){
    let panel=true;
    try{
      const url=new URL(request.url);assert(env.APP_ORIGIN,'Configure o endereço do painel no servidor.',503);
      panel=url.origin===env.APP_ORIGIN;
      if(!panel)return secure(await publicFarm(request,env),false);
      if(url.pathname.startsWith('/api/'))return secure(await api(request,env));
      if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Método não permitido.');
      if(!['/','/index.html','/app.js','/styles.css','/favicon.svg'].includes(url.pathname))throw new HttpError(404,'Não encontrado.');
      const r=await env.ASSETS.fetch(request);const out=secure(r);out.headers.set('Cache-Control','no-cache');return out;
    }catch(error){if(!(error instanceof HttpError))console.error('request_failed',error.name);return secure(json({error:error instanceof HttpError?error.message:'Não foi possível concluir. Tente novamente.'},error.status||500),panel);}
  },
  async scheduled(_controller,env){
    const now=Date.now();await mutate(env.DB,'system',crypto.randomUUID(),'clock',state=>{settle(state,now);return {};});
    await env.DB.batch([env.DB.prepare('DELETE FROM auth_sessions WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM requests WHERE created<?').bind(now-7*86400000)]);
  }
};

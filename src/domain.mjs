import { assert, hashPassword, seal } from './security.mjs';

export const dateAt=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bahia',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
export const id=prefix=>prefix+'-'+crypto.randomUUID();
export const txt=(v,max=180)=>{assert(typeof v==='string'&&v.trim().length<=max,'Texto inválido ou muito longo.');return v.trim();};
const required=(v,max)=>{const s=txt(v,max);assert(s,'Preencha os campos obrigatórios.');return s;};
export const num=(v,min=0,max=1e6)=>{const n=Number(v);assert(v!==''&&v!==null&&Number.isFinite(n)&&n>=min&&n<=max,'Valor numérico inválido.');return n;};
const choice=(v,values)=>{assert(values.includes(v),'Opção inválida.');return v;};
const date=(v,now,future=false)=>{assert(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v&&(future||v<=dateAt(now)),'Data inválida.');return v;};
export const ownerCheck=(record,actor)=>{assert(record,'Registro não encontrado.',404);assert(actor.role==='admin'||record.owner===actor.id,'Acesso não autorizado.',403);return record;};
export const adminCheck=actor=>assert(actor.role==='admin','Apenas o administrador pode fazer isso.',403);
export function actorCheck(state,actor){const p=actor.id==='ADMIN'?state.admin:state.people.find(p=>p.id===actor.id);assert(p&&p.accessEnabled!==false&&(!actor.session||p.credentialVersion===actor.session.credential_version),'Sua sessão expirou.',401);}
const owner=(state,v,actor)=>{const own=actor.role==='admin'?v:actor.id;assert(state.people.some(p=>p.id===own),'Cadastre um funcionário responsável.');return own;};
export function event(state,actor,entity,type,text,now=Date.now()){
  state.events.unshift({id:id('EVT'),entity,type,text,who:actor.name,employee:actor.role==='employee'?actor.id:null,date:dateAt(now),time:new Date(now).toLocaleTimeString('pt-BR',{timeZone:'America/Bahia',hour:'2-digit',minute:'2-digit'}),at:now});
}
export function session(state,employee){return state.sessions[employee]??={status:'idle',total:0,start:null,due:null,pending:null,remaining:null,last:null,windowStart:null};}
function interval(settings){const r=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;return (settings.mode==='fixed'?settings.fixed:settings.min+r*(settings.max-settings.min))*60000;}
function closeWindow(state,s,employee,end,reason){const start=s.windowStart??s.start;if(start!==null&&end>start)state.journal.push({id:id('JRN'),employee,start,end,duration:end-start,reason});s.windowStart=end;}
export function pause(state,employee,reason,at){const s=session(state,employee);if(!['active','pending'].includes(s.status))return;const end=s.status==='pending'?Math.min(at,s.pending):Math.min(at,s.due);s.lastSessionMs=Math.max(0,end-s.start);closeWindow(state,s,employee,end,reason);s.total+=s.lastSessionMs;s.remaining=reason==='Pausa manual'?Math.max(1000,s.due-end):null;s.start=null;s.due=null;s.pending=null;s.status='paused';}
export function settle(state,now=Date.now()){
  for(const [employee,s] of Object.entries(state.sessions)){
    if(s.status==='active'&&now>=s.due){s.pending=s.due;s.status='pending';}
    if(s.status==='pending'&&now>=s.pending+state.settings.grace*60000)pause(state,employee,'Sem confirmação',s.pending);
  }
}
export function timeCommand(state,actor,cmd,now){
  assert(actor.role==='employee','Jornada disponível na conta do funcionário.',403);
  settle(state,now);const s=session(state,actor.id);
  if(cmd==='start'&&!['active','pending'].includes(s.status)){Object.assign(s,{status:'active',start:now,windowStart:now,due:now+(s.remaining||interval(state.settings)),pending:null,remaining:null,last:now});event(state,actor,actor.id,'Jornada','Sessão de trabalho iniciada',now);}
  else if(cmd==='pause')pause(state,actor.id,'Pausa manual',now);
  else if(cmd==='end'){pause(state,actor.id,'Encerramento',now);s.status='ended';event(state,actor,actor.id,'Jornada','Expediente encerrado',now);}
  else if(cmd==='confirm'){assert(s.status==='pending','Não há confirmação pendente.');closeWindow(state,s,actor.id,now,'Presença confirmada');Object.assign(s,{status:'active',pending:null,due:now+interval(state.settings),last:now});event(state,actor,actor.id,'Presença','Presença confirmada',now);}
}
export function attributedCost(state,bid){
  let total=0;
  for(const c of state.costs){
    if(c.target===bid){total+=c.amount;continue;}
    const pids=c.target.startsWith('PRX-')?state.profiles.filter(p=>p.proxy===c.target).map(p=>p.id):[c.target];
    const related=state.bms.filter(b=>b.profiles.some(p=>pids.includes(p)));
    if(related.some(b=>b.id===bid))total+=c.amount/related.length;
  }return total;
}
export async function command(state,actor,cmd,entity,d,env,now=Date.now()){
  actorCheck(state,actor);settle(state,now);
  const day=dateAt(now),isAdmin=actor.role==='admin';
  if(['start','pause','end','confirm'].includes(cmd)){timeCommand(state,actor,cmd,now);return {};}
  if(cmd==='settings'){adminCheck(actor);state.settings={mode:choice(d.mode,['fixed','variable']),fixed:num(d.fixed,1,240),min:num(d.min,1,240),max:num(d.max,1,240),grace:num(d.grace,1,10),stuck:num(d.stuck,1,180)};assert(state.settings.max>=state.settings.min,'Intervalo máximo menor que o mínimo.');event(state,actor,'Configurações','Configuração','Regras de jornada atualizadas',now);return {};}
  if(cmd==='person'){
    adminCheck(actor);const month=required(d.month,7);assert(/^20\d{2}-(0[1-9]|1[0-2])$/.test(month),'Mês inválido.');
    let p=entity?state.people.find(x=>x.id===entity):null;if(entity)assert(p,'Funcionário não encontrado.',404);
    const username=required(d.username,40).toLowerCase();assert(/^[a-z0-9._-]{3,40}$/.test(username),'Usuário inválido.');
    assert(![state.admin,...state.people].some(x=>x?.username===username&&x.id!==entity),'Usuário já cadastrado.',409);
    if(!p){p={id:id('EMP'),role:'Operador',payPlans:{}};state.people.push(p);}
    if(!p.passwordHash||d.accessPassword){p.passwordHash=await hashPassword(d.accessPassword);p.credentialVersion=crypto.randomUUID();}
    p.name=required(d.name,80);p.username=username;p.accessEnabled=choice(d.accessEnabled,['yes','no'])==='yes';
    const before=p.payPlans[month]??null;
    p.payPlans[month]={fixed:num(d.fixed),hours:num(d.hours,.01,744),overtimeRate:d.overtimeRate===''?null:num(d.overtimeRate,.01),limit:true};
    p.planHistory??=[];p.planHistory.push({month,before,after:{...p.payPlans[month]},by:actor.id,at:now});
    if(!p.accessEnabled){p.credentialVersion=crypto.randomUUID();pause(state,p.id,'Acesso desativado',now);}
    event(state,actor,p.id,'Equipe','Acesso e remuneração de '+month+' atualizados',now);return {id:p.id};
  }
  if(cmd==='profile'){
    let p=entity?ownerCheck(state.profiles.find(x=>x.id===entity),actor):null;
    const meta=required(d.meta,300);assert(!state.profiles.some(x=>x.meta===meta&&x.id!==entity),'Identificador do perfil já cadastrado.',409);
    const fresh=!p,previous=p?.status;if(!p){p={id:id('PRF')};state.profiles.push(p);}
    const proxy=txt(d.proxy||'',80);assert(!proxy||state.proxies.some(x=>x.id===proxy),'Proxy inválido.');
    Object.assign(p,{name:required(d.name,80),meta,login:txt(d.login||'',200),email:txt(d.email||'',200),backup:txt(d.backup||'',200),owner:owner(state,d.owner,actor),status:choice(d.status,['Ativo','Em revisão','Desativado']),proxy,created:date(d.created,now),note:txt(d.note||'',2000)});
    if(d.demoPassword){p.vault=await seal(d.demoPassword,p.id,env);event(state,actor,p.id,'Credencial','Senha do cadastro atualizada',now);}
    event(state,actor,p.id,fresh?'Perfil cadastrado':'Atualização',fresh?'Perfil cadastrado':'Cadastro do perfil atualizado',now);
    if(!fresh&&previous!==p.status)event(state,actor,p.id,p.status==='Ativo'?'Perfil ativado':'Situação',`Perfil: ${previous} → ${p.status}`,now);
    return {id:p.id};
  }
  if(cmd==='password'){
    const p=ownerCheck(state.profiles.find(p=>p.id===entity),actor);assert(d.demoPassword===d.confirmPassword,'As senhas não coincidem.');assert(d.demoPassword,'Informe a senha.');p.vault=await seal(d.demoPassword,p.id,env);event(state,actor,p.id,'Credencial','Senha do cadastro atualizada',now);return {};
  }
  if(cmd==='bm'){
    let b=entity?ownerCheck(state.bms.find(x=>x.id===entity),actor):null;
    const meta=required(d.meta,80);assert(!state.bms.some(x=>x.meta===meta&&x.id!==entity),'ID da Meta já cadastrado.',409);
    assert(Array.isArray(d.profiles)&&d.profiles.length>0&&d.profiles.length<=100,'Vincule ao menos um perfil.');
    const profiles=[...new Set(d.profiles)];for(const pid of profiles)ownerCheck(state.profiles.find(p=>p.id===pid),actor);
    const fresh=!b,previous=b?{...b}:null;if(!b){b={id:id('BM'),registered:day,capacitySince:day};state.bms.push(b);}
    if(previous&&!isAdmin)profiles.push(...previous.profiles.filter(pid=>!state.profiles.some(p=>p.id===pid&&p.owner===actor.id)));
    const assigned=owner(state,d.owner,actor);const capacity=choice(Number(d.capacity),[0,250,2000,10000,100000,-1]);
    Object.assign(b,{name:required(d.name,80),meta,status:choice(d.status,['Em preparação','Em análise','Ativa','Restrita','Desativada']),capacity,owner:assigned,purpose:choice(d.purpose,['Operação própria','Cliente','Revenda']),stock:previous?.stock==='Vendida'?'Vendida':choice(d.stock,['Disponível','Reservada']),created:fresh&&d.origin==='new'?day:date(d.created,now),profiles:[...new Set(profiles)],note:txt(d.note||'',1000)});
    if(fresh)b.producer=d.origin==='new'?assigned:null;if(b.status==='Ativa')b.ready=true;
    if(previous&&previous.capacity!==capacity){b.capacitySince=day;event(state,actor,b.id,'Capacidade',`Faixa alterada de ${previous.capacity} para ${capacity===2000?'2K':capacity===10000?'10K':capacity===100000?'100K':capacity===-1?'Ilimitado':capacity}`,now);}
    if(previous&&previous.status!==b.status)event(state,actor,b.id,'Situação',`${previous.status} → ${b.status}`,now);
    event(state,actor,b.id,fresh?(d.origin==='new'?'Criação':'Cadastro'):'Atualização',fresh?(d.origin==='new'?'BM criada e cadastrada':'BM existente cadastrada'):'Cadastro da BM atualizado',now);return {id:b.id};
  }
  if(cmd==='task-toggle'){
    const t=ownerCheck(state.tasks.find(t=>t.id===entity),actor);assert(typeof d.done==='boolean','Situação inválida.');t.done=d.done;t.completedDate=t.done?day:null;t.completedAt=t.done?now:null;event(state,actor,t.id,'Tarefa',`${t.done?'Concluída':'Reaberta'}: ${t.text}`,now);return {};
  }
  adminCheck(actor);
  if(cmd==='sale'){
    const b=state.bms.find(x=>x.id===d.bm);assert(b&&b.status==='Ativa'&&b.stock!=='Vendida'&&!state.sales.some(x=>x.bm===b.id),'BM indisponível para venda.',409);assert(b.profiles.includes(d.profile),'Perfil não vinculado.');
    const sale={id:id('VND'),bm:b.id,profile:d.profile,client:required(d.client,80),amount:num(d.amount,.01),date:date(d.date,now),paid:choice(d.paid,['yes','no'])==='yes',cost:Math.round(attributedCost(state,b.id)*100)/100};state.sales.push(sale);b.stock='Vendida';event(state,actor,b.id,'Venda',sale.id+': venda registrada; BM retirada do estoque',now);return {id:sale.id};
  }
  if(cmd==='receive'||cmd==='pay'){const row=(cmd==='pay'?state.costs:state.sales).find(x=>x.id===entity);assert(row,'Registro não encontrado.',404);row.paid=true;event(state,actor,row.bm||row.target,cmd==='pay'?'Custo':'Recebimento',row.id+': pagamento confirmado',now);return {};}
  if(cmd==='proxy'){let p=entity?state.proxies.find(x=>x.id===entity):null;if(entity)assert(p,'Proxy não encontrado.',404);if(!p){p={id:id('PRX')};state.proxies.push(p);}Object.assign(p,{name:required(d.name,100),amount:num(d.amount),renewal:date(d.renewal,now,true)});event(state,actor,p.id,'Proxy','Cadastro do proxy atualizado',now);return {id:p.id};}
  if(cmd==='cost'){const target=required(d.target,80);assert([...state.profiles,...state.bms,...state.proxies].some(x=>x.id===target),'Vínculo inválido.');const c={id:id('CST'),label:required(d.label,180),type:choice(d.type,['Aquisição','Manutenção','Produção']),target,amount:num(d.amount,.01),date:date(d.date,now),paid:choice(d.paid,['yes','no'])==='yes'};state.costs.push(c);event(state,actor,target,'Custo',c.id+': custo registrado',now);return {id:c.id};}
  if(cmd==='task'){const assigned=owner(state,d.owner,actor),bm=txt(d.bm||'',80);assert(!bm||state.bms.some(b=>b.id===bm&&b.owner===assigned),'BM indisponível para este funcionário.');const t={id:id('TSK'),owner:assigned,text:required(d.text,180),bm,done:false};state.tasks.push(t);event(state,actor,t.id,'Tarefa','Tarefa atribuída',now);return {id:t.id};}
  if(cmd==='adjust'){const j=state.journal.find(j=>j.id===entity);assert(j,'Intervalo não encontrado.',404);const duration=num(d.minutes,0,1440)*60000,reason=required(d.reason,180);assert(reason.length>=5,'Informe uma justificativa.');j.originalDuration??=j.duration;j.corrections??=[];j.corrections.push({before:j.duration,after:duration,reason,by:actor.name,at:now});j.duration=duration;event(state,actor,j.id,'Ajuste de jornada',reason,now);return {};}
  assert(false,'Operação desconhecida.',404);
}

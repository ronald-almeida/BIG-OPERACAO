import { farmThemes, farmSlug, farmHostname } from '../shared/farm.mjs';
import { normalizeCnpj } from './farm/cnpj.mjs';
import { assert } from './security.mjs';
import { actorCheck, ownerCheck, event, id, txt, num } from './domain.mjs';
import { farmZone, bindFarm, unbindFarm, verifyFarm } from './farm/cloudflare.mjs';
import { mutate, loadState } from './store.mjs';

export const connected=env=>!!env.CLOUDFLARE_API_TOKEN&&/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID||'');
function history(state,actor,site,action,message,now){state.farm.history.unshift({id:id('FDL'),site:site?.id||null,company:site?.company||'',owner:site?.owner||actor.id,action,message,who:actor.name,at:now,date:new Date(now-10800000).toISOString().slice(0,10)});event(state,actor,site?.id||'FARM','Farm · '+action,message,now);}
function domainAccess(state,domain,actor){assert(domain,'Domínio não encontrado.',404);assert(actor.role==='admin'||domain.owner===actor.id&&!state.farm.sites.some(s=>s.domain_id===domain.id&&s.owner!==actor.id),'Domínio compartilhado: solicite a alteração ao administrador.',403);}
export async function farmCommand(state,actor,cmd,entity,d,env,now=Date.now()){
  actorCheck(state,actor);
  const lease=await env.DB.prepare('SELECT id FROM external_locks WHERE id=? AND expires>?').bind('farm',now).first();
  assert(!lease,'Aguarde a publicação em andamento antes de alterar a Farm.',409);
  if(cmd==='farm-domain'){
    const old=entity?state.farm.domains.find(d=>d.id===entity):null;if(entity)domainAccess(state,old,actor);
    const hostname=txt(d.hostname,253).toLowerCase();assert(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname),'Informe apenas o domínio.');
    assert(hostname!==new URL(env.APP_ORIGIN).hostname,'Este endereço está reservado para o painel.');assert(!state.farm.domains.some(x=>x.hostname===hostname&&x.id!==entity),'Domínio já cadastrado.',409);
    assert(!old||old.hostname===hostname,'O domínio cadastrado não pode ser renomeado.');
    const limit=d.site_limit===''||d.site_limit===null?null:num(d.site_limit,0,100000);assert(limit===null||Number.isInteger(limit),'Limite deve ser inteiro.');
    const domain=old??{id:id('FDM'),hostname,active:true,owner:actor.id,created:now};domain.site_limit=limit;if(!old)state.farm.domains.push(domain);
    history(state,actor,null,'Domínio',hostname+': cadastro atualizado',now);return {id:domain.id};
  }
  if(cmd.startsWith('farm-domain-')){
    const domain=state.farm.domains.find(x=>x.id===entity);domainAccess(state,domain,actor);
    if(cmd==='farm-domain-toggle'){assert(typeof d.active==='boolean','Situação inválida.');domain.active=d.active;}
    else if(cmd==='farm-domain-delete'){assert(!state.farm.sites.some(s=>s.domain_id===entity),'Mova ou exclua os sites primeiro.');state.farm.domains=state.farm.domains.filter(x=>x.id!==entity);}
    else assert(false,'Operação desconhecida.',404);
    history(state,actor,null,'Domínio',domain.hostname+': alteração registrada',now);return {};
  }
  if(cmd==='farm-site'){
    const old=entity?ownerCheck(state.farm.sites.find(s=>s.id===entity),actor):null;
    const data={};for(const k of ['cnpj','razao','fantasia','abertura','atividade','cidade','uf','telefone','email'])data[k]=txt(d.data?.[k]||'',k==='atividade'?500:200);
    try{data.cnpj=normalizeCnpj(data.cnpj);}catch(error){assert(false,error.message);}assert(data.razao,'Informe a razão social.');data.uf=data.uf.slice(0,2).toUpperCase();data.telefone=data.telefone.replace(/\D/g,'');
    assert(farmThemes.some(t=>t.id===d.theme),'Escolha um modelo.');assert(['root','subdomain'].includes(d.publish_mode),'Modo inválido.');
    const subdomain=d.publish_mode==='root'?null:txt(d.subdomain||farmSlug(data.fantasia||data.razao),63).toLowerCase();
    assert(subdomain===null||/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)&&!['www','api','admin','mail','ftp'].includes(subdomain),'Subdomínio inválido.');
    const count=domain=>state.farm.sites.filter(s=>s.domain_id===domain.id&&s.id!==entity).length;
    const unique=domain=>!state.farm.sites.some(s=>s.domain_id===domain.id&&s.subdomain===subdomain&&subdomain!==null&&s.id!==entity);
    const eligible=domain=>domain.active&&unique(domain)&&(domain.site_limit===null||count(domain)<domain.site_limit);
    const domain=d.domain_id?state.farm.domains.find(x=>x.id===d.domain_id):state.farm.domains.filter(eligible).sort((a,b)=>count(a)-count(b)||a.created-b.created)[0];
    assert(domain,'Cadastre um domínio com capacidade disponível.');assert(unique(domain),'Subdomínio em uso.',409);
    const moved=old&&(old.domain_id!==domain.id||old.subdomain!==subdomain||old.publish_mode!==d.publish_mode);
    if(!old||old.domain_id!==domain.id)assert(eligible(domain),'Domínio inativo ou sem capacidade.');
    if(moved)assert(domain.active&&!old.snapshot,'Retire a publicação antes de mudar o endereço.');
    const hostname=farmHostname({subdomain,publish_mode:d.publish_mode},domain);assert(hostname!==new URL(env.APP_ORIGIN).hostname,'Endereço reservado para o painel.');
    const assigned=actor.role==='admin'?d.owner:actor.id;assert(assigned==='ADMIN'||state.people.some(p=>p.id===assigned&&!p.removedAt),'Selecione um responsável da equipe.');
    if(d.bm)ownerCheck(state.bms.find(b=>b.id===d.bm),actor);
    const site={...old,id:old?.id??id('FST'),owner:assigned,bm:d.bm||'',domain_id:domain.id,data,theme:d.theme,head:txt(d.head||'',32000),publish_mode:d.publish_mode,subdomain,company:data.fantasia||data.razao,version:(old?.version||0)+1,created:old?.created||now,updated:now,status:old?.status||'draft',snapshot:old?.snapshot||null};
    if(old)Object.assign(old,site);else state.farm.sites.push(site);history(state,actor,site,old?'Edição':'Site criado','Rascunho salvo',now);return {id:site.id};
  }
  if(cmd==='farm-delete'){
    const site=ownerCheck(state.farm.sites.find(s=>s.id===entity),actor);assert(!site.snapshot,'Retire a publicação antes de excluir o site.');history(state,actor,site,'Exclusão','Rascunho excluído',now);state.farm.sites=state.farm.sites.filter(s=>s.id!==entity);return {};
  }
  assert(false,'Operação da Farm desconhecida.',404);
}

// External DNS operations cannot be part of a D1 transaction. A short global lease
// prevents publish/unpublish races; each external action is retryable after failure.
export async function publishCommand(env,actor,cmd,siteId,replace=false){
  assert(connected(env),'Conecte a conta Cloudflare para publicar. O rascunho permanece salvo.',503);
  const lease=crypto.randomUUID(),now=Date.now();
  const lock=await env.DB.prepare('INSERT INTO external_locks(id,lease,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires WHERE external_locks.expires<? RETURNING lease').bind('farm',lease,now+180000,now).first();
  assert(lock?.lease===lease,'Outra publicação está em andamento. Aguarde.',409);
  try{
    // Invalidate mutations that read an earlier snapshot before this lease.
    await env.DB.prepare('UPDATE workspace SET revision=revision+1 WHERE id=1').run();
    const {state}=await loadState(env.DB);actorCheck(state,actor);
    const site=ownerCheck(state.farm.sites.find(s=>s.id===siteId),actor),domain=state.farm.domains.find(d=>d.id===site.domain_id);
    assert(domain,'Domínio não encontrado.',404);
    const write=fn=>mutate(env.DB,actor.id,crypto.randomUUID(),cmd+':'+siteId,async current=>{actorCheck(current,actor);return fn(current,current.farm.sites.find(x=>x.id===siteId));});
    if(cmd==='farm-unpublish'){
      assert(site.snapshot,'Este site não tem publicação para retirar.');
      const zone=await farmZone(env,domain.hostname);await unbindFarm(env,site,{...domain,zone_id:zone.id});
      return write((current,s)=>{ownerCheck(s,actor);s.snapshot=null;s.status='draft';history(current,actor,s,'Retirada','Publicação retirada',Date.now());return {};});
    }
    assert(domain.active,'Ative o domínio antes de publicar.');
    if(cmd==='farm-verify'){
      assert(site.snapshot,'Não há publicação para verificar.');const ready=await verifyFarm({...site,published_version:site.snapshot.version},domain);
      return write((current,s)=>{assert(s?.snapshot?.version===site.snapshot.version,'A versão mudou. Tente novamente.',409);s.status=ready?'ready':'provisioning';return {ready};});
    }
    const occupant=site.publish_mode==='root'?state.farm.sites.find(s=>s.id!==site.id&&s.domain_id===domain.id&&s.publish_mode==='root'&&s.snapshot):null;
    if(occupant){ownerCheck(occupant,actor);assert(replace,'Confirme a substituição do site que está na raiz.',409);}
    const zone=await farmZone(env,domain.hostname);assert(zone.status==='active','A zona Cloudflare ainda não está ativa. Confira os nameservers.');
    const binding=await bindFarm(env,site,{...domain,zone_id:zone.id});
    await write((current,s)=>{
      ownerCheck(s,actor);assert(s.version===site.version&&current.farm.domains.find(x=>x.id===domain.id)?.active,'O site mudou durante a publicação. Tente novamente.',409);
      const occupying=current.farm.sites.find(x=>x.id!==s.id&&x.domain_id===domain.id&&x.publish_mode==='root'&&s.publish_mode==='root'&&x.snapshot);
      if(occupying){ownerCheck(occupying,actor);assert(replace,'Confirme a substituição.',409);occupying.snapshot=null;occupying.status='draft';history(current,actor,occupying,'Substituição','Preservado como rascunho',Date.now());}
      s.snapshot={data:structuredClone(s.data),theme:s.theme,head:s.head,version:s.version,hostname:farmHostname(s,domain)};s.cloudflare_domain_id=binding.id;s.status='provisioning';history(current,actor,s,'Publicação','Versão '+s.version+' enviada; verificando HTTPS',Date.now());return {};
    });
    const ready=await verifyFarm({...site,published_version:site.version},domain);
    return write((current,s)=>{if(s?.snapshot?.version===site.version)s.status=ready?'ready':'provisioning';return {ready};});
  }finally{await env.DB.prepare('DELETE FROM external_locks WHERE id=? AND lease=?').bind('farm',lease).run();}
}

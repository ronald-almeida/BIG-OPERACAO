import { assert, HttpError } from './security.mjs';
import { actorCheck, ownerCheck } from './domain.mjs';

export const externalFarm = env => !!env.FARM_BRIDGE_URL;
async function call(env,actor,input){
  const url=new URL(env.FARM_BRIDGE_URL);
  assert(url.protocol==='https:'&&url.pathname==='/api/operacao-farm'&&!url.search&&!url.username&&!url.password,'Integração Farm inválida.',503);
  assert(env.FARM_BRIDGE_SECRET?.length>=32,'Configure o acesso à Farm no servidor.',503);
  let response;
  try{response=await fetch(url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.FARM_BRIDGE_SECRET},body:JSON.stringify({...input,actor:{id:actor.id,role:actor.role,name:actor.name}}),signal:AbortSignal.timeout(60000)});}
  catch{assert(false,'Não foi possível confirmar a operação da Farm. Atualize para conferir o estado antes de repetir.',503);}
  assert(response.status<300||response.status>=400,'A integração Farm retornou um endereço inesperado.',503);
  let result;try{result=await response.json();}catch{assert(false,'A integração Farm está indisponível.',503);}
  if(!response.ok)throw Object.assign(new HttpError(response.status,result.error||'Não foi possível concluir a operação da Farm.'),{code:result.code,retryAt:result.retryAt});
  return result;
}
export async function attachFarm(env,actor,state){
  const result=await call(env,actor,{action:'state'});
  assert(result.farm?.source==='cloudflare-d1'&&Array.isArray(result.farm.sites),'Resposta inválida da Farm.',503);
  state.farm=result.farm;
  if(env.FARM_BRIDGE_READ_ONLY==='true')state.farm.writable=false;
  // Farm events stay authoritative in D1; they are projected into the view only.
  // A failed Neon write can never lose or duplicate a Farm delivery.
  state.events=[...state.events.filter(e=>!e.id.startsWith('FARM-')),...result.events].sort((a,b)=>b.at-a.at);
}
export async function externalFarmCommand(env,actor,state,input,requestId){
  actorCheck(state,actor);
  assert(env.FARM_BRIDGE_READ_ONLY!=='true','A Farm está em modo de conferência neste ambiente.',409);
  const data={...input.data};
  if(input.cmd==='farm-site'){
    data.owner=actor.role==='admin'?(data.owner||'ADMIN'):actor.id;
    assert(data.owner==='ADMIN'||state.people.some(p=>p.id===data.owner&&!p.removedAt),'Selecione um responsável da equipe.');
    if(data.bm)ownerCheck(state.bms.find(b=>b.id===data.bm),actor);
  }
  return call(env,actor,{action:'command',cmd:input.cmd,id:input.id||null,data,replace:input.replace,requestId});
}

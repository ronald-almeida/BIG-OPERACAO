import { assert } from './security.mjs';

const arrays=['people','profiles','bms','proxies','costs','sales','events','tasks','journal'];
export function emptyState(){return {version:1,payrollVersion:1,overtimeVersion:1,admin:null,...Object.fromEntries(arrays.map(k=>[k,[]])),sessions:{},settings:{mode:'variable',fixed:60,min:45,max:75,grace:2,stuck:7},farm:{domains:[],sites:[],history:[],version:1}};}
export function flatten(state){
  const rows=new Map();const add=(collection,id,data)=>rows.set(collection+'\0'+id,{collection,id,data:JSON.stringify(data)});
  for(const key of arrays)for(const item of state[key])add(key,item.id,item);
  for(const key of ['domains','sites','history'])for(const item of state.farm[key])add('farm_'+key,item.id,item);
  for(const [id,data] of Object.entries(state.sessions))add('sessions',id,data);
  add('settings','main',state.settings);
  if(state.admin)add('admin','ADMIN',state.admin);
  return rows;
}
export async function loadState(db,requestKey){
  // Include the receipt in the same snapshot: a duplicate must never see a sale
  // committed after a separate receipt lookup and treat it as a new operation.
  const statements=[db.prepare('SELECT revision FROM workspace WHERE id=1'),db.prepare('SELECT collection,id,data FROM records')];
  if(requestKey!==undefined)statements.push(db.prepare('SELECT actor,fingerprint,result FROM requests WHERE id=?').bind(requestKey));
  const [meta,records,receipts]=await db.batch(statements);
  const state=emptyState();
  for(const row of records.results){const d=JSON.parse(row.data);if(arrays.includes(row.collection))state[row.collection].push(d);else if(row.collection.startsWith('farm_'))state.farm[row.collection.slice(5)].push(d);else if(row.collection==='sessions')state.sessions[row.id]=d;else if(row.collection==='admin')state.admin=d;else if(row.collection==='settings')state.settings=d;}
  state.events.sort((a,b)=>b.at-a.at);state.journal.sort((a,b)=>a.start-b.start);state.farm.history.sort((a,b)=>b.at-a.at);
  return {state,revision:meta.results[0].revision,receipt:receipts?.results[0]??null};
}
export async function mutate(db, actor, requestId, fingerprint, apply){
  assert(/^[a-zA-Z0-9-]{16,80}$/.test(requestId||''),'Identificador da requisição obrigatório.');
  const key=actor+':'+requestId;
  for(let attempt=0;attempt<5;attempt++){
    const {state,revision,receipt}=await loadState(db,key);
    if(receipt){assert(receipt.fingerprint===fingerprint,'Identificador reutilizado com outra operação.',409);return JSON.parse(receipt.result);}
    const before=flatten(state);
    const result=await apply(state);
    const after=flatten(state),op=crypto.randomUUID();
    const statements=[db.prepare('UPDATE workspace SET revision=revision+1,mutation_id=? WHERE id=1 AND revision=?').bind(op,revision)];
    for(const [k,row] of after)if(before.get(k)?.data!==row.data)statements.push(db.prepare('INSERT INTO records(collection,id,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND mutation_id=?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').bind(row.collection,row.id,row.data,op));
    for(const [k,row] of before)if(!after.has(k))statements.push(db.prepare('DELETE FROM records WHERE collection=? AND id=? AND EXISTS(SELECT 1 FROM workspace WHERE id=1 AND mutation_id=?)').bind(row.collection,row.id,op));
    statements.push(db.prepare('INSERT INTO requests(id,actor,fingerprint,result,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=1 AND mutation_id=?)').bind(key,actor,fingerprint,JSON.stringify(result??{}),Date.now(),op));
    const done=await db.batch(statements);
    if(done[0].meta.changes)return result??{};
  }
  assert(false,'A operação mudou em outra tela. Atualize e tente novamente.',409);
}

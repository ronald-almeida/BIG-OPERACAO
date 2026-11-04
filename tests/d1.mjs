import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(path=':memory:'){
  const sqlite=new DatabaseSync(path);
  if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE name='workspace'").get())sqlite.exec(readFileSync(new URL('../migrations/0001_core.sql',import.meta.url),'utf8'));
  const wrap=(sql,args=[])=>({sql,args,bind(...values){return wrap(sql,values);},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args),success:true};},async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}});
  return {sqlite,prepare:sql=>wrap(sql),async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(({sql,args})=>{const stmt=sqlite.prepare(sql);if(/^SELECT|RETURNING/i.test(sql)||/ RETURNING /i.test(sql))return {results:stmt.all(...args),success:true,meta:{changes:0}};const r=stmt.run(...args);return {success:true,results:[],meta:{changes:Number(r.changes)}};});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}

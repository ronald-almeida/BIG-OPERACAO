import { neon, neonConfig } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import { after } from 'node:test';
import { postgresAdapter } from '../src/postgres.mjs';
// Cloudflare/DNS mocks in publication tests must not intercept Neon SQL transport.
neonConfig.fetchFunction = globalThis.fetch;

export async function database() {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('Testes Neon exigem ambiente preview.');
  const sql=neon(process.env.DATABASE_URL,{fullResults:true});
  const schema='qa_'+crypto.randomUUID().replaceAll('-','');
  await sql.query('CREATE SCHEMA '+schema);
  after(()=>sql.query('DROP SCHEMA '+schema+' CASCADE'));
  const transaction=(statements,options={})=>sql.transaction([
    sql.query("SELECT set_config('search_path',$1,true)",[schema]),
    ...statements.map(s=>sql.query(s.sql,s.args||[])),
  ],{...options,fullResults:true}).then(r=>r.slice(1));
  const source=await readFile(new URL('../migrations/postgres/0001_core.sql',import.meta.url),'utf8');
  await transaction([{sql:'DO $schema$ BEGIN '+source+' END; $schema$'}]);
  const query=async(text,args)=>(await transaction([{sql:text,args}]))[0];
  return {...postgresAdapter({query,transaction}),pg:{query}};
}

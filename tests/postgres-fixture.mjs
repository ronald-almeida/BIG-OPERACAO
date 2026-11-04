import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { after } from 'node:test';
import { postgresAdapter } from '../src/postgres.mjs';

export async function database() {
  const pg = new PGlite();
  after(() => pg.close());
  await pg.exec(await readFile(new URL('../migrations/postgres/0001_core.sql', import.meta.url), 'utf8'));
  const normalize = r => ({ ...r, rowCount: r.affectedRows ?? 0 });
  const db = postgresAdapter({
    query: async (text, args) => normalize(await pg.query(text, args)),
    transaction: (statements, options) => pg.transaction(async tx => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL ' + (options.readOnly ? 'REPEATABLE READ READ ONLY' : 'READ COMMITTED'));
      const results = [];
      for (const s of statements) results.push(normalize(await tx.query(s.sql, s.args)));
      return results;
    }),
  });
  return { ...db, pg };
}

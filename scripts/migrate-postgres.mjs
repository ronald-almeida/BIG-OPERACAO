import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { neon } from '@neondatabase/serverless';

export async function migrate(sql) {
  const source = await readFile(new URL('../migrations/postgres/0001_core.sql', import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  // Advisory transaction lock + conditional migration make simultaneous deploys safe.
  await sql.transaction([
    sql.query('SELECT pg_advisory_xact_lock(214061104)'),
    sql.query(`DO $migration$ BEGIN
      IF EXISTS (SELECT 1 FROM schema_migrations WHERE version='0001_core' AND checksum<>'${checksum}') THEN
        RAISE EXCEPTION 'Migration checksum mismatch';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='0001_core') THEN
        ${source}
        INSERT INTO schema_migrations(version,checksum) VALUES('0001_core','${checksum}');
      END IF;
    END; $migration$`),
  ]);
  console.log('Migration PostgreSQL 0001_core conferida e aplicada.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL no ambiente.');
  await migrate(neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL));
}

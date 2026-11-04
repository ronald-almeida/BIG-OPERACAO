import { neon } from '@neondatabase/serverless';

// Only parameter markers outside SQL strings are converted. All values remain bound.
export function postgresSql(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, part => part === '?' ? '$' + (++index) : part);
}

export function postgresAdapter(executor) {
  const wrap = (sql, args = []) => ({
    sql: postgresSql(sql), args,
    bind(...values) { return wrap(sql, values); },
    async first() { return (await executor.query(this.sql, this.args)).rows[0] ?? null; },
    async all() { const r = await executor.query(this.sql, this.args); return result(r); },
    async run() { const r = await executor.query(this.sql, this.args); return result(r); },
  });
  return {
    prepare: sql => wrap(sql),
    async batch(statements) {
      // The revision and records must come from the SAME MVCC snapshot.
      const readOnly = statements.every(s => /^\s*SELECT\b/i.test(s.sql));
      return (await executor.transaction(statements, {
        isolationLevel: readOnly ? 'RepeatableRead' : 'ReadCommitted', readOnly,
      })).map(result);
    },
  };
}
function result(r) {
  return { success: true, results: r.rows, meta: { changes: r.command === 'SELECT' ? 0 : Number(r.rowCount ?? r.affectedRows ?? 0) } };
}
export function postgres(url) {
  if (!url) throw new Error('DATABASE_URL ausente.');
  const sql = neon(url, { fullResults: true });
  return postgresAdapter({
    query: (text, args) => sql.query(text, args),
    transaction: (statements, options) => sql.transaction(
      statements.map(s => sql.query(s.sql, s.args)), { ...options, fullResults: true }),
  });
}

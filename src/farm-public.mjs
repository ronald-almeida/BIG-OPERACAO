import { neon } from '@neondatabase/serverless';
import { renderFarm } from './farm/farm-render.mjs';

export async function serveFarm(request, lookup, panelOrigin) {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (url.origin === panelOrigin || !['/', '/__farm-check'].includes(url.pathname)) return new Response('Não encontrado', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers });
  const site = await lookup(url.hostname);
  if (!site || site.snapshot?.hostname !== url.hostname) return new Response('Site não publicado', { status: 404, headers });
  if (url.pathname === '/__farm-check') return new Response(request.method === 'HEAD' ? null : JSON.stringify({ service: 'big-cloack-farm', site_id: site.id, version: site.snapshot.version }), { headers: { ...headers, 'Content-Type': 'application/json' } });
  return new Response(request.method === 'HEAD' ? null : renderFarm(site.snapshot.data, site.snapshot.theme, site.snapshot.head), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}
export default {
  async fetch(request, env) {
    try {
      // Dedicated read-only role: SELECT on public_farm_sites only.
      const sql = neon(env.FARM_DATABASE_URL);
      return await serveFarm(request, async hostname => (await sql`SELECT id,snapshot FROM public_farm_sites WHERE snapshot->>'hostname'=${hostname}`)[0], env.APP_ORIGIN);
    } catch (error) {
      console.error('farm_public_failed', error.name);
      return new Response('Site temporariamente indisponível', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
  async scheduled(_controller, env) {
    if (!env.APP_ORIGIN || !env.CRON_SECRET) throw new Error('Configure APP_ORIGIN e CRON_SECRET para consolidar a jornada.');
    const response = await fetch(new URL('/api/cron', env.APP_ORIGIN), {
      headers: { Authorization: 'Bearer ' + env.CRON_SECRET }, redirect: 'manual', signal: AbortSignal.timeout(50000),
    });
    if (!response.ok) throw new Error('Consolidação de jornada falhou: ' + response.status);
  },
};

import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import worker from './worker.mjs';
import { postgres } from './postgres.mjs';

let database;
const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml' };
export const assets = {
  async fetch(request) {
    const file = files[new URL(request.url).pathname];
    if (!file) return new Response('Não encontrado', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : await readFile(new URL('../public/' + file, import.meta.url)),
      { headers: { 'Content-Type': types[file.split('.').at(-1)] } });
  },
};
export function environment() {
  database ??= postgres(process.env.DATABASE_URL);
  const origin = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
    ? 'https://' + process.env.VERCEL_URL : process.env.APP_ORIGIN;
  return { ...process.env, APP_ORIGIN: origin, DB: database, ASSETS: assets, PLATFORM: 'vercel' };
}
function authorized(request, secret) {
  if (!secret || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function handle(request, env) {
  const url = new URL(request.url);
  // Vercel only serves the panel. Unknown hosts cannot fall through to the Farm.
  if (url.origin !== env.APP_ORIGIN) return new Response('Endereço não autorizado', { status: 404 });
  if (url.pathname === '/api/cron') {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    if (!authorized(request, env.CRON_SECRET)) return new Response(null, { status: 401 });
    await worker.scheduled({}, env);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // Vercel overwrites this header. Never trust a caller's Cloudflare IP header here.
  const ip = request.headers.get('x-vercel-forwarded-for')?.trim();
  const headers = new Headers(request.headers);
  headers.delete('cf-connecting-ip');
  headers.set('cf-connecting-ip', ip && isIP(ip) ? ip : 'unknown');
  return worker.fetch(new Request(request, { headers }), env);
}
export async function fetchVercel(request) {
  try { return await handle(request, environment()); }
  catch (error) {
    console.error('vercel_request_failed', error.name, error.code || '');
    return Response.json({ error: 'Serviço indisponível. Verifique a configuração do servidor.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

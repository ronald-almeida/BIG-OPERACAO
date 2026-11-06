import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(test, message, status = 400) { if (!test) throw new HttpError(status, message); }
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
const derive = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password) {
  assert(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'Use uma senha entre 12 e 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = (stored || `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(64)}`).split('$');
  const actual = await derive(password, salt);
  const wanted = Buffer.from(expected, 'hex');
  return wanted.length === actual.length && timingSafeEqual(actual, wanted);
}
async function vaultKey(env) {
  assert(/^[a-f0-9]{64}$/i.test(env.VAULT_KEY || ''), 'O cofre de senhas precisa ser configurado no servidor.', 503);
  return crypto.subtle.importKey('raw', Buffer.from(env.VAULT_KEY, 'hex'), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, id, env) {
  assert(typeof value === 'string' && value.length <= 2048, 'Senha do perfil inválida.');
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)}, await vaultKey(env), new TextEncoder().encode(value));
  return iv.toString('base64') + '.' + Buffer.from(encrypted).toString('base64');
}
export async function unseal(value, id, env) {
  if (!value) return '';
  const [iv, encrypted] = value.split('.');
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64'),additionalData:new TextEncoder().encode(id)}, await vaultKey(env), Buffer.from(encrypted,'base64'));
  return new TextDecoder().decode(plain);
}
export async function readBody(request) {
  assert((request.headers.get('content-type') || '').split(';')[0] === 'application/json', 'Envie JSON.', 415);
  const reader=request.body?.getReader(); assert(reader, 'Corpo obrigatório.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>100000){await reader.cancel();throw new HttpError(413,'Requisição muito grande.');}chunks.push(value);}
  try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(data && typeof data==='object' && !Array.isArray(data),'JSON inválido.');return data;}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'JSON inválido.');}
}
export function originCheck(request, env) {
  const origin = new URL(request.url).origin;
  assert(origin === env.APP_ORIGIN, 'Endereço do painel não configurado.', 503);
  assert(request.headers.get('origin') === origin, 'Origem não autorizada.', 403);
  assert(!['cross-site'].includes(request.headers.get('sec-fetch-site')), 'Origem não autorizada.', 403);
}
export async function throttle(db, key, limit, interval, now=Date.now()) {
  const expires = (Math.floor(now/interval)+1)*interval;
  const fullKey = digest(key) + ':' + expires;
  const row = await db.prepare('INSERT INTO rate_limits(key,hits,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits').bind(fullKey,expires).first();
  assert(row.hits <= limit, 'Muitas tentativas. Aguarde alguns minutos.', 429);
}
export const cookie = (value, age=43200, request) => new URL(request?.url||'https://localhost').protocol==='http:'
  ? `big-dev-session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`
  : `__Host-big-session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export async function identify(request, db, state) {
  const name=new URL(request.url).protocol==='http:'?'big-dev-session=':'__Host-big-session=';
  const raw=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name))?.split('=')[1];
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const session=await db.prepare('SELECT * FROM auth_sessions WHERE token_hash=? AND expires>?').bind(digest(raw),Date.now()).first();
  if(!session)return null;
  const account=[state.admin,...state.people].find(x=>x?.id===session.user_id);
  if(!account || account.removedAt || account.accessEnabled===false || session.credential_version!==account.credentialVersion)return null;
  return {id:account.id, role:account.id==='ADMIN'?'admin':'employee', name:account.name, session};
}

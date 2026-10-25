// TA login for the midterm admin page: one shared password, checked here on the server only.
// Set ADMIN_PASSWORD_HASH (made by `node pipeline/hash_admin_password.mjs "<password>"`) in the Vercel
// project's environment variables. ADMIN_PASSWORD (plain) also works, for local development.
// A successful login returns a signed token (HMAC, 8 hours); changing the password invalidates all tokens.
import crypto from 'node:crypto';
import { getStore } from './store.js';

const TOKEN_HOURS = 8;
const MAX_TRIES = 8;          // wrong passwords per IP …
const TRY_WINDOW = 15 * 60;   // … per 15 minutes

const configured = () => Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD);
const secret = () => process.env.ADMIN_TOKEN_SECRET || crypto.createHash('sha256').update(`epnu-mid:${process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD}`).digest();
const b64 = (b) => Buffer.from(b).toString('base64url');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

function checkPassword(pw) {
  pw = String(pw ?? '');
  const h = process.env.ADMIN_PASSWORD_HASH;
  if (h) {
    const [kind, salt, hash] = h.split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    return same(crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'));
  }
  return same(crypto.createHash('sha256').update(pw).digest(), crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest());
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
}

/** -> { token, expiresAt } or throws { status, message }. */
export async function login(req, password) {
  if (!configured()) throw Object.assign(new Error('الباسورد لسه متظبطش على السيرفر (ADMIN_PASSWORD_HASH)'), { status: 503 });
  const store = getStore();
  const key = `mt:rl:${clientIp(req)}`;
  if ((await store.hits(key)) >= MAX_TRIES) throw Object.assign(new Error('محاولات كتير غلط — استنى ربع ساعة وجرّب تاني'), { status: 429 });
  if (!checkPassword(password)) {
    await store.hit(key, TRY_WINDOW);
    throw Object.assign(new Error('الباسورد غلط'), { status: 401 });
  }
  const exp = Date.now() + TOKEN_HOURS * 3600e3;
  const body = b64(JSON.stringify({ exp }));
  return { token: `${body}.${b64(crypto.createHmac('sha256', secret()).update(body).digest())}`, expiresAt: exp };
}

export function verify(req) {
  if (!configured()) return false;
  const m = String(req.headers.authorization || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/);
  if (!m) return false;
  const sig = crypto.createHmac('sha256', secret()).update(m[1]).digest();
  if (!same(sig, Buffer.from(m[2], 'base64url'))) return false;
  try { return JSON.parse(Buffer.from(m[1], 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

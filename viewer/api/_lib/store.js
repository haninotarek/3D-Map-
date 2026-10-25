// Key-value storage for the midterm API.
//  • On Vercel: Upstash Redis over its REST API (connect "Upstash for Redis" from the Vercel Marketplace;
//    it sets KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
//  • Locally (dev-server.mjs): a JSON file in viewer/.data/ so everything works without an account.
// Values are JSON. The seat index is a Redis hash (one field per student ID) so a lookup reads one field.
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export class StoreError extends Error {}

function redisStore() {
  async function call(pathname, body) {
    const r = await fetch(`${URL_}${pathname}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new StoreError(`redis ${r.status}: ${j?.error || 'bad response'}`);
    return j;
  }
  const one = async (cmd) => { const j = await call('', cmd); if (j.error) throw new StoreError(j.error); return j.result; };
  const parse = (v) => (v == null ? null : JSON.parse(v));
  return {
    kind: 'redis',
    get: async (k) => parse(await one(['GET', k])),
    set: (k, v) => one(['SET', k, JSON.stringify(v)]),
    hget: async (k, f) => parse(await one(['HGET', k, f])),
    /** Replaces the whole hash in one transaction (readers never see it half-written). */
    async replaceHash(k, obj) {
      const pairs = Object.entries(obj).flatMap(([f, v]) => [f, JSON.stringify(v)]);
      const tx = [['DEL', k]];
      for (let i = 0; i < pairs.length; i += 2000) tx.push(['HSET', k, ...pairs.slice(i, i + 2000)]);
      const res = await call('/multi-exec', tx);
      const bad = Array.isArray(res) && res.find((x) => x.error); if (bad) throw new StoreError(bad.error);
    },
    async hit(k, ttlSec) {
      const res = await call('/pipeline', [['SET', k, '0', 'EX', String(ttlSec), 'NX'], ['INCR', k]]);   // INCR keeps the TTL
      return Number(res[1]?.result) || 0;
    },
    hits: async (k) => Number(await one(['GET', k])) || 0,
  };
}

function fileStore() {
  const file = path.join(process.env.EPNU_DATA_DIR || path.join(process.cwd(), '.data'), 'midterm-store.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { kv: {}, hash: {}, hits: {} }; } };
  const write = (db) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
  return {
    kind: 'file',
    get: async (k) => read().kv[k] ?? null,
    set: async (k, v) => { const db = read(); db.kv[k] = v; write(db); },
    hget: async (k, f) => read().hash[k]?.[f] ?? null,
    replaceHash: async (k, obj) => { const db = read(); db.hash[k] = obj; write(db); },
    hit: async (k, ttlSec) => {
      const db = read(); const now = Date.now(); const h = db.hits[k];
      db.hits[k] = h && h.until > now ? { n: h.n + 1, until: h.until } : { n: 1, until: now + ttlSec * 1000 };
      write(db); return db.hits[k].n;
    },
    hits: async (k) => { const h = read().hits[k]; return h && h.until > Date.now() ? h.n : 0; },
  };
}

let store;
export function getStore() {
  if (store) return store;
  if (URL_ && TOKEN) return (store = redisStore());
  if (process.env.VERCEL) throw new StoreError('storage not configured: connect Upstash Redis to this Vercel project');
  return (store = fileStore());
}

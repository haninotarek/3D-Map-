// Public timetable API (Vercel Function), read by the student panel (js/schedule.js).
//   GET /api/timetable          -> TA-published term timetables + the exam period TAs made visible (no student data)
//   GET /api/timetable?id=2341… -> that student's rooms in the visible exam period (first name only, as a check)
// Both answers are cached by Vercel's CDN for a minute (s-maxage), so hundreds of students opening the site
// at once cost about one database read per minute; TA changes reach students within about a minute.
import { publicView, lookup } from './_lib/timetable.js';
import { clientIp } from './_lib/auth.js';

// Stops one connection walking through every ID. Counted in this function instance's memory (no database
// writes per lookup); mobile carriers put many students behind one IP, so the limit is generous.
const SEAT_LIMIT = 1500, SEAT_WINDOW_MS = 10 * 60 * 1000;
const seatHits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const h = seatHits.get(ip);
  if (!h || h.until < now) { seatHits.set(ip, { n: 1, until: now + SEAT_WINDOW_MS }); if (seatHits.size > 5000) seatHits.clear(); return false; }
  return ++h.n > SEAT_LIMIT;
}

const CDN_MINUTE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).json({ error: 'GET only' }); }
  try {
    const id = req.query?.id;
    if (id != null) {
      if (tooMany(clientIp(req))) { res.setHeader('Cache-Control', 'no-store'); return res.status(429).json({ error: 'طلبات كتير — جرّب كمان شوية' }); }
      const out = await lookup(id);
      res.setHeader('Cache-Control', CDN_MINUTE);
      return res.status(200).json(out);
    }
    const out = await publicView();
    res.setHeader('Cache-Control', CDN_MINUTE);
    return res.status(200).json(out);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'حصلت مشكلة في السيرفر' });
  }
}

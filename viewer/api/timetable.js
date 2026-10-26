// Public timetable API (Vercel Function), read by the student panel (js/schedule.js).
//   GET /api/timetable          -> TA-published term timetables + the exam period TAs made visible (no student data)
//   GET /api/timetable?id=2341… -> that student's rooms in the visible exam period (first name only, as a check)
import { publicView, lookup } from './_lib/timetable.js';
import { getStore } from './_lib/store.js';
import { clientIp } from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    const id = req.query?.id;
    if (id != null) {
      // stop anyone walking through every ID: 120 lookups / 10 min per IP is plenty for a student
      if ((await getStore().hit(`mt:rl:seat:${clientIp(req)}`, 600)) > 120) return res.status(429).json({ error: 'طلبات كتير — جرّب كمان شوية' });
      return res.status(200).json(await lookup(id));
    }
    return res.status(200).json(await publicView());
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'حصلت مشكلة في السيرفر' });
  }
}

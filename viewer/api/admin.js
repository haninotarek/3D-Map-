// TA (معيدين) API for admin.html (Vercel Function). POST JSON { action, … }; every action except "login"
// needs "Authorization: Bearer <token>" from login.
//   login        { password }                    -> { token, expiresAt }
//   state        {}                              -> every level's schedule and sheets (with students)
//   saveSchedule { level, exams, source }        -> publishes that level's exam timetable
//   addSheets    { level, sheets }               -> publishes room sheets (same exam + room replaces)
//   deleteSheet  { level, id }
//   clear        { level, what: schedule|sheets|all }
import { login, verify } from './_lib/auth.js';
import { LEVELS, getLevel, saveSchedule, addSheets, deleteSheet, clearLevel, levelOf } from './_lib/midterm.js';
import { getStore } from './_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    if (body.action === 'login') return res.status(200).json(await login(req, body.password));
    if (!verify(req)) return res.status(401).json({ error: 'سجّل دخول تاني', relogin: true });
    switch (body.action) {
      case 'state': {
        const levels = {};
        for (const L of LEVELS) levels[L] = await getLevel(L);
        return res.status(200).json({ levels, storage: getStore().kind });
      }
      case 'saveSchedule': return res.status(200).json(await saveSchedule(levelOf(body.level), body.exams, body.source));
      case 'addSheets': return res.status(200).json(await addSheets(levelOf(body.level), body.sheets));
      case 'deleteSheet': await deleteSheet(levelOf(body.level), String(body.id)); return res.status(200).json({ ok: true });
      case 'clear': await clearLevel(levelOf(body.level), body.what); return res.status(200).json({ ok: true });
      default: return res.status(400).json({ error: 'action مش معروف' });
    }
  } catch (err) {
    if (!err.status) console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : `حصلت مشكلة في السيرفر: ${err.message}` });
  }
}

// TA (معيدين) API for admin.html (Vercel Function). POST JSON { action, … }; every action except "login"
// needs "Authorization: Bearer <token>" from login.
//   login        { password }                         -> { token, expiresAt }
//   state        { section, level? }                  -> settings, counts for every section, and the chosen section's data
//   setVisible   { exam: midterm|midyear|final|'' }   -> which exam tab students see ('' hides it)
//   saveTerm     { term, level, classes, source }     -> publishes one level's class timetable
//   clearTerm    { term, level }                      -> back to the built-in timetable for that level
//   saveSchedule { period, level, exams, source }     -> publishes one level's exam timetable
//   addSheets    { period, level, sheets }            -> publishes room sheets (same exam + room replaces)
//   deleteSheet  { period, level, id }
//   clear        { period, level, what: schedule|sheets|all }
import { login, verify } from './_lib/auth.js';
import {
  LEVELS, TERMS, EXAMS, levelOf, termOf, examOf, getSettings, setVisibleExam, summary,
  getTerm, saveTerm, clearTerm, getExamLevel, saveSchedule, addSheets, deleteSheet, clearExamLevel, refreshPublicView,
} from './_lib/timetable.js';
import { getStore } from './_lib/store.js';

async function state(section) {
  const out = { settings: await getSettings(), summary: await summary(), storage: getStore().kind, section, levels: {} };
  if (TERMS[section]) for (const L of LEVELS) out.levels[L] = await getTerm(section, L);
  else if (EXAMS[section]) for (const L of LEVELS) out.levels[L] = await getExamLevel(section, L);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    if (body.action === 'login') return res.status(200).json(await login(req, body.password));
    if (!verify(req)) return res.status(401).json({ error: 'سجّل دخول تاني', relogin: true });
    if (body.action === 'state') return res.status(200).json(await state(String(body.section || '')));
    let out;
    switch (body.action) {
      case 'setVisible': out = await setVisibleExam(body.exam ? examOf(body.exam) : ''); break;
      case 'saveTerm': out = await saveTerm(termOf(body.term), levelOf(body.level), body.classes, body.source); break;
      case 'clearTerm': await clearTerm(termOf(body.term), levelOf(body.level)); out = { ok: true }; break;
      case 'saveSchedule': out = await saveSchedule(examOf(body.period), levelOf(body.level), body.exams, body.source); break;
      case 'addSheets': out = await addSheets(examOf(body.period), levelOf(body.level), body.sheets); break;
      case 'deleteSheet': await deleteSheet(examOf(body.period), levelOf(body.level), String(body.id)); out = { ok: true }; break;
      case 'clear': await clearExamLevel(examOf(body.period), levelOf(body.level), body.what); out = { ok: true }; break;
      default: return res.status(400).json({ error: 'action مش معروف' });
    }
    await refreshPublicView();   // students read this ready-made copy (GET /api/timetable)
    return res.status(200).json(out);
  } catch (err) {
    if (!err.status) console.error(err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : `حصلت مشكلة في السيرفر: ${err.message}` });
  }
}

// Timetable data kept by the API. Only TAs write it (admin.html); students read it.
//
// Sections:
//   term1 / term2        class timetables (الترم الأول / التاني), per level:
//     tt:<term>:<L>      { classes: [{ day, period, from, to, course, type, group, sections, room, building }], source, updatedAt }
//                        (a level with nothing published falls back to the built-in data/schedules/*.json on the site)
//   midterm / midyear / final   exam periods (الميدترم / نص السنة / آخر السنة), per level:
//     <p>:schedule:<L>   { exams: [{ date, from, to, course, code, building, room }], source, updatedAt }
//     <p>:sheets:<L>     [{ id, course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, at,
//                          students: [{ id, name, status }] }]           (one sheet = one room for one exam)
//     <p>:seat           hash  studentId -> { first, exams: [{ level, course, code, date, from, to, building, floor, room, roomRaw, seq }] }
//   cfg:public           { exam: 'midterm' | 'midyear' | 'final' | '' }  which exam tab students see (none = hidden)
//   pub:view             what GET /api/timetable returns, rebuilt after every TA write (no student data)
// <p> is "mt" for the midterm (the keys it used before the other periods existed), "my" and "fy" for the others.
// The seat hash is rebuilt from every level's sheets whenever sheets change, so a lookup is one HGET and full
// names never leave the admin side (a lookup returns the first name only, as a check).
import crypto from 'node:crypto';
import { getStore } from './store.js';

export const LEVELS = [1, 2, 3, 4];
export const TERMS = { term1: 'الترم الأول', term2: 'الترم التاني' };
export const EXAMS = { midterm: 'الميدترم', midyear: 'امتحانات نص السنة', final: 'امتحانات آخر السنة' };
const PREFIX = { midterm: 'mt', midyear: 'my', final: 'fy' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const str = (v, max = 160) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const time = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : '');
const codeKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const examKey = (e) => `${e.date}|${codeKey(e.code) || str(e.course).toLowerCase()}`;
export const levelOf = (v) => { const n = Number(v); if (!LEVELS.includes(n)) throw bad('اختار الدفعة (سنة 1–4)'); return n; };
export const termOf = (v) => { if (!TERMS[v]) throw bad('اختار الترم'); return v; };
export const examOf = (v) => { if (!EXAMS[v]) throw bad('اختار نوع الامتحانات'); return v; };
const k = (period, name) => `${PREFIX[period]}:${name}`;

// ---------------------------------------------------------------- settings
export async function getSettings() {
  const s = (await getStore().get('cfg:public')) || {};
  return { exam: EXAMS[s.exam] ? s.exam : '', updatedAt: s.updatedAt || null };
}
export async function setVisibleExam(exam) {
  if (exam && !EXAMS[exam]) throw bad('نوع امتحانات مش معروف');
  const doc = { exam: exam || '', updatedAt: new Date().toISOString() };
  await getStore().set('cfg:public', doc);
  return doc;
}

// ---------------------------------------------------------------- term timetables
function cleanClass(c) {
  const day = DAYS.find((d) => d === c.day) || '';
  return {
    day, period: Math.max(0, Math.min(8, Number(c.period) || 0)), from: time(c.from), to: time(c.to), course: str(c.course),
    type: ['lecture', 'section', 'lab'].includes(c.type) ? c.type : 'lecture', group: str(c.group, 20), sections: str(c.sections, 40),
    room: str(c.room, 60), building: str(c.building, 60),
  };
}
export async function getTerm(term, L) { return (await getStore().get(`tt:${term}:${L}`)) || null; }
export async function saveTerm(term, L, classes, source) {
  const clean = (Array.isArray(classes) ? classes : []).map(cleanClass).filter((c) => c.day && c.course && (c.period || c.from));
  if (!clean.length) throw bad('الجدول مفيهوش محاضرات بيوم ومادة وميعاد');
  const doc = { classes: clean, source: str(source, 120), updatedAt: new Date().toISOString() };
  await getStore().set(`tt:${term}:${L}`, doc);
  return doc;
}
export async function clearTerm(term, L) { await getStore().set(`tt:${term}:${L}`, null); }

// ---------------------------------------------------------------- exam periods
function cleanExam(e) {
  return { date: date(e.date), from: time(e.from), to: time(e.to), course: str(e.course), code: str(e.code, 20), building: str(e.building, 60), room: str(e.room, 60) };
}
function cleanSheet(s) {
  const seen = new Set();
  const students = (Array.isArray(s.students) ? s.students : [])
    .map((x) => ({ id: str(x.id, 12).replace(/\D/g, ''), name: str(x.name, 120), status: str(x.status, 20) }))
    .filter((x) => x.id.length >= 5 && !seen.has(x.id) && seen.add(x.id));
  return {
    ...cleanExam(s), floor: s.floor == null ? null : str(s.floor, 4), roomRaw: str(s.roomRaw, 120), place: str(s.place, 200),
    linked: Boolean(s.linked), source: str(s.source, 120), students,
  };
}
function firstName(name) {
  const w = str(name).split(/\s+/).filter(Boolean);
  return /^(عبد|ابو|أبو)$/.test(w[0] || '') && w[1] ? `${w[0]} ${w[1]}` : w[0] || '';
}

export async function getExamLevel(period, L) {
  const s = getStore();
  const [schedule, sheets] = await Promise.all([s.get(k(period, `schedule:${L}`)), s.get(k(period, `sheets:${L}`))]);
  return { schedule: schedule || { exams: [], source: '', updatedAt: null }, sheets: sheets || [] };
}

export async function saveSchedule(period, L, exams, source) {
  const clean = (Array.isArray(exams) ? exams : []).map(cleanExam).filter((e) => e.date && e.course);
  if (!clean.length) throw bad('الجدول مفيهوش امتحانات بتاريخ ومادة');
  const doc = { exams: clean, source: str(source, 120), updatedAt: new Date().toISOString() };
  await getStore().set(k(period, `schedule:${L}`), doc);
  return doc;
}

/** Adds sheets; a sheet for the same exam + room replaces the old one (re-uploading a corrected file just works). */
export async function addSheets(period, L, incoming) {
  const add = (Array.isArray(incoming) ? incoming : []).map(cleanSheet).filter((s) => s.students.length);
  if (!add.length) throw bad('مفيش كشوف فيها أرقام طلاب');
  const { sheets } = await getExamLevel(period, L);
  const where = (s) => `${examKey(s)}|${s.building}|${s.room || s.roomRaw}`;
  let replaced = 0;
  for (const s of add) {
    const i = sheets.findIndex((x) => where(x) === where(s));
    const doc = { ...s, id: i >= 0 ? sheets[i].id : crypto.randomUUID().slice(0, 8), at: new Date().toISOString() };
    if (i >= 0) { sheets[i] = doc; replaced++; } else sheets.push(doc);
  }
  await getStore().set(k(period, `sheets:${L}`), sheets);
  const index = await rebuildSeats(period);
  return { added: add.length - replaced, replaced, warnings: index.warnings, students: Object.keys(index.seats).length };
}

export async function deleteSheet(period, L, id) {
  const { sheets } = await getExamLevel(period, L);
  const left = sheets.filter((s) => s.id !== id);
  if (left.length === sheets.length) throw bad('الكشف ده مش موجود', 404);
  await getStore().set(k(period, `sheets:${L}`), left);
  await rebuildSeats(period);
}

export async function clearExamLevel(period, L, what) {
  const s = getStore();
  if (what === 'schedule' || what === 'all') await s.set(k(period, `schedule:${L}`), null);
  if (what === 'sheets' || what === 'all') { await s.set(k(period, `sheets:${L}`), []); await rebuildSeats(period); }
}

/** Rebuilds the studentId -> exams hash of one period from every level; reports one student in two rooms of one exam. */
export async function rebuildSeats(period) {
  const seats = {}; const where = new Map(); const warnings = [];
  for (const L of LEVELS) {
    const { sheets } = await getExamLevel(period, L);
    for (const sh of sheets) sh.students.forEach((st, i) => {
      const key = `${st.id}|${examKey(sh)}`;
      const at = `${sh.room || sh.roomRaw} (${sh.course || sh.code})`;
      if (where.has(key)) { warnings.push(`الطالب ${st.id} موجود في كشفين لنفس الامتحان: ${where.get(key)} و ${at}`); return; }
      where.set(key, at);
      const rec = (seats[st.id] ||= { first: firstName(st.name), exams: [] });
      if (!rec.first) rec.first = firstName(st.name);
      rec.exams.push({ level: L, course: sh.course, code: sh.code, date: sh.date, from: sh.from, to: sh.to, building: sh.building, floor: sh.floor, room: sh.room, roomRaw: sh.roomRaw, seq: i + 1 });
    });
  }
  for (const r of Object.values(seats)) r.exams.sort((a, b) => `${a.date}T${a.from}`.localeCompare(`${b.date}T${b.from}`));
  await getStore().replaceHash(k(period, 'seat'), seats);
  return { seats, warnings };
}

/** One exam period as students see it: each level's exams with the rooms used (no student data). */
async function examView(period) {
  const levels = [];
  const data = await Promise.all(LEVELS.map((L) => getExamLevel(period, L)));
  for (const [i, L] of LEVELS.entries()) {
    const { schedule, sheets } = data[i];
    const exams = schedule.exams.map((e) => ({ ...e, rooms: [] }));
    const byKey = new Map(exams.map((e) => [examKey(e), e]));
    for (const sh of sheets) {
      let e = byKey.get(examKey(sh));
      if (!e) {   // a sheet for an exam that is not in the uploaded timetable still shows up
        e = { date: sh.date, from: sh.from, to: sh.to, course: sh.course, code: sh.code, building: sh.building, room: '', rooms: [] };
        exams.push(e); byKey.set(examKey(sh), e);
      }
      if (!e.from && sh.from) Object.assign(e, { from: sh.from, to: sh.to });
      e.rooms.push({ building: sh.building, floor: sh.floor, room: sh.room, roomRaw: sh.roomRaw, count: sh.students.length });
    }
    exams.sort((a, b) => `${a.date}T${a.from}`.localeCompare(`${b.date}T${b.from}`));
    levels.push({ level: L, exams });
  }
  return { period, label_ar: EXAMS[period], levels };
}

/** Everything the student panel needs: published term timetables (per level) and the visible exam period, if any.
 *  It is kept ready in `pub:view` and rebuilt whenever TAs publish (refreshPublicView), so a student's page
 *  load costs one small read instead of ~17; it is built on demand the first time. */
export async function publicView() {
  return (await getStore().get('pub:view')) || refreshPublicView();
}
export async function refreshPublicView() {
  const { exam } = await getSettings();
  const terms = {};
  await Promise.all(Object.keys(TERMS).map(async (term) => {
    const docs = await Promise.all(LEVELS.map((L) => getTerm(term, L)));
    terms[term] = docs.map((d, i) => (d?.classes?.length ? { level: LEVELS[i], classes: d.classes, updatedAt: d.updatedAt } : null)).filter(Boolean);
  }));
  const view = { terms, exam: exam ? await examView(exam) : null, builtAt: new Date().toISOString() };
  await getStore().set('pub:view', view);
  return view;
}

/** A student's rooms in the visible exam period. */
export async function lookup(id) {
  const clean = String(id ?? '').replace(/\D/g, '');
  if (clean.length < 5 || clean.length > 12) throw bad('اكتب الكود صح (أرقام بس)');
  const { exam } = await getSettings();
  if (!exam) return { found: false, id: clean, closed: true };
  const rec = await getStore().hget(k(exam, 'seat'), clean);
  return rec ? { found: true, id: clean, period: exam, ...rec } : { found: false, id: clean, period: exam };
}

/** Counts for the admin overview: what is published in every section and level. */
export async function summary() {
  const out = { terms: {}, exams: {} };
  const jobs = [];
  for (const term of Object.keys(TERMS)) {
    out.terms[term] = {};
    for (const L of LEVELS) jobs.push(getTerm(term, L).then((d) => { out.terms[term][L] = d?.classes?.length || 0; }));
  }
  for (const p of Object.keys(EXAMS)) {
    out.exams[p] = {};
    for (const L of LEVELS) jobs.push(getExamLevel(p, L).then(({ schedule, sheets }) => {
      out.exams[p][L] = { exams: schedule.exams.length, sheets: sheets.length, students: new Set(sheets.flatMap((s) => s.students.map((x) => x.id))).size };
    }));
  }
  await Promise.all(jobs);
  return out;
}

// Midterm data kept by the API, per level (سنة 1–4):
//   mt:schedule:<L>  { exams: [{ date, from, to, course, code, building, room }], source, updatedAt }
//   mt:sheets:<L>    [{ id, course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, at,
//                       students: [{ id, name, status }] }]           (one sheet = one room for one exam)
//   mt:seat          hash  studentId -> { first, exams: [{ level, course, code, date, from, to, building, floor, room, roomRaw, seq }] }
// The seat hash is rebuilt from every level's sheets whenever sheets change, so a student lookup is one HGET
// and full names never leave the admin side (the lookup only returns the first name, as a check).
import crypto from 'node:crypto';
import { getStore } from './store.js';

export const LEVELS = [1, 2, 3, 4];
const str = (v, max = 160) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const time = (v) => (/^\d{2}:\d{2}$/.test(v) ? v : '');
const codeKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const examKey = (e) => `${e.date}|${codeKey(e.code) || str(e.course).toLowerCase()}`;
export const levelOf = (v) => { const n = Number(v); if (!LEVELS.includes(n)) throw Object.assign(new Error('اختار الدفعة (سنة 1–4)'), { status: 400 }); return n; };

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

export async function getLevel(L) {
  const s = getStore();
  const [schedule, sheets] = await Promise.all([s.get(`mt:schedule:${L}`), s.get(`mt:sheets:${L}`)]);
  return { schedule: schedule || { exams: [], source: '', updatedAt: null }, sheets: sheets || [] };
}

export async function saveSchedule(L, exams, source) {
  const clean = (Array.isArray(exams) ? exams : []).map(cleanExam).filter((e) => e.date && e.course);
  if (!clean.length) throw Object.assign(new Error('الجدول مفيهوش امتحانات بتاريخ ومادة'), { status: 400 });
  const doc = { exams: clean, source: str(source, 120), updatedAt: new Date().toISOString() };
  await getStore().set(`mt:schedule:${L}`, doc);
  return doc;
}

/** Adds sheets; a sheet for the same exam + room replaces the old one (re-uploading a corrected file just works). */
export async function addSheets(L, incoming) {
  const add = (Array.isArray(incoming) ? incoming : []).map(cleanSheet).filter((s) => s.students.length);
  if (!add.length) throw Object.assign(new Error('مفيش كشوف فيها أرقام طلاب'), { status: 400 });
  const { sheets } = await getLevel(L);
  const where = (s) => `${examKey(s)}|${s.building}|${s.room || s.roomRaw}`;
  let replaced = 0;
  for (const s of add) {
    const i = sheets.findIndex((x) => where(x) === where(s));
    const doc = { ...s, id: i >= 0 ? sheets[i].id : crypto.randomUUID().slice(0, 8), at: new Date().toISOString() };
    if (i >= 0) { sheets[i] = doc; replaced++; } else sheets.push(doc);
  }
  await getStore().set(`mt:sheets:${L}`, sheets);
  const index = await rebuildSeats();
  return { added: add.length - replaced, replaced, warnings: index.warnings, students: Object.keys(index.seats).length };
}

export async function deleteSheet(L, id) {
  const { sheets } = await getLevel(L);
  const left = sheets.filter((s) => s.id !== id);
  if (left.length === sheets.length) throw Object.assign(new Error('الكشف ده مش موجود'), { status: 404 });
  await getStore().set(`mt:sheets:${L}`, left);
  await rebuildSeats();
}

export async function clearLevel(L, what) {
  const s = getStore();
  if (what === 'schedule' || what === 'all') await s.set(`mt:schedule:${L}`, null);
  if (what === 'sheets' || what === 'all') { await s.set(`mt:sheets:${L}`, []); await rebuildSeats(); }
}

/** Rebuilds the studentId -> exams hash from every level; also reports one student in two rooms of one exam. */
export async function rebuildSeats() {
  const seats = {}; const where = new Map(); const warnings = [];
  for (const L of LEVELS) {
    const { sheets } = await getLevel(L);
    for (const sh of sheets) sh.students.forEach((st, i) => {
      const k = `${st.id}|${examKey(sh)}`;
      const at = `${sh.room || sh.roomRaw} (${sh.course || sh.code})`;
      if (where.has(k)) { warnings.push(`الطالب ${st.id} موجود في كشفين لنفس الامتحان: ${where.get(k)} و ${at}`); return; }
      where.set(k, at);
      const rec = (seats[st.id] ||= { first: firstName(st.name), exams: [] });
      if (!rec.first) rec.first = firstName(st.name);
      rec.exams.push({ level: L, course: sh.course, code: sh.code, date: sh.date, from: sh.from, to: sh.to, building: sh.building, floor: sh.floor, room: sh.room, roomRaw: sh.roomRaw, seq: i + 1 });
    });
  }
  for (const r of Object.values(seats)) r.exams.sort((a, b) => `${a.date}T${a.from}`.localeCompare(`${b.date}T${b.from}`));
  await getStore().replaceHash('mt:seat', seats);
  await getStore().set('mt:meta', { updatedAt: new Date().toISOString() });
  return { seats, warnings };
}

/** What every student may see: each level's exams, with the rooms used for each (no student data). */
export async function publicView() {
  const meta = (await getStore().get('mt:meta')) || {};
  const levels = [];
  for (const L of LEVELS) {
    const { schedule, sheets } = await getLevel(L);
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
    levels.push({ level: L, exams, source: schedule.source, updatedAt: schedule.updatedAt, students: new Set(sheets.flatMap((s) => s.students.map((x) => x.id))).size });
  }
  return { updatedAt: meta.updatedAt || null, levels };
}

export async function lookup(id) {
  const clean = String(id ?? '').replace(/\D/g, '');
  if (clean.length < 5 || clean.length > 12) throw Object.assign(new Error('اكتب الكود صح (أرقام بس)'), { status: 400 });
  const rec = await getStore().hget('mt:seat', clean);
  return rec ? { found: true, id: clean, ...rec } : { found: false, id: clean };
}

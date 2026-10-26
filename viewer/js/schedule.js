// Timetable side panel (Arabic, RTL): tabs الترم الأول / الترم التاني, plus one exam tab (الميدترم, نص السنة
// or آخر السنة) only while TAs have made it visible on admin.html. Then سنة أولى→رابعة / section / day filters,
// search, the next class or exam, tapping a row to see its room inside the building, and "وديني" which asks
// the 3D view (window.__campus.showRoute) to walk there.
// Data: the built-in data/schedules/fall-2026.json (term 1) and spring-2027.json (term 2); where TAs published a
// level's timetable, /api/timetable replaces that level. Exams come only from /api/timetable, and a student can
// type their ID there to get the room of each of their exams. Students cannot upload anything.
// Every class/exam is linked to a building and, where the indoor map has it, to a room (data/room_index.json).
import { arDigits, canonRoom, canonBuilding, roomAr, BUILDING_AR } from './rooms.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'epnu.schedule.prefs.v1';
const API = 'api/timetable';
const TERMS = [
  { id: 'term1', label: 'الترم الأول', kind: 'classes', file: 'data/schedules/fall-2026.json' },
  { id: 'term2', label: 'الترم التاني', kind: 'classes', file: 'data/schedules/spring-2027.json' },
];
const EXAM_TABS = { midterm: 'الميدترم', midyear: 'نص السنة', final: 'آخر السنة' };
const LEVEL_AR = { 1: 'سنة أولى', 2: 'سنة تانية', 3: 'سنة تالتة', 4: 'سنة رابعة' };
const levelName = (l) => LEVEL_AR[l?.level] || l?.name_ar || `سنة ${l?.level ?? ''}`;
const tabs = () => (S.exam ? [...TERMS, S.exam] : TERMS);
const termOf = () => tabs().find((t) => t.id === S.prefs.term) || TERMS[0];
const isExams = () => S.data?.kind === 'exams';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_AR = { Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' };
const TYPE_AR = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل', midterm: 'امتحان' };
const BUILDING_SHORT = { 'Engineering Building 1': 'مبنى 1', 'Engineering Building 2': 'مبنى 2' };

const S = { data: null, index: null, floorsAr: {}, datasets: {}, exam: null, api: false, prefs: { term: 'term1', level: 1, section: 0, day: 'all', q: '', seatId: '' }, classes: [],
  seat: null, seatState: '' };
const codeKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const examKey = (c) => `${c.date}|${codeKey(c.code) || String(c.course || '').toLowerCase()}`;

// ---------------------------------------------------------------- small helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmtTime = (hhmm) => { let [h, m] = hhmm.split(':').map(Number); const pm = h >= 12; if (h > 12) h -= 12; return `${h}:${String(m).padStart(2, '0')}${pm ? ' م' : ' ص'}`; };
function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode: keep in memory */ } }

/** "1:5" -> [1..5], "3,4" -> [3,4], "" -> [] (= everyone in the level). */
function parseSections(s) {
  s = arDigits(String(s ?? '')).replace(/[()\s]/g, '');
  if (!s) return [];
  const out = new Set();
  for (const part of s.split(/[,،&+]/)) {
    const m = part.match(/^(\d+)\s*[:\-–]\s*(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
    else if (/^\d+$/.test(part)) out.add(+part);
  }
  return [...out].sort((a, b) => a - b);
}
function sectionsText(list) {
  if (!list.length) return 'كل الدفعة';
  const runs = []; let a = list[0], b = list[0];
  for (const n of list.slice(1)) { if (n === b + 1) b = n; else { runs.push([a, b]); a = b = n; } }
  runs.push([a, b]);
  // "‏" keeps "1–5" reading right-to-left as "من 1 لـ 5" inside Arabic text
  return (list.length === 1 ? 'سكشن ' : 'سكاشن ') + runs.map(([x, y]) => (x === y ? x : `${x}‏–${y}`)).join('، ');
}

const DAY_ALIASES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
  'الأحد': 'Sunday', 'الاحد': 'Sunday', 'الاثنين': 'Monday', 'الإثنين': 'Monday', 'الثلاثاء': 'Tuesday', 'الأربعاء': 'Wednesday', 'الاربعاء': 'Wednesday', 'الخميس': 'Thursday', 'الجمعة': 'Friday', 'السبت': 'Saturday' };
function canonDay(d) { const s = String(d || '').trim(); return DAY_ALIASES[s] || DAY_ALIASES[s.slice(0, 3).toLowerCase()] || s; }
function canonType(t, course) {
  const s = String(t || '').toLowerCase();
  if (/lab|معمل/.test(s)) return 'lab';
  if (/sec|سكشن|تمارين/.test(s)) return 'section';
  if (/lec|محاضر/.test(s)) return 'lecture';
  return /project/i.test(course || '') ? 'lecture' : 'section';
}
// ---------------------------------------------------------------- data
/** Turns a level's raw rows into linked class/exam objects. Exam rows may carry date + from/to. */
function linkLevel(lv, kind) {
  return (lv.classes || []).map((row, i) => {
    const r = Array.isArray(row)
      ? { day: row[0], period: row[1], course: row[2], type: row[3], group: row[4], sections: row[5], room: row[6], building: row[7] }
      : row;
    const room = canonRoom(r.room);
    const building = canonBuilding(r.building) || canonBuilding(lv.building) || lv.building || '';
    const bId = S.index?.buildings?.[building] || null;
    const hit = bId && S.index.rooms?.[bId]?.[room];
    const date = String(r.date || '').trim();
    let day = canonDay(r.day);
    if (!day && date) { const d = new Date(`${date}T12:00:00`); if (!isNaN(d)) day = DAYS[d.getDay()]; }
    return {
      id: `${S.prefs.term}-${lv.level}-${i}`, level: lv.level, day, date,
      period: Number(arDigits(r.period)) || 0, from: String(r.from || '').trim(), to: String(r.to || '').trim(),
      course: String(r.course || '').trim(), type: kind === 'exams' ? 'midterm' : canonType(r.type, r.course), group: String(r.group || '').trim(),
      sections: parseSections(r.sections), roomRaw: String(r.roomRaw || r.room || '').trim(), room, building, buildingId: bId,
      floor: hit ? hit.floor : null, link: hit ? 'room' : bId ? 'building' : 'none',
      code: String(r.code || '').trim(), rooms: Array.isArray(r.rooms) ? r.rooms : [],
    };
  });
}
function rebuild() {
  S.classes = (S.data.levels || []).flatMap((lv) => linkLevel(lv, S.data.kind));
  // a student who typed their ID sees their own exams with their room, in place of the level's rows
  if (isExams() && S.seat?.found) {
    const own = S.seat.exams;
    const keys = new Set(own.map(examKey));
    S.classes = S.classes.filter((c) => !keys.has(examKey(c)))
      .concat(linkLevel({ level: 0, classes: own }, 'exams').map((c, i) => ({ ...c, id: `seat-${i}`, level: own[i].level, seat: true, seq: own[i].seq })));
  }
}

/** Empty سنة أولى→رابعة skeleton, used if a term file is missing and as the base of an exam tab. */
function skeleton(label, kind) {
  return {
    term_ar: label, kind, published: false,
    periods: [{ n: 1, from: '10:00', to: '11:15' }, { n: 2, from: '11:20', to: '12:30' }, { n: 3, from: '12:35', to: '13:45' }, { n: 4, from: '13:50', to: '15:00' }],
    levels: [1, 2, 3, 4].map((n) => ({ level: n, name_ar: LEVEL_AR[n], building: n === 1 ? 'Engineering Building 1' : 'Engineering Building 2', sections: 0, classes: [] })),
  };
}
/** A term's built-in data with the levels TAs published swapped in (level name / default building kept). */
function withPublished(base, published = []) {
  if (!published.length) return base;
  const byLevel = new Map(published.map((l) => [l.level, l]));
  const levels = base.levels.map((lv) => (byLevel.has(lv.level) ? { ...lv, classes: byLevel.get(lv.level).classes } : lv));
  for (const l of published) if (!levels.some((lv) => lv.level === l.level)) levels.push({ level: l.level, name_ar: LEVEL_AR[l.level], classes: l.classes });
  return { ...base, levels: levels.sort((a, b) => a.level - b.level) };
}
/** The visible exam period from the API -> the exam tab's data. An exam held in one room links straight to it. */
function examData(exam) {
  const base = skeleton(`امتحانات ${EXAM_TABS[exam.period] || ''}`.trim(), 'exams');
  const byLevel = new Map((exam.levels || []).map((l) => [l.level, l]));
  return {
    ...base, published: true,
    levels: base.levels.map((lv) => ({
      ...lv,
      classes: (byLevel.get(lv.level)?.exams || []).map((e) => ({
        date: e.date, from: e.from, to: e.to, course: e.course, code: e.code, building: e.building || e.rooms?.[0]?.building || '',
        room: e.rooms?.length === 1 ? e.rooms[0].room : e.room || '', roomRaw: e.rooms?.length === 1 ? e.rooms[0].roomRaw : '', rooms: e.rooms || [],
      })),
    })),
  };
}
function applyTerm(term) {
  S.prefs.term = term;
  S.data = S.datasets[term];
  rebuild();
}

async function loadData() {
  const [idx, interior, api, ...termData] = await Promise.all([
    fetch('data/room_index.json').then((r) => r.json()).catch(() => ({ buildings: {}, rooms: {} })),
    fetch('data/interiors/bld_e2.json').then((r) => r.json()).catch(() => null),
    // only there on Vercel / dev-server.mjs; a plain static server answers 404 and the built-in files are used
    fetch(API).then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null)).catch(() => null),
    ...TERMS.map((t) => fetch(t.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(() => skeleton(t.label, t.kind))),
  ]);
  S.index = idx;
  if (interior) for (const f of interior.floors) S.floorsAr[f.id] = f.name_ar;
  S.api = Boolean(api?.terms);
  TERMS.forEach((t, i) => { S.datasets[t.id] = withPublished({ ...termData[i], kind: 'classes' }, api?.terms?.[t.id]); });
  if (api?.exam && EXAM_TABS[api.exam.period]) {
    S.exam = { id: api.exam.period, label: EXAM_TABS[api.exam.period], kind: 'exams' };
    S.datasets[S.exam.id] = examData(api.exam);
  }
  S.prefs = { ...S.prefs, ...load(PREFS_KEY, {}) };
  if (!tabs().some((t) => t.id === S.prefs.term)) S.prefs.term = 'term1';
  applyTerm(S.prefs.term);
}

function toast(html, kind = 'ok') {
  const t = $('sched-toast');
  t.className = `sched-toast ${kind}`; t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 6500);
}

// ---------------------------------------------------------------- filtering & "now"
function periodOf(n) { return (S.data.periods || []).find((p) => p.n === n) || { from: '', to: '' }; }
/** An exam row may carry explicit from/to; classes use their period. */
function timeOf(c) { return c.from && c.to ? { from: c.from, to: c.to } : periodOf(c.period); }
/** "الأحد ١٥ نوفمبر" for an exam date, else the weekday name. */
function fmtDate(c) {
  if (c.date) {
    const d = new Date(`${c.date}T12:00:00`);
    if (!isNaN(d)) return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  }
  return DAY_AR[c.day] || c.day || '';
}
/** Sort key: exam date (or weekday) then start time. */
function whenKey(c) { const p = timeOf(c); return `${c.date || String(DAYS.indexOf(c.day)).padStart(2, '0')}T${p.from || '99:99'}`; }
function mine() {
  const { level, section } = S.prefs;
  return S.classes.filter((c) => (c.seat || c.level === level) && (!section || !c.sections.length || c.sections.includes(section)));
}
function filtered() {
  const q = S.prefs.q.trim().toLowerCase();
  return mine().filter((c) => (S.prefs.day === 'all' || c.day === S.prefs.day)
    && (!q || [c.course, c.code, c.roomRaw, roomAr(c.room), c.room, BUILDING_AR[c.building] || c.building, TYPE_AR[c.type], DAY_AR[c.day], fmtDate(c)].join(' ').toLowerCase().includes(q)));
}
/** The next exam (by real date when present) for the chosen level / section. */
function nextExam(now = new Date()) {
  const out = [];
  for (const c of mine()) {
    const p = timeOf(c); if (!p.from || !p.to) continue;
    let start;
    if (c.date) { start = new Date(`${c.date}T${p.from}:00`); if (isNaN(start)) continue; }
    else {
      start = new Date(now); start.setDate(start.getDate() + ((DAYS.indexOf(c.day) - now.getDay() + 7) % 7));
      const [h, m] = p.from.split(':').map(Number); start.setHours(h, m, 0, 0);
    }
    const end = new Date(start); const [eh, em] = p.to.split(':').map(Number); end.setHours(eh, em, 0, 0);
    if (!c.date && end < now) continue;
    if (end >= now) out.push({ c, start, end, live: now >= start && now < end, exam: true });
  }
  out.sort((a, b) => a.start - b.start);
  return out[0] || null;
}

/** The class happening now, or the next one this week (for the chosen level / section). */
function nextClass(now = new Date()) {
  if (isExams()) return nextExam(now);
  const list = mine();
  if (!list.length) return null;
  const today = now.getDay(); const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let k = 0; k < 7; k++) {
    const day = DAYS[(today + k) % 7];
    const todays = list.filter((c) => c.day === day).sort((a, b) => a.period - b.period);
    for (const c of todays) {
      const p = periodOf(c.period); if (!p.from) continue;
      const start = toMin(p.from), end = toMin(p.to);
      if (k === 0 && nowMin >= end) continue;
      return { c, k, live: k === 0 && nowMin >= start, inMin: k === 0 ? start - nowMin : null };
    }
  }
  return null;
}

// ---------------------------------------------------------------- rendering
function termTabs() {
  $('sched-terms').innerHTML = tabs().map((t) =>
    `<button type="button" role="tab" aria-selected="${t.id === S.prefs.term}" class="${t.id === S.prefs.term ? 'on' : ''}${t.kind === 'exams' ? ' exam' : ''}" data-term="${t.id}">${t.label}</button>`).join('');
}
function levelChips() {
  $('sched-levels').innerHTML = S.data.levels.map((l) =>
    `<button type="button" class="chip-btn${l.level === S.prefs.level ? ' on' : ''}" data-level="${l.level}">${esc(levelName(l))}</button>`).join('');
}
function sectionSelect() {
  const lv = S.data.levels.find((l) => l.level === S.prefs.level);
  const n = lv?.sections || Math.max(0, ...S.classes.filter((c) => c.level === S.prefs.level).flatMap((c) => c.sections));
  if (S.prefs.section > n) S.prefs.section = 0;
  $('sched-section').innerHTML = `<option value="0">كل السكاشن</option>` +
    Array.from({ length: n }, (_, i) => `<option value="${i + 1}"${S.prefs.section === i + 1 ? ' selected' : ''}>سكشن ${i + 1}</option>`).join('');
  $('sched-section').disabled = !n;
}
function daySelect() {
  const days = [...new Set(S.classes.filter((c) => c.level === S.prefs.level).map((c) => c.day))].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  if (S.prefs.day !== 'all' && !days.includes(S.prefs.day)) S.prefs.day = 'all';
  const today = DAYS[new Date().getDay()];
  $('sched-day').innerHTML = [['all', 'كل الأيام'], ...days.map((d) => [d, DAY_AR[d] + (d === today ? ' (النهارده)' : '')])]
    .map(([v, t]) => `<option value="${v}"${S.prefs.day === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
}

function whereText(c) {
  if (!c.seat && c.rooms?.length > 1) {   // several rooms: the student's own ID tells which one
    const names = [...new Set(c.rooms.map((r) => roomAr(r.room || r.roomRaw)))];
    return `${names.length} لجان: ${names.join('، ')} · ${BUILDING_SHORT[c.building] || BUILDING_AR[c.building] || c.building} — اكتب كودك فوق عشان تعرف لجنتك`;
  }
  const parts = [c.room ? roomAr(c.room) : isExams() ? 'القاعة لسه منزلتش' : ''];
  if (c.building) parts.push(BUILDING_SHORT[c.building] || BUILDING_AR[c.building] || c.building);
  if (c.floor != null && S.floorsAr[c.floor]) parts.push(S.floorsAr[c.floor]);
  return parts.filter(Boolean).join(' · ');
}
/** HTML: each part isolated with <bdi> so English group names and number ranges keep their order in RTL. */
function whoText(c) {
  if (c.seat) return `<b class="mine">لجنتك</b> · <bdi>رقمك في الكشف ${esc(c.seq)}</bdi>`;
  const g = c.group === 'Weekly' ? 'كل أسبوع' : c.group ? `Group ${c.group}` : '';
  return [g, sectionsText(c.sections)].filter(Boolean).map((s) => `<bdi>${esc(s)}</bdi>`).join(' · ');
}
/** One class as a light row: when, who, where, type pill and "وديني". Tapping the row shows the room. */
function session(c, { showCourse = false } = {}) {
  const p = timeOf(c);
  const time = p.from ? `${fmtTime(p.from).replace(/ [صم]$/, '')}–${fmtTime(p.to)}` : '';
  const tip = c.link === 'room' ? 'دوس عشان تشوف القاعة جوه المبنى' : c.link === 'building' ? 'دوس عشان تشوف المبنى (القاعة لسه مش على الخريطة)' : 'المكان مش معروف';
  const place = c.link !== 'none';
  return `<div class="ses t-${c.type}${place ? ' placeable' : ''}" data-id="${c.id}"${place ? ` role="button" tabindex="0" title="${esc(tip)}"` : ''}>
    <div class="ses-main">
      ${showCourse ? `<div class="ses-course" dir="ltr">${esc(c.course)}${c.code ? ` <small>${esc(c.code)}</small>` : ''}</div>` : ''}
      <div class="ses-when">${esc(fmtDate(c))} · ${esc(time)}</div>
      <div class="ses-who">${whoText(c)}</div>
      <div class="ses-where">${place ? '<span class="pin" aria-hidden="true">⌖</span>' : ''}${esc(whereText(c))}</div>
    </div>
    <div class="ses-side">
      <span class="pill">${TYPE_AR[c.type]}</span>
      ${c.link === 'room' ? `<button type="button" class="go" data-go="${c.id}">وديني <span aria-hidden="true">←</span></button>` : ''}
    </div>
  </div>`;
}

function renderNext() {
  const n = nextClass();
  const box = $('sched-next');
  if (!n) { box.hidden = true; return; }
  box.hidden = false;
  let head, when;
  if (n.exam) {
    const days = Math.round((new Date(n.start).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    when = n.live ? 'دلوقتي' : days === 0 ? 'النهارده' : days === 1 ? 'بكرة' : days > 1 ? `بعد ${days} أيام` : fmtDate(n.c);
    head = n.live ? 'الامتحان شغال دلوقتي' : 'امتحانك الجاي';
  } else {
    when = n.live ? 'دلوقتي' : n.k === 0 ? (n.inMin <= 60 ? `بعد ${n.inMin} دقيقة` : 'النهارده') : n.k === 1 ? 'بكرة' : DAY_AR[n.c.day];
    head = n.live ? 'المحاضرة الحالية' : 'محاضرتك الجاية';
  }
  box.innerHTML = `<div class="next-head"><span class="dot${n.live ? ' live' : ''}"></span>${head} · <b>${esc(when)}</b></div>${session(n.c, { showCourse: true })}`;
}

/** Shown while a tab has no rows yet — the structure is ready. */
function notYetHTML() {
  const title = isExams() ? `جدول ${S.data.term_ar} لسه منزلش` : `جدول ${termOf().label} لسه منزلش رسميًا`;
  return `<div class="not-yet">
    <div class="ny-icon" aria-hidden="true">🗓️</div>
    <h4>${esc(title)}</h4>
    <p>أول ما ينزل هيظهر هنا على طول، مصنّف حسب سنة أولى وتانية وتالتة ورابعة.</p>
  </div>`;
}

function renderList() {
  const list = filtered().sort((a, b) => whenKey(a) < whenKey(b) ? -1 : whenKey(a) > whenKey(b) ? 1 : a.period - b.period);
  const host = $('sched-list');
  if (!list.length) {
    host.innerHTML = !S.classes.length ? notYetHTML()
      : `<div class="empty">مفيش ${isExams() ? 'امتحانات' : 'محاضرات'} بالفلتر ده.<br><small>جرّب تغيّر السنة أو اليوم أو السكشن أو كلمة البحث.</small></div>`;
    return;
  }
  const lv = S.data.levels.find((l) => l.level === S.prefs.level);
  if (isExams()) {   // exams read best chronologically, grouped by exam day
    const byDay = new Map();
    for (const c of list) { const k = fmtDate(c); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(c); }
    host.innerHTML = `<div class="list-title">${esc(S.data.term_ar)} <small>${list.length}</small></div>` +
      [...byDay].map(([day, cs]) => `<section class="course">
        <div class="course-head"><h4>${esc(day)}</h4><span>${esc(levelName(lv))}</span></div>
        ${cs.map((c) => session(c, { showCourse: true })).join('')}
      </section>`).join('');
    return;
  }
  const byCourse = new Map();
  for (const c of list) { if (!byCourse.has(c.course)) byCourse.set(c.course, []); byCourse.get(c.course).push(c); }
  host.innerHTML = `<div class="list-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/></svg>المواد <small>${byCourse.size}</small></div>` +
    [...byCourse].map(([course, cs]) => `<section class="course">
      <div class="course-head"><h4 dir="ltr">${esc(course)}</h4><span>${esc(levelName(lv))}</span></div>
      ${cs.map((c) => session(c)).join('')}
    </section>`).join('');
}

/** "أهلًا يا أحمد، وراك امتحان X يوم … الساعة … في قاعة 3 …" — names the student's next exam (or the only one). */
function seatGreeting(seat) {
  const hi = seat.first ? `أهلًا يا ${esc(seat.first)}،` : 'أهلًا،';
  const own = S.classes.filter((c) => c.seat).sort((a, b) => (whenKey(a) < whenKey(b) ? -1 : 1));
  if (!own.length) return `${hi} الكود موجود بس مفيش امتحانات متسجلة ليه.`;
  const now = new Date();
  const next = own.find((c) => { const t = timeOf(c); return !c.date || new Date(`${c.date}T${t.to || '23:59'}:00`) >= now; });
  const say = (c, lead = 'امتحان') => { const t = timeOf(c); return `${lead} <b dir="ltr">${esc(c.course)}</b> يوم ${esc(fmtDate(c))}${t.from ? ` الساعة ${esc(fmtTime(t.from))}` : ''} في <b>${esc(whereText(c))}</b>`; };
  if (!next) return `${hi} ${say(own.at(-1), 'آخر امتحان ليك كان')}. لو عايز تروح القاعة دوس «وديني» تحت.`;
  const exam = say(next);
  const n = own.length;
  return n === 1
    ? `${hi} وراك ${exam}. دوس «وديني» تحت وهنوصّلك لحد اللجنة.`
    : `${hi} عندك ${n === 2 ? 'امتحانين' : `${n} امتحانات`}، أقربهم ${exam}. دوس «وديني» جنب أي امتحان وهنوصّلك لحد لجنته.`;
}

/** "اعرف لجنتك": the student types their ID; /api/timetable?id= answers with their exams and rooms. */
function renderSeat() {
  const box = $('sched-seat');
  box.hidden = !(isExams() && S.api);
  if (box.hidden) return;
  const st = S.seatState, seat = S.seat;
  const msg = st === 'loading' ? 'بندوّر…'
    : st === 'error' ? 'مش قادرين نوصل للسيرفر دلوقتي، جرّب تاني كمان شوية.'
    : seat?.found ? seatGreeting(seat)
    : seat && !seat.found ? `الكود <bdi>${esc(seat.id)}</bdi> مش موجود في الكشوف المنشورة لحد دلوقتي. لو الكشوف لسه منزلتش، استنى المعيدين ينزلوها.`
    : 'اكتب الكود بتاعك (زي اللي في الكشف) وهنقولك قاعتك في كل امتحان ونوديك لحد عندها.';
  box.innerHTML = `<form class="seat-box${seat?.found ? ' found' : ''}" data-seat-form>
    <label for="seat-id">اعرف لجنتك بالكود</label>
    <div class="seat-row">
      <input id="seat-id" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="مثلًا 23411001" value="${esc(S.prefs.seatId || '')}">
      <button type="submit">${seat?.found ? 'تحديث' : 'دوّر'}</button>
      ${seat ? '<button type="button" class="seat-clear" data-seat-clear title="امسح الكود">×</button>' : ''}
    </div>
    <p class="seat-msg">${msg}</p>
  </form>`;
}
async function lookupSeat(id, { quiet = false } = {}) {
  id = arDigits(id).replace(/\D/g, '');
  if (id.length < 5) { if (!quiet) toast('اكتب الكود صح (أرقام بس).', 'err'); return; }
  S.prefs.seatId = id; S.seatState = 'loading'; renderSeat();
  try {
    const r = await fetch(`${API}?id=${encodeURIComponent(id)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    S.seat = j; S.seatState = '';
    if (j.found && j.exams.length) {   // jump to the student's own level
      const count = {}; for (const e of j.exams) count[e.level] = (count[e.level] || 0) + 1;
      S.prefs.level = Number(Object.entries(count).sort((a, b) => b[1] - a[1])[0][0]) || S.prefs.level;
      S.prefs.day = 'all'; S.prefs.section = 0;
    }
  } catch { S.seatState = 'error'; }
  rebuild(); render();
}

function render() {
  if (!S.data.levels.some((l) => l.level === S.prefs.level)) S.prefs.level = S.data.levels[0]?.level ?? 1;
  termTabs(); levelChips(); sectionSelect(); daySelect(); renderSeat(); renderNext(); renderList();
  $('sched-term').textContent = S.data.term_ar || '';
  $('sched-search').placeholder = isExams() ? 'دوّر على مادة أو قاعة امتحان…' : 'دوّر على مادة أو قاعة…';
  save(PREFS_KEY, { term: S.prefs.term, level: S.prefs.level, section: S.prefs.section, day: S.prefs.day, seatId: S.prefs.seatId });
}
function setTerm(term) {
  if (!tabs().some((t) => t.id === term)) return;
  applyTerm(term); S.prefs.day = 'all'; S.prefs.section = 0; render();
}

// ---------------------------------------------------------------- 3D link
const small = () => window.matchMedia('(max-width: 720px)').matches;
/** Tapping a class / exam: show its room inside the building (no walk), or the building when the room is not mapped. */
function showPlace(c) {
  const campus = window.__campus; if (!campus) return;
  if (c.link === 'room' && campus.showRoom) campus.showRoom({ building: c.building, room: c.room, roomLabel: roomAr(c.room) });
  else if (c.buildingId) { campus.clearRoute(); campus.select(c.buildingId, true); }
  else return;
  if (small()) setOpen(false);
  syncTabs(c.buildingId);
}
/** "وديني": the guided walk to the room. */
function go(c) {
  const campus = window.__campus; if (!campus) return;
  if (c.link === 'room') {
    campus.showRoute({ building: c.building, room: c.room, lang: 'ar', roomLabel: roomAr(c.room) });
  } else if (c.buildingId) {
    campus.clearRoute(); campus.select(c.buildingId, true);
  }
  if (small()) setOpen(false);
  syncTabs(c.buildingId);
}
function syncTabs(id) {
  document.querySelectorAll('#view-tabs [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === (id || 'campus')));
}
function setOpen(open) {
  document.documentElement.classList.toggle('sched-open', open);
  $('sched-toggle').setAttribute('aria-expanded', String(open));
  save('epnu.schedule.open', open);
}

// ---------------------------------------------------------------- init
function wire() {
  $('sched-terms').addEventListener('click', (e) => { const b = e.target.closest('[data-term]'); if (b) setTerm(b.dataset.term); });
  $('sched-levels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (!b) return; S.prefs.level = +b.dataset.level; S.prefs.section = 0; render(); });
  $('sched-section').addEventListener('change', (e) => { S.prefs.section = +e.target.value; render(); });
  $('sched-day').addEventListener('change', (e) => { S.prefs.day = e.target.value; render(); });
  $('sched-search').addEventListener('input', (e) => { S.prefs.q = e.target.value; renderList(); });
  const byId = (id) => S.classes.find((x) => x.id === id);
  $('sched').addEventListener('click', (e) => {
    if (e.target.closest('[data-seat-clear]')) { S.seat = null; S.prefs.seatId = ''; S.seatState = ''; rebuild(); render(); return; }
    const b = e.target.closest('[data-go]');
    if (b) { const c = byId(b.dataset.go); if (c) go(c); return; }
    const row = e.target.closest('.ses.placeable');
    if (row) { const c = byId(row.dataset.id); if (c) showPlace(c); }
  });
  $('sched').addEventListener('keydown', (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('.ses.placeable')) return;
    e.preventDefault(); const c = byId(e.target.dataset.id); if (c) showPlace(c);
  });
  $('sched-toggle').addEventListener('click', () => setOpen(!document.documentElement.classList.contains('sched-open')));
  $('sched-close').addEventListener('click', () => setOpen(false));
  $('view-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]'); if (!b || !window.__campus) return;
    const v = b.dataset.view;
    window.__campus.clearRoute();
    if (v === 'campus') window.__campus.overview(); else window.__campus.select(v, true);
    syncTabs(v === 'campus' ? null : v);
  });
  $('sched').addEventListener('submit', (e) => {
    if (!e.target.closest('[data-seat-form]')) return;
    e.preventDefault(); lookupSeat($('seat-id').value);
  });
  // keep the "next class" card fresh
  setInterval(renderNext, 60 * 1000);
}

async function init() {
  if (document.documentElement.classList.contains('embed')) return;   // the EPNU CS Hub has its own timetable UI
  try { await loadData(); } catch (err) { console.warn('timetable not loaded', err); return; }
  $('sched-search').value = '';
  wire(); render();
  if (S.exam && S.prefs.seatId) lookupSeat(S.prefs.seatId, { quiet: true });   // remembered on this device only
  const wide = !small();
  setOpen(load('epnu.schedule.open', wide));
  syncTabs(null);
}

if (window.__campus) init(); else window.addEventListener('campus:ready', init, { once: true });

// Timetable side panel (Arabic, RTL): tabs الترم الأول / الترم التاني, then سنة أولى→رابعة / section / day filters,
// search, the next class, tapping a row to see its room inside the building, and "وديني" which asks
// the 3D view (window.__campus.showRoute) to walk there. Exam rooms have their own panel (js/exam-finder.js).
// Data: data/schedules/fall-2026.json (term 1) and spring-2027.json (term 2).
// Every class is linked to a building and, where the indoor map has it, to a room (data/room_index.json).
import { arDigits, canonRoom, canonBuilding, roomAr, BUILDING_AR } from './rooms.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'epnu.schedule.prefs.v1';
const TERMS = [
  { id: 'term1', label: 'الترم الأول', file: 'data/schedules/fall-2026.json' },
  { id: 'term2', label: 'الترم التاني', file: 'data/schedules/spring-2027.json' },
];
const LEVEL_AR = { 1: 'سنة أولى', 2: 'سنة تانية', 3: 'سنة تالتة', 4: 'سنة رابعة' };
const levelName = (l) => LEVEL_AR[l?.level] || l?.name_ar || `سنة ${l?.level ?? ''}`;
const termOf = () => TERMS.find((t) => t.id === S.prefs.term) || TERMS[0];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_AR = { Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' };
const TYPE_AR = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل' };
const BUILDING_SHORT = { 'Engineering Building 1': 'مبنى 1', 'Engineering Building 2': 'مبنى 2' };

const S = { data: null, index: null, floorsAr: {}, datasets: {}, prefs: { term: 'term1', level: 1, section: 0, day: 'all', q: '' }, classes: [] };

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
/** Turns a level's raw rows into linked class objects. */
function linkLevel(lv) {
  return (lv.classes || []).map((row, i) => {
    const r = Array.isArray(row)
      ? { day: row[0], period: row[1], course: row[2], type: row[3], group: row[4], sections: row[5], room: row[6], building: row[7] }
      : row;
    const room = canonRoom(r.room);
    const building = canonBuilding(r.building) || canonBuilding(lv.building) || lv.building || '';
    const bId = S.index?.buildings?.[building] || null;
    const hit = bId && S.index.rooms?.[bId]?.[room];
    return {
      id: `${S.prefs.term}-${lv.level}-${i}`, level: lv.level, day: canonDay(r.day),
      period: Number(arDigits(r.period)) || 0,
      course: String(r.course || '').trim(), type: canonType(r.type, r.course), group: String(r.group || '').trim(),
      sections: parseSections(r.sections), roomRaw: String(r.room || '').trim(), room, building, buildingId: bId,
      floor: hit ? hit.floor : null, link: hit ? 'room' : bId ? 'building' : 'none',
    };
  });
}
function rebuild() {
  S.classes = (S.data.levels || []).flatMap((lv) => linkLevel(lv));
}

/** Empty سنة أولى→رابعة skeleton, used if a term file is missing. */
function skeleton(label) {
  return {
    term_ar: label, published: false,
    periods: [{ n: 1, from: '10:00', to: '11:15' }, { n: 2, from: '11:20', to: '12:30' }, { n: 3, from: '12:35', to: '13:45' }, { n: 4, from: '13:50', to: '15:00' }],
    levels: [1, 2, 3, 4].map((n) => ({ level: n, name_ar: LEVEL_AR[n], building: n === 1 ? 'Engineering Building 1' : 'Engineering Building 2', sections: 0, classes: [] })),
  };
}
function applyTerm(term) {
  S.prefs.term = term;
  S.data = S.datasets[term];
  rebuild();
}

async function loadData() {
  const [idx, interior, ...termData] = await Promise.all([
    fetch('data/room_index.json').then((r) => r.json()).catch(() => ({ buildings: {}, rooms: {} })),
    fetch('data/interiors/bld_e2.json').then((r) => r.json()).catch(() => null),
    ...TERMS.map((t) => fetch(t.file).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(() => skeleton(t.label))),
  ]);
  S.index = idx;
  if (interior) for (const f of interior.floors) S.floorsAr[f.id] = f.name_ar;
  TERMS.forEach((t, i) => { S.datasets[t.id] = termData[i]; });
  const saved = load(PREFS_KEY, {});
  S.prefs = { ...S.prefs, term: saved.term, level: saved.level ?? S.prefs.level, section: saved.section ?? 0, day: saved.day ?? 'all' };
  if (!TERMS.some((t) => t.id === S.prefs.term)) S.prefs.term = 'term1';
  applyTerm(S.prefs.term);
}

// ---------------------------------------------------------------- filtering & "now"
function periodOf(n) { return (S.data.periods || []).find((p) => p.n === n) || { from: '', to: '' }; }
function mine() {
  const { level, section } = S.prefs;
  return S.classes.filter((c) => c.level === level && (!section || !c.sections.length || c.sections.includes(section)));
}
function filtered() {
  const q = S.prefs.q.trim().toLowerCase();
  return mine().filter((c) => (S.prefs.day === 'all' || c.day === S.prefs.day)
    && (!q || [c.course, c.roomRaw, roomAr(c.room), c.room, BUILDING_AR[c.building] || c.building, TYPE_AR[c.type], DAY_AR[c.day]].join(' ').toLowerCase().includes(q)));
}

/** The class happening now, or the next one this week (for the chosen level / section). */
function nextClass(now = new Date()) {
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
  $('sched-terms').innerHTML = TERMS.map((t) =>
    `<button type="button" role="tab" aria-selected="${t.id === S.prefs.term}" class="${t.id === S.prefs.term ? 'on' : ''}" data-term="${t.id}">${t.label}</button>`).join('');
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
  const parts = [c.room ? roomAr(c.room) : ''];
  if (c.building) parts.push(BUILDING_SHORT[c.building] || BUILDING_AR[c.building] || c.building);
  if (c.floor != null && S.floorsAr[c.floor]) parts.push(S.floorsAr[c.floor]);
  return parts.filter(Boolean).join(' · ');
}
/** HTML: each part isolated with <bdi> so English group names and number ranges keep their order in RTL. */
function whoText(c) {
  const g = c.group === 'Weekly' ? 'كل أسبوع' : c.group ? `Group ${c.group}` : '';
  return [g, sectionsText(c.sections)].filter(Boolean).map((s) => `<bdi>${esc(s)}</bdi>`).join(' · ');
}
/** One class as a light row: when, who, where, type pill and "وديني". Tapping the row shows the room. */
function session(c, { showCourse = false } = {}) {
  const p = periodOf(c.period);
  const time = p.from ? `${fmtTime(p.from).replace(/ [صم]$/, '')}–${fmtTime(p.to)}` : '';
  const tip = c.link === 'room' ? 'دوس عشان تشوف القاعة جوه المبنى' : c.link === 'building' ? 'دوس عشان تشوف المبنى (القاعة لسه مش على الخريطة)' : 'المكان مش معروف';
  const place = c.link !== 'none';
  return `<div class="ses t-${c.type}${place ? ' placeable' : ''}" data-id="${c.id}"${place ? ` role="button" tabindex="0" title="${esc(tip)}"` : ''}>
    <div class="ses-main">
      ${showCourse ? `<div class="ses-course" dir="ltr">${esc(c.course)}</div>` : ''}
      <div class="ses-when">${esc(DAY_AR[c.day] || c.day || '')} · ${esc(time)}</div>
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
  const when = n.live ? 'دلوقتي' : n.k === 0 ? (n.inMin <= 60 ? `بعد ${n.inMin} دقيقة` : 'النهارده') : n.k === 1 ? 'بكرة' : DAY_AR[n.c.day];
  const head = n.live ? 'المحاضرة الحالية' : 'محاضرتك الجاية';
  box.innerHTML = `<div class="next-head"><span class="dot${n.live ? ' live' : ''}"></span>${head} · <b>${esc(when)}</b></div>${session(n.c, { showCourse: true })}`;
}

/** Shown while a tab has no rows yet — the structure is ready. */
function notYetHTML() {
  const title = `جدول ${termOf().label} لسه منزلش رسميًا`;
  return `<div class="not-yet">
    <div class="ny-icon" aria-hidden="true">🗓️</div>
    <h4>${esc(title)}</h4>
    <p>أول ما ينزل هيظهر هنا على طول، مصنّف حسب سنة أولى وتانية وتالتة ورابعة.</p>
  </div>`;
}

function renderList() {
  const list = filtered().sort((a, b) => (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || a.period - b.period);
  const host = $('sched-list');
  if (!list.length) {
    host.innerHTML = !S.classes.length ? notYetHTML()
      : '<div class="empty">مفيش محاضرات بالفلتر ده.<br><small>جرّب تغيّر السنة أو اليوم أو السكشن أو كلمة البحث.</small></div>';
    return;
  }
  const lv = S.data.levels.find((l) => l.level === S.prefs.level);
  const byCourse = new Map();
  for (const c of list) { if (!byCourse.has(c.course)) byCourse.set(c.course, []); byCourse.get(c.course).push(c); }
  host.innerHTML = `<div class="list-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/></svg>المواد <small>${byCourse.size}</small></div>` +
    [...byCourse].map(([course, cs]) => `<section class="course">
      <div class="course-head"><h4 dir="ltr">${esc(course)}</h4><span>${esc(levelName(lv))}</span></div>
      ${cs.map((c) => session(c)).join('')}
    </section>`).join('');
}

function render() {
  if (!S.data.levels.some((l) => l.level === S.prefs.level)) S.prefs.level = S.data.levels[0]?.level ?? 1;
  termTabs(); levelChips(); sectionSelect(); daySelect(); renderNext(); renderList();
  $('sched-term').textContent = S.data.term_ar || '';
  save(PREFS_KEY, { term: S.prefs.term, level: S.prefs.level, section: S.prefs.section, day: S.prefs.day });
}
function setTerm(term) {
  if (!TERMS.some((t) => t.id === term)) return;
  applyTerm(term); S.prefs.day = 'all'; S.prefs.section = 0; render();
}

// ---------------------------------------------------------------- 3D link
const small = () => window.matchMedia('(max-width: 720px)').matches;
/** Tapping a class: show its room inside the building (no walk), or the building when the room is not mapped. */
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
function setOpen(open, { silent = false } = {}) {
  document.documentElement.classList.toggle('sched-open', open);
  $('sched-toggle').setAttribute('aria-expanded', String(open));
  save('epnu.schedule.open', open);
  if (open && !silent) window.dispatchEvent(new CustomEvent('panel:open', { detail: 'sched' }));   // closes «وصلني للجنتي»
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
  window.addEventListener('panel:open', (e) => { if (e.detail !== 'sched') setOpen(false, { silent: true }); });
  // keep the "next class" card fresh
  setInterval(renderNext, 60 * 1000);
}

async function init() {
  if (document.documentElement.classList.contains('embed')) return;   // the EPNU CS Hub has its own timetable UI
  try { await loadData(); } catch (err) { console.warn('timetable not loaded', err); return; }
  $('sched-search').value = '';
  wire(); render();
  const wide = !small();
  setOpen(load('epnu.schedule.open', wide));
  syncTabs(null);
}

if (window.__campus) init(); else window.addEventListener('campus:ready', init, { once: true });

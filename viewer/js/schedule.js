// Timetable side panel (Arabic, RTL): search, level / section / day filters, the next class, and "وديني"
// which asks the 3D view (window.__campus.showRoute) to walk to the room.
// Timetables come from data/schedules/fall-2026.json; an uploaded CSV / JSON replaces it in this browser only.
// Every class is linked to a building and, where the indoor map has it, to a room (data/room_index.json).

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'epnu.schedule.v1';
const PREFS_KEY = 'epnu.schedule.prefs.v1';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_AR = { Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت' };
const TYPE_AR = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل' };
const BUILDING_AR = { 'Engineering Building 1': 'مبنى هندسة 1', 'Engineering Building 2': 'مبنى هندسة 2', 'Main Building': 'المبنى الرئيسي' };
const BUILDING_SHORT = { 'Engineering Building 1': 'مبنى 1', 'Engineering Building 2': 'مبنى 2' };

const S = { data: null, source: 'built-in', index: null, floorsAr: {}, prefs: { level: 1, section: 0, day: 'all', q: '' }, classes: [] };

// ---------------------------------------------------------------- small helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
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

/** Free text from a timetable ("Hall:3", "Drawing Hall: 3", "قاعة 1", "معمل2", "Room:104") -> canonical key. */
export function canonRoom(text) {
  const t = arDigits(String(text || '')).toLowerCase().replace(/[:：]/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = t.match(/drawing\s*hall\s*(\d+)/)) || (m = t.match(/قاعة\s*(?:ال)?رسم\s*(\d+)/))) return `Drawing Hall ${m[1]}`;
  if ((m = t.match(/(?:lecture\s*)?hall\s*(\d+)/)) || (m = t.match(/قاع[ةه]\s*(\d+)/))) return `Hall ${m[1]}`;
  if ((m = t.match(/(?:room|class\s*room)\s*(\d+)/)) || (m = t.match(/(?:غرف[ةه]|فصل|روم)\s*(\d+)/))) return `Room ${m[1]}`;
  if ((m = t.match(/lab\s*(\d+)/)) || (m = t.match(/معمل\s*(\d+)/))) return `Lab ${m[1]}`;
  return String(text || '').trim();
}
export function canonBuilding(text) {
  const t = arDigits(String(text || '')).toLowerCase();
  if (!t.trim()) return '';
  if (/main|رئيس/.test(t)) return 'Main Building';
  const n = (t.match(/(\d)/) || [])[1];
  if (/eng|هندس|مبن|building|bld/.test(t) && n) return `Engineering Building ${n}`;
  return '';
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
function roomAr(key) {
  let m;
  if ((m = key.match(/^Drawing Hall (\d+)$/))) return `قاعة رسم ${m[1]}`;
  if ((m = key.match(/^Hall (\d+)$/))) return `قاعة ${m[1]}`;
  if ((m = key.match(/^Lab (\d+)$/))) return `معمل ${m[1]}`;
  if ((m = key.match(/^Room (\d+)$/))) return `غرفة ${m[1]}`;
  return key;
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
      id: `${lv.level}-${i}`, level: lv.level, day: canonDay(r.day), period: Number(arDigits(r.period)) || 0,
      course: String(r.course || '').trim(), type: canonType(r.type, r.course), group: String(r.group || '').trim(),
      sections: parseSections(r.sections), roomRaw: String(r.room || '').trim(), room, building, buildingId: bId,
      floor: hit ? hit.floor : null, link: hit ? 'room' : bId ? 'building' : 'none',
    };
  });
}
function rebuild() {
  S.classes = S.data.levels.flatMap(linkLevel);
}

async function loadData() {
  const [idx, def, interior] = await Promise.all([
    fetch('data/room_index.json').then((r) => r.json()).catch(() => ({ buildings: {}, rooms: {} })),
    fetch('data/schedules/fall-2026.json').then((r) => r.json()),
    fetch('data/interiors/bld_e2.json').then((r) => r.json()).catch(() => null),
  ]);
  S.index = idx;
  if (interior) for (const f of interior.floors) S.floorsAr[f.id] = f.name_ar;
  S.default = def;
  const stored = load(STORE_KEY, null);
  S.data = stored?.levels ? stored : def;
  S.source = stored?.levels ? (stored._source || 'ملف مرفوع') : 'built-in';
  S.prefs = { ...S.prefs, ...load(PREFS_KEY, {}) };
  rebuild();
}

// ---------------------------------------------------------------- upload (CSV or JSON)
const CSV_COLS = ['level', 'day', 'period', 'course', 'type', 'group', 'sections', 'room', 'building'];

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Accepts our JSON shape, a flat JSON array of rows, or CSV with the CSV_COLS header (Arabic headers work too). */
function importText(name, text) {
  let levels;
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(text)) {
    const j = JSON.parse(text);
    if (j.levels) levels = j.levels;
    else if (Array.isArray(j)) levels = groupRows(j);
    else throw new Error('ملف JSON مش بالشكل المتوقع');
  } else {
    const rows = parseCsv(text);
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    const alias = { 'الفرقة': 'level', 'الفرقه': 'level', 'المستوى': 'level', 'اليوم': 'day', 'الفترة': 'period', 'الفتره': 'period', 'المادة': 'course', 'الماده': 'course',
      'النوع': 'type', 'الجروب': 'group', 'المجموعة': 'group', 'السكاشن': 'sections', 'السكشن': 'sections', 'القاعة': 'room', 'القاعه': 'room', 'المكان': 'room', 'المبنى': 'building', 'المبني': 'building' };
    const cols = head.map((h) => alias[h] || h);
    if (!['day', 'period', 'course', 'room'].every((c) => cols.includes(c))) throw new Error('لازم يكون في الملف أعمدة: day, period, course, room');
    levels = groupRows(rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()]))));
  }
  if (!levels.length || !levels.some((l) => (l.classes || []).length)) throw new Error('الملف مفيهوش محاضرات');
  // keep level names / default buildings from the built-in data when the upload does not say
  for (const l of levels) {
    const d = S.default.levels.find((x) => x.level === l.level) || {};
    l.name_ar ||= d.name_ar || `الفرقة ${l.level}`; l.building ||= d.building || ''; l.sections ??= d.sections ?? 0;
  }
  return { ...S.default, levels: levels.sort((a, b) => a.level - b.level), _source: name };
}
function groupRows(rows) {
  const by = new Map();
  for (const r of rows) {
    const lv = Number(arDigits(r.level || 1)) || 1;
    if (!by.has(lv)) by.set(lv, { level: lv, classes: [] });
    by.get(lv).classes.push(r);
  }
  return [...by.values()];
}
function exportCsv() {
  const lines = [CSV_COLS.join(',')];
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  for (const l of S.data.levels) for (const row of l.classes) {
    const r = Array.isArray(row) ? { day: row[0], period: row[1], course: row[2], type: row[3], group: row[4], sections: row[5], room: row[6], building: row[7] } : row;
    lines.push([l.level, r.day, r.period, r.course, r.type, r.group, r.sections, r.room, r.building || ''].map(q).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'epnu-timetable.csv' });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toast(html, kind = 'ok') {
  const t = $('sched-toast');
  t.className = `sched-toast ${kind}`; t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 6500);
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
function levelChips() {
  $('sched-levels').innerHTML = S.data.levels.map((l) =>
    `<button type="button" class="chip-btn${l.level === S.prefs.level ? ' on' : ''}" data-level="${l.level}">${esc(l.name_ar || `الفرقة ${l.level}`)}</button>`).join('');
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
  const parts = [roomAr(c.room)];
  if (c.building) parts.push(BUILDING_SHORT[c.building] || BUILDING_AR[c.building] || c.building);
  if (c.floor != null && S.floorsAr[c.floor]) parts.push(S.floorsAr[c.floor]);
  return parts.join(' · ');
}
/** HTML: each part isolated with <bdi> so English group names and number ranges keep their order in RTL. */
function whoText(c) {
  const g = c.group === 'Weekly' ? 'كل أسبوع' : c.group ? `Group ${c.group}` : '';
  return [g, sectionsText(c.sections)].filter(Boolean).map((s) => `<bdi>${esc(s)}</bdi>`).join(' · ');
}
/** One class as a light row: when, who, where, type pill and "وديني". */
function session(c, { showCourse = false } = {}) {
  const p = periodOf(c.period);
  const time = p.from ? `${fmtTime(p.from).replace(/ [صم]$/, '')}–${fmtTime(p.to)}` : '';
  const tip = c.link === 'room' ? 'القاعة على الخريطة' : c.link === 'building' ? 'المبنى بس، القاعة لسه مش على الخريطة' : 'المكان مش معروف';
  return `<div class="ses t-${c.type}" data-id="${c.id}">
    <div class="ses-main">
      ${showCourse ? `<div class="ses-course" dir="ltr">${esc(c.course)}</div>` : ''}
      <div class="ses-when">${esc(DAY_AR[c.day] || c.day)} · ${esc(time)}</div>
      <div class="ses-who">${whoText(c)}</div>
      <div class="ses-where" title="${esc(tip)}">${esc(whereText(c))}</div>
    </div>
    <div class="ses-side">
      <span class="pill">${TYPE_AR[c.type]}</span>
      ${c.link !== 'none' ? `<button type="button" class="go" data-go="${c.id}">وديني <span aria-hidden="true">←</span></button>` : ''}
    </div>
  </div>`;
}

function renderNext() {
  const n = nextClass();
  const box = $('sched-next');
  if (!n) { box.hidden = true; return; }
  box.hidden = false;
  const when = n.live ? 'دلوقتي' : n.k === 0 ? (n.inMin <= 60 ? `بعد ${n.inMin} دقيقة` : 'النهارده') : n.k === 1 ? 'بكرة' : DAY_AR[n.c.day];
  box.innerHTML = `<div class="next-head"><span class="dot${n.live ? ' live' : ''}"></span>${n.live ? 'المحاضرة الحالية' : 'محاضرتك الجاية'} · <b>${esc(when)}</b></div>${session(n.c, { showCourse: true })}`;
}

function renderList() {
  const list = filtered().sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.period - b.period);
  const host = $('sched-list');
  if (!list.length) {
    host.innerHTML = `<div class="empty">مفيش محاضرات بالفلتر ده.<br><small>جرّبي تغيّري اليوم أو السكشن أو كلمة البحث.</small></div>`;
    return;
  }
  const byCourse = new Map();
  for (const c of list) { if (!byCourse.has(c.course)) byCourse.set(c.course, []); byCourse.get(c.course).push(c); }
  const lv = S.data.levels.find((l) => l.level === S.prefs.level);
  host.innerHTML = `<div class="list-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19"/></svg>المواد <small>${byCourse.size}</small></div>` +
    [...byCourse].map(([course, cs]) => `<section class="course">
      <div class="course-head"><h4 dir="ltr">${esc(course)}</h4><span>${esc(lv?.name_ar || '')}</span></div>
      ${cs.map((c) => session(c)).join('')}
    </section>`).join('');
}

function renderStats() {
  const lv = S.classes.filter((c) => c.level === S.prefs.level);
  const rooms = lv.filter((c) => c.link === 'room').length;
  $('sched-src').innerHTML = `${S.source === 'built-in' ? 'الجدول الرسمي' : 'من ملف: ' + esc(S.source)} · ${rooms} من ${lv.length} محاضرة متربطة بقاعة على الخريطة`;
  $('sched-reset').hidden = S.source === 'built-in';
}

function render() {
  levelChips(); sectionSelect(); daySelect(); renderNext(); renderList(); renderStats();
  $('sched-term').textContent = S.data.term_ar || '';
  save(PREFS_KEY, { level: S.prefs.level, section: S.prefs.section, day: S.prefs.day });
}

// ---------------------------------------------------------------- 3D link
function go(c) {
  const campus = window.__campus; if (!campus) return;
  if (c.link === 'room') {
    campus.showRoute({ building: c.building, room: c.room, lang: 'ar', roomLabel: roomAr(c.room) });
  } else if (c.buildingId) {
    campus.clearRoute(); campus.select(c.buildingId, true);
  }
  if (window.matchMedia('(max-width: 720px)').matches) setOpen(false);
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
  $('sched-levels').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (!b) return; S.prefs.level = +b.dataset.level; S.prefs.section = 0; render(); });
  $('sched-section').addEventListener('change', (e) => { S.prefs.section = +e.target.value; render(); });
  $('sched-day').addEventListener('change', (e) => { S.prefs.day = e.target.value; render(); });
  $('sched-search').addEventListener('input', (e) => { S.prefs.q = e.target.value; renderList(); });
  $('sched').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const c = S.classes.find((x) => x.id === b.dataset.go); if (c) go(c);
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

  $('sched-upload').addEventListener('click', () => $('sched-file').click());
  $('sched-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = importText(f.name, await f.text());
      S.data = data; S.source = f.name; rebuild();
      save(STORE_KEY, data);
      const all = S.classes.length, rooms = S.classes.filter((c) => c.link === 'room').length, bld = S.classes.filter((c) => c.link === 'building').length;
      if (!S.data.levels.some((l) => l.level === S.prefs.level)) S.prefs.level = S.data.levels[0].level;
      render();
      toast(`اترفع <b>${esc(f.name)}</b>: ${all} محاضرة.<br>${rooms} متربطة بقاعة على الخريطة · ${bld} بالمبنى بس${all - rooms - bld ? ` · ${all - rooms - bld} مكانها مش معروف` : ''}.`);
    } catch (err) {
      toast(`الملف ما اتقريش: ${esc(err.message || err)}`, 'err');
    }
  });
  $('sched-template').addEventListener('click', exportCsv);
  $('sched-reset').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    S.data = S.default; S.source = 'built-in'; rebuild(); render(); toast('رجعنا للجدول الأصلي.');
  });
  // keep the "next class" card fresh
  setInterval(renderNext, 60 * 1000);
}

async function init() {
  if (document.documentElement.classList.contains('embed')) return;   // the EPNU CS Hub has its own timetable UI
  try { await loadData(); } catch (err) { console.warn('timetable not loaded', err); return; }
  $('sched-search').value = '';
  wire(); render();
  const wide = !window.matchMedia('(max-width: 720px)').matches;
  setOpen(load('epnu.schedule.open', wide));
  syncTabs(null);
}

if (window.__campus) init(); else window.addEventListener('campus:ready', init, { once: true });

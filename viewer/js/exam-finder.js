// «وصلني للجنتي»: a round floating button opens a panel where the student picks their level (الفرقة) then the
// subject, sees the exam's day, time and building and the list of its rooms, taps the room whose list has their name
// to see it inside the building, and «وديني» (at the bottom of the panel) walks there.
// Data: data/schedules/midterm-2026.json (from the faculty's PDFs), room keys resolved through data/room_index.json.
// Opening this panel closes the timetable panel (js/schedule.js) and the other way round ('panel:open' event).
import { FLOOR_AR } from './rooms.js';

const $ = (id) => document.getElementById(id);
const DATA = 'data/schedules/midterm-2026.json';
const PREFS_KEY = 'epnu.exam.prefs.v1';
const LEVEL_AR = { 1: 'الفرقة الأولى', 2: 'الفرقة الثانية', 3: 'الفرقة الثالثة', 4: 'الفرقة الرابعة' };
const BUILDING_AR = { 'Engineering Building 1': 'مبنى هندسة 1', 'Engineering Building 2': 'مبنى هندسة 2' };
const FLOOR_ORDER = ['G', '1', '2', '3', '4'];
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  day: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  time: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  place: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/></svg>',
};

const S = { data: null, index: null, level: 0, exam: '', room: '', open: false, peek: false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const examId = (e) => `${e.date}|${e.from}|${e.code}`;
const small = () => window.matchMedia('(max-width: 720px)').matches;
function load() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ level: S.level, exam: S.exam })); } catch { /* private mode */ } }

// ---------------------------------------------------------------- dates
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// Western digits throughout, like the faculty's PDFs (10:30, 14/11)
const fmtDay = (iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', opts).format(new Date(`${iso}T12:00:00`));
function fmtTime(hhmm) { let [h, m] = hhmm.split(':').map(Number); const pm = h >= 12; if (h > 12) h -= 12; return `${h}:${String(m).padStart(2, '0')} ${pm ? 'م' : 'ص'}`; }
const daysWord = (n) => (n === 2 ? 'بعد يومين' : n <= 10 ? `بعد ${n} أيام` : `بعد ${n} يوم`);
/** 'live' | 'today' | 'tomorrow' | 'soon' | 'done', plus a short Arabic word for the badge. */
function status(e, now = new Date()) {
  const start = new Date(`${e.date}T${e.from}:00`), end = new Date(`${e.date}T${e.to}:00`);
  if (now >= end) return { k: 'done', t: 'خلص' };
  if (now >= start) return { k: 'live', t: 'شغال دلوقتي' };
  const days = Math.round((dayStart(start) - dayStart(now)) / 864e5);
  if (days === 0) return { k: 'today', t: 'النهارده' };
  if (days === 1) return { k: 'tomorrow', t: 'بكرة' };
  return { k: 'soon', t: daysWord(days) };
}

// ---------------------------------------------------------------- data
function levelExams(level) {
  const lv = S.data.levels.find((l) => l.level === level);
  return (lv?.exams || []).slice().sort((a, b) => (`${a.date}T${a.from}` < `${b.date}T${b.from}` ? -1 : 1));
}
const currentExam = () => levelExams(S.level).find((e) => examId(e) === S.exam) || null;
/** Room name as printed («مدرج 1») -> where it is on the indoor map. */
function place(name) {
  const key = S.data.rooms[name] || name;
  const bId = S.index.buildings[S.data.building];
  const hit = S.index.rooms[bId]?.[key];
  return { name, key, floor: hit?.floor ?? null, approx: Boolean(hit?.approx), mapped: Boolean(hit) };
}

// ---------------------------------------------------------------- dropdown (expands in place: no clipping inside the sheet)
function dropdown(host, { label, placeholder, value, options, disabled, onPick }) {
  const cur = options.find((o) => o.value === value);
  host.innerHTML = `<div class="dd${disabled ? ' off' : ''}">
    <span class="dd-label">${esc(label)}</span>
    <button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"${disabled ? ' disabled' : ''}>
      <span class="dd-value">${cur ? cur.html : `<span class="dd-ph">${esc(placeholder)}</span>`}</span>
      <svg class="dd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="dd-pop"><ul class="dd-list" role="listbox" aria-label="${esc(label)}">
      ${options.map((o, i) => `<li role="option" tabindex="-1" data-i="${i}" aria-selected="${o.value === value}" class="${o.value === value ? 'sel' : ''}${o.dim ? ' dim' : ''}"><span class="opt-text">${o.html}</span>${o.value === value ? ICON.check : ''}</li>`).join('')}
    </ul></div>
  </div>`;
  const dd = host.firstElementChild, btn = dd.querySelector('.dd-btn'), items = [...dd.querySelectorAll('li')];
  const setOpen = (open) => {
    closeDropdowns(dd);
    dd.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
    if (open) (items.find((li) => li.classList.contains('sel')) || items[0])?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => setOpen(!dd.classList.contains('open')));
  dd.querySelector('.dd-list').addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    setOpen(false); onPick(options[+li.dataset.i].value);
  });
  dd.addEventListener('keydown', (e) => {
    if (!dd.classList.contains('open')) return;
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) { e.preventDefault(); setOpen(false); onPick(options[i].value); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); }
  });
}
function closeDropdowns(except) {
  document.querySelectorAll('#exam .dd.open').forEach((x) => { if (x !== except) { x.classList.remove('open'); x.querySelector('.dd-btn').setAttribute('aria-expanded', 'false'); } });
}

// ---------------------------------------------------------------- render
function renderPickers() {
  dropdown($('ex-level'), {
    label: 'الفرقة الدراسية', placeholder: 'اختار فرقتك', value: S.level,
    options: S.data.levels.map(({ level: n }) => ({ value: n, html: `<span class="opt-main">${LEVEL_AR[n]}</span>` })),
    onPick: (v) => { if (v !== S.level) { S.level = v; S.exam = ''; S.room = ''; save(); render(); setTimeout(() => $('ex-course').querySelector('.dd-btn')?.click(), 150); } },
  });
  const exams = S.level ? levelExams(S.level) : [];
  const next = exams.find((e) => status(e).k !== 'done');
  dropdown($('ex-course'), {
    label: 'المادة', placeholder: S.level ? 'اختار المادة' : 'اختار الفرقة الأول', value: S.exam, disabled: !S.level,
    options: exams.map((e) => {
      const st = status(e);
      const tag = st.k === 'done' ? ' · خلص' : e === next ? ` · <em>${st.k === 'soon' ? 'الجاي' : st.t}</em>` : '';
      return { value: examId(e), dim: st.k === 'done',
        html: `<span class="opt-main" dir="ltr">${esc(e.course)}</span><span class="opt-sub">${esc(fmtDay(e.date))} · <bdi>${esc(fmtTime(e.from))}</bdi>${tag}</span>` };
    }),
    onPick: (v) => { S.exam = v; S.room = ''; save(); render(); },
  });
}

function renderResult() {
  const host = $('ex-result');
  const e = currentExam();
  if (!e) { host.innerHTML = `<p class="ex-hint">${S.level ? 'اختار المادة عشان تظهر لجانها.' : 'اختار فرقتك والمادة، وهنوريك مكان لجنتك جوه المبنى.'}</p>`; return; }
  const st = status(e);
  const rooms = e.rooms.map(place);
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b));
  const count = rooms.length === 1 ? 'لجنة واحدة' : rooms.length === 2 ? 'لجنتين' : `${rooms.length} لجان`;
  host.innerHTML = `<section class="ex-info">
      <div class="ex-course"><h3 dir="ltr">${esc(e.course)}</h3><span dir="ltr">${esc(e.code)}</span></div>
      <ul class="ex-meta">
        <li>${ICON.day}<span>${esc(fmtDay(e.date))}</span><small class="st-${st.k}">${esc(st.t)}</small></li>
        <li>${ICON.time}<span><bdi>${esc(fmtTime(e.from))}</bdi> – <bdi>${esc(fmtTime(e.to))}</bdi></span></li>
        <li>${ICON.place}<span>${esc(BUILDING_AR[S.data.building] || S.data.building)} · ${count}</span></li>
      </ul>
    </section>
    <div class="ex-list-head">
      <h4>اختار لجنتك</h4>
      <p>دوس على اللجنة اللي اسمك فيها عشان تشوف مكانها.</p>
    </div>
    ${floors.map((f) => `<div class="ex-group">
      <div class="ex-group-name">${esc(FLOOR_AR[f] || 'مكان مش محدد')}</div>
      <ul class="ex-rooms">
        ${rooms.filter((r) => r.floor === f).map((r) => `<li><button type="button" class="ex-room${r.name === S.room ? ' sel' : ''}" data-room="${esc(r.name)}" aria-pressed="${r.name === S.room}"${r.mapped ? '' : ' disabled'}>
          <span class="rm-name">${esc(r.name)}</span>
          ${r.approx ? '<span class="rm-note">مكان تقريبي</span>' : ''}
          <span class="rm-radio" aria-hidden="true"></span>
        </button></li>`).join('')}
      </ul>
    </div>`).join('')}`;
}

function renderCta() {
  const e = currentExam();
  const r = e && S.room ? place(S.room) : null;
  const cta = $('ex-cta');
  cta.classList.toggle('on', Boolean(r));
  cta.innerHTML = r ? `<div class="cta-text"><b>${esc(r.name)}</b><small>${esc(FLOOR_AR[r.floor] || '')} · ${esc(BUILDING_AR[S.data.building] || '')}</small></div>
    <button type="button" class="pk-more" data-expand aria-label="رجوع للجان"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg></button>
    <button type="button" class="ex-go" data-go="${esc(r.name)}">وديني</button>` : '';
}

function render() {
  renderPickers(); renderResult(); renderCta();
  $('exam').classList.toggle('peek', S.peek && Boolean(S.room));
}

// ---------------------------------------------------------------- 3D link
function showRoom(name) {
  const r = place(name); const campus = window.__campus;
  S.room = name; render();
  if (!campus || !r.mapped) return;
  campus.showRoom({ building: S.data.building, room: r.key, roomLabel: r.name });
  syncTabs();
  if (small()) { S.peek = true; render(); }
}
function go(name) {
  const r = place(name); const campus = window.__campus;
  if (!campus || !r.mapped) return;
  S.room = name;
  campus.showRoute({ building: S.data.building, room: r.key, lang: 'ar', roomLabel: r.name, buildingLabel: BUILDING_AR[S.data.building] });
  syncTabs();
  setOpen(false);   // the tour card takes over; the floating button brings the panel back
}
function syncTabs() {
  const bId = S.index.buildings[S.data.building];
  document.querySelectorAll('#view-tabs [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === bId));
}

function setOpen(open, { silent = false } = {}) {
  S.open = open; S.peek = false;
  closeDropdowns();
  document.documentElement.classList.toggle('exam-open', open);
  $('exam-toggle').setAttribute('aria-expanded', String(open));
  $('exam').classList.remove('peek');
  if (open && !silent) window.dispatchEvent(new CustomEvent('panel:open', { detail: 'exam' }));
}

function wire() {
  $('exam-toggle').addEventListener('click', () => setOpen(!S.open));
  $('exam-close').addEventListener('click', () => setOpen(false));
  window.addEventListener('panel:open', (e) => { if (e.detail !== 'exam' && S.open) setOpen(false, { silent: true }); });
  const panel = $('exam');
  panel.addEventListener('click', (e) => {
    if (e.target.closest('#exam-close')) return;
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    if (e.target.closest('[data-expand]') || (S.peek && e.target.closest('.ex-head'))) { S.peek = false; render(); return; }
    const r = e.target.closest('[data-room]');
    if (r) showRoom(r.dataset.room);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#exam .dd')) closeDropdowns(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open && !e.target.closest('.dd.open')) setOpen(false); });
  setInterval(() => { if (S.open) render(); }, 60 * 1000);   // keep «النهارده / شغال دلوقتي / خلص» fresh
}

async function init() {
  if (document.documentElement.classList.contains('embed')) return;
  try {
    [S.data, S.index] = await Promise.all([DATA, 'data/room_index.json'].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })));
  } catch (err) { console.warn('exam rooms not loaded', err); $('exam-toggle').hidden = true; return; }
  const p = load();
  if (S.data.levels.some((l) => l.level === p.level)) { S.level = p.level; if (levelExams(p.level).some((e) => examId(e) === p.exam)) S.exam = p.exam; }
  $('exam-term').textContent = `${S.data.title_ar} · ${S.data.term_ar}`;
  wire(); render();
}

if (window.__campus) init(); else window.addEventListener('campus:ready', init, { once: true });

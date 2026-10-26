// TA admin page (admin.html). After the TA password:
//   • choose which exam tab students see (none / الميدترم / نص السنة / آخر السنة);
//   • pick a section (الترم الأول / التاني / الميدترم / نص السنة / آخر السنة) and a level;
//   • terms: upload a timetable (Excel / CSV / JSON) or edit the current one, review, publish;
//   • exams: upload or edit the exam timetable and the room sheets, review, publish.
// Files are read here in the browser (js/midterm-parse.js); the server only receives the checked data.
import { parseFile, levelOfCode, codeKey, termFromJson } from './midterm-parse.js';
import { canonRoom, roomAr, BUILDING_AR, FLOOR_AR, findRoom } from './rooms.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL_AR = { 1: 'سنة أولى', 2: 'سنة تانية', 3: 'سنة تالتة', 4: 'سنة رابعة' };
const BUILDINGS = ['Engineering Building 1', 'Engineering Building 2', 'Main Building'];
const SECTIONS = {
  term1: { label: 'الترم الأول', kind: 'term', file: 'data/schedules/fall-2026.json' },
  term2: { label: 'الترم التاني', kind: 'term', file: 'data/schedules/spring-2027.json' },
  midterm: { label: 'الميدترم', kind: 'exam' },
  midyear: { label: 'امتحانات نص السنة', kind: 'exam' },
  final: { label: 'امتحانات آخر السنة', kind: 'exam' },
};
const EXAM_SHORT = { midterm: 'الميدترم', midyear: 'نص السنة', final: 'آخر السنة' };
const DAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const DAY_AR = { Saturday: 'السبت', Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة' };
const TYPE_AR = { lecture: 'محاضرة', section: 'سكشن', lab: 'معمل' };
const DEFAULT_PERIODS = [{ n: 1, from: '10:00', to: '11:15' }, { n: 2, from: '11:20', to: '12:30' }, { n: 3, from: '12:35', to: '13:45' }, { n: 4, from: '13:50', to: '15:00' }];
const TOKEN_KEY = 'epnu.admin.token';
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } } };
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

const A = {
  token: ss.get(TOKEN_KEY), section: SECTIONS[ls.get('epnu.admin.section')] ? ls.get('epnu.admin.section') : 'term1',
  level: Number(ls.get('epnu.admin.level')) || 1, tab: 'schedule', server: null, index: null, builtin: {},
  schedDraft: null, sheetDrafts: [], termDraft: null, busy: false,
};
const sec = () => SECTIONS[A.section];
const isTerm = () => sec().kind === 'term';
const examKey = (e) => `${e.date}|${codeKey(e.code) || String(e.course || '').toLowerCase()}`;
const lvl = () => A.server?.levels?.[A.level] || { schedule: { exams: [] }, sheets: [] };
const fmtDate = (iso) => { const d = new Date(`${iso}T12:00:00`); return iso && !isNaN(d) ? new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : 'من غير تاريخ'; };
const fmtTime = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const pm = h >= 12; if (h > 12) h -= 12; return `${h}:${String(m).padStart(2, '0')}${pm ? ' م' : ' ص'}`; };
const fmtStamp = (iso) => (iso ? new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');
const buildingAr = (b) => BUILDING_AR[b] || b || 'مبنى مش محدد';

// ---------------------------------------------------------------- server
async function api(action, payload = {}) {
  const r = await fetch('api/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(A.token ? { Authorization: `Bearer ${A.token}` } : {}) },
    body: JSON.stringify({ action, ...payload }),
  }).catch(() => null);
  if (!r) throw new Error('مفيش اتصال بالسيرفر');
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!j && (r.status === 404 || r.status === 405 || r.status === 501)) throw new Error('السيرفر (API) مش شغال هنا: افتح نسخة Vercel، أو شغّل node dev-server.mjs');
  if (r.status === 401 && action !== 'login') { logout(); throw new Error(j?.error || 'سجّل دخول تاني'); }
  if (!r.ok) throw new Error(j?.error || `خطأ ${r.status}`);
  return j;
}
async function refresh() {
  if (isTerm()) await loadBuiltin(A.section);
  A.server = await api('state', { section: A.section });
  render();
}

let pdfjsP;
const pdfjs = () => (pdfjsP ||= import('../lib/pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href; return m; }));

// ---------------------------------------------------------------- built-in term data (the site's own files)
async function loadBuiltin(term) {
  if (A.builtin[term]) return A.builtin[term];
  const j = await fetch(SECTIONS[term].file).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return (A.builtin[term] = j || { levels: [], periods: DEFAULT_PERIODS });
}
const periodsOf = () => (A.builtin[A.section]?.periods?.length ? A.builtin[A.section].periods : DEFAULT_PERIODS);
const defaultBuilding = (L = A.level) => A.builtin[A.section]?.levels?.find((l) => l.level === L)?.building || (L === 1 ? 'Engineering Building 1' : 'Engineering Building 2');
/** What students see now for this term + level: the TA-published rows, else the built-in ones. */
function currentTerm(L = A.level) {
  const pub = A.server?.levels?.[L];
  if (pub?.classes?.length) return { rows: pub.classes.map((c) => ({ ...c })), published: pub };
  const rows = termFromJson({ levels: (A.builtin[A.section]?.levels || []).filter((l) => l.level === L) });
  return { rows, published: null };
}

// ---------------------------------------------------------------- rooms on the map
/** Rooms the 3D map knows in a building: [{ key: 'Lab 2', floor: '1' }] (one per physical room). */
function roomsOf(building) {
  const bId = A.index?.buildings?.[building]; const byId = new Map();
  for (const [k, v] of Object.entries(A.index?.rooms?.[bId] || {})) {
    if (!/^[\x20-\x7e]+$/.test(k)) continue;
    const cur = byId.get(v.room); if (!cur || k.length < cur.key.length) byId.set(v.room, { key: k, floor: v.floor });
  }
  const order = { G: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
  return [...byId.values()].sort((a, b) => (order[a.floor] ?? 9) - (order[b.floor] ?? 9) || a.key.localeCompare(b.key, 'en', { numeric: true }));
}
function link(sheet) {
  const hit = findRoom(A.index, sheet.building, sheet.room);
  sheet.linked = hit.linked;
  if (hit.linked) sheet.floor = hit.floor;
  return sheet;
}

// ---------------------------------------------------------------- uploads
async function readFiles(files, kind) {
  const out = [];
  for (const f of files) {
    try { out.push({ name: f.name, ...(await parseFile(f.name, new Uint8Array(await f.arrayBuffer()), kind, f.name.toLowerCase().endsWith('.pdf') ? await pdfjs() : null)) }); }
    catch (err) { toast(`«${esc(f.name)}» ما اتقريش: ${esc(err.message || err)}`, 'err'); }
  }
  return out;
}
async function onTermFiles(files) {
  const read = await readFiles(files, 'term'); if (!read.length) return;
  const all = read.flatMap((r) => r.classes);
  if (!all.length) { toast('ملقيناش محاضرات في الملف. لازم يكون فيه صف عناوين فيه «اليوم» و«المادة» (زي الملف اللي بيتنزّل من زرار «نزّل الجدول»).', 'err'); return; }
  const mine = all.filter((c) => !c.level || c.level === A.level);
  const other = all.length - mine.length;
  if (!mine.length) { toast(`الملف فيه ${all.length} محاضرة بس كلها لدفعات تانية. اختار الدفعة الصح من فوق.`, 'err'); return; }
  const periods = periodsOf();
  for (const c of mine) if (!c.period && c.from) c.period = periods.find((p) => p.from === c.from)?.n || 0;
  A.termDraft = { rows: mine.map(({ level, ...c }) => c), source: read.map((r) => r.name).join('، ') };
  render();
  toast(`اتقرى ${mine.length} محاضرة لـ ${LEVEL_AR[A.level]}${other ? ` (واتشال ${other} صف لدفعات تانية)` : ''}. راجعهم تحت وبعدين دوس «نشر».`);
}
async function onScheduleFiles(files) {
  const read = await readFiles(files, 'schedule'); if (!read.length) return;
  const exams = read.flatMap((r) => r.exams);
  if (!exams.length) { toast('ملقيناش امتحانات في الملف. لازم يكون فيه صف المواعيد (10:30 – 11:30) وتاريخ لكل يوم وخانات «المادة | الكود».', 'err'); return; }
  const hint = read.find((r) => r.level)?.level || null;
  const building = exams.find((e) => e.building)?.building || '';
  for (const e of exams) e.building ||= building;
  A.schedDraft = { exams, source: read.map((r) => r.name).join('، '), hint };
  render();
  toast(`اتقرى ${exams.length} امتحان. راجعهم تحت وبعدين دوس «نشر».`);
}
async function onSheetFiles(files) {
  const read = await readFiles(files, 'sheets'); if (!read.length) return;
  const schedule = lvl().schedule.exams || [];
  let n = 0;
  for (const r of read) r.sheets.forEach((s, i) => {
    // fill what the sheet does not say from the level's published timetable (same course code)
    const ex = schedule.find((e) => codeKey(e.code) && codeKey(e.code) === codeKey(s.code)) || schedule.find((e) => e.course && e.course.toLowerCase() === s.course.toLowerCase());
    if (ex) { s.date ||= ex.date; s.from ||= ex.from; s.to ||= ex.to; s.course ||= ex.course; s.code ||= ex.code; s.building ||= ex.building; }
    s.building ||= A.sheetDrafts.at(-1)?.building || 'Engineering Building 2';
    s.source = r.sheets.length > 1 ? `${r.name} · ${i + 1}` : r.name;
    A.sheetDrafts.push(link(s)); n++;
  });
  if (!n) { toast('ملقيناش أرقام طلاب في الملفات دي. الكشف لازم يكون فيه عمود ID / الكود.', 'err'); return; }
  render();
  toast(`اتقرى ${n} كشف. راجع القاعة والتاريخ لكل كشف وبعدين دوس «نشر».`);
}

/** The level's current term timetable as CSV (opens in Excel), ready to edit and upload back. */
function downloadTerm() {
  const { rows } = A.termDraft || currentTerm();
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const lines = [['level', 'day', 'period', 'course', 'type', 'group', 'sections', 'room', 'building'].join(',')];
  for (const c of rows) lines.push([A.level, c.day, c.period || '', c.course, c.type, c.group, c.sections, c.room, c.building].map(q).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${A.section}-level${A.level}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- rendering
function render() {
  renderVisible(); renderSections(); renderLevels();
  $('term-panel').hidden = !isTerm(); $('exam-panel').hidden = isTerm();
  if (isTerm()) { renderTermStatus(); renderTermDraft(); return; }
  renderSummary();
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));
  for (const t of ['schedule', 'sheets', 'test']) $(`tab-${t}`).hidden = A.tab !== t;
  renderSchedDraft(); renderSchedCurrent(); renderSheetDrafts(); renderSheetsCurrent();
}

/** "The exam tab students see": hidden or one of the three exam periods. */
function renderVisible() {
  const cur = A.server?.settings?.exam || '';
  const seen = ['الترم الأول', 'الترم التاني', ...(cur ? [EXAM_SHORT[cur]] : [])];
  $('visible').innerHTML = `<div class="vis-head">
      <div><h3>تبويب الامتحانات عند الطلاب</h3>
        <p>الطلاب شايفين دلوقتي: <b>${seen.join('، ')}</b>. اختار الامتحانات اللي تظهر، أو «مخفي» بعد ما الامتحانات تخلص.</p></div>
    </div>
    <div class="seg" role="radiogroup" aria-label="الامتحانات الظاهرة للطلاب">
      ${[['', 'مخفي'], ['midterm', 'الميدترم'], ['midyear', 'نص السنة'], ['final', 'آخر السنة']].map(([v, t]) =>
        `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-visible="${v}">${t}</button>`).join('')}
    </div>`;
}

function renderSections() {
  const sm = A.server?.summary; const vis = A.server?.settings?.exam || '';
  $('sections').innerHTML = Object.entries(SECTIONS).map(([id, s]) => {
    let note;
    if (s.kind === 'term') { const n = Object.values(sm?.terms?.[id] || {}).filter(Boolean).length; note = n ? `${n} دفعة متعدّل جدولها` : 'الجدول الأصلي'; }
    else { const ex = Object.values(sm?.exams?.[id] || {}).reduce((a, x) => a + (x?.exams || 0), 0); note = `${ex} امتحان${vis === id ? ' · ظاهر للطلاب' : ''}`; }
    return `<button type="button" class="section${id === A.section ? ' on' : ''}${vis === id ? ' live' : ''}" data-section="${id}" role="tab" aria-selected="${id === A.section}">
      <b>${s.label}</b><small>${note}</small></button>`;
  }).join('');
}

function renderLevels() {
  const sm = A.server?.summary;
  $('levels').innerHTML = [1, 2, 3, 4].map((L) => {
    let note;
    if (isTerm()) { const n = sm?.terms?.[A.section]?.[L] || 0; note = n ? `${n} محاضرة (متعدّل)` : 'الجدول الأصلي'; }
    else { const x = sm?.exams?.[A.section]?.[L] || {}; note = `${x.exams || 0} امتحان · ${x.students || 0} طالب ليهم لجنة`; }
    return `<button type="button" class="level${L === A.level ? ' on' : ''}" data-level="${L}" role="tab" aria-selected="${L === A.level}">
      <b>${LEVEL_AR[L]}</b><small>${note}</small></button>`;
  }).join('');
}

function buildingSelect(value, attrs, empty = 'اختار المبنى') {
  return `<select ${attrs}>${['', ...BUILDINGS].map((b) => `<option value="${esc(b)}"${b === value ? ' selected' : ''}>${b ? esc(buildingAr(b)) : esc(empty)}</option>`).join('')}</select>`;
}

// ---- terms
function renderTermStatus() {
  $('term-step').textContent = `جدول ${LEVEL_AR[A.level]} — ${sec().label}`;
  const { rows, published } = currentTerm();
  $('term-status').innerHTML = `<section class="card status">
    <div><b>${published ? 'جدول متعدّل من المعيدين' : 'الجدول الأصلي اللي على الموقع'}</b>
      <p class="muted">${rows.length} محاضرة${published ? ` · آخر تعديل ${esc(fmtStamp(published.updatedAt))}${published.source ? ` · ${esc(published.source)}` : ''}` : ''}</p></div>
    <div class="actions">
      <button type="button" data-term-edit ${A.termDraft ? 'disabled' : ''}>عدّل الجدول ده</button>
      <button type="button" data-term-download>نزّل الجدول (Excel / CSV)</button>
      ${published ? '<button type="button" class="ghost danger" data-term-reset>رجّع للجدول الأصلي</button>' : ''}
    </div></section>`;
}

function termRowLink(c) {
  const b = c.building || defaultBuilding();
  return c.room ? findRoom(A.index, b, canonRoom(c.room)).linked : false;
}
function renderTermDraft() {
  const host = $('term-review'); const dr = A.termDraft;
  if (!dr) { host.innerHTML = ''; return; }
  const periods = periodsOf(); const def = defaultBuilding();
  const roomList = [...new Set(BUILDINGS.flatMap((b) => roomsOf(b).map((r) => r.key)))];
  const order = (c) => `${DAYS.indexOf(c.day)}${c.period}`;
  const idx = dr.rows.map((c, i) => i).sort((a, b) => order(dr.rows[a]).localeCompare(order(dr.rows[b])));
  const unlinked = dr.rows.filter((c) => !termRowLink(c)).length;
  host.innerHTML = `<section class="card review">
    <div class="card-head"><h3>مراجعة الجدول قبل النشر <small>${esc(dr.source)} · ${dr.rows.length} محاضرة</small></h3></div>
    <p class="muted small">المبنى الفاضي يعني مبنى الدفعة: ${esc(buildingAr(def))}. القاعة اكتبها زي «Hall 3» أو «قاعة 3» أو «Lab 2».</p>
    ${unlinked ? `<p class="note warn">${unlinked} محاضرة قاعتها مش على الخريطة (عليها علامة ✗): «وديني» هيوصّل للمبنى بس.</p>` : ''}
    <datalist id="room-keys">${roomList.map((k) => `<option value="${esc(k)}">${esc(roomAr(k))}</option>`).join('')}</datalist>
    <div class="table-wrap"><table class="edit">
      <thead><tr><th>اليوم</th><th>الفترة</th><th>المادة</th><th>النوع</th><th>الجروب</th><th>السكاشن</th><th>القاعة</th><th>المبنى</th><th></th></tr></thead>
      <tbody>${idx.map((i) => { const c = dr.rows[i]; const ok = termRowLink(c); return `<tr data-t="${i}">
        <td><select data-tf="day">${['', ...DAYS].map((d) => `<option value="${d}"${d === c.day ? ' selected' : ''}>${d ? DAY_AR[d] : 'اختار'}</option>`).join('')}</select></td>
        <td><select data-tf="period">${[...periods.map((p) => [p.n, `${p.n} · ${fmtTime(p.from).replace(/ [صم]$/, '')}`]), ...(c.period ? [] : [[0, c.from ? `${fmtTime(c.from)}` : 'اختار']])].map(([v, t]) => `<option value="${v}"${Number(v) === Number(c.period) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
        <td><input data-tf="course" value="${esc(c.course)}" dir="ltr"></td>
        <td><select data-tf="type">${Object.entries(TYPE_AR).map(([v, t]) => `<option value="${v}"${v === c.type ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input data-tf="group" value="${esc(c.group)}" dir="ltr" class="in-short"></td>
        <td><input data-tf="sections" value="${esc(c.sections)}" dir="ltr" class="in-short" placeholder="1:5"></td>
        <td class="room-cell"><input data-tf="room" value="${esc(c.room)}" dir="ltr" list="room-keys" class="in-room"><span class="${ok ? 'ok' : 'warn'}" title="${ok ? 'على الخريطة' : 'مش على الخريطة'}">${ok ? '✓' : '✗'}</span></td>
        <td>${buildingSelect(c.building, 'data-tf="building"', 'مبنى الدفعة')}</td>
        <td><button type="button" class="x" data-del-row="${i}" title="شيل الصف">×</button></td></tr>`; }).join('')}</tbody>
    </table></div>
    <div class="actions">
      <button type="button" data-add-row>+ محاضرة جديدة</button>
      <span class="grow"></span>
      <button type="button" class="ghost" data-cancel-term>إلغاء</button>
      <button type="button" class="primary" data-publish-term>نشر جدول ${LEVEL_AR[A.level]} (${dr.rows.length} محاضرة)</button>
    </div></section>`;
}

// ---- exams
function renderSummary() {
  const d = lvl(); const sheets = d.sheets || [];
  const students = new Set(sheets.flatMap((s) => s.students.map((x) => x.id))).size;
  const unlinked = sheets.filter((s) => !s.linked).length;
  $('summary').innerHTML = `
    <div><b>${d.schedule?.exams?.length || 0}</b><span>امتحان في الجدول المنشور</span></div>
    <div><b>${sheets.length}</b><span>كشف قاعة منشور</span></div>
    <div><b>${students}</b><span>طالب يقدر يلاقي لجنته</span></div>
    <div class="${unlinked ? 'warn' : ''}"><b>${unlinked}</b><span>كشف قاعته مش على الخريطة</span></div>`;
}

function renderSchedDraft() {
  const host = $('sched-review'); const dr = A.schedDraft;
  if (!dr) { host.innerHTML = ''; return; }
  const warn = dr.hint && dr.hint !== A.level ? `<p class="note warn">الملف مكتوب فيه «Level ${dr.hint}» وانت مختار ${LEVEL_AR[A.level]}. اتأكد من الدفعة قبل النشر.</p>` : '';
  host.innerHTML = `<section class="card review">
    <div class="card-head"><h3>مراجعة الجدول قبل النشر <small>${esc(dr.source)}</small></h3>
      <label class="mini">المبنى لكل الامتحانات ${buildingSelect('', 'data-all-building')}</label></div>
    ${warn}
    <div class="table-wrap"><table class="edit">
      <thead><tr><th>التاريخ</th><th>من</th><th>إلى</th><th>المادة</th><th>الكود</th><th>المبنى</th><th></th></tr></thead>
      <tbody>${dr.exams.map((e, i) => `<tr data-i="${i}">
        <td><input type="date" data-f="date" value="${esc(e.date)}"><small>${esc(fmtDate(e.date))}</small></td>
        <td><input type="time" data-f="from" value="${esc(e.from)}"></td>
        <td><input type="time" data-f="to" value="${esc(e.to)}"></td>
        <td><input data-f="course" value="${esc(e.course)}" dir="ltr"></td>
        <td><input data-f="code" value="${esc(e.code)}" dir="ltr" class="in-code"></td>
        <td>${buildingSelect(e.building, 'data-f="building"')}</td>
        <td><button type="button" class="x" data-del-exam="${i}" title="شيل الصف">×</button></td></tr>`).join('')}</tbody>
    </table></div>
    <div class="actions">
      <button type="button" data-add-exam>+ صف جديد</button>
      <span class="grow"></span>
      <button type="button" class="ghost" data-cancel-sched>إلغاء</button>
      <button type="button" class="primary" data-publish-sched>نشر جدول ${LEVEL_AR[A.level]} (${dr.exams.length} امتحان)</button>
    </div></section>`;
}

function renderSchedCurrent() {
  const ex = lvl().schedule?.exams || []; const host = $('sched-current');
  if (!ex.length) { host.innerHTML = `<p class="empty">لسه مفيش جدول ${esc(sec().label)} منشور لـ ${LEVEL_AR[A.level]}.</p>`; return; }
  const sheets = lvl().sheets || [];
  host.innerHTML = `<section class="card"><div class="card-head"><h3>الجدول المنشور دلوقتي <small>${esc(lvl().schedule.source || '')}</small></h3>
      <button type="button" data-sched-edit ${A.schedDraft ? 'disabled' : ''}>عدّل الجدول ده</button>
      <button type="button" class="ghost danger" data-clear="schedule">مسح الجدول</button></div>
    <ul class="exams">${ex.map((e) => {
      const rooms = sheets.filter((s) => examKey(s) === examKey(e));
      return `<li><div><b dir="ltr">${esc(e.course)}</b> <span class="code">${esc(e.code)}</span></div>
        <div class="muted">${esc(fmtDate(e.date))} · ${esc(fmtTime(e.from))} – ${esc(fmtTime(e.to))} · ${esc(buildingAr(e.building))}</div>
        <div class="${rooms.length ? 'ok' : 'muted'}">${rooms.length ? `${rooms.length} قاعة · ${rooms.reduce((n, s) => n + s.students.length, 0)} طالب` : 'لسه مفيش كشوف قاعات'}</div></li>`;
    }).join('')}</ul></section>`;
}

function sheetWarnings(s, i) {
  const w = [];
  if (!s.date) w.push(['err', 'اكتب تاريخ الامتحان']);
  if (!s.from || !s.to) w.push(['err', 'اكتب ميعاد البداية والنهاية']);
  if (!s.linked) w.push(['warn', `القاعة «${s.roomRaw || s.room || '؟'}» مش متربطة بالخريطة: اختار القاعة من القائمة عشان «وديني» يشتغل`]);
  const cl = levelOfCode(s.code); if (cl && cl !== A.level) w.push(['warn', `الكود ${s.code} شكله مادة ${LEVEL_AR[cl]} وانت مختار ${LEVEL_AR[A.level]} (عادي لو كشف باقيين)`]);
  const sched = lvl().schedule?.exams || [];
  if (sched.length && !sched.some((e) => examKey(e) === examKey(s))) w.push(['info', 'المادة دي بالتاريخ ده مش في الجدول المنشور للدفعة (هتظهر برضه للطلاب)']);
  const dup = A.sheetDrafts.findIndex((o, j) => j !== i && examKey(o) === examKey(s) && o.students.some((x) => s.students.some((y) => y.id === x.id)));
  if (dup >= 0) w.push(['err', `فيه أرقام مكررة مع الكشف رقم ${dup + 1} لنفس الامتحان`]);
  return w;
}

function renderSheetDrafts() {
  const host = $('sheets-review');
  if (!A.sheetDrafts.length) { host.innerHTML = ''; return; }
  const blocking = A.sheetDrafts.some((s, i) => sheetWarnings(s, i).some(([k]) => k === 'err'));
  host.innerHTML = `<section class="card review"><div class="card-head"><h3>مراجعة الكشوف قبل النشر <small>${A.sheetDrafts.length} كشف · ${A.sheetDrafts.reduce((n, s) => n + s.students.length, 0)} طالب</small></h3></div>
    <div class="sheets">${A.sheetDrafts.map((s, i) => {
      const rooms = roomsOf(s.building); const known = rooms.some((r) => r.key === s.room);
      const warns = sheetWarnings(s, i);
      return `<article class="sheet${s.linked ? ' linked' : ''}" data-s="${i}">
        <header>
          <span class="num">${i + 1}</span>
          <div class="sheet-title"><b dir="ltr">${esc(s.course || 'مادة من غير اسم')}</b><small title="${esc(s.source)}">${esc(s.source)}</small></div>
          <span class="badge ${s.linked ? 'ok' : 'warn'}">${s.linked ? '✓ على الخريطة' : 'مش على الخريطة'}</span>
          <button type="button" class="x" data-del-sheet="${i}" title="شيل الكشف">×</button>
        </header>
        <div class="grid">
          <label class="span-2 full-sm">المادة<input data-sf="course" value="${esc(s.course)}" dir="ltr"></label>
          <label>الكود<input data-sf="code" value="${esc(s.code)}" dir="ltr" class="in-code"></label>
          <label>التاريخ<input type="date" data-sf="date" value="${esc(s.date)}"><small class="hint">${esc(s.date ? fmtDate(s.date) : 'اكتب التاريخ')}</small></label>
          <label>من<input type="time" data-sf="from" value="${esc(s.from)}"><small class="hint">${esc(fmtTime(s.from))}</small></label>
          <label>إلى<input type="time" data-sf="to" value="${esc(s.to)}"><small class="hint">${esc(fmtTime(s.to))}</small></label>
          <label>المبنى${buildingSelect(s.building, 'data-sf="building"')}</label>
          <label class="span-2">القاعة
            <select data-sf="room">
              ${known ? '' : `<option value="${esc(s.room)}" selected>${esc(s.roomRaw || s.room || 'مش معروفة')} (مش على الخريطة)</option>`}
              ${rooms.map((r) => `<option value="${esc(r.key)}"${r.key === s.room ? ' selected' : ''}>${esc(roomAr(r.key))} · ${esc(FLOOR_AR[r.floor] || '')}</option>`).join('')}
            </select></label>
        </div>
        ${s.place ? `<p class="place">المكتوب في الكشف: <span>${esc(s.place)}</span></p>` : ''}
        ${warns.map(([k, t]) => `<p class="note ${k}">${esc(t)}</p>`).join('')}
        <details><summary>${s.students.length} طالب في القاعة دي</summary>
          <ol class="students">${s.students.map((x) => `<li><bdi>${esc(x.id)}</bdi> ${esc(x.name)} <small>${esc(x.status)}</small></li>`).join('')}</ol></details>
      </article>`;
    }).join('')}</div>
    <div class="actions"><span class="grow"></span>
      <button type="button" class="ghost" data-cancel-sheets>إلغاء</button>
      <button type="button" class="primary" data-publish-sheets ${blocking ? 'disabled title="صلّح العلامات الحمرا الأول"' : ''}>نشر ${A.sheetDrafts.length} كشف لـ ${LEVEL_AR[A.level]}</button>
    </div></section>`;
}

function renderSheetsCurrent() {
  const sheets = lvl().sheets || []; const host = $('sheets-current');
  if (!sheets.length) { host.innerHTML = `<p class="empty">لسه مفيش كشوف قاعات منشورة لـ ${LEVEL_AR[A.level]} في ${esc(sec().label)}.</p>`; return; }
  const groups = new Map();
  for (const s of sheets) { const k = examKey(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  host.innerHTML = `<section class="card"><div class="card-head"><h3>الكشوف المنشورة دلوقتي</h3>
      <button type="button" class="ghost danger" data-clear="sheets">مسح كل الكشوف</button></div>
    ${[...groups.values()].sort((a, b) => `${a[0].date}${a[0].from}`.localeCompare(`${b[0].date}${b[0].from}`)).map((g) => `<div class="group">
      <div class="group-head"><b dir="ltr">${esc(g[0].course)}</b> <span class="code">${esc(g[0].code)}</span>
        <span class="muted">${esc(fmtDate(g[0].date))} · ${esc(fmtTime(g[0].from))} – ${esc(fmtTime(g[0].to))} · ${g.reduce((n, s) => n + s.students.length, 0)} طالب</span></div>
      <ul class="rooms">${g.map((s) => `<li class="${s.linked ? '' : 'warn'}">
        <span>${esc(s.linked ? roomAr(s.room) : s.roomRaw || s.room)} · ${esc(buildingAr(s.building))}${s.floor ? ` · ${esc(FLOOR_AR[s.floor] || '')}` : ''}</span>
        <span class="muted">${s.students.length} طالب${s.linked ? '' : ' · مش على الخريطة'}</span>
        <button type="button" class="x" data-del-pub="${esc(s.id)}" title="امسح الكشف ده">×</button></li>`).join('')}</ul></div>`).join('')}
  </section>`;
}

async function runTest(id) {
  const out = $('test-out'); out.innerHTML = '<p class="muted">بندوّر…</p>';
  try {
    const r = await fetch(`api/timetable?id=${encodeURIComponent(id)}`); const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    if (j.closed) { out.innerHTML = '<p class="note warn">مفيش امتحانات ظاهرة للطلاب دلوقتي، فالطالب مش هيلاقي خانة الكود أصلًا. اختار الامتحانات من «تبويب الامتحانات عند الطلاب» فوق.</p>'; return; }
    const other = j.period && j.period !== A.section ? `<p class="note info">التجربة دي على ${esc(SECTIONS[j.period].label)} (الظاهر للطلاب)، مش على ${esc(sec().label)}.</p>` : '';
    if (!j.found) { out.innerHTML = `${other}<p class="note warn">الكود ${esc(j.id)} مش موجود في أي كشف منشور.</p>`; return; }
    out.innerHTML = `${other}<section class="card"><h3>أهلًا يا ${esc(j.first || 'طالب')} <small>${esc(j.id)}</small></h3><ul class="exams">${j.exams.map((e) => {
      const hit = findRoom(A.index, e.building, e.room);
      const where = `${hit.linked ? roomAr(e.room) : e.roomRaw || e.room} · ${buildingAr(e.building)}${e.floor ? ` · ${FLOOR_AR[e.floor] || ''}` : ''}`;
      const href = `./?building=${encodeURIComponent(e.building)}&room=${encodeURIComponent(e.room)}&lang=ar&room_label=${encodeURIComponent(roomAr(e.room))}`;
      return `<li><div><b dir="ltr">${esc(e.course)}</b> <span class="code">${esc(e.code)}</span> <small>${LEVEL_AR[e.level] || ''}</small></div>
        <div class="muted">${esc(fmtDate(e.date))} · ${esc(fmtTime(e.from))} – ${esc(fmtTime(e.to))} · رقمه في الكشف ${e.seq}</div>
        <div class="${hit.linked ? 'ok' : 'warn'}">${esc(where)} ${hit.linked ? `· <a href="${esc(href)}" target="_blank" rel="noopener">وديني على الخريطة ←</a>` : '(مش على الخريطة)'}</div></li>`;
    }).join('')}</ul></section>`;
  } catch (err) { out.innerHTML = `<p class="note err">${esc(err.message || err)}</p>`; }
}

// ---------------------------------------------------------------- actions
function toast(html, kind = 'ok') {
  const t = $('toast'); t.className = `toast ${kind}`; t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 9000 : 6000);
}
async function busy(btn, fn) {
  if (A.busy) return; A.busy = true; if (btn) btn.disabled = true;
  try { await fn(); } catch (err) { toast(esc(err.message || err), 'err'); } finally { A.busy = false; if (btn && btn.isConnected) btn.disabled = false; }
}
function logout() { A.token = null; ss.set(TOKEN_KEY, null); $('app').hidden = true; $('login').hidden = false; $('logout').hidden = true; }
function showApp() { $('login').hidden = true; $('app').hidden = false; $('logout').hidden = false; }
const hasDrafts = () => Boolean(A.termDraft || A.schedDraft || A.sheetDrafts.length);
const dropDrafts = () => { A.termDraft = null; A.schedDraft = null; A.sheetDrafts = []; };

function wire() {
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault(); $('login-err').textContent = '';
    busy(e.submitter, async () => {
      try {
        const { token } = await api('login', { password: $('pw').value });
        A.token = token; ss.set(TOKEN_KEY, token); $('pw').value = '';
        showApp(); await refresh();
      } catch (err) { $('login-err').textContent = err.message; }
    });
  });
  $('logout').addEventListener('click', logout);

  for (const drop of document.querySelectorAll('.drop')) {
    const input = drop.querySelector('input');
    const handlers = { term: onTermFiles, schedule: onScheduleFiles, sheets: onSheetFiles };
    const go = (files) => busy(null, () => handlers[drop.dataset.kind](files));
    input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) go(files); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const files = [...e.dataTransfer.files]; if (files.length) go(files); });
  }

  const app = $('app');
  app.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.visible != null) {
      const v = t.dataset.visible; if (v === (A.server?.settings?.exam || '')) return;
      const msg = v ? `الطلاب هيشوفوا تبويب «${EXAM_SHORT[v]}» جنب الترم الأول والتاني. نكمّل؟` : 'تبويب الامتحانات هيختفي من عند الطلاب (الداتا مش هتتمسح). نكمّل؟';
      if (!confirm(msg)) return;
      busy(t, async () => { await api('setVisible', { exam: v }); await refresh(); toast(v ? `تبويب «${EXAM_SHORT[v]}» ظاهر للطلاب دلوقتي.` : 'تبويب الامتحانات اتخفى من عند الطلاب.'); });
      return;
    }
    if (t.dataset.section) {
      if (t.dataset.section === A.section) return;
      if (hasDrafts() && !confirm('فيه تعديلات لسه متنشرتش هتضيع. نكمّل؟')) return;
      dropDrafts(); A.section = t.dataset.section; ls.set('epnu.admin.section', A.section); A.tab = 'schedule';
      busy(null, refresh); return;
    }
    if (t.dataset.level) {
      const L = Number(t.dataset.level); if (L === A.level) return;
      if ((A.termDraft || A.schedDraft) && !confirm('فيه تعديلات لسه متنشرتش للدفعة دي هتضيع. نكمّل؟')) return;
      A.termDraft = null; A.schedDraft = null;
      A.level = L; ls.set('epnu.admin.level', A.level); A.sheetDrafts.forEach(link); render(); return;
    }
    if (t.dataset.tab) { A.tab = t.dataset.tab; render(); return; }
    // terms
    if (t.hasAttribute('data-term-edit')) { const { rows, published } = currentTerm(); A.termDraft = { rows, source: published ? 'تعديل على الجدول المنشور' : 'تعديل على الجدول الأصلي' }; render(); return; }
    if (t.hasAttribute('data-term-download')) { downloadTerm(); return; }
    if (t.hasAttribute('data-cancel-term')) { A.termDraft = null; render(); return; }
    if (t.dataset.delRow != null) { A.termDraft.rows.splice(Number(t.dataset.delRow), 1); renderTermDraft(); return; }
    if (t.hasAttribute('data-add-row')) { A.termDraft.rows.push({ day: '', period: 1, from: '', to: '', course: '', type: 'lecture', group: '', sections: '', room: '', building: '' }); renderTermDraft(); return; }
    if (t.hasAttribute('data-publish-term')) {
      const rows = A.termDraft.rows.filter((c) => c.day && c.course && (c.period || c.from));
      if (rows.length < A.termDraft.rows.length && !confirm(`${A.termDraft.rows.length - rows.length} صف ناقص (يوم أو مادة أو فترة) هيتشالوا. نكمّل؟`)) return;
      busy(t, async () => { await api('saveTerm', { term: A.section, level: A.level, classes: rows, source: A.termDraft.source }); A.termDraft = null; await refresh(); toast(`اتنشر جدول ${LEVEL_AR[A.level]} في ${sec().label}: ${rows.length} محاضرة. الطلاب يقدروا يشوفوه دلوقتي.`); });
      return;
    }
    if (t.hasAttribute('data-term-reset')) {
      if (!confirm(`ترجّع جدول ${LEVEL_AR[A.level]} في ${sec().label} للجدول الأصلي اللي على الموقع؟`)) return;
      busy(t, async () => { await api('clearTerm', { term: A.section, level: A.level }); await refresh(); toast('رجع الجدول الأصلي.'); });
      return;
    }
    // exams
    if (t.hasAttribute('data-sched-edit')) { A.schedDraft = { exams: (lvl().schedule?.exams || []).map((x) => ({ ...x })), source: lvl().schedule?.source || 'تعديل', hint: null }; render(); return; }
    if (t.dataset.delExam != null) { A.schedDraft.exams.splice(Number(t.dataset.delExam), 1); render(); return; }
    if (t.hasAttribute('data-add-exam')) { const last = A.schedDraft.exams.at(-1) || {}; A.schedDraft.exams.push({ date: last.date || '', from: last.from || '', to: last.to || '', course: '', code: '', building: last.building || '' }); render(); return; }
    if (t.hasAttribute('data-cancel-sched')) { A.schedDraft = null; render(); return; }
    if (t.hasAttribute('data-cancel-sheets')) { A.sheetDrafts = []; render(); return; }
    if (t.dataset.delSheet != null) { A.sheetDrafts.splice(Number(t.dataset.delSheet), 1); render(); return; }
    if (t.hasAttribute('data-publish-sched')) {
      const exams = A.schedDraft.exams.filter((x) => x.date && x.course);
      if (exams.length < A.schedDraft.exams.length && !confirm(`${A.schedDraft.exams.length - exams.length} صف من غير تاريخ أو مادة هيتشالوا. نكمّل؟`)) return;
      busy(t, async () => { await api('saveSchedule', { period: A.section, level: A.level, exams, source: A.schedDraft.source }); A.schedDraft = null; await refresh(); toast(`اتنشر جدول ${LEVEL_AR[A.level]} في ${sec().label}: ${exams.length} امتحان.`); });
      return;
    }
    if (t.hasAttribute('data-publish-sheets')) {
      busy(t, async () => {
        const r = await api('addSheets', { period: A.section, level: A.level, sheets: A.sheetDrafts.map(({ course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, students }) => ({ course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, students })) });
        A.sheetDrafts = []; await refresh();
        toast(`اتنشر ${r.added} كشف جديد${r.replaced ? ` واتحدّث ${r.replaced}` : ''}. ${r.students} طالب يقدروا يلاقوا لجانهم بالكود.${r.warnings.length ? `<br>تنبيه: ${r.warnings.slice(0, 3).map(esc).join('<br>')}` : ''}`, r.warnings.length ? 'err' : 'ok');
      });
      return;
    }
    if (t.dataset.delPub) {
      const s = lvl().sheets.find((x) => x.id === t.dataset.delPub);
      if (!confirm(`تمسح كشف ${s ? `${s.roomRaw || s.room} (${s.course}) — ${s.students.length} طالب` : ''}؟`)) return;
      busy(t, async () => { await api('deleteSheet', { period: A.section, level: A.level, id: t.dataset.delPub }); await refresh(); toast('اتمسح الكشف.'); });
      return;
    }
    if (t.dataset.clear) {
      const what = t.dataset.clear === 'schedule' ? 'جدول الامتحانات' : 'كل كشوف القاعات';
      if (!confirm(`تمسح ${what} بتاع ${LEVEL_AR[A.level]} في ${sec().label}؟ الطلاب مش هيشوفوه تاني.`)) return;
      busy(t, async () => { await api('clear', { period: A.section, level: A.level, what: t.dataset.clear }); await refresh(); toast(`اتمسح ${what}.`); });
    }
  });
  const edit = (e, rerender) => {
    const el = e.target;
    if (el.dataset.tf != null) {
      const c = A.termDraft.rows[Number(el.closest('tr').dataset.t)];
      c[el.dataset.tf] = el.dataset.tf === 'period' ? Number(el.value) : el.value.trim();
      if (el.dataset.tf === 'period' && c.period) { c.from = ''; c.to = ''; }
      if (rerender) renderTermDraft();
    }
    if (el.dataset.f != null) { const i = Number(el.closest('tr').dataset.i); A.schedDraft.exams[i][el.dataset.f] = el.value.trim(); if (rerender) renderSchedDraft(); }
    if (el.hasAttribute('data-all-building') && el.value) { for (const x of A.schedDraft.exams) x.building = el.value; renderSchedDraft(); }
    if (el.dataset.sf != null) {
      const s = A.sheetDrafts[Number(el.closest('[data-s]').dataset.s)];
      s[el.dataset.sf] = el.value.trim();
      if (el.dataset.sf === 'room') s.roomRaw = s.roomRaw || el.value;
      link(s); if (rerender) renderSheetDrafts();
    }
  };
  app.addEventListener('input', (e) => edit(e, false));
  app.addEventListener('change', (e) => edit(e, true));
  $('test-form').addEventListener('submit', (e) => { e.preventDefault(); runTest($('test-id').value.trim()); });
}

async function init() {
  wire();
  A.index = await fetch('data/room_index.json').then((r) => r.json()).catch(() => ({ buildings: {}, rooms: {} }));
  if (A.token) {
    showApp();
    try { await refresh(); } catch (err) { toast(esc(err.message), 'err'); }
  }
}
init();

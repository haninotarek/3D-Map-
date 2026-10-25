// TA admin page (admin.html): log in with the TA password, pick a level, upload the exam timetable and the
// room sheets, review what was read (fix anything wrong, pick rooms the map knows), then publish to the API.
// Files are read here in the browser (js/midterm-parse.js); the server only receives the checked data.
import { parseFile, levelOfCode, codeKey } from './midterm-parse.js';
import { roomAr, BUILDING_AR, FLOOR_AR, findRoom } from './rooms.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVEL_AR = { 1: 'سنة أولى', 2: 'سنة تانية', 3: 'سنة تالتة', 4: 'سنة رابعة' };
const BUILDINGS = ['Engineering Building 1', 'Engineering Building 2', 'Main Building'];
const TOKEN_KEY = 'epnu.admin.token';
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } } };
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

const A = { token: ss.get(TOKEN_KEY), level: Number(ls.get('epnu.admin.level')) || 1, tab: 'schedule', server: null, index: null, schedDraft: null, sheetDrafts: [], busy: false };
const examKey = (e) => `${e.date}|${codeKey(e.code) || String(e.course || '').toLowerCase()}`;
const lvl = () => A.server?.levels?.[A.level] || { schedule: { exams: [] }, sheets: [] };
const fmtDate = (iso) => { const d = new Date(`${iso}T12:00:00`); return iso && !isNaN(d) ? new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(d) : 'من غير تاريخ'; };
const fmtTime = (t) => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const pm = h >= 12; if (h > 12) h -= 12; return `${h}:${String(m).padStart(2, '0')}${pm ? ' م' : ' ص'}`; };
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
async function refresh() { A.server = await api('state'); render(); }

let pdfjsP;
const pdfjs = () => (pdfjsP ||= import('../lib/pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href; return m; }));

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

// ---------------------------------------------------------------- rendering
function render() {
  $('levels').innerHTML = [1, 2, 3, 4].map((L) => {
    const d = A.server?.levels?.[L]; const ex = d?.schedule?.exams?.length || 0; const st = new Set((d?.sheets || []).flatMap((s) => s.students.map((x) => x.id))).size;
    return `<button type="button" class="level${L === A.level ? ' on' : ''}" data-level="${L}" role="tab" aria-selected="${L === A.level}">
      <b>${LEVEL_AR[L]}</b><small>${ex} امتحان · ${st} طالب ليهم لجنة</small></button>`;
  }).join('');
  const d = lvl(); const sheets = d.sheets || [];
  const students = new Set(sheets.flatMap((s) => s.students.map((x) => x.id))).size;
  const unlinked = sheets.filter((s) => !s.linked).length;
  $('summary').innerHTML = `
    <div><b>${d.schedule?.exams?.length || 0}</b><span>امتحان في الجدول المنشور</span></div>
    <div><b>${sheets.length}</b><span>كشف قاعة منشور</span></div>
    <div><b>${students}</b><span>طالب يقدر يلاقي لجنته</span></div>
    <div class="${unlinked ? 'warn' : ''}"><b>${unlinked}</b><span>كشف قاعته مش على الخريطة</span></div>`;
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));
  for (const t of ['schedule', 'sheets', 'test']) $(`tab-${t}`).hidden = A.tab !== t;
  renderSchedDraft(); renderSchedCurrent(); renderSheetDrafts(); renderSheetsCurrent();
}

function buildingSelect(value, attrs) {
  return `<select ${attrs}>${['', ...BUILDINGS].map((b) => `<option value="${esc(b)}"${b === value ? ' selected' : ''}>${b ? esc(buildingAr(b)) : 'اختار المبنى'}</option>`).join('')}</select>`;
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
        <td><input data-f="code" value="${esc(e.code)}" dir="ltr" class="code"></td>
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
  if (!ex.length) { host.innerHTML = `<p class="empty">لسه مفيش جدول امتحانات منشور لـ ${LEVEL_AR[A.level]}.</p>`; return; }
  const sheets = lvl().sheets || [];
  host.innerHTML = `<section class="card"><div class="card-head"><h3>الجدول المنشور دلوقتي <small>${esc(lvl().schedule.source || '')}</small></h3>
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
        <header><span class="num">${i + 1}</span><b>${esc(s.source)}</b><span class="badge ${s.linked ? 'ok' : 'warn'}">${s.linked ? '✓ على الخريطة' : 'مش على الخريطة'}</span>
          <button type="button" class="x" data-del-sheet="${i}" title="شيل الكشف">×</button></header>
        <div class="grid">
          <label>المادة<input data-sf="course" value="${esc(s.course)}" dir="ltr"></label>
          <label>الكود<input data-sf="code" value="${esc(s.code)}" dir="ltr" class="code"></label>
          <label>التاريخ<input type="date" data-sf="date" value="${esc(s.date)}"></label>
          <label>من<input type="time" data-sf="from" value="${esc(s.from)}"></label>
          <label>إلى<input type="time" data-sf="to" value="${esc(s.to)}"></label>
          <label>المبنى${buildingSelect(s.building, 'data-sf="building"')}</label>
          <label class="wide">القاعة
            <select data-sf="room">
              ${known ? '' : `<option value="${esc(s.room)}" selected>${esc(s.roomRaw || s.room || 'مش معروفة')} (مش على الخريطة)</option>`}
              ${rooms.map((r) => `<option value="${esc(r.key)}"${r.key === s.room ? ' selected' : ''}>${esc(roomAr(r.key))} · ${esc(FLOOR_AR[r.floor] || '')}</option>`).join('')}
            </select></label>
        </div>
        ${s.place ? `<p class="muted small">المكتوب في الكشف: ${esc(s.place)}</p>` : ''}
        ${warns.map(([k, t]) => `<p class="note ${k}">${esc(t)}</p>`).join('')}
        <details><summary>${s.students.length} طالب</summary>
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
  if (!sheets.length) { host.innerHTML = `<p class="empty">لسه مفيش كشوف قاعات منشورة لـ ${LEVEL_AR[A.level]}.</p>`; return; }
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
    const r = await fetch(`api/midterm?id=${encodeURIComponent(id)}`); const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    if (!j.found) { out.innerHTML = `<p class="note warn">الكود ${esc(j.id)} مش موجود في أي كشف منشور.</p>`; return; }
    out.innerHTML = `<section class="card"><h3>أهلًا يا ${esc(j.first || 'طالب')} <small>${esc(j.id)}</small></h3><ul class="exams">${j.exams.map((e) => {
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
    const go = (files) => busy(null, () => (drop.dataset.kind === 'schedule' ? onScheduleFiles(files) : onSheetFiles(files)));
    input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) go(files); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const files = [...e.dataTransfer.files]; if (files.length) go(files); });
  }

  const app = $('app');
  app.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.level) { A.level = Number(t.dataset.level); ls.set('epnu.admin.level', A.level); A.sheetDrafts.forEach(link); render(); return; }
    if (t.dataset.tab) { A.tab = t.dataset.tab; render(); return; }
    if (t.dataset.delExam != null) { A.schedDraft.exams.splice(Number(t.dataset.delExam), 1); render(); return; }
    if (t.hasAttribute('data-add-exam')) { const last = A.schedDraft.exams.at(-1) || {}; A.schedDraft.exams.push({ date: last.date || '', from: last.from || '', to: last.to || '', course: '', code: '', building: last.building || '' }); render(); return; }
    if (t.hasAttribute('data-cancel-sched')) { A.schedDraft = null; render(); return; }
    if (t.hasAttribute('data-cancel-sheets')) { A.sheetDrafts = []; render(); return; }
    if (t.dataset.delSheet != null) { A.sheetDrafts.splice(Number(t.dataset.delSheet), 1); render(); return; }
    if (t.hasAttribute('data-publish-sched')) {
      const exams = A.schedDraft.exams.filter((x) => x.date && x.course);
      if (exams.length < A.schedDraft.exams.length && !confirm(`${A.schedDraft.exams.length - exams.length} صف من غير تاريخ أو مادة هيتشالوا. نكمّل؟`)) return;
      if (lvl().schedule?.exams?.length && !confirm(`ده هيحل محل جدول ${LEVEL_AR[A.level]} المنشور (${lvl().schedule.exams.length} امتحان). نكمّل؟`)) return;
      busy(t, async () => { await api('saveSchedule', { level: A.level, exams, source: A.schedDraft.source }); A.schedDraft = null; await refresh(); toast(`اتنشر جدول ${LEVEL_AR[A.level]}: ${exams.length} امتحان. الطلاب يقدروا يشوفوه دلوقتي.`); });
      return;
    }
    if (t.hasAttribute('data-publish-sheets')) {
      busy(t, async () => {
        const r = await api('addSheets', { level: A.level, sheets: A.sheetDrafts.map(({ course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, students }) => ({ course, code, date, from, to, building, floor, room, roomRaw, place, linked, source, students })) });
        A.sheetDrafts = []; await refresh();
        toast(`اتنشر ${r.added} كشف جديد${r.replaced ? ` واتحدّث ${r.replaced}` : ''}. ${r.students} طالب يقدروا يلاقوا لجانهم بالكود.${r.warnings.length ? `<br>تنبيه: ${r.warnings.slice(0, 3).map(esc).join('<br>')}` : ''}`, r.warnings.length ? 'err' : 'ok');
      });
      return;
    }
    if (t.dataset.delPub) {
      const s = lvl().sheets.find((x) => x.id === t.dataset.delPub);
      if (!confirm(`تمسح كشف ${s ? `${s.roomRaw || s.room} (${s.course}) — ${s.students.length} طالب` : ''}؟`)) return;
      busy(t, async () => { await api('deleteSheet', { level: A.level, id: t.dataset.delPub }); await refresh(); toast('اتمسح الكشف.'); });
      return;
    }
    if (t.dataset.clear) {
      const what = t.dataset.clear === 'schedule' ? 'جدول الامتحانات' : 'كل كشوف القاعات';
      if (!confirm(`تمسح ${what} بتاع ${LEVEL_AR[A.level]}؟ الطلاب مش هيشوفوه تاني.`)) return;
      busy(t, async () => { await api('clear', { level: A.level, what: t.dataset.clear }); await refresh(); toast(`اتمسح ${what}.`); });
    }
  });
  const edit = (e, rerender) => {
    const el = e.target;
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

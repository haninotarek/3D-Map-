// Readers for the files TAs upload on admin.html, turned into midterm data:
//  • exam timetables (Word / PDF / Excel / CSV) laid out like the printed "Level 1 Mid-Term Schedule":
//    time slots across the top, one row per exam day, "Course | CODE" in the cells  -> exams[]
//  • UNIHUB room sheets (كشف أسماء الطلاب, one room per page: course, date, time, المكان, ID list),
//    or any Excel / CSV list with an ID column                                          -> sheets[]
// Pure ES module: runs in the browser (admin.js) and in Node (pipeline/test_midterm.mjs). PDF text
// comes from pdf.js, which the caller passes in; docx / xlsx are unzipped with DecompressionStream.
import { arDigits, canonRoom, canonBuilding } from './rooms.js';

/** NFKC folds Arabic presentation forms (what PDFs carry) back to plain letters. */
export function norm(s) {
  return arDigits(String(s ?? '').normalize('NFKC'))
    .replace(/[‎‏‪-‮⁦-⁩ـ]/g, '')
    .replace(/[ \t ]+/g, ' ').trim();
}

// ---------------------------------------------------------------- zip (docx / xlsx)
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('الملف مش docx / xlsx سليم');
  const files = new Map(); const dec = new TextDecoder();
  let p = dv.getUint32(eocd + 16, true);
  for (let k = dv.getUint16(eocd + 10, true); k > 0 && dv.getUint32(p, true) === 0x02014b50; k--) {
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    files.set(dec.decode(u8.subarray(p + 46, p + 46 + nlen)), { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) });
    p += 46 + nlen + elen + clen;
  }
  return {
    names: [...files.keys()],
    async text(name) {
      const f = files.get(name); if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = u8.subarray(start, start + f.size);
      if (f.method === 0) return dec.decode(raw);
      if (f.method === 8) return dec.decode(await inflateRaw(raw));
      throw new Error('طريقة ضغط مش مدعومة');
    },
  };
}

// ---------------------------------------------------------------- tiny XML helpers
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
/** Outermost <tag>…</tag> blocks (depth-aware, so nested tables stay inside their cell). */
function blocks(xml, tag) {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'g');
  const out = []; let depth = 0, start = 0, m;
  while ((m = re.exec(xml))) {
    if (m[2]) { if (!depth) out.push(m[0]); continue; }            // <tag/>
    if (!m[1]) { if (!depth++) start = m.index; }
    else if (depth && !--depth) out.push(xml.slice(start, re.lastIndex));
  }
  return out;
}
const attr = (xml, name) => (xml.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

// ---------------------------------------------------------------- Word (.docx)
function docxParagraphs(xml) {
  return blocks(xml, 'w:p').map((p) => unxml(p.replace(/<w:tab\/>/g, ' ').replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (_, t) => t ?? ''))).map(norm);
}
/** Returns { tables: string[][][], lines: string[] } — merged cells are filled in both directions. */
export async function readDocx(buf) {
  const xml = await (await unzip(buf)).text('word/document.xml');
  if (!xml) throw new Error('ملف Word فاضي');
  const tables = blocks(xml, 'w:tbl').map((tbl) => {
    const grid = [];
    for (const tr of blocks(tbl.replace(/^<w:tbl[^>]*>|<\/w:tbl>$/g, ''), 'w:tr')) {
      const row = []; let col = 0;
      for (const tc of blocks(tr.replace(/^<w:tr[^>]*>|<\/w:tr>$/g, ''), 'w:tc')) {
        const pr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [''])[0];
        const span = Number(attr((pr.match(/<w:gridSpan[^>]*>/) || [''])[0], 'w:val')) || 1;
        const vm = pr.match(/<w:vMerge(?:\s[^>]*)?\/?>/);
        const cont = vm && attr(vm[0], 'w:val') !== 'restart';
        const text = cont ? (grid.at(-1)?.[col] ?? '') : docxParagraphs(tc).filter(Boolean).join('\n');
        for (let k = 0; k < span; k++) row[col++] = text;
      }
      grid.push(row);
    }
    return grid;
  });
  const lines = docxParagraphs(xml.replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g, '')).filter(Boolean);
  return { tables, lines };
}

// ---------------------------------------------------------------- Excel (.xlsx)
const xlDate = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 864e5)).toISOString();
function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
/** Returns string[][] per sheet; date / time styled numbers come out as 2026-04-02 / 10:30, merged ranges are filled. */
export async function readXlsx(buf) {
  const z = await unzip(buf);
  const ssXml = await z.text('xl/sharedStrings.xml');
  const strings = ssXml ? blocks(ssXml, 'si').map((si) => unxml([...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))) : [];
  const stXml = (await z.text('xl/styles.xml')) || '';
  const fmts = Object.fromEntries([...stXml.matchAll(/<numFmt [^>]*>/g)].map((m) => [attr(m[0], 'numFmtId'), attr(m[0], 'formatCode') || '']));
  const xfs = blocks((stXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0].replace(/^<cellXfs[^>]*>/, ''), 'xf').map((x) => attr(x, 'numFmtId'));
  const kindOf = (s) => {
    const id = Number(xfs[Number(s) || 0]); const code = (fmts[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47) || (/h/.test(code) && !/[dy]/.test(code))) return 'time';
    if ((id >= 14 && id <= 17) || id === 22 || /[dy]/.test(code)) return 'date';
    return '';
  };
  const sheets = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  const out = [];
  for (const name of sheets) {
    const xml = await z.text(name); const grid = [];
    for (const c of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const r = attr(c[1], 'r'); if (!r) continue;
      const row = Number(r.replace(/[A-Z]+/g, '')) - 1, col = colIndex(r), t = attr(c[1], 't'), body = c[2] || '';
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = strings[Number(v)] ?? '';
      else if (t === 'inlineStr') val = unxml([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      else if (v != null) {
        const kind = t ? '' : kindOf(attr(c[1], 's'));
        const num = Number(v);
        if (kind === 'date' && num > 20000) val = xlDate(num).slice(0, 10);
        else if (kind === 'time' || (kind === 'date' && num < 1)) val = xlDate(num % 1).slice(11, 16);
        else val = unxml(v);
      }
      (grid[row] ||= [])[col] = norm(val);
    }
    for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const r0 = Number(m[1].replace(/[A-Z]+/g, '')) - 1, r1 = Number(m[2].replace(/[A-Z]+/g, '')) - 1, c0 = colIndex(m[1]), c1 = colIndex(m[2]);
      const v = grid[r0]?.[c0] ?? '';
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (grid[r] ||= [])[c] = v;
    }
    out.push(Array.from(grid, (row) => Array.from(row || [], (x) => x ?? '')));
  }
  return out;
}

// ---------------------------------------------------------------- CSV
export function readCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(norm(cell)); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(norm(cell)); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(norm(cell)); rows.push(row); }
  return rows.filter((r) => r.some((x) => x));
}

// ---------------------------------------------------------------- PDF (text PDFs, via pdf.js)
/** pages: [{ items: [{ str, x, y, w, h }] }] in PDF units (y grows upwards). */
export async function readPdf(buf, pdfjs) {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const doc = await pdfjs.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push({ items: tc.items.map((it) => ({ str: norm(it.str), x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 8 })).filter((it) => it.str) });
  }
  if (!pages.some((p) => p.items.length)) throw new Error('الـ PDF ده صورة (سكانر) ومفيهوش نص يتقري — اطلبوا النسخة الأصلية من UNIHUB أو Word');
  return pages;
}
/** Items on (about) the same baseline, each line's parts ordered right-to-left like the Arabic page reads. */
function pdfLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines = [];
  for (const it of sorted) {
    const l = lines.at(-1);
    if (l && Math.abs(l.y - it.y) <= Math.max(2.5, it.h * 0.35)) l.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => { const parts = l.items.sort((a, b) => b.x - a.x).map((i) => i.str); return { y: l.y, parts, text: parts.join(' '), items: l.items }; });
}

// ---------------------------------------------------------------- shared value parsers
const TIME_RANGE = /(\d{1,2})[:.](\d{2})\s*(?:[-–—~·]+|to|إلى|الى|لـ)\s*(\d{1,2})[:.](\d{2})/i;
const CODE_RE = /\b([A-Z]{2,4})\s*-?\s*(\d[\dA-Z]{2})\b/;
const DAY_IDX = { 'الأحد': 0, 'الاحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const pad = (n) => String(n).padStart(2, '0');
/** Exams run in the day: 1:00 means 13:00, 10:30 stays 10:30. */
const clock = (h, m) => `${pad(Number(h) < 8 ? Number(h) + 12 : Number(h))}:${m}`;

export function parseTimes(text) {
  const t = norm(text);
  const m = t.match(TIME_RANGE);
  const ts = m ? [clock(m[1], m[2]), clock(m[3], m[4])] : [...t.matchAll(/(\d{1,2}):(\d{2})/g)].slice(0, 2).map((x) => clock(x[1], x[2]));
  if (ts.length < 2) return null;
  ts.sort();   // UNIHUB prints "من 10:30 - 01:30" right-to-left
  return { from: ts[0], to: ts[1] };
}
function weekdayIn(text) {
  const t = norm(text).toLowerCase();
  for (const [k, v] of Object.entries(DAY_IDX)) if (t.includes(k)) return v;
  return null;
}
/** 2/04/2026, 02-09-2026, 2026-09-02 -> 2026-04-02 (day first, as printed in Egypt; the weekday decides when both work). */
export function parseDate(text, weekday = weekdayIn(text)) {
  const t = norm(text);
  let m = t.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const dm = `${y}-${pad(m[2])}-${pad(m[1])}`, md = `${y}-${pad(m[1])}-${pad(m[2])}`;
  const ok = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return !isNaN(d) && d.toISOString().slice(0, 10) === iso; };
  if (weekday != null && ok(md) && !(ok(dm) && new Date(`${dm}T12:00:00Z`).getUTCDay() === weekday) && new Date(`${md}T12:00:00Z`).getUTCDay() === weekday) return md;
  return ok(dm) ? dm : ok(md) ? md : '';
}
/** "Mathematics II | MAT 103" / "Fudamentals of Database Systems - DSP221" -> { course, code: 'MAT 103' }. */
export function splitCourse(text) {
  const t = norm(text).replace(/\s*\n\s*/g, ' ');
  const m = t.match(CODE_RE);
  if (!m) return { course: t.replace(/[|]/g, ' ').trim(), code: '' };
  const code = `${m[1]} ${m[2]}`;
  const course = t.replace(m[0], ' ').replace(/[|]/g, ' ').replace(/\s[-–]\s*$/, '').replace(/^\s*[-–]\s/, '').replace(/\s+/g, ' ').trim();
  return { course, code };
}
export const codeKey = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** The level a course code belongs to: MAT 103 -> 1, DSP 221 -> 2 (first digit), else null. */
export const levelOfCode = (code) => { const d = Number((codeKey(code).match(/[A-Z]+(\d)/) || [])[1]); return d >= 1 && d <= 4 ? d : null; };

const FLOORS = [[/(?:ارض|أرض|الارضي|الأرضي)/, 'G'], [/(?:الاول|الأول|اول|أول)/, '1'], [/(?:الثاني|التاني|ثاني|تاني)/, '2'], [/(?:الثالث|التالت|ثالث|تالت)/, '3'], [/(?:الرابع|رابع)/, '4']];
/** "المكان: مبنى القطاع الهندسى (2) الدور الاول معمل (2)" -> building, floor and room key. */
export function parsePlace(text) {
  const t = norm(text).replace(/^.*?المكان\s*:?\s*/, '').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  let building = '';
  const b = t.match(/مبن[ىي][^\d]*?(\d+)/);
  if (/رئيس/.test(t)) building = 'Main Building';
  else if (b) building = `Engineering Building ${b[1]}`;
  else building = canonBuilding(t);
  let floor = null, rest = t;
  const f = t.match(/(?:الدور|دور|الطابق)\s*(\S+)/);
  if (f) {
    const w = f[1];
    floor = /^\d$/.test(w) ? w : (FLOORS.find(([re]) => re.test(w)) || [])[1] || null;
    rest = t.slice(f.index + f[0].length);
  } else if (b) rest = t.slice(b.index + b[0].length);
  const room = canonRoom(rest.trim() || t);
  return { building, floor, room, roomRaw: rest.trim() || t, place: t };
}

// ---------------------------------------------------------------- exam timetables
function dedupeExams(exams) {
  const seen = new Set();
  return exams.filter((e) => { const k = `${e.date}|${e.from}|${codeKey(e.code) || e.course}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
const isCourseCell = (s) => s && !/^[-–—\s]*$/.test(s) && !TIME_RANGE.test(s) && !parseDate(s) && !/مبن/.test(s) && CODE_RE.test(s);
const levelHint = (text) => { const m = norm(text).match(/level\s*(\d)|(?:المستوى|الفرقة|السنة)\s*(?:ال)?(\d|أولى|اولى|الأولى|تانية|ثانية|تالتة|ثالثة|رابعة)/i); if (!m) return null; const w = m[1] || m[2]; return Number(w) || ({ 'أولى': 1, 'اولى': 1, 'الأولى': 1, 'تانية': 2, 'ثانية': 2, 'تالتة': 3, 'ثالثة': 3, 'رابعة': 4 })[w] || null; };

/** A grid: header row with time slots, rows with a date, "Course | CODE" cells. Also accepts a plain row list
 *  with columns date / from / to / course (+ code, building, room). */
export function scheduleFromTable(table) {
  const exams = [];
  const cells = table.map((r) => r.map((c) => norm(c)));
  const hIdx = cells.findIndex((r) => r.filter((c) => TIME_RANGE.test(c)).length >= 1 && !r.some((c) => parseDate(c)));
  if (hIdx >= 0) {
    const slots = cells[hIdx].map((c) => (TIME_RANGE.test(c) ? parseTimes(c) : null));
    let building = '';
    for (const row of cells.slice(hIdx + 1)) {
      const dateCell = row.find((c) => parseDate(c));
      const b = row.find((c) => /مبن|building/i.test(c)); if (b) building = canonBuilding(b) || building;
      if (!dateCell) continue;
      const date = parseDate(dateCell);
      row.forEach((c, i) => {
        if (!slots[i] || !isCourseCell(c)) return;
        for (const part of c.split(/\n+/).filter(isCourseCell)) exams.push({ date, ...slots[i], ...splitCourse(part), building, room: '' });
      });
    }
    return dedupeExams(exams);
  }
  // row list: find a header naming the columns
  const alias = { date: /^(date|التاريخ)$/i, from: /^(from|من|start|البداية)$/i, to: /^(to|إلى|الى|end|النهاية)$/i, time: /^(time|الوقت|الميعاد|الفترة)$/i,
    course: /^(course|المادة|الماده|المقرر|اسم المادة)$/i, code: /^(code|الكود|كود المادة|رمز المقرر)$/i, building: /^(building|المبنى|المبني)$/i, room: /^(room|القاعة|القاعه|المكان|اللجنة)$/i };
  const hRow = cells.findIndex((r) => r.some((c) => alias.course.test(c)) && r.some((c) => alias.date.test(c)));
  if (hRow < 0) return [];
  const col = Object.fromEntries(Object.entries(alias).map(([k, re]) => [k, cells[hRow].findIndex((c) => re.test(c))]));
  for (const r of cells.slice(hRow + 1)) {
    const get = (k) => (col[k] >= 0 ? r[col[k]] || '' : '');
    const date = parseDate(get('date')); const course = get('course'); if (!date || !course) continue;
    const t = get('time') ? parseTimes(get('time')) : parseTimes(`${get('from')} - ${get('to')}`) || { from: get('from'), to: get('to') };
    const sc = splitCourse(get('code') ? `${course} | ${get('code')}` : course);
    exams.push({ date, from: t?.from || '', to: t?.to || '', ...sc, building: canonBuilding(get('building')), room: get('room') ? canonRoom(get('room')) : '' });
  }
  return dedupeExams(exams);
}

/** PDF timetable: time-slot headers give the columns, dates give the rows, course chunks are placed by position. */
export function scheduleFromPdf(pages) {
  const exams = []; let level = null;
  for (const { items } of pages) {
    // join pieces of one cell that pdf.js split on the same line
    const chunks = [];
    for (const l of pdfLines(items)) {
      const its = [...l.items].sort((a, b) => a.x - b.x);
      for (const it of its) {
        const c = chunks.at(-1);
        if (c && c.y === l.y && it.x - c.x1 < Math.max(4, it.h * 0.6)) { c.str = `${c.str} ${it.str}`; c.x1 = it.x + it.w; }
        else chunks.push({ str: it.str, x0: it.x, x1: it.x + it.w, y: l.y, h: it.h });
      }
    }
    for (const c of chunks) { c.str = norm(c.str); c.cx = (c.x0 + c.x1) / 2; level ||= levelHint(c.str); }
    const slots = chunks.filter((c) => TIME_RANGE.test(c.str) && !parseDate(c.str)).map((c) => ({ ...parseTimes(c.str), cx: c.cx }));
    const days = chunks.filter((c) => weekdayIn(c.str) != null);
    const dates = chunks.filter((c) => parseDate(c.str)).map((c) => {
      const near = days.sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y))[0];
      const wd = near && Math.abs(near.y - c.y) < 40 ? weekdayIn(near.str) : null;
      return { date: parseDate(c.str, wd ?? weekdayIn(c.str)), cy: c.y };
    });
    if (!slots.length || !dates.length) continue;
    const bChunk = chunks.find((c) => /مبن/.test(c.str)); const building = bChunk ? canonBuilding(bChunk.str) : '';
    for (const c of chunks.filter((x) => isCourseCell(x.str))) {
      const slot = slots.reduce((a, b) => (Math.abs(b.cx - c.cx) < Math.abs(a.cx - c.cx) ? b : a));
      const row = dates.reduce((a, b) => (Math.abs(b.cy - c.y) < Math.abs(a.cy - c.y) ? b : a));
      // a long course name may wrap: pick up the line just above in the same cell
      const above = chunks.find((x) => x !== c && !isCourseCell(x.str) && !TIME_RANGE.test(x.str) && !parseDate(x.str) && x.y > c.y && x.y - c.y < c.h * 1.8 && Math.abs(x.cx - c.cx) < 60 && /[a-z]/i.test(x.str));
      exams.push({ date: row.date, from: slot.from, to: slot.to, ...splitCourse(above ? `${above.str} ${c.str}` : c.str), building, room: '' });
    }
  }
  return { exams: dedupeExams(exams), level };
}

// ---------------------------------------------------------------- room sheets (كشوف)
const ID_RE = /(?<![\d/:.-])(\d{7,10})(?![\d/:.-])/;
const STATUS_RE = /(مستجد|باق[يى]?|معيد|منقول|محول|محوّل|تخلف)/;
const ID_HEAD = /^(id|الكود|كود الطالب|كود|رقم الجلوس|الرقم الأكاديمي|الرقم الاكاديمي|رقم الطالب|student id|seat)$/i;
const NAME_HEAD = /^(name|الاسم|اسم الطالب)$/i;
const ROOM_HEAD = /^(room|hall|القاعة|القاعه|اللجنة|اللجنه|المكان|المعمل)$/i;

function blankSheet() { return { course: '', code: '', date: '', from: '', to: '', building: '', floor: null, room: '', roomRaw: '', place: '', title: '', students: [] }; }
function readHeader(sheet, text) {
  const t = norm(text);
  let m;
  if (!sheet.course && (m = t.match(/(?:course|المقرر|المادة)\s*:\s*(.+)$/i))) Object.assign(sheet, splitCourse(m[1]));
  if (!sheet.date && /التاريخ|date/i.test(t)) sheet.date = parseDate(t);
  if (!sheet.from && /(?:من|from|الوقت|time)/i.test(t)) { const tm = parseTimes(t); if (tm) Object.assign(sheet, tm); }
  if (/كشف|امتحان/.test(t) && !sheet.title) sheet.title = t;
}
function studentFrom(parts) {
  const all = parts.join(' ');
  const id = (all.match(ID_RE) || [])[1]; if (!id) return null;
  const status = (all.match(STATUS_RE) || [])[1] || '';
  const name = parts.join(' ').replace(id, ' ').replace(STATUS_RE, ' ').replace(/(?:^|\s)\d{1,4}(?=\s|$)/g, ' ').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
  return { id, name, status };
}
function addStudent(sheet, s) { if (s && !sheet.students.some((x) => x.id === s.id)) sheet.students.push(s); }

/** UNIHUB PDF: every page that carries a header starts a sheet; pages without one continue the previous sheet. */
export function sheetsFromPdf(pages) {
  const sheets = [];
  for (const { items } of pages) {
    const lines = pdfLines(items);
    const headed = lines.some((l) => /course\s*:|المكان/i.test(l.text));
    if (headed || !sheets.length) sheets.push(blankSheet());
    const sheet = sheets.at(-1);
    for (const l of lines) {
      const placeItem = l.items.find((i) => /المكان/.test(i.str));
      if (placeItem) {
        const placeText = l.items.filter((i) => i === placeItem || (!/التاريخ|\d{1,2}:\d{2}/.test(i.str) && !parseDate(i.str) && i.str !== 'من')).sort((a, b) => b.x - a.x).map((i) => i.str).join(' ');
        Object.assign(sheet, parsePlace(placeText));
      }
      if (!ID_RE.test(l.text) || /التاريخ|course\s*:/i.test(l.text)) { readHeader(sheet, l.text); continue; }
      addStudent(sheet, studentFrom(l.parts));
    }
  }
  return sheets.filter((s) => s.students.length);
}

/** Excel / CSV / Word tables: a header row with an ID column; an optional room column splits it into one sheet per room.
 *  Lines above the header (or Word paragraphs) may carry course / date / time / المكان like the UNIHUB sheet. */
export function sheetsFromTable(table, extraLines = []) {
  const cells = table.map((r) => r.map((c) => norm(c)));
  const base = blankSheet();
  const hIdx = cells.findIndex((r) => r.some((c) => ID_HEAD.test(c)));
  for (const line of [...extraLines, ...cells.slice(0, Math.max(0, hIdx)).map((r) => r.filter(Boolean).join(' '))]) {
    if (/المكان/.test(line)) Object.assign(base, parsePlace(line));
    readHeader(base, line);
  }
  const head = hIdx >= 0 ? cells[hIdx] : [];
  const idCol = head.findIndex((c) => ID_HEAD.test(c)), nameCol = head.findIndex((c) => NAME_HEAD.test(c)), roomCol = head.findIndex((c) => ROOM_HEAD.test(c));
  const byRoom = new Map();
  for (const r of cells.slice(hIdx + 1)) {
    const id = idCol >= 0 ? (String(r[idCol] || '').match(/\d{5,10}/) || [])[0] : (r.join(' ').match(ID_RE) || [])[1];
    if (!id) continue;
    const roomText = roomCol >= 0 ? r[roomCol] || '' : '';
    if (!byRoom.has(roomText)) {
      const s = { ...base, students: [] };
      if (roomText) Object.assign(s, parsePlace(roomText), { building: canonBuilding(roomText) || base.building });
      byRoom.set(roomText, s);
    }
    addStudent(byRoom.get(roomText), { id, name: nameCol >= 0 ? r[nameCol] || '' : '', status: (r.join(' ').match(STATUS_RE) || [])[1] || '' });
  }
  return [...byRoom.values()];
}

// ---------------------------------------------------------------- term (class) timetables
const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
  'الأحد': 'Sunday', 'الاحد': 'Sunday', 'الاثنين': 'Monday', 'الإثنين': 'Monday', 'الثلاثاء': 'Tuesday', 'الأربعاء': 'Wednesday', 'الاربعاء': 'Wednesday', 'الخميس': 'Thursday', 'الجمعة': 'Friday', 'السبت': 'Saturday' };
export function canonDay(d) { const s = norm(d); return DAY_NAMES[s] || DAY_NAMES[s.slice(0, 3).toLowerCase()] || ''; }
export function canonType(t, course) {
  const s = norm(t).toLowerCase();
  if (/lab|معمل/.test(s)) return 'lab';
  if (/sec|سكشن|تمارين/.test(s)) return 'section';
  if (/lec|محاضر/.test(s)) return 'lecture';
  return /project/i.test(course || '') ? 'lecture' : 'section';
}
const TERM_COLS = { level: /^(level|الفرقة|الفرقه|السنة|السنه|المستوى|الدفعة)$/i, day: /^(day|اليوم)$/i, period: /^(period|الفترة|الفتره|المحاضرة رقم)$/i,
  from: /^(from|من|start)$/i, to: /^(to|إلى|الى|end)$/i, course: /^(course|المادة|الماده|المقرر)$/i, type: /^(type|النوع)$/i,
  group: /^(group|الجروب|المجموعة|المجموعه)$/i, sections: /^(sections?|السكاشن|السكشن)$/i, room: /^(room|القاعة|القاعه|المكان)$/i, building: /^(building|المبنى|المبني)$/i };
function termRow(r) {
  const t = parseTimes(`${r.from || ''} - ${r.to || ''}`);
  return {
    level: Number(arDigits(r.level)) || null, day: canonDay(r.day), period: Number(arDigits(r.period)) || 0,
    from: t?.from || '', to: t?.to || '', course: norm(r.course), type: canonType(r.type, r.course), group: norm(r.group),
    sections: norm(r.sections), room: r.room ? canonRoom(r.room) : '', building: canonBuilding(r.building),
  };
}
/** A row list with a header naming the columns (same columns as the site's old CSV download). */
export function termFromTable(table) {
  const cells = table.map((r) => r.map((c) => norm(c)));
  const h = cells.findIndex((r) => r.some((c) => TERM_COLS.course.test(c)) && r.some((c) => TERM_COLS.day.test(c)));
  if (h < 0) return [];
  const col = Object.fromEntries(Object.entries(TERM_COLS).map(([k, re]) => [k, cells[h].findIndex((c) => re.test(c))]));
  return cells.slice(h + 1).map((r) => termRow(Object.fromEntries(Object.keys(col).map((k) => [k, col[k] >= 0 ? r[col[k]] || '' : '']))))
    .filter((c) => c.day && c.course);
}
/** The site's own JSON (data/schedules/*.json shape: levels[].classes as arrays or objects) or a flat row array. */
export function termFromJson(j) {
  const rows = [];
  const push = (level, row) => {
    const r = Array.isArray(row) ? { day: row[0], period: row[1], course: row[2], type: row[3], group: row[4], sections: row[5], room: row[6], building: row[7] } : row;
    rows.push({ ...termRow({ ...r, level: r.level ?? level }), level: Number(r.level ?? level) || null });
  };
  if (Array.isArray(j?.levels)) for (const lv of j.levels) for (const row of lv.classes || []) push(lv.level, row);
  else if (Array.isArray(j)) for (const row of j) push(row.level, row);
  return rows.filter((c) => c.day && c.course);
}

// ---------------------------------------------------------------- one entry point per upload
/** kind: 'schedule' | 'sheets' | 'term'. Returns { exams, level }, { sheets } or { classes }. */
export async function parseFile(name, buf, kind, pdfjs) {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'heic'].includes(ext)) throw new Error('ده صورة — ارفع الملف الأصلي (Word أو PDF أو Excel)');
  if (ext === 'doc' || ext === 'xls') throw new Error(`صيغة .${ext} القديمة مش مدعومة — افتحه واحفظه ${ext === 'doc' ? '.docx' : '.xlsx'}`);
  if (kind === 'term') {
    if (ext === 'json') return { classes: termFromJson(JSON.parse(new TextDecoder().decode(buf))) };
    if (ext === 'pdf') throw new Error('جدول الترم يترفع Excel أو CSV (نزّل الجدول الحالي من الزرار، عدّل عليه، وارفعه)');
    const tables = ext === 'xlsx' ? await readXlsx(buf) : ext === 'docx' ? (await readDocx(buf)).tables : ext === 'csv' || ext === 'txt' ? [readCsv(new TextDecoder().decode(buf))] : null;
    if (!tables) throw new Error('الصيغ المدعومة لجدول الترم: Excel (.xlsx) أو CSV أو JSON');
    return { classes: tables.flatMap(termFromTable) };
  }
  if (ext === 'pdf') {
    const pages = await readPdf(buf, pdfjs);
    if (kind === 'schedule') return scheduleFromPdf(pages);
    return { sheets: sheetsFromPdf(pages) };
  }
  let tables, lines = [];
  if (ext === 'docx') ({ tables, lines } = await readDocx(buf));
  else if (ext === 'xlsx') tables = await readXlsx(buf);
  else if (ext === 'csv' || ext === 'txt') tables = [readCsv(new TextDecoder().decode(buf))];
  else throw new Error('الصيغ المدعومة: PDF أو Word (.docx) أو Excel (.xlsx) أو CSV');
  if (kind === 'schedule') {
    const level = levelHint(lines.join(' ')) || levelHint(tables.flat(2).join(' '));
    return { exams: dedupeExams(tables.flatMap(scheduleFromTable)), level };
  }
  return { sheets: tables.flatMap((t) => sheetsFromTable(t, lines)).filter((s) => s.students.length) };
}

#!/usr/bin/env node
// Checks the midterm file readers (viewer/js/midterm-parse.js) on real files.
// Usage: node pipeline/test_midterm.mjs <file> [<file> …]
//   files named *schedule* / *midterm* are read as exam timetables, everything else as room sheets.
// Prints what was read so it can be compared with the printed paper.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'viewer');
const { parseFile } = await import(pathToFileURL(path.join(VIEWER, 'js', 'midterm-parse.js')).href);
const pdfjs = await import(pathToFileURL(path.join(VIEWER, 'lib', 'pdfjs', 'pdf.min.mjs')).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(VIEWER, 'lib', 'pdfjs', 'pdf.worker.min.mjs')).href;

let failed = 0;
for (const file of process.argv.slice(2)) {
  const kind = /schedule|midterm|جدول/i.test(path.basename(file)) ? 'schedule' : 'sheets';
  try {
    const out = await parseFile(path.basename(file), new Uint8Array(fs.readFileSync(file)), kind, pdfjs);
    console.log(`\n== ${path.basename(file)} (${kind})`);
    if (kind === 'schedule') {
      console.log(`level hint: ${out.level ?? '-'}   exams: ${out.exams.length}`);
      for (const e of out.exams) console.log(`  ${e.date} ${e.from}-${e.to}  ${e.code.padEnd(8)} ${e.course}  [${e.building || 'no building'}]`);
      if (!out.exams.length) failed++;
    } else {
      console.log(`sheets: ${out.sheets.length}`);
      for (const s of out.sheets) {
        console.log(`  ${s.code} ${s.course} | ${s.date} ${s.from}-${s.to} | ${s.building || '?'} floor ${s.floor ?? '?'} room "${s.room}" (raw "${s.roomRaw}") | ${s.students.length} students`);
        console.log(`    first: ${JSON.stringify(s.students[0])}  last: ${JSON.stringify(s.students.at(-1))}`);
      }
      if (!out.sheets.length) failed++;
    }
  } catch (err) {
    failed++; console.log(`\n== ${path.basename(file)}: FAILED ${err.stack || err}`);
  }
}
process.exit(failed ? 1 : 0);

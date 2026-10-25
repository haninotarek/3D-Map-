// Room / building name matching shared by the timetable panel (schedule.js), the TA admin page
// (admin.js) and the file parsers (midterm-parse.js). Pure functions, no DOM.

export const arDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** Free text from a timetable ("Hall:3", "Drawing Hall: 3", "قاعة 1", "معمل2", "Room:104", "مدرج (1)") -> canonical key. */
export function canonRoom(text) {
  const t = arDigits(String(text || '')).normalize('NFKC').toLowerCase().replace(/[:：()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = t.match(/drawing\s*hall\s*(\d+)/)) || (m = t.match(/قاع[ةه]\s*(?:ال)?رسم\s*(\d+)/))) return `Drawing Hall ${m[1]}`;
  if (/smart|سمارت|الذكي/.test(t)) return 'Smart System Lab';
  if ((m = t.match(/(?:lecture\s*)?hall\s*(\d+)/)) || (m = t.match(/(?:قاع[ةه]|مدرج|صال[ةه])\s*(\d+)/))) return `Hall ${m[1]}`;
  if ((m = t.match(/(?:room|class\s*room)\s*(\d+)/)) || (m = t.match(/(?:غرف[ةه]|فصل|روم)\s*(\d+)/))) return `Room ${m[1]}`;
  if ((m = t.match(/lab\s*(\d+)/)) || (m = t.match(/معمل\s*(\d+)/))) return `Lab ${m[1]}`;
  if ((m = t.match(/^(\d{3})$/))) return `Room ${m[1]}`;
  return String(text || '').trim();
}

export function canonBuilding(text) {
  const t = arDigits(String(text || '')).normalize('NFKC').toLowerCase();
  if (!t.trim()) return '';
  if (/main|رئيس/.test(t)) return 'Main Building';
  const n = (t.match(/(\d)/) || [])[1];
  if (/eng|هندس|مبن|building|bld/.test(t) && n) return `Engineering Building ${n}`;
  return '';
}

export function roomAr(key) {
  let m;
  if ((m = key.match(/^Drawing Hall (\d+)$/))) return `قاعة رسم ${m[1]}`;
  if ((m = key.match(/^Hall (\d+)$/))) return `قاعة ${m[1]}`;
  if ((m = key.match(/^Lab (\d+)$/))) return `معمل ${m[1]}`;
  if ((m = key.match(/^Room (\d+)$/))) return `غرفة ${m[1]}`;
  if (key === 'Smart System Lab') return 'معمل الأنظمة الذكية';
  return key;
}

export const BUILDING_AR = { 'Engineering Building 1': 'مبنى هندسة 1', 'Engineering Building 2': 'مبنى هندسة 2', 'Main Building': 'المبنى الرئيسي' };
export const FLOOR_AR = { G: 'الدور الأرضي', 1: 'الدور الأول', 2: 'الدور التاني', 3: 'الدور التالت', 4: 'الدور الرابع' };

/** room_index.json lookup: { building: 'Engineering Building 2', room: 'Lab 2' } -> { buildingId, floor } or null. */
export function findRoom(index, building, room) {
  const bId = index?.buildings?.[building] || null;
  const hit = bId && index.rooms?.[bId]?.[room];
  return { buildingId: bId, floor: hit ? hit.floor : null, linked: Boolean(hit) };
}

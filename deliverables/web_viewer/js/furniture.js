// Procedural architectural furnishings & millwork for academic interiors (see interior.js).
// Classrooms, engineering & computer labs, drawing/study halls, lecture amphitheatres, offices,
// WCs, cafeterias, and reception lobbies are populated using instanced meshes per material so an
// entire multi-floor building renders in minimal draw calls at 60 fps.
// Input coordinates are local ENU metres (x = East, y = North); Three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';

const C = {
  wood: 0xc9b08c,
  darkWood: 0x846548,
  metal: 0x565f6b,
  chrome: 0xadb5bd,
  chair: 0x2c3542,
  board: 0xf4f6f8,
  frame: 0x858d96,
  screen: 0x1b2026,
  bench: 0xe6e1d6,
  partition: 0xc3ccd4,
  sink: 0xebe8e1,
  cabinet: 0xcbd2d9,
  plant: 0x457d43,
  pot: 0x7b5e46,
  sofa: 0x3d556e,
  counter: 0xa6825a,
  door: 0x9b7650,
  doorFrame: 0xe6e2da,
  rug: 0x8d8273,
  glass: 0x9bbbd0,
};

const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // base at y = 0
const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) {
    const isGlass = c === C.glass;
    const isMetal = c === C.metal || c === C.chrome;
    matCache.set(c, new THREE.MeshStandardMaterial({
      color: c,
      roughness: isGlass ? 0.16 : isMetal ? 0.36 : 0.72,
      metalness: isMetal ? 0.55 : isGlass ? 0.15 : 0.02,
      transparent: isGlass,
      opacity: isGlass ? 0.62 : 1,
    }));
  }
  return matCache.get(c);
};

/** Collects axis-aligned architectural/furniture boxes per material, then builds InstancedMeshes. */
export function createFurnisher(onBox = null) {
  const boxes = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  function box(color, cx, cy, h0, sx, sy, sz, tag = 'furniture') {
    if (sx <= 0.005 || sy <= 0.005 || sz <= 0.005) return;
    if (!boxes.has(color)) boxes.set(color, []);
    boxes.get(color).push([cx, cy, h0, sx, sy, sz]);
    if (onBox && color !== C.rug) onBox(cx, cy, h0, sx, sy, sz, tag);
  }
  function build(group) {
    for (const [color, list] of boxes) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(unit, mat(color), list.length);
      list.forEach(([cx, cy, h0, sx, sy, sz], i) => {
        im.setMatrixAt(i, m.compose(p.set(cx, h0, -cy), q, s.set(sx, sz, sy)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = color !== C.glass;
      im.receiveShadow = true;
      im.name = 'furniture';
      group.add(im);
    }
  }
  return { box, build };
}

const DIR = {
  n: { f: [0, 1], r: [1, 0] },
  s: { f: [0, -1], r: [-1, 0] },
  e: { f: [1, 0], r: [0, -1] },
  w: { f: [-1, 0], r: [0, 1] },
};
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Sub-rectangles produced when a room specifies `"split": n`. */
export function roomCells(r) {
  const [x0, y0, x1, y1] = r.rect;
  const n = Math.max(1, r.split || 1);
  if (n === 1) return [[x0, y0, x1, y1]];
  const alongX = (x1 - x0) >= (y1 - y0);
  const cells = [];
  for (let k = 0; k < n; k++) {
    cells.push(alongX
      ? [x0 + (x1 - x0) * (k / n), y0, x0 + (x1 - x0) * ((k + 1) / n), y1]
      : [x0, y0 + (y1 - y0) * (k / n), x1, y0 + (y1 - y0) * ((k + 1) / n)]);
  }
  return cells;
}

/** Local frame of a room cell facing `front`: u runs back->front, v left->right. */
function frame([x0, y0, x1, y1], front) {
  const d = DIR[front] || DIR.e;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const depth = d.f[0] ? x1 - x0 : y1 - y0;
  const width = d.f[0] ? y1 - y0 : x1 - x0;
  const at = (u, v) => [cx + d.f[0] * u + d.r[0] * v, cy + d.f[1] * u + d.r[1] * v];
  const size = (su, sv) => d.f[0] ? [su, sv] : [sv, su];
  return { at, size, depth, width, front };
}

function put(F, fr, color, u, v, h0, su, sv, sz, tag = 'furniture') {
  const [x, y] = fr.at(u, v);
  const [sx, sy] = fr.size(su, sv);
  F.box(color, x, y, h0, sx, sy, sz, tag);
}

function table(F, fr, u, v, su, sv, h = 0.74) {
  put(F, fr, C.wood, u, v, h - 0.04, su, sv, 0.04);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    put(F, fr, C.metal, u + a * (su / 2 - 0.05), v + b * (sv / 2 - 0.05), 0, 0.04, 0.04, h - 0.04);
  }
}

function chair(F, fr, u, v, back = -1) {
  put(F, fr, C.chair, u, v, 0.43, 0.44, 0.44, 0.05);
  put(F, fr, C.chair, u + back * 0.2, v, 0.48, 0.04, 0.42, 0.44);
  put(F, fr, C.metal, u, v, 0, 0.36, 0.36, 0.43);
}

function board(F, fr, wide = 3.6) {
  const w = Math.max(1.4, wide);
  const u = fr.depth / 2 - 0.08;
  put(F, fr, C.frame, u, 0, 0.88, 0.05, w + 0.12, 1.32);
  put(F, fr, C.board, u - 0.04, 0, 0.93, 0.035, w, 1.22);
}

function teacherDesk(F, fr) {
  const u = fr.depth / 2 - 1.35;
  table(F, fr, u, -fr.width / 4, 0.7, Math.min(1.5, fr.width * 0.35));
  chair(F, fr, u + 0.58, -fr.width / 4, 1);
}

/** Classroom: student rows facing front whiteboard, clear 1.6m entry aisle near the doorway. */
function classroom(F, fr) {
  if (fr.depth < 4 || fr.width < 3.6) return;
  board(F, fr, Math.min(4.0, fr.width - 1.5));
  teacherDesk(F, fr);
  const uFront = fr.depth / 2 - 2.6, uBack = -fr.depth / 2 + 1.4;
  const vMax = fr.width / 2 - 0.65;
  for (let u = uFront; u >= uBack; u -= 1.3) {
    for (const side of [-1, 1]) {
      for (let v = 0.85; v + 0.55 <= vMax; v += 1.32) {
        table(F, fr, u, side * (v + 0.55), 0.55, 1.1);
        chair(F, fr, u - 0.55, side * (v + 0.3), -1);
        chair(F, fr, u - 0.55, side * (v + 0.8), -1);
      }
    }
  }
}

/** Computer & engineering lab: perimeter workstation benches + set-back center bench, keeping entry vestibule clear. */
function lab(F, fr) {
  if (fr.depth < 4 || fr.width < 4) return;
  board(F, fr, Math.min(3.4, fr.width - 1.8));
  teacherDesk(F, fr);
  const u0 = -fr.depth / 2 + 1.3, u1 = fr.depth / 2 - 2.5;
  const pcs = (u, v, facingV) => {
    put(F, fr, C.screen, u, v + facingV * 0.18, 0.74, 0.5, 0.045, 0.33);
    put(F, fr, C.chrome, u, v + facingV * 0.2, 0.68, 0.08, 0.08, 0.08);
    put(F, fr, C.screen, u + 0.28, v + facingV * 0.05, 0.02, 0.2, 0.4, 0.4);
    put(F, fr, C.chair, u, v - facingV * 0.45, 0.43, 0.44, 0.44, 0.05);
    put(F, fr, C.chair, u, v - facingV * 0.65, 0.48, 0.42, 0.04, 0.44);
    put(F, fr, C.metal, u, v - facingV * 0.45, 0, 0.35, 0.35, 0.43);
  };
  const len = u1 - u0;
  if (len < 1.5) return;
  for (const side of [-1, 1]) {
    const v = side * (fr.width / 2 - 0.48);
    table(F, fr, (u0 + u1) / 2, v, len, 0.72);
    for (let u = u0 + 0.6; u <= u1 - 0.5; u += 1.15) pcs(u, v, side);
  }
  const c0 = -fr.depth / 2 + 3.35;
  if (fr.width > 7.2 && u1 - c0 >= 1.6) {
    table(F, fr, (c0 + u1) / 2, 0, u1 - c0, 1.35);
    for (let u = c0 + 0.55; u <= u1 - 0.55; u += 1.15) { pcs(u, 0.34, -1); pcs(u, -0.34, 1); }
  }
}

/** Drawing / studio hall: wide drafting & study tables with clear centre aisle. */
function studyHall(F, fr) {
  if (fr.depth < 4.5 || fr.width < 4.5) return;
  board(F, fr, Math.min(4.2, fr.width - 1.8));
  const u0 = -fr.depth / 2 + 1.7, u1 = fr.depth / 2 - 2.0;
  const v0 = -fr.width / 2 + 1.3, v1 = fr.width / 2 - 1.3;
  for (let u = u0 + 0.8; u <= u1 - 0.8; u += 2.5) {
    for (let v = v0 + 1.1; v <= v1 - 1.1; v += 3.1) {
      if (Math.abs(v) < 0.9) continue; // keep center arrival walkway clear
      table(F, fr, u, v, 0.9, 2.2, 0.78);
      for (const dv of [-0.55, 0.55]) { chair(F, fr, u - 0.72, v + dv, -1); chair(F, fr, u + 0.72, v + dv, 1); }
    }
  }
}

/** Lecture hall: projection board, oak lectern, split left/right tiered bench seating around central aisle. */
function hall(F, fr) {
  if (fr.depth < 5 || fr.width < 5) return;
  const u = fr.depth / 2 - 0.08;
  put(F, fr, C.frame, u, 0, 1.02, 0.06, Math.min(5.2, fr.width - 1.6), 2.0);
  put(F, fr, C.board, u - 0.04, 0, 1.08, 0.04, Math.min(5.0, fr.width - 1.8), 1.88);
  // Speaker podium / lectern
  put(F, fr, C.darkWood, fr.depth / 2 - 1.5, fr.width / 4, 0, 0.62, 0.78, 1.12);
  const bankW = Math.max(1.4, (fr.width - 3.2) / 2); // leaves 1.6m wide central walkway so student walks unobstructed
  for (let r = fr.depth / 2 - 3.1; r >= -fr.depth / 2 + 1.5; r -= 1.15) {
    for (const side of [-1, 1]) {
      const vc = side * (0.85 + bankW / 2);
      put(F, fr, C.wood, r, vc, 0.72, 0.45, bankW, 0.04);
      put(F, fr, C.metal, r - 0.05, vc, 0, 0.05, bankW, 0.72);
      for (let dv = -bankW / 2 + 0.32; dv <= bankW / 2 - 0.3; dv += 0.62) {
        put(F, fr, C.chair, r - 0.45, vc + dv, 0.43, 0.42, 0.46, 0.05);
        put(F, fr, C.chair, r - 0.66, vc + dv, 0.48, 0.04, 0.46, 0.42);
      }
    }
  }
}

function wc(F, fr) {
  // Stalls along far wall (+fr.depth/2), keeping front entrance vestibule completely clear
  const far = fr.depth / 2;
  const n = Math.max(2, Math.floor((fr.width - 0.4) / 1.05));
  const w = (fr.width - 0.4) / n;
  for (let i = 0; i <= n; i++) put(F, fr, C.partition, far - 0.8, -fr.width / 2 + 0.2 + i * w, 0.15, 1.5, 0.04, 1.85);
  for (let i = 0; i < n; i++) {
    const v = -fr.width / 2 + 0.2 + (i + 0.5) * w;
    put(F, fr, C.partition, far - 1.55, v, 0.15, 0.04, w - 0.72, 1.85);
    put(F, fr, C.sink, far - 0.3, v, 0, 0.58, 0.38, 0.42);
  }
  if (fr.depth > 3.6 && fr.width > 3.2) {
    put(F, fr, C.sink, 0, fr.width / 2 - 0.30, 0.82, Math.min(2.2, fr.depth * 0.42), 0.48, 0.08);
    put(F, fr, C.chrome, 0, fr.width / 2 - 0.05, 1.18, Math.min(2.1, fr.depth * 0.40), 0.03, 0.78);
  }
}

function office(F, fr) {
  if (fr.depth < 3.5 || fr.width < 3.0) return;
  const u = fr.depth / 2 - 1.35;
  table(F, fr, u, 0, 0.8, Math.min(1.6, fr.width - 1.2));
  chair(F, fr, u + 0.62, 0, 1);
  if (fr.depth >= 5.2) {
    chair(F, fr, u - 0.72, -0.45, -1);
    chair(F, fr, u - 0.72, 0.45, -1);
  }
  put(F, fr, C.cabinet, fr.depth / 2 - 0.3, fr.width / 2 - 0.65, 0, 0.44, 0.95, 1.9);
  put(F, fr, C.cabinet, fr.depth / 2 - 0.3, -fr.width / 2 + 0.65, 0, 0.44, 0.95, 1.9);
}

function cafe(F, fr) {
  put(F, fr, C.counter, fr.depth / 2 - 0.65, 0, 0, 0.7, fr.width * 0.62, 1.05);
  put(F, fr, C.darkWood, fr.depth / 2 - 0.65, 0, 1.05, 0.8, fr.width * 0.62 + 0.1, 0.05);
  put(F, fr, C.cabinet, fr.depth / 2 - 0.25, 0, 1.0, 0.38, fr.width * 0.52, 1.35);
  for (let u = -fr.depth / 2 + 1.6; u <= fr.depth / 2 - 2.5; u += 2.0) {
    for (let v = -fr.width / 2 + 1.3; v <= fr.width / 2 - 1.2; v += 2.1) {
      if (Math.abs(v) < 0.95) continue; // clear central walkway from cafe doorway to counter
      table(F, fr, u, v, 0.82, 0.82);
      chair(F, fr, u - 0.62, v, -1);
      chair(F, fr, u + 0.62, v, 1);
    }
  }
}

function lobby(F, fr, desk) {
  if (!desk) return;
  // Reception desk against the east feature wall facing incoming visitors, clear of entrance & stair paths
  const u = desk.depth / 2 - 1.65;
  put(F, desk, C.counter, u, 0, 0, 0.65, 3.2, 1.08);
  put(F, desk, C.darkWood, u, 0, 1.08, 0.78, 3.32, 0.05);
  chair(F, desk, u + 0.72, -0.6, 1);
  chair(F, desk, u + 0.72, 0.6, 1);
  for (const side of [-1, 1]) {
    put(F, desk, C.sofa, desk.depth / 4, side * (desk.width / 2 - 0.55), 0, 2.0, 0.6, 0.44);
    put(F, desk, C.sofa, desk.depth / 4, side * (desk.width / 2 - 0.26), 0.44, 2.0, 0.12, 0.38);
    put(F, desk, C.pot, desk.depth / 2 - 0.55, side * (desk.width / 2 - 0.55), 0, 0.42, 0.42, 0.42);
    put(F, desk, C.plant, desk.depth / 2 - 0.55, side * (desk.width / 2 - 0.55), 0.42, 0.58, 0.58, 0.88);
  }
}

function service(F, fr, r) {
  if (/prayer|مصل/i.test(`${r.name_en || ''} ${r.name_ar || ''}`)) {
    put(F, fr, C.rug, 0, 0, 0.008, fr.depth - 1.4, fr.width - 1.4, 0.015);
    return;
  }
  const n = Math.max(1, Math.floor((fr.width - 1.2) / 1.4));
  for (let i = 0; i < n; i++) {
    put(F, fr, C.cabinet, fr.depth / 2 - 0.45, -fr.width / 2 + 0.9 + i * 1.4, 0, 0.55, 1.05, 1.95);
  }
}

/** Architectural double-leaf oak door standing open inside the room with glass vision slits & stainless hardware. */
export function doorLeaves(F, side, at, w, h) {
  const fr = frame([at[0] - 1, at[1] - 1, at[0] + 1, at[1] + 1], OPP[side] || 'n');
  const leaf = w / 2 - 0.03;
  // Architectural door jambs on left & right of opening + overhead transom header
  for (const sgn of [-1, 1]) {
    put(F, fr, C.doorFrame, 0, sgn * (w / 2 + 0.045), 0, 0.25, 0.07, h + 0.06, 'door_frame');
  }
  put(F, fr, C.doorFrame, 0, 0, h, 0.25, w + 0.22, 0.08, 'door_frame');
  // Open double door leaves folded cleanly flush along +/- (w / 2 + 0.03) leaving full `w` aperture unobstructed
  for (const sgn of [-1, 1]) {
    put(F, fr, C.door, leaf / 2 + 0.06, sgn * (w / 2 + 0.03), 0.01, leaf, 0.05, h - 0.02, 'door_frame');
    put(F, fr, C.glass, leaf * 0.58, sgn * (w / 2 + 0.03), h * 0.50, 0.14, 0.06, 0.72, 'door_frame');
    put(F, fr, C.chrome, leaf * 0.82, sgn * (w / 2 - 0.01), 1.02, 0.04, 0.08, 0.035, 'door_frame');
    put(F, fr, C.chrome, leaf / 2 + 0.06, sgn * (w / 2 + 0.03), 0.01, leaf * 0.92, 0.055, 0.16, 'door_frame');
  }
}

/** Furnishes a room cell-by-cell according to its academic function, keeping all doorways clear. */
export function furnishRoom(F, r) {
  if (r.unfurnished) return;
  const defaultFront = r.door ? OPP[r.door] : ((r.rect[2] - r.rect[0]) >= (r.rect[3] - r.rect[1]) ? 'e' : 'n');
  const front = r.front || defaultFront;
  const cells = roomCells(r);

  // Compute doorway clearance zones (`1.45 m` clear vestibule inside each door) so benches/desks never block doors
  const doorClearZones = Array.isArray(r.doorPoints) && r.doorPoints.length
    ? r.doorPoints.map(({ side, at: [ax, ay] }) => ({
      s: [ax, ay + 0.55],
      n: [ax, ay - 0.55],
      e: [ax - 0.55, ay],
      w: [ax + 0.55, ay],
    })[side])
    : (r.door ? cells.map(([cx0, cy0, cx1, cy1]) => ({
      s: [(cx0 + cx1) / 2, cy0 + 0.55],
      n: [(cx0 + cx1) / 2, cy1 - 0.55],
      e: [cx1 - 0.55, (cy0 + cy1) / 2],
      w: [cx0 + 0.55, (cy0 + cy1) / 2],
    })[r.door]) : []);

  const guardedF = doorClearZones.length ? {
    box(color, cx, cy, h0, sx, sy, sz, tag = 'furniture') {
      if (tag !== 'door_frame' && color !== C.rug) {
        for (const [dx, dy] of doorClearZones) {
          if (Math.abs(cx - dx) < sx * 0.5 + 1.05 && Math.abs(cy - dy) < sy * 0.5 + 1.05) {
            return;
          }
        }
      }
      F.box(color, cx, cy, h0, sx, sy, sz, tag);
    },
  } : F;

  for (const cell of cells) {
    const fr = frame(cell, front);
    if (r.tables) { studyHall(guardedF, fr); continue; }
    switch (r.kind) {
      case 'room': classroom(guardedF, fr); break;
      case 'lab': lab(guardedF, fr); break;
      case 'drawing': studyHall(guardedF, fr); break;
      case 'hall': hall(guardedF, fr); break;
      case 'wc': wc(guardedF, fr); break;
      case 'office': office(guardedF, fr); break;
      case 'cafe': cafe(guardedF, fr); break;
      case 'lobby': lobby(guardedF, fr, r.desk ? frame(cell, OPP[r.desk] || 'e') : null); break;
      case 'service': service(guardedF, fr, r); break;
      default: break;
    }
  }
}

// Architectural floor-by-floor interior builder for university campus buildings (data/interiors/*.json).
// Coordinates are local ENU metres (x = East, y = North); Three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createFurnisher, furnishRoom, doorLeaves, roomCells } from './furniture.js';

// Restrained architectural flooring palette (academic visualization, never oversaturated pastel blocks)
const KIND_FLOOR = {
  lobby: 'terrazzo',
  cafe: 'terrazzo',
  stair: 'granite',
  wc: 'tile_cool',
  lab: 'tile_cool',
  room: 'tile_warm',
  drawing: 'tile_warm',
  hall: 'tile_warm',
  office: 'tile_warm',
  service: 'tile_cool',
  lift: 0x939ba4,
  locker: 0xdfd8c8,
  exit: 'granite',
  pending: 'tile_warm',
};

export const ARCH_CONSTANTS = {
  SLAB: 0.25,
  WALL_T: 0.20,
  EXT_T: 0.35,
  DOOR_W: 1.55,
  DOOR_H: 2.25,
  DADO_H: 1.15,
};

const { SLAB, WALL_T, EXT_T, DOOR_W, DOOR_H, DADO_H } = ARCH_CONSTANTS;

const PAINT_COLOR = 0xf2ece1;
const EXT_PAINT = 0xe9e0cf;
const DADO_COLOR = 0xd6c2a3;
const DADO_CAP = 0x7a6048;
const SKIRT_COLOR = 0x5d5348;
const LIFT_BODY = 0xcfd5dc;
const LOCKER_BODY = 0xdad2c0;

const matCache = new Map();
const texCache = new Map();

function mat(color, roughness = 0.86, metalness = 0.0) {
  const key = `${color}_${roughness}_${metalness}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return matCache.get(key);
}

// Deterministic pseudo-random helper so procedural stone/plaster grain is 100% reproducible across runs
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPlasterMaterial(tintHex = '#f2ece1', key = 'plaster_in') {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#ebe4d7');
  grad.addColorStop(0.18, tintHex);
  grad.addColorStop(0.88, tintHex);
  grad.addColorStop(1, '#e5ddd0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry32(4201);
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(130,115,95,0.06)';
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.0 });
  texCache.set(key, m);
  return m;
}

function getTravertineMaterial() {
  if (texCache.has('travertine')) return texCache.get('travertine');
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d7c3a4';
  g.fillRect(0, 0, 256, 128);
  const rnd = mulberry32(9187);
  for (let i = 0; i < 46; i++) {
    const y = rnd() * 128;
    g.fillStyle = i % 2 === 0 ? 'rgba(150,122,90,0.12)' : 'rgba(248,240,226,0.16)';
    g.fillRect(0, y, 256, 1 + rnd() * 3.5);
  }
  g.strokeStyle = 'rgba(120,98,74,0.22)';
  g.lineWidth = 1.2;
  for (let x = 64; x < 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.03 });
  texCache.set('travertine', m);
  return m;
}

function getPorcelainTileMaterial(w, d, cool = false) {
  const key = cool ? 'porcelain_cool' : 'porcelain_warm';
  if (!texCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = cool ? '#dfe5ea' : '#e8e3d9';
    g.fillRect(0, 0, 256, 256);
    const rnd = mulberry32(cool ? 771 : 331);
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const delta = (rnd() - 0.5) * 8;
        const base = cool ? [222, 228, 233] : [231, 226, 216];
        g.fillStyle = `rgb(${Math.round(base[0] + delta)},${Math.round(base[1] + delta)},${Math.round(base[2] + delta)})`;
        g.fillRect(tx * 64 + 1, ty * 64 + 1, 62, 62);
      }
    }
    g.strokeStyle = cool ? 'rgba(138,148,158,0.34)' : 'rgba(150,140,126,0.32)';
    g.lineWidth = 1.5;
    for (let p = 0; p <= 256; p += 64) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
    }
    const baseTex = new THREE.CanvasTexture(c);
    baseTex.colorSpace = THREE.SRGBColorSpace;
    baseTex.wrapS = baseTex.wrapT = THREE.RepeatWrapping;
    texCache.set(key, baseTex);
  }
  const tex = texCache.get(key).clone();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, w / 2.4), Math.max(1, d / 2.4));
  tex.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.46,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

// Honed Egyptian terrazzo floor with dark border inlays matching modern national university corridors
function terrazzo(w, d) {
  const PX = 20;
  const cw = Math.max(32, Math.min(1024, Math.round(w * PX)));
  const ch = Math.max(32, Math.min(1024, Math.round(d * PX)));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  const sx = cw / w, sy = ch / d;
  g.fillStyle = '#e7dac3';
  g.fillRect(0, 0, cw, ch);
  const band = (x, y, bw, bh, lw) => {
    if (bw <= 0.1 || bh <= 0.1) return;
    g.lineWidth = Math.max(1, lw * Math.min(sx, sy));
    g.strokeRect(x * sx, y * sy, bw * sx, bh * sy);
  };
  g.strokeStyle = '#755c4a';
  band(0.32, 0.32, w - 0.64, d - 0.64, 0.24);
  const long = w >= d, L = long ? w : d, S = long ? d : w;
  if (S > 1.8 && L > 3.2) {
    const n = Math.max(1, Math.round((L - 1) / 4.2));
    const step = (L - 1) / n;
    g.strokeStyle = '#876b57';
    for (let i = 0; i < n; i++) {
      const a = 0.5 + i * step + 0.4, len = step - 0.8, ins = Math.min(0.85, S * 0.24);
      if (long) band(a, ins, len, d - 2 * ins, 0.18);
      else band(ins, a, w - 2 * ins, len, 0.18);
    }
  }
  const rnd = mulberry32(Math.round(w * 97 + d * 31));
  const chips = Math.min(9000, Math.round((cw * ch) / 55));
  for (let i = 0; i < chips; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(122,98,74,0.16)' : 'rgba(255,252,246,0.24)';
    g.fillRect(rnd() * cw, rnd() * ch, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.36,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

// Downward-facing architectural 60x60 cm acoustic ceiling grid material (opaque from eye level, culled from high orbit)
function getAcousticCeilingMaterial() {
  if (texCache.has('ceiling_grid')) return texCache.get('ceiling_grid');
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(165,160,150,0.42)';
  g.lineWidth = 2;
  for (let p = 0; p <= 256; p += 64) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.42, 0.42);
  // ShapeGeometry rotated -PI/2 around X has front normal +Y; BackSide makes -Y (the underside facing the room) 100% solid & opaque!
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xf7f5f0,
    emissive: 0x2c2a26,
    emissiveIntensity: 0.32,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.BackSide,
  });
  texCache.set('ceiling_grid', m);
  return m;
}

const glassMat = new THREE.MeshStandardMaterial({
  color: 0xa8c6db,
  roughness: 0.14,
  metalness: 0.25,
  transparent: true,
  opacity: 0.65,
});

const railGlassMat = new THREE.MeshStandardMaterial({
  color: 0xbcd6e6,
  roughness: 0.12,
  metalness: 0.2,
  transparent: true,
  opacity: 0.48,
});

const ledPanelMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6e6,
  emissiveIntensity: 0.95,
  roughness: 0.25,
  metalness: 0.0,
});

// Full-height architectural wall segment between two ENU points, sitting cleanly from y = 0 to y = h
function wall(ax, ay, bx, by, h, t, material, colliders, withTrim = true) {
  const dx = bx - ax, dz = -(by - ay);
  const len = Math.hypot(dx, dz);
  if (len < 0.05 || h <= 0.02) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len + t, h, t), material);
  m.position.set((ax + bx) / 2, h / 2, -(ay + by) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  m.castShadow = true;
  m.receiveShadow = true;
  if (withTrim && h > 2.4) {
    const skirtH = 0.085;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(len + t + 0.016, skirtH, t + 0.028), mat(SKIRT_COLOR, 0.55));
    skirt.position.y = -h / 2 + skirtH / 2;
    const dadoBodyH = DADO_H - skirtH;
    const dado = new THREE.Mesh(new THREE.BoxGeometry(len + t + 0.012, dadoBodyH, t + 0.022), getTravertineMaterial());
    dado.position.y = -h / 2 + skirtH + dadoBodyH / 2;
    dado.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(len + t + 0.02, 0.045, t + 0.04), mat(DADO_CAP, 0.48));
    cap.position.y = -h / 2 + DADO_H + 0.022;
    m.add(skirt, dado, cap);
  }
  if (colliders) colliders.push(m);
  return m;
}

function rectWalls(group, [x0, y0, x1, y1], h, material, colliders, withTrim = true) {
  for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
    const w = wall(a, b, c, d, h, WALL_T, material, colliders, withTrim);
    if (w) group.add(w);
  }
}

// Architectural atrium balustrade (tempered glass panel + stainless steel handrail & posts) for double-height voids
function atriumBalustrade(group, [x0, y0, x1, y1], colliders) {
  const railH = 1.08;
  const steelMat = mat(0x5a6572, 0.35, 0.65);
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  for (const [ax, ay, bx, by] of edges) {
    const dx = bx - ax, dz = -(by - ay), len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const ang = -Math.atan2(dz, dx);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(len + 0.14, 0.12, 0.14), mat(DADO_COLOR, 0.5));
    curb.position.set((ax + bx) / 2, 0.06, -(ay + by) / 2);
    curb.rotation.y = ang;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(len, railH - 0.18, 0.03), railGlassMat);
    glass.position.set((ax + bx) / 2, 0.12 + (railH - 0.18) / 2, -(ay + by) / 2);
    glass.rotation.y = ang;
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, 0.055, 0.075), steelMat);
    topRail.position.set((ax + bx) / 2, railH, -(ay + by) / 2);
    topRail.rotation.y = ang;
    group.add(curb, glass, topRail);
    if (colliders) colliders.push(curb);
    const nPosts = Math.max(2, Math.round(len / 1.8) + 1);
    for (let i = 0; i < nPosts; i++) {
      const t = i / (nPosts - 1);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, railH, 8), steelMat);
      post.position.set(ax + (bx - ax) * t, railH / 2, -(ay + (by - ay) * t));
      group.add(post);
    }
  }
}

// Room walls split cleanly around double doorway openings, with full-height lintels, glazed transoms & open oak doors
function rectWallsWithDoors(group, r, h, material, F, colliders) {
  const [x0, y0, x1, y1] = r.rect;
  const edges = { s: [x0, y0, x1, y0], e: [x1, y0, x1, y1], n: [x1, y1, x0, y1], w: [x0, y1, x0, y0] };
  const doorW = Math.min(DOOR_W, Math.max(0.95, Math.min(x1 - x0, y1 - y0) * 0.55));
  const doorH = Math.min(DOOR_H, h - 0.45);
  const doors = roomCells(r)
    .map(([cx0, cy0, cx1, cy1]) => ({
      s: [(cx0 + cx1) / 2, cy0],
      n: [(cx0 + cx1) / 2, cy1],
      e: [cx1, (cy0 + cy1) / 2],
      w: [cx0, (cy0 + cy1) / 2],
    })[r.door])
    .filter(([x, y]) => (r.door === 'n' || r.door === 's')
      ? Math.abs(y - (r.door === 'n' ? y1 : y0)) < 0.02
      : Math.abs(x - (r.door === 'e' ? x1 : x0)) < 0.02);

  for (const [side, [a, b, c, d]] of Object.entries(edges)) {
    const gaps = side === r.door ? doors.map((at) => ({ at, width: doorW })) : [];
    for (const [ax, ay, bx, by] of edgeWithGaps([a, b], [c, d], gaps)) {
      const w = wall(ax, ay, bx, by, h, WALL_T, material, colliders, true);
      if (w) group.add(w);
    }
  }
  const horiz = r.door === 'n' || r.door === 's';
  for (const at of doors) {
    const [ax, ay, bx, by] = horiz
      ? [at[0] - doorW / 2, at[1], at[0] + doorW / 2, at[1]]
      : [at[0], at[1] - doorW / 2, at[0], at[1] + doorW / 2];
    const lintelH = h - doorH;
    const lintel = wall(ax, ay, bx, by, lintelH, WALL_T, material, colliders, false);
    if (lintel) {
      lintel.position.y = doorH + lintelH / 2;
      group.add(lintel);
      if (lintelH > 0.55) {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.12, 0.42, WALL_T + 0.03), glassMat);
        tr.position.copy(lintel.position).setY(doorH + 0.28);
        tr.rotation.copy(lintel.rotation);
        group.add(tr);
      }
    }
    doorLeaves(F, r.door, at, doorW, doorH);
  }
}

function floorPatch(group, [x0, y0, x1, y1], finish) {
  const w = x1 - x0, d = y1 - y0;
  if (w <= 0.05 || d <= 0.05) return;
  let material;
  if (finish === 'terrazzo') material = terrazzo(w, d);
  else if (finish === 'tile_cool') material = getPorcelainTileMaterial(w, d, true);
  else if (finish === 'tile_warm' || finish === 'granite') material = getPorcelainTileMaterial(w, d, false);
  else material = new THREE.MeshStandardMaterial({ color: finish, roughness: 0.5, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, 0.012, -(y0 + y1) / 2);
  m.receiveShadow = true;
  group.add(m);
}

// Mullioned exterior windows along perimeter walls aligned cleanly below ceiling soffit
function exteriorWindows(group, segs, clearH) {
  const frames = [], panes = [], sills = [];
  const winH = Math.min(1.85, clearH - 1.35);
  const winCenterY = 0.92 + winH / 2;
  for (const [ax, ay, bx, by] of segs) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.floor((len - 1.0) / 3.6);
    if (n < 1) continue;
    const ang = -Math.atan2(-(by - ay), bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = [ax + (bx - ax) * t, ay + (by - ay) * t];
      frames.push([p, ang]);
      panes.push([p, ang]);
      sills.push([p, ang]);
    }
  }
  const putInst = (list, geo, material, y) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    list.forEach(([[x, yEnu], ang], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, -yEnu), q.setFromAxisAngle(up, ang), one)));
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  };
  putInst(frames, new THREE.BoxGeometry(2.05, winH + 0.14, EXT_T + 0.06), mat(0xf5f4f0, 0.5), winCenterY);
  putInst(panes, new THREE.BoxGeometry(1.86, winH - 0.06, EXT_T + 0.09), glassMat, winCenterY);
  putInst(sills, new THREE.BoxGeometry(2.2, 0.07, EXT_T + 0.14), getTravertineMaterial(), 0.90);
}

// Switchback stair geometry shared between interior.js and route.js
export function stairProfile(rect, rise) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const L = along1 - along0, W = cross1 - cross0;
  const landingDepth = Math.min(1.8, L * 0.2);
  const runLen = L - landingDepth;
  const nF = Math.max(4, Math.round(Math.max(8, Math.round(Math.abs(rise) / 0.22)) / 2));
  const n = nF * 2;
  const run = runLen / nF;
  const width = W * 0.45;
  const laneA = cross0 + width / 2 + 0.3;
  const laneB = cross1 - width / 2 - 0.3;
  const stepRise = rise / n, half = rise / 2;
  const P = (along, cross, h, land) => alongX
    ? { x: along, y: cross, h, ...(land ? { land: true } : {}) }
    : { x: cross, y: along, h, ...(land ? { land: true } : {}) };
  const steps = [], walk = [];
  for (let i = 0; i < nF; i++) {
    const p = P(along1 - run * (i + 0.5), laneA, stepRise * (i + 1));
    steps.push(p); walk.push(p);
  }
  walk.push(P(along0 + landingDepth / 2, laneA, half, true));
  walk.push(P(along0 + landingDepth / 2, laneB, half, true));
  for (let j = 0; j < nF; j++) {
    const p = P(along0 + landingDepth + run * (j + 0.5), laneB, half + stepRise * (j + 1));
    steps.push(p); walk.push(p);
  }
  const landings = [{ alongC: along0 + landingDepth / 2, crossC: (cross0 + cross1) / 2, alongSize: landingDepth, crossSize: (laneB - laneA) + width, h: half }];
  const flights = [
    { from: along1, to: along0 + landingDepth, cross: laneA, hFrom: 0, hTo: half },
    { from: along0 + landingDepth, to: along1, cross: laneB, hFrom: half, hTo: rise },
  ];
  return { steps, walk, flights, landings, alongX, n, run, width, laneA, laneB, landingDepth };
}

// Structural reinforced-concrete switchback staircase: individual treads + risers + non-slip nosings +
// sloped structural concrete stringer slabs + thin half-landing slab (replaces old full-height solid columns!)
function stairs(group, rect, rise) {
  const prof = stairProfile(rect, rise);
  const { alongX, run, width, n } = prof;
  const stepRise = rise / n;
  const treadMat = mat(0xd8d0c1, 0.52, 0.02);
  const riserMat = mat(0xe6dfd3, 0.68, 0.0);
  const nosingMat = mat(0x4a5058, 0.6, 0.25);
  const soffitMat = mat(0xded7ca, 0.82, 0.0);
  const treadThick = 0.055;

  prof.steps.forEach((s, idx) => {
    const isFlightA = idx < n / 2;
    const dirSign = isFlightA ? -1 : 1; // direction of travel along axis
    // Horizontal tread slab with top face strictly at y = s.h
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? run + 0.03 : width, treadThick, alongX ? width : run + 0.03),
      treadMat
    );
    tread.position.set(s.x, s.h - treadThick / 2, -s.y);
    tread.castShadow = true;
    tread.receiveShadow = true;
    group.add(tread);

    // Safety non-slip nosing strip at step leading edge
    const noseOffset = -dirSign * (run / 2 - 0.018);
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? 0.036 : width - 0.04, 0.012, alongX ? width - 0.04 : 0.036),
      nosingMat
    );
    nose.position.set(
      alongX ? s.x + noseOffset : s.x,
      s.h - 0.004,
      alongX ? -s.y : -(s.y + noseOffset)
    );
    group.add(nose);

    // Vertical riser closing the step face cleanly to the tread below
    const riserOffset = -dirSign * (run / 2);
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? 0.035 : width, stepRise, alongX ? width : 0.035),
      riserMat
    );
    riser.position.set(
      alongX ? s.x + riserOffset : s.x,
      s.h - stepRise / 2,
      alongX ? -s.y : -(s.y + riserOffset)
    );
    riser.receiveShadow = true;
    group.add(riser);
  });

  // Structural reinforced-concrete half-landing slab (0.22m slab thickness, never a giant ground block)
  const landingThick = 0.22;
  for (const l of prof.landings) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? l.alongSize + 0.12 : l.crossSize, landingThick, alongX ? l.crossSize : l.alongSize + 0.12),
      treadMat
    );
    m.position.set(alongX ? l.alongC : l.crossC, l.h - landingThick / 2, -(alongX ? l.crossC : l.alongC));
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Sloped structural RC waist slabs underneath Flight A & Flight B + bounded steel handrails
  const railMat = mat(0x46525f, 0.36, 0.65);
  const [x0, y0, x1, y1] = rect;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1, midCross = (cross0 + cross1) / 2;
  const toXYZ = (along, cross, h) => alongX ? [along, h, -cross] : [cross, h, -along];

  for (const f of prof.flights) {
    const len = Math.abs(f.to - f.from), dh = f.hTo - f.hFrom;
    const slopeLen = Math.hypot(len, dh);
    const hAtMin = f.from < f.to ? f.hFrom : f.hTo;
    const hAtMax = f.from < f.to ? f.hTo : f.hFrom;
    const slopeAng = Math.atan2(hAtMax - hAtMin, len);
    const mid = (f.from + f.to) / 2;

    // Continuous sloped reinforced-concrete stringer / waist slab beneath treads
    const waist = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(slopeLen, 0.15, width) : new THREE.BoxGeometry(width, 0.15, slopeLen),
      soffitMat
    );
    waist.position.set(...toXYZ(mid, f.cross, (f.hFrom + f.hTo) / 2 - stepRise * 0.72));
    if (alongX) waist.rotation.z = slopeAng; else waist.rotation.x = slopeAng;
    waist.castShadow = true;
    waist.receiveShadow = true;
    group.add(waist);

    // Handrail along the open well side, strictly bounded below `rise - 0.04` so posts never poke into upper storeys
    const insetStart = 0.65;
    const insetEnd = f.hTo >= rise - 0.05 ? Math.min(1.65, len * 0.32) : 0.65;
    const aStart = f.from < f.to ? f.from + insetStart : f.from - insetStart;
    const aEnd = f.from < f.to ? f.to - insetEnd : f.to + insetEnd;
    const rLen = Math.max(0.8, Math.abs(aEnd - aStart));
    const rMid = (aStart + aEnd) / 2;
    const fracMid = (rMid - Math.min(f.from, f.to)) / len;
    const hMid = hAtMin + (hAtMax - hAtMin) * fracMid;
    const railH = Math.min(0.92, Math.max(0.45, rise - 0.06 - (hMid + rLen * 0.5 * Math.abs(Math.sin(slopeAng)))));
    const rSlopeLen = Math.hypot(rLen, dh * (rLen / len));
    const cross = f.cross + (f.cross < midCross ? 1 : -1) * (width / 2 - 0.05);

    const rail = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(rSlopeLen, 0.055, 0.055) : new THREE.BoxGeometry(0.055, 0.055, rSlopeLen),
      railMat
    );
    rail.position.set(...toXYZ(rMid, cross, hMid + railH));
    if (alongX) rail.rotation.z = slopeAng; else rail.rotation.x = slopeAng;
    group.add(rail);

    for (const fr of [0.15, 0.5, 0.85]) {
      const along = aStart + (aEnd - aStart) * fr;
      const frac = (along - Math.min(f.from, f.to)) / len;
      const hSurf = hAtMin + (hAtMax - hAtMin) * frac;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, railH, 8), railMat);
      post.position.set(...toXYZ(along, cross, hSurf + railH / 2));
      group.add(post);
    }
  }
}

function label(text_en, text_ar, cls) {
  const el = document.createElement('div');
  el.className = 'room-label' + (cls ? ' ' + cls : '');
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

function doorSign(text_en, text_ar) {
  const el = document.createElement('div');
  el.className = 'door-sign';
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

// Stairwell enclosure rising full storey height (`rise`) so shaft connects cleanly slab-to-slab with zero gap
function stairDoor(group, rect, wallH, shaftH, wallMat, floorEn, floorAr, colliders) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const mid = (cross0 + cross1) / 2;
  const doorW = 1.25, doorH = 2.25;
  const pt = (along, cross) => alongX ? [along, cross] : [cross, along];
  const addShaftWall = (a, b, hVal) => {
    const w = wall(a[0], a[1], b[0], b[1], hVal, WALL_T, wallMat, colliders, true);
    if (w) group.add(w);
    return w;
  };
  // Enclose shaft up to full wallH so it meets the ceiling soffit cleanly without protruding above floor ceiling
  addShaftWall(pt(along0, cross0), pt(along0, cross1), wallH);
  addShaftWall(pt(along0, cross0), pt(along1, cross0), wallH);
  addShaftWall(pt(along0, cross1), pt(along1, cross1), wallH);
  addShaftWall(pt(along1, cross0), pt(along1, mid - doorW / 2), wallH);
  addShaftWall(pt(along1, mid + doorW / 2), pt(along1, cross1), wallH);

  const [la, lb] = [pt(along1, mid - doorW / 2), pt(along1, mid + doorW / 2)];
  const lintel = wall(la[0], la[1], lb[0], lb[1], wallH - doorH, WALL_T, wallMat, colliders, false);
  if (lintel) {
    lintel.position.y = doorH + (wallH - doorH) / 2;
    group.add(lintel);
  }

  // Open stairwell door leaf folded back cleanly inside the stairwell jamb
  const hinge = pt(along1, mid + doorW / 2);
  const door = new THREE.Group();
  door.name = 'floor-door';
  door.position.set(hinge[0], 0, -hinge[1]);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.055), mat(0x9b7650, 0.65));
  panel.position.set(doorW / 2, doorH / 2, 0);
  panel.castShadow = true;
  const vision = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.065), glassMat);
  vision.position.set(doorW * 0.62, doorH * 0.58, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), mat(0xadb5bd, 0.35, 0.7));
  handle.position.set(doorW - 0.14, 1.02, 0.045);
  door.add(panel, vision, handle);
  door.rotation.y = alongX ? Math.PI * 0.58 : -0.25;
  group.add(door);

  const sign = doorSign(floorEn, floorAr);
  const sp = pt(along1 + 0.42, mid);
  sign.position.set(sp[0], doorH + 0.38, -sp[1]);
  group.add(sign);
  return sign;
}

// Elevator core block with stainless-steel elevator doors, architrave & call panel
function buildLiftCore(group, r, clearH, colliders) {
  const [x0, y0, x1, y1] = r.rect;
  const body = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, clearH, y1 - y0), mat(LIFT_BODY, 0.72, 0.08));
  body.position.set((x0 + x1) / 2, clearH / 2, -(y0 + y1) / 2);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  if (colliders) colliders.push(body);

  const face = r.door || 'e';
  const steelMat = mat(0xb5bec7, 0.30, 0.72);
  const darkGapMat = mat(0x3a4048, 0.5, 0.4);
  for (const [cx0, cy0, cx1, cy1] of roomCells(r)) {
    const cx = (cx0 + cx1) / 2, cy = (cy0 + cy1) / 2;
    const horiz = face === 'n' || face === 's';
    const px = face === 'e' ? x1 + 0.02 : face === 'w' ? x0 - 0.02 : cx;
    const py = face === 'n' ? y1 + 0.02 : face === 's' ? y0 - 0.02 : cy;
    const doorW = Math.min(1.05, (horiz ? (cx1 - cx0) : (cy1 - cy0)) * 0.68);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? doorW : 0.05, 2.15, horiz ? 0.05 : doorW),
      steelMat
    );
    cab.position.set(px, 2.15 / 2, -py);
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? 0.02 : 0.06, 2.15, horiz ? 0.06 : 0.02),
      darkGapMat
    );
    seam.position.set(px, 2.15 / 2, -py);
    group.add(cab, seam);
  }
}

// Structural reinforced-concrete columns placed cleanly at open lobby corners (strictly 0..clearH, never in paths)
function addStructuralColumns(group, f, clearH, colliders) {
  const candidates = [];
  for (const r of f.rooms) {
    if (r.kind !== 'lobby' || !r.open) continue;
    const [x0, y0, x1, y1] = r.rect;
    if ((x1 - x0) < 7.5 || (y1 - y0) < 7.5) continue;
    // Place columns slightly inset at the structural corners of spacious lobbies
    const inset = 0.35;
    for (const cx of [x0 + inset, x1 - inset]) {
      for (const cy of [y0 + inset, y1 - inset]) {
        if (!candidates.some(([px, py]) => Math.hypot(px - cx, py - cy) < 2.2)) {
          candidates.push([cx, cy]);
        }
      }
    }
  }
  if (!candidates.length) return;
  const colW = 0.42;
  const shaftMat = getPlasterMaterial('#efe8dc', 'col_plaster');
  const colGeo = new THREE.BoxGeometry(colW, clearH, colW);
  const plinthGeo = new THREE.BoxGeometry(colW + 0.06, DADO_H, colW + 0.06);
  const capGeo = new THREE.BoxGeometry(colW + 0.08, 0.05, colW + 0.08);

  const shaftInst = new THREE.InstancedMesh(colGeo, shaftMat, candidates.length);
  const plinthInst = new THREE.InstancedMesh(plinthGeo, getTravertineMaterial(), candidates.length);
  const capInst = new THREE.InstancedMesh(capGeo, mat(DADO_CAP, 0.5), candidates.length);
  const m = new THREE.Matrix4();

  candidates.forEach(([cx, cy], i) => {
    shaftInst.setMatrixAt(i, m.makeTranslation(cx, clearH / 2, -cy));
    plinthInst.setMatrixAt(i, m.makeTranslation(cx, DADO_H / 2, -cy));
    capInst.setMatrixAt(i, m.makeTranslation(cx, DADO_H + 0.025, -cy));
  });
  shaftInst.instanceMatrix.needsUpdate = true;
  plinthInst.instanceMatrix.needsUpdate = true;
  capInst.instanceMatrix.needsUpdate = true;
  shaftInst.castShadow = shaftInst.receiveShadow = true;
  plinthInst.receiveShadow = true;
  shaftInst.name = 'structural-columns';
  group.add(shaftInst, plinthInst, capInst);
  if (colliders) colliders.push(shaftInst);
}

// Instanced recessed 120x60 cm warm-white architectural LED ceiling panels across rooms & corridors
function addCeilingLuminaires(group, f, clearH) {
  const panels = [];
  for (const r of f.rooms) {
    if (r.kind === 'void' || r.kind === 'stair' || r.kind === 'lift' || r.kind === 'locker') continue;
    const [x0, y0, x1, y1] = r.rect;
    const w = x1 - x0, d = y1 - y0;
    if (w < 2.2 || d < 2.2) continue;
    const nx = Math.max(1, Math.round(w / 4.2));
    const ny = Math.max(1, Math.round(d / 4.2));
    const alongX = w >= d;
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        panels.push([x0 + w * ((ix + 0.5) / nx), y0 + d * ((iy + 0.5) / ny), alongX]);
      }
    }
  }
  if (!panels.length) return;
  const bezelGeo = new THREE.BoxGeometry(1.18, 0.025, 0.58);
  const glowGeo = new THREE.PlaneGeometry(1.10, 0.50);
  const bezelInst = new THREE.InstancedMesh(bezelGeo, mat(0xe4e7eb, 0.4, 0.3), panels.length);
  const glowInst = new THREE.InstancedMesh(glowGeo, ledPanelMat, panels.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);

  panels.forEach(([x, y, alongX], i) => {
    eul.set(0, alongX ? 0 : Math.PI / 2, 0);
    q.setFromEuler(eul);
    bezelInst.setMatrixAt(i, m.compose(new THREE.Vector3(x, clearH - 0.015, -y), q, sc));
    eul.set(Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
    q.setFromEuler(eul);
    glowInst.setMatrixAt(i, m.compose(new THREE.Vector3(x, clearH - 0.03, -y), q, sc));
  });
  bezelInst.instanceMatrix.needsUpdate = true;
  glowInst.instanceMatrix.needsUpdate = true;
  bezelInst.name = 'ceiling-bezel';
  glowInst.name = 'ceiling-lights';
  group.add(bezelInst, glowInst);
}

// Compute stairwell shaft hole rect leaving solid 1.15m landing threshold at the along1 doorway side
function stairShaftHoleRect(rect) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  return alongX ? [x0 + 0.05, y0 + 0.05, x1 - 1.15, y1 - 0.05] : [x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 1.15];
}

function makeShapeWithHoles(footprint, holeRects) {
  const s = new THREE.Shape(footprint.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [x0, y0, x1, y1] of holeRects) {
    if (x1 - x0 > 0.2 && y1 - y0 > 0.2) {
      s.holes.push(new THREE.Path([
        new THREE.Vector2(x0, y0),
        new THREE.Vector2(x0, y1),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x1, y0),
      ]));
    }
  }
  return s;
}

function edgeWithGaps(a, b, gaps) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const cuts = [];
  for (const g of gaps) {
    const t = ((g.at[0] - a[0]) * dx + (g.at[1] - a[1]) * dy) / (len * len);
    const px = a[0] + t * dx, py = a[1] + t * dy;
    if (t > 0 && t < 1 && Math.hypot(px - g.at[0], py - g.at[1]) < 1.2) {
      const half = g.width / 2 / len;
      cuts.push([Math.max(0, t - half), Math.min(1, t + half)]);
    }
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const segs = [];
  let s = 0;
  for (const [c0, c1] of cuts) { if (c0 > s) segs.push([s, c0]); s = c1; }
  if (s < 1) segs.push([s, 1]);
  return segs.map(([t0, t1]) => [a[0] + dx * t0, a[1] + dy * t0, a[0] + dx * t1, a[1] + dy * t1]);
}

export function buildInterior(data) {
  const root = new THREE.Group();
  root.name = `interior_${data.building_id}`;

  // Gentle architectural interior fill lighting so eye-level corridors read naturally without synthetic glare
  const indoorHemi = new THREE.HemisphereLight(0xfffaf2, 0xd8cdb8, 0.72);
  indoorHemi.name = 'interior-ambient-fill';
  root.add(indoorHemi);

  const defaultRise = data.floors.length > 1
    ? (data.floors[1].level - data.floors[0].level)
    : (data.wall_height || 3.8);

  const wallMat = getPlasterMaterial('#f2ece1', 'plaster_in');
  const extMat = getPlasterMaterial('#eae0ce', 'plaster_ext');

  const floors = data.floors.map((f, fi) => {
    const g = new THREE.Group();
    g.name = `floor_${f.id}`;
    g.position.y = f.level;

    // Exact floor-to-floor height and clear floor-to-ceiling soffit height (0.00m wall-to-ceiling gap!)
    const rise = fi < data.floors.length - 1
      ? (data.floors[fi + 1].level - f.level)
      : (data.floors.length > 2 ? (data.floors[2].level - data.floors[1].level) : defaultRise);
    const clearH = Math.max(2.9, rise - SLAB);
    const colliders = [];

    // 1. Structural floor slab with cutouts for double-height atrium voids AND rising stair shafts from floor below
    const floorHoleRects = f.rooms.filter((r) => r.kind === 'void').map((r) => r.rect);
    if (fi > 0) {
      for (const prevStair of data.floors[fi - 1].rooms.filter((r) => r.kind === 'stair')) {
        floorHoleRects.push(stairShaftHoleRect(prevStair.rect));
      }
    }
    const slabShape = makeShapeWithHoles(data.footprint, floorHoleRects);
    const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: SLAB, bevelEnabled: false });
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, mat(0xe6dfd2, 0.85));
    slab.name = `slab_${f.id}`;
    slab.position.y = -SLAB;
    slab.receiveShadow = true;
    g.add(slab);

    // 2. Complete acoustic ceiling soffit at y = clearH (cuts holes strictly for rising stairs & upper voids)
    const ceilingHoleRects = [];
    if (fi < data.floors.length - 1) {
      for (const curStair of f.rooms.filter((r) => r.kind === 'stair')) {
        ceilingHoleRects.push(stairShaftHoleRect(curStair.rect));
      }
      for (const nextVoid of data.floors[fi + 1].rooms.filter((r) => r.kind === 'void')) {
        ceilingHoleRects.push(nextVoid.rect);
      }
    }
    const ceilShape = makeShapeWithHoles(data.footprint, ceilingHoleRects);
    const ceilGeo = new THREE.ShapeGeometry(ceilShape);
    ceilGeo.rotateX(-Math.PI / 2);
    const ceiling = new THREE.Mesh(ceilGeo, getAcousticCeilingMaterial());
    ceiling.name = `ceiling_${f.id}`;
    ceiling.position.y = clearH;
    g.add(ceiling);

    // 3. Full-height exterior walls + mullioned windows
    const fp = data.footprint;
    const extSegs = [];
    for (let i = 0; i < fp.length; i++) {
      for (const seg of edgeWithGaps(fp[i], fp[(i + 1) % fp.length], f.entrances || [])) {
        const w = wall(seg[0], seg[1], seg[2], seg[3], clearH, EXT_T, extMat, colliders, true);
        if (w) { g.add(w); extSegs.push(seg); }
      }
    }
    exteriorWindows(g, extSegs, clearH);

    // 4. Interior rooms, open double doorways, stairs, lift cores, structural columns, lighting & furnishings
    const labels = [];
    const furniture = createFurnisher();

    for (const r of f.rooms) {
      const [x0, y0, x1, y1] = r.rect;
      if (r.kind === 'void') {
        atriumBalustrade(g, r.rect, colliders);
      } else {
        floorPatch(g, r.rect, KIND_FLOOR[r.kind] ?? KIND_FLOOR.room);
      }

      if (!r.open && r.kind !== 'void' && r.kind !== 'lift') {
        if (r.kind === 'stair') {
          labels.push(stairDoor(g, r.rect, clearH, rise, wallMat, f.name_en, f.name_ar, colliders));
        } else if (r.door) {
          rectWallsWithDoors(g, r, clearH, wallMat, furniture, colliders);
        } else {
          rectWalls(g, r.rect, clearH, wallMat, colliders, true);
        }
      }

      furnishRoom(furniture, r);

      if (r.split > 1 && r.kind !== 'lift') {
        const alongX = (x1 - x0) >= (y1 - y0);
        for (let k = 1; k < r.split; k++) {
          const w = alongX
            ? wall(x0 + (x1 - x0) * (k / r.split), y0, x0 + (x1 - x0) * (k / r.split), y1, clearH, WALL_T, wallMat, colliders, true)
            : wall(x0, y0 + (y1 - y0) * (k / r.split), x1, y0 + (y1 - y0) * (k / r.split), clearH, WALL_T, wallMat, colliders, true);
          if (w) g.add(w);
        }
      }

      if (r.kind === 'stair' && fi < data.floors.length - 1) {
        stairs(g, r.rect, rise);
      }
      if (r.kind === 'lift') {
        buildLiftCore(g, r, clearH, colliders);
      } else if (r.kind === 'locker') {
        const bh = 1.82;
        const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, bh, y1 - y0), mat(LOCKER_BODY, 0.62, 0.12));
        b.position.set((x0 + x1) / 2, bh / 2, -(y0 + y1) / 2);
        b.castShadow = true;
        b.receiveShadow = true;
        g.add(b);
      }

      if (r.nolabel) continue;
      const lab = label(r.name_en, r.name_ar, `kind-${r.kind}`);
      lab.position.set((x0 + x1) / 2, clearH + 0.35, -(y0 + y1) / 2);
      g.add(lab);
      labels.push(lab);
    }

    for (const e of f.entrances || []) {
      const lab = label(e.name_en, e.name_ar, 'entrance');
      const [ox, oy] = e.label_offset || [-3, 0];
      lab.position.set(e.at[0] + ox, 1.6, -(e.at[1] + oy));
      g.add(lab);
      labels.push(lab);
    }

    addStructuralColumns(g, f, clearH, colliders);
    addCeilingLuminaires(g, f, clearH);
    furniture.build(g);
    root.add(g);

    return {
      id: f.id,
      name_en: f.name_en,
      name_ar: f.name_ar,
      level: f.level,
      rise,
      clearH,
      group: g,
      labels,
      colliders,
    };
  });

  // Strict per-floor visibility: only floors <= active index render; upper floors & their columns/geometry are occluded/hidden
  function setFloor(idx) {
    floors.forEach((f, i) => {
      f.group.visible = i <= idx;
      for (const l of f.labels) l.visible = i === idx;
    });
  }

  return { group: root, floors, setFloor };
}

// Floor-by-floor interior cutaway for a building (see data/interiors/*.json).
// Input coordinates are local ENU metres (x = East, y = North); three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const KIND_COLOR = {
  // light tints of the label / legend colours (css .room-label.kind-*)
  lobby: 0xd9f2ee, cafe: 0xb5e8df, stair: 0xd5dbe3, wc: 0xcfe8fb, office: 0xf7e7b5,
  lab: 0xfbd9bd, room: 0xcdeedd, drawing: 0xe2d3fa, hall: 0xc9dcfb,
  lift: 0x9aa3ad, locker: 0xf0ece0, exit: 0xf4b4ae, pending: 0xf6e7a8, service: 0xefe3bd,
};
const SLAB = 0.25, WALL_T = 0.2, EXT_T = 0.35;

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }));
  return matCache.get(color);
}

// wall segment between two ENU points, sitting on y = 0 of its floor group
function wall(ax, ay, bx, by, h, t, material) {
  const dx = bx - ax, dz = -(by - ay); const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len + t, h, t), material);
  m.position.set((ax + bx) / 2, h / 2, -(ay + by) / 2);
  m.rotation.y = -Math.atan2(dz, dx);
  m.receiveShadow = true;
  return m;
}

function rectWalls(group, [x0, y0, x1, y1], h, material) {
  for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
    const w = wall(a, b, c, d, h, WALL_T, material); if (w) group.add(w);
  }
}

function floorPatch(group, [x0, y0, x1, y1], color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat(color));
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, 0.02, -(y0 + y1) / 2);
  m.receiveShadow = true;
  group.add(m);
}

// A real stairwell flight pair (switchback): flight A climbs one lane to a half-landing,
// flight B climbs back along the other lane to the next floor — the way real building
// stair cores work, so a multi-storey climb reads as one continuous ascent that turns
// at every landing instead of replaying the same straight flight floor after floor.
// The layout is shared with route.js (stairProfile) so the walked path follows the drawn
// treads exactly: `steps` = drawn treads, `walk` = the exact walked points (treads +
// half-landing crossing), `flights`/`landings` describe the geometry for rails/platforms.
// Entry and every floor arrival happen at the along1 end, where the floor door sits.
export function stairProfile(rect, rise) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const L = along1 - along0, W = cross1 - cross0;
  const landingDepth = Math.min(1.8, L * 0.2);              // west half-landing
  const runLen = L - landingDepth;                          // horizontal run of one flight
  const nF = Math.max(4, Math.round(Math.max(8, Math.round(Math.abs(rise) / 0.22)) / 2)); // treads per flight (~22 cm rise each)
  const n = nF * 2;
  const run = runLen / nF;
  const width = W * 0.45;                                   // lane width
  const laneA = cross0 + width / 2 + 0.3;                   // lane of flight A (climbs along1 → along0)
  const laneB = cross1 - width / 2 - 0.3;                   // lane of flight B (climbs back along0 → along1)
  const stepRise = rise / n, half = rise / 2;
  const P = (along, cross, h, land) => alongX
    ? { x: along, y: cross, h, ...(land ? { land: true } : {}) }
    : { x: cross, y: along, h, ...(land ? { land: true } : {}) };
  const steps = [], walk = [];
  for (let i = 0; i < nF; i++) {                            // flight A: from the door end, up to the half-landing
    const p = P(along1 - run * (i + 0.5), laneA, stepRise * (i + 1));
    steps.push(p); walk.push(p);
  }
  walk.push(P(along0 + landingDepth / 2, laneA, half, true));   // cross the half-landing (the turn)
  walk.push(P(along0 + landingDepth / 2, laneB, half, true));
  for (let j = 0; j < nF; j++) {                            // flight B: back above, up to the next floor's door
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

function stairs(group, rect, rise) {
  const prof = stairProfile(rect, rise);
  const { alongX, run, width } = prof;
  for (const s of prof.steps) {
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? run : width, Math.abs(s.h), alongX ? width : run),
      mat(0xcfc6b6)
    );
    tread.position.set(s.x, s.h / 2, -s.y); tread.receiveShadow = true;
    group.add(tread);
  }
  // half-landing platform the turn is walked on
  for (const l of prof.landings) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? l.alongSize : l.crossSize, Math.abs(l.h), alongX ? l.crossSize : l.alongSize),
      mat(0xcfc6b6)
    );
    m.position.set(alongX ? l.alongC : l.crossC, l.h / 2, -(alongX ? l.crossC : l.alongC));
    m.receiveShadow = true;
    group.add(m);
  }
  // handrails on the open (well) side of each flight, with two posts per flight
  const railMat = mat(0x46525f);
  const [x0, y0, x1, y1] = rect;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1, midCross = (cross0 + cross1) / 2;
  const toXYZ = (along, cross, h) => alongX ? [along, h, -cross] : [cross, h, -along];
  for (const f of prof.flights) {
    const len = Math.abs(f.to - f.from), dh = f.hTo - f.hFrom;
    // the rail stops short of both ends (as real handrails do) so the walker never
    // crosses it when turning on the half-landing or passing the floor door
    const inset = Math.min(0.9, len * 0.15), rLen = len - 2 * inset;
    const slopeLen = Math.hypot(rLen, dh * (rLen / len));
    const hAtMin = f.from < f.to ? f.hFrom : f.hTo, hAtMax = f.from < f.to ? f.hTo : f.hFrom;
    const railAng = Math.atan2(hAtMax - hAtMin, len);       // slope as the along axis increases
    const cross = f.cross + (f.cross < midCross ? 1 : -1) * (width / 2 - 0.05);
    const mid = (f.from + f.to) / 2;
    const rail = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(slopeLen, 0.07, 0.07) : new THREE.BoxGeometry(0.07, 0.07, slopeLen),
      railMat
    );
    rail.position.set(...toXYZ(mid, cross, (f.hFrom + f.hTo) / 2 + 0.95));
    if (alongX) rail.rotation.z = railAng; else rail.rotation.x = railAng;
    group.add(rail);
    for (const fr of [0.25, 0.75]) {
      const along = Math.min(f.from, f.to) + len * fr;
      const hSurf = hAtMin + (hAtMax - hAtMin) * fr;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8), railMat);
      post.position.set(...toXYZ(along, cross, hSurf + 0.475));
      group.add(post);
    }
  }
}

function label(text_en, text_ar, cls) {
  const el = document.createElement('div');
  // one short line in Arabic (the English name is in the tooltip), a coloured edge shows the room type
  el.className = 'room-label' + (cls ? ' ' + cls : '');
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

// The sign plate over a stairwell door ("الدور الأول"…). Deliberately NOT a room-label:
// room labels are hidden during the guided tour, and this plate must stay readable while
// climbing — it is how the student sees which floor he has reached.
function doorSign(text_en, text_ar) {
  const el = document.createElement('div');
  el.className = 'door-sign';
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

// Walls of a stair room, with a real doorway in the door-side wall (the along1 end, where
// every floor is entered and left): a gap in the wall, a lintel above it, the door panel
// standing OPEN (folded back against the inside of the wall) with a handle, and the
// floor-name sign plate over the door. Returns the sign so the caller can register it
// with the floor's labels (shown only while that floor is the current one).
function stairDoor(group, rect, h, wallMat, floorEn, floorAr) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const mid = (cross0 + cross1) / 2;
  const doorW = 1.15, doorH = 2.2;
  const pt = (along, cross) => alongX ? [along, cross] : [cross, along];
  const addWall = (a, b) => { const w = wall(a[0], a[1], b[0], b[1], h, WALL_T, wallMat); if (w) group.add(w); return w; };
  addWall(pt(along0, cross0), pt(along0, cross1));                 // far end
  addWall(pt(along0, cross0), pt(along1, cross0));                 // sides
  addWall(pt(along0, cross1), pt(along1, cross1));
  addWall(pt(along1, cross0), pt(along1, mid - doorW / 2));        // door wall, split around the doorway
  addWall(pt(along1, mid + doorW / 2), pt(along1, cross1));
  const [la, lb] = [pt(along1, mid - doorW / 2), pt(along1, mid + doorW / 2)];
  const lintel = wall(la[0], la[1], lb[0], lb[1], h - doorH, WALL_T, wallMat);
  if (lintel) { lintel.position.y = doorH + (h - doorH) / 2; group.add(lintel); }
  // the open door panel, hinged at the cross1-side jamb, folded back inside the stairwell
  const hinge = pt(along1, mid + doorW / 2);
  const door = new THREE.Group(); door.name = 'floor-door';
  door.position.set(hinge[0], 0, -hinge[1]);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), mat(0x8a6742));
  panel.position.set(doorW / 2, doorH / 2, 0); panel.castShadow = true;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.045), mat(0x333c47));
  handle.position.set(doorW - 0.14, 1.02, 0.07);
  door.add(panel, handle);
  // local +X runs from hinge to free edge: rotate from "closed across the gap" to fully open inside
  door.rotation.y = alongX ? Math.PI * 0.58 : -0.25;
  group.add(door);
  // the floor-name sign plate over the door
  const sign = doorSign(floorEn, floorAr);
  const sp = pt(along1 + 0.45, mid);
  sign.position.set(sp[0], doorH + 0.42, -sp[1]);
  group.add(sign);
  return sign;
}

// split exterior edge a->b around entrance gaps that lie on it
function edgeWithGaps(a, b, gaps) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
  const cuts = [];
  for (const g of gaps) {
    const t = ((g.at[0] - a[0]) * dx + (g.at[1] - a[1]) * dy) / (len * len);
    const px = a[0] + t * dx, py = a[1] + t * dy;
    if (t > 0 && t < 1 && Math.hypot(px - g.at[0], py - g.at[1]) < 1) {
      const half = g.width / 2 / len; cuts.push([Math.max(0, t - half), Math.min(1, t + half)]);
    }
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const segs = []; let s = 0;
  for (const [c0, c1] of cuts) { if (c0 > s) segs.push([s, c0]); s = c1; }
  if (s < 1) segs.push([s, 1]);
  return segs.map(([t0, t1]) => [a[0] + dx * t0, a[1] + dy * t0, a[0] + dx * t1, a[1] + dy * t1]);
}

export function buildInterior(data) {
  const root = new THREE.Group(); root.name = `interior_${data.building_id}`;
  const h = data.wall_height || 3;
  const shape = new THREE.Shape(data.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false });
  slabGeo.rotateX(-Math.PI / 2);   // (E, N, z) -> (E, z, -N)

  const floors = data.floors.map((f, fi) => {
    const g = new THREE.Group(); g.name = `floor_${f.id}`; g.position.y = f.level;
    // rooms of kind "void" are holes in this floor's slab (double-height space), fenced by a railing
    const voids = f.rooms.filter((r) => r.kind === 'void');
    let geo = slabGeo;
    if (voids.length) {
      const s = new THREE.Shape(data.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const { rect: [x0, y0, x1, y1] } of voids) {
        s.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
      }
      geo = new THREE.ExtrudeGeometry(s, { depth: SLAB, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
    }
    const slab = new THREE.Mesh(geo, mat(0xece6da)); slab.position.y = -SLAB; slab.receiveShadow = true; g.add(slab);

    const extMat = mat(0xe2d6c0);
    const fp = data.footprint;
    for (let i = 0; i < fp.length; i++) {
      for (const [ax, ay, bx, by] of edgeWithGaps(fp[i], fp[(i + 1) % fp.length], f.entrances || [])) {
        const w = wall(ax, ay, bx, by, h, EXT_T, extMat); if (w) g.add(w);
      }
    }

    const labels = [];
    const wallMat = mat(0xf7f3ec);
    for (const r of f.rooms) {
      const [x0, y0, x1, y1] = r.rect;
      if (r.kind === 'void') rectWalls(g, r.rect, 1.1, mat(0xb8bcc2));   // railing
      else floorPatch(g, r.rect, KIND_COLOR[r.kind] ?? KIND_COLOR.room);
      if (!r.open && r.kind !== 'void') {
        // stairwell rooms get a real open door named for their floor, instead of a blank wall
        if (r.kind === 'stair') labels.push(stairDoor(g, r.rect, h, wallMat, f.name_en, f.name_ar));
        else rectWalls(g, r.rect, h, wallMat);
      }
      if (r.split > 1) {
        const alongX = (x1 - x0) >= (y1 - y0);
        for (let k = 1; k < r.split; k++) {
          const w = alongX
            ? wall(x0 + (x1 - x0) * k / r.split, y0, x0 + (x1 - x0) * k / r.split, y1, h, WALL_T, wallMat)
            : wall(x0, y0 + (y1 - y0) * k / r.split, x1, y0 + (y1 - y0) * k / r.split, h, WALL_T, wallMat);
          if (w) g.add(w);
        }
      }
      if (r.kind === 'stair') {
        // the flight rises to the next floor's real level (architecturally consistent with the model)
        const rise = fi < data.floors.length - 1
          ? data.floors[fi + 1].level - f.level
          : (data.floors.length > 1 ? data.floors[1].level - data.floors[0].level : h * 0.85);
        stairs(g, r.rect, rise);
      }
      if (r.kind === 'locker' || r.kind === 'lift') {   // solid blocks: locker rows, lift shafts
        const bh = r.kind === 'locker' ? 1.8 : h;
        const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, bh, y1 - y0), mat(KIND_COLOR[r.kind]));
        b.position.set((x0 + x1) / 2, bh / 2, -(y0 + y1) / 2); b.receiveShadow = true; g.add(b);
      }
      if (r.nolabel) continue;
      const lab = label(r.name_en, r.name_ar, `kind-${r.kind}`);
      lab.position.set((x0 + x1) / 2, h + 0.6, -(y0 + y1) / 2);
      g.add(lab); labels.push(lab);
    }
    for (const e of f.entrances || []) {
      const lab = label(e.name_en, e.name_ar, 'entrance');
      const [ox, oy] = e.label_offset || [-3, 0];   // default: outside a west-facing door
      lab.position.set(e.at[0] + ox, 1.5, -(e.at[1] + oy));
      g.add(lab); labels.push(lab);
    }
    root.add(g);
    return { id: f.id, name_en: f.name_en, name_ar: f.name_ar, level: f.level, group: g, labels };
  });

  // show the chosen floor and the ones below it; upper floors are removed so the cut is visible
  function setFloor(idx) {
    floors.forEach((f, i) => {
      f.group.visible = i <= idx;
      for (const l of f.labels) l.visible = i === idx;
    });
  }

  return { group: root, floors, setFloor };
}

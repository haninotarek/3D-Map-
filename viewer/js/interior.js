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

// A flight of steps along the long side of the stair rect.
// The step layout is shared with route.js (stairProfile) so the walked path follows the drawn steps exactly.
export function stairProfile(rect, rise) {
  const [x0, y0, x1, y1] = rect;
  const n = Math.max(8, Math.round(Math.abs(rise) / 0.22));          // ~22 cm per step
  const alongX = (x1 - x0) >= (y1 - y0);
  const run = (alongX ? x1 - x0 : y1 - y0) / n;
  const width = (alongX ? y1 - y0 : x1 - x0) * 0.45;
  const lane = (alongX ? y0 : x0) + width / 2 + 0.3;                  // the walked lane inside the stairwell
  const steps = [];
  for (let i = 0; i < n; i++) {
    const h = (rise * (i + 1)) / n;                                   // walking surface of step i+1
    const along = (alongX ? x0 : y0) + run * (i + 0.5);
    steps.push({ x: alongX ? along : lane, y: alongX ? lane : along, h });
  }
  return { steps, alongX, n, run, width };
}

function stairs(group, rect, rise) {
  const { steps, alongX, run, width } = stairProfile(rect, rise);
  for (const s of steps) {
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(alongX ? run : width, Math.abs(s.h), alongX ? width : run),
      mat(0xcfc6b6)
    );
    tread.position.set(s.x, s.h / 2, -s.y); tread.receiveShadow = true;
    group.add(tread);
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
      if (!r.open && r.kind !== 'void') rectWalls(g, r.rect, h, wallMat);
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

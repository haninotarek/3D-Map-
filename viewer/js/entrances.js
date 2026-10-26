// Entrance doors for the buildings that have an indoor map. The campus model's facades are solid, so without
// this the guided walker walks straight through a wall. Every entrance listed in data/interiors/*.json
// (floors[0].entrances: { at: [x, y], width }) gets a door assembly on the outside face of its facade: a dark
// doorway, an aluminium frame, a canopy, a wall panel above (seen from inside) and two glass leaves that swing
// open while the walker is near and close again behind it. Coordinates are local ENU metres (x = East,
// y = North); Three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';

const GROUND_Y = 0.03;     // paved plaza surface (route.js OUT_SURFACE_Y)
const DOOR_H = 2.9;        // clear door height
const OPEN_NEAR = 6;       // the leaves open while the walker is this close (m)
const SWING = 1.45;        // fully open leaf angle (rad)

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The facade edge an entrance sits on: the projected point, the unit tangent and the outward normal. */
function facadeAt(footprint, [ex, ey]) {
  let best = null;
  for (let i = 0; i < footprint.length; i++) {
    const [ax, ay] = footprint[i], [bx, by] = footprint[(i + 1) % footprint.length];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ey - ay) * dy) / l2));
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(ex - px, ey - py);
    if (!best || d < best.d) best = { d, px, py, tx: dx / Math.sqrt(l2), ty: dy / Math.sqrt(l2) };
  }
  let nx = best.ty, ny = -best.tx;
  if (pointInPoly(best.px + nx * 0.6, best.py + ny * 0.6, footprint)) { nx = -nx; ny = -ny; }
  return { px: best.px, py: best.py, nx, ny };
}

export function createEntrances(scene) {
  const mat = {
    frame: new THREE.MeshStandardMaterial({ color: 0x5b6470, metalness: 0.55, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa9cfe0, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.4, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.95 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0xece6db, roughness: 0.75 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xeae0ce, roughness: 0.9 }),
  };
  const doors = [];
  const box = (w, h, d, m, x, y, z, parent) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
    parent.add(o); return o;
  };

  /** One glass leaf hung on a pivot at the jamb; `dir` = +1 when the leaf runs +x from its hinge. */
  function leaf(parent, hingeX, dir, w) {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, 0.12);
    const h = DOOR_H - 0.06, cx = dir * w / 2;
    box(w, h, 0.03, mat.glass, cx, h / 2 + 0.03, 0, pivot);
    for (const [ew, eh, ex, ey] of [[w, 0.07, cx, 0.065], [w, 0.07, cx, h - 0.005], [0.06, h, dir * 0.03, h / 2 + 0.03], [0.06, h, dir * (w - 0.03), h / 2 + 0.03]]) {
      box(ew, eh, 0.05, mat.frame, ex, ey, 0, pivot);
    }
    box(0.04, 0.9, 0.06, mat.frame, dir * (w - 0.16), 1.05, 0.06, pivot);   // pull handle
    parent.add(pivot);
    return pivot;
  }

  /** Adds the doors of one building (its interior JSON). */
  function add(data) {
    const fp = data.footprint; const ground = data.floors?.[0];
    if (!fp || !ground) return;
    const wallTop = ground.level + (data.floors[1] ? data.floors[1].level - ground.level : 4.2);
    for (const e of ground.entrances || []) {
      const f = facadeAt(fp, e.at);
      const W = e.width || 3;
      const g = new THREE.Group();
      g.name = `entrance-${data.building_id}-${e.name_en || ''}`;
      g.position.set(f.px + f.nx * 0.04, GROUND_Y, -(f.py + f.ny * 0.04));
      g.rotation.y = Math.atan2(f.nx, -f.ny);   // local +z = outward normal, local +x along the facade
      box(W, DOOR_H, 0.02, mat.dark, 0, DOOR_H / 2, 0, g);                                     // the doorway
      for (const s of [-1, 1]) box(0.14, DOOR_H + 0.14, 0.22, mat.frame, s * (W / 2 + 0.07), (DOOR_H + 0.14) / 2, 0.1, g);
      box(W + 0.28, 0.14, 0.22, mat.frame, 0, DOOR_H + 0.07, 0.1, g);                          // head
      box(W + 1.6, 0.16, 1.7, mat.canopy, 0, DOOR_H + 0.45, 0.85, g);                          // canopy
      box(W + 1.6, 0.06, 0.06, mat.frame, 0, DOOR_H + 0.35, 1.68, g);                          // canopy edge
      // wall over the door: the indoor walls leave the whole entrance open, so close it above the door when inside
      const above = Math.max(0, wallTop - GROUND_Y - (DOOR_H + 0.14));
      const lintel = above > 0.05 ? box(W + 0.3, above, 0.12, mat.wall, 0, DOOR_H + 0.14 + above / 2, -0.07, g) : null;
      if (lintel) lintel.visible = false;
      const lw = W / 2 - 0.02;
      const left = leaf(g, -W / 2, 1, lw), right = leaf(g, W / 2, -1, lw);
      scene.add(g);
      doors.push({ group: g, building: data.building_id, at: [f.px, f.py], left, right, lintel, open: 0 });
    }
  }

  /** Swings the leaves toward open while `walker` (a Vector3, or null) is near; `insideId` is the building the
   *  view is inside (or null). Returns true when something changed. */
  function update(dt, walker, insideId = null) {
    let moving = false;
    for (const d of doors) {
      // inside a building the campus model is hidden, so other buildings' doors would float in the void
      const show = !insideId || d.building === insideId;
      if (d.group.visible !== show) { d.group.visible = show; moving = true; }
      const showLintel = d.building === insideId;
      if (d.lintel && d.lintel.visible !== showLintel) { d.lintel.visible = showLintel; moving = true; }
      const want = walker && Math.hypot(walker.x - d.at[0], -walker.z - d.at[1]) < OPEN_NEAR ? 1 : 0;
      if (Math.abs(d.open - want) < 1e-3) continue;
      d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt * 2.2);
      d.left.rotation.y = -d.open * SWING;    // both leaves swing outward (local +z)
      d.right.rotation.y = d.open * SWING;
      moving = true;
    }
    return moving;
  }

  return { add, update, doors };
}

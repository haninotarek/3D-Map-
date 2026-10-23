// Walking directions: from Gate No. 1 along the campus network (data/campus_paths.json), through real building
// entrances, collision-free academic corridors, switchback staircases, verified landings, and open room doorways.
// Input coordinates are local ENU metres (x = East, y = North); Three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { stairProfile, ARCH_CONSTANTS } from './interior.js';
import { roomCells } from './furniture.js';

const ROUTE_COLOR = 0xff7a1a;
const OUT_SURFACE_Y = 0.03;   // exact paved plaza surface height for walker shoe contact
const FLOOR_PATCH_Y = 0.012;  // exact top surface of interior terrazzo/tile floorPatch in interior.js
const TUBE_LIFT_Y = 0.24;     // visual spline elevation offset ONLY on TubeGeometry (never walker Y!)

const T = {
  en: {
    toBuilding: (b) => `Walk straight to ${b}.`,
    stairsTo: (s, f) => `Enter, and take the ${s} straight up to the ${f}.`,
    nowFloor: (f, side, r) => side === 'straight'
      ? `You are now on the ${f}. Continue straight for ${r}.`
      : `You are now on the ${f}. Turn ${side} for ${r}.`,
    groundTurn: (side, r) => side === 'straight'
      ? `Enter, and continue straight. ${r} is on the ground floor.`
      : `Enter, and turn ${side}. ${r} is on the ground floor.`,
    noStairs: 'A staircase is missing from the indoor map on the way; the climb is shown as estimated.',
    noRoom: (r) => `${r} is not on the indoor map yet. Ask at the building lobby.`,
    noInterior: 'The inside of this building is not mapped yet.',
    estimated: 'The entrance position is estimated.',
    assumed: 'The timetable does not name the building; it was matched by room name.',
    notFound: (b) => `“${b}” is not on the campus map yet.`,
    total: (m, min) => `About ${m} m · ${min} min walk`,
  },
  // One short Egyptian-colloquial instruction per leg — synchronized with pre-rendered SalmaNeural MP3 cues.
  ar: {
    toBuilding: (b) => `صباح الخير يا هندسة. عدّي البوابة الرئيسية، وامشي لحد ما توصل عند ${b}.`,
    stairsTo: (s, f) => `ادخل، واطلع من ${s} لحد ${f} على طول.`,
    nowFloor: (f, side, r) => side === 'straight'
      ? `انت كده في ${f}. كمّل على طول، هتلاقي ${r}.`
      : `انت كده في ${f}. خش ${side === 'left' ? 'شمال' : 'يمين'}، هتلاقي ${r}.`,
    groundTurn: (side, r) => side === 'straight'
      ? `ادخل، وكمّل على طول. ${r} هنا في الأرضي.`
      : `ادخل، وخش ${side === 'left' ? 'شمال' : 'يمين'}. ${r} هنا في الأرضي.`,
    noStairs: 'السلم مش مرسوم هنا، الطلوع تقريبي.',
    noRoom: (r) => `${r} لسه مش على الخريطة. اسأل في اللوبي.`,
    noInterior: 'المبنى ده لسه ملوش خريطة من جوّه.',
    estimated: 'مكان الباب تقريبي.',
    assumed: 'المبنى اتحدد من اسم القاعة.',
    notFound: (b) => `«${b}» لسه مش على الخريطة.`,
    total: (m, min) => `حوالي ${m} م · ${min} دقيقة مشي`,
  },
};

const v3 = ([x, y], h = OUT_SURFACE_Y) => new THREE.Vector3(x, h, -y);
const centre = ([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '');

/** ENU turn at `via` while walking from -> via -> to: positive cross product = left. */
function turnSide(from, via, to) {
  const hx = via[0] - from[0], hy = via[1] - from[1];
  const vx = to[0] - via[0], vy = to[1] - via[1];
  const den = Math.hypot(hx, hy) * Math.hypot(vx, vy);
  if (!den) return 'straight';
  const sin = (hx * vy - hy * vx) / den, cos = (hx * vx + hy * vy) / den;
  if (sin > 0.15) return 'left';
  if (sin < -0.15) return 'right';
  return cos < 0 ? (sin >= 0 ? 'left' : 'right') : 'straight';
}
const turnCue = (side) => (side === 'left' ? 'turn_left' : side === 'right' ? 'turn_right' : 'go_straight');

function stairSide(stair, north) {
  const name = `${stair?.name_en || ''} ${stair?.name_ar || ''}`;
  if (/left|شمال|الأيسر/i.test(name)) return 'left';
  if (/right|يمين|الأيمن/i.test(name)) return 'right';
  return north ? 'left' : 'right';
}

function shortestPath(net, from, to) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const todo = new Set(Object.keys(net.nodes));
  const adj = new Map();
  for (const [a, b] of net.edges) {
    const d = Math.hypot(net.nodes[a][0] - net.nodes[b][0], net.nodes[a][1] - net.nodes[b][1]);
    (adj.get(a) || adj.set(a, []).get(a)).push([b, d]);
    (adj.get(b) || adj.set(b, []).get(b)).push([a, d]);
  }
  while (todo.size) {
    let u = null;
    for (const n of todo) if (dist.has(n) && (u === null || dist.get(n) < dist.get(u))) u = n;
    if (u === null || u === to) break;
    todo.delete(u);
    for (const [w, d] of adj.get(u) || []) {
      const nd = dist.get(u) + d;
      if (!dist.has(w) || nd < dist.get(w)) { dist.set(w, nd); prev.set(w, u); }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path;
}

function stairDoor(rect) {
  const [x0, y0, x1, y1] = rect;
  return (x1 - x0) >= (y1 - y0) ? [x1, (y0 + y1) / 2] : [(x0 + x1) / 2, y1];
}

// Primary open double-doorway threshold and interior arrival point for any destination room
function roomDoorPortal(r) {
  const cells = roomCells(r);
  const [cx0, cy0, cx1, cy1] = cells[0];
  const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
  const side = r.door;
  if (side === 'n') return { outside: [mx, cy1 + 1.15], threshold: [mx, cy1], inside: [mx, Math.max(cy0 + 1.3, cy1 - 2.1)] };
  if (side === 's') return { outside: [mx, cy0 - 1.15], threshold: [mx, cy0], inside: [mx, Math.min(cy1 - 1.3, cy0 + 2.1)] };
  if (side === 'e') return { outside: [cx1 + 1.15, my], threshold: [cx1, my], inside: [Math.max(cx0 + 1.3, cx1 - 2.1), my] };
  if (side === 'w') return { outside: [cx0 - 1.15, my], threshold: [cx0, my], inside: [Math.min(cx1 - 1.3, cx0 + 2.1), my] };
  return { outside: [mx, my], threshold: [mx, my], inside: [mx, my] };
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Exact obstacle field for a building floor: walls, closed rooms, lifts, atrium voids, and split partitions
function buildFloorObstacleField(interiorData, floorData, allowedRoomIds = new Set()) {
  const segs = [];
  const boxes = [];
  const fp = interiorData.footprint;
  const entrances = floorData.entrances || [];

  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const cuts = [];
    for (const ent of entrances) {
      const t = ((ent.at[0] - a[0]) * dx + (ent.at[1] - a[1]) * dy) / (len * len);
      const px = a[0] + t * dx, py = a[1] + t * dy;
      if (t > 0 && t < 1 && Math.hypot(px - ent.at[0], py - ent.at[1]) < 1.2) {
        const half = (ent.width / 2) / len;
        cuts.push([Math.max(0, t - half), Math.min(1, t + half)]);
      }
    }
    cuts.sort((u, v) => u[0] - v[0]);
    let s = 0;
    for (const [c0, c1] of cuts) {
      if (c0 > s) segs.push([a[0] + dx * s, a[1] + dy * s, a[0] + dx * c0, a[1] + dy * c0]);
      s = c1;
    }
    if (s < 1) segs.push([a[0] + dx * s, a[1] + dy * s, a[0] + dx * 1, a[1] + dy * 1]);
  }

  for (const r of floorData.rooms) {
    if (r.open) continue;
    const [x0, y0, x1, y1] = r.rect;
    if (r.kind === 'lift' || r.kind === 'void' || r.kind === 'locker' || !allowedRoomIds.has(r.id)) {
      boxes.push([x0, y0, x1, y1]);
      continue;
    }
    const edges = { s: [x0, y0, x1, y0], e: [x1, y0, x1, y1], n: [x1, y1, x0, y1], w: [x0, y1, x0, y0] };
    let doorSide = r.door, doorAt = null, doorW = ARCH_CONSTANTS.DOOR_W;
    if (r.kind === 'stair') {
      doorSide = (x1 - x0) >= (y1 - y0) ? 'e' : 'n';
      doorAt = stairDoor(r.rect);
      doorW = 1.25;
    } else if (r.door) {
      doorAt = roomDoorPortal(r).threshold;
      doorW = Math.min(ARCH_CONSTANTS.DOOR_W, Math.max(0.95, Math.min(x1 - x0, y1 - y0) * 0.55));
    }
    for (const [side, [ax, ay, bx, by]] of Object.entries(edges)) {
      if (side === doorSide && doorAt) {
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const t = ((doorAt[0] - ax) * dx + (doorAt[1] - ay) * dy) / (len * len);
        const half = (doorW / 2) / len;
        const c0 = Math.max(0, t - half), c1 = Math.min(1, t + half);
        if (c0 > 0.01) segs.push([ax, ay, ax + dx * c0, ay + dy * c0]);
        if (c1 < 0.99) segs.push([ax + dx * c1, ay + dy * c1, bx, by]);
      } else {
        segs.push([ax, ay, bx, by]);
      }
    }
    if (r.split > 1) {
      const alongX = (x1 - x0) >= (y1 - y0);
      for (let k = 1; k < r.split; k++) {
        segs.push(alongX
          ? [x0 + (x1 - x0) * (k / r.split), y0, x0 + (x1 - x0) * (k / r.split), y1]
          : [x0, y0 + (y1 - y0) * (k / r.split), x1, y0 + (y1 - y0) * (k / r.split)]);
      }
    }
  }

  function clearanceAt(x, y) {
    if (!pointInPolygon(x, y, fp)) return -1;
    let minD = 99;
    for (const [bx0, by0, bx1, by1] of boxes) {
      if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) return -1;
      minD = Math.min(minD, Math.hypot(Math.max(bx0 - x, 0, x - bx1), Math.max(by0 - y, 0, y - by1)));
    }
    for (const [ax, ay, bx, by] of segs) minD = Math.min(minD, distToSegment(x, y, ax, ay, bx, by));
    return minD;
  }

  function segmentClear(a, b, minClear = 0.42) {
    const n = Math.max(2, Math.ceil(dist2(a, b) / 0.22));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (clearanceAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < minClear) return false;
    }
    return true;
  }

  return { clearanceAt, segmentClear };
}

// Deterministic 0.5m A* corridor pathfinder + visibility string-pulling smoother
function planCollisionFreeWalk(interiorData, floorData, startXY, goalXY, allowedRoomIds = new Set()) {
  const field = buildFloorObstacleField(interiorData, floorData, allowedRoomIds);
  if (field.segmentClear(startXY, goalXY, 0.55)) return [startXY, goalXY];

  const fp = interiorData.footprint;
  const xs = fp.map((p) => p[0]), ys = fp.map((p) => p[1]);
  const STEP = 0.5;
  const minX = Math.floor(Math.min(...xs)) - 1, maxX = Math.ceil(Math.max(...xs)) + 1;
  const minY = Math.floor(Math.min(...ys)) - 1, maxY = Math.ceil(Math.max(...ys)) + 1;
  const nx = Math.round((maxX - minX) / STEP) + 1;
  const ny = Math.round((maxY - minY) / STEP) + 1;
  const toCell = ([x, y]) => [
    Math.max(0, Math.min(nx - 1, Math.round((x - minX) / STEP))),
    Math.max(0, Math.min(ny - 1, Math.round((y - minY) / STEP))),
  ];
  const toWorld = (ix, iy) => [minX + ix * STEP, minY + iy * STEP];
  const idxOf = (ix, iy) => iy * nx + ix;

  const clear = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [wx, wy] = toWorld(ix, iy);
      clear[idxOf(ix, iy)] = field.clearanceAt(wx, wy);
    }
  }

  const snapFree = (pt) => {
    const [sx, sy] = toCell(pt);
    if (clear[idxOf(sx, sy)] >= 0.40) return [sx, sy];
    for (let rad = 1; rad <= 8; rad++) {
      let best = null, bestC = -1;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const ix = sx + dx, iy = sy + dy;
          if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
          const c = clear[idxOf(ix, iy)];
          if (c > bestC) { bestC = c; best = [ix, iy]; }
        }
      }
      if (best && bestC >= 0.35) return best;
    }
    return [sx, sy];
  };

  const [sx, sy] = snapFree(startXY);
  const [gx, gy] = snapFree(goalXY);
  const startId = idxOf(sx, sy), goalId = idxOf(gx, gy);

  const gScore = new Float32Array(nx * ny).fill(Infinity);
  const parent = new Int32Array(nx * ny).fill(-1);
  const closed = new Uint8Array(nx * ny);
  gScore[startId] = 0;

  const heap = [[Math.hypot(gx - sx, gy - sy) * STEP, startId]];
  const pushHeap = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const popHeap = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let l = i * 2 + 1, r = l + 1, sm = i;
        if (l < heap.length && heap[l][0] < heap[sm][0]) sm = l;
        if (r < heap.length && heap[r][0] < heap[sm][0]) sm = r;
        if (sm === i) break;
        [heap[i], heap[sm]] = [heap[sm], heap[i]];
        i = sm;
      }
    }
    return top;
  };

  const DIRS = [
    [1, 0, STEP], [-1, 0, STEP], [0, 1, STEP], [0, -1, STEP],
    [1, 1, STEP * Math.SQRT2], [1, -1, STEP * Math.SQRT2], [-1, 1, STEP * Math.SQRT2], [-1, -1, STEP * Math.SQRT2],
  ];

  while (heap.length) {
    const [, cur] = popHeap();
    if (closed[cur]) continue;
    if (cur === goalId) break;
    closed[cur] = 1;
    const cx = cur % nx, cy = (cur / nx) | 0;
    for (const [dx, dy, baseCost] of DIRS) {
      const tx = cx + dx, ty = cy + dy;
      if (tx < 0 || ty < 0 || tx >= nx || ty >= ny) continue;
      const nid = idxOf(tx, ty);
      if (closed[nid]) continue;
      const cVal = clear[nid];
      if (cVal < 0.35) continue;
      const wallBias = cVal < 1.35 ? (1.35 - cVal) * 0.65 : 0;
      const tentative = gScore[cur] + baseCost * (1 + wallBias);
      if (tentative < gScore[nid]) {
        gScore[nid] = tentative;
        parent[nid] = cur;
        pushHeap([tentative + Math.hypot(gx - tx, gy - ty) * STEP, nid]);
      }
    }
  }

  if (parent[goalId] === -1 && startId !== goalId) return [startXY, goalXY];

  const raw = [];
  let cur = goalId;
  while (cur !== -1) {
    raw.push(toWorld(cur % nx, (cur / nx) | 0));
    if (cur === startId) break;
    cur = parent[cur];
  }
  raw.reverse();
  raw[0] = startXY;
  raw[raw.length - 1] = goalXY;

  const smooth = [raw[0]];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let farthest = anchor + 1;
    for (let probe = raw.length - 1; probe > anchor + 1; probe--) {
      if (field.segmentClear(raw[anchor], raw[probe], 0.44)) {
        farthest = probe;
        break;
      }
    }
    smooth.push(raw[farthest]);
    anchor = farthest;
  }
  return smooth;
}

export function createRouter({ scene, getItem, getInterior, net, index }) {
  const group = new THREE.Group();
  group.name = 'route';
  scene.add(group);
  let curve = null, length = 0, outdoorTube = null, indoorTube = null;
  let destHighlight = null, destPin = null, destFloorIndex = -1, indoorActive = false;

  function syncDestVisibility(activeFloor = null) {
    const show = !indoorActive || activeFloor === null || activeFloor === destFloorIndex;
    if (destHighlight) destHighlight.visible = show;
    if (destPin) destPin.visible = show;
  }

  function clear() {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((c) => {
        c.geometry?.dispose();
        c.material?.dispose?.();
        if (c.element) c.element.remove();
      });
    }
    curve = null; length = 0; outdoorTube = null; indoorTube = null;
    destHighlight = null; destPin = null; destFloorIndex = -1; indoorActive = false;
  }

  function setIndoorMode(on, activeFloor = null) {
    indoorActive = !!on;
    if (outdoorTube) outdoorTube.visible = !on;
    if (indoorTube) indoorTube.visible = !on;
    syncDestVisibility(activeFloor);
  }

  /** Resolves timetable names (with flexible colon/space matching) to {buildingId, assumed, floorId, roomId}. */
  function resolve(building, room) {
    let buildingId = index.buildings[building] || index.buildings[String(building || '').trim()] || null;
    if (!buildingId && building) {
      const hitB = Object.entries(index.buildings).find(([k]) => alnum(k) === alnum(building));
      if (hitB) buildingId = hitB[1];
    }
    if (!buildingId && building && getItem(building)) buildingId = building;
    let assumed = false;
    if (!buildingId && room) {
      const hit = Object.entries(index.unassigned || {}).find(([k]) => alnum(k) === alnum(room) || norm(k) === norm(room));
      if (hit) { buildingId = hit[1]; assumed = true; }
    }
    let target = null;
    if (buildingId && room) {
      const rooms = index.rooms[buildingId] || {};
      const hit = Object.entries(rooms).find(([k]) => alnum(k) === alnum(room) || norm(k) === norm(room));
      if (hit) target = hit[1];
    }
    return { buildingId, assumed, floorId: target?.floor ?? null, roomId: target?.room ?? null };
  }

  function marker(text, cls, pos) {
    const el = document.createElement('div');
    el.className = 'route-pin ' + cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    group.add(o);
    return o;
  }

  async function show({ building, room, lang = 'en', roomLabel }) {
    clear();
    const t = T[lang] || T.en;
    const r = resolve(building, room);
    const it = r.buildingId ? getItem(r.buildingId) : null;
    if (!it) return { ok: false, steps: [t.notFound(building || room || '?')] };

    const bName = lang === 'ar' ? (it.info.name_ar || it.info.name_en) : it.info.name_en;
    const door = net.doors[r.buildingId];
    const steps = [];
    const cues = [];
    const track = [];
    const notes = [];
    const addStep = (text, cue = null) => { steps.push(text); cues.push(cue); };
    const add = (p, h, step, floor, kind, extra = null) => track.push({ p: v3(p, h), step, floor, kind, ...extra });

    const buildingCue = { bld_e2: 'go_eng1', bld_e1: 'go_eng2' }[r.buildingId] || 'gate';
    addStep(t.toBuilding(bName), ['greeting_gate', buildingCue]);

    // Pre-fetch interior before finalizing threshold approach so outer door threshold aligns cleanly
    let interior = null;
    if (it.info.interior && room) {
      interior = await getInterior(it);
    }

    const nodes = door ? shortestPath(net, net.start, door.node) : null;
    const groundEnt = interior?.data?.floors?.[0]?.entrances?.[0];
    const outerThreshold = groundEnt ? [groundEnt.at[0] - 2.4, groundEnt.at[1]] : (door ? door.at : [it.center.x, -it.center.z]);

    if (nodes) {
      const seq = [net.nodes.gate_out, ...nodes.map((n) => net.nodes[n]), outerThreshold];
      seq.forEach((p) => add(p, OUT_SURFACE_Y, 0, -1, 'out'));
      if (door.estimated) notes.push(t.estimated);
    } else {
      add(net.nodes.gate_out, OUT_SURFACE_Y, 0, -1, 'out');
      add(outerThreshold, OUT_SURFACE_Y, 0, -1, 'out');
    }
    if (r.assumed) notes.push(t.assumed);

    // Indoor multi-floor collision-free leg
    let floorIndex = -1;
    let targetRect = null, targetLevel = 0;

    if (interior && room) {
      const data = interior.data;
      floorIndex = r.floorId != null
        ? (typeof r.floorId === 'number' ? r.floorId : data.floors.findIndex((fl) => String(fl.id) === String(r.floorId)))
        : -1;
      const ground = data.floors[0];
      const entrance = ground.entrances?.[0];
      const roomName = roomLabel || room;

      if (floorIndex >= 0 && entrance) {
        const f = data.floors[floorIndex];
        const target = f?.rooms.find((x) => x.id === r.roomId);
        if (!target) {
          addStep(t.noRoom(roomName), null);
        } else {
          targetRect = target.rect;
          targetLevel = f.level;
          const [tx, ty] = centre(target.rect);
          const gy = ground.level + FLOOR_PATCH_Y;
          const insideVestibule = [entrance.at[0] + 2.2, entrance.at[1]];
          const portal = roomDoorPortal(target);

          if (floorIndex > 0) {
            const gSpine = ground.rooms.find((x) => x.id === 'spine' || x.id === 'lobby');
            const north = ty > (gSpine ? centre(gSpine.rect)[1] : entrance.at[1]);
            const stairId = north ? 'stair_n' : 'stair_s';
            const groundStair = ground.rooms.find((x) => x.id === stairId);
            const side = stairSide(groundStair, north);
            const stairName = lang === 'ar'
              ? `السلم اللي على ${side === 'left' ? 'الشمال' : 'اليمين'}`
              : (groundStair ? groundStair.name_en.toLowerCase() : `${side} stair`);
            const floorName = lang === 'ar' ? f.name_ar : f.name_en.toLowerCase();
            const fy = f.level + FLOOR_PATCH_Y;

            const floorLobby = f.rooms.find((x) => x.id === (north ? 'lobby_n' : 'lobby_s'));
            const foyer = f.rooms.find((x) => x.id === `${target.id}_foyer`);
            const topStair = data.floors[floorIndex - 1]?.rooms.find((x) => x.id === stairId) || groundStair;
            const turn = turnSide(
              topStair ? [topStair.rect[2] + 1, centre(topStair.rect)[1]] : entrance.at,
              floorLobby ? centre(floorLobby.rect) : portal.outside,
              foyer ? centre(foyer.rect) : portal.outside,
            );

            const climbStep = steps.length;
            const directStairCue = floorIndex >= 1 && floorIndex <= 3
              ? `stairs_${side}_floor_${floorIndex}`
              : [`stairs_${side}`, `upto_floor_${floorIndex}`];
            addStep(t.stairsTo(stairName, floorName), directStairCue);

            const floorStep = steps.length;
            addStep(
              t.nowFloor(floorName, turn, roomName),
              [floorIndex >= 1 && floorIndex <= 3 ? `floor_${floorIndex}` : 'gen_room', turnCue(turn)],
            );

            // 1. Threshold entrance doorway crossing (`ENTERING_DOOR` has 4.6m physical span — never skipped!)
            add(entrance.at, gy, climbStep, 0, 'door');
            add(insideVestibule, gy, climbStep, 0, 'door');

            // 2. Complete Ground-Floor corridor/atrium path to stairwell approach
            const [sx0, sy0, sx1, sy1] = groundStair.rect;
            const gProf = stairProfile(groundStair.rect, data.floors[1].level - ground.level);
            const stairDoorOut = gProf.alongX ? [sx1 + 1.15, (sy0 + sy1) / 2] : [(sx0 + sx1) / 2, sy1 + 1.15];
            const gWalk = planCollisionFreeWalk(data, ground, insideVestibule, stairDoorOut, new Set([stairId]));
            for (let wi = 1; wi < gWalk.length - 1; wi++) {
              add(gWalk[wi], gy, climbStep, 0, 'in');
            }

            // 3. Multi-storey tread-by-tread climb with verified floor landings
            let blocked = false;
            for (let k = 0; k < floorIndex && !blocked; k++) {
              const fk = data.floors[k], fk1 = data.floors[k + 1];
              const stair = fk.rooms.find((x) => x.id === stairId);
              if (!stair) { blocked = true; break; }
              const [rx0, ry0, rx1, ry1] = stair.rect;
              const rise = fk1.level - fk.level;
              const prof = stairProfile(stair.rect, rise);
              const pt = (along, cross) => (prof.alongX ? [along, cross] : [cross, along]);
              const along1 = prof.alongX ? rx1 : ry1;
              const doorOut = prof.alongX ? [rx1 + 1.15, (ry0 + ry1) / 2] : [(rx0 + rx1) / 2, ry1 + 1.15];

              if (k === 0) {
                // Explicit `APPROACHING_STAIRS` doorway entry before first stair tread
                add(doorOut, fk.level + FLOOR_PATCH_Y, climbStep, k, 'stair_approach');
                add(pt(along1 - 0.65, prof.laneA), fk.level + FLOOR_PATCH_Y, climbStep, k, 'stair_approach');
              }

              // Step-by-step switchback ascent along exact tread elevations `fk.level + st.h`
              for (const st of prof.walk) {
                add([st.x, st.y], fk.level + st.h, climbStep, k, 'stair');
              }

              const landY = fk1.level + FLOOR_PATCH_Y;
              if (k + 1 < floorIndex) {
                // Verified intermediate landing inside stairwell shaft (midOutside === 0!)
                add(pt(along1 - 0.65, prof.laneB), landY, climbStep, k + 1, 'landing', { verifiedLanding: k + 1 });
                add(pt(along1 - 0.65, prof.laneA), landY, climbStep, k + 1, 'landing', { verifiedLanding: k + 1 });
              } else {
                // Verified destination floor landing -> step cleanly out stairwell doorway
                add(pt(along1 - 0.55, (prof.laneA + prof.laneB) / 2), landY, climbStep, k + 1, 'landing', { verifiedLanding: k + 1 });
                add(doorOut, landY, floorStep, k + 1, 'landing', { verifiedLanding: k + 1 });
              }
            }
            if (blocked) notes.push(t.noStairs);

            // 4. Collision-free Destination-Floor corridor traversal -> open doorway -> inside room
            const destStair = f.rooms.find((x) => x.id === stairId) || groundStair;
            const [dx0, dy0, dx1, dy1] = destStair.rect;
            const dAlongX = (dx1 - dx0) >= (dy1 - dy0);
            const destDoorOut = dAlongX ? [dx1 + 1.15, (dy0 + dy1) / 2] : [(dx0 + dx1) / 2, dy1 + 1.15];
            const dWalk = planCollisionFreeWalk(data, f, destDoorOut, portal.outside, new Set([target.id, stairId]));
            for (let wi = 1; wi < dWalk.length; wi++) {
              add(dWalk[wi], fy, floorStep, floorIndex, 'in');
            }
            add(portal.threshold, fy, floorStep, floorIndex, 'in');
            add(portal.inside, fy, floorStep, floorIndex, 'in');
          } else {
            // Ground-floor destination: doorway entry -> collision-free ground corridors -> open room doorway -> inside room
            const gWalk = planCollisionFreeWalk(data, ground, insideVestibule, portal.outside, new Set([target.id]));
            const turnRef = gWalk.length > 2 ? gWalk[1] : portal.outside;
            const turn = turnSide(entrance.at, insideVestibule, turnRef);
            const groundStep = steps.length;
            addStep(t.groundTurn(turn, roomName), ['enter', turnCue(turn)]);

            add(entrance.at, gy, groundStep, 0, 'door');
            add(insideVestibule, gy, groundStep, 0, 'door');
            for (let wi = 1; wi < gWalk.length; wi++) {
              add(gWalk[wi], gy, groundStep, 0, 'in');
            }
            add(portal.threshold, gy, groundStep, 0, 'in');
            add(portal.inside, gy, groundStep, 0, 'in');
          }
        }
      } else {
        addStep(t.noRoom(roomName), null);
      }
    } else if (room) {
      notes.push(t.noInterior);
    }

    // Visual route tubes (lifted slightly above ground ONLY for visual tube mesh; hidden automatically inside buildings)
    const pts = track.map((x) => x.p);
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    }
    curve = path;
    length = path.getLength();

    const makeTube = (points, name) => {
      const sub = new THREE.CurvePath();
      for (let i = 1; i < points.length; i++) {
        if (points[i].distanceTo(points[i - 1]) > 0.01) {
          const p0 = points[i - 1].clone(); p0.y += TUBE_LIFT_Y;
          const p1 = points[i].clone(); p1.y += TUBE_LIFT_Y;
          sub.add(new THREE.LineCurve3(p0, p1));
        }
      }
      if (!sub.curves.length) return null;
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(sub, Math.max(32, Math.round(sub.getLength() / 2)), 0.42, 8, false),
        new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.85, depthTest: false }),
      );
      mesh.name = name;
      mesh.renderOrder = 20;
      group.add(mesh);
      return mesh;
    };

    const firstIndoor = track.findIndex((x) => x.kind !== 'out');
    if (firstIndoor > 0) {
      outdoorTube = makeTube(track.slice(0, firstIndoor + 1).map((x) => x.p), 'route-outdoor');
      indoorTube = makeTube(track.slice(firstIndoor).map((x) => x.p), 'route-indoor');
    } else if (firstIndoor === 0) {
      indoorTube = makeTube(pts, 'route-indoor');
    } else {
      outdoorTube = makeTube(pts, 'route-outdoor');
    }

    // Subtle architectural highlight around destination room (only shown on campus or once reaching destination floor!)
    destFloorIndex = floorIndex;
    const end = pts[pts.length - 1];
    if (targetRect) {
      const [x0, y0, x1, y1] = targetRect;
      const hlGroup = new THREE.Group();
      hlGroup.name = 'dest-highlight';
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(x1 - x0 - 0.3, 2.5, y1 - y0 - 0.3),
        new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.14, depthWrite: false }),
      );
      box.position.set((x0 + x1) / 2, targetLevel + 1.3, -(y0 + y1) / 2);
      box.renderOrder = 18;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: ROUTE_COLOR }));
      edges.position.copy(box.position);
      hlGroup.add(box, edges);
      group.add(hlGroup);
      destHighlight = hlGroup;
    }
    destPin = marker(roomLabel || room || bName, 'end', end.clone().setY(end.y + 2.8));

    const bounds = new THREE.Box3().setFromPoints(pts);
    const totalM = Math.round(length / 10) * 10;
    return {
      ok: true,
      buildingId: r.buildingId,
      floorIndex,
      steps,
      cues,
      notes,
      bounds,
      track,
      lang,
      summary: t.total(totalM, Math.max(1, Math.round(length / 75))),
    };
  }

  return { show, clear, resolve, setIndoorMode, get active() { return !!curve; } };
}

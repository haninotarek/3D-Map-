// Walking directions: from Gate No. 1 along the indicative campus network (data/campus_paths.json),
// into a building and, where an interior exists, up the stairs to a room.
// Input coordinates are local ENU metres (x = East, y = North); three.js uses x = East, z = -North, y = up.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { stairProfile } from './interior.js';

const ROUTE_COLOR = 0xff7a1a;
const GROUND_Y = 0.9;

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
  // One short colloquial instruction per leg — no repetition between legs.
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

const v3 = ([x, y], h = GROUND_Y) => new THREE.Vector3(x, h, -y);
const centre = ([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2];
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
const turnCue = (side) => side === 'left' ? 'turn_left' : side === 'right' ? 'turn_right' : 'go_straight';
/** The interior data names its stairs ("Left stair" / «السلم الشمال»); fall back to the north/south choice. */
function stairSide(stair, north) {
  const name = `${stair?.name_en || ''} ${stair?.name_ar || ''}`;
  if (/left|شمال/i.test(name)) return 'left';
  if (/right|يمين/i.test(name)) return 'right';
  return north ? 'left' : 'right';
}

function shortestPath(net, from, to) {
  const dist = new Map([[from, 0]]); const prev = new Map(); const todo = new Set(Object.keys(net.nodes));
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

export function createRouter({ scene, getItem, getInterior, net, index }) {
  const group = new THREE.Group(); group.name = 'route'; scene.add(group);
  let curve = null, length = 0, outdoorTube = null, indoorTube = null;

  function clear() {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose?.(); if (c.element) c.element.remove(); });
    }
    curve = null; length = 0; outdoorTube = null; indoorTube = null;
  }

  /** Once the walker is inside, the whole route line disappears: the camera is framed on the
   *  walker himself, and the glowing destination room is the only marker left on screen. */
  function setIndoorMode(on) {
    if (outdoorTube) outdoorTube.visible = !on;
    if (indoorTube) indoorTube.visible = !on;
  }

  /** Resolves timetable names to {buildingId, assumed, roomKey, floorId, roomId}. */
  function resolve(building, room) {
    let buildingId = index.buildings[building] || index.buildings[String(building || '').trim()] || null;
    if (!buildingId && building && getItem(building)) buildingId = building;   // a model id was passed directly
    let assumed = false;
    if (!buildingId && room) {
      const hit = Object.entries(index.unassigned || {}).find(([k]) => norm(k) === norm(room));
      if (hit) { buildingId = hit[1]; assumed = true; }
    }
    let target = null;
    if (buildingId && room) {
      const rooms = index.rooms[buildingId] || {};
      const hit = Object.entries(rooms).find(([k]) => norm(k) === norm(room));
      if (hit) target = hit[1];
    }
    return { buildingId, assumed, floorId: target?.floor ?? null, roomId: target?.room ?? null };
  }

  function marker(text, cls, pos) {
    const el = document.createElement('div'); el.className = 'route-pin ' + cls; el.textContent = text;
    const o = new CSS2DObject(el); o.position.copy(pos); group.add(o); return o;
  }

  /**
   * Builds the route and returns {ok, buildingId, floorIndex, steps[], notes[], summary, bounds, track, cues[]} (or ok: false).
   * track: the walk as points with, for each point, the step being followed while walking to it, the interior floor
   * shown (-1 = outside) and the segment kind ('out' | 'in' | 'stair'); used by the guided tour.
   * cues: parallel to steps — a pre-rendered cue id, or an ordered fragment sequence, per step (null = dynamic text only).
   */
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
    const add = (p, h, step, floor, kind) => track.push({ p: v3(p, h), step, floor, kind });
    // Outdoor leg = ONE instruction: greeting at the main gate, then walk straight to the named building.
    // Model ids run opposite to the building names: bld_e2 is Engineering Building 1, bld_e1 is Building 2.
    const buildingCue = { bld_e2: 'go_eng1', bld_e1: 'go_eng2' }[r.buildingId] || 'gate';
    addStep(t.toBuilding(bName), ['greeting_gate', buildingCue]);
    const nodes = door ? shortestPath(net, net.start, door.node) : null;
    if (nodes) {
      const seq = [net.nodes.gate_out, ...nodes.map((n) => net.nodes[n]), door.at];
      seq.forEach((p) => add(p, GROUND_Y, 0, -1, 'out'));
      if (door.estimated) notes.push(t.estimated);
    } else {
      add(net.nodes.gate_out, GROUND_Y, 0, -1, 'out');
      add([it.center.x, -it.center.z], GROUND_Y, 0, -1, 'out');
    }
    if (r.assumed) notes.push(t.assumed);

    // indoor leg
    let floorIndex = -1;
    let targetRect = null, targetLevel = 0;
    if (it.info.interior && room) {
      const interior = await getInterior(it);
      const data = interior.data;
      floorIndex = r.floorId != null ? data.floors.findIndex((f) => f.id === r.floorId) : -1;
      const ground = data.floors[0];
      const entrance = ground.entrances?.[0];
      const roomName = roomLabel || room;
      if (floorIndex >= 0 && entrance) {
        const f = data.floors[floorIndex];
        const target = f.rooms.find((x) => x.id === r.roomId);
        targetRect = target.rect; targetLevel = f.level;
        const [tx, ty] = centre(target.rect);
        const gLobby = ground.rooms.find((x) => x.id === 'lobby');
        const gy = ground.level + 0.3;
        if (floorIndex > 0) {
          // Direct climb: choose the stair side for this room and go straight to its floor.
          // Every intermediate floor (including the first) is passed silently.
          const north = ty > (gLobby ? centre(gLobby.rect)[1] : entrance.at[1]);
          const stairId = north ? 'stair_n' : 'stair_s';
          const groundStair = ground.rooms.find((x) => x.id === stairId);
          const side = stairSide(groundStair, north);
          const stairName = lang === 'ar'
            ? `السلم اللي على ${side === 'left' ? 'الشمال' : 'اليمين'}`
            : (groundStair ? groundStair.name_en.toLowerCase() : `${side} stair`);
          const floorName = lang === 'ar' ? f.name_ar : f.name_en.toLowerCase();
          const fy = f.level + 0.3;
          const floorLobby = f.rooms.find((x) => x.id === (north ? 'lobby_n' : 'lobby_s'));
          const foyer = f.rooms.find((x) => x.id === `${target.id}_foyer`);
          const topStair = data.floors[floorIndex - 1]?.rooms.find((x) => x.id === stairId) || groundStair;
          const turn = turnSide(
            topStair ? [topStair.rect[2] + 1, centre(topStair.rect)[1]] : entrance.at,
            floorLobby ? centre(floorLobby.rect) : [tx, ty],
            foyer ? centre(foyer.rect) : [tx, ty]);
          const climbStep = steps.length;
          const directStairCue = floorIndex >= 1 && floorIndex <= 3
            ? `stairs_${side}_floor_${floorIndex}`
            : [`stairs_${side}`, `upto_floor_${floorIndex}`];
          addStep(t.stairsTo(stairName, floorName), directStairCue);
          const floorStep = steps.length;
          addStep(t.nowFloor(floorName, turn, roomName),
            [floorIndex >= 1 && floorIndex <= 3 ? `floor_${floorIndex}` : 'gen_room', turnCue(turn)]);
          add(entrance.at, gy, climbStep, 0, 'in');
          if (gLobby) add(centre(gLobby.rect), gy, climbStep, 0, 'in');
          let blocked = false;
          for (let k = 0; k < floorIndex && !blocked; k++) {
            const fk = data.floors[k], fk1 = data.floors[k + 1];
            const stair = fk.rooms.find((x) => x.id === stairId);
            if (!stair) { blocked = true; break; }
            const [sx, sy] = centre(stair.rect);
            const rise = fk1.level - fk.level;
            const prof = stairProfile(stair.rect, rise);
            const [rx0, ry0, rx1, ry1] = stair.rect;
            const pt = (along, cross) => prof.alongX ? [along, cross] : [cross, along];
            const along1 = prof.alongX ? rx1 : ry1;
            const doorOut = prof.alongX ? [rx1 + 1, sy] : [sx, ry1 + 1];   // just outside that floor's stair door
            if (k === 0) {
              // in through the open ground-floor stair door, onto the first flight
              add(doorOut, fk.level + 0.3, climbStep, k, 'in');
              add(pt(along1 - 0.65, prof.laneA), fk.level + 0.3, climbStep, k, 'in');
            }
            // one switchback storey: up flight A, turn on the half-landing, up flight B —
            // the walked points follow the drawn treads exactly (stairProfile.walk)
            for (const st of prof.walk) add([st.x, st.y], fk.level + st.h, climbStep, k, 'stair');
            const landY = fk1.level + 0.3;
            if (k + 1 < floorIndex) {
              // Arrive on the next floor's landing and pass its named door without entering
              // the floor: cross in front of the door to the next flight and climb straight
              // on — one continuous, realistic ascent to the destination floor.
              add(pt(along1 - 0.65, prof.laneB), landY, climbStep, k + 1, 'in');
              add(pt(along1 - 0.65, prof.laneA), landY, climbStep, k + 1, 'in');
            } else {
              // destination floor: out through its open stair door towards the room
              add(doorOut, landY, climbStep, k + 1, 'in');
            }
          }
          if (blocked) notes.push(t.noStairs);
          // the destination-floor instruction starts as the walker leaves the stairwell for the room
          if (floorLobby) add(centre(floorLobby.rect), fy, floorStep, floorIndex, 'in');
          if (foyer) add(centre(foyer.rect), fy, floorStep, floorIndex, 'in');
          add([tx, ty], fy, floorStep, floorIndex, 'in');
        } else {
          const turn = turnSide(entrance.at, gLobby ? centre(gLobby.rect) : entrance.at, [tx, ty]);
          const groundStep = steps.length;
          addStep(t.groundTurn(turn, roomName), ['enter', turnCue(turn)]);
          add(entrance.at, gy, groundStep, 0, 'in');
          if (gLobby) add(centre(gLobby.rect), gy, groundStep, 0, 'in');
          add([tx, ty], gy, groundStep, 0, 'in');
        }
      } else {
        addStep(t.noRoom(roomName), null);
      }
    } else if (room) {
      notes.push(t.noInterior);
    }

    // Draw one calm line, split at the door: both tubes vanish once the walker is inside,
    // leaving only the entered building, the walker and the destination room on screen.
    const pts = track.map((x) => x.p);
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    curve = path; length = path.getLength();
    const makeTube = (points, name) => {
      const sub = new THREE.CurvePath();
      for (let i = 1; i < points.length; i++) if (points[i].distanceTo(points[i - 1]) > 0.01) sub.add(new THREE.LineCurve3(points[i - 1], points[i]));
      if (!sub.curves.length) return null;
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(sub, Math.max(32, Math.round(sub.getLength() / 2)), 0.45, 8, false),
        new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.85, depthTest: false }));
      mesh.name = name; mesh.renderOrder = 20; group.add(mesh); return mesh;
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

    // destination: the room itself glows, with one label
    const end = pts[pts.length - 1];
    if (targetRect) {
      const [x0, y0, x1, y1] = targetRect;
      const box = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2.6, y1 - y0),
        new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.28, depthWrite: false }));
      box.position.set((x0 + x1) / 2, targetLevel + 1.4, -(y0 + y1) / 2); box.renderOrder = 18; group.add(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: ROUTE_COLOR }));
      edges.position.copy(box.position); group.add(edges);
    }
    marker(roomLabel || room || bName, 'end', end.clone().setY(end.y + 5));

    const bounds = new THREE.Box3().setFromPoints(pts);
    const totalM = Math.round(length / 10) * 10;
    return {
      ok: true, buildingId: r.buildingId, floorIndex, steps, cues, notes, bounds, track, lang,
      summary: t.total(totalM, Math.max(1, Math.round(length / 75))),
    };
  }

  return { show, clear, resolve, setIndoorMode, get active() { return !!curve; } };
}

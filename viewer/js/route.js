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
    start: (g) => `Enter the campus through ${g}.`,
    walk: (m, b, d) => `Walk about ${m} m to ${b} (${d}).`,
    walkNoDoor: (m, b) => `Walk about ${m} m to ${b}.`,
    lobby: 'Go through the entrance into the lobby.',
    stairs: (s, f) => `Take the ${s} up to the ${f}.`,
    ground: (r) => `${r} is on the ground floor.`,
    room: (r) => `${r} is ahead. You have arrived.`,
    noRoom: (r) => `${r} is not on the indoor map yet. Ask at the building lobby.`,
    noInterior: 'The inside of this building is not mapped yet.',
    estimated: 'The entrance position is estimated.',
    assumed: 'The timetable does not name the building; it was matched by room name.',
    notFound: (b) => `“${b}” is not on the campus map yet.`,
    total: (m, min) => `About ${m} m · ${min} min walk`,
  },
  ar: {
    start: (g) => `ادخل الحرم من ${g}.`,
    walk: (m, b, d) => `امشِ حوالي ${m} م إلى ${b} (${d}).`,
    walkNoDoor: (m, b) => `امشِ حوالي ${m} م إلى ${b}.`,
    lobby: 'ادخل من المدخل إلى اللوبي.',
    stairs: (s, f) => `اطلع ${s} إلى ${f}.`,
    ground: (r) => `${r} في الدور الأرضي.`,
    room: (r) => `${r} أمامك. لقد وصلت إلى وجهتك بنجاح.`,
    noRoom: (r) => `${r} غير موجودة على الخريطة الداخلية بعد. اسأل في لوبي المبنى.`,
    noInterior: 'الخريطة الداخلية لهذا المبنى غير متاحة بعد.',
    estimated: 'مكان المدخل تقديري.',
    assumed: 'الجدول لا يذكر المبنى، فتم تحديده من اسم القاعة.',
    notFound: (b) => `«${b}» غير موجود على الخريطة بعد.`,
    total: (m, min) => `حوالي ${m} م · ${min} دقيقة مشي`,
  },
};

const v3 = ([x, y], h = GROUND_Y) => new THREE.Vector3(x, h, -y);
const centre = ([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2];
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

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
  let curve = null, length = 0;

  function clear() {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose?.(); if (c.element) c.element.remove(); });
    }
    curve = null; length = 0;
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
   * Builds the route and returns {ok, buildingId, floorIndex, steps[], notes[], summary, bounds, track} (or ok: false).
   * track: the walk as points with, for each point, the step being followed while walking to it, the interior floor
   * shown (-1 = outside) and the segment kind ('out' | 'in' | 'stair'); used by the guided tour.
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
    const track = [];
    const notes = [];
    const add = (p, h, step, floor, kind) => track.push({ p: v3(p, h), step, floor, kind });
    const startName = lang === 'ar' ? net.start_name_ar : net.start_name_en;
    steps.push(t.start(startName));

    // outdoor leg
    let outdoorM = 0;
    const nodes = door ? shortestPath(net, net.start, door.node) : null;
    if (nodes) {
      const seq = [net.nodes.gate_out, ...nodes.map((n) => net.nodes[n]), door.at];
      for (let i = 1; i < seq.length; i++) outdoorM += Math.hypot(seq[i][0] - seq[i - 1][0], seq[i][1] - seq[i - 1][1]);
      seq.forEach((p, i) => add(p, GROUND_Y, i < 2 ? 0 : 1, -1, 'out'));
      steps.push(t.walk(Math.round(outdoorM / 10) * 10, bName, lang === 'ar' ? door.name_ar : door.name_en));
      if (door.estimated) notes.push(t.estimated);
    } else {
      add(net.nodes.gate_out, GROUND_Y, 0, -1, 'out');
      add([it.center.x, -it.center.z], GROUND_Y, 1, -1, 'out');
      steps.push(t.walkNoDoor(Math.round(Math.hypot(it.center.x - net.nodes.gate_out[0], -it.center.z - net.nodes.gate_out[1]) / 10) * 10, bName));
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
        const lobbyStep = steps.length; steps.push(t.lobby);
        add(entrance.at, gy, lobbyStep, 0, 'in');
        if (gLobby) add(centre(gLobby.rect), gy, lobbyStep, 0, 'in');
        if (floorIndex > 0) {
          // Progressive multi-floor traversal: approach the stairwell, climb each flight
          // step by step along the drawn treads (stairProfile), land on every intermediate
          // floor and continue — never a single vertical jump between floors.
          const north = ty > (gLobby ? centre(gLobby.rect)[1] : entrance.at[1]);
          const stairId = north ? 'stair_n' : 'stair_s';
          const fy = f.level + 0.3;
          let blocked = false;
          for (let k = 0; k < floorIndex && !blocked; k++) {
            const fk = data.floors[k], fk1 = data.floors[k + 1];
            const stair = fk.rooms.find((x) => x.id === stairId);
            if (!stair) { blocked = true; break; }
            const [sx, sy] = centre(stair.rect);
            const stairName = lang === 'ar' ? stair.name_ar : stair.name_en.toLowerCase();
            const nextName = lang === 'ar' ? fk1.name_ar : fk1.name_en.toLowerCase();
            // 1) approach this flight's entry on floor k
            const upStep = steps.length;
            steps.push(k === 0 ? t.toStairs(stairName, nextName) : t.continueUp(stairName, nextName));
            if (k === 0 && gLobby) add(centre(gLobby.rect), gy, upStep, 0, 'in');
            add([stair.rect[2] + 1, sy], fk.level + 0.3, upStep, k, 'in');
            add([sx, sy], fk.level + 0.3, upStep, k, 'in');
            // 2) climb the flight along the actual treads
            const rise = fk1.level - fk.level;
            for (const s of stairProfile(stair.rect, rise)) add([s.x, s.y], fk.level + s.h, upStep, k, 'stair');
            // 3) land on floor k+1
            const landY = fk1.level + 0.3;
            add([stair.rect[2] + 1, sy], landY, upStep, k + 1, 'in');
            if (k + 1 < floorIndex) {
              const reached = steps.length; steps.push(t.floorReached(nextName));
              const lobbyUp = fk1.rooms.find((x) => x.id === (north ? 'lobby_n' : 'lobby_s'));
              if (lobbyUp) add(centre(lobbyUp.rect), landY, reached, k + 1, 'in');
            }
          }
          if (blocked) notes.push(t.noStairs);
          const arriveStep = steps.length; steps.push(t.room(roomName));
          const lobby = f.rooms.find((x) => x.id === (north ? 'lobby_n' : 'lobby_s'));
          if (lobby) add(centre(lobby.rect), fy, arriveStep, floorIndex, 'in');
          const foyer = f.rooms.find((x) => x.id === `${target.id}_foyer`);
          if (foyer) add(centre(foyer.rect), fy, arriveStep, floorIndex, 'in');
          add([tx, ty], fy, arriveStep, floorIndex, 'in');
        } else {
          const arriveStep = steps.length; steps.push(t.ground(roomName));
          add([tx, ty], gy, arriveStep, 0, 'in');
        }
      } else {
        steps.push(t.noRoom(roomName));
      }
    } else if (room) {
      notes.push(t.noInterior);
    }

    // draw: one calm line for the whole way
    const pts = track.map((x) => x.p);
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) if (pts[i].distanceTo(pts[i - 1]) > 0.01) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    curve = path; length = path.getLength();
    const segs = Math.max(64, Math.round(length / 2));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(path, segs, 0.45, 8, false),
      new THREE.MeshBasicMaterial({ color: ROUTE_COLOR, transparent: true, opacity: 0.85, depthTest: false }));
    tube.renderOrder = 20; group.add(tube);

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
      ok: true, buildingId: r.buildingId, floorIndex, steps, notes, bounds, track, lang,
      summary: t.total(totalM, Math.max(1, Math.round(length / 75))),
    };
  }

  return { show, clear, resolve, get active() { return !!curve; } };
}

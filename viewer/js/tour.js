// Guided tour controller along a route from route.js:
// - Deterministic monotonic segment-sweep state machine (never skips states or floors even at high playback speeds)
// - Authoritative floor progression gated on completed corridor approach + full flight ascent + landing arrival
// - Distance-synchronized articulated student character animation (`walker.js`)
// - Horizontal human eye-level follow camera (`~1.62 m`) with smooth damping & 3D raycast wall/ceiling collision safety
import * as THREE from 'three';
import { createWalkerFigure } from './walker.js';

export const TOUR_CONFIG = {
  speed: {
    out: 28.0,            // brisk campus crossing so user reaches building entrance promptly
    door: 2.0,            // natural entrance doorway threshold crossing (m/s)
    in: 2.35,             // comfortable academic corridor walking speed (m/s)
    stair_approach: 1.85, // approaching stairwell doorway (m/s)
    stair: 1.65,          // crisp step-by-step stair ascent speed (m/s)
    landing: 1.85,        // crossing verified floor landing (m/s)
  },
  pause: {
    start: 1.2,
    end: 0.5,
  },
  camera: {
    out:   { back: 28.0, up: 10.5, lead: 2.4,  side: 0.0,  aim: 1.35, fov: 45 },
    in:    { back: 3.35, up: 1.62, lead: 1.90, side: 0.30, aim: 1.44, fov: 52 },
    stair: { back: 1.85, up: 1.68, lead: 1.15, side: 0.14, aim: 1.32, fov: 56 },
  },
  collision: {
    wallMargin: 0.38,
    minDist: 0.85,
    ceilingMargin: 0.26,
    floorMargin: 1.18,
  },
};

export const NAV_STATES = [
  'IDLE',
  'ROUTE_PLANNING',
  'WALKING',
  'ENTERING_DOOR',
  'CORRIDOR_NAVIGATION',
  'APPROACHING_STAIRS',
  'CLIMBING',
  'FLOOR_LANDING',
  'ARRIVED',
];

const _raycaster = new THREE.Raycaster();
const _anchor = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

function shortestAngleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createTour({ scene, camera, controls, onStep, onFloor, onProgress, onEnd, onState, getInterior }) {
  const walker = new THREE.Group();
  walker.name = 'tour-walker';
  walker.visible = false;

  const figure = createWalkerFigure();
  walker.add(figure.group);
  scene.add(walker);

  const baseFov = camera.fov || 45;
  let segs = [], total = 0, time = 0, prevSegIdx = 0;
  let playing = false, active = false, ended = false;
  let step = -1, floor = null, shownGeomFloor = -1, buildingId = null;
  let inside = 0, climb = 0, orbit = 0, playbackRate = 1, camPull = 1.0;
  let state = 'IDLE';
  const navLog = [];

  const telemetry = {
    cameraCollisionClamps: 0,
    maxIndoorPitchDeg: 0,
    lastCameraPitchDeg: 0,
    lastCamEyeOffset: 0,
    floorTransitions: [],
  };

  const fwd = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3(0, 0, 1);
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let camPos = null, camLook = null;

  function setState(s, t = time) {
    if (state === s) return;
    state = s;
    navLog.push({ t: Math.round(t * 10) / 10, state: s, floor });
    if (onState) onState(s);
  }

  function stateForSeg(i) {
    const k = segs[i].kind, prev = segs[i - 1]?.kind, next = segs[i + 1]?.kind;
    if (k === 'out') return 'WALKING';
    if (k === 'door') return 'ENTERING_DOOR';
    if (k === 'stair_approach') return 'APPROACHING_STAIRS';
    if (k === 'stair') return 'CLIMBING';
    if (k === 'landing' || prev === 'stair') return 'FLOOR_LANDING';
    if (next === 'stair' || next === 'stair_approach') return 'APPROACHING_STAIRS';
    if (prev === 'out' || prev === undefined) return 'ENTERING_DOOR';
    return 'CORRIDOR_NAVIGATION';
  }

  function computeStates() {
    for (let i = 0; i < segs.length; i++) {
      segs[i].nav = stateForSeg(i);
    }
  }

  function segIndexAt(t) {
    for (let i = 0; i < segs.length; i++) {
      if (t < segs[i].t0 + segs[i].dur) return i;
    }
    return Math.max(0, segs.length - 1);
  }

  // Authoritative floor state & stairwell ceiling shaft visibility synchronization
  function applySegmentAuthority(s, atTime) {
    const logicalFloor = s.kind === 'stair' ? s.fromFloor : s.floor;

    if (logicalFloor !== floor) {
      floor = logicalFloor;
      telemetry.floorTransitions.push(floor);
      if (onFloor) onFloor(floor);
      shownGeomFloor = floor;
    }

    // While actively ascending inside stairwell, expose next floor shaft landing without changing logical floor
    // or exposing any floor above `floor + 1`!
    const interior = buildingId && getInterior ? getInterior(buildingId) : null;
    if (interior?.setVisibleFloors && floor !== null && floor >= 0) {
      const desiredGeom = s.kind === 'stair'
        ? Math.min(interior.floors.length - 1, floor + 1)
        : floor;
      if (desiredGeom !== shownGeomFloor) {
        shownGeomFloor = desiredGeom;
        interior.setVisibleFloors(desiredGeom, floor);
      }
    }

    if (s.step !== undefined && s.step !== step) {
      step = s.step;
      if (onStep) onStep(step);
    }
    if (s.nav && s.nav !== state) {
      setState(s.nav, atTime);
    }
  }

  // Clamp desired indoor camera against stairwell shaft bounds, ceiling soffit, floor slab, and 3D wall/column raycasts
  function resolveIndoorCameraCollision(desiredPos, segKind) {
    const interior = buildingId && getInterior ? getInterior(buildingId) : null;
    if (!interior || floor === null || floor < 0) return;

    const flObj = interior.floors[floor];
    const minFloorY = walker.position.y + TOUR_CONFIG.collision.floorMargin;

    if (segKind === 'stair' || segKind === 'landing') {
      // Analytically contain camera inside the open stairwell shaft hole so neither shaft walls, landing jambs, nor soffits occlude view
      const stairRooms = interior.data?.floors?.[floor]?.rooms?.filter((r) => r.kind === 'stair') || [];
      let bestStair = null, bestD = Infinity;
      for (const sr of stairRooms) {
        const cx = (sr.rect[0] + sr.rect[2]) / 2, cy = (sr.rect[1] + sr.rect[3]) / 2;
        const d = Math.hypot(walker.position.x - cx, -walker.position.z - cy);
        if (d < bestD) { bestD = d; bestStair = sr; }
      }
      if (bestStair) {
        const [rx0, ry0, rx1, ry1] = bestStair.rect;
        const alongX = (rx1 - rx0) >= (ry1 - ry0);
        const minX = rx0 + 0.52, maxX = alongX ? rx1 - 1.24 : rx1 - 0.52;
        const minY = ry0 + 0.52, maxY = alongX ? ry1 - 0.52 : ry1 - 1.24;
        desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, minX, maxX);
        desiredPos.z = -THREE.MathUtils.clamp(-desiredPos.z, minY, maxY);
      }
      if (desiredPos.y < minFloorY) desiredPos.y = minFloorY;
      return;
    }

    if (flObj) {
      const maxCeilY = flObj.level + flObj.clearH - TOUR_CONFIG.collision.ceilingMargin;
      if (desiredPos.y > maxCeilY) desiredPos.y = maxCeilY;
    }
    if (desiredPos.y < minFloorY) desiredPos.y = minFloorY;

    _anchor.set(walker.position.x, walker.position.y + TOUR_CONFIG.camera.in.aim, walker.position.z);
    _rayDir.copy(desiredPos).sub(_anchor);
    const fullDist = _rayDir.length();
    if (fullDist < 1e-3) return;
    _rayDir.divideScalar(fullDist);

    const colliders = [];
    const maxCheck = Math.min(interior.floors.length - 1, Math.max(floor, shownGeomFloor));
    for (let fi = floor; fi <= maxCheck; fi++) {
      if (interior.floors[fi]?.colliders) colliders.push(...interior.floors[fi].colliders);
    }

    let targetPull = 1.0;
    if (colliders.length) {
      _raycaster.set(_anchor, _rayDir);
      _raycaster.near = 0.05;
      _raycaster.far = fullDist + TOUR_CONFIG.collision.wallMargin;
      const hits = _raycaster.intersectObjects(colliders, true);
      if (hits.length > 0) {
        const safeDist = Math.max(TOUR_CONFIG.collision.minDist, hits[0].distance - TOUR_CONFIG.collision.wallMargin);
        if (safeDist < fullDist) {
          targetPull = Math.min(1.0, safeDist / fullDist);
          telemetry.cameraCollisionClamps++;
        }
      }
    }

    // Instant hard clamp on obstacle pull-in (zero wall penetration); smooth ease-out in open space
    if (targetPull < camPull) camPull = targetPull;
    else camPull += (targetPull - camPull) * 0.22;
    desiredPos.copy(_anchor).addScaledVector(_rayDir, fullDist * camPull);
  }

  function start(res) {
    segs = [];
    buildingId = res.buildingId || null;
    total = TOUR_CONFIG.pause.start;
    const tr = res.track;

    segs.push({
      a: tr[0].p,
      b: tr[0].p,
      len: 0,
      speed: 0,
      t0: 0,
      dur: TOUR_CONFIG.pause.start,
      step: 0,
      floor: tr[0].floor,
      fromFloor: tr[0].floor,
      kind: tr[0].kind,
      nav: 'WALKING',
    });

    for (let i = 1; i < tr.length; i++) {
      const len = tr[i].p.distanceTo(tr[i - 1].p);
      if (len < 0.008) continue;
      const spd = TOUR_CONFIG.speed[tr[i].kind] || TOUR_CONFIG.speed.in;
      const dur = Math.max(0.18, len / spd);
      segs.push({
        a: tr[i - 1].p,
        b: tr[i].p,
        len,
        speed: len / dur,
        t0: total,
        dur,
        step: tr[i].step,
        floor: tr[i].floor,
        fromFloor: tr[i - 1].floor,
        kind: tr[i].kind,
      });
      total += dur;
    }
    total += TOUR_CONFIG.pause.end;
    computeStates();

    time = 0;
    prevSegIdx = 0;
    step = -1;
    floor = null;
    shownGeomFloor = -1;
    camPull = 1.0;
    ended = false;
    active = true;
    playing = true;
    orbit = 0;
    navLog.length = 0;
    telemetry.cameraCollisionClamps = 0;
    telemetry.maxIndoorPitchDeg = 0;
    telemetry.floorTransitions = [];

    setState('ROUTE_PLANNING', 0);
    inside = tr[0].kind === 'out' ? 0 : 1;
    climb = 0;
    walker.visible = true;
    controls.enabled = false;
    figure.reset();
    place(segs[0], 0, 1, 0.016);
    camPos = camera.position.clone();
    camLook = controls.target.clone();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) skip();
  }

  function place(s, u, k, dt = 0.016) {
    const prevYaw = walker.rotation.y;
    walker.position.lerpVectors(s.a, s.b, u);

    const d = new THREE.Vector3().subVectors(s.b, s.a);
    d.y = 0;
    if (d.lengthSq() > 0.0004) fwd.lerp(d.normalize(), Math.min(1, k * 2.2)).normalize();
    walker.rotation.y = Math.atan2(fwd.x, fwd.z);
    const headingDelta = shortestAngleDiff(prevYaw, walker.rotation.y);
    side.set(fwd.z, 0, -fwd.x);

    const markOn = s.kind === 'out';
    figure.setHalo(markOn);

    const isStairCam = s.kind === 'stair' || s.kind === 'stair_approach' || s.kind === 'landing';
    const blendK = 1 - Math.exp(-5.0 * Math.max(0.016, dt));
    const justEntered = inside < 0.5 && s.kind !== 'out';
    inside = s.kind === 'out' ? 0 : 1;
    climb += ((isStairCam ? 1 : 0) - climb) * blendK;
    if (Math.abs((isStairCam ? 1 : 0) - climb) < 0.005) climb = isStairCam ? 1 : 0;

    const lerp2 = (a, b, t) => a + (b - a) * t;
    const ease = (t) => t * t * (3 - 2 * t);
    const inT = inside;
    const stT = ease(THREE.MathUtils.clamp(climb, 0, 1));

    const portrait = camera.aspect < 0.8 ? 1.22 : camera.aspect < 1.1 ? 1.10 : 1;
    const distScale = lerp2(1, portrait, inT);
    const C = TOUR_CONFIG.camera;
    const mix = (key) => lerp2(lerp2(C.out[key], C.in[key], inT), C.stair[key], stT);

    const back = mix('back') * distScale;
    const up = mix('up');
    const lead = mix('lead');
    const aside = mix('side');
    const aim = mix('aim');
    const targetFov = mix('fov');

    if (Math.abs(camera.fov - targetFov) > 0.03) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5.0);
      camera.updateProjectionMatrix();
    }

    want.copy(walker.position).addScaledVector(fwd, -back).addScaledVector(side, aside);
    want.y = walker.position.y + up;

    pos.copy(walker.position).addScaledVector(fwd, lead);
    pos.y = walker.position.y + aim;

    if (inT > 0.35) {
      resolveIndoorCameraCollision(want, s.kind);
    }

    const lookK = s.kind === 'out' ? Math.min(1, k * 3.5) : Math.min(1, k * 1.6);
    if (k >= 1 || justEntered) {
      look.copy(pos);
      if (justEntered && camPos && camLook) {
        camPos.copy(want);
        camLook.copy(pos);
      }
    }
    else look.lerp(pos, lookK);

    return headingDelta;
  }

  function update(dt) {
    if (!active) return false;
    const motionDt = dt * playbackRate;

    if (ended) {
      figure.update(dt, { speed: 0, isStair: false, headingDelta: 0 });
      if (inside > 0.5) {
        // Indoors: keep calm human eye-level framing inside the room with full wall/ceiling collision safety!
        const last = segs[segs.length - 1];
        place(last, 1, 1 - Math.pow(0.04, dt), dt);
        camPos.lerp(want, 1 - Math.pow(0.08, dt));
        camLook.lerp(look, 1 - Math.pow(0.08, dt));
      } else {
        orbit += dt * 0.18;
        want.set(walker.position.x + Math.cos(orbit) * 70, walker.position.y + 44, walker.position.z + Math.sin(orbit) * 70);
        pos.copy(walker.position);
        camPos.lerp(want, 1 - Math.pow(0.2, dt));
        camLook.lerp(pos, 1 - Math.pow(0.05, dt));
      }
      camera.position.copy(camPos);
      controls.target.copy(camLook);
      camera.lookAt(camLook);
      return true;
    }

    if (playing) time = Math.min(total, time + motionDt);

    const nextIdx = segIndexAt(time);
    // Sweep cleanly across EVERY segment traversed in this frame so state & floor transitions NEVER skip or reorder
    for (let si = prevSegIdx; si <= nextIdx; si++) {
      applySegmentAuthority(segs[si], Math.max(time, segs[si].t0));
    }
    prevSegIdx = nextIdx;

    const s = segs[nextIdx];
    const u = THREE.MathUtils.clamp((time - s.t0) / s.dur, 0, 1);
    const headingDelta = place(s, u, 1 - Math.pow(0.015, motionDt), motionDt);

    // Distance-synchronized stride kinematics driven by actual ground velocity (m/s)
    const physicalSpeed = playing ? (s.speed || 0) : 0;
    figure.update(motionDt, {
      speed: physicalSpeed,
      isStair: s.kind === 'stair',
      headingDelta,
    });

    const k = 1 - Math.pow(0.00015, motionDt);
    const lookK = s.kind === 'out' ? 1 - Math.pow(1e-8, motionDt) : k;
    camPos.lerp(want, k);
    camLook.lerp(look, lookK);
    camera.position.copy(camPos);
    controls.target.copy(camLook);
    camera.lookAt(camLook);

    // Record live indoor eye-level & pitch telemetry
    const horizDist = Math.hypot(camLook.x - camPos.x, camLook.z - camPos.z) || 1;
    const pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(camLook.y - camPos.y, horizDist));
    telemetry.lastCameraPitchDeg = +pitchDeg.toFixed(2);
    telemetry.lastCamEyeOffset = +(camPos.y - walker.position.y).toFixed(3);
    if (floor !== null && floor >= 0 && inside > 0.85 && state !== 'CLIMBING') {
      telemetry.maxIndoorPitchDeg = Math.max(telemetry.maxIndoorPitchDeg, Math.abs(pitchDeg));
    }

    if (onProgress) onProgress(time / total);
    if (time >= total) finish();
    return true;
  }

  function finish() {
    ended = true;
    playing = false;
    setState('ARRIVED');
    const last = segs[segs.length - 1];
    orbit = Math.atan2(camera.position.z - last.b.z, camera.position.x - last.b.x);
    if (onProgress) onProgress(1);
    if (onEnd) onEnd();
  }

  function skip() {
    if (!active) return;
    const lastIdx = segs.length - 1;
    const last = segs[lastIdx];
    time = total;
    for (let si = prevSegIdx; si <= lastIdx; si++) {
      applySegmentAuthority(segs[si], segs[si].t0);
    }
    prevSegIdx = lastIdx;
    inside = last.kind === 'out' ? 0 : 1;
    climb = 0;
    figure.setHalo(last.kind === 'out');
    place(last, 1, 1, 0.016);
    if (camPos) camPos.copy(want);
    if (camLook) camLook.copy(look);
    camera.position.copy(want);
    controls.target.copy(look);
    camera.lookAt(look);
    finish();
  }

  function replay() {
    if (walker.visible) {
      active = true;
      controls.enabled = false;
      time = 0;
      prevSegIdx = 0;
      ended = false;
      playing = true;
      step = -1;
      floor = null;
      shownGeomFloor = -1;
      camPull = 1.0;
      orbit = 0;
      navLog.length = 0;
      setState('ROUTE_PLANNING', 0);
      figure.reset();
      place(segs[0], 0, 1, 0.016);
      camPos = camera.position.clone();
      camLook = controls.target.clone();
    }
  }

  function toggle() {
    if (!active) return false;
    if (ended) replay();
    else playing = !playing;
    return playing;
  }

  function setPlaybackRate(rate) {
    const r = Number(rate);
    if (Number.isFinite(r) && r > 0) playbackRate = Math.min(4, Math.max(0.25, r));
    return playbackRate;
  }

  function stop() {
    active = false;
    playing = false;
    walker.visible = false;
    controls.enabled = true;
    if (Math.abs(camera.fov - baseFov) > 0.05) {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    }
    setState('IDLE');
  }

  function release() {
    if (active && ended) {
      active = false;
      controls.enabled = true;
    }
  }

  return {
    start,
    update,
    skip,
    replay,
    toggle,
    setPlaybackRate,
    stop,
    release,
    telemetry,
    walkerFigure: figure,
    get active() { return active; },
    get playing() { return playing && !ended; },
    get playbackRate() { return playbackRate; },
    get state() { return state; },
    get currentFloor() { return floor; },
    navLog,
    states: () => segs.map((x) => x.nav),
  };
}

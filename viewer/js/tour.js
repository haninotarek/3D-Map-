// Guided tour along a route from route.js: a walker moves along the track while a follow camera stays behind and
// above it — on stairs the camera comes close, low and slightly aside, like a person walking with the student.
// Floors appear one by one while climbing.
//
// Navigation is an explicit state machine (see NAV_STATES) derived once from the track segments:
// IDLE → ROUTE_PLANNING → WALKING → ENTERING_DOOR → CORRIDOR_NAVIGATION → APPROACHING_STAIRS → CLIMBING
//      → FLOOR_LANDING → (APPROACHING_STAIRS → CLIMBING → FLOOR_LANDING)* → CORRIDOR_NAVIGATION → ARRIVED
import * as THREE from 'three';
import { createWalkerFigure } from './walker.js';

const SPEED = { out: 30, in: 5.0, stair: 1.35 };       // m/s of tour time (outdoors sped up; stairs slow, human pace)
const START_PAUSE = 2.4, END_PAUSE = 0.6;               // seconds
const CAM = {
  out:   { back: 40, up: 26, lead: 12, side: 0 },       // campus overview while walking outside
  in:    { back: 13, up: 9.5, lead: 3.2, side: 1.6 },   // corridor: behind the shoulder, slightly aside
  stair: { back: 8.5, up: 6.0, lead: 2.6, side: 2.2 },  // stairs: close, low, a step aside — every tread visible
};

export const NAV_STATES = ['IDLE', 'ROUTE_PLANNING', 'WALKING', 'ENTERING_DOOR', 'CORRIDOR_NAVIGATION', 'APPROACHING_STAIRS', 'CLIMBING', 'FLOOR_LANDING', 'ARRIVED'];

export function createTour({ scene, camera, controls, onStep, onFloor, onProgress, onEnd, onState }) {
  const walker = new THREE.Group(); walker.name = 'tour-walker'; walker.visible = false;
  // human-scale figure (academic, minimal) + pacing animation; falls back to the classic marker if missing
  const figure = createWalkerFigure ? createWalkerFigure() : null;
  if (figure) walker.add(figure.group);
  else {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 40), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; dot.renderOrder = halo.renderOrder = 30;
    walker.add(dot, halo);
  }
  scene.add(walker);

  let segs = [], total = 0, time = 0, playing = false, active = false, ended = false;
  let step = -1, floor = null, inside = 0, climb = 0, orbit = 0;
  let state = 'IDLE';
  const navLog = [];
  // smoothed follow: camera position/target chase the walker with critically-damped lerp
  const fwd = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3(0, 0, 1);
  const look = new THREE.Vector3(), want = new THREE.Vector3(), pos = new THREE.Vector3();
  let camPos = null, camLook = null;

  function setState(s, t = time) {
    if (state === s) return;
    state = s;
    navLog.push({ t: Math.round(t * 10) / 10, state: s, floor });
    if (onState) onState(s);
  }

  function computeStates() {
    const S = (i, s) => { segs[i].nav = s; };
    for (let i = 0; i < segs.length; i++) {
      const k = segs[i].kind, prev = segs[i - 1]?.kind, next = segs[i + 1]?.kind;
      if (k === 'out') S(i, 'WALKING');
      else if (k === 'stair') S(i, 'CLIMBING');
      else if (prev === 'stair') S(i, 'FLOOR_LANDING');
      else if (next === 'stair') S(i, 'APPROACHING_STAIRS');
      else if (prev === 'out' || prev === undefined) S(i, 'ENTERING_DOOR');
      else S(i, 'CORRIDOR_NAVIGATION');
    }
  }

  function start(res) {
    segs = []; total = START_PAUSE;
    const tr = res.track;
    segs.push({ a: tr[0].p, b: tr[0].p, t0: 0, dur: START_PAUSE, step: 0, floor: tr[0].floor, kind: tr[0].kind, nav: 'WALKING' });
    for (let i = 1; i < tr.length; i++) {
      const len = tr[i].p.distanceTo(tr[i - 1].p);
      if (len < 0.01) continue;
      const dur = Math.max(0.3, len / SPEED[tr[i].kind]);
      segs.push({ a: tr[i - 1].p, b: tr[i].p, t0: total, dur, step: tr[i].step, floor: tr[i].floor, fromFloor: tr[i - 1].floor, kind: tr[i].kind });
      total += dur;
    }
    total += END_PAUSE;
    computeStates();
    time = 0; step = -1; floor = null; ended = false; active = true; playing = true; orbit = 0;
    navLog.length = 0; setState('ROUTE_PLANNING', 0);
    inside = tr[0].kind === 'out' ? 0 : 1; climb = 0;
    walker.visible = true;
    controls.enabled = false;
    place(segs[0], 0, 1);
    camPos = camera.position.clone(); camLook = controls.target.clone();   // start follow from the current view
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) skip();
  }

  function segAt(t) {
    for (const s of segs) if (t < s.t0 + s.dur) return s;
    return segs[segs.length - 1];
  }

  /** Follow-camera: interpolated profile between out/in/stair, positioned behind-aside the walker. */
  function place(s, u, k) {
    walker.position.lerpVectors(s.a, s.b, u);
    const d = new THREE.Vector3().subVectors(s.b, s.a); d.y = 0;
    if (d.lengthSq() > 0.01) fwd.lerp(d.normalize(), Math.min(1, k * 1.5)).normalize();
    side.set(fwd.z, 0, -fwd.x);                                   // right-hand side of travel
    inside += ((s.kind === 'out' ? 0 : 1) - inside) * Math.min(1, k);
    climb += ((s.kind === 'stair' ? 1 : 0) - climb) * Math.min(1, k);
    const lerp2 = (a, b, t) => a + (b - a) * t;
    const inT = inside, stT = climb;
    const back = lerp2(lerp2(CAM.out.back, CAM.in.back, inT), CAM.stair.back, stT);
    const up = lerp2(lerp2(CAM.out.up, CAM.in.up, inT), CAM.stair.up, stT);
    const lead = lerp2(lerp2(CAM.out.lead, CAM.in.lead, inT), CAM.stair.lead, stT);
    const aside = lerp2(lerp2(CAM.out.side, CAM.in.side, inT), CAM.stair.side, stT);
    want.copy(walker.position).addScaledVector(fwd, -back).addScaledVector(side, aside);
    want.y = Math.max(walker.position.y + up * (1 - 0.55 * stT), walker.position.y + 1.6);
    pos.copy(walker.position).addScaledVector(fwd, lead);
    if (k >= 1) look.copy(pos);
    else look.lerp(pos, k);
  }

  function update(dt) {
    if (!active) return false;
    if (figure) {
      const speed = ended ? 0 : (playing ? (segAt(time).kind === 'stair' ? 0.45 : segAt(time).kind === 'in' ? 0.8 : 1) : 0);
      figure.update(dt, speed);
    }
    if (ended) {
      orbit += dt * 0.18;
      const r = THREE.MathUtils.lerp(70, 34, inside), h = THREE.MathUtils.lerp(48, 32, inside);
      want.set(walker.position.x + Math.cos(orbit) * r, walker.position.y + h, walker.position.z + Math.sin(orbit) * r);
      camPos.lerp(want, 1 - Math.pow(0.2, dt)); camLook.lerp(walker.position, 1 - Math.pow(0.05, dt));
      camera.position.copy(camPos); controls.target.copy(camLook); camera.lookAt(camLook);
      return true;
    }
    if (playing) time = Math.min(total, time + dt);
    const s = segAt(time);
    const u = THREE.MathUtils.clamp((time - s.t0) / s.dur, 0, 1);
    const f = s.kind === 'stair' ? s.fromFloor : s.floor;
    if (f !== floor) { floor = f; onFloor(f); }
    if (s.step !== step) { step = s.step; onStep(step); }
    if (s.nav && s.nav !== state) setState(s.nav);
    place(s, u, 1 - Math.pow(0.02, dt));
    // critically-damped follow: no jitter, keeps full spatial context
    const k = 1 - Math.pow(0.0001, dt);
    camPos.lerp(want, k); camLook.lerp(look, k);
    camera.position.copy(camPos); controls.target.copy(camLook); camera.lookAt(camLook);
    onProgress(time / total);
    if (time >= total) finish();
    return true;
  }

  function finish() {
    ended = true; playing = false;
    setState('ARRIVED');
    const last = segs[segs.length - 1];
    orbit = Math.atan2(camera.position.z - last.b.z, camera.position.x - last.b.x);
    onProgress(1); onEnd();
  }

  function skip() {
    if (!active) return;
    const last = segs[segs.length - 1];
    time = total; walker.position.copy(last.b);
    if (last.floor !== floor) { floor = last.floor; onFloor(floor); }
    const lastStep = segs.reduce((m, s) => Math.max(m, s.step), 0);
    if (lastStep !== step) { step = lastStep; onStep(lastStep); }
    inside = last.kind === 'out' ? 0 : 1; climb = 0;
    finish();
  }

  function replay() { if (walker.visible) { active = true; controls.enabled = false; time = 0; ended = false; playing = true; step = -1; floor = null; orbit = 0; navLog.length = 0; setState('ROUTE_PLANNING', 0); camPos = camera.position.clone(); camLook = controls.target.clone(); figure?.reset(); } }
  function toggle() { if (!active) return; if (ended) replay(); else playing = !playing; return playing; }
  function stop() { active = false; playing = false; walker.visible = false; controls.enabled = true; setState('IDLE'); }
  function release() { if (active && ended) { active = false; controls.enabled = true; } }

  return {
    start, update, skip, replay, toggle, stop, release,
    get active() { return active; }, get playing() { return playing && !ended; },
    get state() { return state; }, navLog,
    states: () => segs.map((x) => x.nav),
  };
}

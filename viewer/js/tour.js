// Guided tour along a route from route.js: a walker moves along the track while a follow camera stays behind and
// above it — on stairs the camera comes close, low and slightly aside, like a person walking with the student.
// Floors appear one by one while climbing.
//
// Navigation is an explicit state machine (see NAV_STATES) derived once from the track segments:
// IDLE → ROUTE_PLANNING → WALKING → ENTERING_DOOR → CORRIDOR_NAVIGATION → APPROACHING_STAIRS → CLIMBING
//      → FLOOR_LANDING → (APPROACHING_STAIRS → CLIMBING → FLOOR_LANDING)* → CORRIDOR_NAVIGATION → ARRIVED
import * as THREE from 'three';
import { createWalkerFigure } from './walker.js';

const SPEED = { out: 30, in: 5.0, stair: 1.8 };        // m/s of tour time (outdoors sped up; stairs brisk but readable)
const START_PAUSE = 2.4, END_PAUSE = 0.6;               // seconds
// Camera profiles. `aim` = height above the walker's feet the camera looks at. Outdoors the
// camera sits directly behind the walker at chest aim with a gentle downward angle, keeping
// him centred while the campus buildings and horizon stay in frame. Indoors it moves into a
// close full-body follow shot while staying above the 3 m partition walls.
const CAM = {
  out:   { back: 31,  up: 11.5, lead: 2.2, side: 0,    aim: 1.25 }, // campus: centred behind the walker, buildings in frame
  in:    { back: 6.6, up: 4.9,  lead: 1.1, side: 1.15, aim: 1.2 },  // corridor: close follow shot, framed on the walker
  stair: { back: 5.6, up: 3.8,  lead: 0.8, side: 1.35, aim: 1.15 }, // stairs: closest shot, a step aside — walker and treads fill the frame
};

export const NAV_STATES = ['IDLE', 'ROUTE_PLANNING', 'WALKING', 'ENTERING_DOOR', 'CORRIDOR_NAVIGATION', 'APPROACHING_STAIRS', 'CLIMBING', 'FLOOR_LANDING', 'ARRIVED'];

export function createTour({ scene, camera, controls, onStep, onFloor, onProgress, onEnd, onState }) {
  const walker = new THREE.Group(); walker.name = 'tour-walker'; walker.visible = false;
  // human-scale figure (academic, minimal) + pacing animation; falls back to the classic marker if missing
  const figure = createWalkerFigure ? createWalkerFigure() : null;
  let fallbackHalo = null;
  if (figure) walker.add(figure.group);
  else {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.4, 40), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    halo.name = 'walker-halo';
    halo.rotation.x = -Math.PI / 2; dot.renderOrder = halo.renderOrder = 30;
    walker.add(dot, halo);
    fallbackHalo = halo;
  }
  scene.add(walker);

  let segs = [], total = 0, time = 0, playing = false, active = false, ended = false;
  let step = -1, floor = null, inside = 0, climb = 0, orbit = 0, playbackRate = 1;
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

  /** Follow-camera: interpolated profile between out/in/stair, positioned behind-aside the walker.
   *  At the door the wide campus shot eases (smoothstep, ~1.5 s) into a close follow shot framed
   *  on the walker himself; on narrow/portrait screens the indoor shot pulls back a little so
   *  the walker and his surroundings stay comfortably in frame. */
  function place(s, u, k) {
    walker.position.lerpVectors(s.a, s.b, u);
    const d = new THREE.Vector3().subVectors(s.b, s.a); d.y = 0;
    if (d.lengthSq() > 0.01) fwd.lerp(d.normalize(), Math.min(1, k * 1.5)).normalize();
    walker.rotation.y = Math.atan2(fwd.x, fwd.z);                 // the figure faces where it walks
    side.set(fwd.z, 0, -fwd.x);                                   // right-hand side of travel
    // the ground marker under the walker is only for the outdoor drone view — indoors, off
    const markOn = s.kind === 'out';
    if (figure?.setHalo) figure.setHalo(markOn);
    if (fallbackHalo) fallbackHalo.visible = markOn;
    inside += ((s.kind === 'out' ? 0 : 1) - inside) * Math.min(1, k * 0.55);
    climb += ((s.kind === 'stair' ? 1 : 0) - climb) * Math.min(1, k);
    const lerp2 = (a, b, t) => a + (b - a) * t;
    const ease = (t) => t * t * (3 - 2 * t);                      // smoothstep: gentle in, gentle out
    const inT = ease(THREE.MathUtils.clamp(inside, 0, 1)), stT = ease(THREE.MathUtils.clamp(climb, 0, 1));
    const portrait = camera.aspect < 0.8 ? 1.28 : camera.aspect < 1.1 ? 1.12 : 1;
    const distScale = lerp2(1, portrait, inT);
    const mix = (key) => lerp2(lerp2(CAM.out[key], CAM.in[key], inT), CAM.stair[key], stT);
    const back = mix('back') * distScale;
    const up = mix('up') * distScale;
    const lead = mix('lead');
    const aside = mix('side');
    const aim = mix('aim');
    want.copy(walker.position).addScaledVector(fwd, -back).addScaledVector(side, aside);
    want.y = Math.max(walker.position.y + up, walker.position.y + 1.6);
    pos.copy(walker.position).addScaledVector(fwd, lead);
    pos.y += aim;                                                 // look at the walker, not the floor ahead
    // Outdoor tour speed is greatly amplified, so track the aim point more tightly there;
    // otherwise smoothing lag leaves the walker away from the centre of the campus shot.
    const lookK = s.kind === 'out' ? Math.min(1, k * 3.5) : k;
    if (k >= 1) look.copy(pos);
    else look.lerp(pos, lookK);
  }

  function update(dt) {
    if (!active) return false;
    const motionDt = dt * playbackRate;   // movement/animation speed selected by the user
    if (figure) {
      const speed = ended ? 0 : (playing ? (segAt(time).kind === 'stair' ? 0.58 : segAt(time).kind === 'in' ? 0.8 : 1) : 0);
      figure.update(motionDt, speed);
    }
    if (ended) {
      orbit += dt * 0.18;
      const r = THREE.MathUtils.lerp(70, 10, inside), h = THREE.MathUtils.lerp(48, 6, inside);   // indoors: a close orbit on the walker in his room
      want.set(walker.position.x + Math.cos(orbit) * r, walker.position.y + h, walker.position.z + Math.sin(orbit) * r);
      pos.copy(walker.position); pos.y += 1.15 * inside;         // keep looking at the walker, chest height
      camPos.lerp(want, 1 - Math.pow(0.2, dt)); camLook.lerp(pos, 1 - Math.pow(0.05, dt));
      camera.position.copy(camPos); controls.target.copy(camLook); camera.lookAt(camLook);
      return true;
    }
    if (playing) time = Math.min(total, time + motionDt);
    const s = segAt(time);
    const u = THREE.MathUtils.clamp((time - s.t0) / s.dur, 0, 1);
    const f = s.kind === 'stair' ? s.fromFloor : s.floor;
    if (f !== floor) { floor = f; onFloor(f); }
    if (s.step !== step) { step = s.step; onStep(step); }
    if (s.nav && s.nav !== state) setState(s.nav);
    place(s, u, 1 - Math.pow(0.02, motionDt));
    // Critically-damped camera position; the look target tracks faster outdoors so the
    // walker stays centred at the amplified campus walking speed.
    const k = 1 - Math.pow(0.0001, motionDt);
    const lookK = s.kind === 'out' ? 1 - Math.pow(1e-8, motionDt) : k;
    camPos.lerp(want, k); camLook.lerp(look, lookK);
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
    if (figure?.setHalo) figure.setHalo(last.kind === 'out');
    if (fallbackHalo) fallbackHalo.visible = last.kind === 'out';
    finish();
  }

  function replay() { if (walker.visible) { active = true; controls.enabled = false; time = 0; ended = false; playing = true; step = -1; floor = null; orbit = 0; navLog.length = 0; setState('ROUTE_PLANNING', 0); camPos = camera.position.clone(); camLook = controls.target.clone(); figure?.reset(); } }
  function toggle() { if (!active) return; if (ended) replay(); else playing = !playing; return playing; }
  function setPlaybackRate(rate) {
    const r = Number(rate);
    if (Number.isFinite(r) && r > 0) playbackRate = Math.min(4, Math.max(0.25, r));
    return playbackRate;
  }
  function stop() { active = false; playing = false; walker.visible = false; controls.enabled = true; setState('IDLE'); }
  function release() { if (active && ended) { active = false; controls.enabled = true; } }

  return {
    start, update, skip, replay, toggle, setPlaybackRate, stop, release,
    get active() { return active; }, get playing() { return playing && !ended; },
    get playbackRate() { return playbackRate; },
    get state() { return state; }, navLog,
    states: () => segs.map((x) => x.nav),
  };
}

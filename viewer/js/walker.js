// Human-scale walking figure for the guided tour — replaces the abstract dot.
// Deliberately minimal and abstract-professional: a capsule body, head and two subtle
// leg forms that scissor while walking. No face, no cartoon features, academic tone.
import * as THREE from 'three';

const H = 1.75;          // human height (m)
const ACCENT = 0xff7a1a; // the route orange

export function createWalkerFigure() {
  const g = new THREE.Group();
  g.name = 'walker-figure';

  const mat = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });

  // torso: capsule
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 6, 14), mat(0x2e3a4b, 0.85));
  torso.position.y = H * 0.62;
  torso.castShadow = true;
  g.add(torso);

  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16), mat(0xd9c4a8, 0.6));
  head.position.y = H * 0.925;
  head.castShadow = true;
  g.add(head);

  // legs: two thin capsules that scissor while walking
  const legGeo = new THREE.CapsuleGeometry(0.075, 0.52, 4, 10);
  const legL = new THREE.Mesh(legGeo, mat(0x232c38, 0.9));
  const legR = new THREE.Mesh(legGeo, mat(0x232c38, 0.9));
  legL.position.set(0.09, H * 0.23, 0);
  legR.position.set(-0.09, H * 0.23, 0);
  g.add(legL, legR);

  // soft ground halo (kept from the original marker, subtler)
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.62, 40),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.03;
  halo.renderOrder = 30;
  g.add(halo);

  let t = 0;
  let walking = false;
  /** animate: call each frame; speed = 0..1 (walk intensity), dt seconds */
  function update(dt, speed = 1) {
    halo.scale.setScalar(1 + 0.06 * Math.sin(performance.now() / 260));
    walking = speed > 0.05;
    if (walking) t += dt * (4.2 + 3.0 * Math.min(1, speed));     // stride frequency
    const amp = walking ? 0.34 * Math.min(1, speed + 0.25) : 0;
    const s = Math.sin(t);
    legL.rotation.x = s * amp;
    legR.rotation.x = -s * amp;
    legL.position.z = Math.sin(t) * 0.16 * amp / 0.34;
    legR.position.z = -Math.sin(t) * 0.16 * amp / 0.34;
    // subtle torso bob (2 steps per stride)
    torso.position.y = H * 0.62 + Math.abs(Math.cos(t)) * 0.022 * (amp / 0.34);
    head.position.y = H * 0.925 + Math.abs(Math.cos(t)) * 0.022 * (amp / 0.34);
  }
  function reset() { t = 0; legL.rotation.x = legR.rotation.x = 0; legL.position.z = legR.position.z = 0; }

  return { group: g, update, reset };
}

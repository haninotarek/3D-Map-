// Articulated human student figure with biomechanically synchronized gait and exact sole grounding.
// Local coordinate convention matches Three.js + tour.js: +Y up, +Z direction of travel, +X character left.
import * as THREE from 'three';

export const WALKER_SPEC = {
  height: 1.75,
  strideLength: 0.78,       // single-step length (m); full two-step gait cycle = 1.56 m
  stairStepRun: 0.42,       // horizontal run per stair step (m)
  hipX: 0.095,              // half-pelvis width (m)
  shoulderX: 0.195,         // half-shoulder breadth (m)
  thighLen: 0.43,
  shinLen: 0.42,
  ankleHeight: 0.08,        // ankle pivot height above shoe sole bottom (y = 0)
  upperArmLen: 0.28,
  forearmLen: 0.25,
};

const PALETTE = {
  jacket: 0x2b4159,         // smart casual engineering student overshirt / jacket
  shirt: 0xe9eef4,          // crisp light inner collar / tee
  trousers: 0x222b37,       // dark chinos
  shoeUpper: 0x2b313a,      // dark athletic / casual sneakers
  shoeSole: 0xe6e8ec,       // off-white rubber sole
  skin: 0xd6bd9d,           // natural skin tone
  hair: 0x241d18,           // dark hair
  pack: 0x3b444f,           // canvas student backpack
  packTrim: 0x56616e,       // straps & pocket trim
  halo: 0xff7a1a,           // outdoor campus route accent
};

export function createWalkerFigure(customSpec = {}) {
  const S = { ...WALKER_SPEC, ...customSpec };
  const g = new THREE.Group();
  g.name = 'walker-figure';

  const mats = new Map();
  const mat = (color, roughness = 0.82, metalness = 0.0) => {
    const key = `${color}_${roughness}_${metalness}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return mats.get(key);
  };

  const castMesh = (geo, material, name) => {
    const m = new THREE.Mesh(geo, material);
    if (name) m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // Root pelvis pivot — exact vertical height computed analytically every frame from lowest foot contact
  const pelvis = new THREE.Group();
  pelvis.name = 'walker-pelvis';
  const neutralHipY = S.thighLen + S.shinLen + S.ankleHeight; // 0.93 m
  pelvis.position.y = neutralHipY;
  g.add(pelvis);

  const pelvisMesh = castMesh(new THREE.CapsuleGeometry(0.115, 0.10, 6, 14), mat(PALETTE.trousers, 0.88), 'pelvis-mesh');
  pelvisMesh.rotation.z = Math.PI / 2;
  pelvisMesh.scale.set(1, 1, 0.82);
  pelvis.add(pelvisMesh);

  // Upper spine / torso group
  const spine = new THREE.Group();
  spine.name = 'walker-spine';
  spine.position.y = 0.06;
  pelvis.add(spine);

  // Tapered human chest/torso (natural 8-head proportions, never cylindrical pill)
  const chestGeo = new THREE.CylinderGeometry(0.158, 0.132, 0.44, 16, 1, false);
  chestGeo.scale(1.06, 1, 0.72);
  const chest = castMesh(chestGeo, mat(PALETTE.jacket, 0.82), 'torso-chest');
  chest.position.y = 0.22;
  spine.add(chest);

  const shoulderCap = castMesh(new THREE.CapsuleGeometry(0.105, 0.19, 6, 14), mat(PALETTE.jacket, 0.82), 'torso-shoulders');
  shoulderCap.rotation.z = Math.PI / 2;
  shoulderCap.scale.set(1, 1, 0.82);
  shoulderCap.position.y = 0.40;
  spine.add(shoulderCap);

  const collar = castMesh(new THREE.CylinderGeometry(0.068, 0.082, 0.055, 14), mat(PALETTE.shirt, 0.75), 'collar');
  collar.position.set(0, 0.445, 0.012);
  spine.add(collar);

  // Academic student backpack on -Z back
  const packGroup = new THREE.Group();
  packGroup.name = 'walker-backpack';
  const packBody = castMesh(new THREE.BoxGeometry(0.255, 0.34, 0.125), mat(PALETTE.pack, 0.88), 'pack-body');
  packBody.position.set(0, 0.245, -0.155);
  const packPocket = castMesh(new THREE.BoxGeometry(0.21, 0.15, 0.045), mat(PALETTE.packTrim, 0.84), 'pack-pocket');
  packPocket.position.set(0, 0.175, -0.225);
  const packTop = castMesh(new THREE.CapsuleGeometry(0.058, 0.14, 5, 12), mat(PALETTE.pack, 0.88), 'pack-top');
  packTop.rotation.z = Math.PI / 2;
  packTop.position.set(0, 0.405, -0.15);
  for (const sx of [-0.095, 0.095]) {
    const strap = castMesh(new THREE.BoxGeometry(0.036, 0.36, 0.025), mat(PALETTE.packTrim, 0.85));
    strap.position.set(sx, 0.255, -0.092);
    packGroup.add(strap);
  }
  packGroup.add(packBody, packPocket, packTop);
  spine.add(packGroup);

  // Neck + proportioned cranial head (no cartoon facial features; clean architectural visualization style)
  const headPivot = new THREE.Group();
  headPivot.name = 'walker-head';
  headPivot.position.y = 0.465;
  spine.add(headPivot);

  const neck = castMesh(new THREE.CylinderGeometry(0.052, 0.058, 0.09, 12), mat(PALETTE.skin, 0.68), 'neck');
  neck.position.y = 0.038;
  headPivot.add(neck);

  const craniumGeo = new THREE.SphereGeometry(0.104, 20, 16);
  craniumGeo.scale(0.86, 1.08, 0.96);
  const cranium = castMesh(craniumGeo, mat(PALETTE.skin, 0.66), 'cranium');
  cranium.position.set(0, 0.165, 0.008);
  headPivot.add(cranium);

  const hairGeo = new THREE.SphereGeometry(0.108, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hairGeo.scale(0.88, 1.08, 0.99);
  const hair = castMesh(hairGeo, mat(PALETTE.hair, 0.92), 'hair');
  hair.position.set(0, 0.172, 0.002);
  hair.rotation.x = -0.18;
  headPivot.add(hair);

  // Articulated arms: shoulder -> upperArm -> elbow -> forearm -> hand
  function buildArm(sideSign, tag) {
    const shoulder = new THREE.Group();
    shoulder.name = `shoulder-${tag}`;
    shoulder.position.set(sideSign * S.shoulderX, 0.395, 0);
    spine.add(shoulder);

    const upperGeo = new THREE.CylinderGeometry(0.048, 0.040, S.upperArmLen, 12);
    const upper = castMesh(upperGeo, mat(PALETTE.jacket, 0.82), `upper-arm-${tag}`);
    upper.position.y = -S.upperArmLen / 2;
    const shoulderJoint = castMesh(new THREE.SphereGeometry(0.05, 12, 10), mat(PALETTE.jacket, 0.82));
    shoulder.add(shoulderJoint, upper);

    const elbow = new THREE.Group();
    elbow.name = `elbow-${tag}`;
    elbow.position.y = -S.upperArmLen;
    shoulder.add(elbow);

    const elbowJoint = castMesh(new THREE.SphereGeometry(0.039, 10, 8), mat(PALETTE.jacket, 0.82));
    const foreGeo = new THREE.CylinderGeometry(0.038, 0.030, S.forearmLen, 12);
    const fore = castMesh(foreGeo, mat(PALETTE.skin, 0.68), `forearm-${tag}`);
    fore.position.y = -S.forearmLen / 2;
    const cuff = castMesh(new THREE.CylinderGeometry(0.041, 0.040, 0.07, 12), mat(PALETTE.jacket, 0.82));
    cuff.position.y = -0.035;
    const handGeo = new THREE.SphereGeometry(0.034, 10, 8);
    handGeo.scale(0.75, 1.25, 0.95);
    const hand = castMesh(handGeo, mat(PALETTE.skin, 0.68), `hand-${tag}`);
    hand.position.set(0, -S.forearmLen - 0.028, 0.008);
    elbow.add(elbowJoint, cuff, fore, hand);

    return { shoulder, elbow };
  }

  // Articulated legs: hip -> thigh -> knee -> shin -> ankle -> sneaker with flat rubber sole at y = -ankleHeight
  function buildLeg(sideSign, tag) {
    const hip = new THREE.Group();
    hip.name = `hip-${tag}`;
    hip.position.set(sideSign * S.hipX, 0, 0);
    pelvis.add(hip);

    const hipJoint = castMesh(new THREE.SphereGeometry(0.068, 12, 10), mat(PALETTE.trousers, 0.88));
    const thighGeo = new THREE.CylinderGeometry(0.068, 0.053, S.thighLen, 14);
    const thigh = castMesh(thighGeo, mat(PALETTE.trousers, 0.88), `thigh-${tag}`);
    thigh.position.y = -S.thighLen / 2;
    hip.add(hipJoint, thigh);

    const knee = new THREE.Group();
    knee.name = `knee-${tag}`;
    knee.position.y = -S.thighLen;
    hip.add(knee);

    const kneeJoint = castMesh(new THREE.SphereGeometry(0.052, 12, 10), mat(PALETTE.trousers, 0.88));
    const shinGeo = new THREE.CylinderGeometry(0.051, 0.039, S.shinLen, 14);
    const shin = castMesh(shinGeo, mat(PALETTE.trousers, 0.88), `shin-${tag}`);
    shin.position.y = -S.shinLen / 2;
    knee.add(kneeJoint, shin);

    const ankle = new THREE.Group();
    ankle.name = `ankle-${tag}`;
    ankle.position.y = -S.shinLen;
    knee.add(ankle);

    const ankleJoint = castMesh(new THREE.SphereGeometry(0.038, 10, 8), mat(PALETTE.shoeUpper, 0.8));
    // Sneaker geometry: heel at z = -0.072, toe at z = +0.138, flat sole bottom strictly at y = -S.ankleHeight (-0.080)
    const soleH = 0.022;
    const upperH = S.ankleHeight - soleH;
    const shoeUpper = castMesh(new THREE.BoxGeometry(0.094, upperH, 0.205), mat(PALETTE.shoeUpper, 0.78), `shoe-${tag}`);
    shoeUpper.position.set(0, -upperH / 2 - 0.004, 0.032);
    const toeCapGeo = new THREE.SphereGeometry(0.047, 12, 10);
    toeCapGeo.scale(1, 0.62, 1.15);
    const toeCap = castMesh(toeCapGeo, mat(PALETTE.shoeUpper, 0.78));
    toeCap.position.set(0, -S.ankleHeight + soleH + 0.016, 0.102);
    const sole = castMesh(new THREE.BoxGeometry(0.098, soleH, 0.214), mat(PALETTE.shoeSole, 0.72), `sole-${tag}`);
    sole.position.set(0, -S.ankleHeight + soleH / 2, 0.033);
    ankle.add(ankleJoint, shoeUpper, toeCap, sole);

    return { hip, knee, ankle };
  }

  const armL = buildArm(1, 'L');
  const armR = buildArm(-1, 'R');
  const legL = buildLeg(1, 'L');
  const legR = buildLeg(-1, 'R');

  // Ground halo marker used strictly in distant outdoor campus overview (hidden automatically indoors)
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.62, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.halo, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })
  );
  halo.name = 'walker-halo';
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.025;
  halo.renderOrder = 30;
  g.add(halo);

  // Biomechanical gait state
  let phase = 0;            // continuous stride phase (radians; 2π = full left+right gait cycle)
  let walkBlend = 0;        // 0 = idle standing, 1 = active walking/climbing
  let stairBlend = 0;       // 0 = level ground gait, 1 = stair ascent kinematics
  let turnSmooth = 0;       // smoothed yaw rate for subtle upper-body anticipation lean
  let idleClock = 0;

  const telemetry = {
    minFootY: 0,
    leftFootY: 0,
    rightFootY: 0,
    phase: 0,
    walkBlend: 0,
    stairBlend: 0,
    cadenceHz: 0,
    stanceFoot: 'double',
  };

  /**
   * Computes realistic human sagittal leg joint angles for normalized cycle u in [0, 1):
   *   u in [0, 0.58)  -> Stance phase: heel strike (u=0) -> flat foot plant -> push-off (u=0.58)
   *   u in [0.58, 1)  -> Swing phase: toe-off knee flexion peak -> forward leg swing -> heel strike
   */
  function sampleLegCycle(u, isStair) {
    let hip = 0, knee = 0, ankle = 0;
    if (!isStair) {
      if (u < 0.58) {
        // Stance phase: hip sweeps smoothly forward (+0.34 rad) to extended (-0.30 rad) so planted foot tracks backward at -v
        const s = u / 0.58;
        hip = 0.34 * (1 - s) + (-0.30) * s;
        // Subtle weight-acceptance knee yield right after heel strike (s ~ 0.16), near-straight mid-stance, pre-swing bend
        const yieldBump = Math.exp(-Math.pow((s - 0.16) / 0.14, 2)) * 0.13;
        const preSwing = s > 0.78 ? Math.pow((s - 0.78) / 0.22, 2) * 0.32 : 0;
        knee = yieldBump + preSwing;
        // Heel-strike dorsiflexion -> flat foot contact -> plantarflexion push-off at toe-off
        if (s < 0.16) ankle = -0.14 * (1 - s / 0.16);
        else if (s > 0.72) ankle = 0.24 * ((s - 0.72) / 0.28);
        else ankle = -(hip - knee) * 0.85; // keeps sole parallel to ground during mid-stance
      } else {
        // Swing phase: crisp knee clearance peak around mid-swing, smooth leg extension into heel strike
        const w = (u - 0.58) / 0.42;
        const smoothW = w * w * (3 - 2 * w);
        hip = -0.30 + (0.34 - (-0.30)) * smoothW;
        knee = 0.32 * (1 - smoothW) + Math.sin(Math.PI * Math.pow(w, 0.82)) * 0.68;
        // Dorsiflex foot during swing for clean ground clearance and heel-first landing
        ankle = 0.24 * Math.max(0, 1 - w * 3.2) - 0.14 * smoothW;
      }
    } else {
      // Stair ascent biomechanics: higher hip & knee lift onto upper tread, controlled vertical drive through stance leg
      if (u < 0.56) {
        const s = u / 0.56;
        hip = 0.62 * (1 - s) + (-0.08) * s;
        knee = 0.66 * Math.pow(1 - s, 1.15) + 0.06;
        // Keep shoe sole flat on horizontal stair tread throughout stance
        ankle = -(hip - knee);
      } else {
        const w = (u - 0.56) / 0.44;
        const smoothW = w * w * (3 - 2 * w);
        hip = -0.08 + (0.62 - (-0.08)) * smoothW + Math.sin(Math.PI * w) * 0.14;
        knee = 0.06 + (0.66 - 0.06) * smoothW + Math.sin(Math.PI * w) * 0.48;
        ankle = -(hip - knee) * 0.85 - 0.06 * Math.sin(Math.PI * w);
      }
    }
    return { hip, knee, ankle };
  }

  function applyPose(dt, opts) {
    const isObj = opts !== null && typeof opts === 'object';
    const rawSpeed = isObj ? (opts.speed ?? 0) : Number(opts || 0);
    const ds = isObj ? opts.ds : undefined;
    const mode = isObj ? (opts.mode || 'walk') : 'walk';
    const turnRate = isObj ? (opts.turnRate || 0) : 0;

    const moving = rawSpeed > 0.03 && (ds === undefined || ds > 1e-5);
    const targetWalk = moving ? Math.min(1, 0.35 + rawSpeed * 0.65) : 0;
    const targetStair = (moving && mode === 'stair') ? 1 : 0;

    const kBlend = 1 - Math.exp(-Math.max(0, dt) * 8.5);
    const kStair = 1 - Math.exp(-Math.max(0, dt) * 6.5);
    walkBlend += (targetWalk - walkBlend) * kBlend;
    stairBlend += levelDiff(targetStair, stairBlend, kStair);
    turnSmooth += (THREE.MathUtils.clamp(turnRate, -2.5, 2.5) - turnSmooth) * (1 - Math.exp(-Math.max(0, dt) * 6.0));
    idleClock += dt;

    // Advance gait phase strictly by real world distance ds when provided (zero foot sliding!)
    let dPhase = 0;
    if (moving) {
      if (typeof ds === 'number' && ds >= 0) {
        const stepLen = THREE.MathUtils.lerp(S.strideLength, S.stairStepRun, stairBlend);
        dPhase = (ds / Math.max(0.25, stepLen)) * Math.PI;
      } else {
        dPhase = dt * (3.6 + 2.4 * Math.min(1, rawSpeed));
      }
      phase = (phase + dPhase) % (Math.PI * 2);
    }
    telemetry.cadenceHz = dt > 1e-4 ? +(dPhase / (Math.PI * 2 * dt)).toFixed(2) : 0;

    const uL = (phase / (Math.PI * 2)) % 1;
    const uR = (uL + 0.5) % 1;

    const flatL = sampleLegCycle(uL, false), flatR = sampleLegCycle(uR, false);
    const stL = sampleLegCycle(uL, true), stR = sampleLegCycle(uR, true);

    const mix = THREE.MathUtils.lerp;
    const hipL = mix(flatL.hip, stL.hip, stairBlend) * walkBlend;
    const kneeL = mix(flatL.knee, stL.knee, stairBlend) * walkBlend;
    const ankleL = mix(flatL.ankle, stL.ankle, stairBlend) * walkBlend;

    const hipR = mix(flatR.hip, stR.hip, stairBlend) * walkBlend;
    const kneeR = mix(flatR.knee, stR.knee, stairBlend) * walkBlend;
    const ankleR = mix(flatR.ankle, stR.ankle, stairBlend) * walkBlend;

    // Subtle idle weight stance when stopped so character stands naturally like a real student
    const idleSway = (1 - walkBlend) * 0.015 * Math.sin(idleClock * 1.35);
    const breath = (1 - walkBlend) * 0.004 * Math.sin(idleClock * 2.1);

    // Natural pelvic motion: slight forward lean when climbing, subtle lateral list & axial counter-rotation
    const pelvisPitch = walkBlend * mix(0.025, 0.095, stairBlend);
    const pelvisRoll = walkBlend * 0.032 * Math.sin(phase) + idleSway;
    const pelvisYaw = walkBlend * 0.055 * Math.sin(phase);

    pelvis.rotation.set(pelvisPitch, pelvisYaw, pelvisRoll);

    // Spine counter-rotation & subtle turn banking
    const spinePitch = walkBlend * mix(0.03, 0.09, stairBlend);
    const spineYaw = -pelvisYaw * 0.85 + turnSmooth * 0.05;
    const spineRoll = -pelvisRoll * 0.55 - turnSmooth * 0.035;
    spine.rotation.set(spinePitch, spineYaw, spineRoll);
    spine.position.y = 0.06 + breath;

    // Head stays level on the horizon and leads gently into turns
    headPivot.rotation.set(
      -pelvisPitch - spinePitch * 0.75 + mix(0, -0.08, stairBlend * walkBlend),
      turnSmooth * 0.14 - spineYaw * 0.35,
      -(pelvisRoll + spineRoll) * 0.65
    );

    // Apply leg joint rotations (hip +X = forward flexion, knee -X = backward flexion)
    legL.hip.rotation.set(hipL, 0, -0.018);
    legL.knee.rotation.x = -kneeL;
    legL.ankle.rotation.x = ankleL;

    legR.hip.rotation.set(hipR, 0, 0.018);
    legR.knee.rotation.x = -kneeR;
    legR.ankle.rotation.x = ankleR;

    // Contra-lateral arm swing (left arm swings forward with right leg, natural elbow bend)
    const swingL = -Math.sin(phase) * mix(0.34, 0.42, stairBlend) * walkBlend;
    const swingR = Math.sin(phase) * mix(0.34, 0.42, stairBlend) * walkBlend;
    armL.shoulder.rotation.set(swingL, 0, -0.065);
    armR.shoulder.rotation.set(swingR, 0, 0.065);
    armL.elbow.rotation.x = 0.18 + Math.max(0, swingL) * 0.42 + 0.10 * walkBlend + stairBlend * 0.14;
    armR.elbow.rotation.x = 0.18 + Math.max(0, swingR) * 0.42 + 0.10 * walkBlend + stairBlend * 0.14;

    // Exact closed-form sole-contact height so the lowest point of either shoe sole sits at y = 0.000m ALWAYS
    const minSoleRelHip = (hipAng, kneeAng, ankleAng) => {
      const th1 = pelvisPitch + hipAng;
      const th2 = th1 - kneeAng;
      const th3 = th2 + ankleAng;
      const yAnkle = -S.thighLen * Math.cos(th1) - S.shinLen * Math.cos(th2);
      const yHeel = yAnkle - S.ankleHeight * Math.cos(th3) + 0.072 * Math.sin(th3);
      const yToe = yAnkle - S.ankleHeight * Math.cos(th3) - 0.138 * Math.sin(th3);
      return Math.min(yHeel, yToe);
    };

    const soleL = S.hipX * Math.sin(pelvisRoll) + minSoleRelHip(hipL, kneeL, ankleL);
    const soleR = -S.hipX * Math.sin(pelvisRoll) + minSoleRelHip(hipR, kneeR, ankleR);
    const lowestSole = Math.min(soleL, soleR);
    pelvis.position.y = -lowestSole;

    telemetry.leftFootY = +(soleL - lowestSole).toFixed(4);
    telemetry.rightFootY = +(soleR - lowestSole).toFixed(4);
    telemetry.minFootY = 0;
    telemetry.phase = +phase.toFixed(3);
    telemetry.walkBlend = +walkBlend.toFixed(3);
    telemetry.stairBlend = +stairBlend.toFixed(3);
    telemetry.stanceFoot = walkBlend < 0.08 ? 'double' : (telemetry.leftFootY <= telemetry.rightFootY + 0.004 ? 'left' : 'right');
  }

  function levelDiff(target, cur, k) { return (target - cur) * k; }

  function update(dt, speedOrOpts = 1) {
    if (halo.visible) halo.scale.setScalar(1 + 0.05 * Math.sin(performance.now() / 280));
    applyPose(Math.max(0, Math.min(0.1, dt || 0)), speedOrOpts);
  }

  function reset() {
    phase = 0;
    walkBlend = 0;
    stairBlend = 0;
    turnSmooth = 0;
    applyPose(0.016, 0);
  }

  function setHalo(v) { halo.visible = !!v; }

  // Initialize standing pose cleanly at y = 0.000m on creation
  applyPose(0.016, 0);

  return { group: g, update, reset, setHalo, telemetry, spec: S };
}

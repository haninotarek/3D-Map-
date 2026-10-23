// Architectural floor-by-floor interior builder for university campus buildings (data/interiors/*.json).
// Coordinates are local ENU metres (x = East, y = North); Three.js uses x = East, z = -North, y = up.
// All walls, marble dado wainscots, walnut caps, skirtings, staircases, columns, ceilings, and LED luminaires
// are batched into InstancedMeshes per material per floor for ultra-low draw calls and smooth 60 fps rendering.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createFurnisher, furnishRoom, doorLeaves, roomCells } from './furniture.js';
import { createCollisionWorld } from './collision.js';

const KIND_FLOOR = {
  lobby: 'terrazzo',
  cafe: 'terrazzo',
  stair: 'granite',
  wc: 'tile_cool',
  lab: 'tile_cool',
  room: 'tile_warm',
  drawing: 'tile_warm',
  hall: 'tile_warm',
  office: 'tile_warm',
  service: 'tile_cool',
  lift: 0x939ba4,
  locker: 0xdfd8c8,
  exit: 'granite',
  pending: 'tile_warm',
};

export const ARCH_CONSTANTS = {
  SLAB: 0.25,
  WALL_T: 0.20,
  EXT_T: 0.35,
  DOOR_W: 1.55,
  DOOR_H: 2.25,
  DADO_H: 1.15,
};

const { SLAB, WALL_T, EXT_T, DOOR_W, DOOR_H, DADO_H } = ARCH_CONSTANTS;

const DADO_CAP = 0x7a6048;
const SKIRT_COLOR = 0x5d5348;
const LIFT_BODY = 0xcfd5dc;
const LOCKER_BODY = 0xdad2c0;

const unitCentered = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
const texCache = new Map();

function mat(color, roughness = 0.86, metalness = 0.0) {
  const key = `${color}_${roughness}_${metalness}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return matCache.get(key);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPlasterMaterial(tintHex = '#f2ece1', key = 'plaster_in') {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ebe4d7');
  grad.addColorStop(0.18, tintHex);
  grad.addColorStop(0.88, tintHex);
  grad.addColorStop(1, '#e5ddd0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(4201);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(130,115,95,0.06)';
    g.fillRect(rnd() * 128, rnd() * 128, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.0 });
  texCache.set(key, m);
  return m;
}

function getTravertineMaterial() {
  if (texCache.has('travertine')) return texCache.get('travertine');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#d7c3a4';
  g.fillRect(0, 0, 128, 64);
  const rnd = mulberry32(9187);
  for (let i = 0; i < 28; i++) {
    const y = rnd() * 64;
    g.fillStyle = i % 2 === 0 ? 'rgba(150,122,90,0.12)' : 'rgba(248,240,226,0.16)';
    g.fillRect(0, y, 128, 1 + rnd() * 2.5);
  }
  g.strokeStyle = 'rgba(120,98,74,0.22)';
  g.lineWidth = 1;
  for (let x = 32; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.03 });
  texCache.set('travertine', m);
  return m;
}

// Shared tiled floor materials (reused across all rooms so GPU texture memory stays < 2 MB total!)
function getFloorMaterial(finish) {
  if (texCache.has(`floor_${finish}`)) return texCache.get(`floor_${finish}`);
  let m;
  if (finish === 'terrazzo') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#e7dac3';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(125,98,74,0.34)';
    g.lineWidth = 3;
    g.strokeRect(8, 8, 240, 240);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(145,118,92,0.22)';
    g.strokeRect(18, 18, 220, 220);
    const rnd = mulberry32(5521);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(122,98,74,0.16)' : 'rgba(255,252,246,0.25)';
      g.fillRect(rnd() * 256, rnd() * 256, 1.8, 1.8);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.28, 0.28);
    m = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.36, metalness: 0.04,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
  } else if (finish === 'tile_cool' || finish === 'tile_warm' || finish === 'granite') {
    const cool = finish === 'tile_cool';
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = cool ? '#dfe5ea' : '#e8e3d9';
    g.fillRect(0, 0, 128, 128);
    const rnd = mulberry32(cool ? 771 : 331);
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const delta = (rnd() - 0.5) * 8;
        const base = cool ? [222, 228, 233] : [231, 226, 216];
        g.fillStyle = `rgb(${Math.round(base[0] + delta)},${Math.round(base[1] + delta)},${Math.round(base[2] + delta)})`;
        g.fillRect(tx * 32 + 1, ty * 32 + 1, 30, 30);
      }
    }
    g.strokeStyle = cool ? 'rgba(138,148,158,0.34)' : 'rgba(150,140,126,0.32)';
    g.lineWidth = 1;
    for (let p = 0; p <= 128; p += 32) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 128); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(128, p); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(0.42, 0.42);
    m = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.46, metalness: 0.02,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
  } else {
    m = new THREE.MeshStandardMaterial({
      color: finish, roughness: 0.5, metalness: 0.02,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
  }
  texCache.set(`floor_${finish}`, m);
  return m;
}

function getAcousticCeilingMaterial() {
  if (texCache.has('ceiling_grid')) return texCache.get('ceiling_grid');
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(165,160,150,0.42)';
  g.lineWidth = 1.5;
  for (let p = 0; p <= 128; p += 32) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 128); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(128, p); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.42, 0.42);
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xf7f5f0,
    emissive: 0x35322d,
    emissiveIntensity: 0.38,
    roughness: 0.90,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  texCache.set('ceiling_grid', m);
  return m;
}

function createCeilingMaterial(cutUniform) {
  const m = getAcousticCeilingMaterial().clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCutaway = cutUniform;
    shader.fragmentShader = 'uniform float uCutaway;\n' + shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n\tif (uCutaway > 0.5) discard;',
    );
  };
  return m;
}

const glassMat = new THREE.MeshStandardMaterial({
  color: 0xa8c6db,
  roughness: 0.14,
  metalness: 0.25,
  transparent: true,
  opacity: 0.65,
});

const railGlassMat = new THREE.MeshStandardMaterial({
  color: 0xbcd6e6,
  roughness: 0.12,
  metalness: 0.2,
  transparent: true,
  opacity: 0.48,
});

const ledPanelMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6e6,
  emissiveIntensity: 0.95,
  roughness: 0.25,
  metalness: 0.0,
});

// Fast per-floor instanced box batcher (supports arbitrary 3D position, Euler rotation, and scale)
function createArchBatcher(collisionWorld = null, floorIndex = 0, levelY = 0) {
  const buckets = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), eul = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3();

  function add(material, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0, collide = false, tag = 'wall') {
    if (sx <= 0.004 || sy <= 0.004 || sz <= 0.004) return;
    let bucket = buckets.get(material);
    if (!bucket) { bucket = { collide: false, list: [] }; buckets.set(material, bucket); }
    if (collide) {
      bucket.collide = true;
      if (collisionWorld && tag && Math.abs(rx) < 0.05 && Math.abs(rz) < 0.05) {
        collisionWorld.addSolidBox(floorIndex, px, levelY + py - sy * 0.5, levelY + py + sy * 0.5, pz, sx, sz, ry, tag);
      }
    }
    bucket.list.push([px, py, pz, sx, sy, sz, rx, ry, rz]);
  }

  function flush(group, colliders) {
    for (const [material, bucket] of buckets) {
      if (!bucket.list.length) continue;
      const im = new THREE.InstancedMesh(unitCentered, material, bucket.list.length);
      bucket.list.forEach(([px, py, pz, sx, sy, sz, rx, ry, rz], i) => {
        eul.set(rx, ry, rz);
        q.setFromEuler(eul);
        im.setMatrixAt(i, m.compose(p.set(px, py, pz), q, s.set(sx, sy, sz)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = !material.transparent;
      im.receiveShadow = !material.transparent;
      im.name = 'arch-batch';
      group.add(im);
      if (bucket.collide && colliders) colliders.push(im);
    }
  }

  return { add, flush };
}

function batchWall(B, ax, ay, bx, by, h, t, material, yCenter = h / 2, withTrim = true, tag = 'wall') {
  const dx = bx - ax, dz = -(by - ay);
  const len = Math.hypot(dx, dz);
  if (len < 0.05 || h <= 0.02) return null;
  const cx = (ax + bx) / 2, cz = -(ay + by) / 2;
  const ang = -Math.atan2(dz, dx);
  B.add(material, cx, yCenter, cz, len + t, h, t, 0, ang, 0, true, tag);
  if (withTrim && h > 2.4) {
    const skirtH = 0.085;
    B.add(mat(SKIRT_COLOR, 0.55), cx, skirtH / 2, cz, len + t + 0.016, skirtH, t + 0.028, 0, ang, 0, false);
    const dadoBodyH = DADO_H - skirtH;
    B.add(getTravertineMaterial(), cx, skirtH + dadoBodyH / 2, cz, len + t + 0.012, dadoBodyH, t + 0.022, 0, ang, 0, false);
    B.add(mat(DADO_CAP, 0.48), cx, DADO_H + 0.022, cz, len + t + 0.02, 0.045, t + 0.04, 0, ang, 0, false);
  }
  return { cx, cz, ang };
}

function rectWalls(B, [x0, y0, x1, y1], h, material, tag = 'wall') {
  for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
    batchWall(B, a, b, c, d, h, WALL_T, material, h / 2, true, tag);
  }
}

function atriumBalustrade(B, [x0, y0, x1, y1]) {
  const railH = 1.08;
  const steelMat = mat(0x5a6572, 0.35, 0.65);
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  for (const [ax, ay, bx, by] of edges) {
    const dx = bx - ax, dz = -(by - ay), len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const ang = -Math.atan2(dz, dx);
    const cx = (ax + bx) / 2, cz = -(ay + by) / 2;
    // Register full 1.08 m safety guardrail barrier into 3D character collision world
    B.add(getTravertineMaterial(), cx, 0.06, cz, len + 0.14, 0.12, 0.14, 0, ang, 0, false);
    B.add(railGlassMat, cx, railH * 0.5, cz, len + 0.10, railH, 0.14, 0, ang, 0, true, 'railing');
    B.add(steelMat, cx, railH, cz, len + 0.12, 0.055, 0.075, 0, ang, 0, false);
    const nPosts = Math.max(2, Math.round(len / 1.8) + 1);
    for (let i = 0; i < nPosts; i++) {
      const t = i / (nPosts - 1);
      B.add(steelMat, ax + (bx - ax) * t, railH / 2, -(ay + (by - ay) * t), 0.05, railH, 0.05, 0, 0, 0, false);
    }
  }
}

function rectWallsWithDoors(B, r, h, material, F) {
  const [x0, y0, x1, y1] = r.rect;
  const edges = { s: [x0, y0, x1, y0], e: [x1, y0, x1, y1], n: [x1, y1, x0, y1], w: [x0, y1, x0, y0] };
  const doorW = Math.min(DOOR_W, Math.max(0.95, Math.min(x1 - x0, y1 - y0) * 0.55));
  const doorH = Math.min(DOOR_H, h - 0.45);
  const doors = roomCells(r)
    .map(([cx0, cy0, cx1, cy1]) => ({
      s: [(cx0 + cx1) / 2, cy0],
      n: [(cx0 + cx1) / 2, cy1],
      e: [cx1, (cy0 + cy1) / 2],
      w: [cx0, (cy0 + cy1) / 2],
    })[r.door])
    .filter(([x, y]) => (r.door === 'n' || r.door === 's')
      ? Math.abs(y - (r.door === 'n' ? y1 : y0)) < 0.02
      : Math.abs(x - (r.door === 'e' ? x1 : x0)) < 0.02);

  for (const [side, [a, b, c, d]] of Object.entries(edges)) {
    const gaps = side === r.door ? doors.map((at) => ({ at, width: doorW })) : [];
    for (const [ax, ay, bx, by] of edgeWithGaps([a, b], [c, d], gaps)) {
      batchWall(B, ax, ay, bx, by, h, WALL_T, material, h / 2, true, 'wall');
    }
  }
  const horiz = r.door === 'n' || r.door === 's';
  for (const at of doors) {
    const [ax, ay, bx, by] = horiz
      ? [at[0] - doorW / 2, at[1], at[0] + doorW / 2, at[1]]
      : [at[0], at[1] - doorW / 2, at[0], at[1] + doorW / 2];
    const lintelH = h - doorH;
    const lin = batchWall(B, ax, ay, bx, by, lintelH, WALL_T, material, doorH + lintelH / 2, false, 'door_frame');
    if (lin && lintelH > 0.55) {
      B.add(glassMat, lin.cx, doorH + 0.28, lin.cz, doorW - 0.12, 0.42, WALL_T + 0.03, 0, lin.ang, 0, false);
    }
    doorLeaves(F, r.door, at, doorW, doorH);
  }
}

function exteriorWindows(B, segs, clearH) {
  const winH = Math.min(1.85, clearH - 1.35);
  const winCenterY = 0.92 + winH / 2;
  const frameMat = mat(0xf5f4f0, 0.5);
  const travMat = getTravertineMaterial();
  for (const [ax, ay, bx, by] of segs) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.floor((len - 1.0) / 3.6);
    if (n < 1) continue;
    const ang = -Math.atan2(-(by - ay), bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = ax + (bx - ax) * t, pz = -(ay + (by - ay) * t);
      B.add(frameMat, px, winCenterY, pz, 2.05, winH + 0.14, EXT_T + 0.06, 0, ang, 0, false);
      B.add(glassMat, px, winCenterY, pz, 1.86, winH - 0.06, EXT_T + 0.09, 0, ang, 0, false);
      B.add(travMat, px, 0.90, pz, 2.2, 0.07, EXT_T + 0.14, 0, ang, 0, false);
    }
  }
}

// Co-designed structural switchback stair geometry shared between interior.js, collision.js, and route.js.
// Guarantees 100% open shaft headroom (`>= +2.00 m`) above every step & half-landing on all 4 floors.
export function stairProfile(rect, rise) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const L = along1 - along0, W = cross1 - cross0;
  const eastLanding = Math.min(1.50, L * 0.16);
  const topApron = 0.35; // level bridge apron inside open shaft before slab rim
  const westLanding = Math.min(1.60, L * 0.17);
  const flightStart = along1 - eastLanding - topApron;
  const flightEnd = along0 + westLanding;
  const runLen = Math.max(2.4, flightStart - flightEnd);
  const nF = Math.max(4, Math.round(Math.max(8, Math.round(Math.abs(rise) / 0.22)) / 2));
  const n = nF * 2;
  const run = runLen / nF;
  const width = W * 0.44;
  const laneA = cross0 + width / 2 + 0.30;
  const laneB = cross1 - width / 2 - 0.30;
  const stepRise = rise / n, half = rise / 2;
  const P = (along, cross, h, land) => alongX
    ? { x: along, y: cross, h, ...(land ? { land: true } : {}) }
    : { x: cross, y: along, h, ...(land ? { land: true } : {}) };
  const steps = [], walk = [];
  for (let i = 0; i < nF; i++) {
    const p = P(flightStart - run * (i + 0.5), laneA, stepRise * (i + 1));
    steps.push(p); walk.push(p);
  }
  walk.push(P(along0 + westLanding * 0.55, laneA, half, true));
  walk.push(P(along0 + westLanding * 0.55, laneB, half, true));
  for (let j = 0; j < nF; j++) {
    const p = P(flightEnd + run * (j + 0.5), laneB, half + stepRise * (j + 1));
    steps.push(p); walk.push(p);
  }
  // Level top apron step flush at `h = rise` inside shaft cutout before stepping onto East Floor Landing
  walk.push(P(along1 - eastLanding - 0.10, laneB, rise, true));

  const landings = [
    { alongC: along0 + westLanding / 2, crossC: (cross0 + cross1) / 2, alongSize: westLanding, crossSize: (laneB - laneA) + width, h: half },
    { alongC: along1 - eastLanding - topApron / 2, crossC: laneB, alongSize: topApron + 0.16, crossSize: width, h: rise },
  ];
  const flights = [
    { from: flightStart, to: flightEnd, cross: laneA, hFrom: 0, hTo: half },
    { from: flightEnd, to: flightStart, cross: laneB, hFrom: half, hTo: rise },
  ];
  return {
    steps, walk, flights, landings, alongX, along0, along1, cross0, cross1,
    n, run, width, laneA, laneB, landingDepth: westLanding, eastLanding, topApron, flightStart, flightEnd,
  };
}

// Instanced structural reinforced-concrete switchback staircase (treads, nosings, risers, slanted stringers, landing, handrails)
function stairs(B, rect, rise, collisionWorld = null, floorIndex = 0, levelY = 0) {
  const prof = stairProfile(rect, rise);
  const { alongX, run, width, n } = prof;
  const stepRise = rise / n;
  const treadMat = mat(0xd8d0c1, 0.52, 0.02);
  const riserMat = mat(0xe6dfd3, 0.68, 0.0);
  const nosingMat = mat(0x4a5058, 0.6, 0.25);
  const soffitMat = mat(0xded7ca, 0.82, 0.0);
  const treadThick = 0.055;

  prof.steps.forEach((s, idx) => {
    const dirSign = idx < n / 2 ? -1 : 1;
    B.add(
      treadMat, s.x, s.h - treadThick / 2, -s.y,
      alongX ? run + 0.03 : width, treadThick, alongX ? width : run + 0.03,
    );
    const noseOffset = -dirSign * (run / 2 - 0.018);
    B.add(
      nosingMat,
      alongX ? s.x + noseOffset : s.x, s.h - 0.004, alongX ? -s.y : -(s.y + noseOffset),
      alongX ? 0.036 : width - 0.04, 0.012, alongX ? width - 0.04 : 0.036,
    );
    const riserOffset = -dirSign * (run / 2);
    B.add(
      riserMat,
      alongX ? s.x + riserOffset : s.x, s.h - stepRise / 2, alongX ? -s.y : -(s.y + riserOffset),
      alongX ? 0.035 : width, stepRise, alongX ? width : 0.035,
    );
  });

  // Ground transition step apron at start of Flight 1 so first tread joins flush with East Landing
  const [ax, ay, az] = alongX
    ? [prof.along1 - prof.eastLanding - prof.topApron / 2, -0.11, -prof.laneA]
    : [prof.laneA, -0.11, -(prof.along1 - prof.eastLanding - prof.topApron / 2)];
  B.add(
    treadMat, ax, ay, az,
    alongX ? prof.topApron + 0.16 : width, 0.22, alongX ? width : prof.topApron + 0.16,
  );

  const landingThick = 0.22;
  for (const l of prof.landings) {
    B.add(
      treadMat,
      alongX ? l.alongC : l.crossC, l.h - landingThick / 2, -(alongX ? l.crossC : l.alongC),
      alongX ? l.alongSize + 0.12 : l.crossSize, landingThick, alongX ? l.crossSize : l.alongSize + 0.12,
    );
    if (collisionWorld && Math.abs(l.h - rise * 0.5) < 0.2) {
      collisionWorld.addStairSoffit(
        floorIndex, alongX,
        l.crossC - l.crossSize * 0.5, l.crossC + l.crossSize * 0.5,
        l.alongC - l.alongSize * 0.5, l.alongC + l.alongSize * 0.5,
        levelY + l.h - landingThick, levelY + l.h - landingThick,
      );
    }
  }

  const railMat = mat(0x46525f, 0.36, 0.65);
  const [x0, y0, x1, y1] = rect;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1, midCross = (cross0 + cross1) / 2;
  const toXYZ = (along, cross, h) => (alongX ? [along, h, -cross] : [cross, h, -along]);

  for (const f of prof.flights) {
    const len = Math.abs(f.to - f.from), dh = f.hTo - f.hFrom;
    const slopeLen = Math.hypot(len, dh);
    const hAtMin = f.from < f.to ? f.hFrom : f.hTo;
    const hAtMax = f.from < f.to ? f.hTo : f.hFrom;
    const slopeAng = Math.atan2(hAtMax - hAtMin, len);
    const mid = (f.from + f.to) / 2;
    const [wx, wy, wz] = toXYZ(mid, f.cross, (f.hFrom + f.hTo) / 2 - stepRise * 0.72);
    B.add(
      soffitMat, wx, wy, wz,
      alongX ? slopeLen : width, 0.15, alongX ? width : slopeLen,
      alongX ? 0 : slopeAng, 0, alongX ? slopeAng : 0,
    );
    if (collisionWorld) {
      collisionWorld.addStairSoffit(
        floorIndex, alongX,
        f.cross - width * 0.5, f.cross + width * 0.5,
        f.from, f.to,
        levelY + f.hFrom - stepRise * 0.72 - 0.075,
        levelY + f.hTo - stepRise * 0.72 - 0.075,
      );
    }

    const insetStart = 0.35;
    const insetEnd = 0.35;
    const aStart = f.from < f.to ? f.from + insetStart : f.from - insetStart;
    const aEnd = f.from < f.to ? f.to - insetEnd : f.to + insetEnd;
    const rLen = Math.max(0.8, Math.abs(aEnd - aStart));
    const rMid = (aStart + aEnd) / 2;
    const fracMid = (rMid - Math.min(f.from, f.to)) / len;
    const hMid = hAtMin + (hAtMax - hAtMin) * fracMid;
    const railH = 0.90;
    const rSlopeLen = Math.hypot(rLen, dh * (rLen / len));
    const cross = f.cross + (f.cross < midCross ? 1 : -1) * (width / 2 - 0.05);

    const [rx, ry, rz] = toXYZ(rMid, cross, hMid + railH);
    B.add(
      railMat, rx, ry, rz,
      alongX ? rSlopeLen : 0.055, 0.055, alongX ? 0.055 : rSlopeLen,
      alongX ? 0 : slopeAng, 0, alongX ? slopeAng : 0,
    );
    const [rcx, , rcz] = toXYZ(rMid, cross, 0);
    if (collisionWorld) {
      collisionWorld.addSolidBox(
        floorIndex, rcx,
        levelY + Math.min(f.hFrom, f.hTo), levelY + Math.max(f.hFrom, f.hTo) + railH,
        rcz, alongX ? rLen : 0.07, alongX ? 0.07 : rLen, 0, 'railing',
      );
    }

    for (const fr of [0.12, 0.5, 0.88]) {
      const along = aStart + (aEnd - aStart) * fr;
      const frac = (along - Math.min(f.from, f.to)) / len;
      const hSurf = hAtMin + (hAtMax - hAtMin) * frac;
      const [px, py, pz] = toXYZ(along, cross, hSurf + railH / 2);
      B.add(railMat, px, py, pz, 0.05, railH, 0.05);
    }
  }
}

function label(text_en, text_ar, cls) {
  const el = document.createElement('div');
  el.className = 'room-label' + (cls ? ' ' + cls : '');
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

function doorSign(text_en, text_ar) {
  const el = document.createElement('div');
  el.className = 'door-sign';
  el.lang = 'ar'; el.dir = 'rtl';
  el.textContent = text_ar || text_en;
  if (text_en && text_en !== el.textContent) el.title = text_en;
  return new CSS2DObject(el);
}

function stairDoor(group, B, rect, wallH, wallMat, floorEn, floorAr, collisionWorld = null, floorIndex = 0, levelY = 0) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  const along0 = alongX ? x0 : y0, along1 = alongX ? x1 : y1;
  const cross0 = alongX ? y0 : x0, cross1 = alongX ? y1 : x1;
  const mid = (cross0 + cross1) / 2;
  const doorW = 1.60, doorH = 2.30;
  const pt = (along, cross) => (alongX ? [along, cross] : [cross, along]);

  for (const [a, b] of [
    [pt(along0, cross0), pt(along0, cross1)],
    [pt(along0, cross0), pt(along1, cross0)],
    [pt(along0, cross1), pt(along1, cross1)],
    [pt(along1, cross0), pt(along1, mid - doorW / 2)],
    [pt(along1, mid + doorW / 2), pt(along1, cross1)],
  ]) {
    batchWall(B, a[0], a[1], b[0], b[1], wallH, WALL_T, wallMat, wallH / 2, true, 'stair_wall');
  }

  const [la, lb] = [pt(along1, mid - doorW / 2), pt(along1, mid + doorW / 2)];
  const lintelH = wallH - doorH;
  batchWall(B, la[0], la[1], lb[0], lb[1], lintelH, WALL_T, wallMat, doorH + lintelH / 2, false, 'door_frame');

  // Double fire-rated oak door leaves folded 90 deg open outside jambs so full 1.60m opening & landing stay clear
  const leafW = doorW * 0.5 - 0.03;
  const doorGroup = new THREE.Group();
  doorGroup.name = 'floor-door';
  const woodLeafMat = mat(0x9b7650, 0.65);
  const handleMat = mat(0xadb5bd, 0.35, 0.7);
  for (const sgn of [-1, 1]) {
    const [hx, hy] = pt(along1 + WALL_T * 0.5 + leafW * 0.5 + 0.02, mid + sgn * (doorW * 0.5 + 0.04));
    const leaf = new THREE.Group();
    leaf.position.set(hx, 0, -hy);
    if (!alongX) leaf.rotation.y = Math.PI * 0.5;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(leafW, doorH, 0.055), woodLeafMat);
    panel.position.set(0, doorH / 2, 0);
    const vision = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.065), glassMat);
    vision.position.set(leafW * 0.14, doorH * 0.58, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.07), handleMat);
    handle.position.set(leafW * 0.34, 1.02, 0);
    leaf.add(panel, vision, handle);
    doorGroup.add(leaf);
    if (collisionWorld) {
      collisionWorld.addSolidBox(
        floorIndex, hx, levelY, levelY + doorH, -hy,
        alongX ? leafW : 0.06, alongX ? 0.06 : leafW, 0, 'door_frame',
      );
    }
  }
  group.add(doorGroup);

  const sign = doorSign(floorEn, floorAr);
  const sp = pt(along1 + 0.42, mid);
  sign.position.set(sp[0], doorH + 0.35, -sp[1]);
  group.add(sign);
  return sign;
}

function buildLiftCore(B, r, clearH, wallMat) {
  const [x0, y0, x1, y1] = r.rect;
  // Full architectural plaster + travertine marble wainscot enclosure on all 4 sides of elevator shaft
  rectWalls(B, r.rect, clearH, wallMat, 'lift');
  // Solid inner core fill so overhead cutaways never show an empty pit inside the elevator shaft
  B.add(mat(LIFT_BODY, 0.78, 0.04), (x0 + x1) / 2, clearH / 2, -(y0 + y1) / 2, Math.max(0.2, x1 - x0 - 0.16), clearH - 0.04, Math.max(0.2, y1 - y0 - 0.16), 0, 0, 0, true, 'lift');

  const face = r.door || 'e';
  const steelMat = mat(0xbcc5ce, 0.28, 0.76);
  const frameMat = mat(0x4b535d, 0.42, 0.55);
  const Out = WALL_T / 2 + 0.028;
  for (const [cx0, cy0, cx1, cy1] of roomCells(r)) {
    const cx = (cx0 + cx1) / 2, cy = (cy0 + cy1) / 2;
    const horiz = face === 'n' || face === 's';
    const px = face === 'e' ? x1 + Out : face === 'w' ? x0 - Out : cx;
    const py = face === 'n' ? y1 + Out : face === 's' ? y0 - Out : cy;
    const doorW = Math.min(1.12, (horiz ? (cx1 - cx0) : (cy1 - cy0)) * 0.68);
    B.add(frameMat, px, 2.22 / 2, -py, horiz ? doorW + 0.16 : 0.045, 2.22, horiz ? 0.045 : doorW + 0.16);
    const pxOut = face === 'e' ? px + 0.015 : face === 'w' ? px - 0.015 : px;
    const pyOut = face === 'n' ? py + 0.015 : face === 's' ? py - 0.015 : py;
    B.add(steelMat, pxOut, 2.14 / 2, -pyOut, horiz ? doorW : 0.045, 2.14, horiz ? 0.045 : doorW);
    B.add(frameMat, pxOut, 2.14 / 2, -pyOut, horiz ? 0.022 : 0.06, 2.14, horiz ? 0.06 : 0.022);
    B.add(ledPanelMat, pxOut, 2.34, -pyOut, horiz ? 0.26 : 0.05, 0.09, horiz ? 0.05 : 0.26);
  }
}

function addStructuralColumns(B, f, clearH) {
  const candidates = [];
  for (const r of f.rooms) {
    if (r.kind !== 'lobby' || !r.open) continue;
    const [x0, y0, x1, y1] = r.rect;
    if ((x1 - x0) < 7.5 || (y1 - y0) < 7.5) continue;
    const inset = 0.35;
    for (const cx of [x0 + inset, x1 - inset]) {
      for (const cy of [y0 + inset, y1 - inset]) {
        if (!candidates.some(([px, py]) => Math.hypot(px - cx, py - cy) < 2.2)) {
          candidates.push([cx, cy]);
        }
      }
    }
  }
  const colW = 0.42;
  const shaftMat = getPlasterMaterial('#efe8dc', 'col_plaster');
  const travMat = getTravertineMaterial();
  const capMat = mat(DADO_CAP, 0.5);
  for (const [cx, cy] of candidates) {
    B.add(shaftMat, cx, clearH / 2, -cy, colW, clearH, colW, 0, 0, 0, true, 'column');
    B.add(travMat, cx, DADO_H / 2, -cy, colW + 0.06, DADO_H, colW + 0.06);
    B.add(capMat, cx, DADO_H + 0.025, -cy, colW + 0.08, 0.05, colW + 0.08);
  }
}

function addCeilingLuminaires(B, f, clearH, ceilingHoleRects = []) {
  const bezelMat = mat(0xe4e7eb, 0.4, 0.3);
  const inCutout = (x, y) => ceilingHoleRects.some(
    ([hx0, hy0, hx1, hy1]) => x > hx0 - 0.75 && x < hx1 + 0.75 && y > hy0 - 0.75 && y < hy1 + 0.75,
  );
  for (const r of f.rooms) {
    if (r.kind === 'void' || r.kind === 'lift' || r.kind === 'locker') continue;
    if (r.kind === 'stair') {
      const [sx0, sy0, sx1, sy1] = r.rect;
      const alongX = (sx1 - sx0) >= (sy1 - sy0);
      const lx = alongX ? sx1 - 0.58 : (sx0 + sx1) / 2;
      const ly = alongX ? (sy0 + sy1) / 2 : sy1 - 0.58;
      if (!inCutout(lx, ly)) {
        B.add(bezelMat, lx, clearH - 0.015, -ly, 0.9, 0.025, 0.45);
        B.add(ledPanelMat, lx, clearH - 0.032, -ly, 0.82, 0.012, 0.38);
      }
      continue;
    }
    const [x0, y0, x1, y1] = r.rect;
    const w = x1 - x0, d = y1 - y0;
    if (w < 2.2 || d < 2.2) continue;
    const nx = Math.max(1, Math.round(w / 4.5));
    const ny = Math.max(1, Math.round(d / 4.5));
    const alongX = w >= d;
    const ang = alongX ? 0 : Math.PI / 2;
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        const px = x0 + w * ((ix + 0.5) / nx), py = y0 + d * ((iy + 0.5) / ny);
        if (inCutout(px, py)) continue;
        B.add(bezelMat, px, clearH - 0.015, -py, 1.18, 0.025, 0.58, 0, ang, 0);
        B.add(ledPanelMat, px, clearH - 0.032, -py, 1.10, 0.012, 0.50, 0, ang, 0);
      }
    }
  }
}

export function stairShaftHoleRect(rect) {
  const [x0, y0, x1, y1] = rect;
  const alongX = (x1 - x0) >= (y1 - y0);
  return alongX ? [x0 + 0.05, y0 + 0.05, x1 - 1.50, y1 - 0.05] : [x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 1.50];
}

function makeShapeWithHoles(footprint, holeRects) {
  const s = new THREE.Shape(footprint.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [x0, y0, x1, y1] of holeRects) {
    if (x1 - x0 > 0.2 && y1 - y0 > 0.2) {
      s.holes.push(new THREE.Path([
        new THREE.Vector2(x0, y0),
        new THREE.Vector2(x0, y1),
        new THREE.Vector2(x1, y1),
        new THREE.Vector2(x1, y0),
      ]));
    }
  }
  return s;
}

function edgeWithGaps(a, b, gaps) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const cuts = [];
  for (const g of gaps) {
    const t = ((g.at[0] - a[0]) * dx + (g.at[1] - a[1]) * dy) / (len * len);
    const px = a[0] + t * dx, py = a[1] + t * dy;
    if (t > 0 && t < 1 && Math.hypot(px - g.at[0], py - g.at[1]) < 1.2) {
      const half = g.width / 2 / len;
      cuts.push([Math.max(0, t - half), Math.min(1, t + half)]);
    }
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const segs = [];
  let s = 0;
  for (const [c0, c1] of cuts) { if (c0 > s) segs.push([s, c0]); s = c1; }
  if (s < 1) segs.push([s, 1]);
  return segs.map(([t0, t1]) => [a[0] + dx * t0, a[1] + dy * t0, a[0] + dx * t1, a[1] + dy * t1]);
}

export function buildInterior(data) {
  const root = new THREE.Group();
  root.name = `interior_${data.building_id}`;

  const indoorHemi = new THREE.HemisphereLight(0xfffaf2, 0xd8cdb8, 0.78);
  indoorHemi.name = 'interior-ambient-fill';
  root.add(indoorHemi);

  const collisionWorld = createCollisionWorld(data.footprint);

  const defaultRise = data.floors.length > 1
    ? (data.floors[1].level - data.floors[0].level)
    : (data.wall_height || 3.8);

  const wallMat = getPlasterMaterial('#f2ece1', 'plaster_in');
  const extMat = getPlasterMaterial('#eae0ce', 'plaster_ext');

  const floors = data.floors.map((f, fi) => {
    const g = new THREE.Group();
    g.name = `floor_${f.id}`;
    g.position.y = f.level;

    const rise = fi < data.floors.length - 1
      ? (data.floors[fi + 1].level - f.level)
      : (data.floors.length > 2 ? (data.floors[2].level - data.floors[1].level) : defaultRise);
    const clearH = Math.max(2.9, rise - SLAB);
    const colliders = [];
    const B = createArchBatcher(collisionWorld, fi, f.level);

    // 1. Structural floor slab with cutouts for double-height atrium voids AND rising stair shafts from floor below
    const floorHoleRects = f.rooms.filter((r) => r.kind === 'void').map((r) => r.rect);
    if (fi > 0) {
      for (const prevStair of data.floors[fi - 1].rooms.filter((r) => r.kind === 'stair')) {
        floorHoleRects.push(stairShaftHoleRect(prevStair.rect));
      }
    }
    const slabShape = makeShapeWithHoles(data.footprint, floorHoleRects);
    const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: SLAB, bevelEnabled: false });
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, mat(0xe6dfd2, 0.85));
    slab.name = `slab_${f.id}`;
    slab.position.y = -SLAB;
    slab.receiveShadow = true;
    g.add(slab);

    // 2. Solid 4 cm acoustic ceiling slab at y = clearH on EVERY occupied floor (`G`, `1`, `2`, `3`)
    const ceilingHoleRects = [];
    if (fi < data.floors.length - 1) {
      for (const curStair of f.rooms.filter((r) => r.kind === 'stair')) {
        ceilingHoleRects.push(stairShaftHoleRect(curStair.rect));
      }
      for (const nextVoid of data.floors[fi + 1].rooms.filter((r) => r.kind === 'void')) {
        ceilingHoleRects.push(nextVoid.rect);
      }
    }
    const cutUniform = { value: 0.0 };
    const ceilShape = makeShapeWithHoles(data.footprint, ceilingHoleRects);
    const ceilGeo = new THREE.ExtrudeGeometry(ceilShape, { depth: 0.04, bevelEnabled: false });
    ceilGeo.rotateX(-Math.PI / 2);
    const ceiling = new THREE.Mesh(ceilGeo, createCeilingMaterial(cutUniform));
    ceiling.name = `ceiling_${f.id}`;
    ceiling.position.y = clearH;
    g.add(ceiling);

    const nextLevel = fi < data.floors.length - 1 ? data.floors[fi + 1].level : f.level + rise;
    collisionWorld.addCeilingSlab(fi, f.level + clearH, nextLevel, ceilingHoleRects);

    // 3. Full-height exterior walls + mullioned windows
    const fp = data.footprint;
    const extSegs = [];
    for (let i = 0; i < fp.length; i++) {
      for (const seg of edgeWithGaps(fp[i], fp[(i + 1) % fp.length], f.entrances || [])) {
        batchWall(B, seg[0], seg[1], seg[2], seg[3], clearH, EXT_T, extMat, clearH / 2, true, 'ext_wall');
        extSegs.push(seg);
      }
    }
    exteriorWindows(B, extSegs, clearH);

    // 4. Batched floor patches, walls, open doors, stairs, lift cores, columns, lighting & furniture
    const labels = [];
    const furniture = createFurnisher((cx, cy, h0, sx, sy, sz, tag) => {
      collisionWorld.addPlanBox(fi, f.level, cx, cy, h0, sx, sy, sz, tag);
    });

    for (const r of f.rooms) {
      const [x0, y0, x1, y1] = r.rect;
      if (r.kind === 'void') {
        atriumBalustrade(B, r.rect);
      } else {
        const w = x1 - x0, d = y1 - y0;
        if (w > 0.05 && d > 0.05) {
          B.add(
            getFloorMaterial(KIND_FLOOR[r.kind] ?? KIND_FLOOR.room),
            (x0 + x1) / 2, 0.010, -(y0 + y1) / 2,
            w, 0.012, d,
          );
        }
      }

      if (!r.open && r.kind !== 'void' && r.kind !== 'lift') {
        if (r.kind === 'stair') {
          labels.push(stairDoor(g, B, r.rect, clearH, wallMat, f.name_en, f.name_ar, collisionWorld, fi, f.level));
        } else if (r.door) {
          rectWallsWithDoors(B, r, clearH, wallMat, furniture);
        } else {
          rectWalls(B, r.rect, clearH, wallMat, 'wall');
        }
      }

      furnishRoom(furniture, r);

      if (r.split > 1 && r.kind !== 'lift') {
        const alongX = (x1 - x0) >= (y1 - y0);
        for (let k = 1; k < r.split; k++) {
          if (alongX) {
            const xk = x0 + (x1 - x0) * (k / r.split);
            batchWall(B, xk, y0, xk, y1, clearH, WALL_T, wallMat, clearH / 2, true, 'wall');
          } else {
            const yk = y0 + (y1 - y0) * (k / r.split);
            batchWall(B, x0, yk, x1, yk, clearH, WALL_T, wallMat, clearH / 2, true, 'wall');
          }
        }
      }

      if (r.kind === 'stair' && fi < data.floors.length - 1) {
        stairs(B, r.rect, rise, collisionWorld, fi, f.level);
      }
      if (r.kind === 'lift') {
        buildLiftCore(B, r, clearH, wallMat);
      } else if (r.kind === 'locker') {
        B.add(mat(LOCKER_BODY, 0.62, 0.12), (x0 + x1) / 2, 0.91, -(y0 + y1) / 2, x1 - x0, 1.82, y1 - y0, 0, 0, 0, true, 'furniture');
      }

      if (r.nolabel) continue;
      const lab = label(r.name_en, r.name_ar, `kind-${r.kind}`);
      lab.position.set((x0 + x1) / 2, clearH + 0.35, -(y0 + y1) / 2);
      g.add(lab);
      labels.push(lab);
    }

    for (const e of f.entrances || []) {
      const lab = label(e.name_en, e.name_ar, 'entrance');
      const [ox, oy] = e.label_offset || [-3, 0];
      lab.position.set(e.at[0] + ox, 1.6, -(e.at[1] + oy));
      g.add(lab);
      labels.push(lab);
    }

    addStructuralColumns(B, f, clearH);
    addCeilingLuminaires(B, f, clearH, ceilingHoleRects);
    B.flush(g, colliders);
    const furnitureGroup = new THREE.Group();
    furnitureGroup.name = `furniture_${f.id}`;
    furniture.build(furnitureGroup);
    g.add(furnitureGroup);
    root.add(g);

    return {
      id: f.id,
      name_en: f.name_en,
      name_ar: f.name_ar,
      level: f.level,
      rise,
      clearH,
      ceilingHoleRects,
      floorHoleRects,
      slab,
      ceiling,
      cutUniform,
      group: g,
      furnitureGroup,
      labels,
      colliders,
    };
  });

  let sliceIdx = floors.length - 1;
  let activeLabelIdx = 0;

  function applyVisibility(camY = -Infinity, tourActive = true) {
    const topSlice = floors[sliceIdx] || floors[floors.length - 1];
    // Cutaway top slice ONLY when aerial camera orbits well above the selected floor's roof (`+3.5m` clearance)
    const aerialCutaway = !tourActive && camY > topSlice.level + topSlice.clearH + 3.5;
    floors.forEach((f, i) => {
      f.group.visible = i <= sliceIdx;
      f.ceiling.visible = i <= sliceIdx;
      f.cutUniform.value = (aerialCutaway && i === sliceIdx) ? 1.0 : 0.0;
      f.furnitureGroup.visible = Math.abs(i - activeLabelIdx) <= 1;
      for (const l of f.labels) l.visible = (i === activeLabelIdx);
    });
  }

  function setVisibleFloors(maxGeomIdx, labelIdx = maxGeomIdx) {
    sliceIdx = Math.max(0, Math.min(floors.length - 1, maxGeomIdx));
    activeLabelIdx = Math.max(0, Math.min(floors.length - 1, labelIdx));
    applyVisibility(-Infinity, true);
  }

  function setFloor(idx, camY = Infinity) {
    sliceIdx = Math.max(0, Math.min(floors.length - 1, idx));
    activeLabelIdx = sliceIdx;
    applyVisibility(camY, false);
  }

  function syncCameraCutaway(camY, tourActive) {
    applyVisibility(camY, tourActive);
  }

  return { group: root, data, floors, collisionWorld, setFloor, setVisibleFloors, syncCameraCutaway };
}

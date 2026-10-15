// EPNU interactive 3D campus guide.
// Three.js r186 (vendored in ./lib, no CDN). Model: models/campus_model.glb (Draco + EXT_mesh_gpu_instancing + WebP).
// Building metadata comes from glTF extras (Blender custom properties) and data/buildings.json.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const IS_SMALL = window.matchMedia('(max-width: 720px)').matches;
const QA_MODE = params.get('qa') === '1';   // automated tests on software WebGL: no shadows/AA, DPR 1
const LOW_MEM = (navigator.deviceMemory && navigator.deviceMemory <= 4) || false;
let quality = params.get('quality') || ((IS_SMALL || LOW_MEM) ? 'lite' : 'high');
const MODEL_URL = { high: 'models/campus_model.glb', lite: 'models/campus_model_mobile.glb' };

// Display order of interactive items (stable IDs shared with the .blend / .glb / buildings.json)
const ORDER = ['gate_1', 'bld_main', 'bld_w2', 'bld_w1', 'bld_h1', 'bld_h2', 'bld_e1', 'bld_e2', 'bld_s3', 'bld_s2', 'bld_s1', 'lm_gazebo_garden', 'lm_sports_pitch'];

const state = {
  renderer: null, labelRenderer: null, scene: null, camera: null, controls: null, root: null,
  items: new Map(), // id -> {id, object, info, box, center, size, label}
  selected: null, labelsOn: true, anim: null, needsRender: true, info: {},
  overview: { pos: new THREE.Vector3(-260, 300, 330), target: new THREE.Vector3(0, 0, 5) },
};

// ---------------------------------------------------------------- init
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl'); }
  catch (e) { return false; }
}

function showError(msg) {
  $('loading').classList.add('hidden');
  $('error-text').textContent = msg;
  $('error').classList.remove('hidden');
  $('btn-retry-lite').classList.toggle('hidden', quality === 'lite');
}

function setProgress(frac, text) {
  $('bar-fill').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (text) $('loading-detail').textContent = text;
}

function initThree() {
  const host = $('canvas-host');
  const renderer = new THREE.WebGLRenderer({ antialias: !QA_MODE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(QA_MODE ? 1 : Math.min(window.devicePixelRatio || 1, IS_SMALL ? 1.5 : 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !IS_SMALL && !QA_MODE;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('tabindex', '0');
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of the campus');

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(host.clientWidth, host.clientHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e3);
  scene.fog = new THREE.Fog(0xd8d3c8, 900, 3200);

  const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 1, 6000);
  camera.position.copy(state.overview.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(state.overview.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;       // stay above ground
  controls.minDistance = 12; controls.maxDistance = 1400;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.addEventListener('change', () => { state.needsRender = true; clampTarget(); });
  controls.addEventListener('start', () => { state.anim = null; });

  // lighting: sun from the south-east (as in the Blender scene / source footage), sky fill
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.position.set(182, 306, 182);                     // azimuth 135 deg, elevation ~50 deg (north = -Z)
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun); scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xdfe9f5, 0xb59a73, 0.9));

  Object.assign(state, { renderer, labelRenderer, scene, camera, controls, sun });
  window.addEventListener('resize', onResize);
}

function loadSky() {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load('assets/sky_equirect.jpg', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
      state.scene.background = tex;
      const pmrem = new THREE.PMREMGenerator(state.renderer);
      state.scene.environment = pmrem.fromEquirectangular(tex).texture;
      state.scene.environmentIntensity = 0.6;
      pmrem.dispose(); state.needsRender = true; resolve(true);
    }, undefined, () => { console.warn('sky texture failed - using plain background'); resolve(false); });
  });
}

async function loadInfo() {
  try {
    const r = await fetch('data/buildings.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    state.info = await r.json();
  } catch (e) { console.warn('buildings.json not loaded; using glTF extras only', e); state.info = {}; }
}

function loadModel(url) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    const draco = new DRACOLoader(manager).setDecoderPath('lib/three/examples/jsm/libs/draco/gltf/');
    const loader = new GLTFLoader(manager).setDRACOLoader(draco);
    loader.load(url, (gltf) => resolve(gltf), (ev) => {
      if (ev.lengthComputable) setProgress(0.1 + 0.8 * ev.loaded / ev.total, `Downloading model ${(ev.loaded / 1e6).toFixed(1)} / ${(ev.total / 1e6).toFixed(1)} MB`);
      else setProgress(0.5, `Downloading model ${(ev.loaded / 1e6).toFixed(1)} MB`);
    }, (err) => reject(err));
  });
}

// ---------------------------------------------------------------- scene setup after load
function registerItems(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (m && m.map) m.map.anisotropy = Math.min(8, state.renderer.capabilities.getMaxAnisotropy());
    }
    const ud = o.userData || {};
    if (ud.building_id && ud.selectable && !state.items.has(ud.building_id)) {
      state.items.set(ud.building_id, { id: ud.building_id, object: o });
    }
  });
  // ground does not need to cast shadows
  root.traverse((o) => { if (o.isMesh && /TERRAIN|ROADS/.test(o.name)) o.castShadow = false; });

  for (const it of state.items.values()) {
    const box = new THREE.Box3().setFromObject(it.object);
    it.box = box; it.center = box.getCenter(new THREE.Vector3()); it.size = box.getSize(new THREE.Vector3());
    const ud = it.object.userData;
    const js = state.info[it.id] || {};
    it.info = {
      name_en: ud.name_en || js.name_en || it.id, name_ar: ud.name_ar || js.name_ar || '',
      category: ud.category || js.category || '', description: ud.description || js.description || '',
      evidence: ud.evidence || js.evidence || '', storeys: ud.storeys || js.storeys || null,
      height: ud.height_m || null, sfm: ud.sfm_height || js.sfm_height_m || '', osm: ud.osm_way || '',
    };
    // label
    const el = document.createElement('div');
    el.className = 'label3d'; el.dataset.id = it.id;
    el.textContent = it.info.name_en; el.title = `${it.info.name_en} — ${it.info.name_ar}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); select(it.id, true); });
    const lab = new CSS2DObject(el);
    lab.position.set(it.center.x, it.box.max.y + 4, it.center.z);
    state.scene.add(lab); it.label = lab;
  }
  buildList();
}

function shortId(id) { return id.replace(/^bld_|^lm_|^gate_/, (m) => (m === 'gate_' ? 'gate ' : '')).toUpperCase(); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function orderedIds() { const ids = ORDER.filter((id) => state.items.has(id)); for (const id of state.items.keys()) if (!ids.includes(id)) ids.push(id); return ids; }

function buildList() {
  const ul = $('building-list'); ul.innerHTML = '';
  for (const id of orderedIds()) {
    const it = state.items.get(id);
    const li = document.createElement('li');
    const b = document.createElement('button'); b.dataset.id = id;
    b.innerHTML = `<span>${escapeHtml(it.info.name_en)}</span><span class="ar" lang="ar">${escapeHtml(it.info.name_ar)}</span><span class="cat">${escapeHtml(it.info.category)}</span>`;
    b.addEventListener('click', () => { select(id, true); if (IS_SMALL) togglePanel('list-panel', false); });
    li.appendChild(b); ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- selection & camera
let highlight = null;
function select(id, fly) {
  const it = state.items.get(id);
  if (!it) return;
  state.selected = id;
  if (highlight) { state.scene.remove(highlight); highlight.geometry.dispose(); }
  const b = it.box.clone().expandByScalar(1.2);
  highlight = new THREE.Box3Helper(b, new THREE.Color(0xf2a33a)); highlight.material.depthTest = false; highlight.renderOrder = 10;
  state.scene.add(highlight);
  document.querySelectorAll('.label3d').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  document.querySelectorAll('#building-list button').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  showInfo(it);
  if (fly) flyToItem(it);
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  state.needsRender = true;
}

function clearSelection() {
  state.selected = null;
  if (highlight) { state.scene.remove(highlight); highlight = null; }
  document.querySelectorAll('.label3d.active, #building-list button.active').forEach((el) => el.classList.remove('active'));
  togglePanel('info-panel', false);
  history.replaceState(null, '', location.pathname + location.search);
  state.needsRender = true;
}

function showInfo(it) {
  const i = it.info;
  $('info-name').textContent = i.name_en; $('info-name-ar').textContent = i.name_ar;
  $('info-category').textContent = i.category; $('info-desc').textContent = i.description;
  const facts = [];
  if (i.storeys) facts.push(['Storeys', String(i.storeys)]);
  if (i.height) facts.push(['Approx. height', `${i.height} m (reconstructed)`]);
  if (/^bld_/.test(it.id) && it.id !== 'bld_main') facts.push(['Faculty', 'Not confirmed by available sources']);
  if (i.osm) facts.push(['Footprint', `OSM way ${i.osm}`]);
  $('info-facts').innerHTML = facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  $('info-evidence-text').textContent = i.evidence + (i.sfm ? ` Photogrammetric roof height: ${i.sfm}.` : '');
  $('info-id').textContent = it.id;
  togglePanel('info-panel', true);
}

function flyTo(pos, target, ms = 1200) {
  state.anim = { p0: state.camera.position.clone(), t0: state.controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms };
}

function flyToItem(it) {
  const r = Math.max(it.size.x, it.size.z, it.size.y * 1.5) * 0.5;
  // use the narrower of the vertical / horizontal field of view (portrait phones)
  const vHalf = THREE.MathUtils.degToRad(state.camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * state.camera.aspect);
  const narrow = IS_SMALL ? 1.35 : 1.15;
  const dist = Math.max(45, r / Math.tan(Math.min(vHalf, hHalf)) * narrow);
  // view from the plaza side when possible (towards campus centre), elevated ~35 deg
  const centre = new THREE.Vector3(30, 0, -20);
  let dir = it.center.clone().sub(centre); dir.y = 0;
  if (dir.lengthSq() < 1) dir.set(-1, 0, 1);
  dir.normalize().multiplyScalar(-1);
  const az = Math.atan2(dir.z, dir.x) + 0.35;
  const el = THREE.MathUtils.degToRad(35);
  const target = it.center.clone(); target.y = Math.min(it.center.y, 8);
  if (IS_SMALL) target.y -= dist * 0.22;   // bottom-sheet panel covers the lower half: show the item in the upper part
  const pos = new THREE.Vector3(target.x + Math.cos(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.sin(az) * Math.cos(el) * dist);
  flyTo(pos, target);
}

function step(delta) {
  const ids = orderedIds(); if (!ids.length) return;
  let i = ids.indexOf(state.selected);
  i = i < 0 ? (delta > 0 ? 0 : ids.length - 1) : (i + delta + ids.length) % ids.length;
  select(ids[i], true);
}

function clampTarget() {
  const t = state.controls.target; const lim = 380;
  t.x = THREE.MathUtils.clamp(t.x, -lim, lim); t.z = THREE.MathUtils.clamp(t.z, -lim, lim); t.y = THREE.MathUtils.clamp(t.y, -80, 60);
}

// ---------------------------------------------------------------- picking & hover
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickId(clientX, clientY) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, state.camera);
  const hits = raycaster.intersectObject(state.root, true);
  for (const h of hits) {
    let o = h.object;
    while (o) { if (o.userData && o.userData.building_id && o.userData.selectable) return o.userData.building_id; o = o.parent; }
    if (/TERRAIN/.test(h.object.name)) return null;     // ground hit first - nothing selectable in front
  }
  return null;
}

function initPointer() {
  const el = state.renderer.domElement; let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 6 && performance.now() - down.t < 600) {
      const id = pickId(e.clientX, e.clientY);
      if (id) select(id, true); else if (state.selected) clearSelection();
    }
    down = null;
  });
  let hoverRaf = 0;
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || down) return;
    cancelAnimationFrame(hoverRaf);
    hoverRaf = requestAnimationFrame(() => {
      const id = pickId(e.clientX, e.clientY);
      const tip = $('tooltip');
      if (id) {
        const it = state.items.get(id);
        tip.textContent = it.info.name_en; tip.style.left = e.offsetX + 'px'; tip.style.top = e.offsetY + 'px';
        tip.classList.remove('hidden'); el.style.cursor = 'pointer';
      } else { tip.classList.add('hidden'); el.style.cursor = ''; }
    });
  });
  el.addEventListener('pointerleave', () => $('tooltip').classList.add('hidden'));
}

// ---------------------------------------------------------------- UI
function togglePanel(id, show) {
  const p = $(id); const vis = show ?? p.classList.contains('hidden');
  p.classList.toggle('hidden', !vis);
  if (id === 'list-panel') $('btn-list').setAttribute('aria-expanded', String(vis));
  if (IS_SMALL && vis) { if (id === 'list-panel') $('info-panel').classList.add('hidden'); if (id === 'info-panel') $('list-panel').classList.add('hidden'); }
}

function initUI() {
  $('btn-overview').addEventListener('click', () => { clearSelection(); flyTo(state.overview.pos, state.overview.target); });
  $('btn-prev').addEventListener('click', () => step(-1));
  $('btn-next').addEventListener('click', () => step(1));
  $('info-prev').addEventListener('click', () => step(-1));
  $('info-next').addEventListener('click', () => step(1));
  $('btn-labels').addEventListener('click', () => {
    state.labelsOn = !state.labelsOn;
    $('canvas-host').classList.toggle('labels-off', !state.labelsOn);
    $('btn-labels').setAttribute('aria-pressed', String(state.labelsOn));
  });
  $('btn-list').addEventListener('click', () => togglePanel('list-panel'));
  $('btn-help').addEventListener('click', () => togglePanel('help'));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.close; if (id === 'info-panel') clearSelection(); else togglePanel(id, false);
  }));
  $('btn-retry').addEventListener('click', () => location.reload());
  $('btn-retry-lite').addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('quality', 'lite'); location.href = u.toString(); });
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Home') { clearSelection(); flyTo(state.overview.pos, state.overview.target); }
    else if (e.key === 'l' || e.key === 'L') $('btn-labels').click();
    else if (e.key === '?') togglePanel('help');
    else if (e.key === 'Escape') { ['help', 'list-panel'].forEach((p) => togglePanel(p, false)); if (state.selected) clearSelection(); }
  });
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (state.items.has(id) && id !== state.selected) select(id, true); });
}

function onResize() {
  const host = $('canvas-host'); const w = host.clientWidth, h = host.clientHeight;
  state.camera.aspect = w / h; state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h); state.labelRenderer.setSize(w, h); state.needsRender = true;
}

// ---------------------------------------------------------------- loop
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  if (state.anim) {
    const a = state.anim; const t = Math.min(1, (now - a.start) / a.ms); const k = ease(t);
    state.camera.position.lerpVectors(a.p0, a.p1, k); state.controls.target.lerpVectors(a.t0, a.t1, k);
    if (t >= 1) state.anim = null;
    state.needsRender = true;
  }
  const changed = state.controls.update();
  if (changed) state.needsRender = true;
  const az = state.controls.getAzimuthalAngle();
  $('compass').firstElementChild.style.transform = `rotate(${THREE.MathUtils.radToDeg(az)}deg)`;
  if (state.needsRender) {
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
    state.needsRender = false;
  }
}

// ---------------------------------------------------------------- main
async function main() {
  if (!webglAvailable()) { showError('Your browser or device does not support WebGL, which is required for the 3D view.'); return; }
  try {
    initThree(); initUI(); initPointer();
    setProgress(0.03, 'Loading building data');
    await loadInfo();
    setProgress(0.06, 'Loading sky');
    await loadSky();
    setProgress(0.1, `Downloading model (${quality === 'lite' ? 'lightweight' : 'full'} version)`);
    const gltf = await loadModel(MODEL_URL[quality]);
    setProgress(0.95, 'Preparing scene');
    state.root = gltf.scene; state.scene.add(gltf.scene);
    registerItems(gltf.scene);
    $('loading').classList.add('hidden');
    state.needsRender = true;
    requestAnimationFrame(loop);
    const id = location.hash.slice(1);
    if (state.items.has(id)) setTimeout(() => select(id, true), 300);
    window.__campus = { state, select, step, items: () => [...state.items.keys()], quality };   // QA / integration hook
  } catch (err) {
    console.error(err);
    showError(`Loading failed: ${err && err.message ? err.message : err}. Check your connection and try again.`);
  }
}
main();

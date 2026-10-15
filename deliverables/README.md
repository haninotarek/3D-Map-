# EPNU Campus 3D Model: Deliverables

**Campus:** East Port Said National University (E.P.N.U), جامعة شرق بورسعيد الأهلية. Salam Misr El-Gedida, East Port Said, Egypt.
**Model type:** evidence-based hybrid reconstruction. Footprints come from OpenStreetMap, checked against 2022 satellite imagery. Heights and plaza layout come from photogrammetry of the supplied video (COLMAP). Architecture is modelled procedurally in Blender. It is **not a survey**; see `reconstruction_report.md` for accuracy and limitations.

## Folder contents

| Path | What it is |
|---|---|
| `campus_model.glb` | Web model, self-contained: 1.15 MB, Draco geometry, WebP textures, EXT_mesh_gpu_instancing. Building IDs and metadata are stored as glTF `extras`. |
| `campus_model_mobile.glb` | Lightweight variant (0.72 MB): 2048 px ground texture, other textures halved. The viewer loads it automatically on narrow screens and low-memory devices. |
| `campus_model.blend` | Blender 4.5 LTS source scene with collections, named objects, materials, cameras and lights. Textures are linked relatively from `textures/`. |
| `textures/` | All texture assets: PBR sets (`*_basecolor`, `*_normal`, `*_roughness`), façade bays, signage and the 4096 px ground plan. |
| `renders/` | Preview renders (Cycles): overview, aerial, ground-level views, plus an exact SfM-camera match. |
| `web_viewer/` | Interactive Three.js campus guide, ready to deploy as static files (see below). |
| `qa/` | Automated browser QA screenshots (desktop 1440×900, mobile 390×844) and `qa_results.json`. |
| `data/` | `buildings.json` (stable IDs and info-panel text), `site_layout.json`, `osm_footprints_local.json`, `palette.json`, `model_stats.json`. |
| `photogrammetry/` | COLMAP results: registration JSON, metric orthophoto, sparse point cloud (PLY), building height statistics. |
| `pipeline/` | Every script used, so the model can be rebuilt and extended (see "Rebuilding"). |
| `reconstruction_report.md` | Method, evidence classification (Verified / Estimated / Unknown), accuracy, QA and limitations. |
| `source_analysis.md` | Phase-1 source inventory and analysis notes. |

## Coordinate system
- **Local ENU, metres.** Origin is lat 31.0198510, lon 32.6275438 (centre of the campus fence). In Blender, +X is East, +Y is North and +Z is Up.
- **glTF** uses its usual convention: +Y up, North = −Z, East = +X.
- `pipeline/geo.py` converts between WGS84 and local metres.

## Stable building IDs (shared by `.blend`, `.glb`, viewer and `buildings.json`)

| ID | Name | Notes |
|---|---|---|
| `bld_main` | Main Building (المبنى الرئيسي) | 3 storeys plus dome, on the Gate No. 1 axis |
| `bld_w1`, `bld_w2` | Academic Blocks W1, W2 | West column, 4 storeys |
| `bld_s1`, `bld_s2`, `bld_s3` | Academic Blocks S1–S3 | South row, U-plan, 4 storeys |
| `bld_e1`, `bld_e2` | Academic Blocks E1, E2 | East column, 4 storeys. E1 is the building marked in the supplied photo |
| `bld_h1`, `bld_h2` | Hall / Workshop H1, H2 | North-west, 2 storeys plus pitched-roof hall |
| `gate_1` | Gate No. 1 (بوابة رقم ١) | Main entrance, west side |
| `lm_gazebo_garden` | Central Gazebo Garden | Landscape landmark |
| `lm_sports_pitch` | Sports Pitch | Fenced artificial turf |

The codes W1, S2, etc. are **model identifiers, not official names**. Building letters seen on signs (B, H, I) and the faculty for each building could not be linked to specific buildings from the sources. Add them in `data/buildings.json` (and optionally the Blender custom properties) once the university confirms them; the viewer picks up the new text automatically.

## Running the web viewer locally
```bash
cd web_viewer
python3 serve.py 8080          # or any static server, e.g. `npx serve .`
# open http://localhost:8080/
```
The viewer needs to be served over HTTP; it will not load from `file://` because of ES modules and fetch.

URL options:
- `?quality=lite` or `?quality=high` forces the model variant.
- `#bld_main` (any ID) opens the guide with that building selected. Use this to link from faculty pages.

## Website integration
- **Technology:** Three.js r186 (MIT), vendored in `web_viewer/lib/three/`. That includes GLTFLoader, DRACOLoader with its WASM decoder, OrbitControls and CSS2DRenderer. There is no build step, no CDN and no external service; it runs in all current browsers with WebGL.
- **Option A, iframe (simplest):** upload `web_viewer/` to the web server (for example `/campus3d/`) and embed it:
  `<iframe src="/campus3d/#bld_main" style="width:100%;height:80vh;border:0" allow="fullscreen" title="Campus 3D guide"></iframe>`
- **Option B, native page:** copy `index.html`'s markup, `css/style.css` and `js/app.js` into the site template, keeping the import map. Edit `ORDER` in `app.js` to change the building sequence.
- **Server settings:**
  - serve `.wasm` as `application/wasm`;
  - `.glb` may be `model/gltf-binary` or `application/octet-stream`;
  - enable gzip/brotli for `.js`;
  - allow long cache lifetimes for `models/` and `lib/`.
- **Content updates:** edit `web_viewer/data/buildings.json` (names, descriptions, faculty) with no 3D work needed. Geometry changes require re-running the Blender build and replacing the two `.glb` files in `web_viewer/models/`.

## Rebuilding / extending the model
Requires Blender 4.5 LTS (free) and Python 3 with numpy, scipy, Pillow and opencv-python-headless. COLMAP 3.10 is needed only to redo the photogrammetry.
```bash
python3 pipeline/textures.py            # tileable PBR textures (colours sampled from the video)
python3 pipeline/facade_textures.py     # window bays, signage
python3 pipeline/site_plan.py           # ground plan texture + data/site_layout.json
blender -b --factory-startup -P pipeline/blender_build.py      # .blend + both .glb files
blender -b campus_model.blend -P pipeline/blender_render.py -- final CAM_overview_high_SW renders/
python3 pipeline/qa_viewer.py http://localhost:8080/           # browser QA (Playwright)
```
The scripts expect the project layout `campus_project/{data,analysis,deliverables,pipeline}`. Edit the `ROOT` constant at the top of each script if you move them.

- **New buildings:** add an entry to `data/buildings.json` with the OSM footprint id and storeys, then rebuild.
- **New landscape items:** add them to `site_plan.py`; repeated items are instanced automatically.

## Attribution and licences
- Building footprints and roads: © OpenStreetMap contributors, ODbL 1.0. Attribution is required wherever the model is shown (the viewer footer includes it).
- Satellite imagery (reference only, not redistributed in the model): Esri World Imagery, Vantor/Maxar WorldView-3, 2022-08-08.
- Source video and photo: supplied by the university (Drive folder "فيديو الجامعه"). The video carries a "WITTY MEDIA" producer watermark; frames are used for analysis only and none are embedded in the model.
- Three.js: MIT licence (`web_viewer/lib/three/LICENSE`).
- Tools used: Blender 4.5.14 LTS (GPL), COLMAP 3.10 (BSD), FFmpeg, Python. All are free; no paid tools or online services were used.

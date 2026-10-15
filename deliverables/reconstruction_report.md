# Reconstruction Report — EPNU Campus 3D Model

East Port Said National University (E.P.N.U), جامعة شرق بورسعيد الأهلية. Salam Misr El-Gedida, East Port Said, Egypt.
Model version 1.0, built 2026-10-15 with Blender 4.5.14 LTS and COLMAP 3.10 (CPU).

> **Accuracy statement.** This is an evidence-based reconstruction, **not a measured survey**:
> - **Building footprints:** OpenStreetMap, checked against 2022 satellite imagery.
> - **Heights and plaza layout:** photogrammetry of the supplied video.
> - **Façades:** representative modules matched to the footage.
>
> Typical uncertainty is ±1–2 m in plan for buildings and traced plaza features, and ±1.5 m in height. Soft landscape (trees, lamps, benches) is representative, not surveyed. Each element's evidence level is recorded below and in the model (`evidence` custom property / glTF `extras`).

---

## 1. Sources

### 1.1 Supplied material (Google Drive folder "فيديو الجامعه", publicly accessible; both files downloaded and inspected)

| File | Properties | Use |
|---|---|---|
| `202610142042.mp4` | 149.98 s, 1916×1080, 30 fps, H.264, CapCut export, 86 shots. Watermark "WITTY MEDIA", logo and Arabic captions overlaid | Main evidence: architecture, materials, landscape, signage, photogrammetry |
| `WhatsApp Image 2026-10-10 at 2.29.48 AM.jpeg` | 1600×716, dusk aerial from the north-east, green arrow added | Layout cross-check. Building E1 identified as the arrowed building |

### 1.2 Inspection method
- Scene detection (FFmpeg) split the video into 86 shots. A mid-shot frame of every shot was reviewed on contact sheets.
- The 103–124 s construction segment, which contains dissolves, was reviewed at 1 fps.
- I also reviewed 24 full-resolution keyframes, 16 signage frames with zoomed crops, and texture-source frames.
- Every frame used as evidence is cited by timestamp (seconds) in `buildings.json`, the model's `evidence` properties and this report.

### 1.3 Supplementary public data (needed for scale and orientation; not supplied by the university)
- **OpenStreetMap** building footprints (ways 1250092608–618) and roads, via the Overpass API (data as of 2026-05-06). © OpenStreetMap contributors, ODbL.
- **Esri World Imagery**: Vantor/Maxar WorldView-3, captured 2022-08-08, 0.31 m source resolution; z18 tiles at 0.51 m/px. It shows the campus under construction (shells complete, plaza unbuilt). Used for checking the footprints and tracing the fence. Not embedded in the model.
- **Wikidata Q105576331** (location) and **MoHESR / university listings**: official name, faculty list, site area of 44 feddans.

### 1.4 Material that could not be used, or only partly
- **Night and dusk shots (137–150 s)** have unreliable colour. They were used only to check lamp layout.
- **Short ground-level close-ups (about 1.7 s each, gimbal moves)** are useful for details and textures, but not for photogrammetry: there is little overlap, the clips come from different epochs, and they carry watermarks.
- **Finished-state aerial clips** (19–38 s, 128–131 s) reconstructed in COLMAP (33 of 46 frames registered), but could not be metrically registered. They were flown low and obliquely, so there was no usable roof-height signal. They were used qualitatively for lawns, gazebos and sails.
- **WhatsApp image** is a screenshot of a TV broadcast. Its caption says "جامعة بورسعيد الأهلية", which differs from the on-site signage ("جامعة شرق بورسعيد الأهلية"); the signage is treated as authoritative.

---

## 2. Method

### 2.1 Workflow decision
Photogrammetry was **tested, not assumed**:
- COLMAP 3.10 (CPU) on the 119.6–123.4 s drone orbit registered **31/31 frames**, with **22,911 sparse points** and **0.60 px** mean reprojection error.
- Dense reconstruction (patch-match MVS) needs CUDA, which this machine lacks, and OpenMVS is not available.
- More fundamentally, the footage is a montage of short clips from different construction stages, lighting conditions and viewpoints. Even with a GPU, it could not produce a complete, coherent, textured mesh of the campus.

**Decision: hybrid reconstruction.**
1. **Geometry framework:** OSM footprints, cross-checked against the 2022 satellite image, in a local metric frame.
2. **Photogrammetric measurements:** the sparse SfM model was levelled (RANSAC ground plane) and registered to the footprints with a 2D similarity transform. The search used FFT cross-correlation, then refinement against a signed-distance field. Scale: 22.10 m per model unit; 76% of roof points fall inside footprints and 85% within 2 m.
   - **Building heights** come from roof-point statistics.
   - **A metric orthophoto of the plaza** (0.3 m/px) was produced by projecting all 31 frames onto the ground plane.
3. **Procedural Blender modelling** of buildings from footprints and parameters (storeys, floor heights, plinth, cornice, parapet, pilasters, window bays), plus specific modelled features observed in the footage: Main Building pavilions, giant columns, entrance and dome; gate; hall roofs.
4. **Site plan:** the orthophoto was colour-classified (k-means), cleaned, and mapped to finished-state materials. Clean primitives were then added: plots, stars, rings, pitch, planters. OSM roads and the forecourt loop came next, then instanced landscape components.
5. **Materials:** PBR textures with colours sampled from front-lit video frames. Desert sand is a real photo crop. Fine detail (ashlar joints, paver bond, plaster grain) is procedural, because the compressed 1080p video cannot supply clean albedo at material scale.

### 2.2 Coordinate system and scale
- **Frame:** local ENU in metres; origin lat 31.0198510, lon 32.6275438 (centre of the fence bounding box); +X east, +Y north, +Z up. glTF uses +Y up, north = −Z.
- **Scale sources:** OSM/satellite georeferencing for plan; SfM registration for heights. Reference checks: the fence encloses about 159,000 m² (37.9 feddans, against 44 feddans officially, which probably includes land outside the fence). The pitch traces at 22.8 × 44.1 m, consistent with a five-a-side pitch.

### 2.3 Photogrammetric heights (sparse SfM, roof points inside each footprint, m above ground; ±1.5 m)

| Building | p50 | p75 | p90 | Model (top of parapet) |
|---|---|---|---|---|
| E1 (OSM 10) | 18.1 | 19.9 | 20.8 | 19.2 |
| E2 (OSM 09) | 18.4 | 19.9 | 20.7 | 19.2 |
| W1 (OSM 14) | 18.8 | 20.6 | 21.8 | 19.2 |
| W2 (OSM 13) | 19.0 | 21.1 | 22.4 | 19.2 |
| S1/S2/S3 (OSM 12/11/08) | 14.4–16.3 | 17.9–18.7 | 19.2–20.0 | 19.2 (weakly observed, far from the drone) |
| Main Building (OSM 15) | 14.5 | 16.2 | 17.5 | 16.1 (dome top ≈ 27 m) |
| Halls H1/H2 (OSM 17/18) | 9.1–10.9 | 12.0–13.0 | 13.1–13.8 | block 10.1, hall ridge 11.0 |

The 4-storey blocks are modelled as: plinth 0.6 m, ground floor 4.5 m, 3 upper floors at 4.0 m, cornice 0.75 m, parapet 1.2 m. The Main Building has a 4.8 m ground floor and 4.4 m upper floors. The drone altitude from the reconstruction was about 155 m.

---

## 3. Evidence classification

### Verified (directly supported by the sources)
- **Campus identity:** "EAST PORT SAID.N.UNI" and "جامعة شرق بورسعيد الأهلية" on Gate No. 1 (shots 003–006).
- **Gate No. 1 (بوابة رقم ١):** a central pier with a roundel, two lettered spans, columns and guard pavilions. Position on the west fence (satellite plus OSM approach lanes at y = −57.6 / −46.3).
- **Layout:**
  - 11 buildings: 8 four-storey blocks, the 3-storey domed building, and 2 halls (OSM plus 2022 imagery);
  - the fence alignment (satellite);
  - internal service road and drop-off loop (OSM);
  - highway and approach (OSM).
- **Storey counts:** 4 for the teaching blocks (frames 0.5 s, 92.5 s, 97.4 s, 99.1 s); 3 for the domed building (5.43 s, 8.88 s, 90.3 s, 135.75 s); 2 for the hall blocks (0.5 s).
- **Façade system:**
  - sandstone-clad ground floor with grilled windows on the teaching blocks, cream plaster above;
  - giant columns and pavilions; string course, cornice and parapet;
  - white aluminium 3-light windows with blue-grey glass;
  - white ribbed dome on a windowed drum.
- **Halls:** green pitched metal roofs and roller doors.
- **Signage read:** "MAIN BUILDING / المبنى الرئيسي", "BUILDING B / مبنى ب", "BUILDING H / مبنى ح", "BUILDING I".
- **Landscape types:** star-motif sand plots; the central gazebo garden with 5 hexagonal timber gazebos; purple-grey ring paths with black-and-white kerbs; a white S-path with a curved timber pergola; a semicircular red-ring plaza; a pink lens-planter circle; round planters; the fenced artificial-turf pitch; tensile shade sails; curved-arm light poles; benches; palms in the approach median; perimeter fence (cream pillars, dark railings, pillar lamps); parking along the north road and in front of the halls.
- **Plaza geometry:** circle centres and radii, plot rectangles, pitch outline and pergola alignment, traced from the **SfM orthophoto** (registration residual about 1–2 m).

### Estimated (inferred; documented as such in the model)
- **Main Building identification** (high confidence): the "Main Building" section of the video shows a 3-storey, 3-pavilion façade with a central glazed entrance. That matches the domed building's west façade in composition and storey count, along with its kerbed forecourt and its position on the gate axis. No single frame shows both the sign and the dome.
- **Heights:** SfM ±1.5 m. Floor-to-floor heights were chosen to fit SfM roof heights and typical Egyptian university construction.
- **Window counts and spacing:** derived from a 3.6 m bay module fitted to each wall, not counted window by window. Façade pavilion detail on the **teaching blocks** is simplified to corner pilasters.
- **Rear and unseen façades:** the same façade system is assumed throughout.
- **Rooftop structures:** stair/lift rooms, tanks and AC units are generic and placed by rule.
- **Finished-state surfaces:** construction-phase bare soil in the orthophoto was mapped to lawn; colour classes were mapped to paver types. The red-bordered paved courts north and south of the Main Building have estimated extents (frame 124.38 s).
- **Landscape positions:** the exact angles of the 5 gazebos (ring radius verified); the gazebo in the second circle; tree, lamp, bench and shade-sail positions and counts; fence pillar spacing (3.6 m); parking bay lines.
- **Gate dimensions** (about 41 m wide, 9.5 m pier) and **dome height** (about 27 m with finial).
- **Context buildings** west of the highway: generic 13 m massing on OSM footprints (not EPNU).

### Unknown (not determinable from the sources; not invented)
- **Which faculty occupies which building.** The MoHESR list gives the faculties (Computer Science & IT, Medicine, Dentistry, Pharmacy, Applied Health Sciences Technology, Engineering, Business, Arts) but no building assignments. The info panel says "Faculty: not confirmed by available sources".
- **Which footprint carries the signage letters B, H and I.** Neutral model IDs (W1, W2, S1–S3, E1, E2, H1, H2) are used instead.
- **Use of the two NW halls** (workshops, labs or sports halls are all possible).
- **Interior layouts**, roof plans in detail, the south service zone and the west strip behind the Main Building.
- **An unmapped steel structure north of the Main Building** (visible in the 2022 imagery): not identifiable in the finished footage, so not modelled.
- **Exact finished-state soft landscape** (planting species, exact lamp and tree positions).

---

## 4. Model organisation

### Blender collections
- Campus Terrain
- Main Buildings
- Faculty Buildings
- Entrances and Facades
- Roads and Walkways
- Landscape and Vegetation
- Campus Furniture
- Lighting and Cameras
- Context (outside campus)

### Objects and metadata
- Every interactive item is an Empty named with its stable ID: `bld_main`, `bld_w1`, `bld_w2`, `bld_s1`–`bld_s3`, `bld_e1`, `bld_e2`, `bld_h1`, `bld_h2`, `gate_1`, `lm_gazebo_garden`, `lm_sports_pitch`.
- Each carries the custom properties `building_id`, `name_en`, `name_ar`, `category`, `storeys`, `height_m`, `osm_way`, `sfm_height`, `evidence` and `description`. These are exported as glTF `extras`, which Three.js exposes as `userData`.
- Child meshes have descriptive names: `bld_main_walls`, `_trim`, `_roof`, `_dome`, `_pavilions`, and so on.

### Optimisation
- **Shared components (12 instanced groups, 3,820 instances):** light poles (2 types), trees, palms, benches, gazebos, shade sails, kerbs (black and white), fence pillars, railings, rooftop AC units. All are linked duplicates in Blender and EXT_mesh_gpu_instancing in glTF.
- **Shared materials:** 34.
- **Geometry:** 14,186 unique triangles; 85,208 rendered including instances.
- **Compression:** Draco geometry (verified to load in Three.js r186 with DRACOLoader) and WebP textures (EXT_texture_webp).
- **File sizes:** `campus_model.glb` 1.15 MB; `campus_model_mobile.glb` 0.72 MB (2048 px ground, halved textures). The viewer picks the variant by screen width or device memory, which acts as a simple LOD.

### Lighting
- **Renders:** Nishita physical sky (sun disc disabled) plus a sun lamp from the south-east at 40–50° elevation. This matches the shadow directions in the drone clip and the morning satellite pass. AgX view transform, no bloom or glare.
- **Viewer:** the baked sky panorama (`assets/sky_equirect.jpg`) supplies background and image-based lighting, with a directional sun and shadows.

---

## 5. Quality assurance (performed)

| Check | Result |
|---|---|
| SfM camera-matched render vs. source frame (`renders/CAM_sfm_clipA_f_022.jpg` vs. clip frame f_022 at 122.2 s) | Buildings, pitch, gazebo circle, rings and plots coincide within a few pixels at 960 px width |
| Ground-level comparison: Main Building (90.3 s), gate (8.88 s), courtyard (97.4 s), gazebo garden (128.9 s) | Composition, storeys, materials and features correspond (see `renders/`) |
| glTF content | 13 nodes with `building_id` extras; extensions KHR_draco_mesh_compression, EXT_texture_webp and EXT_mesh_gpu_instancing; 44 embedded textures |
| `.blend` reopens | Reopened headless for every render (7 render runs, 1 sky bake) |
| Browser QA (Playwright, headless Chromium, SwiftShader software WebGL) | See `qa/qa_results.json` and section 5.1 |

### 5.1 Browser QA results (`qa/qa_results.json`, `qa/smoke_packaged_viewer.json`, screenshots in `qa/`)
**Environment:** headless Chromium 156 (Playwright) using SwiftShader **software** WebGL 2; there is no GPU on the build machine.
- At 1440×900 with shadows, a frame takes about 4.3 s. That is a property of software rendering, not of the model. The renderer reports 134 draw calls and 84,908 triangles per frame.
- One full-quality screenshot was captured (`desktop_overview_full_quality.png`). The functional tests ran with `?qa=1` (shadows and antialiasing off).

**Result: 22 / 22 checks passed. 0 console errors and 0 HTTP errors.**

| # | Check | Result |
|---|---|---|
| 1 | Full model loads (desktop 1440×900, shadows on) | PASS |
| 2 | All 13 stable IDs registered from glTF extras | PASS |
| 3 | `?quality=high` loads the full model. Without the parameter, the viewer chooses by screen width (≤720 px gives *lite*) and `navigator.deviceMemory` (≤4 GB gives *lite*). On the 1.9 GB test machine the automatic choice was *lite* on desktop too, as designed | PASS |
| 4 | Renderer statistics collected | PASS |
| 5 | 13 labels rendered | PASS |
| 6–8 | List selection opens the info panel; Arabic name shown; deep-link hash updated | PASS |
| 9–10 | Next / Previous navigation | PASS |
| 11 | Overview button resets the view and clears the selection | PASS |
| 12 | **Mouse click on buildings in the 3D view** (E1, S2, Main) selects the right building (raycast to glTF extras) | PASS |
| 13–14 | Labels toggle; keyboard navigation | PASS |
| 15 | Landmark made of instanced meshes (gazebo garden) is selectable | PASS |
| 16 | Deep link `#bld_e1` selects the building on a fresh load | PASS |
| 17 | Simulated model-download failure shows the error panel with *Retry* and *Try lightweight version* | PASS |
| 18–19 | Mobile 390×844 (touch, DPR 2): model loads; lightweight model chosen automatically | PASS |
| 20 | Mobile: selecting from the list opens the bottom-sheet info panel | PASS |
| 21 | Mobile: **tap** on a building selects it | PASS |
| 22 | Mobile: toolbar and panel fit the viewport | PASS |

**Problems found by visual review of the screenshots, then fixed and re-tested on the packaged `web_viewer/` copy:**
- 3D labels were drawn above the panels on mobile. Fixed by isolating the canvas stacking context; after the fix, 66 of 66 hit-test points inside the list panel resolve to the panel.
- Fly-to framed buildings too tightly on portrait screens. It now uses the narrower field of view and shifts the building above the bottom sheet; the Main Building's projected bounding box sits at y 29–317 px with the sheet starting at 403 px.
- Redundant ID suffixes on labels were removed.
- `PCFSoftShadowMap` (deprecated in r186) was replaced; the packaged viewer now logs no warnings.

**Not tested:** real GPUs and frame rate; iOS Safari or WebKit; physical phones and tablets; screen readers; slow-network throttling (the error path was tested by aborting the request).

---

## 6. Limitations and recommended next steps
1. **Faculty and building-letter mapping.** Obtain from the university, then update `data/buildings.json`. No geometry work is needed.
2. **Façade fidelity on the teaching blocks.** Pavilion projections, giant orders and sign panels on wing ends are simplified. A short **dedicated photo walk** (frontal photos of each façade) would allow per-building façade modules.
3. **Finished-state survey.** Current satellite imagery (post-2024) or a **nadir drone flight**, about 200 photos at 60 m with 80% overlap, would allow a true orthophoto and dense mesh. That would replace the classified construction-phase ortho and the representative soft landscape.
4. **Rooftops** are generic.
5. **Ground texture** is 0.107 m/px, which looks soft at eye level. Higher-resolution tiles near paths would help.
6. **Viewer testing** on physical devices (iOS Safari, mid-range Android) and real GPUs is still to be done.

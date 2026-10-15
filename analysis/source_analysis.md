# Source Analysis Report — East Port Said National University (EPNU) campus

*Internal Phase 1 working document. Some of it is superseded by `reconstruction_report.md`; it is kept as a record of decisions.*

## 1. Source inventory (Google Drive folder "فيديو الجامعه")

| # | File | Type | Technical properties | Notes |
|---|------|------|----------------------|-------|
| 1 | `202610142042.mp4` | Edited promo/montage video | 149.98 s, 1916×1080, H.264 Main, 30 fps, 15.5 Mbit/s, AAC stereo. Exported from CapCut web (`vicutweb`), re-encoded | Producer watermark "WITTY MEDIA" (bottom left), EPNU construction-authority logo (top right), Arabic section captions (top left). **86 shots** found by scene detection (most 1.6–1.8 s; a few 3–4 s). One 20 s segment (103–124 s) is several construction-phase clips joined by dissolves |
| 2 | `WhatsApp Image 2026-10-10 at 2.29.48 AM.jpeg` | Screenshot of a TV/video frame | 1600×716 JPEG, 93 KB, letterboxed | Dusk aerial of the finished campus. Caption "جامعة بورسعيد الأهلية" (shortened university name). A green hand-drawn arrow points at the east buildings (OSM 10 / 09) |

No CAD files, plans, maps, or existing 3D models were supplied.

### Video sections (from on-screen Arabic captions)
- `الموقع العام` (General site): 0–3.7 s, 124–141 s
- `البوابة الرئيسية` (Main Gate): around 5–17 s
- `المبنى الرئيسي` (Main Building): around 83–93 s
- `عمليات الانشاء` (Construction operations): 103–124 s
- The other sections are landscape and close-up montage: gazebos, shade sails, pitches, lawns and courtyards.

Time of day differs across shots: midday, golden hour, dusk and night. The construction state also differs: 103–124 s shows scaffolding and bare plaza paving, while the rest shows the finished campus.

## 2. Supplementary public data (needed for scale and layout; external to the Drive folder)

| Source | Use | Licence / attribution |
|---|---|---|
| Wikidata Q105576331 | Location: 31°01'17.98"N, 32°37'37.09"E, Salam Misr El-Gedida city, East Port Said | CC0 |
| Ministry of Higher Education (cnu.mohesr.gov.eg/east-port-said), dirasaabroad.com | Official faculty list; site area 44 feddans (≈18.5 ha) | Public web pages |
| Esri World Imagery, z17/z18 tiles (Vantor/Maxar WorldView-3, **2022-08-08**, 0.31 m source resolution) | Fence trace, check of footprints | Esri, Vantor; reference use only |
| OpenStreetMap building footprints (ways 1250092608–1250092618) | Footprint geometry of the 11 campus buildings | © OpenStreetMap contributors, ODbL |

The satellite imagery shows the campus **under construction**: building shells are complete, the plaza is not built, and the north half is bare sand.

## 3. Coordinate system
Local ENU metres. Origin is the centre of the traced fence bounding box (lat 31.0198510, lon 32.6275438). +X is East, +Y is North, +Z is Up. The fence encloses about 159,000 m² (37.9 feddans); the official 44 feddans probably includes land outside the fence.

## 4. Photogrammetry feasibility (actually tested)
- **Clip A** (119.6–123.4 s, construction-phase orbit, 31 frames at 1440 px): COLMAP 3.10 CPU run. Exhaustive matching registered **31/31 images**, giving **22,911 points**, mean reprojection error **0.60 px**, mean track length 7.6.
- **Ground plane:** RANSAC fit, 11,407 inliers.
- **Registration to the OSM footprints:** 2D similarity found by FFT search, then refined against a signed-distance field. Scale 22.10 m per model unit; 76% of roof points fall inside footprints and 85% within 2 m.
- **Products:**
  1. Photogrammetric **building heights**: the 4-storey blocks reach ≈18–19 m at the main roof (p50–p75) and 20–22 m at rooftop structures; the Main Building ≈14.5–16 m; the NW halls ≈9–13 m.
  2. A **metric ground-plane orthophoto** of the plaza (0.3 m/px): `analysis/ortho_clipA.jpg`.
- **Clip B** (finished-state daytime aerials, 46 frames from 4 clips): see `reconstruction_report.md`.
- **Dense MVS is not possible here.** COLMAP `patch_match_stereo` requires CUDA, and OpenMVS is not packaged. With 2 CPU cores and 1.9 GB RAM, a dense mesh of the campus is not feasible. Even with a GPU, the montage (1.7 s clips, mixed epochs and lighting, watermarks) could not give a complete, coherent textured mesh. **Decision: hybrid architectural reconstruction**, with geometry constrained by OSM footprints, SfM heights and the SfM orthophoto.

## 5. Principal buildings and features

| Model ID | OSM way | Identification | Storeys | Status |
|---|---|---|---|---|
| `bld_main` | 1250092615 | **Main Building** (المبنى الرئيسي) with dome, on the Gate No. 1 axis | 3 + dome | Footprint: OSM (verified). Storeys: verified from several views. Name: **high-confidence estimate**, from the "Main Building" section, the matching 3-pavilion façade, 3 storeys, and the black-and-white kerbed forecourt loop |
| `bld_e_north` | 1250092614 | Comb/C-shaped block, north of the west column | 4 | Footprint verified; letter name unknown |
| `bld_e_south` | 1250092613 | Comb/C-shaped block, south of the west column | 4 | idem |
| `bld_u_west` | 1250092612 | U-block, south row (west) | 4 | idem |
| `bld_u_mid` | 1250092611 | U-block, south row (middle) | 4 | idem |
| `bld_u_east` | 1250092608 | U-block, south row (east) | 4 | idem |
| `bld_c_north` | 1250092610 | ⊐-block, east column (north). Marked by the arrow in the WhatsApp image | 4 | idem |
| `bld_c_south` | 1250092609 | ⊐-block, east column (south) | 4 | idem |
| `hall_west` | 1250092617 | Workshop/hall: 2-storey front block plus a green pitched-roof hall with roller doors | 2 | Footprint verified; use unknown |
| `hall_east` | 1250092618 (+…16) | idem | 2 | idem |
| `gate_1` | — | Gate No. 1 (بوابة رقم ١), white portal with "EAST PORT SAID.N.UNI" | 1 | Verified (video); position from satellite |

**Signage read in the video:** "MAIN BUILDING / المبنى الرئيسي", "BUILDING B / مبنى ب", "BUILDING H / مبنى ح", "BUILDING I", "Gate No. 1 / بوابة رقم ١". The letters show that buildings (or wings) are lettered A…I or beyond. **Which footprint carries B, H or I cannot be determined from the footage.** Those letters are therefore not assigned to buildings in the model.

**Official faculties** (MoHESR): Computer Science & IT; Medicine; Dentistry; Pharmacy; Applied Health Sciences Technology; Engineering; Business; Arts. **Which faculty occupies which building is not stated in any source.** It is not assigned in the guide.

**Landscape** (finished state, from video):
- star-motif square plots;
- a central gazebo circle with 5 hexagonal timber gazebos;
- secondary circular plazas;
- a white S-shaped path with a curved timber pergola;
- a semicircular plaza with red rings;
- a lens-shaped planter circle;
- a fenced artificial-turf 5-a-side pitch;
- tensile shade sails, benches, curved-arm light poles, young trees, lawns;
- a decorative perimeter fence (cream pillars, dark railings, lamps on pillars);
- a north service road with parking;
- a forecourt drop-off loop in front of the Main Building.

## 6. Uncertainties
- Building **rear sides** and roof equipment are only partly visible. Façades are reconstructed from representative bays.
- Wing **letters/faculties**: unknown.
- The **finished-state plaza** is taken from the construction-phase hardscape orthophoto plus finished-state oblique views. Soft-landscape positions (trees, lamps, benches) are representative, not surveyed.
- **West strip** between the fence and the Main Building, and the **south service zone**: weakly observed.
- An unmapped steel-frame structure north of the Main Building (2022 imagery) cannot be identified in the finished footage, so it is **not modelled**.

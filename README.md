# EPNU 3D: East Port Said National University campus model

**جامعة شرق بورسعيد الأهلية: نموذج ثلاثي الأبعاد ودليل تفاعلي للحرم الجامعي**

This is an evidence-based 3D reconstruction of the East Port Said National University (E.P.N.U) campus in Salam Misr El-Gedida, East Port Said, Egypt. It comes with an interactive Three.js campus guide intended for the university website.

How the model was made:
- Building footprints come from OpenStreetMap and were checked against 2022 satellite imagery.
- Building heights and the plaza layout come from COLMAP photogrammetry of the supplied campus video.
- The architecture was modelled procedurally in Blender.

It is a reconstruction, **not a survey**. See [`deliverables/reconstruction_report.md`](deliverables/reconstruction_report.md) for accuracy figures and what is verified, estimated or unknown.

![Overview render](deliverables/renders/CAM_overview_high_SW.jpg)

## Quick start: run the web viewer
```bash
cd viewer                 # deliverables/web_viewer/ is an identical, deployable copy
python3 serve.py 8080     # any static file server works
# open http://localhost:8080/
```
- The viewer has no build step, no CDN and no external services. Three.js r186 is included in `viewer/lib/three/`.
- It must be served over HTTP; opening it as a `file://` page will not work.
- Use `?quality=lite` or `?quality=high` to force a model variant.
- Use `#bld_main` (or any other building ID) to open the viewer with that building selected.

### Timetables (الجداول)
The viewer opens with an Arabic timetable panel (`viewer/js/schedule.js`). Students pick their level and section, see their next class, and press **وديني** to get walking directions to the room.

- **Data:** the Computer Science timetable is in `viewer/data/schedules/fall-2026.json`.
- **Upload a new timetable:** press **رفع جدول** and choose a CSV or JSON file. **تنزيل CSV** downloads the current timetable in the same format, ready to edit in Excel.
- **CSV columns:** `level, day, period, course, type, group, sections, room, building`. Arabic headers and day names work too.
  - `sections` takes `1:5` (sections 1 to 5) or `3,4`.
  - `room` can be written as in the printed tables, for example `Hall:3`, `Drawing Hall 3`, `Room:104`, `Lab 2` or `قاعة 1`.
- **Linking:** each class is linked automatically to its building, and to the room when the indoor map has it (`viewer/data/room_index.json`). The panel shows how many classes are linked.
- **Storage:** an uploaded timetable is kept in that browser only. **الجدول الأصلي** goes back to the built-in one.

Website integration options (iframe or native page) and server settings are in [`deliverables/README.md`](deliverables/README.md#website-integration).

## Repository layout

| Path | Contents |
|---|---|
| [`deliverables/`](deliverables/) | Final outputs, documented in [`deliverables/README.md`](deliverables/README.md):<br>• `campus_model.glb` (1.15 MB) and `campus_model_mobile.glb` (0.72 MB)<br>• `campus_model.blend` (Blender 4.5)<br>• `textures/` and preview `renders/`<br>• `web_viewer/` and browser `qa/` results<br>• photogrammetry products<br>• the reconstruction report and source analysis |
| [`viewer/`](viewer/) | Working copy of the web viewer: HTML, CSS and JS, models, `data/buildings.json`, and three.js in `lib/three/`. |
| [`pipeline/`](pipeline/) | Python and Blender scripts that rebuild textures, the site plan, the `.blend`, both GLBs, the renders and the browser QA. |
| [`data/`](data/) | Inputs in local metres: stable building IDs with info-panel text, OSM footprints and roads, site layout, sampled colour palette and model statistics. |
| [`analysis/`](analysis/) | Photogrammetric orthophoto, ground classification, site-plan overlays and the Phase-1 [`source_analysis.md`](analysis/source_analysis.md). |
| [`photogrammetry_test/`](photogrammetry_test/) | COLMAP run scripts. |
| [`sources/`](sources/) | The reference photo supplied with the brief. |

**Not included in this repository:**
- The source video: it is too large for git and remains in the original Google Drive folder.
- The intermediate photogrammetry frames.
- The packaged ZIP: `pipeline/package_deliverables.py` rebuilds it.

## Rebuilding
- **Requirements:** Blender 4.5 LTS and Python 3 with numpy, scipy, Pillow and opencv-python-headless. Playwright is needed only for browser QA, and COLMAP 3.10 only to redo the photogrammetry.
- **Commands:** the full rebuild order is in [`deliverables/README.md`](deliverables/README.md#rebuilding--extending-the-model).
- **Paths:** the scripts expect the project at `/home/user/campus_project/`. If you clone it somewhere else, edit the `ROOT` constant at the top of each script.

## Status and limitations
- **IDs are not official names.** Building codes such as `bld_w1` and `bld_s2` are stable model identifiers.
- **Unconfirmed mapping.** The faculty in each building, and which buildings carry the sign letters B, H and I, could not be confirmed from the sources. Add them in `data/buildings.json` once the university confirms them; the viewer picks up the changes automatically.
- **Approximated parts.** Sides not visible in the sources and the soft landscaping are conservative approximations.
- **Testing.** Browser QA ran on headless Chromium with software WebGL (22/22 checks passed). It has not been tested on real GPUs, iOS or physical phones.

## Attribution and licences
- Building footprints and roads: © OpenStreetMap contributors, ODbL 1.0. Attribution is required wherever the model is shown; the viewer footer includes it.
- Satellite imagery (reference only): Esri World Imagery, Vantor/Maxar WorldView-3, 2022-08-08.
- Source video and photo: supplied for this project. The video carries a "WITTY MEDIA" watermark, and its frames were used for analysis.
- Three.js: MIT licence ([`viewer/lib/three/LICENSE`](viewer/lib/three/LICENSE)).
- No licence has been chosen for this project's own code and models yet, so all rights are reserved by default. Choose one before making the repository public.

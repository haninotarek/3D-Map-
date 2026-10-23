"""Straighten the street-side (east) face of the two engineering buildings: each building is extended east to
the outer line of its projecting wing, along its whole length, so the east face is one straight wall.
Edits data/osm_footprints_local.json in place (the polygons the Blender build uses). Coordinates are local
ENU metres (x = East, y = North)."""
import json, pathlib

P = pathlib.Path(__file__).resolve().parents[1] / 'data' / 'osm_footprints_local.json'
fp = json.loads(P.read_text(encoding='utf-8'))
B = fp['buildings']

# Engineering Building 1 (OSM 1250092609): east wall continues the annex's outer line up to the north wing
B['1250092609']['poly'] = [
    [186.62, -34.33], [124.9, -35.33], [125.23, -55.46], [160.05, -54.9], [160.29, -69.68], [124.96, -70.25],
    [125.28, -89.6], [176.74, -88.78], [176.82, -93.62], [187.57, -93.45],
]
# Engineering Building 2 (OSM 1250092610): east wall at the annex's outer line from the south end to the north end
B['1250092610']['poly'] = [
    [124.09, 32.2], [124.83, 12.35], [158.84, 13.58], [159.35, -0.42], [124.31, -1.69], [125.01, -20.43],
    [128.84, -20.29], [128.92, -22.67], [183.92, -20.67], [183.56, 34.33],
]
for k in ('1250092609', '1250092610'):
    xs = [p[0] for p in B[k]['poly']]; ys = [p[1] for p in B[k]['poly']]
    B[k]['bbox'] = [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]
    a = 0.0; pts = B[k]['poly']
    for i in range(len(pts)):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % len(pts)]; a += x0 * y1 - x1 * y0
    B[k]['area_m2'] = round(abs(a) / 2, 1)
    B[k]['n'] = len(pts)
    B[k]['note'] = 'East face straightened to the projecting wing line (user sketch, Oct 2026).'
P.write_text(json.dumps(fp, ensure_ascii=False, indent=1), encoding='utf-8')
print('ok', {k: B[k]['bbox'] for k in ('1250092609', '1250092610')})

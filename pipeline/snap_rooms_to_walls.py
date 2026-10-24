"""Remove the empty strips inside the engineering buildings.

The outlines come from OpenStreetMap and are rotated about 1-2 degrees, while the rooms are axis-aligned
rectangles, so long thin gaps were left between the rooms and the outer wall (and some small gaps between
neighbouring rooms). This script:
  1. makes each plan's footprint rectilinear (every wall exactly horizontal or vertical, at its mean position),
  2. moves every room / corridor edge that faces an outer wall onto that wall's inside face, when the strip in
     between is free (gaps up to MAX_WALL_GAP metres),
  3. closes small gaps between neighbouring spaces (up to MAX_ROOM_GAP), growing an open space (corridor /
     lobby) first, otherwise the room on the left / bottom.
Run from the repo root:  python pipeline/snap_rooms_to_walls.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = ['bld_e1.json', 'bld_e2.json']
EXT_HALF = 0.175          # half the outer wall thickness (interior.js EXT_T = 0.35)
MAX_WALL_GAP = 3.0
MAX_ROOM_GAP = 1.2
SKIP = {'void', 'locker'}

def rectilinear(poly):
    """Snap each edge to horizontal / vertical (mean coordinate) and rebuild the corners."""
    n = len(poly); edges = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        edges.append(('H', (y0 + y1) / 2) if abs(x1 - x0) >= abs(y1 - y0) else ('V', (x0 + x1) / 2))
    # merge consecutive edges with the same orientation
    merged = []
    for e in edges:
        if merged and merged[-1][0] == e[0]:
            merged[-1] = (e[0], (merged[-1][1] + e[1]) / 2)
        else:
            merged.append(e)
    if len(merged) > 1 and merged[0][0] == merged[-1][0]:
        merged[0] = (merged[0][0], (merged[0][1] + merged[-1][1]) / 2); merged.pop()
    pts = []
    for i, (o, v) in enumerate(merged):
        o2, v2 = merged[(i + 1) % len(merged)]
        pts.append([round(v2, 2), round(v, 2)] if o == 'H' else [round(v, 2), round(v2, 2)])
    return pts

def wall_segments(poly):
    segs = []
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        if abs(y1 - y0) < 1e-6: segs.append(('H', y0, min(x0, x1), max(x0, x1)))
        else: segs.append(('V', x0, min(y0, y1), max(y0, y1)))
    return segs

def inside(poly, x, y):
    c = False
    for i in range(len(poly)):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0: c = not c
    return c

def overlap(a0, a1, b0, b1): return max(0.0, min(a1, b1) - max(a0, b0))

def strip_free(rooms, me, x0, y0, x1, y1):
    if x1 - x0 < 1e-3 or y1 - y0 < 1e-3: return True
    for r in rooms:
        if r is me or r.get('kind') in SKIP: continue
        rx0, ry0, rx1, ry1 = r['rect']
        if overlap(x0, x1, rx0, rx1) > 0.05 and overlap(y0, y1, ry0, ry1) > 0.05: return False
    return True

def snap_to_walls(rooms, segs, poly):
    moved = 0
    for r in rooms:
        if r.get('kind') in SKIP: continue
        x0, y0, x1, y1 = r['rect']
        w, h = x1 - x0, y1 - y0
        best = {}
        for o, v, a, b in segs:
            if o == 'H':
                if overlap(x0, x1, a, b) < 0.5 * w: continue
                cx = (max(x0, a) + min(x1, b)) / 2
                for side, edge, sgn in (('n', y1, 1), ('s', y0, -1)):
                    target = v - sgn * EXT_HALF
                    gap = (target - edge) * sgn
                    # the wall must lie on the outside of this side: just past it there is no building
                    if -1.0 <= gap <= MAX_WALL_GAP and not inside(poly, cx, v + sgn * 0.3):
                        if side not in best or abs(gap) < abs(best[side][1]): best[side] = (target, gap)
            else:
                if overlap(y0, y1, a, b) < 0.5 * h: continue
                cy = (max(y0, a) + min(y1, b)) / 2
                for side, edge, sgn in (('e', x1, 1), ('w', x0, -1)):
                    target = v - sgn * EXT_HALF
                    gap = (target - edge) * sgn
                    if -1.0 <= gap <= MAX_WALL_GAP and not inside(poly, v + sgn * 0.3, cy):
                        if side not in best or abs(gap) < abs(best[side][1]): best[side] = (target, gap)
        for side, (target, gap) in best.items():
            if abs(gap) < 0.02: continue
            nx0, ny0, nx1, ny1 = r['rect']
            if side == 'n': strip = (nx0, ny1, nx1, target); new = [nx0, ny0, nx1, target]
            elif side == 's': strip = (nx0, target, nx1, ny0); new = [nx0, target, nx1, ny1]
            elif side == 'e': strip = (nx1, ny0, target, ny1); new = [nx0, ny0, target, ny1]
            else: strip = (target, ny0, nx0, ny1); new = [target, ny0, nx1, ny1]
            if gap < 0 or strip_free(rooms, r, *strip):
                r['rect'] = [round(v, 2) for v in new]; moved += 1
    return moved

def close_room_gaps(rooms):
    moved = 0
    act = [r for r in rooms if r.get('kind') not in SKIP]
    for a in act:
        for b in act:
            if a is b: continue
            ax0, ay0, ax1, ay1 = a['rect']; bx0, by0, bx1, by1 = b['rect']
            # b to the east of a / b to the north of a
            for horiz in (True, False):
                if horiz:
                    gap = bx0 - ax1; ov = overlap(ay0, ay1, by0, by1); span = min(ay1 - ay0, by1 - by0)
                else:
                    gap = by0 - ay1; ov = overlap(ax0, ax1, bx0, bx1); span = min(ax1 - ax0, bx1 - bx0)
                if not (0.03 < gap <= MAX_ROOM_GAP) or ov < 0.5 * span: continue
                grow = b if (b.get('open') and not a.get('open')) else a
                if horiz:
                    lo, hi = max(ay0, by0), min(ay1, by1)
                    if not strip_free(rooms, grow, ax1, lo, bx0, hi): continue
                    if grow is a: a['rect'][2] = bx0
                    else: b['rect'][0] = ax1
                else:
                    lo, hi = max(ax0, bx0), min(ax1, bx1)
                    if not strip_free(rooms, grow, lo, ay1, hi, by0): continue
                    if grow is a: a['rect'][3] = by0
                    else: b['rect'][1] = ay1
                moved += 1
    return moved

def write_like(p, text, data):
    if re.search(r'"rect": \[\s*\n', text):
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'); return
    lines = ['{']
    for k, v in data.items():
        if k in ('footprint', 'floors'): continue
        lines.append(f'  "{k}": {json.dumps(v, ensure_ascii=False)},')
    lines.append('  "footprint": [\n    ' + ', '.join(f'[{x}, {y}]' for x, y in data['footprint']) + '\n  ],')
    lines.append('  "floors": [')
    for i, f in enumerate(data['floors']):
        lines.append('    {')
        for k, v in f.items():
            if k != 'rooms': lines.append(f'      "{k}": {json.dumps(v, ensure_ascii=False)},')
        lines.append('      "rooms": [')
        lines.append(',\n'.join('        ' + json.dumps(r, ensure_ascii=False) for r in f['rooms']))
        lines.append('      ]')
        lines.append('    }' + (',' if i < len(data['floors']) - 1 else ''))
    lines.append('  ]\n}')
    out = '\n'.join(lines) + '\n'
    json.loads(out)
    p.write_text(out, encoding='utf-8')

for name in FILES:
    p = ROOT / 'viewer' / 'data' / 'interiors' / name
    text = p.read_text(encoding='utf-8')
    data = json.loads(text)
    data['footprint'] = rectilinear(data['footprint'])
    segs = wall_segments(data['footprint'])
    report = []
    for f in data['floors']:
        a = snap_to_walls(f['rooms'], segs, data['footprint'])
        b = close_room_gaps(f['rooms'])
        report.append(f"{f['id']}: {a} to walls, {b} gaps")
    write_like(p, text, data)
    print(name, '|', '; '.join(report))

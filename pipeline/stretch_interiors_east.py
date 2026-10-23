"""After straighten_east.py: give the interior plans the new building outline and let the spaces that touched
the old east wall run on to the new wall. No new rooms are created (the added strip belongs to the
neighbouring lobby / offices / halls). Edits viewer/data/interiors/*.json in place, line by line."""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
FP = json.loads((ROOT / 'data' / 'osm_footprints_local.json').read_text(encoding='utf-8'))['buildings']

def fmt(r): return '[' + ', '.join(f'{v:.1f}' for v in r) + ']'

def stretch(fname, osm, old_east, new_east, y_lo, y_hi):
    """Rooms whose east side sits on the old wall (x1 >= old_east) and that lie north of y_lo get x1 = new_east."""
    p = ROOT / 'viewer' / 'data' / 'interiors' / fname
    text = p.read_text(encoding='utf-8')
    poly = FP[osm]['poly']
    # footprint: replace the whole array, keep it on a few lines
    m = re.search(r'"footprint": \[(.*?)\]\s*\]', text, re.S)
    pts = ', '.join(f'[{x}, {y}]' for x, y in poly)
    text = text[:m.start()] + f'"footprint": [\n    {pts}\n  ]' + text[m.end():]
    out, n = [], 0
    for ln in text.split('\n'):
        mm = re.search(r'"rect": \[([^\]]+)\]', ln)
        if mm:
            x0, y0, x1, y1 = [float(v) for v in mm.group(1).split(',')]
            if x1 >= old_east and y1 > y_lo and y0 < y_hi:
                ln = ln.replace('[' + mm.group(1) + ']', fmt([x0, y0, new_east, y1])); n += 1
        out.append(ln)
    text = '\n'.join(out)
    json.loads(text)
    p.write_text(text, encoding='utf-8')
    print(fname, 'stretched', n, 'spaces')

# Engineering Building 1: old east wall x ~176, new wall x ~186.6 (inside face 186.3), north of the annex (y > -71.3)
stretch('bld_e2.json', '1250092609', old_east=175.5, new_east=186.3, y_lo=-71.3, y_hi=-34.0)

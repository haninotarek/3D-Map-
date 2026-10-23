"""After straighten_east.py: give the interior plans the new building outline and let the spaces that touched
the old east wall run on to the new wall. No new rooms are created (the added strip belongs to the
neighbouring lobby / offices / halls). Edits viewer/data/interiors/*.json in place and keeps each file's own
formatting (one room per line, or fully indented JSON)."""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
FP = json.loads((ROOT / 'data' / 'osm_footprints_local.json').read_text(encoding='utf-8'))['buildings']

def fmt(r): return '[' + ', '.join(f'{v:.1f}' for v in r) + ']'

def stretch(fname, osm, old_east, new_east, y_lo, y_hi):
    """Rooms whose east side sits on the old wall (x1 >= old_east) within y_lo..y_hi get x1 = new_east."""
    p = ROOT / 'viewer' / 'data' / 'interiors' / fname
    text = p.read_text(encoding='utf-8')
    poly = FP[osm]['poly']
    hit = lambda r: r[2] >= old_east and r[3] > y_lo and r[1] < y_hi
    if re.search(r'"rect": \[\s*\n', text):          # fully indented JSON
        data = json.loads(text)
        data['footprint'] = poly
        n = 0
        for f in data['floors']:
            for r in f['rooms']:
                if hit(r['rect']):
                    r['rect'][2] = new_east; n += 1
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    else:                                           # one room per line
        m = re.search(r'"footprint": \[(.*?)\]\s*\]', text, re.S)
        pts = ', '.join(f'[{x}, {y}]' for x, y in poly)
        text = text[:m.start()] + f'"footprint": [\n    {pts}\n  ]' + text[m.end():]
        out, n = [], 0
        for ln in text.split('\n'):
            mm = re.search(r'"rect": \[([^\]]+)\]', ln)
            if mm:
                r = [float(v) for v in mm.group(1).split(',')]
                if hit(r):
                    ln = ln.replace('[' + mm.group(1) + ']', fmt([r[0], r[1], new_east, r[3]])); n += 1
            out.append(ln)
        text = '\n'.join(out)
        json.loads(text)
        p.write_text(text, encoding='utf-8')
    print(fname, 'stretched', n, 'spaces')

# Engineering Building 1: old east wall x ~176, new wall x ~186.6 (inside face 186.3), north of the annex (y > -71.3)
stretch('bld_e2.json', '1250092609', old_east=175.5, new_east=186.3, y_lo=-71.3, y_hi=-34.0)
# Engineering Building 2: old east wall x ~176-183 (spine + projecting hall), new wall x ~183.6 (inside face 183.3)
stretch('bld_e1.json', '1250092610', old_east=175.5, new_east=183.3, y_lo=-20.7, y_hi=34.4)

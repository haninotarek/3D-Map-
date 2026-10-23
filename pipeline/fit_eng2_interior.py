"""Engineering Building 2 (bld_e1) interior, rebuilt to match the real building outline.

The two engineering buildings are twins (C-plan, courtyard open to the plaza, spine + projecting hall on the
street side). The old bld_e1 plan was drawn on a different outline from the 3D building, so it no longer lined
up with the walls. This takes Building 1's plan (bld_e2.json) and maps it piecewise onto Building 2's real
outline (data/osm_footprints_local.json, OSM 1250092610), then gives the rooms Building 2's own names where the
timetable uses them (Room 101, Lab 1, Lab 2, Room 102, Room 205, Halls 1-4).
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'viewer/data/interiors/bld_e2.json'
DST = ROOT / 'viewer/data/interiors/bld_e1.json'
FP = json.loads((ROOT / 'data/osm_footprints_local.json').read_text(encoding='utf-8'))['buildings']['1250092610']['poly']

def pw(v, pairs):
    """piecewise-linear map through (src, dst) pairs, extrapolating with the end segments"""
    for (a0, b0), (a1, b1) in zip(pairs, pairs[1:]):
        if v <= a1 or (a1, b1) == pairs[-1]:
            return b0 + (v - a0) * (b1 - b0) / (a1 - a0)
    return v

# Building 1 -> Building 2 (inside faces of walls / courtyard edges)
XM = [(125.4, 125.3), (160.3, 159.5), (186.3, 183.3)]
YM = [(-89.0, -20.2), (-70.1, -1.3), (-55.0, 13.8), (-35.35, 31.9)]
def mx(x): return round(pw(x, XM), 2)
def my(y): return round(min(31.9, max(-20.4, pw(y, YM))), 2)

data = json.loads(SRC.read_text(encoding='utf-8'))
data['building_id'] = 'bld_e1'
data['name_en'] = 'Engineering Building 2'
data['name_ar'] = 'مبنى هندسة 2'
data['source'] = ('Plan of Engineering Building 1 (twin building) fitted to the Engineering Building 2 outline '
                  '(OSM way 1250092610, east face straightened). Room names follow the faculty timetable.')
data['footprint'] = [[x, y] for x, y in FP]

RENAME = {   # floor -> old id -> (new id, name_en, name_ar)
    'G': {'lab_n': ('lab_1', 'Lab 1', 'معمل 1'), 'cls_n_in': ('room_101', 'Room 101', 'غرفة 101')},
    '1': {'room_104': ('room_102', 'Room 102', 'غرفة 102'), 'room_105': ('room_103', 'Room 103', 'غرفة 103'),
          'room_106': ('room_104', 'Room 104', 'غرفة 104'),
          'drawing_hall_3': ('studio_a', 'Design Studio A', 'صالة تصميم أ'), 'drawing_hall_4': ('studio_b', 'Design Studio B', 'صالة تصميم ب')},
    '2': {'room_206': ('room_205', 'Room 205', 'غرفة 205'), 'cls_n2_e': ('room_206', 'Room 206', 'غرفة 206')},
}

for f in data['floors']:
    for e in f.get('entrances', []):
        e['at'] = [mx(e['at'][0]), my(e['at'][1])]
    for r in f['rooms']:
        x0, y0, x1, y1 = r['rect']
        r['rect'] = [mx(x0), my(y0), mx(x1), my(y1)]
        if r['id'] in RENAME.get(f['id'], {}):
            r['id'], r['name_en'], r['name_ar'] = RENAME[f['id']][r['id']]

# write one room per line like the other plan files
def dump_room(r):
    return '        ' + json.dumps(r, ensure_ascii=False)
lines = ['{']
for k in ('building_id', 'name_en', 'name_ar', 'source', 'wall_height'):
    if k in data: lines.append(f'  "{k}": {json.dumps(data[k], ensure_ascii=False)},')
lines.append('  "footprint": [\n    ' + ', '.join(f'[{x}, {y}]' for x, y in data['footprint']) + '\n  ],')
lines.append('  "floors": [')
for i, f in enumerate(data['floors']):
    head = {k: v for k, v in f.items() if k not in ('rooms',)}
    lines.append('    {')
    for k, v in head.items():
        lines.append(f'      "{k}": {json.dumps(v, ensure_ascii=False)},')
    lines.append('      "rooms": [')
    lines.append(',\n'.join(dump_room(r) for r in f['rooms']))
    lines.append('      ]')
    lines.append('    }' + (',' if i < len(data['floors']) - 1 else ''))
lines.append('  ]')
lines.append('}')
text = '\n'.join(lines) + '\n'
json.loads(text)
DST.write_text(text, encoding='utf-8')

# timetable links for Building 2
idx_p = ROOT / 'viewer/data/room_index.json'
idx = json.loads(idx_p.read_text(encoding='utf-8'))
idx['rooms']['bld_e1'] = {
    'Room 101': {'floor': 'G', 'room': 'room_101'},
    'Lab 1': {'floor': 'G', 'room': 'lab_1'},
    'Room 102': {'floor': '1', 'room': 'room_102'},
    'Room 103': {'floor': '1', 'room': 'room_103'},
    'Room 104': {'floor': '1', 'room': 'room_104'},
    'Lab 2': {'floor': '1', 'room': 'lab_2'},
    'Room 204': {'floor': '2', 'room': 'room_204'},
    'Room 205': {'floor': '2', 'room': 'room_205'},
    'Room 206': {'floor': '2', 'room': 'room_206'},
    'Hall 1': {'floor': '2', 'room': 'hall_1'},
    'Hall 2': {'floor': '2', 'room': 'hall_2'},
    'Hall 3': {'floor': '3', 'room': 'hall_3'},
    'Hall 4': {'floor': '3', 'room': 'hall_4'},
}
idx_p.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('ok', sum(len(f['rooms']) for f in data['floors']), 'rooms')

"""EPNU campus - Blender build script (run headless):
    blender -b --factory-startup -P pipeline/blender_build.py
Creates deliverables/campus_model.blend, campus_model.glb, campus_model_mobile.glb.
Coordinates: local ENU metres (X east, Y north, Z up), origin lat 31.0198510 lon 32.6275438.
"""
import bpy, bmesh, json, math, os, sys, time
from mathutils import Vector, Matrix

ROOT = '/home/user/campus_project/'
DATA = ROOT + 'data/'
TEX = ROOT + 'deliverables/textures/'
OUTD = ROOT + 'deliverables/'
T0 = time.time()
def log(*a): print('[build %6.1fs]' % (time.time() - T0), *a, flush=True)

fpj = json.load(open(DATA + 'osm_footprints_local.json'))
LAY = json.load(open(DATA + 'site_layout.json'))
BINFO = {k: v for k, v in json.load(open(DATA + 'buildings.json')).items() if not k.startswith('_')}
ROADS = {w['id']: w for w in json.load(open(DATA + 'osm_roads_local.json'))}
OSM = {k[-2:]: b for k, b in fpj['buildings'].items() if b['inside_campus']}
OSM_ALL = fpj['buildings']

# ------------------------------------------------------------------ scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene['crs'] = fpj['crs']

COLL_NAMES = ['Campus Terrain', 'Main Buildings', 'Faculty Buildings', 'Entrances and Facades', 'Roads and Walkways',
              'Landscape and Vegetation', 'Campus Furniture', 'Lighting and Cameras', 'Context (outside campus)']
COLL = {}
for n in COLL_NAMES:
    c = bpy.data.collections.new(n); scene.collection.children.link(c); COLL[n] = c

# ------------------------------------------------------------------ materials
IMG_CACHE = {}
def img(name, noncolor=False):
    key = (name, noncolor)
    if key in IMG_CACHE: return IMG_CACHE[key]
    path = TEX + name
    if not os.path.exists(path): raise FileNotFoundError(path)
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    IMG_CACHE[key] = im
    return im

ROOF_AC = []
MATS = {}
def mat(name, tex=None, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, normal=True, rough_map=True, alpha_clip=False,
        emission=None, emission_strength=0.0, normal_strength=1.0, ext='jpg'):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    if tex:
        bc = nt.nodes.new('ShaderNodeTexImage'); bc.image = img(f'{tex}_basecolor.{ext}'); bc.location = (-600, 300)
        nt.links.new(bc.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_clip:
            gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5; gt.location = (-300, 100)
            nt.links.new(bc.outputs['Alpha'], gt.inputs[0]); nt.links.new(gt.outputs[0], bsdf.inputs['Alpha'])
            try: m.surface_render_method = 'DITHERED'
            except Exception: pass
            m.use_backface_culling = False
        if normal and os.path.exists(TEX + f'{tex}_normal.png'):
            nm = nt.nodes.new('ShaderNodeTexImage'); nm.image = img(f'{tex}_normal.png', True); nm.location = (-600, -300)
            nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = normal_strength; nmap.location = (-300, -300)
            nt.links.new(nm.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        if rough_map and os.path.exists(TEX + f'{tex}_roughness.jpg'):
            rm = nt.nodes.new('ShaderNodeTexImage'); rm.image = img(f'{tex}_roughness.jpg', True); rm.location = (-600, 0)
            nt.links.new(rm.outputs['Color'], bsdf.inputs['Roughness'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    MATS[name] = m
    return m

M = {
    'plaster': mat('M_Plaster_Cream', 'plaster_cream', rough=0.85),
    'sandstone': mat('M_Sandstone_Ashlar', 'sandstone_ashlar', rough=0.8),
    'fac_up': mat('M_Facade_Upper_Windows', 'facade_upper'),
    'fac_gf': mat('M_Facade_Ground_Windows', 'facade_ground'),
    'fac_main_up': mat('M_Facade_Main_Upper', 'facade_main_upper'),
    'fac_main_gf': mat('M_Facade_Main_Ground', 'facade_main_ground'),
    'roof': mat('M_Roof_Membrane', 'roof_membrane', rough=0.8),
    'dome': mat('M_Dome_White_Ribbed', 'dome_ribbed', rough=0.5),
    'drum': mat('M_Dome_Drum', 'dome_drum', normal=False),
    'glass': mat('M_Glass_BlueGrey', None, color=(0.20, 0.27, 0.34), rough=0.06, metal=0.0),
    'frame': mat('M_Aluminium_White', None, color=(0.86, 0.86, 0.85), rough=0.35, metal=0.0),
    'metal': mat('M_Metal_Dark', 'metal_dark', rough=0.45, metal=0.6),
    'timber': mat('M_Timber', 'timber', rough=0.7),
    'lawn': mat('M_Lawn', 'lawn', rough=0.95),
    'turf': mat('M_Pitch_Turf', 'pitch_markings', rough=0.8, normal=False, rough_map=False),
    'sand': mat('M_Desert_Sand', 'desert_sand', rough=0.95),
    'plan': mat('M_Campus_Ground_Plan', 'site_plan', rough=0.9, normal=False, rough_map=False),
    'asphalt': mat('M_Asphalt', None, color=(0.075, 0.075, 0.08), rough=0.9),
    'curb_b': mat('M_Curb_Black', None, color=(0.03, 0.03, 0.03), rough=0.8),
    'curb_w': mat('M_Curb_White', None, color=(0.85, 0.85, 0.83), rough=0.8),
    'fabric': mat('M_Shade_Fabric', None, color=(0.86, 0.84, 0.78), rough=0.9),
    'foliage': mat('M_Foliage', None, color=(0.10, 0.20, 0.06), rough=0.9),
    'palm_leaf': mat('M_Palm_Frond', None, color=(0.16, 0.24, 0.08), rough=0.9),
    'trunk': mat('M_Tree_Trunk', None, color=(0.22, 0.16, 0.10), rough=0.9),
    'lamp_glow': mat('M_Lamp_Lens', None, color=(0.95, 0.93, 0.85), rough=0.3, emission=(1.0, 0.93, 0.78), emission_strength=0.0),
    'hall_roof': mat('M_Hall_Roof_Green_Metal', None, color=(0.33, 0.43, 0.30), rough=0.45, metal=0.5),
    'roller': mat('M_Roller_Door', 'roller_door', normal=False, rough=0.5, metal=0.4),
    'railing': mat('M_Fence_Railing', 'fence_railing', alpha_clip=True, normal=False, rough_map=False, rough=0.5, metal=0.6, ext='png'),
    'pitchfence': mat('M_Pitch_Fence_Mesh', 'pitch_fence', alpha_clip=True, normal=False, rough_map=False, rough=0.6, ext='png'),
    'sign_en': mat('M_Sign_Gate_EN', 'sign_gate_en', normal=False, rough=0.6),
    'sign_ar': mat('M_Sign_Gate_AR', 'sign_gate_ar', normal=False, rough=0.6),
    'sign_no1': mat('M_Sign_Gate_No1', 'sign_gate_no1', normal=False, rough=0.6),
    'sign_main': mat('M_Sign_Main_Building', 'sign_main_building', normal=False, rough=0.5),
    'concrete': mat('M_Concrete_Light', 'concrete_light', rough=0.9),
    'context': mat('M_Context_Massing', None, color=(0.78, 0.74, 0.68), rough=0.9),
    'water_tank': mat('M_Rooftop_Equipment', None, color=(0.75, 0.76, 0.78), rough=0.5, metal=0.3),
}

# ------------------------------------------------------------------ geometry helpers
def area2(p):
    return sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p))) / 2

def simplify(poly, min_edge=1.2, ang_tol=6.0):
    p = [tuple(v) for v in poly]
    if area2(p) < 0: p = p[::-1]
    changed = True
    while changed and len(p) > 4:
        changed = False
        # merge very short edges
        for i in range(len(p)):
            a, b = p[i], p[(i + 1) % len(p)]
            if math.hypot(b[0] - a[0], b[1] - a[1]) < min_edge:
                del p[(i + 1) % len(p)]; changed = True; break
        if changed: continue
        for i in range(len(p)):
            a, b, c = p[i - 1], p[i], p[(i + 1) % len(p)]
            v1 = (b[0] - a[0], b[1] - a[1]); v2 = (c[0] - b[0], c[1] - b[1])
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            if l1 < 1e-6 or l2 < 1e-6: del p[i]; changed = True; break
            cr = (v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2)
            if abs(math.degrees(math.asin(max(-1, min(1, cr))))) < ang_tol and (v1[0] * v2[0] + v1[1] * v2[1]) > 0:
                del p[i]; changed = True; break
    return p

def offset(poly, d):
    """Miter offset of a CCW polygon (d>0 outward)."""
    n = len(poly); out = []
    for i in range(n):
        a, b, c = Vector((*poly[i - 1], 0)), Vector((*poly[i], 0)), Vector((*poly[(i + 1) % n], 0))
        e1 = (b - a).normalized(); e2 = (c - b).normalized()
        n1 = Vector((e1.y, -e1.x, 0)); n2 = Vector((e2.y, -e2.x, 0))
        bis = (n1 + n2)
        if bis.length < 1e-6: bis = n1
        bis.normalize()
        cosang = max(0.35, bis.dot(n1))
        p = b + bis * (d / cosang)
        out.append((p.x, p.y))
    return out

class MeshBuilder:
    def __init__(self, name):
        self.name = name; self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap'); self.mats = []
    def mi(self, m):
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)
    def face(self, verts, uvs, m, smooth=False):
        vs = [self.bm.verts.new(v) for v in verts]
        try: f = self.bm.faces.new(vs)
        except ValueError: return None
        for loop, uv in zip(f.loops, uvs): loop[self.uv].uv = uv
        f.material_index = self.mi(m); f.smooth = smooth
        return f
    def quad_wall(self, a, b, z0, z1, m, u0=0, u1=None, v0=None, v1=None, tile=2.0):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if u1 is None: u1 = u0 + L / tile
        if v0 is None: v0, v1 = z0 / tile, z1 / tile
        return self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], m)
    def cap(self, poly, z, m, tile=4.0, down=False):
        pts = poly[::-1] if down else poly
        return self.face([(x, y, z) for x, y in pts], [(x / tile, y / tile) for x, y in pts], m)
    def prism(self, poly, z0, z1, m_side, m_top=None, tile=2.0, bottom=False):
        for i in range(len(poly)):
            self.quad_wall(poly[i], poly[(i + 1) % len(poly)], z0, z1, m_side, tile=tile)
        self.cap(poly, z1, m_top or m_side, tile=tile)
        if bottom: self.cap(poly, z0, m_side, tile=tile, down=True)
    def box(self, cx, cy, z0, sx, sy, sz, m, rot=0.0, tile=2.0):
        c, s = math.cos(rot), math.sin(rot)
        pts = [(cx + c * x - s * y, cy + s * x + c * y) for x, y in [(-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)]]
        self.prism(pts, z0, z0 + sz, m, tile=tile, bottom=False)
    def cylinder(self, cx, cy, z0, z1, r, m, seg=16, cap=True, r_top=None, tile=2.0, smooth=True):
        rt = r if r_top is None else r_top
        ring0 = [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        ring1 = [(cx + rt * math.cos(2 * math.pi * i / seg), cy + rt * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        circ = 2 * math.pi * r
        for i in range(seg):
            j = (i + 1) % seg
            self.face([(*ring0[i], z0), (*ring0[j], z0), (*ring1[j], z1), (*ring1[i], z1)],
                      [(circ * i / seg / tile, z0 / tile), (circ * (i + 1) / seg / tile, z0 / tile), (circ * (i + 1) / seg / tile, z1 / tile), (circ * i / seg / tile, z1 / tile)], m, smooth)
        if cap: self.cap(ring1, z1, m, tile=tile)
    def finish(self, coll, parent=None, props=None):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0005)
        self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me); coll.objects.link(ob)
        if parent: ob.parent = parent
        if props:
            for k, v in props.items(): ob[k] = v
        return ob

def empty(name, coll, parent=None, loc=(0, 0, 0), props=None):
    e = bpy.data.objects.new(name, None); e.location = loc; coll.objects.link(e)
    e.empty_display_size = 2
    if parent: e.parent = parent
    if props:
        for k, v in props.items(): e[k] = v
    return e

def point_in_poly(x, y, poly):
    ins = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: ins = not ins
    return ins

def dist_to_edges(x, y, poly):
    best = 1e9
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        dx, dy = x2 - x1, y2 - y1; L2 = dx * dx + dy * dy
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L2)) if L2 > 0 else 0
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return best

# ------------------------------------------------------------------ building generator
def facade_walls(mb, poly, z0, z1, m_fac, m_plain, bay_w, floor_h):
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 2.6:
            mb.quad_wall(a, b, z0, z1, m_plain, tile=2.0); continue
        nb = max(1, round(L / bay_w))
        nf = max(1, round((z1 - z0) / floor_h))
        mb.quad_wall(a, b, z0, z1, m_fac, u0=0, u1=nb, v0=0, v1=nf)

def ring_band(mb, outer, inner, z0, z1, m, tile=2.0):
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        mb.quad_wall(outer[i], outer[j], z0, z1, m, tile=tile)
        mb.quad_wall(inner[j], inner[i], z0, z1, m, tile=tile)   # inner face (reversed)
        mb.face([(*outer[i], z1), (*outer[j], z1), (*inner[j], z1), (*inner[i], z1)],
                [(outer[i][0] / tile, outer[i][1] / tile), (outer[j][0] / tile, outer[j][1] / tile), (inner[j][0] / tile, inner[j][1] / tile), (inner[i][0] / tile, inner[i][1] / tile)], m)

def convex_corners(poly):
    res = []
    n = len(poly)
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        if cr > 0: res.append((i, b, math.atan2(b[1] - a[1], b[0] - a[0])))
    return res

def build_block(bid, info, poly, parent_coll):
    root = empty(bid, parent_coll, props=dict(building_id=bid, name_en=info['name_en'], name_ar=info['name_ar'], category=info['category'],
                                              storeys=info.get('storeys', 0), evidence=info['evidence'], description=info['description'],
                                              osm_way='12500926' + info['osm'], sfm_height=info.get('sfm_height_m', ''), selectable=True))
    P = simplify(poly)
    pl, gf, up, par = info['plinth'], info['gf_h'], info['up_h'], info['parapet']
    n_up = info['storeys'] - 1
    z_gf = pl; z_up = pl + gf; z_roof = z_up + n_up * up
    upm = M['fac_main_up'] if info['kind'] == 'main' else M['fac_up']
    gfm = M['fac_main_gf'] if info['kind'] == 'main' else M['fac_gf']
    mb = MeshBuilder(bid + '_walls')
    mb.prism(offset(P, 0.25), 0.0, pl, M['sandstone'], tile=1.2)                     # plinth
    facade_walls(mb, P, z_gf, z_up, gfm, M['sandstone'], 3.6, gf)                    # ground floor, sandstone + windows
    facade_walls(mb, P, z_up, z_roof, upm, M['plaster'], 3.6, up)                    # upper floors, plaster + windows
    mb.finish(parent_coll, root)
    tr = MeshBuilder(bid + '_trim')
    tr.prism(offset(P, 0.14), z_up - 0.05, z_up + 0.35, M['plaster'], tile=2.0)      # string course
    tr.prism(offset(P, 0.45), z_roof, z_roof + 0.75, M['plaster'], tile=2.0)          # cornice
    inner = offset(P, -0.25)
    ring_band(tr, P, inner, z_roof + 0.75, z_roof + 0.75 + par, M['plaster'])         # parapet
    ring_band(tr, offset(P, 0.08), offset(P, -0.33), z_roof + 0.75 + par, z_roof + 0.9 + par, M['plaster'])  # coping
    for i, (x, y), ang in convex_corners(P):                                          # corner pilasters
        tr.box(x - 0.15 * math.cos(ang) + 0.15 * math.sin(ang), y - 0.15 * math.sin(ang) - 0.15 * math.cos(ang), z_gf, 1.1, 1.1, z_roof - z_gf, M['plaster'], rot=ang)
    tr.finish(parent_coll, root)
    rf = MeshBuilder(bid + '_roof')
    rf.cap(inner, z_roof + 0.76, M['roof'], tile=4.0)
    # rooftop stair/lift rooms, water tanks, AC units (aerial frames 119-124 s show several per roof; positions estimated)
    xs = [p[0] for p in P]; ys = [p[1] for p in P]
    cands = []
    for fx in (0.1, 0.3, 0.5, 0.7, 0.9):
        for fy in (0.1, 0.3, 0.5, 0.7, 0.9):
            x = min(xs) + fx * (max(xs) - min(xs)); y = min(ys) + fy * (max(ys) - min(ys))
            if point_in_poly(x, y, P) and dist_to_edges(x, y, P) > 5.0: cands.append((x, y))
    zr = z_roof + 0.76
    rooms = []
    for (x, y) in cands:
        if len(rooms) < 4 and all(math.hypot(x - a, y - b) > 15 for a, b in rooms): rooms.append((x, y))
    for (x, y) in rooms:
        rf.box(x, y, zr, 6.5, 5.0, 3.6, M['plaster'], tile=2.0)
        rf.box(x, y, zr + 3.6, 7.0, 5.5, 0.3, M['plaster'], tile=2.0)
    others = [c for c in cands if all(math.hypot(c[0] - a, c[1] - b) > 6 for a, b in rooms)]
    for k, (x, y) in enumerate(others[:3]):
        rf.cylinder(x + 1.5, y, zr, zr + 2.2, 1.1, M['water_tank'], seg=14)
        rf.cylinder(x - 1.2, y + 1.0, zr, zr + 2.2, 1.1, M['water_tank'], seg=14)
    for k, (x, y) in enumerate(others[3:12]):
        for j in range(3):
            ROOF_AC.append((x + (j - 1) * 1.8, y + 2.5, zr, 0.0))
    rf.finish(parent_coll, root)
    return root, P, z_roof

def u_court_entrances(bid, root, P, coll, z_gf, z_roof):
    """Glazed central entrance bay on the courtyard back wall (frame 97.4 s)."""
    pass

def build_main_extras(root, info, P, z_roof):
    pl, gf, up = info['plinth'], info['gf_h'], info['up_h']
    coll = COLL['Main Buildings']; ent = COLL['Entrances and Facades']
    raw = OSM['15']['poly']
    # dome centre/radius: least-squares circle through the arc vertices of the OSM footprint (rotunda)
    arc = [tuple(raw[i]) for i in range(16, 25) if i < len(raw)]
    xs = [p[0] for p in arc]; ys = [p[1] for p in arc]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    # algebraic circle fit
    Suu = sum((x - mx) ** 2 for x in xs); Svv = sum((y - my) ** 2 for y in ys); Suv = sum((x - mx) * (y - my) for x, y in arc)
    Suuu = sum((x - mx) ** 3 for x in xs); Svvv = sum((y - my) ** 3 for y in ys)
    Suvv = sum((x - mx) * (y - my) ** 2 for x, y in arc); Svuu = sum((y - my) * (x - mx) ** 2 for x, y in arc)
    det = Suu * Svv - Suv * Suv
    uc = (0.5 * (Suuu + Suvv) * Svv - 0.5 * (Svvv + Svuu) * Suv) / det
    vc = (0.5 * (Svvv + Svuu) * Suu - 0.5 * (Suuu + Suvv) * Suv) / det
    dcx, dcy = mx + uc, my + vc
    r = sum(math.hypot(x - dcx, y - dcy) for x, y in arc) / len(arc)
    r = max(6.5, min(r, 9.5))
    log('dome centre (%.1f, %.1f) r %.2f' % (dcx, dcy, r))
    root['dome_centre'] = [round(dcx, 2), round(dcy, 2)]; root['dome_radius_m'] = round(r, 2)
    d = MeshBuilder('bld_main_dome')
    zr = z_roof + 0.76
    d.cylinder(dcx, dcy, zr, zr + 1.0, r + 0.6, M['plaster'], seg=48)                  # base ring
    # drum with windows (UV u spans full circle once -> dome_drum texture)
    seg = 64; zd0, zd1 = zr + 1.0, zr + 4.2
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        p0 = (dcx + r * math.cos(a0), dcy + r * math.sin(a0)); p1 = (dcx + r * math.cos(a1), dcy + r * math.sin(a1))
        d.face([(*p0, zd0), (*p1, zd0), (*p1, zd1), (*p0, zd1)], [(i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1)], M['drum'], smooth=True)
    d.cylinder(dcx, dcy, zd1, zd1 + 0.5, r + 0.35, M['plaster'], seg=48)               # drum cornice
    # dome (slightly stilted hemisphere), UV u around, v up
    rings = 16; zb = zd1 + 0.5; H = r * 1.06
    prev = None
    for k in range(rings + 1):
        phi = (math.pi / 2) * k / rings
        rr = r * math.cos(phi); zz = zb + H * math.sin(phi)
        ring = [(dcx + rr * math.cos(2 * math.pi * i / seg), dcy + rr * math.sin(2 * math.pi * i / seg), zz) for i in range(seg)]
        if prev:
            for i in range(seg):
                j = (i + 1) % seg
                d.face([prev[i], prev[j], ring[j], ring[i]], [(i / seg, (k - 1) / rings), ((i + 1) / seg, (k - 1) / rings), ((i + 1) / seg, k / rings), (i / seg, k / rings)], M['dome'], smooth=True)
        prev = ring
    d.cylinder(dcx, dcy, zb + H - 0.05, zb + H + 0.6, 0.45, M['dome'], seg=12)
    d.cylinder(dcx, dcy, zb + H + 0.6, zb + H + 2.6, 0.08, M['metal'], seg=8)          # finial
    d.finish(coll, root)
    root['dome_top_m'] = round(zb + H + 2.6, 1)
    # ---- west facade pavilions with giant columns (frame 90.3 s) ----
    xs = [p[0] for p in P]
    fx = min(xs)                                     # west facade plane
    yc = -52.0                                       # entrance axis (gate axis)
    zc0 = pl; zc1 = pl + gf + up                     # columns span ground + first floor
    pv = MeshBuilder('bld_main_pavilions')
    for (y0, w, centre) in [(yc, 12.0, True), (yc + 17.5, 11.0, False), (yc - 17.5, 11.0, False)]:
        x_out = fx - 1.2
        rect = [(x_out, y0 - w / 2), (fx + 0.05, y0 - w / 2), (fx + 0.05, y0 + w / 2), (x_out, y0 + w / 2)]
        # pavilion front wall: facade texture, plaster upper / sandstone base
        pv.quad_wall(rect[3], rect[0], pl, pl + gf, M['fac_main_gf'], u0=0, u1=max(1, round(w / 3.6)), v0=0, v1=1)
        pv.quad_wall(rect[3], rect[0], pl + gf, z_roof, M['fac_main_up'], u0=0, u1=max(1, round(w / 3.6)), v0=0, v1=round((z_roof - pl - gf) / up))
        pv.quad_wall(rect[0], rect[1], pl, z_roof, M['plaster']); pv.quad_wall(rect[2], rect[3], pl, z_roof, M['plaster'])
        pv.prism(offset(rect, 0.5), z_roof, z_roof + 1.2, M['plaster'])               # raised pavilion cornice
        pv.prism(offset(rect, 0.1), z_roof + 1.2, z_roof + 2.6, M['plaster'])        # attic / parapet (pavilions stand higher)
        pv.prism(offset(rect, 0.3), 0.0, pl, M['sandstone'], tile=1.2)
        # paired giant columns at both pavilion edges, plus entablature
        for side in (-1, 1):
            for k in (0, 1):
                cy = y0 + side * (w / 2 - 0.8 - k * 1.5); cx = x_out - 1.0
                pv.box(cx, cy, zc0, 1.2, 1.2, 0.5, M['plaster'])                     # base
                pv.cylinder(cx, cy, zc0 + 0.5, zc1 - 0.6, 0.42, M['plaster'], seg=20, r_top=0.37)
                pv.box(cx, cy, zc1 - 0.6, 1.1, 1.1, 0.6, M['plaster'])                # capital
        pv.box(x_out - 1.0, y0, zc1, 1.4, w, 0.9, M['plaster'])                       # entablature
        if centre:
            pv.box(x_out - 1.0, y0, zc1 + 0.9, 1.6, w + 0.4, 0.35, M['plaster'])
            # glazed double entrance + central pier with sign (frame 91.6 s)
            for s2 in (-1, 1):
                gx = x_out - 0.02; gy = y0 + s2 * 2.4
                pv.face([(gx, gy - 1.6, pl), (gx, gy + 1.6, pl), (gx, gy + 1.6, pl + 3.4), (gx, gy - 1.6, pl + 3.4)], [(0, 0), (1, 0), (1, 1), (0, 1)], M['glass'])
                for fy in (-1.6, 0.0, 1.6):
                    pv.box(gx - 0.03, gy + fy, pl, 0.08, 0.1, 3.4, M['frame'])
                pv.box(gx - 0.03, gy, pl + 3.35, 0.08, 3.3, 0.1, M['frame'])
            pv.box(x_out - 0.25, y0, pl, 0.5, 1.4, z_roof - pl, M['plaster'])          # central pier
            pv.face([(x_out - 0.52, y0 + 1.6, pl + 3.6), (x_out - 0.52, y0 - 1.6, pl + 3.6), (x_out - 0.52, y0 - 1.6, pl + 4.8), (x_out - 0.52, y0 + 1.6, pl + 4.8)],
                    [(0, 0), (1, 0), (1, 1), (0, 1)], M['sign_main'])
            for s in range(4):                                                        # entrance steps
                pv.box(x_out - 2.0 - (3 - s) * 0.4, y0, 0.0, 0.4 + (3 - s) * 0.8, w - 1.0, pl * (s + 1) / 4, M['sandstone'], tile=1.2)
    pv.finish(ent, root)

def build_hall(bid, info, poly, coll):
    root = empty(bid, coll, props=dict(building_id=bid, name_en=info['name_en'], name_ar=info['name_ar'], category=info['category'],
                                       storeys=info['storeys'], evidence=info['evidence'], description=info['description'],
                                       osm_way='12500926' + info['osm'], sfm_height=info.get('sfm_height_m', ''), selectable=True))
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    if bid == 'bld_h2':
        a = OSM['16']['poly']; xs += [p[0] for p in a]; ys += [p[1] for p in a]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    ysplit = y0 + 0.42 * (y1 - y0)
    mb = MeshBuilder(bid + '_block')
    blk = [(x0, y0), (x1, y0), (x1, ysplit), (x0, ysplit)]
    mb.prism(offset(blk, 0.2), 0, 0.3, M['sandstone'], tile=1.2)
    facade_walls(mb, blk, 0.3, 4.5, M['fac_up'], M['plaster'], 3.6, 4.2)
    facade_walls(mb, blk, 4.5, 8.5, M['fac_up'], M['plaster'], 3.6, 4.0)
    mb.prism(offset(blk, 0.35), 8.5, 9.1, M['plaster']); ring_band(mb, blk, offset(blk, -0.25), 9.1, 10.1, M['plaster'])
    mb.cap(offset(blk, -0.25), 9.11, M['roof'])
    mb.finish(coll, root)
    hb = MeshBuilder(bid + '_hall')
    hall = [(x0 + 0.3, ysplit), (x1 - 0.3, ysplit), (x1 - 0.3, y1), (x0 + 0.3, y1)]
    eave, ridge = 7.5, 11.0
    for i in range(4):
        a, b = hall[i], hall[(i + 1) % 4]
        hb.quad_wall(a, b, 0, eave, M['plaster'], tile=2.0)
    xm = (x0 + x1) / 2
    for yy, flip in ((ysplit, False), (y1, True)):
        tri = [(x0 + 0.3, yy, eave), (x1 - 0.3, yy, eave), (xm, yy, ridge)]
        hb.face(tri[::-1] if not flip else tri, [(0, 0), (1, 0), (0.5, 1)], M['plaster'])
    ov = 0.6
    for side in (-1, 1):
        xe = (x0 + 0.3 - ov) if side < 0 else (x1 - 0.3 + ov)
        pts = [(xe, ysplit - 0.3, eave - 0.25), (xm, ysplit - 0.3, ridge + 0.05), (xm, y1 + ov, ridge + 0.05), (xe, y1 + ov, eave - 0.25)]
        if side > 0: pts = pts[::-1]
        hb.face(pts, [(0, 0), (1, 0), (1, 1), (0, 1)], M['hall_roof'])
    # roller door on the north gable (frame 0.5 s)
    dw = min(6.0, (x1 - x0) * 0.4)
    hb.face([(xm + dw / 2, y1 + 0.03, 0.05), (xm - dw / 2, y1 + 0.03, 0.05), (xm - dw / 2, y1 + 0.03, 5.5), (xm + dw / 2, y1 + 0.03, 5.5)], [(0, 0), (1, 0), (1, 1), (0, 1)], M['roller'])
    hb.box(xm, y1 + 0.3, 5.5, dw + 0.6, 0.6, 0.5, M['plaster'])
    hb.finish(coll, root)
    return root

def build_gate():
    info = BINFO['gate_1']; g = LAY['gate']
    coll = COLL['Entrances and Facades']
    gx, gy = g['x'], g['y']
    root = empty('gate_1', coll, props=dict(building_id='gate_1', name_en=info['name_en'], name_ar=info['name_ar'], category=info['category'],
                                             evidence=info['evidence'], description=info['description'], selectable=True))
    mb = MeshBuilder('gate_1_structure')
    # central pier 4 m wide, 9.5 m tall with roundel + "بوابة رقم ١"
    mb.box(gx, gy, 0, 2.4, 4.2, 9.5, M['plaster']); mb.box(gx, gy, 9.5, 2.8, 4.6, 0.6, M['plaster'])
    mb.face([(gx - 1.22, gy + 1.6, 5.0), (gx - 1.22, gy - 1.6, 5.0), (gx - 1.22, gy - 1.6, 6.6), (gx - 1.22, gy + 1.6, 6.6)], [(0, 0), (1, 0), (1, 1), (0, 1)], M['sign_no1'])
    mb.cylinder(gx - 1.25, gy, 0, 0, 0.0, M['plaster'], seg=3, cap=False) if False else None
    for side in (-1, 1):
        y_in, y_out = gy + side * 2.1, gy + side * 10.6
        ymid = (y_in + y_out) / 2
        # lettered beam over each vehicle opening (EN on north span, AR on south span - frame 8.88 s)
        mb.box(gx, ymid, 6.6, 2.0, abs(y_out - y_in), 1.6, M['plaster'])
        smat = M['sign_en'] if side > 0 else M['sign_ar']
        ya, yb = (y_out, y_in) if side > 0 else (y_in, y_out)
        mb.face([(gx - 1.02, ya, 6.75), (gx - 1.02, yb, 6.75), (gx - 1.02, yb, 8.05), (gx - 1.02, ya, 8.05)], [(0, 0), (1, 0), (1, 1), (0, 1)], smat)
        mb.box(gx, ymid, 8.2, 2.3, abs(y_out - y_in) + 0.4, 0.4, M['plaster'])
        # paired columns at the outer side of the opening
        for k in (0, 1):
            cy = y_out - side * (0.5 + k * 1.1)
            mb.box(gx - 0.5, cy, 0, 0.9, 0.9, 0.4, M['plaster']); mb.cylinder(gx - 0.5, cy, 0.4, 6.2, 0.32, M['plaster'], seg=16)
            mb.box(gx - 0.5, cy, 6.2, 0.9, 0.9, 0.4, M['plaster'])
        # guard pavilion
        y_p0, y_p1 = gy + side * 11.0, gy + side * 20.5
        pav = [(gx - 3.0, min(y_p0, y_p1)), (gx + 3.0, min(y_p0, y_p1)), (gx + 3.0, max(y_p0, y_p1)), (gx - 3.0, max(y_p0, y_p1))]
        mb.prism(offset(pav, 0.15), 0, 0.45, M['sandstone'], tile=1.2)
        facade_walls(mb, pav, 0.45, 4.6, M['fac_up'], M['plaster'], 3.6, 4.15)
        mb.prism(offset(pav, 0.45), 4.6, 5.3, M['plaster']); ring_band(mb, pav, offset(pav, -0.25), 5.3, 6.1, M['plaster'])
        mb.cap(offset(pav, -0.25), 5.31, M['roof'])
    mb.finish(coll, root)
    # sliding gates (dark railings) in both openings
    gt = MeshBuilder('gate_1_sliding_gates')
    for side in (-1, 1):
        ya, yb = gy + side * 2.2, gy + side * 9.6
        gt.face([(gx + 0.2, ya, 0.05), (gx + 0.2, yb, 0.05), (gx + 0.2, yb, 2.4), (gx + 0.2, ya, 2.4)], [(0, 0), (abs(yb - ya) / 3.6, 0), (abs(yb - ya) / 3.6, 1), (0, 1)], M['railing'])
    gt.finish(coll, root)
    return root

# ------------------------------------------------------------------ instancing helpers
PROTO_COLL = bpy.data.collections.new('_prototypes (not exported)')
ROOF_AC = []
def proto(name, builder_fn):
    mb = MeshBuilder(name); builder_fn(mb)
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(mb.bm, verts=mb.bm.verts, dist=0.0005)
    mb.bm.to_mesh(me); mb.bm.free()
    for m in mb.mats: me.materials.append(m)
    return me

def instances(group_name, mesh, coll, items, props=None):
    """items: list of (x, y, z, rot_z, sx, sy, sz). Linked duplicates under one Empty -> EXT_mesh_gpu_instancing."""
    parent = empty(group_name, coll, props=props)
    for i, it in enumerate(items):
        x, y, z, rot = it[:4]; s = it[4:7] if len(it) >= 7 else (1, 1, 1)
        ob = bpy.data.objects.new(f'{group_name}_{i:04d}', mesh)
        ob.location = (x, y, z); ob.rotation_euler = (0, 0, rot); ob.scale = s
        coll.objects.link(ob); ob.parent = parent
    return parent

def lamp_proto(mb):     # curved-arm pole ~7 m (frames 85.5 s, 128.9 s)
    mb.cylinder(0, 0, 0, 0.35, 0.16, M['metal'], seg=8)
    mb.cylinder(0, 0, 0.35, 7.0, 0.07, M['metal'], seg=8, r_top=0.055)
    for k in range(6):
        a0 = math.radians(90 - k * 15); a1 = math.radians(90 - (k + 1) * 15)
        p0 = (0.6 - 0.6 * math.cos(math.radians(k * 15)), 7.0 + 0.6 * math.sin(math.radians(k * 15)))
        p1 = (0.6 - 0.6 * math.cos(math.radians((k + 1) * 15)), 7.0 + 0.6 * math.sin(math.radians((k + 1) * 15)))
        mb.box((p0[0] + p1[0]) / 2, 0, (p0[1] + p1[1]) / 2 - 0.04, 0.17, 0.08, 0.08, M['metal'])
    mb.box(0.95, 0, 7.45, 0.75, 0.32, 0.12, M['metal'])
    mb.face([(0.6, -0.14, 7.44), (1.3, -0.14, 7.44), (1.3, 0.14, 7.44), (0.6, 0.14, 7.44)][::-1], [(0, 0), (1, 0), (1, 1), (0, 1)], M['lamp_glow'])

def tree_proto(mb):     # young broadleaf street tree, ~4.5 m
    mb.cylinder(0, 0, 0, 2.0, 0.09, M['trunk'], seg=6, r_top=0.07)
    # low-poly crown: stacked octagonal frusta
    rs = [(2.0, 0.5), (2.6, 1.3), (3.4, 1.6), (4.2, 1.3), (4.8, 0.6), (5.1, 0.05)]
    seg = 8
    for k in range(len(rs) - 1):
        (z0, r0), (z1, r1) = rs[k], rs[k + 1]
        for i in range(seg):
            a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
            mb.face([(r0 * math.cos(a0), r0 * math.sin(a0), z0), (r0 * math.cos(a1), r0 * math.sin(a1), z0), (r1 * math.cos(a1), r1 * math.sin(a1), z1), (r1 * math.cos(a0), r1 * math.sin(a0), z1)],
                    [(0, 0), (1, 0), (1, 1), (0, 1)], M['foliage'], smooth=True)
    mb.cap([(0.5 * math.cos(2 * math.pi * i / seg), 0.5 * math.sin(2 * math.pi * i / seg)) for i in range(seg)], 2.0, M['foliage'], down=True)

def palm_proto(mb):     # date palm (approach road median, frame 5.43 s)
    mb.cylinder(0, 0, 0, 5.5, 0.28, M['trunk'], seg=8, r_top=0.2)
    for i in range(10):
        a = 2 * math.pi * i / 10; ca, sa = math.cos(a), math.sin(a)
        pts = []
        for t in range(5):
            r = 0.2 + t * 0.75; z = 5.5 + 0.9 * math.sin(t / 4 * math.pi) - 0.15 * t
            pts.append((r, z))
        for t in range(4):
            (r0, z0), (r1, z1) = pts[t], pts[t + 1]
            w0, w1 = 0.45 * (1 - t / 4) + 0.1, 0.45 * (1 - (t + 1) / 4) + 0.05
            q = [(r0 * ca - w0 * sa, r0 * sa + w0 * ca, z0), (r1 * ca - w1 * sa, r1 * sa + w1 * ca, z1), (r1 * ca + w1 * sa, r1 * sa - w1 * ca, z1), (r0 * ca + w0 * sa, r0 * sa - w0 * ca, z0)]
            mb.face(q, [(0, 0), (1, 0), (1, 1), (0, 1)], M['palm_leaf'])
            mb.face(q[::-1], [(0, 0), (1, 0), (1, 1), (0, 1)], M['palm_leaf'])

def bench_proto(mb):    # timber bench with dark steel frame
    mb.box(0, 0, 0.42, 1.8, 0.45, 0.06, M['timber']); mb.box(0, 0.2, 0.75, 1.8, 0.06, 0.32, M['timber'])
    for x in (-0.75, 0.75): mb.box(x, 0, 0, 0.06, 0.45, 0.42, M['metal'])

def gazebo_proto(mb):   # hexagonal timber gazebo, radius ~3.4 m (frames 57.76 s, 128.9 s)
    R = 3.4; seg = 6
    for i in range(seg):
        a = 2 * math.pi * i / seg + math.pi / 6
        mb.box(R * 0.92 * math.cos(a), R * 0.92 * math.sin(a), 0, 0.2, 0.2, 2.7, M['timber'])
    ring = [(R * math.cos(2 * math.pi * i / seg + math.pi / 6), R * math.sin(2 * math.pi * i / seg + math.pi / 6)) for i in range(seg)]
    mb.prism(offset(ring[::-1][::-1], 0.0), 2.7, 2.95, M['timber'], tile=1.0)
    ov = [(x * 1.18, y * 1.18) for x, y in ring]
    for i in range(seg):
        j = (i + 1) % seg
        mb.face([(*ov[i], 2.95), (*ov[j], 2.95), (0, 0, 4.4)], [(0, 0), (1, 0), (0.5, 1)], M['timber'])
        mb.face([(0, 0, 4.25), (*ov[j], 2.88), (*ov[i], 2.88)], [(0.5, 1), (1, 0), (0, 0)], M['timber'])
    mb.box(0, 0, 0, 1.6, 0.8, 0.75, M['timber'])

def sail_proto(mb):     # tensile shade sail on 4 poles, 7 x 5 m (frame 128.9 s)
    pts = [(-3.5, -2.5, 3.2), (3.5, -2.5, 4.2), (3.5, 2.5, 3.2), (-3.5, 2.5, 4.2)]
    for (x, y, z) in pts: mb.cylinder(x * 1.08, y * 1.1, 0, z + 0.2, 0.07, M['metal'], seg=8)
    mb.face(pts, [(0, 0), (1, 0), (1, 1), (0, 1)], M['fabric']); mb.face(pts[::-1], [(0, 0), (1, 0), (1, 1), (0, 1)], M['fabric'])

def curb_proto_b(mb): mb.box(0, 0, 0, 1.0, 0.16, 0.18, M['curb_b'])
def curb_proto_w(mb): mb.box(0, 0, 0, 1.0, 0.16, 0.18, M['curb_w'])

def pillar_proto(mb):   # perimeter fence pillar with cap + lantern (frames 0.5 s, 113.3 s; WhatsApp image)
    mb.box(0, 0, 0, 0.62, 0.62, 2.55, M['plaster'])
    mb.box(0, 0, 2.55, 0.78, 0.78, 0.18, M['plaster'])
    mb.box(0, 0, 2.73, 0.5, 0.5, 0.12, M['plaster'])
    mb.box(0, 0, 2.85, 0.22, 0.22, 0.3, M['lamp_glow'])

def railing_proto(mb):  # 1 m long railing panel unit on low wall (scaled in x per bay)
    mb.box(0, 0, 0, 1.0, 0.3, 0.55, M['plaster'])
    mb.face([(-0.5, 0, 0.55), (0.5, 0, 0.55), (0.5, 0, 2.3), (-0.5, 0, 2.3)], [(0, 0), (0.28, 0), (0.28, 1), (0, 1)], M['railing'])

def lampshort_proto(mb):  # short lamp posts around star plots (frame 0.5 s)
    mb.cylinder(0, 0, 0, 4.2, 0.05, M['metal'], seg=8); mb.box(0, 0, 4.2, 0.25, 0.25, 0.3, M['metal'])
    mb.box(0, 0, 4.1, 0.2, 0.2, 0.1, M['lamp_glow'])

def tank_proto(mb): mb.cylinder(0, 0, 0, 2.0, 1.0, M['water_tank'], seg=14)

# ================================================================== BUILD
log('terrain')
terr = COLL['Campus Terrain']
pt = LAY['plan_texture']; X0, Y0, S = pt['x0'], pt['y0'], pt['size']
g = MeshBuilder('TERRAIN_campus_ground_plan')
quad = [(X0, Y0), (X0 + S, Y0), (X0 + S, Y0 + S), (X0, Y0 + S)]
g.face([(x, y, 0) for x, y in quad], [((x - X0) / S, (y - Y0) / S) for x, y in quad], M['plan'])
gob = g.finish(terr, props=dict(evidence='Ground texture generated from the SfM orthophoto classification + OSM + video (pipeline/site_plan.py)'))
D = 1500.0
ds = MeshBuilder('TERRAIN_desert_surround')
for rect in [(-D, -D, X0, D), (X0 + S, -D, D, D), (X0, -D, X0 + S, Y0), (X0, Y0 + S, X0 + S, D)]:
    a, b, c, d2 = rect
    ds.face([(a, b, -0.02), (c, b, -0.02), (c, d2, -0.02), (a, d2, -0.02)], [(a / 6, b / 6), (c / 6, b / 6), (c / 6, d2 / 6), (a / 6, d2 / 6)], M['sand'])
ds.finish(terr, props=dict(evidence='Desert surroundings; texture = photo crop from video frame 113.3 s'))

log('roads outside the plan square')
rd = MeshBuilder('ROADS_highway_and_approach')
def ribbon(pts, w, z=0.02, xmax=None):
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        if xmax is not None:
            if x0 > xmax and x1 > xmax: continue
            if x1 > xmax: t = (xmax - x0) / (x1 - x0); x1, y1 = xmax, y0 + t * (y1 - y0)
            if x0 > xmax: t = (xmax - x1) / (x0 - x1); x0, y0 = xmax, y1 + t * (y0 - y1)
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 0.1: continue
        nx, ny = -(y1 - y0) / L * w / 2, (x1 - x0) / L * w / 2
        rd.face([(x0 - nx, y0 - ny, z), (x1 - nx, y1 - ny, z), (x1 + nx, y1 + ny, z), (x0 + nx, y0 + ny, z)], [(0, 0), (L / 10, 0), (L / 10, 1), (0, 1)], M['asphalt'])
for wid, w in [(1240566528, 10.5), (1272565460, 10.5), (1275731931, 7.0), (1486158204, 7.0), (1486158205, 7.0), (1278115381, 7), (1278115382, 7), (1278115383, 7)]:
    if wid in ROADS: ribbon([tuple(p) for p in ROADS[wid]['pts']], w, xmax=X0 - 0.01)
rd.finish(COLL['Roads and Walkways'], props=dict(evidence='OpenStreetMap highway/approach geometry (ODbL)'))

log('context buildings (neighbouring campus, OSM)')
ctx = COLL['Context (outside campus)']
for k, b in OSM_ALL.items():
    if b['inside_campus']: continue
    P = simplify(b['poly'], 1.5)
    if len(P) < 3 or abs(area2(P)) < 50: continue
    mb = MeshBuilder(f'CTX_osm_{k}')
    mb.prism(P, 0, 13.0, M['context'], m_top=M['roof'], tile=3.0)
    mb.finish(ctx, props=dict(evidence='OSM footprint; generic 13 m massing - neighbouring site, not part of EPNU'))

log('buildings')
built = {}
for bid, info in BINFO.items():
    if info['kind'] in ('block', 'main'):
        coll = COLL[info['collection']]
        root, P, z_roof = build_block(bid, info, OSM[info['osm']]['poly'], coll)
        root['height_m'] = round(z_roof + 0.75 + info['parapet'] + 0.15, 1)
        built[bid] = (root, P, z_roof)
        if info['kind'] == 'main': build_main_extras(root, info, P, z_roof)
    elif info['kind'] == 'hall':
        root = build_hall(bid, info, OSM[info['osm']]['poly'], COLL[info['collection']]); root['height_m'] = 11.0
        built[bid] = (root, None, None)
log('gate'); build_gate()

# U-courtyard entrance bays (frame 97.4 s shows a glazed central bay with columns at the courtyard end)
for bid, (cx, y_back, w) in {'bld_s1': (-57.5, -102.0, 12.0), 'bld_s2': (11.0, -126.0, 18.0), 'bld_s3': (79.0, -128.0, 18.0)}.items():
    root = built[bid][0]
    eb = MeshBuilder(bid + '_court_entrance')
    eb.face([(cx - 2.5, y_back + 0.06, 0.6), (cx + 2.5, y_back + 0.06, 0.6), (cx + 2.5, y_back + 0.06, 4.4), (cx - 2.5, y_back + 0.06, 4.4)], [(0, 0), (1, 0), (1, 1), (0, 1)], M['glass'])
    for dx in (-2.5, 0, 2.5): eb.box(cx + dx, y_back + 0.1, 0.6, 0.1, 0.08, 3.8, M['frame'])
    for dx in (-3.4, 3.4):
        eb.cylinder(cx + dx, y_back + 1.2, 0.6, 9.0, 0.38, M['plaster'], seg=16)
    eb.box(cx, y_back + 1.2, 9.0, 8.4, 2.0, 0.7, M['plaster'])
    for s in range(3): eb.box(cx, y_back + 2.0 + (2 - s) * 0.35, 0, 7.0, 0.7 + (2 - s) * 0.7, 0.2 * (s + 1), M['sandstone'], tile=1.2)
    eb.finish(COLL['Entrances and Facades'], root)

log('landscape prototypes')
P_LAMP = proto('PROTO_lamp_curved_arm', lamp_proto)
P_LAMPS = proto('PROTO_lamp_short', lampshort_proto)
P_TREE = proto('PROTO_tree_young', tree_proto)
P_PALM = proto('PROTO_palm', palm_proto)
P_BENCH = proto('PROTO_bench', bench_proto)
P_GAZ = proto('PROTO_gazebo_hex', gazebo_proto)
P_SAIL = proto('PROTO_shade_sail', sail_proto)
P_CB = proto('PROTO_curb_black', curb_proto_b)
P_CW = proto('PROTO_curb_white', curb_proto_w)
P_PIL = proto('PROTO_fence_pillar', pillar_proto)
P_AC = proto('PROTO_rooftop_ac_unit', lambda mb: (mb.box(0, 0, 0, 1.4, 0.9, 1.0, M['water_tank']), mb.cylinder(0, 0, 1.0, 1.05, 0.35, M['metal'], seg=10)))
P_RAIL = proto('PROTO_fence_railing_unit', railing_proto)

LV = COLL['Landscape and Vegetation']; FUR = COLL['Campus Furniture']; RW = COLL['Roads and Walkways']
plots_rects = [p['rect'] for p in LAY['plots']]
def near_plot(x, y):
    return any(r[0] - 1.5 <= x <= r[2] + 1.5 and r[1] - 1.5 <= y <= r[3] + 1.5 for r in plots_rects)
lamps_tall = [(l[0], l[1], 0, (hash((round(l[0]), round(l[1]))) % 360) * math.pi / 180) for l in LAY['lamps'] if not near_plot(l[0], l[1])]
lamps_short = [(l[0], l[1], 0, 0) for l in LAY['lamps'] if near_plot(l[0], l[1])]
instances('LIGHT_POLES_curved_arm', P_LAMP, FUR, lamps_tall, props=dict(evidence='Pole type verified (frames 85.5/128.9 s); positions estimated along traced paths'))
instances('LIGHT_POLES_short_plots', P_LAMPS, FUR, lamps_short, props=dict(evidence='Short posts around star plots (frame 0.5 s); spacing estimated'))
instances('TREES_young', P_TREE, LV, [(t[0], t[1], 0, (i * 47 % 360) * math.pi / 180, 1 + (i % 3) * 0.08, 1 + (i % 3) * 0.08, 1 + (i % 4) * 0.06) for i, t in enumerate(LAY['trees'])], props=dict(evidence='Young trees seen along paths/courtyards; positions estimated'))
instances('TREES_palms', P_PALM, LV, [(t[0], t[1], 0, (i * 36) * math.pi / 180) for i, t in enumerate(LAY['palms'])], props=dict(evidence='Palms in approach median/forecourt (frames 5.43 s, 90.3 s); count estimated'))
instances('BENCHES', P_BENCH, FUR, [(b[0], b[1], 0, math.radians(b[2])) for b in LAY['benches']], props=dict(evidence='Benches verified (frames 97.4/128.9 s); positions estimated'))
instances('GAZEBOS_hexagonal', P_GAZ, LV, [(gz['x'], gz['y'], 0, math.radians(gz['rot']), gz['size'] / 3.4, gz['size'] / 3.4, 1.0 if gz['size'] < 4 else 1.15) for gz in LAY['gazebos']],
          props=dict(building_id='lm_gazebo_garden', selectable=True, name_en=BINFO['lm_gazebo_garden']['name_en'], name_ar=BINFO['lm_gazebo_garden']['name_ar'],
                     category=BINFO['lm_gazebo_garden']['category'], evidence=BINFO['lm_gazebo_garden']['evidence'], description=BINFO['lm_gazebo_garden']['description']))
instances('ROOFTOP_ac_units', P_AC, COLL['Faculty Buildings'], ROOF_AC, props=dict(evidence='Generic rooftop equipment; positions estimated'))
instances('SHADE_SAILS', P_SAIL, FUR, [(s['x'], s['y'], 0, math.radians(s['rot'])) for s in LAY['shade_sails']], props=dict(evidence='Shade sails verified (frame 128.9 s); positions estimated'))

log('curbs')
cb, cw = [], []
for c in LAY['curbs']:
    pts = c['pts'] + ([c['pts'][0]] if c['closed'] else [])
    k = 0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 0.05: continue
        n = max(1, round(L / 1.0)); ang = math.atan2(y1 - y0, x1 - x0)
        for j in range(n):
            t = (j + 0.5) / n
            item = (x0 + t * (x1 - x0), y0 + t * (y1 - y0), 0, ang, L / n, 1, 1)
            (cb if k % 2 == 0 else cw).append(item); k += 1
instances('CURBS_black', P_CB, RW, cb, props=dict(evidence='Black/white painted kerbs verified (frames 90.3/128.9 s); alignment from SfM ortho traces'))
instances('CURBS_white', P_CW, RW, cw)
log('curb segments', len(cb) + len(cw))

log('perimeter fence')
F = LAY['fence']; gate = LAY['gate']
pil, rail = [], []
pts = F + [F[0]]
for i in range(len(pts) - 1):
    (x0, y0), (x1, y1) = pts[i], pts[i + 1]
    L = math.hypot(x1 - x0, y1 - y0)
    n = max(1, round(L / 3.6)); ang = math.atan2(y1 - y0, x1 - x0)
    for j in range(n + 1):
        t = j / n; x, y = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
        in_gate = abs(x - gate['x']) < 3 and abs(y - gate['y']) < gate['width'] / 2
        if not in_gate and j < n: pil.append((x, y, 0, ang))
        if j < n:
            xm, ym = x0 + (j + 0.5) / n * (x1 - x0), y0 + (j + 0.5) / n * (y1 - y0)
            if not (abs(xm - gate['x']) < 3 and abs(ym - gate['y']) < gate['width'] / 2 + 0.5):
                rail.append((xm, ym, 0, ang, L / n - 0.62, 1, 1))
instances('FENCE_pillars', P_PIL, COLL['Entrances and Facades'], pil, props=dict(evidence='Fence alignment traced from 2022 satellite; pillar/railing design verified (frames 0.5 s, 113.3 s); pillar spacing ~3.6 m estimated'))
instances('FENCE_railings', P_RAIL, COLL['Entrances and Facades'], rail)
log('fence pillars', len(pil))

log('sports pitch')
pr = LAY['pitch']['rect']
pm = MeshBuilder('lm_sports_pitch_surface')
q = [(pr[0], pr[1]), (pr[2], pr[1]), (pr[2], pr[3]), (pr[0], pr[3])]
pm.face([(x, y, 0.03) for x, y in q], [(0, 0), (1, 0), (1, 1), (0, 1)], M['turf'])
fh = LAY['pitch']['fence_h']; e = 1.5
fq = [(pr[0] - e, pr[1] - e), (pr[2] + e, pr[1] - e), (pr[2] + e, pr[3] + e), (pr[0] - e, pr[3] + e)]
for i in range(4):
    a, b = fq[i], fq[(i + 1) % 4]; L = math.hypot(b[0] - a[0], b[1] - a[1])
    pm.face([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], fh), (a[0], a[1], fh)], [(0, 0), (L / 2, 0), (L / 2, fh / 2), (0, fh / 2)], M['pitchfence'])
    for k in range(int(L // 3) + 1):
        t = k * 3 / L; pm.cylinder(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), 0, fh, 0.05, M['metal'], seg=6)
for (x, y) in fq:
    pm.cylinder(x, y, 0, 10.0, 0.12, M['metal'], seg=8); pm.box(x, y, 10.0, 1.2, 0.4, 0.6, M['metal'])
pob = pm.finish(LV)
for k, v in dict(building_id='lm_sports_pitch', selectable=True, name_en=BINFO['lm_sports_pitch']['name_en'], name_ar=BINFO['lm_sports_pitch']['name_ar'],
                 category=BINFO['lm_sports_pitch']['category'], evidence=BINFO['lm_sports_pitch']['evidence'], description=BINFO['lm_sports_pitch']['description']).items():
    pob[k] = v

log('pergola')
for pg in LAY['pergolas']:
    pb = MeshBuilder('PERGOLA_timber_curved')
    pts = pg['pts']; w = pg['width']; h = pg['height']
    # resample polyline every 3 m
    seq = [];
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]; L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L // 2.0))
        for j in range(n): t = j / n; seq.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0), math.atan2(y1 - y0, x1 - x0)))
    seq.append((*pts[-1], seq[-1][2]))
    for (x, y, a) in seq:
        nx, ny = -math.sin(a), math.cos(a)
        for s in (-0.5, 0.5): pb.box(x + nx * s * w, y + ny * s * w, 0, 0.22, 0.22, h, M['timber'], rot=a)
        pb.box(x, y, h, 0.18, w + 0.8, 0.25, M['timber'], rot=a)
    for i in range(len(seq) - 1):
        (x0, y0, a0), (x1, y1, a1) = seq[i], seq[i + 1]
        for s in (-0.5, 0.5):
            nx, ny = -math.sin(a0), math.cos(a0)
            L = math.hypot(x1 - x0, y1 - y0)
            pb.box((x0 + x1) / 2 + nx * s * w, (y0 + y1) / 2 + ny * s * w, h - 0.3, L + 0.3, 0.15, 0.3, M['timber'], rot=math.atan2(y1 - y0, x1 - x0))
    pb.finish(LV, props=dict(evidence=pg['evidence']))

log('lighting & cameras')
LC = COLL['Lighting and Cameras']
sun_d = bpy.data.lights.new('SUN_daylight', 'SUN'); sun_d.energy = 3.2; sun_d.angle = math.radians(0.6)
sun = bpy.data.objects.new('SUN_daylight', sun_d); LC.objects.link(sun)
sun.rotation_euler = (math.radians(40), 0, math.radians(135 + 180))  # morning sun from the south-east (matches shadows in clip 119-123 s and the 10:45 satellite pass)
world = bpy.data.worlds.new('WORLD_sky'); scene.world = world; world.use_nodes = True
wn = world.node_tree; bg = wn.nodes['Background']
sky = wn.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'
sky.sun_elevation = math.radians(50); sky.sun_rotation = math.radians(135 + 90)
sky.sun_disc = False                       # the sun is provided by the SUN lamp (avoid a double sun)
sky.air_density = 1.0; sky.dust_density = 0.5; sky.ozone_density = 1.0
wn.links.new(sky.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 0.22

def camera(name, loc, look, lens=24):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_end = 6000; cd.clip_start = 0.5
    ob = bpy.data.objects.new(name, cd); LC.objects.link(ob); ob.location = loc
    d = Vector(look) - Vector(loc); ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob
camera('CAM_overview_high_SW', (-300, -330, 250), (5, -5, 0), lens=30)
camera('CAM_aerial_NE_videomatch', (165, 240, 155), (20, -20, 0), lens=18)          # approx. drone pose of clip 119-123 s
camera('CAM_ground_main_building', (-196, -44, 1.7), (-160, -54, 8.0), lens=16)
camera('CAM_ground_plaza_gazebos', (95, 75, 9), (80, 20, 0), lens=20)
camera('CAM_gate_approach', (-268, -45.0, 1.8), (-206, -52, 7.5), lens=26)
camera('CAM_aerial_north_videomatch', (-60, 205, 22), (-60, 80, 6), lens=18)
camera('CAM_ground_courtyard_S2', (11, -98, 1.7), (11, -126, 6), lens=16)

# exact drone poses reconstructed by COLMAP (clip 119.6-123.4 s), for visual comparison QA
import numpy as np
def sfm_camera(name, clipdir, image_name):
    reg = json.load(open(clipdir + '/registration.json'))
    cam_line = [l for l in open(clipdir + '/sparse_txt/cameras.txt') if not l.startswith('#')][0].split()
    Wpx, f = float(cam_line[2]), float(cam_line[4])
    lines = [l for l in open(clipdir + '/sparse_txt/images.txt') if not l.startswith('#')]
    for i in range(0, len(lines), 2):
        p = lines[i].split()
        if p and p[9] == image_name:
            qw, qx, qy, qz = map(float, p[1:5]); t = np.array(list(map(float, p[5:8])))
            break
    else:
        return None
    R = np.array([[1 - 2*qy*qy - 2*qz*qz, 2*qx*qy - 2*qw*qz, 2*qx*qz + 2*qw*qy],
                  [2*qx*qy + 2*qw*qz, 1 - 2*qx*qx - 2*qz*qz, 2*qy*qz - 2*qw*qx],
                  [2*qx*qz - 2*qw*qy, 2*qy*qz + 2*qw*qx, 1 - 2*qx*qx - 2*qy*qy]])
    C = -R.T @ t
    e1, e2, e3, c0 = [np.array(reg[k]) for k in ('e1', 'e2', 'e3', 'c0')]
    sc_, th = reg['scale'], reg['theta']; ct, st = math.cos(th), math.sin(th)
    Rth = np.array([[ct, -st, 0], [st, ct, 0], [0, 0, 1]])
    A = Rth @ np.array([e1, e2, e3])
    cl = C - c0
    px_ = sc_ * (ct * (cl @ e1) - st * (cl @ e2)) + reg['tx']; py_ = sc_ * (st * (cl @ e1) + ct * (cl @ e2)) + reg['ty']; pz_ = sc_ * (C @ e3 + reg['plane_d'])
    right, down, fwd = A @ R[0], A @ R[1], A @ R[2]
    Mrot = Matrix(((right[0], -down[0], -fwd[0]), (right[1], -down[1], -fwd[1]), (right[2], -down[2], -fwd[2])))
    cd = bpy.data.cameras.new(name); cd.sensor_fit = 'HORIZONTAL'; cd.sensor_width = 36.0; cd.lens = f / Wpx * 36.0
    cd.clip_start = 1.0; cd.clip_end = 6000
    ob = bpy.data.objects.new(name, cd); LC.objects.link(ob)
    ob.matrix_world = Matrix.Translation((px_, py_, pz_)) @ Mrot.to_4x4()
    ob['source_frame'] = clipdir.split('/')[-1] + '/images/' + image_name
    ob['render_resolution'] = [int(Wpx), int(cam_line[3])]
    log('SfM camera', name, 'at (%.1f, %.1f, %.1f) lens %.2f mm' % (px_, py_, pz_, cd.lens))
    return ob
for fname in ('f_022.jpg', 'f_004.jpg'):
    sfm_camera('CAM_sfm_clipA_' + fname[:-4], ROOT + 'photogrammetry_test/clipA', fname)
scene.camera = bpy.data.objects['CAM_overview_high_SW']

# ------------------------------------------------------------------ save + export
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.data.users == 1:
        pass
bpy.ops.file.make_paths_relative() if bpy.data.filepath else None
blend = OUTD + 'campus_model.blend'
bpy.ops.wm.save_as_mainfile(filepath=blend, relative_remap=True, compress=True)
bpy.ops.file.make_paths_relative(); bpy.ops.wm.save_mainfile()
log('saved', blend)

# hide non-exported collections from the view layer for export
def set_excluded(names, val):
    for lc in bpy.context.view_layer.layer_collection.children:
        if lc.name in names: lc.exclude = val
set_excluded(['Lighting and Cameras'], True)

op = bpy.ops.export_scene.gltf
props = {p.identifier for p in op.get_rna_type().properties}
def export(path, draco=True):
    kw = dict(filepath=path, export_format='GLB', use_visible=True, export_extras=True, export_cameras=False, export_lights=False,
              export_apply=True, export_yup=True)
    opt = dict(export_gpu_instances=True, export_draco_mesh_compression_enable=draco, export_draco_mesh_compression_level=6,
               export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
               export_image_format='WEBP', export_image_quality=82, export_texcoords=True, export_normals=True, export_materials='EXPORT')
    for k, v in opt.items():
        if k in props: kw[k] = v
        else: log('export option not available:', k)
    op(**kw)
    log('exported', path, round(os.path.getsize(path) / 1e6, 2), 'MB')
export(OUTD + 'campus_model.glb')
# mobile variant: 2k ground plan, all other textures halved
for im in bpy.data.images:
    if im.size[0] == 0: continue
    if im.name.startswith('site_plan_basecolor'):
        im.filepath = '//textures/site_plan_basecolor_2k.jpg'; im.reload()
    elif im.size[0] >= 512:
        im.scale(max(128, im.size[0] // 2), max(128, im.size[1] // 2))
export(OUTD + 'campus_model_mobile.glb')
set_excluded(['Lighting and Cameras'], False)
log('DONE')

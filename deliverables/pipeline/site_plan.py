"""Site plan generator for the EPNU campus.

Inputs (all evidence files are under analysis/ and data/):
  - data/osm_footprints_local.json  : OSM building footprints + traced fence (local metres)
  - data/osm_roads_local.json       : OSM roads (highway, approach lanes, internal service road)
  - analysis/ortho_clipA.jpg(.json) : SfM ground-plane orthophoto (construction-phase hardscape)
  - analysis/ortho_kmeans_labels.npy: colour classes of that orthophoto
Outputs:
  - deliverables/textures/site_plan_basecolor.jpg  (4096 px, ground texture)
  - deliverables/textures/site_plan_basecolor_2k.jpg (2048 px, mobile)
  - data/site_layout.json  (instances & polylines consumed by the Blender build)
  - analysis/site_plan_overlay.jpg (QA: plan blended with the orthophoto)
Each element carries an 'evidence' tag: verified | sfm-ortho | estimated.
"""
import json, math, sys, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = '/home/user/campus_project/'
fp = json.load(open(ROOT + 'data/osm_footprints_local.json'))
roads = {w['id']: w for w in json.load(open(ROOT + 'data/osm_roads_local.json'))}
BLD = {k[-2:]: b for k, b in fp['buildings'].items() if b['inside_campus']}
FENCE = fp['fence']['poly']

# ---------------------------------------------------------------- plan grid
X0, Y0, SIZE, N = -222.0, -226.0, 440.0, 4096
RES = SIZE / N


def px(x, y):
    return ((x - X0) / RES, (Y0 + SIZE - y) / RES)


def pts_px(pts):
    return [px(*p) for p in pts]


def circle_pts(cx, cy, r, n=128, a0=0, a1=360):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def tex_mean(name):
    a = np.asarray(Image.open(ROOT + f'deliverables/textures/{name}_basecolor.jpg').convert('RGB').resize((64, 64)), np.float32)
    return tuple(int(v) for v in a.mean((0, 1)))


C = {k: tex_mean(k) for k in ['pavers_beige', 'pavers_grey', 'pavers_ring', 'pavers_red', 'pavers_ochre', 'pavers_white', 'lawn', 'desert_sand', 'concrete_light']}
C['plot_sand'] = (196, 160, 112)        # star plots, sampled look of kf_0.5s
C['asphalt'] = (78, 78, 80)
C['star_dark'] = (70, 72, 76)
C['star_white'] = (232, 232, 228)
C['curb_black'] = (35, 35, 35)
C['curb_white'] = (236, 236, 232)
C['line_white'] = (240, 240, 236)
C['pink'] = (214, 160, 162)
C['turf_surround'] = (120, 122, 124)
print('palette', C)

canvas = Image.new('RGB', (N, N), C['desert_sand'])
draw = ImageDraw.Draw(canvas)


def mask_poly(polys, holes=()):
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m)
    for p in polys: d.polygon(pts_px(p), fill=255)
    for h in holes: d.polygon(pts_px(h), fill=0)
    return m


def paint(mask, colour, blur=0.6):
    if blur: mask = mask.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste(Image.new('RGB', (N, N), colour), (0, 0), mask)


def poly(pts, colour):
    draw.polygon(pts_px(pts), fill=colour)


def ring(cx, cy, r0, r1, colour, a0=0, a1=360, n=180):
    outer = circle_pts(cx, cy, r1, n, a0, a1); inner = circle_pts(cx, cy, r0, n, a1, a0)
    poly(outer + inner if (a1 - a0) < 360 else outer, colour)
    if (a1 - a0) >= 360 and r0 > 0: poly(circle_pts(cx, cy, r0, n), None) if False else None


def disc(cx, cy, r, colour):
    poly(circle_pts(cx, cy, r, 180), colour)


def line(pts, colour, width_m):
    draw.line(pts_px(pts), fill=colour, width=max(1, int(round(width_m / RES))), joint='curve')


layout = {'crs': fp['crs'], 'evidence_legend': {
    'verified': 'directly measured from sources (OSM/satellite/video signage)',
    'sfm-ortho': 'traced from the SfM orthophoto of video clip 119.6-123.4 s',
    'estimated': 'inferred from oblique video frames; position/count approximate'},
    'lamps': [], 'trees': [], 'palms': [], 'benches': [], 'gazebos': [], 'shade_sails': [], 'pergolas': [],
    'curbs': [], 'plots': [], 'pitch': None, 'fence': FENCE, 'gate': None, 'parking_stalls': [], 'bollards': []}


def add_lamps_along(pts, spacing, evidence, offset=0.0, closed=False):
    P = list(pts) + ([pts[0]] if closed else [])
    acc = spacing / 2
    for i in range(len(P) - 1):
        (x0, y0), (x1, y1) = P[i], P[i + 1]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6: continue
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        t = acc
        while t < L:
            layout['lamps'].append([round(x0 + ux * t - uy * offset, 2), round(y0 + uy * t + ux * offset, 2), evidence])
            t += spacing
        acc = t - L


def add_curb(pts, evidence, closed=False):
    layout['curbs'].append({'pts': [[round(x, 2), round(y, 2)] for x, y in pts], 'closed': closed, 'evidence': evidence})


# ------------------------------------------------------------- 1. inside fence base
paint(mask_poly([FENCE]), C['pavers_beige'])

# ------------------------------------------------------------- 2. classified plaza (SfM ortho)
meta = json.load(open(ROOT + 'analysis/ortho_clipA.jpg.json'))
km = json.load(open(ROOT + 'analysis/ortho_kmeans.json'))
L = np.load(ROOT + 'analysis/ortho_kmeans_labels.npy')
(ax, ay), (bx, by) = km['roi_px']
roi_x0 = meta['x0'] + ax * meta['res']; roi_y1 = meta['y1'] - ay * meta['res']
# class -> material code
CLS2MAT = {6: 'plot_sand', 2: 'pavers_ring', 8: 'pavers_ring', 7: 'pavers_grey', 1: 'pavers_beige', 4: 'lawn', 9: 'pavers_white', 0: None, 3: None, 5: None}  # 0/3/5 = shadows -> in-painted
MATS = ['plot_sand', 'pavers_ring', 'pavers_grey', 'pavers_beige', 'lawn', 'pavers_white']
code = np.full(L.shape, 255, np.uint8)
for k, m in CLS2MAT.items():
    if m is not None: code[L == k] = MATS.index(m)
PLAZA = [(-22, -88), (118, -88), (118, 38), (187, 38), (187, 176), (-95, 176), (-95, 112), (-22, 112)]
# plaza mask in ROI pixel grid
pm = Image.new('L', (L.shape[1], L.shape[0]), 0)
ImageDraw.Draw(pm).polygon([((x - roi_x0) / meta['res'], (roi_y1 - y) / meta['res']) for x, y in PLAZA], fill=255)
pm = np.asarray(pm) > 0
unknown = (code == 255)
idx = ndimage.distance_transform_edt(unknown, return_distances=False, return_indices=True)
code = code[idx[0], idx[1]]
# remove islands smaller than ~20 m2 (construction debris, objects, shadow fragments)
MIN_AREA = {'plot_sand': 80, 'pavers_ring': 70, 'pavers_grey': 60, 'pavers_beige': 40, 'lawn': 35, 'pavers_white': 60}
for it in range(2):
    for i in range(len(MATS)):
        n_l, lab_i, st_i, _ = cv2.connectedComponentsWithStats((code == i).astype(np.uint8), connectivity=4)
        small = np.isin(lab_i, np.nonzero(st_i[:, 4] < int(MIN_AREA[MATS[i]] / meta['res'] ** 2))[0]) & (code == i)
        code[small] = 255
    unk = code == 255
    if unk.any():
        ii = ndimage.distance_transform_edt(unk, return_distances=False, return_indices=True)
        code = code[ii[0], ii[1]]
# majority smoothing + upsampling to plan grid
gx0, gy1 = roi_x0, roi_y1
W_m, H_m = L.shape[1] * meta['res'], L.shape[0] * meta['res']
up_w, up_h = int(W_m / RES), int(H_m / RES)
probs = []
for i in range(len(MATS)):
    oh = (code == i).astype(np.float32)
    oh = ndimage.gaussian_filter(oh, 4.5)
    probs.append(cv2.resize(oh, (up_w, up_h), interpolation=cv2.INTER_LINEAR))
lab_up = np.argmax(np.stack(probs, 0), 0).astype(np.uint8); del probs
pm_up = cv2.resize(pm.astype(np.uint8), (up_w, up_h), interpolation=cv2.INTER_NEAREST) > 0
ox, oy = int(round((gx0 - X0) / RES)), int(round((Y0 + SIZE - gy1) / RES))
cv_np = np.asarray(canvas).copy()
for i, m in enumerate(MATS):
    sel = (lab_up == i) & pm_up
    ys, xs = np.nonzero(sel)
    cv_np[ys + oy, xs + ox] = C[m]
canvas = Image.fromarray(cv_np); draw = ImageDraw.Draw(canvas); del cv_np, lab_up

# ------------------------------------------------------------- 3. roads, parking (verified: OSM / video)
# North service road along the north fence with a parking row (kf_0.5s shows bays along the fence)
poly([(-205, 176), (201, 176), (201, 189.5), (-205, 189.5)], C['concrete_light'])
for x in np.arange(-200, 196, 2.6):
    line([(x, 184.5), (x, 189.4)], C['line_white'], 0.12)
    layout['parking_stalls'].append([round(x + 1.3, 2), 187.0, 0.0])
add_curb([(-205, 176), (201, 176)], 'verified')
add_lamps_along([(-200, 176.8), (198, 176.8)], 25, 'estimated')
# East road along the east fence
poly([(188.5, -150), (201, -150), (201, 176), (188.5, 176)], C['concrete_light'])
add_lamps_along([(189.3, -140), (189.3, 170)], 25, 'estimated')
# Internal west service road (OSM way 1486158201) incl. the drop-off loop at the Main Building
west = roads[1486158201]['pts']
line(west, C['concrete_light'], 8.0)
for w in (1486158202, 1486158203):   # the two gate lanes, fence -> loop
    line(roads[w]['pts'], C['concrete_light'], 6.0)
add_lamps_along(west, 22, 'estimated', offset=-5.0)
# South road just inside the slanted south fence
south_in = [(-185, -190.5), (175, -176.5), (175, -166.0), (-185, -180.0)]
poly(south_in, C['concrete_light'])
# Parking in front of the NW halls (kf_0.5s: curbed islands, bays)
poly([(-168, 137), (-98, 137), (-98, 174), (-168, 174)], C['pavers_grey'])
for row_y in (139.0, 151.0, 156.0, 169.0):
    for x in np.arange(-165, -101, 2.6):
        y1 = row_y + (5.0 if row_y in (139.0, 156.0) else -5.0)
        line([(x, row_y), (x, y1)], C['line_white'], 0.12)
        layout['parking_stalls'].append([round(x + 1.3, 2), round((row_y + y1) / 2, 2), 0.0])
add_curb([(-166, 151.5), (-100, 151.5), (-100, 155.5), (-166, 155.5)], 'estimated', closed=True)
add_lamps_along([(-166, 153.5), (-100, 153.5)], 16, 'estimated')

# ------------------------------------------------------------- 4. Main Building forecourt (OSM loop + kf_124.38)
b15 = BLD['15']; fx = b15['bbox'][0]          # west facade x
cy15 = -52.0                                   # gate / entrance axis (OSM gate lanes -57.6 / -46.3)
# forecourt between loop (x -185) and facade: two lawns either side of a central entrance walk
poly([(-184.5, cy15 - 26), (fx - 1, cy15 - 26), (fx - 1, cy15 + 26), (-184.5, cy15 + 26)], C['pavers_grey'])
for s in (-1, 1):
    lawn_pts = [(-182, cy15 + s * 5), (fx - 4, cy15 + s * 5), (fx - 4, cy15 + s * 22), (-182, cy15 + s * 22)]
    poly(lawn_pts, C['lawn']); add_curb(lawn_pts, 'estimated', closed=True)
poly([(-184.5, cy15 - 4), (fx, cy15 - 4), (fx, cy15 + 4), (-184.5, cy15 + 4)], C['pavers_red'])
add_lamps_along([(-184, cy15 - 25), (-184, cy15 + 25)], 10, 'estimated')
# red-bordered paved courts north & south of the Main Building (kf_124.38: N one used as parking)
for (y0, y1) in ((-18.0, 40.0), (-135.0, -82.0)):
    poly([(-190, y0), (-100, y0), (-100, y1), (-190, y1)], C['pavers_red'])
    poly([(-188, y0 + 2), (-102, y0 + 2), (-102, y1 - 2), (-188, y1 - 2)], C['pavers_grey'])
for x in np.arange(-186, -106, 2.6):
    line([(x, 33), (x, 38)], C['line_white'], 0.12); layout['parking_stalls'].append([round(x + 1.3, 2), 35.5, 0.0])
    line([(x, -11), (x, -16)], C['line_white'], 0.12); layout['parking_stalls'].append([round(x + 1.3, 2), -13.5, 0.0])
# Gate No. 1 (video: shots 003-006; satellite: portal ~41 m wide on the west fence)
layout['gate'] = {'x': -210.6, 'y': cy15, 'width': 41.0, 'evidence': 'verified (video + satellite); dimensions estimated'}

# ------------------------------------------------------------- 5. building aprons & U-courtyards
for k, b in BLD.items():
    P = np.array(b['poly'])
    hull = cv2.convexHull(P.astype(np.float32)).reshape(-1, 2)
    # 4 m apron: buffer the footprint (approximate via polygon offset of the convex hull for robustness)
    cxb, cyb = P.mean(0)
    apron = [(cxb + (x - cxb) * 1.0 + 4 * np.sign(x - cxb), cyb + (y - cyb) * 1.0 + 4 * np.sign(y - cyb)) for x, y in hull]
    poly(apron, C['pavers_grey'])
# U-courtyard landscape strip (97.4 s: paved court, central planted strip with tree + benches)
for k, (x0, y0, x1, y1) in {'12': (-63.5, -102, -51.5, -70), '11': (2, -126, 20, -95), '08': (70, -128, 88, -95)}.items():
    cxm = (x0 + x1) / 2
    poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], C['pavers_grey'])
    strip = [(cxm - 1.6, y0 + 4), (cxm + 1.6, y0 + 4), (cxm + 1.6, y1 - 4), (cxm - 1.6, y1 - 4)]
    poly(strip, C['lawn']); add_curb(strip, 'estimated', closed=True)
    for yy in np.arange(y0 + 7, y1 - 5, 7):
        layout['trees'].append([round(cxm, 2), round(yy, 2), 'estimated'])
        layout['benches'].append([round(cxm - 2.6, 2), round(yy + 3, 2), 90.0])
        layout['benches'].append([round(cxm + 2.6, 2), round(yy + 3, 2), -90.0])

# building-shadow strips in the ortho (north of OSM 14 and OSM 10) -> paving
poly([(-95, 103.5), (-22, 103.5), (-22, 124.5), (-95, 124.5)], C['pavers_grey'])
poly([(118, 33.5), (187, 33.5), (187, 51.5), (118, 51.5)], C['pavers_grey'])
# ------------------------------------------------------------- 6. clean plaza primitives (SfM ortho traces)
PLOTS = {'plot_nw': (-89.5, 125, -29.5, 174), 'plot_nc': (20.5, 121, 73.5, 180), 'plot_ne': (123, 121, 183, 175), 'plot_e': (123, 52, 186, 101)}
for name, (x0, y0, x1, y1) in PLOTS.items():
    rect = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    poly(rect, C['plot_sand'])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; R = 0.125 * min(x1 - x0, y1 - y0)
    # 8-point star (two squares) dark outline + white inner star (kf_0.5s)
    def star(r, rot=0):
        return [(cx + r * math.cos(math.radians(a + rot)), cy + r * math.sin(math.radians(a + rot))) for a in range(0, 360, 90)]
    def star8(r_out, r_in):
        pts = []
        for i in range(16):
            r = r_out if i % 2 == 0 else r_in
            a = math.radians(i * 22.5 + 11.25)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        return pts
    poly(star8(R, R * 0.62), C['star_dark'])
    poly(star8(R * 0.72, R * 0.45), C['star_white'])
    disc(cx, cy, R * 0.12, C['star_dark'])
    add_curb(rect, 'sfm-ortho', closed=True)
    add_lamps_along(rect, 8.0, 'estimated', offset=-0.8, closed=True)
    layout['plots'].append({'id': name, 'rect': [x0, y0, x1, y1], 'star_r': round(R, 2), 'evidence': 'sfm-ortho (outline), verified star motif (kf_0.5s)'})

# Gazebo circle (centre & radii from ortho; finished state from frame 128.9 s)
GC = (80.6, 21.9)
ring(*GC, 26.0, 34.0, C['pavers_grey'])
disc(*GC, 26.5, C['pavers_ring'])
disc(*GC, 20.5, C['lawn'])
for i, ang in enumerate([105, 177, 249, 321, 33]):
    gx, gy = GC[0] + 12.0 * math.cos(math.radians(ang)), GC[1] + 12.0 * math.sin(math.radians(ang))
    disc(gx, gy, 5.2, C['pavers_ochre'])
    layout['gazebos'].append({'x': round(gx, 2), 'y': round(gy, 2), 'rot': ang, 'size': 3.4, 'evidence': 'sfm-ortho (ring), estimated (exact angles)'})
    for bb in range(3):
        a2 = math.radians(ang + 90 + bb * 120)
        layout['benches'].append([round(gx + 2.0 * math.cos(a2), 2), round(gy + 2.0 * math.sin(a2), 2), round(math.degrees(a2) + 90, 1)])
# stepping-stone paths across the lawn (frame 128.9 s shows zebra stepping paths)
for ang in (69, 141, 213, 285, 357):
    a = math.radians(ang)
    line([(GC[0] + 6 * math.cos(a), GC[1] + 6 * math.sin(a)), (GC[0] + 20.5 * math.cos(a), GC[1] + 20.5 * math.sin(a))], C['pavers_white'], 1.2)
add_curb(circle_pts(*GC, 20.5, 96), 'sfm-ortho', closed=True)
add_curb(circle_pts(*GC, 26.5, 120), 'sfm-ortho', closed=True)
add_lamps_along(circle_pts(*GC, 27.3, 96), 11.0, 'estimated')
for t in range(0, 360, 20):
    a = math.radians(t)
    layout['trees'].append([round(GC[0] + 30.5 * math.cos(a), 2), round(GC[1] + 30.5 * math.sin(a), 2), 'estimated'])

# Second circle (13.1, 72.5): purple ring with an ochre pad and one gazebo
C2 = (13.1, 72.5)
disc(*C2, 21.5, C['pavers_ring']); disc(*C2, 11.3, C['pavers_ochre'])
add_curb(circle_pts(*C2, 21.5, 100), 'sfm-ortho', closed=True); add_curb(circle_pts(*C2, 11.3, 64), 'sfm-ortho', closed=True)
layout['gazebos'].append({'x': C2[0], 'y': C2[1], 'rot': 0, 'size': 4.2, 'evidence': 'estimated (foundation ring visible in SfM ortho)'})
add_lamps_along(circle_pts(*C2, 22.2, 72), 11.0, 'estimated')
# Small north circle (-8, 167.3)
C3 = (-8.0, 167.3)
disc(*C3, 15.7, C['pavers_ring']); disc(*C3, 7.5, C['pavers_ochre']); disc(*C3, 1.5, C['star_dark'])
add_curb(circle_pts(*C3, 15.7, 80), 'sfm-ortho', closed=True)
# Semicircular plaza with red ring (115.7, 147)
C4 = (115.7, 147.0)
ring(*C4, 19.5, 27.7, C['pavers_red'], 90, 270)
disc(*C4, 19.5, C['pavers_ochre']); disc(*C4, 14.0, C['pavers_grey']); disc(*C4, 1.6, C['lawn'])
poly(PLOTS_rect := [(123, 121), (183, 121), (183, 175), (123, 175)], C['plot_sand'])  # plot overlaps the circle's east half
add_curb(circle_pts(*C4, 27.7, 60, 90, 270), 'sfm-ortho')
# Pink lens circle (93.8, -34.4)
C5 = (93.8, -34.4)
disc(*C5, 19.0, C['pavers_ochre']); disc(*C5, 14.0, C['pink']); disc(*C5, 9.0, C['pavers_beige'])
lens = [(C5[0] + 3.2 * math.sin(math.radians(a)), C5[1] + 7.5 * math.cos(math.radians(a))) for a in range(0, 360, 10)]
poly(lens, C['lawn']); add_curb(lens, 'sfm-ortho', closed=True); add_curb(circle_pts(*C5, 19.0, 90), 'sfm-ortho', closed=True)
# Round planters (ortho)
for (x, y, r) in [(-10.3, 38.7, 5.6), (13.1, 2.2, 4.5), (8.4, -26.9, 5.0), (11.3, 35.9, 4.5), (8.4, 18.1, 4.0)]:
    disc(x, y, r, C['lawn']); add_curb(circle_pts(x, y, r, 48), 'sfm-ortho', closed=True)
    layout['trees'].append([x, y, 'estimated'])
# Pitch (ortho): turf + grey surround + 4 m mesh fence
PITCH = (39.4, -64.4, 62.2, -20.3)
poly([(PITCH[0] - 5, PITCH[1] - 5), (PITCH[2] + 5, PITCH[1] - 5), (PITCH[2] + 5, PITCH[3] + 5), (PITCH[0] - 5, PITCH[3] + 5)], C['turf_surround'])
layout['pitch'] = {'rect': list(PITCH), 'fence_h': 4.0, 'evidence': 'sfm-ortho (outline), verified (fenced turf pitch, frames 77.01/33.7 s)'}
# Curved timber pergola along the west edge of the white S-path (ortho)
perg = [(85.0, 92.0), (90.0, 101.0), (96.5, 110.0), (103.0, 118.0)]
layout['pergolas'].append({'pts': perg, 'width': 4.0, 'height': 3.0, 'evidence': 'sfm-ortho (alignment), verified (timber pergola, frame 128.9 s)'})
# Tensile shade sails with benches (frame 128.9 s); positions estimated on paved areas east of the gazebo circle
for (x, y, rot) in [(116, 12, 20), (116, -2, 0), (40, 40, 45)]:
    layout['shade_sails'].append({'x': x, 'y': y, 'rot': rot, 'evidence': 'estimated'})
    layout['benches'].append([x - 1.5, y, rot]); layout['benches'].append([x + 1.5, y, rot])

# ------------------------------------------------------------- 7. outside the fence (OSM roads; satellite)
for w in (1240566528, 1272565460):
    line(roads[w]['pts'], C['asphalt'], 10.5)
line(roads[1275731931]['pts'], C['asphalt'], 7.0)
for w in (1486158204, 1486158205):
    line(roads[w]['pts'], C['asphalt'], 7.0)
poly([(-300, cy15 - 3.5), (-215, cy15 - 3.5), (-215, cy15 + 3.5), (-300, cy15 + 3.5)], C['lawn'])   # planted median (5.43 s: palms)
for x in np.arange(-296, -216, 8):
    layout['palms'].append([round(float(x), 2), cy15, 'estimated'])
# paved forecourt/parking strip between approach road and the fence (satellite 2022)
poly([(-260, -110), (-213, -110), (-213, -63), (-260, -63)], C['pavers_grey'])
poly([(-260, -41), (-213, -41), (-213, 10), (-260, 10)], C['pavers_grey'])

# ------------------------------------------------------------- 8. fence curb line + texture finishing
line(FENCE + [FENCE[0]], (205, 196, 180), 0.7)
noise = np.asarray(Image.fromarray((np.random.default_rng(3).random((256, 256)) * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC), np.float32) / 255
fine = np.asarray(Image.fromarray((np.random.default_rng(4).random((1024, 1024)) * 255).astype(np.uint8)).resize((N, N), Image.BILINEAR), np.float32) / 255
arr = np.asarray(canvas, np.float32)
arr *= (0.95 + 0.08 * noise[..., None]) * (0.97 + 0.06 * fine[..., None])
canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)); del arr, noise, fine
canvas = canvas.filter(ImageFilter.GaussianBlur(0.5))
canvas.save(ROOT + 'deliverables/textures/site_plan_basecolor.jpg', quality=88)
canvas.resize((2048, 2048), Image.LANCZOS).save(ROOT + 'deliverables/textures/site_plan_basecolor_2k.jpg', quality=88)
layout['plan_texture'] = {'x0': X0, 'y0': Y0, 'size': SIZE, 'px': N}
json.dump(layout, open(ROOT + 'data/site_layout.json', 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
print('lamps', len(layout['lamps']), 'trees', len(layout['trees']), 'palms', len(layout['palms']), 'benches', len(layout['benches']),
      'gazebos', len(layout['gazebos']), 'curbs', len(layout['curbs']), 'stalls', len(layout['parking_stalls']))

# ------------------------------------------------------------- 9. QA overlay with the orthophoto
o = cv2.imread(ROOT + 'analysis/ortho_clipA.jpg')
plan = cv2.cvtColor(np.asarray(canvas.resize((int(SIZE / meta['res']), int(SIZE / meta['res'])), Image.LANCZOS)), cv2.COLOR_RGB2BGR)
# place plan into ortho frame
ox2, oy2 = int(round((X0 - meta['x0']) / meta['res'])), int(round((meta['y1'] - (Y0 + SIZE)) / meta['res']))
H, W = o.shape[:2]
big = np.zeros_like(o)
sx0, sy0 = max(0, -ox2), max(0, -oy2)
dx0, dy0 = max(0, ox2), max(0, oy2)
w = min(plan.shape[1] - sx0, W - dx0); h = min(plan.shape[0] - sy0, H - dy0)
big[dy0:dy0 + h, dx0:dx0 + w] = plan[sy0:sy0 + h, sx0:sx0 + w]
sbs = np.concatenate([cv2.addWeighted(o, 0.5, big, 0.5, 0), big], 1)
cv2.imwrite(ROOT + 'analysis/site_plan_overlay.jpg', cv2.resize(sbs, None, fx=0.6, fy=0.6), [cv2.IMWRITE_JPEG_QUALITY, 85])
print('saved')

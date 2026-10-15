"""Register a COLMAP sparse model (clip A, construction-phase orbit) to the OSM
footprint plan with a 2D similarity + ground-plane levelling, then export:
  - photogrammetry_test/clipA/registration.json  (transform COLMAP -> local metres)
  - per-building height statistics from roof points
"""
import sys, json, numpy as np
sys.path.insert(0, '/home/user/campus_project/pipeline')
from colmap_io import *
from matplotlib.path import Path
from scipy.optimize import minimize
from scipy.ndimage import distance_transform_edt
from PIL import Image, ImageDraw

ROOT = '/home/user/campus_project/'
D = ROOT + 'photogrammetry_test/clipA/sparse_txt/'
imgs = read_images(D + 'images.txt'); X, C, E, T = read_points(D + 'points3D.txt')
g = np.load(ROOT + 'photogrammetry_test/clipA/ground_frame.npz'); n, d = g['n'], g['d']
c0 = X[np.abs(X @ n + d) < 0.1].mean(0); c0 = c0 - (c0 @ n + d) * n      # exactly on plane
e3 = n; tmp = np.array([1, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1, 0])
e1 = np.cross(tmp, e3); e1 /= np.linalg.norm(e1); e2 = np.cross(e3, e1)
U = (X - c0) @ e1; V = (X - c0) @ e2; Hh = X @ n + d
roof = (Hh > 0.55) & (Hh < 1.15)

fp = json.load(open(ROOT + 'data/osm_footprints_local.json'))
blds = {k: b for k, b in fp['buildings'].items() if b['inside_campus']}
# signed-distance field of footprints (1 m grid) for smooth optimisation
RES = 0.5; W = 1024; OX, OY = -256, -256
img = Image.new('L', (W, W), 0); dr = ImageDraw.Draw(img)
for b in blds.values():
    dr.polygon([((x - OX) / RES, (W - 1) - (y - OY) / RES) for x, y in b['poly']], fill=255)
M = np.asarray(img) > 0
sdf = (distance_transform_edt(~M) - distance_transform_edt(M)) * RES   # >0 outside

def sample_sdf(x, y):
    ix = np.clip((x - OX) / RES, 0, W - 1.001); iy = np.clip((W - 1) - (y - OY) / RES, 0, W - 1.001)
    x0 = ix.astype(int); y0 = iy.astype(int); fx = ix - x0; fy = iy - y0
    return (sdf[y0, x0] * (1 - fx) * (1 - fy) + sdf[y0, x0 + 1] * fx * (1 - fy) +
            sdf[y0 + 1, x0] * (1 - fx) * fy + sdf[y0 + 1, x0 + 1] * fx * fy)

coarse = json.load(open(ROOT + 'photogrammetry_test/clipA/coarse_reg.json'))
pu, pv = U[roof], V[roof]

def transform(params, u, v):
    s, th, tx, ty = params
    ct, st = np.cos(th), np.sin(th)
    return s * (ct * u - st * v) + tx, s * (st * u + ct * v) + ty

# initial translation from coarse FFT result
s0, th0 = coarse['scale'], np.radians(coarse['theta'])
x, y = transform((s0, th0, 0, 0), pu, pv)
mx, my = x.mean(), y.mean()
r, ccol = coarse['shift']
# FFT shift (row, col) is the displacement of B relative to A in raster pixels (1 m)
sx = ccol if ccol < 256 else ccol - 512
sy = r if r < 256 else r - 512
best = None
for tx0 in [-mx + sx, -mx - sx]:
    for ty0 in [-my - sy, -my + sy]:
        p0 = np.array([s0, th0, tx0, ty0])
        def cost(p):
            xx, yy = transform(p, pu, pv)
            dd = sample_sdf(xx, yy)
            return np.mean(np.log1p(np.maximum(dd, 0) ** 2 / 4.0))
        resx = minimize(cost, p0, method='Nelder-Mead', options=dict(maxiter=4000, xatol=1e-4, fatol=1e-7))
        if best is None or resx.fun < best.fun: best = resx
p = best.x
xx, yy = transform(p, pu, pv)
inside = sample_sdf(xx, yy) <= 0.0
near = sample_sdf(xx, yy) <= 2.0
print('refined: scale %.3f m/unit, theta %.2f deg, t=(%.1f, %.1f); roof pts inside footprints %.1f%%, within 2 m %.1f%%'
      % (p[0], np.degrees(p[1]), p[2], p[3], 100 * inside.mean(), 100 * near.mean()))
reg = dict(scale=float(p[0]), theta=float(p[1]), tx=float(p[2]), ty=float(p[3]),
           c0=c0.tolist(), e1=e1.tolist(), e2=e2.tolist(), e3=e3.tolist(), plane_d=float(d),
           note='local = s*R(theta)*[(X-c0).e1,(X-c0).e2] + t ; z_local = s*((X).n + d)')
json.dump(reg, open(ROOT + 'photogrammetry_test/clipA/registration.json', 'w'), indent=1)

# ---- per building heights ----
s = p[0]
XA, YA = transform(p, U, V); ZA = Hh * s
out = {}
for k, b in blds.items():
    path = Path(np.array(b['poly']))
    # shrink test: points inside footprint and > 4 m above ground
    m = path.contains_points(np.c_[XA, YA]) & (ZA > 4)
    if m.sum() < 15:
        out[k] = dict(n=int(m.sum())); continue
    z = ZA[m]
    out[k] = dict(n=int(m.sum()), p50=round(float(np.percentile(z, 50)), 2), p75=round(float(np.percentile(z, 75)), 2),
                  p90=round(float(np.percentile(z, 90)), 2), p98=round(float(np.percentile(z, 98)), 2))
    print(k[-2:], out[k])
# ground noise
gm = np.abs(ZA) < 3
print('ground residual std (m): %.2f' % ZA[gm].std())
cams = np.array([im['center'] for im in imgs.values()])
cx, cy = transform(p, (cams - c0) @ e1, (cams - c0) @ e2); cz = (cams @ n + d) * s
print('drone positions (local m): x %.0f..%.0f  y %.0f..%.0f  altitude %.0f..%.0f m' % (cx.min(), cx.max(), cy.min(), cy.max(), cz.min(), cz.max()))
json.dump(out, open(ROOT + 'photogrammetry_test/clipA/building_heights.json', 'w'), indent=1)
np.savez(ROOT + 'photogrammetry_test/clipA/points_local.npz', x=XA, y=YA, z=ZA, rgb=C, err=E, trk=T)

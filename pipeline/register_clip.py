"""Generic: level a COLMAP sparse model with a RANSAC ground plane and register it
to the OSM footprints (2D similarity; FFT coarse search + SDF refinement).
Usage: register_clip.py <clipdir> [roof_lo roof_hi]  (roof band in model units relative to the roof peak search)"""
import sys, json, numpy as np
sys.path.insert(0, '/home/user/campus_project/pipeline')
from colmap_io import *
from scipy.optimize import minimize
from scipy.ndimage import distance_transform_edt
from matplotlib.path import Path
from PIL import Image, ImageDraw
ROOT = '/home/user/campus_project/'
clip = sys.argv[1]
D = clip + '/sparse_txt/'
imgs = read_images(D + 'images.txt'); X, C, E, T = read_points(D + 'points3D.txt')
keep = (E < 2.0) & (T >= 3); X, C, E, T = X[keep], C[keep], E[keep], T[keep]
centers = np.array([im['center'] for im in imgs.values()])
rng = np.random.default_rng(1)
lo, hi = np.percentile(X, 5, axis=0), np.percentile(X, 95, axis=0); ext = np.linalg.norm(hi - lo)
thr = 0.004 * ext; best = (0, None)
for it in range(4000):
    s3 = X[rng.choice(len(X), 3, replace=False)]
    nrm = np.cross(s3[1] - s3[0], s3[2] - s3[0]); nn = np.linalg.norm(nrm)
    if nn < 1e-12: continue
    nrm /= nn; dd = -nrm @ s3[0]
    cnt = int((np.abs(X @ nrm + dd) < thr).sum())
    if cnt > best[0]: best = (cnt, (nrm, dd))
n, d = best[1]
inl = np.abs(X @ n + d) < thr
P = X[inl]; c = P.mean(0); _, _, vt = np.linalg.svd(P - c, full_matrices=False); n = vt[2]; d = -n @ c
if (centers @ n + d).mean() < 0: n, d = -n, -d
H = X @ n + d
camh = np.median(centers @ n + d)
print('points', len(X), 'ground inliers', int(inl.sum()), 'median camera height (units) %.3f' % camh)
hist, edges = np.histogram(H[(H > 0.02 * camh) & (H < 0.4 * camh)], bins=40)
pk = edges[np.argmax(hist)]
print('roof peak at %.4f units (camera/roof ratio %.2f)' % (pk, camh / max(pk, 1e-9)))
roof = (H > 0.6 * pk) & (H < 1.35 * pk)
c0 = c - (c @ n + d) * n
e3 = n; tmp = np.array([1, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1, 0])
e1 = np.cross(tmp, e3); e1 /= np.linalg.norm(e1); e2 = np.cross(e3, e1)
U = (X - c0) @ e1; V = (X - c0) @ e2
fp = json.load(open(ROOT + 'data/osm_footprints_local.json'))
blds = {k: b for k, b in fp['buildings'].items() if b['inside_campus']}
RES = 1.0; W = 512; OX, OY = -256, -256
img = Image.new('L', (W, W), 0); dr = ImageDraw.Draw(img)
for b in blds.values(): dr.polygon([((x - OX) / RES, (W - 1) - (y - OY) / RES) for x, y in b['poly']], fill=255)
A = np.asarray(img, np.float32) / 255; FA = np.fft.rfft2(A)
pu, pv = U[roof], V[roof]
# expected scale: roof ~18.7 m
s_guess = 18.7 / pk
best = (-1, None)
for s in np.linspace(0.7 * s_guess, 1.3 * s_guess, 25):
    for th in np.radians(np.arange(0, 360, 2)):
        ct, st = np.cos(th), np.sin(th)
        x = s * (ct * pu - st * pv); y = s * (st * pu + ct * pv); mx, my = x.mean(), y.mean(); x -= mx; y -= my
        B = np.zeros((W, W), np.float32)
        ix = np.clip(((x - OX) / RES).astype(int), 0, W - 1); iy = np.clip(((W - 1) - (y - OY) / RES).astype(int), 0, W - 1)
        np.add.at(B, (iy, ix), 1.0)
        corr = np.fft.irfft2(FA * np.conj(np.fft.rfft2(B)), s=(W, W)); k = np.argmax(corr); sc = corr.flat[k] / len(pu)
        if sc > best[0]: best = (sc, (s, th, np.unravel_index(k, corr.shape), mx, my))
sc, (s0, th0, (r, cc), mx, my) = best
print('coarse score %.3f scale %.2f theta %.1f' % (sc, s0, np.degrees(th0)))
RES2 = 0.5; W2 = 1024
img2 = Image.new('L', (W2, W2), 0); dr2 = ImageDraw.Draw(img2)
for b in blds.values(): dr2.polygon([((x + 256) / RES2, (W2 - 1) - (y + 256) / RES2) for x, y in b['poly']], fill=255)
M = np.asarray(img2) > 0
sdf = (distance_transform_edt(~M) - distance_transform_edt(M)) * RES2
def sample_sdf(x, y):
    ix = np.clip((x + 256) / RES2, 0, W2 - 1.001); iy = np.clip((W2 - 1) - (y + 256) / RES2, 0, W2 - 1.001)
    x0 = ix.astype(int); y0 = iy.astype(int); fx = ix - x0; fy = iy - y0
    return (sdf[y0, x0] * (1 - fx) * (1 - fy) + sdf[y0, x0 + 1] * fx * (1 - fy) + sdf[y0 + 1, x0] * (1 - fx) * fy + sdf[y0 + 1, x0 + 1] * fx * fy)
def tf(p, u, v):
    s, th, tx, ty = p; ct, st = np.cos(th), np.sin(th)
    return s * (ct * u - st * v) + tx, s * (st * u + ct * v) + ty
sx = cc if cc < 256 else cc - 512; sy = r if r < 256 else r - 512
bestr = None
for tx0 in [-mx + sx, -mx - sx]:
    for ty0 in [-my - sy, -my + sy]:
        p0 = np.array([s0, th0, tx0, ty0])
        cost = lambda p: np.mean(np.log1p(np.maximum(sample_sdf(*tf(p, pu, pv)), 0) ** 2 / 4.0))
        rr = minimize(cost, p0, method='Nelder-Mead', options=dict(maxiter=4000, xatol=1e-4, fatol=1e-7))
        if bestr is None or rr.fun < bestr.fun: bestr = rr
p = bestr.x
dd = sample_sdf(*tf(p, pu, pv))
print('refined scale %.3f theta %.2f t=(%.1f,%.1f) inside %.1f%% within2m %.1f%%' % (p[0], np.degrees(p[1]), p[2], p[3], 100 * (dd <= 0).mean(), 100 * (dd <= 2).mean()))
reg = dict(scale=float(p[0]), theta=float(p[1]), tx=float(p[2]), ty=float(p[3]), c0=c0.tolist(), e1=e1.tolist(), e2=e2.tolist(), e3=e3.tolist(), plane_d=float(d))
json.dump(reg, open(clip + '/registration.json', 'w'), indent=1)
XA, YA = tf(p, U, V); ZA = H * p[0]
for k, b in blds.items():
    m = Path(np.array(b['poly'])).contains_points(np.c_[XA, YA]) & (ZA > 4)
    if m.sum() >= 15: print(k[-2:], 'n', int(m.sum()), 'p50 %.1f p75 %.1f p90 %.1f' % tuple(np.percentile(ZA[m], [50, 75, 90])))
cx, cy = tf(p, (centers - c0) @ e1, (centers - c0) @ e2)
print('camera xy range', np.round([cx.min(), cx.max(), cy.min(), cy.max()]), 'alt %.0f..%.0f m' % ((centers @ n + d).min() * p[0], (centers @ n + d).max() * p[0]))

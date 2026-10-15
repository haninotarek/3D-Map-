"""Ortho of a levelled COLMAP model in its own ground frame (u,v) at a provisional scale.
Writes <clip>/level.json and <clip>/ortho_self.jpg"""
import sys, json, numpy as np, cv2
sys.path.insert(0, '/home/user/campus_project/pipeline')
from colmap_io import *
clip = sys.argv[1]; S = float(sys.argv[2]) if len(sys.argv) > 2 else 40.0   # provisional m/unit
D = clip + '/sparse_txt/'
cams = read_cameras(D + 'cameras.txt'); imgs = read_images(D + 'images.txt'); X, C, E, T = read_points(D + 'points3D.txt')
keep = (E < 2) & (T >= 3); X = X[keep]
cent = np.array([im['center'] for im in imgs.values()])
rng = np.random.default_rng(1); lo, hi = np.percentile(X, 5, 0), np.percentile(X, 95, 0); ext = np.linalg.norm(hi - lo); thr = 0.004 * ext
best = (0, None)
for it in range(4000):
    s = X[rng.choice(len(X), 3, replace=False)]; n = np.cross(s[1] - s[0], s[2] - s[0]); nn = np.linalg.norm(n)
    if nn < 1e-12: continue
    n /= nn; d = -n @ s[0]; c = int((np.abs(X @ n + d) < thr).sum())
    if c > best[0]: best = (c, (n, d))
n, d = best[1]; inl = np.abs(X @ n + d) < thr; P = X[inl]; c = P.mean(0); _, _, vt = np.linalg.svd(P - c, full_matrices=False); n = vt[2]; d = -n @ c
if (cent @ n + d).mean() < 0: n, d = -n, -d
c0 = c - (c @ n + d) * n
e3 = n; tmp = np.array([1, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1, 0])
e1 = np.cross(tmp, e3); e1 /= np.linalg.norm(e1); e2 = np.cross(e3, e1)
G = X[inl]; gu = (G - c0) @ e1 * S; gv = (G - c0) @ e2 * S
x0, x1 = np.percentile(gu, 1) - 20, np.percentile(gu, 99) + 20; y0, y1 = np.percentile(gv, 1) - 20, np.percentile(gv, 99) + 20
RES = 0.3; Wd, Hd = int((x1 - x0) / RES), int((y1 - y0) / RES)
print('self-frame extent (provisional m):', round(x1 - x0), 'x', round(y1 - y0), '->', Wd, Hd)
A = np.array([[RES, 0, x0 + 0.5 * RES], [0, -RES, y1 - 0.5 * RES], [0, 0, 1]])
B = np.diag([1 / S, 1 / S, 1])
M = np.zeros((4, 3)); M[:3, 0] = e1; M[:3, 1] = e2; M[:3, 2] = c0; M[3, 2] = 1
L = M @ B @ A
acc = np.zeros((Hd, Wd, 3)); w = np.zeros((Hd, Wd)); samples = []
for iid, im in sorted(imgs.items()):
    cam = cams[im['cam']]; f, cx, cy = cam['params'][:3]
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1]]); Pm = K @ np.c_[im['R'], im['t']]
    Hm = Pm @ L
    src = cv2.imread(clip + '/images/' + im['name'])
    wp = cv2.warpPerspective(src, Hm, (Wd, Hd), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR)
    va = cv2.warpPerspective(np.full(src.shape[:2], 255, np.uint8), Hm, (Wd, Hd), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_NEAREST) > 0
    # reject samples far from the camera footprint centre (grazing) using camera height
    acc += wp * va[..., None]; w += va; samples.append((wp, va))
mean = acc / np.maximum(w, 1)[..., None]
bestd = np.full((Hd, Wd), 1e18); out = np.zeros((Hd, Wd, 3), np.uint8)
for wp, va in samples:
    dd = ((wp.astype(float) - mean) ** 2).sum(-1); dd[~va] = 1e18; m = dd < bestd; bestd[m] = dd[m]; out[m] = wp[m]
cv2.imwrite(clip + '/ortho_self.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 92])
json.dump(dict(S=S, x0=float(x0), x1=float(x1), y0=float(y0), y1=float(y1), res=RES, c0=c0.tolist(), e1=e1.tolist(), e2=e2.tolist(), e3=e3.tolist(), d=float(d)), open(clip + '/level.json', 'w'), indent=1)
print('done')

"""Ground-plane orthorectification of registered COLMAP frames into the local
metric frame. Usage: orthophoto.py <clipdir> <out.jpg> [res_m]
Ground points (z=0) only are geometrically correct; buildings are smeared."""
import sys, json, numpy as np, cv2
sys.path.insert(0, '/home/user/campus_project/pipeline')
from colmap_io import *
clip = sys.argv[1]; out = sys.argv[2]; RES = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
reg = json.load(open(clip + '/registration.json'))
cams = read_cameras(clip + '/sparse_txt/cameras.txt'); imgs = read_images(clip + '/sparse_txt/images.txt')
s, th, tx, ty = reg['scale'], reg['theta'], reg['tx'], reg['ty']
c0, e1, e2, e3 = [np.array(reg[k]) for k in ('c0', 'e1', 'e2', 'e3')]
X0, X1, Y0, Y1 = -218, 214, -210, 198
Wd, Hd = int((X1 - X0) / RES), int((Y1 - Y0) / RES)
# local (x,y,0) -> colmap X :  [u,v] = R(-th)*([x,y]-t)/s ; X = c0 + u e1 + v e2
ct, st = np.cos(th), np.sin(th)
def local2colmap_h():
    # returns 4x3 matrix mapping homogeneous ortho pixel (i,j,1) to homogeneous colmap point
    # pixel -> local: x = X0 + (i+0.5)*RES ; y = Y1 - (j+0.5)*RES
    A = np.array([[RES, 0, X0 + 0.5 * RES], [0, -RES, Y1 - 0.5 * RES], [0, 0, 1]])
    B = np.array([[ct / s, st / s, 0], [-st / s, ct / s, 0], [0, 0, 1]]) @ np.array([[1, 0, -tx], [0, 1, -ty], [0, 0, 1]])
    UV = B @ A                                   # pixel -> (u,v,1)
    M = np.zeros((4, 3)); M[:3, 0] = e1; M[:3, 1] = e2; M[:3, 2] = c0; M[3, 2] = 1
    return M @ UV
L = local2colmap_h()
stack_sum = np.zeros((Hd, Wd, 3), np.float64); stack_w = np.zeros((Hd, Wd), np.float64)
samples = []
for iid, im in sorted(imgs.items()):
    cam = cams[im['cam']]; f, cx, cy = cam['params'][:3]
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1]])
    P = K @ np.c_[im['R'], im['t']]
    Hm = P @ L                                    # ortho pixel -> image pixel
    src = cv2.imread(clip + '/images/' + im['name'])
    warped = cv2.warpPerspective(src, Hm, (Wd, Hd), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    valid = cv2.warpPerspective(np.full(src.shape[:2], 255, np.uint8), Hm, (Wd, Hd), flags=cv2.WARP_INVERSE_MAP | cv2.INTER_NEAREST) > 0
    # weight: prefer views looking more steeply down (camera height / distance)
    w = valid.astype(np.float64)
    stack_sum += warped * w[..., None]; stack_w += w
    samples.append((iid, warped, valid))
mean = stack_sum / np.maximum(stack_w, 1)[..., None]
# robust: per pixel choose the sample closest to the mean (approx. medoid) to reduce ghosting
best = np.full((Hd, Wd), 1e18); outimg = np.zeros((Hd, Wd, 3), np.uint8)
for iid, wimg, valid in samples:
    dd = ((wimg.astype(np.float64) - mean) ** 2).sum(-1); dd[~valid] = 1e18
    m = dd < best; best[m] = dd[m]; outimg[m] = wimg[m]
cv2.imwrite(out, outimg, [cv2.IMWRITE_JPEG_QUALITY, 92])
json.dump(dict(x0=X0, x1=X1, y0=Y0, y1=Y1, res=RES, w=Wd, h=Hd), open(out + '.json', 'w'))
print('ortho', out, Wd, Hd, 'coverage %.1f%%' % (100 * (stack_w > 0).mean()))

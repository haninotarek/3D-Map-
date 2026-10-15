"""Minimal COLMAP TXT model reader."""
import numpy as np

def qvec2rotmat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y],
        [2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x],
        [2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y]])

def read_cameras(path):
    cams = {}
    for l in open(path):
        if l.startswith('#') or not l.strip(): continue
        p = l.split()
        cams[int(p[0])] = dict(model=p[1], w=int(p[2]), h=int(p[3]), params=[float(v) for v in p[4:]])
    return cams

def read_images(path):
    imgs = {}
    lines = [l for l in open(path) if not l.startswith('#')]
    for i in range(0, len(lines), 2):
        p = lines[i].split()
        if not p: continue
        iid = int(p[0]); q = np.array([float(v) for v in p[1:5]]); t = np.array([float(v) for v in p[5:8]])
        R = qvec2rotmat(q)
        imgs[iid] = dict(name=p[9], R=R, t=t, center=-R.T @ t, cam=int(p[8]))
    return imgs

def read_points(path):
    xyz, rgb, err, trk = [], [], [], []
    for l in open(path):
        if l.startswith('#') or not l.strip(): continue
        p = l.split()
        xyz.append([float(v) for v in p[1:4]]); rgb.append([int(v) for v in p[4:7]])
        err.append(float(p[7])); trk.append((len(p) - 8) // 2)
    return np.array(xyz), np.array(rgb), np.array(err), np.array(trk)

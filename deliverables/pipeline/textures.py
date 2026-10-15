"""Texture factory: tileable PBR texture sets for the EPNU campus model.

Colours are taken from data/palette.json, which was sampled from front-lit video frames
(see 'src' in the palette). Fine detail is procedural (fBm noise, joint patterns), because
the 1080p H.264 source frames are too compressed to give clean albedo at material scale.
Exception: desert sand is a real photo crop (frame 113.3 s), lighting-flattened and made
seamless.

Outputs go to deliverables/textures/<name>_{basecolor,normal,roughness}.{jpg,png}
"""
import json, os, sys, numpy as np
from PIL import Image, ImageFilter

ROOT = '/home/user/campus_project/'
OUT = ROOT + 'deliverables/textures/'
os.makedirs(OUT, exist_ok=True)
PAL = json.load(open(ROOT + 'data/palette.json'))
rng = np.random.default_rng(42)


def col(name):
    return np.array(PAL[name]['rgb'], np.float32) / 255.0


# ----------------------------------------------------------------- noise utils
def tile_noise(n, cells, seed):
    """Seamless value noise (bicubic interpolation of a periodic lattice)."""
    r = np.random.default_rng(seed)
    lat = r.random((cells, cells)).astype(np.float32)
    img = Image.fromarray((lat * 255).astype(np.uint8))
    # periodic upscale: tile 3x3, resize, crop centre
    big = Image.new('L', (cells * 3, cells * 3))
    for i in range(3):
        for j in range(3):
            big.paste(img, (i * cells, j * cells))
    big = big.resize((n * 3, n * 3), Image.BICUBIC)
    return np.asarray(big.crop((n, n, 2 * n, 2 * n)), np.float32) / 255.0


def fbm(n, base_cells=4, octaves=6, seed=0, gain=0.5):
    acc = np.zeros((n, n), np.float32); amp = 1.0; tot = 0
    c = base_cells
    for o in range(octaves):
        if c > n: break
        acc += amp * tile_noise(n, c, seed + o * 17); tot += amp
        amp *= gain; c *= 2
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-9)


def height_to_normal(h, strength=2.0):
    """Tileable normal map (OpenGL convention, +Y up as glTF expects)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx = -dx * strength; ny = dy * strength; nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def save_set(name, base, height=None, rough=None, nstrength=2.0, size=None):
    b = np.clip(base, 0, 1)
    im = Image.fromarray((b * 255).astype(np.uint8))
    if size: im = im.resize((size, size), Image.LANCZOS)
    im.save(OUT + f'{name}_basecolor.jpg', quality=90)
    if height is not None:
        nm = Image.fromarray(height_to_normal(height, nstrength))
        if size: nm = nm.resize((size, size), Image.LANCZOS)
        nm.save(OUT + f'{name}_normal.png', optimize=True)
    if rough is not None:
        r = Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8))
        if size: r = r.resize((size, size), Image.LANCZOS)
        r.save(OUT + f'{name}_roughness.jpg', quality=90)
    print('texture', name)


def vary(colr, amount, field):
    """Multiply colour by a luminance variation field (mean 1)."""
    return colr[None, None, :] * (1.0 + amount * (field[..., None] - 0.5) * 2)


# ------------------------------------------------------------------ materials
N = 1024


def plaster():
    # Smooth cream render (2 m x 2 m tile). Slight trowel mottling + fine grain.
    m = fbm(N, 3, 6, 1); g = fbm(N, 64, 3, 2)
    base = vary(col('plaster_cream'), 0.035, m) * (1 + 0.025 * (g[..., None] - 0.5))
    h = 0.6 * g + 0.4 * m
    save_set('plaster_cream', base, h, 0.82 + 0.08 * g, nstrength=1.2)


def sandstone_ashlar():
    # Sandstone cladding. Ashlar courses 0.30 m high, blocks 0.60 m long, stretcher bond;
    # 1.2 m x 1.2 m tile = 4 courses x 2 blocks. Joints 6 mm, slightly darker than the stone.
    tile_m = 1.2; px = N / tile_m
    y = np.arange(N)[:, None] / px; x = np.arange(N)[None, :] / px
    course = np.floor(y / 0.30).astype(int)
    xo = x + (course % 2) * 0.30
    bx = np.floor(xo / 0.60).astype(int) % 2
    jx = np.minimum((xo % 0.60), 0.60 - (xo % 0.60)); jy = np.minimum((y % 0.30), 0.30 - (y % 0.30))
    joint = np.clip(1 - np.minimum(jx, jy) / 0.006, 0, 1)
    blockid = (course * 7 + bx * 13) % 23
    bvar = (np.sin(blockid * 12.9898) * 43758.5453) % 1.0
    grain = fbm(N, 16, 5, 3); vein = fbm(N, 6, 4, 4)
    base = col('sandstone')[None, None, :] * (0.94 + 0.10 * bvar[..., None]) * (0.95 + 0.10 * grain[..., None])
    base = base * (1 - 0.22 * joint[..., None])
    h = 0.55 * (1 - joint) + 0.25 * grain + 0.2 * vein
    save_set('sandstone_ashlar', base, h, 0.78 + 0.1 * grain + 0.1 * joint, nstrength=3.0)


def pavers(name, colour, unit=(0.20, 0.10), tile_m=1.6, var=0.07, joint_col=(0.62, 0.58, 0.52), herringbone=False):
    px = N / tile_m
    y = np.arange(N)[:, None] / px + 0 * np.arange(N)[None, :]
    x = np.arange(N)[None, :] / px + 0 * np.arange(N)[:, None]
    L, W = unit
    row = np.floor(y / W).astype(int)
    xo = x + (row % 2) * (L / 2)
    col_i = np.floor(xo / L).astype(int)
    jx = np.minimum(xo % L, L - xo % L); jy = np.minimum(y % W, W - y % W)
    joint = np.clip(1 - np.minimum(jx, jy) / 0.004, 0, 1)
    rid = (row * 31 + col_i * 17) % 97
    bvar = (np.sin(rid * 78.233) * 12543.123) % 1.0
    grain = fbm(N, 32, 4, 9)
    c = np.array(colour, np.float32)
    base = c[None, None, :] * (1 - var + 2 * var * bvar[..., None]) * (0.96 + 0.08 * grain[..., None])
    base = base * (1 - joint[..., None]) + np.array(joint_col)[None, None, :] * c.mean() * 1.15 * joint[..., None]
    edge = np.clip(np.minimum(jx, jy) / 0.012, 0, 1)
    h = 0.75 * edge + 0.25 * grain
    save_set(name, base, h, 0.86 + 0.08 * grain, nstrength=2.5)


def lawn():
    # Irrigated lawn, sampled colour from finished-state frame 128.9 s, lifted to daylight albedo.
    g1 = fbm(N, 8, 6, 21); g2 = fbm(N, 128, 2, 22); g3 = fbm(N, 3, 3, 23)
    c = col('lawn') * 1.35
    base = c[None, None, :] * (0.82 + 0.25 * g1[..., None] + 0.12 * (g2[..., None] - 0.5))
    base[..., 0] *= (0.95 + 0.1 * g3); base[..., 2] *= 0.9
    h = 0.7 * g2 + 0.3 * g1
    save_set('lawn', base, h, 0.92 + 0.05 * g2, nstrength=2.0)


def turf_pitch():
    # Artificial turf fibres (4 m tile); stripes + markings are drawn in the pitch texture.
    g = fbm(N, 128, 2, 31); m = fbm(N, 6, 4, 32)
    c = (col('turf_light') + col('turf_dark')) / 2
    base = c[None, None, :] * (0.9 + 0.12 * g[..., None] + 0.05 * m[..., None])
    save_set('turf', base, g, 0.75 + 0.1 * g, nstrength=1.5)


def pitch_markings():
    # Whole-pitch texture (22.8 m x 44.1 m), mowing stripes of the turf as in frame 77.01 s.
    W, H = 512, 1024
    img = np.zeros((H, W, 3), np.float32)
    a, b = col('turf_light'), col('turf_dark')
    nstr = 14
    for i in range(nstr):
        y0, y1 = int(i * H / nstr), int((i + 1) * H / nstr)
        img[y0:y1] = a if i % 2 == 0 else (a * 0.55 + b * 0.45)
    g = fbm(1024, 64, 3, 33)[:H, :W]
    img *= (0.93 + 0.12 * g[..., None])
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im); w = 4; s = W / 22.8
    m = int(1.0 * s)
    d.rectangle([m, m, W - m, H - m], outline=(235, 235, 230), width=w)
    d.line([(m, H // 2), (W - m, H // 2)], fill=(235, 235, 230), width=w)
    r = int(3.0 * s); d.ellipse([W // 2 - r, H // 2 - r, W // 2 + r, H // 2 + r], outline=(235, 235, 230), width=w)
    bw, bh = int(10 * s), int(5 * s)
    d.rectangle([W // 2 - bw // 2, m, W // 2 + bw // 2, m + bh], outline=(235, 235, 230), width=w)
    d.rectangle([W // 2 - bw // 2, H - m - bh, W // 2 + bw // 2, H - m], outline=(235, 235, 230), width=w)
    im.save(OUT + 'pitch_markings_basecolor.jpg', quality=90)
    print('texture pitch_markings')


def desert_sand_photo():
    """Real photo crop of desert sand (frame 113.3 s): lighting flattened, outliers
    (footprints, pebbles) in-painted with local colour, then made seamless."""
    src = np.asarray(Image.open(ROOT + 'analysis/texture_src/t_113.3.png').convert('RGB'), np.float32) / 255
    crop = src[760:1040, 40:600]
    crop = np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((1120, 560), Image.LANCZOS), np.float32) / 255
    def blur(a, r):
        return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
    low = blur(crop, 25)
    flat = crop / np.maximum(low, 1e-3) * low.mean((0, 1))
    lum = flat.mean(-1); med = np.median(lum)
    out = (lum < med * 0.93) | (lum > med * 1.07)
    out = np.asarray(Image.fromarray((out * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))) > 0
    fill = blur(np.where(out[..., None], low.mean((0, 1)), flat), 6)
    flat = np.where(out[..., None], fill, flat)
    # keep only modest detail around the sampled mean colour
    detail = flat / flat.mean((0, 1)) - 1.0
    base = col('sand_desert')[None, None, :] * (1.0 + 0.8 * detail)
    t = base[24:536, 300:812]; n = t.shape[0]
    sh = np.roll(np.roll(t, n // 2, 0), n // 2, 1)
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1)
    w = np.clip(np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy)) * 6, 0, 1)[..., None]
    seam = t * w + sh * (1 - w)
    h = fbm(512, 8, 5, 41)
    save_set('desert_sand', seam, h, 0.95 * np.ones((512, 512)), nstrength=1.0, size=1024)


def timber():
    # Timber slats (gazebos/pergola): colour from frame 57.76 s, grain along U.
    y = np.arange(N)[:, None] / N
    grain = fbm(N, 4, 6, 51); streak = np.asarray(Image.fromarray((fbm(N, 64, 3, 52) * 255).astype(np.uint8)).resize((N, N)), np.float32) / 255
    rings = 0.5 + 0.5 * np.sin((y * 40 + grain * 3) * np.pi * 2)
    base = col('timber')[None, None, :] * 1.6 * (0.85 + 0.15 * rings[..., None] + 0.08 * streak[..., None])
    save_set('timber', base, 0.6 * rings + 0.4 * grain, 0.7 + 0.15 * grain, nstrength=1.5)


def concrete_light(name='concrete_light', c=(0.74, 0.73, 0.70)):
    m = fbm(N, 6, 6, 61); g = fbm(N, 96, 3, 62)
    base = np.array(c)[None, None, :] * (0.92 + 0.1 * m[..., None] + 0.05 * (g[..., None] - .5))
    save_set(name, base, 0.5 * g + 0.5 * m, 0.88 + 0.08 * g, nstrength=1.0)


def roof_membrane():
    # Flat roofs: light grey/white waterproofing with screed seams (sampled from aerial frame 124.38 s).
    tile_m = 4.0; px = N / tile_m
    x = np.arange(N)[None, :] / px; y = np.arange(N)[:, None] / px
    seam = np.clip(1 - np.minimum(np.minimum(x % 1.0, 1 - x % 1.0), np.minimum(y % 1.0, 1 - y % 1.0)) / 0.01, 0, 1)
    m = fbm(N, 4, 5, 71); g = fbm(N, 64, 3, 72)
    c = col('roof_light') * 1.0
    base = c[None, None, :] * (0.9 + 0.12 * m[..., None]) * (1 - 0.12 * seam[..., None])
    save_set('roof_membrane', base, 0.6 * (1 - seam) + 0.4 * g, 0.8 + 0.1 * g, nstrength=1.2)


def dome_ribbed():
    # Dome cladding: white, 32 vertical ribs per full turn (U spans 360 deg), courses every 1/24 of V.
    u = np.arange(N)[None, :] / N; v = np.arange(N)[:, None] / N
    rib = np.clip(1 - np.abs(((u * 32) % 1.0) - 0.5) * 2 / 0.08, 0, 1)
    rib = np.maximum(rib, np.clip(1 - np.abs(((u * 32 + 0.5) % 1.0) - 0.5) * 2 / 0.04, 0, 1) * 0)
    m = fbm(N, 4, 5, 81)
    base = col('dome_white')[None, None, :] * 0.93 * (0.97 + 0.04 * m[..., None]) * (1 - 0.05 * rib[..., None])
    h = rib * 0.8 + 0.2 * m
    save_set('dome_ribbed', base, h, 0.55 + 0.1 * m, nstrength=4.0)


def metal_dark():
    g = fbm(N // 2, 32, 3, 91)
    base = np.array([0.13, 0.135, 0.14])[None, None, :] * (0.9 + 0.2 * g[..., None])
    save_set('metal_dark', base, g, 0.45 + 0.1 * g, nstrength=0.5)


if __name__ == '__main__':
    plaster(); sandstone_ashlar(); lawn(); turf_pitch(); pitch_markings(); desert_sand_photo(); timber()
    concrete_light(); roof_membrane(); dome_ribbed(); metal_dark()
    pal = PAL
    pavers('pavers_red', col('pavers_red') * 1.05)
    pavers('pavers_ring', col('pavers_ring_purple') * 1.25)
    pavers('pavers_grey', col('forecourt_grey') * 1.15, var=0.05)
    pavers('pavers_ochre', col('pad_ochre') * 1.2)
    pavers('pavers_beige', np.array([0.80, 0.74, 0.64]), var=0.05)
    pavers('pavers_white', np.array([0.86, 0.86, 0.84]), var=0.03)

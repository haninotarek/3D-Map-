"""Facade and signage textures (procedural, proportions measured from the video).

Window bay module (Main Building frontal frame 90.3 s and teaching-block frames 97.4 / 99.1 s):
  bay width 3.6 m, floor height 4.0 m (upper) / 4.5 m (ground), window 2.1 m x 2.2 m,
  3 vertical lights + transom, white aluminium frames, blue-grey reflective glass,
  ground-floor windows set in sandstone cladding with security grilles (97.4 s).
Signage text is transcribed from the video (gate shots 003-006, building signs).
"""
import numpy as np, json, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = '/home/user/campus_project/'
OUT = ROOT + 'deliverables/textures/'
PAL = json.load(open(ROOT + 'data/palette.json'))
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'


def load(name, size):
    return Image.open(OUT + name).convert('RGB').resize(size, Image.LANCZOS)


def normal_from_height(h, strength):
    h = h.astype(np.float32)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


def window_bay(name, wall_tex, bay_w, floor_h, win_w, win_h, sill, grille=False, px_per_m=150, transom_from_top=0.55, wall_rough=0.85):
    W, H = int(bay_w * px_per_m), int(floor_h * px_per_m)
    base = load(wall_tex + '_basecolor.jpg', (W, H))
    wall_n = Image.open(OUT + wall_tex + '_normal.png').convert('RGB').resize((W, H), Image.LANCZOS)
    height = np.full((H, W), 0.6, np.float32)
    rough = np.full((H, W), wall_rough, np.float32)
    d = ImageDraw.Draw(base)
    m = lambda v: int(round(v * px_per_m))
    x0 = (bay_w - win_w) / 2; x1 = x0 + win_w
    ytop = floor_h - (sill + win_h); ybot = floor_h - sill          # image y grows downward
    rev = 0.12   # reveal width
    # reveal (shadowed jambs)
    d.rectangle([m(x0 - rev), m(ytop - rev * 0.6), m(x1 + rev), m(ybot)], fill=tuple(int(c * 0.72) for c in base.getpixel((5, 5))))
    height[m(ytop - rev * 0.6):m(ybot), m(x0 - rev):m(x1 + rev)] = 0.35
    # glass with sky-reflection gradient
    g_top = np.array([96, 116, 134]); g_bot = np.array([38, 50, 62])
    for yy in range(m(ytop), m(ybot)):
        t = (yy - m(ytop)) / max(1, (m(ybot) - m(ytop)))
        c = (g_top * (1 - t) + g_bot * t).astype(int)
        d.line([(m(x0), yy), (m(x1), yy)], fill=tuple(c))
    height[m(ytop):m(ybot), m(x0):m(x1)] = 0.2
    rough[m(ytop):m(ybot), m(x0):m(x1)] = 0.06
    # frames: outer, 2 mullions, transom
    fw = 0.06; frame = (238, 238, 236)
    def bar(xa, ya, xb, yb):
        d.rectangle([m(xa), m(ya), m(xb), m(yb)], fill=frame)
        height[m(ya):m(yb) + 1, m(xa):m(xb) + 1] = 0.45; rough[m(ya):m(yb) + 1, m(xa):m(xb) + 1] = 0.35
    bar(x0, ytop, x1, ytop + fw); bar(x0, ybot - fw, x1, ybot); bar(x0, ytop, x0 + fw, ybot); bar(x1 - fw, ytop, x1, ybot)
    for k in (1, 2):
        xm = x0 + win_w * k / 3; bar(xm - fw / 2, ytop, xm + fw / 2, ybot)
    yt = ytop + transom_from_top; bar(x0, yt - fw / 2, x1, yt + fw / 2)
    # sill
    d.rectangle([m(x0 - rev - 0.05), m(ybot), m(x1 + rev + 0.05), m(ybot + 0.07)], fill=(232, 222, 205))
    height[m(ybot):m(ybot + 0.07), m(x0 - rev - 0.05):m(x1 + rev + 0.05)] = 0.8
    if grille:
        for k in range(1, 14):
            xg = x0 + win_w * k / 14
            d.line([(m(xg), m(ytop + 0.05)), (m(xg), m(ybot - 0.05))], fill=(40, 42, 44), width=max(2, m(0.018)))
            height[m(ytop):m(ybot), max(0, m(xg) - 1):m(xg) + 2] = 0.55
        for yy in (ytop + 0.3, ybot - 0.3):
            d.line([(m(x0), m(yy)), (m(x1), m(yy))], fill=(40, 42, 44), width=max(2, m(0.02)))
    # floor band (string course) at bottom of each floor
    d.rectangle([0, H - m(0.10), W, H], fill=tuple(int(c * 0.93) for c in base.getpixel((W // 2, H - m(0.2)))))
    height[H - m(0.10):H, :] = 0.7
    base.save(OUT + f'{name}_basecolor.jpg', quality=90)
    n_geom = np.asarray(normal_from_height(ndimage_blur(height, 1.2), 6.0), np.float32) / 255 * 2 - 1
    n_wall = np.asarray(wall_n, np.float32) / 255 * 2 - 1
    n = n_geom + np.concatenate([n_wall[..., :2], np.zeros_like(n_wall[..., :1])], -1) * 0.6
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT + f'{name}_normal.png', optimize=True)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save(OUT + f'{name}_roughness.jpg', quality=90)
    print('facade', name, W, H)


def ndimage_blur(a, s):
    from scipy import ndimage
    return ndimage.gaussian_filter(a, s)


def drum_windows():
    # dome drum: plaster with 16 small arched windows around (Main Building dome, kf_124.38)
    W, H = 2048, 256
    base = load('plaster_cream_basecolor.jpg', (512, 256))
    img = Image.new('RGB', (W, H)); [img.paste(base, (i * 512, 0)) for i in range(4)]
    d = ImageDraw.Draw(img); rough = Image.new('L', (W, H), 215); dr = ImageDraw.Draw(rough)
    for i in range(16):
        cx = int((i + 0.5) * W / 16); w = 40
        d.rectangle([cx - w // 2, 90, cx + w // 2, 200], fill=(60, 76, 92)); d.ellipse([cx - w // 2, 70, cx + w // 2, 110], fill=(60, 76, 92))
        dr.rectangle([cx - w // 2, 70, cx + w // 2, 200], fill=20)
        d.rectangle([cx - w // 2 - 6, 200, cx + w // 2 + 6, 210], fill=(235, 226, 210))
    d.rectangle([0, 0, W, 18], fill=(236, 228, 214)); d.rectangle([0, H - 22, W, H], fill=(236, 228, 214))
    img.save(OUT + 'dome_drum_basecolor.jpg', quality=90); rough.save(OUT + 'dome_drum_roughness.jpg', quality=90)
    print('drum')


def gate_sign(name, text, rtl=False, w=2048, h=256, fg=(28, 52, 110)):
    """Raised lettering on the gate beams, transcribed from shots 003-006."""
    img = Image.new('RGB', (w, h), (238, 230, 214)); d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_B, int(h * 0.55), layout_engine=ImageFont.Layout.RAQM)
    kw = dict(direction='rtl', language='ar') if rtl else {}
    bb = d.textbbox((0, 0), text, font=font, **kw)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    avail = w - 2.6 * h
    if tw > avail:
        font = ImageFont.truetype(FONT_B, int(h * 0.55 * avail / tw), layout_engine=ImageFont.Layout.RAQM)
        bb = d.textbbox((0, 0), text, font=font, **kw); tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((w - tw) / 2 - bb[0], (h - th) / 2 - bb[1]), text, fill=fg, font=font, **kw)
    # medallion discs at both ends (logo roundels seen on the gate fascia)
    for cx in (int(h * 0.55), w - int(h * 0.55)):
        d.ellipse([cx - h * 0.33, h * 0.17, cx + h * 0.33, h * 0.83], fill=fg); d.ellipse([cx - h * 0.25, h * 0.25, cx + h * 0.25, h * 0.75], fill=(238, 230, 214))
    img.save(OUT + f'{name}_basecolor.jpg', quality=92); print('sign', name)


def building_sign(name, ar, en, w=1024, h=384):
    img = Image.new('RGB', (w, h), (226, 228, 230)); d = ImageDraw.Draw(img)
    fa = ImageFont.truetype(FONT_B, 120, layout_engine=ImageFont.Layout.RAQM); fe = ImageFont.truetype(FONT_SERIF, 100)
    bb = d.textbbox((0, 0), ar, font=fa, direction='rtl', language='ar'); d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], 30 - bb[1]), ar, fill=(30, 60, 120), font=fa, direction='rtl', language='ar')
    bb = d.textbbox((0, 0), en, font=fe)
    s = min(1.0, (w * 0.9) / (bb[2] - bb[0]))
    if s < 1: fe = ImageFont.truetype(FONT_SERIF, int(100 * s)); bb = d.textbbox((0, 0), en, font=fe)
    d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], 220 - bb[1]), en, fill=(30, 60, 120), font=fe)
    img.save(OUT + f'{name}_basecolor.jpg', quality=92); print('sign', name)


def roller_door():
    W, H = 512, 512
    img = Image.new('RGB', (W, H), (150, 154, 158)); d = ImageDraw.Draw(img)
    for y in range(0, H, 10): d.line([(0, y), (W, y)], fill=(118, 122, 126), width=3)
    img.save(OUT + 'roller_door_basecolor.jpg', quality=90); print('roller door')


def railing_alpha():
    # perimeter fence railing panel (dark steel, vertical bars) - RGBA, alpha-masked in glTF
    W, H = 512, 256
    a = np.zeros((H, W), np.uint8)
    for x in range(0, W, 16): a[:, x:x + 4] = 255
    a[18:30, :] = 255; a[H - 40:H - 28, :] = 255
    rgb = np.zeros((H, W, 3), np.uint8); rgb[...] = (34, 36, 38)
    Image.fromarray(np.dstack([rgb, a])).save(OUT + 'fence_railing_basecolor.png'); print('railing')


def mesh_fence_alpha():
    W = 256; a = np.zeros((W, W), np.uint8)
    for k in range(0, W, 16):
        for t in range(W):
            a[t, (k + t) % W] = 255; a[t, (k - t) % W] = 255
    a = np.maximum(a, np.roll(a, 1, 1))
    rgb = np.zeros((W, W, 3), np.uint8); rgb[...] = (40, 92, 60)
    Image.fromarray(np.dstack([rgb, a])).save(OUT + 'pitch_fence_basecolor.png'); print('pitch fence')


if __name__ == '__main__':
    window_bay('facade_upper', 'plaster_cream', 3.6, 4.0, 2.1, 2.2, 0.95)
    window_bay('facade_ground', 'sandstone_ashlar', 3.6, 4.5, 2.1, 2.5, 0.9, grille=True)
    window_bay('facade_main_upper', 'plaster_cream', 3.6, 4.4, 2.3, 2.4, 1.0)
    window_bay('facade_main_ground', 'sandstone_ashlar', 3.6, 4.8, 2.3, 2.6, 1.0)
    drum_windows(); roller_door(); railing_alpha(); mesh_fence_alpha()
    gate_sign('sign_gate_en', 'EAST PORT SAID.N.UNI')
    gate_sign('sign_gate_ar', 'جامعة شرق بورسعيد الأهلية', rtl=True)
    gate_sign('sign_gate_no1', 'بوابة رقم ١', rtl=True, w=1024)
    building_sign('sign_main_building', 'المبنى الرئيسي', 'MAIN BUILDING')

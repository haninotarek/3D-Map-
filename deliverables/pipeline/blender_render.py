"""Render preview images from the saved .blend (Cycles, CPU).
    blender -b deliverables/campus_model.blend -P pipeline/blender_render.py -- <preset> <cam1,cam2,...> <outdir>
preset: quick (960x540, 12 spp) | final (1600x900, 96 spp)
"""
import bpy, sys, os, time
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
preset = argv[0] if argv else 'quick'
cams = argv[1].split(',') if len(argv) > 1 and argv[1] else [o.name for o in bpy.data.objects if o.type == 'CAMERA']
outdir = argv[2] if len(argv) > 2 else '/home/user/campus_project/deliverables/renders/'
os.makedirs(outdir, exist_ok=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 12 if preset == 'quick' else 48
sc.cycles.use_adaptive_sampling = True
sc.cycles.use_denoising = True
try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
# memory-constrained machine (1.9 GB): lighter OIDN settings + tiling
for k, v in (('denoising_prefilter', 'FAST'), ('denoising_quality', 'BALANCED'), ('denoising_input_passes', 'RGB_ALBEDO'), ('use_auto_tile', True), ('tile_size', 512)):
    try: setattr(sc.cycles, k, v)
    except Exception as e: print('render option n/a', k, e)
sc.cycles.max_bounces = 4 if preset == 'quick' else 6
sc.cycles.diffuse_bounces = 2 if preset == 'quick' else 3
sc.cycles.glossy_bounces = 2
sc.cycles.transparent_max_bounces = 8
sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
W, H = (960, 540) if preset == 'quick' else (1440, 810)
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
sc.view_settings.view_transform = 'AgX'
try: sc.view_settings.look = 'AgX - Base Contrast'
except Exception: pass
sc.view_settings.exposure = -0.6
for c in cams:
    ob = bpy.data.objects.get(c)
    if not ob: print('missing camera', c); continue
    sc.camera = ob
    if 'render_resolution' in ob.keys():
        rw, rh = ob['render_resolution']; k = W / rw
        sc.render.resolution_x, sc.render.resolution_y = int(rw * k), int(rh * k)
    else:
        sc.render.resolution_x, sc.render.resolution_y = W, H
    t = time.time()
    sc.render.filepath = os.path.join(outdir, f'{c}.jpg')
    bpy.ops.render.render(write_still=True)
    print('[render] %s %.1fs' % (c, time.time() - t), flush=True)

"""Bake the scene's Nishita sky to an equirectangular panorama for the web viewer."""
import bpy, math
sc = bpy.context.scene
for lc in bpy.context.view_layer.layer_collection.children: lc.exclude = True
cd = bpy.data.cameras.new('PANO'); cd.type = 'PANO'
try: cd.panorama_type = 'EQUIRECTANGULAR'
except Exception: cd.cycles.panorama_type = 'EQUIRECTANGULAR'
cam = bpy.data.objects.new('PANO', cd); sc.collection.objects.link(cam)
cam.location = (0, 0, 2); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
sc.camera = cam
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 4; sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 2048, 1024
sc.view_settings.view_transform = 'AgX'; sc.view_settings.exposure = -0.6
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
sc.render.filepath = '/home/user/campus_project/viewer/assets/sky_equirect.jpg'
bpy.ops.render.render(write_still=True)

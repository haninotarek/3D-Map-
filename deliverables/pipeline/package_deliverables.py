"""Assemble the deliverables folder and the ZIP archive.
Copies the web viewer (with current GLBs), data, pipeline scripts and photogrammetry products
into deliverables/, removes Blender backup files, verifies that every path referenced in
README.md exists, and writes EPNU_campus_3d_deliverables.zip next to the deliverables folder."""
import os, shutil, json, zipfile, re, hashlib

ROOT = '/home/user/campus_project/'
D = ROOT + 'deliverables/'

def copytree(src, dst):
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.blend1'))

# web viewer with the current models and building data
for f in ('campus_model.glb', 'campus_model_mobile.glb'):
    shutil.copy2(D + f, ROOT + 'viewer/models/' + f)
shutil.copy2(ROOT + 'data/buildings.json', ROOT + 'viewer/data/buildings.json')
copytree(ROOT + 'viewer', D + 'web_viewer')

# data
os.makedirs(D + 'data', exist_ok=True)
for f in ('buildings.json', 'site_layout.json', 'osm_footprints_local.json', 'osm_roads_local.json', 'palette.json', 'model_stats.json'):
    shutil.copy2(ROOT + 'data/' + f, D + 'data/' + f)

# pipeline scripts
copytree(ROOT + 'pipeline', D + 'pipeline')

# photogrammetry products
# The photogrammetry_test/ working folders may be gone after a sandbox restart (2026-10-15); the packaged
# copies in deliverables/photogrammetry/ (restored from the ZIP) are then kept instead of crashing.
def copy_product(src, dst):
    if os.path.exists(src):
        shutil.copy2(src, dst)
    elif os.path.exists(dst):
        print('kept packaged copy (source missing):', os.path.relpath(dst, D))
    else:
        print('WARNING: missing both source and packaged copy:', os.path.relpath(dst, D))

P = D + 'photogrammetry/'
os.makedirs(P, exist_ok=True)
A = ROOT + 'photogrammetry_test/clipA/'
for f in ('registration.json', 'building_heights.json', 'sparse0.ply'):
    copy_product(A + f, P + 'clipA_' + f)
os.makedirs(P + 'clipA_sparse_txt', exist_ok=True)
for f in ('cameras.txt', 'images.txt'):
    copy_product(A + 'sparse_txt/' + f, P + 'clipA_sparse_txt/' + f)
for f in ('ortho_clipA.jpg', 'ortho_clipA.jpg.json', 'ortho_clipA_overlay.jpg', 'ortho_kmeans.jpg', 'site_plan_overlay.jpg'):
    copy_product(ROOT + 'analysis/' + f, P + f)
for f in ('mapper.log',):
    copy_product(A + f, P + 'clipA_' + f)
B = ROOT + 'photogrammetry_test/clipB/'
if os.path.exists(B + 'mapper.log'): shutil.copy2(B + 'mapper.log', P + 'clipB_mapper.log')

# analysis documents & evidence sheets
shutil.copy2(ROOT + 'analysis/source_analysis.md', D + 'source_analysis.md')
E = D + 'evidence/'
os.makedirs(E, exist_ok=True)
for f in ('contact_sheets/main_vs_dome.jpg', 'contact_sheets/main_building_compare.jpg', 'satellite/osm_overlay_campus.jpg',
          'plan_osm_vertices.png', 'render_quick/sfm_compare_f022.jpg', 'contact_sheets/textures_check.jpg', 'contact_sheets/facade_check.jpg'):
    if os.path.exists(ROOT + 'analysis/' + f): shutil.copy2(ROOT + 'analysis/' + f, E + os.path.basename(f))
for f in os.listdir(D):
    if f.endswith('.blend1'): os.remove(D + f)

# verify README references
readme = open(D + 'README.md').read()
refs = set(re.findall(r'`((?:[\w\-]+/)*[\w\-]+\.(?:glb|blend|md|json|jpg|png|py))`', readme))
missing = []
for r in refs:
    cands = [D + r, D + 'web_viewer/' + r, D + 'data/' + r, D + 'qa/' + r, D + 'pipeline/' + r.split('/')[-1]]
    if not any(os.path.exists(c) for c in cands): missing.append(r)
print('README references checked:', len(refs), 'missing:', missing)

# ZIP
zpath = ROOT + 'EPNU_campus_3d_deliverables.zip'
if os.path.exists(zpath): os.remove(zpath)
n = 0
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for base, dirs, files in os.walk(D):
        for f in files:
            full = os.path.join(base, f)
            z.write(full, 'EPNU_campus_3d/' + os.path.relpath(full, D)); n += 1
with zipfile.ZipFile(zpath) as z:
    bad = z.testzip()
print('zip', zpath, round(os.path.getsize(zpath) / 1e6, 1), 'MB', n, 'files; integrity:', 'OK' if bad is None else bad)

"""Restore missing workspace files from the packaged deliverables ZIP.

Why this exists: sandbox restarts can drop nested folders from the workspace
snapshot (seen 2026-10-15: only depth-2 files survived). The final ZIP written by
package_deliverables.py contains a full copy of the web viewer and deliverables,
so it is the recovery source.

Related fix (same day): the vendored three.js core used to live in viewer/lib/three/build/, but
"build" is a folder name the workspace snapshot always excludes, so it now lives in
viewer/lib/three/bundle/ (import map in index.html updated). Avoid excluded folder names
(build, dist, out, target, coverage, node_modules, .cache, ...) anywhere in this project.

Non-destructive: existing files are never overwritten. Each existing file is
hash-compared with its ZIP copy and reported as identical / different.

Usage (from /home/user/campus_project):
    python3 pipeline/restore_from_zip.py viewer          # ZIP web_viewer/ -> viewer/
    python3 pipeline/restore_from_zip.py deliverables    # ZIP root       -> deliverables/
    python3 pipeline/restore_from_zip.py viewer deliverables
"""
import hashlib
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "EPNU_campus_3d_deliverables.zip")
PREFIX = "EPNU_campus_3d/"
TARGETS = {
    # name: (member prefix inside ZIP, destination directory)
    "viewer": (PREFIX + "web_viewer/", os.path.join(ROOT, "viewer")),
    "deliverables": (PREFIX, os.path.join(ROOT, "deliverables")),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def restore(z, member_prefix, dest):
    stats = {"restored": 0, "identical": 0, "different": 0}
    for info in z.infolist():
        if info.is_dir() or not info.filename.startswith(member_prefix):
            continue
        rel = info.filename[len(member_prefix):]
        out = os.path.join(dest, rel)
        data = z.read(info)
        if os.path.exists(out):
            with open(out, "rb") as fh:
                same = sha(fh.read()) == sha(data)
            stats["identical" if same else "different"] += 1
            if not same:
                print(f"  DIFFERENT (kept disk version): {os.path.relpath(out, ROOT)}")
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as fh:
            fh.write(data)
        mtime = time.mktime(info.date_time + (0, 0, -1))
        os.utime(out, (mtime, mtime))
        stats["restored"] += 1
    return stats


def main(names):
    if not names or any(n not in TARGETS for n in names):
        sys.exit(__doc__)
    with zipfile.ZipFile(ZIP) as z:
        bad = z.testzip()
        if bad is not None:
            sys.exit(f"ZIP is corrupt at member {bad}; aborting.")
        for name in names:
            member_prefix, dest = TARGETS[name]
            s = restore(z, member_prefix, dest)
            print(f"{name:13s} -> {os.path.relpath(dest, ROOT)}/ : "
                  f"restored {s['restored']}, already identical {s['identical']}, "
                  f"different (kept) {s['different']}")


if __name__ == "__main__":
    main(sys.argv[1:])

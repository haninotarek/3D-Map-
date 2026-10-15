#!/bin/bash
# COLMAP feasibility test (CPU only). Usage: run_colmap.sh <workdir>
set -e
W=$1
cd $W
rm -f db.db; rm -rf sparse; mkdir -p sparse
export QT_QPA_PLATFORM=offscreen
time colmap feature_extractor --database_path db.db --image_path images \
  --ImageReader.single_camera 1 --ImageReader.camera_model SIMPLE_RADIAL \
  --SiftExtraction.use_gpu 0 --SiftExtraction.num_threads 2 --SiftExtraction.max_num_features 6000 > fe.log 2>&1
echo "features done"
time colmap exhaustive_matcher --database_path db.db --SiftMatching.use_gpu 0 --SiftMatching.num_threads 2 > match.log 2>&1
echo "matching done"
time colmap mapper --database_path db.db --image_path images --output_path sparse \
  --Mapper.num_threads 2 > mapper.log 2>&1
echo "mapping done"
for m in sparse/*/; do echo "== model $m"; colmap model_analyzer --path $m 2>&1 | grep -E "Cameras|Images|Registered|Points|Observations|Mean track|Mean reprojection" ; done

#!/bin/bash
set -e
W=$1
cd $W
rm -f db.db; rm -rf sparse; mkdir -p sparse
export QT_QPA_PLATFORM=offscreen
colmap feature_extractor --database_path db.db --image_path images \
  --ImageReader.single_camera_per_folder 1 --ImageReader.camera_model SIMPLE_RADIAL \
  --SiftExtraction.use_gpu 0 --SiftExtraction.num_threads 2 --SiftExtraction.max_num_features 5000 > fe.log 2>&1
echo "features done"
colmap exhaustive_matcher --database_path db.db --SiftMatching.use_gpu 0 --SiftMatching.num_threads 2 > match.log 2>&1
echo "matching done"
colmap mapper --database_path db.db --image_path images --output_path sparse --Mapper.num_threads 2 > mapper.log 2>&1
echo "mapping done"
for m in sparse/*/; do echo "== model $m"; colmap model_analyzer --path $m 2>&1 | grep -E "Registered|Points:|Mean reprojection" ; done

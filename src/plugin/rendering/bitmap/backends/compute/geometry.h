#pragma once

#include "rendering/bitmap/backends/compute/device.h"
#include "rendering/bitmap/planning/plan.h"

#include <vector>

namespace momentum {
namespace bitmap {
namespace compute {

struct FillBatchGeometry {
  std::vector<FillTriangleData> triangles;
  std::vector<EdgeSegment> boundaryEdges;
  Float4 bounds;
  bool hasBounds = false;
};

FillBatchGeometry BuildTriangleBatchGeometry(
  const std::vector<BitmapDrawPlan::FillTriangle>& triangles,
  const std::vector<BitmapDrawPlan::BoundaryEdge>& explicitEdges,
  const BitmapDrawPlan::DrawBatch& batch
);

}  // namespace compute
}  // namespace bitmap
}  // namespace momentum

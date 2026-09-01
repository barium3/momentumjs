#include "rendering/bitmap/backends/compute/geometry.h"

#include <algorithm>
#include <cstring>
#include <unordered_map>

namespace momentum {
namespace bitmap {
namespace compute {
namespace {

std::uint32_t FloatBits(float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  return bits;
}

bool PointLess(const Float2& lhs, const Float2& rhs) {
  return lhs.x != rhs.x ? lhs.x < rhs.x : lhs.y < rhs.y;
}

struct EdgeKey {
  std::uint32_t ax = 0;
  std::uint32_t ay = 0;
  std::uint32_t bx = 0;
  std::uint32_t by = 0;

  bool operator==(const EdgeKey& other) const {
    return ax == other.ax && ay == other.ay &&
      bx == other.bx && by == other.by;
  }
};

struct EdgeKeyHash {
  std::size_t operator()(const EdgeKey& key) const noexcept {
    std::size_t seed = 1469598103934665603ull;
    auto mix = [&](std::uint32_t value) {
      seed ^= static_cast<std::size_t>(value);
      seed *= 1099511628211ull;
    };
    mix(key.ax);
    mix(key.ay);
    mix(key.bx);
    mix(key.by);
    return seed;
  }
};

struct EdgeAccumulator {
  EdgeSegment segment;
  std::uint32_t count = 0;
};

void AccumulateEdge(
  Float2 a,
  Float2 b,
  std::unordered_map<EdgeKey, EdgeAccumulator, EdgeKeyHash>* edges
) {
  if (!edges || (a.x == b.x && a.y == b.y)) {
    return;
  }
  if (PointLess(b, a)) {
    std::swap(a, b);
  }
  const EdgeKey key{
    FloatBits(a.x), FloatBits(a.y), FloatBits(b.x), FloatBits(b.y)
  };
  EdgeAccumulator& value = (*edges)[key];
  if (value.count == 0) {
    value.segment = EdgeSegment{a, b};
  }
  value.count += 1;
}

}  // namespace

FillBatchGeometry BuildTriangleBatchGeometry(
  const std::vector<BitmapDrawPlan::FillTriangle>& triangles,
  const std::vector<BitmapDrawPlan::BoundaryEdge>& explicitEdges,
  const BitmapDrawPlan::DrawBatch& batch
) {
  FillBatchGeometry geometry;
  if (batch.start > triangles.size() ||
      batch.count > triangles.size() - batch.start) {
    return geometry;
  }

  const bool useExplicitEdges =
    batch.explicitEdgeCount > 0 &&
    batch.explicitEdgeStart <= explicitEdges.size() &&
    batch.explicitEdgeCount <= explicitEdges.size() - batch.explicitEdgeStart;
  std::unordered_map<EdgeKey, EdgeAccumulator, EdgeKeyHash> edgeMap;
  if (!useExplicitEdges) {
    edgeMap.reserve(batch.count * 3U);
  }
  geometry.triangles.reserve(batch.count);

  for (std::size_t index = 0; index < batch.count; ++index) {
    const BitmapDrawPlan::FillTriangle& source = triangles[batch.start + index];
    const Float2 a{source.x1, source.y1};
    const Float2 b{source.x2, source.y2};
    const Float2 c{source.x3, source.y3};
    geometry.triangles.push_back(FillTriangleData{a, b, c});
    if (!useExplicitEdges) {
      AccumulateEdge(a, b, &edgeMap);
      AccumulateEdge(b, c, &edgeMap);
      AccumulateEdge(c, a, &edgeMap);
    }

    const float minX = std::min({a.x, b.x, c.x});
    const float minY = std::min({a.y, b.y, c.y});
    const float maxX = std::max({a.x, b.x, c.x});
    const float maxY = std::max({a.y, b.y, c.y});
    if (!geometry.hasBounds) {
      geometry.bounds = Float4{minX, minY, maxX, maxY};
      geometry.hasBounds = true;
    } else {
      geometry.bounds.x = std::min(geometry.bounds.x, minX);
      geometry.bounds.y = std::min(geometry.bounds.y, minY);
      geometry.bounds.z = std::max(geometry.bounds.z, maxX);
      geometry.bounds.w = std::max(geometry.bounds.w, maxY);
    }
  }

  if (useExplicitEdges) {
    geometry.boundaryEdges.reserve(batch.explicitEdgeCount);
    for (std::size_t index = 0; index < batch.explicitEdgeCount; ++index) {
      const BitmapDrawPlan::BoundaryEdge& source =
        explicitEdges[batch.explicitEdgeStart + index];
      geometry.boundaryEdges.push_back(EdgeSegment{
        Float2{source.x1, source.y1}, Float2{source.x2, source.y2}
      });
    }
  } else {
    geometry.boundaryEdges.reserve(edgeMap.size());
    for (const auto& entry : edgeMap) {
      if ((entry.second.count % 2U) == 1U) {
        geometry.boundaryEdges.push_back(entry.second.segment);
      }
    }
  }
  return geometry;
}

}  // namespace compute
}  // namespace bitmap
}  // namespace momentum

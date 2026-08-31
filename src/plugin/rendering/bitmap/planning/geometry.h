#pragma once

#include "rendering/bitmap/planning/plan.h"

#include <array>
#include <utility>

namespace momentum {
namespace bitmap {
namespace planning {
namespace geometry {

using Point = std::pair<double, double>;
using Triangle = std::array<Point, 3>;

struct FlattenedPath {
  std::vector<Point> vertices;
  bool closed = false;
  bool isContour = false;
};

FlattenedPath FlattenPath(
  PF_LayerDef* output,
  const Transform2D& transform,
  const PathSubpath& source
);

void Normalize(FlattenedPath* path);
bool SamePoint(const Point& a, const Point& b, double epsilon = 1e-6);

bool Triangulate(
  const std::vector<Point>& vertices,
  std::vector<Triangle>* outTriangles
);

void AddTriangle(
  const Point& a,
  const Point& b,
  const Point& c,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
);

void AddBoundary(
  const std::vector<Point>& loop,
  BitmapDrawPlan* plan
);

void AddPointStroke(
  const Point& point,
  double halfWidth,
  int strokeCap,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
);

void AddPolylineStroke(
  const std::vector<Point>& vertices,
  bool closed,
  double halfWidth,
  int strokeCap,
  int strokeJoin,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
);

}  // namespace geometry
}  // namespace planning
}  // namespace bitmap
}  // namespace momentum

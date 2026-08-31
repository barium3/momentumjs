#include "rendering/bitmap/planning/geometry.h"

#include "rendering/software/internal.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace momentum {
namespace bitmap {
namespace planning {
namespace geometry {

namespace {

constexpr double kBasePathFlatnessTolerance = 0.24;
constexpr double kMinPathFlatnessTolerance = 0.08;
constexpr double kMaxPathFlatnessTolerance = 0.24;

}  // namespace

double DistanceSquaredToSegment(
  const std::pair<double, double>& point,
  const std::pair<double, double>& start,
  const std::pair<double, double>& end
) {
  const double dx = end.first - start.first;
  const double dy = end.second - start.second;
  const double lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) {
    const double px = point.first - start.first;
    const double py = point.second - start.second;
    return px * px + py * py;
  }

  const double t = std::max(
    0.0,
    std::min(
      1.0,
      ((point.first - start.first) * dx + (point.second - start.second) * dy) / lengthSquared
    )
  );
  const double projectionX = start.first + dx * t;
  const double projectionY = start.second + dy * t;
  const double offsetX = point.first - projectionX;
  const double offsetY = point.second - projectionY;
  return offsetX * offsetX + offsetY * offsetY;
}

void FlattenQuadraticRecursive(
  std::vector<std::pair<double, double>>* vertices,
  const std::pair<double, double>& p0,
  const std::pair<double, double>& c,
  const std::pair<double, double>& p1,
  double toleranceSquared,
  int depth
) {
  if (!vertices) {
    return;
  }
  const double deviation = DistanceSquaredToSegment(c, p0, p1);
  if (deviation <= toleranceSquared || depth >= 12) {
    vertices->push_back(p1);
    return;
  }

  const std::pair<double, double> p0c = std::make_pair((p0.first + c.first) * 0.5, (p0.second + c.second) * 0.5);
  const std::pair<double, double> cp1 = std::make_pair((c.first + p1.first) * 0.5, (c.second + p1.second) * 0.5);
  const std::pair<double, double> mid = std::make_pair((p0c.first + cp1.first) * 0.5, (p0c.second + cp1.second) * 0.5);
  FlattenQuadraticRecursive(vertices, p0, p0c, mid, toleranceSquared, depth + 1);
  FlattenQuadraticRecursive(vertices, mid, cp1, p1, toleranceSquared, depth + 1);
}

void FlattenCubicRecursive(
  std::vector<std::pair<double, double>>* vertices,
  const std::pair<double, double>& p0,
  const std::pair<double, double>& c1,
  const std::pair<double, double>& c2,
  const std::pair<double, double>& p1,
  double toleranceSquared,
  int depth
) {
  if (!vertices) {
    return;
  }
  const double deviation = std::max(
    DistanceSquaredToSegment(c1, p0, p1),
    DistanceSquaredToSegment(c2, p0, p1)
  );
  if (deviation <= toleranceSquared || depth >= 12) {
    vertices->push_back(p1);
    return;
  }

  const std::pair<double, double> p01 = std::make_pair((p0.first + c1.first) * 0.5, (p0.second + c1.second) * 0.5);
  const std::pair<double, double> p12 = std::make_pair((c1.first + c2.first) * 0.5, (c1.second + c2.second) * 0.5);
  const std::pair<double, double> p23 = std::make_pair((c2.first + p1.first) * 0.5, (c2.second + p1.second) * 0.5);
  const std::pair<double, double> p012 = std::make_pair((p01.first + p12.first) * 0.5, (p01.second + p12.second) * 0.5);
  const std::pair<double, double> p123 = std::make_pair((p12.first + p23.first) * 0.5, (p12.second + p23.second) * 0.5);
  const std::pair<double, double> mid = std::make_pair((p012.first + p123.first) * 0.5, (p012.second + p123.second) * 0.5);
  FlattenCubicRecursive(vertices, p0, p01, p012, mid, toleranceSquared, depth + 1);
  FlattenCubicRecursive(vertices, mid, p123, p23, p1, toleranceSquared, depth + 1);
}

std::pair<double, double> ResolveAndTransformPoint(
  PF_LayerDef* output,
  const Transform2D& transform,
  const VertexSpec& vertex
) {
  double tx = 0.0;
  double ty = 0.0;
  ApplyTransform(
    transform,
    ResolveScalarSpec(vertex.x, output),
    ResolveScalarSpec(vertex.y, output),
    &tx,
    &ty
  );
  return std::make_pair(tx, ty);
}

FlattenedPath FlattenPath(
  PF_LayerDef* output,
  const Transform2D& transform,
  const PathSubpath& source
) {
  FlattenedPath flattened;
  flattened.isContour = source.isContour;
  if (!output) {
    return flattened;
  }

  const double transformScale = std::max(0.25, ApproximateTransformScale(transform));
  const double pathFlatnessTolerance = std::max(
    kMinPathFlatnessTolerance,
    std::min(kMaxPathFlatnessTolerance, kBasePathFlatnessTolerance / transformScale)
  );
  const double toleranceSquared = pathFlatnessTolerance * pathFlatnessTolerance;
  std::pair<double, double> current(0.0, 0.0);
  std::pair<double, double> start(0.0, 0.0);
  bool hasCurrent = false;

  for (std::size_t index = 0; index < source.segments.size(); ++index) {
    const PathSegment& segment = source.segments[index];
    switch (segment.type) {
      case PATH_SEGMENT_MOVE_TO:
        current = ResolveAndTransformPoint(output, transform, segment.point);
        start = current;
        flattened.vertices.push_back(current);
        hasCurrent = true;
        break;
      case PATH_SEGMENT_LINE_TO:
        if (!hasCurrent) {
          current = ResolveAndTransformPoint(output, transform, segment.point);
          start = current;
          flattened.vertices.push_back(current);
          hasCurrent = true;
          break;
        }
        current = ResolveAndTransformPoint(output, transform, segment.point);
        flattened.vertices.push_back(current);
        break;
      case PATH_SEGMENT_QUADRATIC_TO:
        if (!hasCurrent) {
          break;
        }
        FlattenQuadraticRecursive(
          &flattened.vertices,
          current,
          ResolveAndTransformPoint(output, transform, segment.control1),
          ResolveAndTransformPoint(output, transform, segment.point),
          toleranceSquared,
          0
        );
        current = flattened.vertices.back();
        break;
      case PATH_SEGMENT_CUBIC_TO:
        if (!hasCurrent) {
          break;
        }
        FlattenCubicRecursive(
          &flattened.vertices,
          current,
          ResolveAndTransformPoint(output, transform, segment.control1),
          ResolveAndTransformPoint(output, transform, segment.control2),
          ResolveAndTransformPoint(output, transform, segment.point),
          toleranceSquared,
          0
        );
        current = flattened.vertices.back();
        break;
      case PATH_SEGMENT_CLOSE:
        flattened.closed = true;
        current = start;
        break;
      default:
        break;
    }
  }

  return flattened;
}

bool IsNearlyEqual(double a, double b, double epsilon = 1e-6) {
  return std::fabs(a - b) <= epsilon;
}

bool SamePoint(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  double epsilon
) {
  return IsNearlyEqual(a.first, b.first, epsilon) && IsNearlyEqual(a.second, b.second, epsilon);
}

void Normalize(FlattenedPath* subpath) {
  if (!subpath) {
    return;
  }

  std::vector<std::pair<double, double>> cleaned;
  cleaned.reserve(subpath->vertices.size());
  for (std::size_t index = 0; index < subpath->vertices.size(); ++index) {
    if (!cleaned.empty() && SamePoint(cleaned.back(), subpath->vertices[index])) {
      continue;
    }
    cleaned.push_back(subpath->vertices[index]);
  }

  if (cleaned.size() >= 2 && SamePoint(cleaned.front(), cleaned.back())) {
    cleaned.pop_back();
  }

  subpath->vertices.swap(cleaned);
}

double SignedPolygonArea(const std::vector<std::pair<double, double>>& vertices) {
  if (vertices.size() < 3) {
    return 0.0;
  }

  double area = 0.0;
  for (std::size_t index = 0; index < vertices.size(); ++index) {
    const std::size_t next = (index + 1) % vertices.size();
    area += vertices[index].first * vertices[next].second - vertices[next].first * vertices[index].second;
  }
  return area * 0.5;
}

double CrossProduct(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c
) {
  return (b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first);
}

bool PointInTriangle(
  const std::pair<double, double>& point,
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c
) {
  const double c1 = CrossProduct(a, b, point);
  const double c2 = CrossProduct(b, c, point);
  const double c3 = CrossProduct(c, a, point);
  const bool hasNegative = (c1 < -1e-9) || (c2 < -1e-9) || (c3 < -1e-9);
  const bool hasPositive = (c1 > 1e-9) || (c2 > 1e-9) || (c3 > 1e-9);
  if (hasNegative && hasPositive) {
    return false;
  }
  // Ear clipping containment should use strict interior. If boundary points are
  // treated as "inside", bridged hole vertices can block all ears.
  const bool onEdge = std::fabs(c1) <= 1e-9 || std::fabs(c2) <= 1e-9 || std::fabs(c3) <= 1e-9;
  return !onEdge;
}

bool Triangulate(
  const std::vector<std::pair<double, double>>& vertices,
  std::vector<std::array<std::pair<double, double>, 3>>* outTriangles
) {
  if (!outTriangles || vertices.size() < 3) {
    return false;
  }

  const double area = SignedPolygonArea(vertices);
  if (std::fabs(area) <= 1e-9) {
    return false;
  }

  std::vector<std::size_t> indices(vertices.size());
  std::iota(indices.begin(), indices.end(), 0);
  const bool isCounterClockwise = area > 0.0;
  std::size_t guard = vertices.size() * vertices.size();

  while (indices.size() > 2 && guard > 0) {
    bool earFound = false;
    for (std::size_t i = 0; i < indices.size(); ++i) {
      const std::size_t prevIndex = indices[(i + indices.size() - 1) % indices.size()];
      const std::size_t currIndex = indices[i];
      const std::size_t nextIndex = indices[(i + 1) % indices.size()];

      const auto& a = vertices[prevIndex];
      const auto& b = vertices[currIndex];
      const auto& c = vertices[nextIndex];
      const double cross = CrossProduct(a, b, c);
      if (isCounterClockwise ? (cross <= 1e-9) : (cross >= -1e-9)) {
        continue;
      }

      bool containsPoint = false;
      for (std::size_t j = 0; j < indices.size(); ++j) {
        const std::size_t testIndex = indices[j];
        if (testIndex == prevIndex || testIndex == currIndex || testIndex == nextIndex) {
          continue;
        }
        if (PointInTriangle(vertices[testIndex], a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) {
        continue;
      }

      outTriangles->push_back({a, b, c});
      indices.erase(indices.begin() + static_cast<std::ptrdiff_t>(i));
      earFound = true;
      break;
    }

    if (!earFound) {
      return false;
    }
    --guard;
  }

  return indices.size() == 2;
}

constexpr double kPi = 3.14159265358979323846;

void NormalizePolygonVertices(std::vector<std::pair<double, double>>* vertices);
void EnsurePolygonOrientation(
  std::vector<std::pair<double, double>>* vertices,
  bool wantsCounterClockwise
);

bool TriangulatePolygonWithHoles(
  const std::vector<std::pair<double, double>>& outerInput,
  const std::vector<std::vector<std::pair<double, double>>>& holesInput,
  std::vector<std::array<std::pair<double, double>, 3>>* outTriangles
);

void AddTriangle(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
);

void AppendArcFan(
  const std::pair<double, double>& center,
  double radius,
  double startAngle,
  double deltaAngle,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
) {
  if (!plan || radius <= 1e-9) {
    return;
  }
  const int steps = std::max(
    8,
    static_cast<int>(std::ceil(std::fabs(deltaAngle) / (kPi / 16.0)))
  );
  std::pair<double, double> previousPoint = std::make_pair(
    center.first + std::cos(startAngle) * radius,
    center.second + std::sin(startAngle) * radius
  );
  for (int index = 1; index <= steps; ++index) {
    const double t = static_cast<double>(index) / static_cast<double>(steps);
    const double angle = startAngle + deltaAngle * t;
    const std::pair<double, double> nextPoint = std::make_pair(
      center.first + std::cos(angle) * radius,
      center.second + std::sin(angle) * radius
    );
    AddTriangle(center, previousPoint, nextPoint, color, plan);
    previousPoint = nextPoint;
  }
}

void AddTriangle(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
) {
  if (!plan) {
    return;
  }
  if (std::fabs(CrossProduct(a, b, c)) <= 1e-9) {
    return;
  }
  BitmapDrawPlan::FillTriangle triangle;
  triangle.x1 = static_cast<float>(a.first);
  triangle.y1 = static_cast<float>(a.second);
  triangle.x2 = static_cast<float>(b.first);
  triangle.y2 = static_cast<float>(b.second);
  triangle.x3 = static_cast<float>(c.first);
  triangle.y3 = static_cast<float>(c.second);
  triangle.color = color;
  plan->fillTriangles.push_back(triangle);
}

void AppendBoundaryEdge(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  BitmapDrawPlan* plan
) {
  if (!plan) {
    return;
  }
  if (SamePoint(a, b)) {
    return;
  }
  BitmapDrawPlan::BoundaryEdge edge;
  edge.x1 = static_cast<float>(a.first);
  edge.y1 = static_cast<float>(a.second);
  edge.x2 = static_cast<float>(b.first);
  edge.y2 = static_cast<float>(b.second);
  plan->boundaryEdges.push_back(edge);
}

void AddBoundary(
  const std::vector<std::pair<double, double>>& loop,
  BitmapDrawPlan* plan
) {
  if (!plan || loop.size() < 2) {
    return;
  }
  for (std::size_t index = 0; index < loop.size(); ++index) {
    AppendBoundaryEdge(loop[index], loop[(index + 1) % loop.size()], plan);
  }
}

void AppendBoundaryArc(
  const std::pair<double, double>& center,
  double radius,
  double startAngle,
  double deltaAngle,
  BitmapDrawPlan* plan
) {
  if (!plan || !(radius > 1e-9)) {
    return;
  }
  const int steps = std::max(
    8,
    static_cast<int>(std::ceil(std::fabs(deltaAngle) / (kPi / 16.0)))
  );
  std::pair<double, double> previousPoint = std::make_pair(
    center.first + std::cos(startAngle) * radius,
    center.second + std::sin(startAngle) * radius
  );
  for (int index = 1; index <= steps; ++index) {
    const double t = static_cast<double>(index) / static_cast<double>(steps);
    const double angle = startAngle + deltaAngle * t;
    const std::pair<double, double> nextPoint = std::make_pair(
      center.first + std::cos(angle) * radius,
      center.second + std::sin(angle) * radius
    );
    AppendBoundaryEdge(previousPoint, nextPoint, plan);
    previousPoint = nextPoint;
  }
}

void AppendPointStrokeBoundary(
  const std::pair<double, double>& point,
  double halfWidth,
  int strokeCap,
  BitmapDrawPlan* plan
) {
  if (!plan || halfWidth <= 1e-9) {
    return;
  }
  int capMode = strokeCap;
  if (capMode != STROKE_CAP_SQUARE && capMode != STROKE_CAP_ROUND && capMode != STROKE_CAP_PROJECT) {
    capMode = STROKE_CAP_ROUND;
  }
  if (capMode == STROKE_CAP_ROUND) {
    AppendBoundaryArc(point, halfWidth, 0.0, kPi * 2.0, plan);
    return;
  }
  const std::pair<double, double> topLeft = std::make_pair(point.first - halfWidth, point.second - halfWidth);
  const std::pair<double, double> topRight = std::make_pair(point.first + halfWidth, point.second - halfWidth);
  const std::pair<double, double> bottomRight = std::make_pair(point.first + halfWidth, point.second + halfWidth);
  const std::pair<double, double> bottomLeft = std::make_pair(point.first - halfWidth, point.second + halfWidth);
  AppendBoundaryEdge(topLeft, topRight, plan);
  AppendBoundaryEdge(topRight, bottomRight, plan);
  AppendBoundaryEdge(bottomRight, bottomLeft, plan);
  AppendBoundaryEdge(bottomLeft, topLeft, plan);
}

void AddPointStroke(
  const std::pair<double, double>& point,
  double halfWidth,
  int strokeCap,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
) {
  if (!plan || halfWidth <= 1e-9) {
    return;
  }
  int capMode = strokeCap;
  if (capMode != STROKE_CAP_SQUARE && capMode != STROKE_CAP_ROUND && capMode != STROKE_CAP_PROJECT) {
    capMode = STROKE_CAP_ROUND;
  }
  if (capMode == STROKE_CAP_ROUND) {
    AppendArcFan(point, halfWidth, 0.0, kPi * 2.0, color, plan);
    return;
  }

  const std::pair<double, double> topLeft = std::make_pair(point.first - halfWidth, point.second - halfWidth);
  const std::pair<double, double> topRight = std::make_pair(point.first + halfWidth, point.second - halfWidth);
  const std::pair<double, double> bottomRight = std::make_pair(point.first + halfWidth, point.second + halfWidth);
  const std::pair<double, double> bottomLeft = std::make_pair(point.first - halfWidth, point.second + halfWidth);
  AddTriangle(topLeft, topRight, bottomRight, color, plan);
  AddTriangle(topLeft, bottomRight, bottomLeft, color, plan);
}

void AddPolylineStroke(
  const std::vector<std::pair<double, double>>& vertices,
  bool closed,
  double halfWidth,
  int strokeCap,
  int strokeJoin,
  const PF_Pixel& color,
  BitmapDrawPlan* plan
) {
  if (!plan || vertices.empty() || halfWidth <= 1e-9) {
    return;
  }
  if (vertices.size() == 1) {
    AddPointStroke(vertices.front(), halfWidth, strokeCap, color, plan);
    AppendPointStrokeBoundary(vertices.front(), halfWidth, strokeCap, plan);
    return;
  }

  if (closed) {
    const ClosedStrokeRing ring = BuildClosedStrokeRing(vertices, halfWidth, strokeJoin);
    std::vector<std::array<std::pair<double, double>, 3>> triangles;
    const std::vector<std::vector<std::pair<double, double>>> holes = {ring.inner};
    if (TriangulatePolygonWithHoles(ring.outer, holes, &triangles)) {
      for (std::size_t index = 0; index < triangles.size(); ++index) {
        AddTriangle(triangles[index][0], triangles[index][1], triangles[index][2], color, plan);
      }
    }
    AddBoundary(ring.outer, plan);
    AddBoundary(ring.inner, plan);
    return;
  }

  std::vector<std::pair<double, double>> outline =
    BuildOpenStrokeOutline(vertices, halfWidth, strokeCap, strokeJoin);
  NormalizePolygonVertices(&outline);
  EnsurePolygonOrientation(&outline, true);
  std::vector<std::array<std::pair<double, double>, 3>> triangles;
  if (Triangulate(outline, &triangles)) {
    for (std::size_t index = 0; index < triangles.size(); ++index) {
      AddTriangle(triangles[index][0], triangles[index][1], triangles[index][2], color, plan);
    }
  }
  AddBoundary(outline, plan);
}

bool PointOnSegment(
  const std::pair<double, double>& point,
  const std::pair<double, double>& a,
  const std::pair<double, double>& b
) {
  const double minX = std::min(a.first, b.first) - 1e-9;
  const double maxX = std::max(a.first, b.first) + 1e-9;
  const double minY = std::min(a.second, b.second) - 1e-9;
  const double maxY = std::max(a.second, b.second) + 1e-9;
  if (point.first < minX || point.first > maxX || point.second < minY || point.second > maxY) {
    return false;
  }
  return std::fabs(CrossProduct(a, b, point)) <= 1e-8;
}

int OrientationSign(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c
) {
  const double value = CrossProduct(a, b, c);
  if (value > 1e-9) {
    return 1;
  }
  if (value < -1e-9) {
    return -1;
  }
  return 0;
}

bool SegmentsIntersect(
  const std::pair<double, double>& a0,
  const std::pair<double, double>& a1,
  const std::pair<double, double>& b0,
  const std::pair<double, double>& b1
) {
  const int o1 = OrientationSign(a0, a1, b0);
  const int o2 = OrientationSign(a0, a1, b1);
  const int o3 = OrientationSign(b0, b1, a0);
  const int o4 = OrientationSign(b0, b1, a1);

  if (o1 != o2 && o3 != o4) {
    return true;
  }
  if (o1 == 0 && PointOnSegment(b0, a0, a1)) {
    return true;
  }
  if (o2 == 0 && PointOnSegment(b1, a0, a1)) {
    return true;
  }
  if (o3 == 0 && PointOnSegment(a0, b0, b1)) {
    return true;
  }
  if (o4 == 0 && PointOnSegment(a1, b0, b1)) {
    return true;
  }
  return false;
}

bool PointInPolygonEvenOdd(
  const std::pair<double, double>& point,
  const std::vector<std::pair<double, double>>& polygon
) {
  if (polygon.size() < 3) {
    return false;
  }

  for (std::size_t index = 0; index < polygon.size(); ++index) {
    const std::pair<double, double>& a = polygon[index];
    const std::pair<double, double>& b = polygon[(index + 1) % polygon.size()];
    if (PointOnSegment(point, a, b)) {
      return true;
    }
  }

  bool inside = false;
  for (std::size_t index = 0, prev = polygon.size() - 1; index < polygon.size(); prev = index++) {
    const std::pair<double, double>& a = polygon[index];
    const std::pair<double, double>& b = polygon[prev];
    const bool intersects = ((a.second > point.second) != (b.second > point.second)) &&
      (point.first <
        (b.first - a.first) * (point.second - a.second) /
          ((b.second - a.second) == 0.0 ? 1e-9 : (b.second - a.second)) +
        a.first);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

void NormalizePolygonVertices(std::vector<std::pair<double, double>>* vertices) {
  if (!vertices) {
    return;
  }
  std::vector<std::pair<double, double>> cleaned;
  cleaned.reserve(vertices->size());
  for (std::size_t index = 0; index < vertices->size(); ++index) {
    if (!cleaned.empty() && SamePoint(cleaned.back(), (*vertices)[index])) {
      continue;
    }
    cleaned.push_back((*vertices)[index]);
  }
  if (cleaned.size() >= 2 && SamePoint(cleaned.front(), cleaned.back())) {
    cleaned.pop_back();
  }
  vertices->swap(cleaned);
}

void EnsurePolygonOrientation(
  std::vector<std::pair<double, double>>* vertices,
  bool wantsCounterClockwise
) {
  if (!vertices || vertices->size() < 3) {
    return;
  }
  const double area = SignedPolygonArea(*vertices);
  if (std::fabs(area) <= 1e-9) {
    return;
  }
  const bool isCounterClockwise = area > 0.0;
  if (isCounterClockwise != wantsCounterClockwise) {
    std::reverse(vertices->begin(), vertices->end());
  }
}

std::size_t FindRightmostVertexIndex(const std::vector<std::pair<double, double>>& polygon) {
  std::size_t best = 0;
  for (std::size_t index = 1; index < polygon.size(); ++index) {
    if (polygon[index].first > polygon[best].first + 1e-9) {
      best = index;
      continue;
    }
    if (std::fabs(polygon[index].first - polygon[best].first) <= 1e-9 &&
        polygon[index].second < polygon[best].second) {
      best = index;
    }
  }
  return best;
}

bool SharesBridgeEndpoint(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& bridgeStart,
  const std::pair<double, double>& bridgeEnd
) {
  return
    SamePoint(a, bridgeStart) ||
    SamePoint(a, bridgeEnd) ||
    SamePoint(b, bridgeStart) ||
    SamePoint(b, bridgeEnd);
}

bool IsBridgeVisible(
  const std::vector<std::pair<double, double>>& outer,
  const std::vector<std::vector<std::pair<double, double>>>& holes,
  const std::pair<double, double>& holePoint,
  const std::pair<double, double>& outerPoint
) {
  if (SamePoint(holePoint, outerPoint)) {
    return false;
  }

  for (std::size_t index = 0; index < outer.size(); ++index) {
    const std::pair<double, double>& edgeA = outer[index];
    const std::pair<double, double>& edgeB = outer[(index + 1) % outer.size()];
    if (!SegmentsIntersect(holePoint, outerPoint, edgeA, edgeB)) {
      continue;
    }
    if (SharesBridgeEndpoint(edgeA, edgeB, holePoint, outerPoint)) {
      continue;
    }
    return false;
  }

  for (std::size_t holeIndex = 0; holeIndex < holes.size(); ++holeIndex) {
    const std::vector<std::pair<double, double>>& hole = holes[holeIndex];
    for (std::size_t index = 0; index < hole.size(); ++index) {
      const std::pair<double, double>& edgeA = hole[index];
      const std::pair<double, double>& edgeB = hole[(index + 1) % hole.size()];
      if (!SegmentsIntersect(holePoint, outerPoint, edgeA, edgeB)) {
        continue;
      }
      if (SharesBridgeEndpoint(edgeA, edgeB, holePoint, outerPoint)) {
        continue;
      }
      return false;
    }
  }

  const std::pair<double, double> midpoint = std::make_pair(
    (holePoint.first + outerPoint.first) * 0.5,
    (holePoint.second + outerPoint.second) * 0.5
  );
  if (!PointInPolygonEvenOdd(midpoint, outer)) {
    return false;
  }
  for (std::size_t index = 0; index < holes.size(); ++index) {
    if (PointInPolygonEvenOdd(midpoint, holes[index])) {
      return false;
    }
  }
  return true;
}

bool FindBridgeVertex(
  const std::vector<std::pair<double, double>>& outer,
  const std::vector<std::vector<std::pair<double, double>>>& holes,
  const std::vector<std::pair<double, double>>& hole,
  std::size_t holeVertexIndex,
  std::size_t* outOuterVertexIndex
) {
  if (!outOuterVertexIndex || outer.size() < 3 || hole.size() < 3 || holeVertexIndex >= hole.size()) {
    return false;
  }

  const std::pair<double, double> holePoint = hole[holeVertexIndex];
  bool found = false;
  double bestDistance2 = 0.0;
  std::size_t bestOuterIndex = 0;
  for (std::size_t outerIndex = 0; outerIndex < outer.size(); ++outerIndex) {
    const std::pair<double, double>& outerPoint = outer[outerIndex];
    if (!IsBridgeVisible(outer, holes, holePoint, outerPoint)) {
      continue;
    }
    const double dx = outerPoint.first - holePoint.first;
    const double dy = outerPoint.second - holePoint.second;
    const double distance2 = dx * dx + dy * dy;
    if (!found || distance2 < bestDistance2) {
      found = true;
      bestDistance2 = distance2;
      bestOuterIndex = outerIndex;
    }
  }

  if (!found) {
    return false;
  }
  *outOuterVertexIndex = bestOuterIndex;
  return true;
}

void MergeHoleIntoOuter(
  std::vector<std::pair<double, double>>* outer,
  const std::vector<std::pair<double, double>>& hole,
  std::size_t outerVertexIndex,
  std::size_t holeVertexIndex
) {
  if (!outer || outer->empty() || hole.empty()) {
    return;
  }
  std::vector<std::pair<double, double>> merged;
  merged.reserve(outer->size() + hole.size() + 3);

  for (std::size_t index = 0; index <= outerVertexIndex && index < outer->size(); ++index) {
    merged.push_back((*outer)[index]);
  }

  for (std::size_t step = 0; step < hole.size(); ++step) {
    const std::size_t holeIndex = (holeVertexIndex + step) % hole.size();
    merged.push_back(hole[holeIndex]);
  }

  // Close the bridge corridor explicitly: outer -> hole -> hole -> outer.
  // Without this second hole bridge vertex, the merged contour can self-cross.
  merged.push_back(hole[holeVertexIndex]);
  merged.push_back((*outer)[outerVertexIndex]);

  for (std::size_t index = outerVertexIndex + 1; index < outer->size(); ++index) {
    merged.push_back((*outer)[index]);
  }

  NormalizePolygonVertices(&merged);
  outer->swap(merged);
}

bool TriangulatePolygonWithHoles(
  const std::vector<std::pair<double, double>>& outerInput,
  const std::vector<std::vector<std::pair<double, double>>>& holesInput,
  std::vector<std::array<std::pair<double, double>, 3>>* outTriangles
) {
  if (!outTriangles) {
    return false;
  }

  std::vector<std::pair<double, double>> mergedOuter = outerInput;
  NormalizePolygonVertices(&mergedOuter);
  if (mergedOuter.size() < 3) {
    return false;
  }

  if (std::fabs(SignedPolygonArea(mergedOuter)) <= 1e-9) {
    return false;
  }
  EnsurePolygonOrientation(&mergedOuter, true);

  std::vector<std::vector<std::pair<double, double>>> holes;
  holes.reserve(holesInput.size());
  for (std::size_t index = 0; index < holesInput.size(); ++index) {
    std::vector<std::pair<double, double>> hole = holesInput[index];
    NormalizePolygonVertices(&hole);
    if (hole.size() < 3) {
      continue;
    }
    if (std::fabs(SignedPolygonArea(hole)) <= 1e-9) {
      continue;
    }
    EnsurePolygonOrientation(&hole, false);
    holes.push_back(hole);
  }

  // Bridge holes into the outer ring from rightmost holes first.
  std::sort(
    holes.begin(),
    holes.end(),
    [](const std::vector<std::pair<double, double>>& a, const std::vector<std::pair<double, double>>& b) {
      return a[FindRightmostVertexIndex(a)].first > b[FindRightmostVertexIndex(b)].first;
    }
  );

  for (std::size_t holeIndex = 0; holeIndex < holes.size(); ++holeIndex) {
    const std::size_t holeVertexIndex = FindRightmostVertexIndex(holes[holeIndex]);
    std::size_t outerVertexIndex = 0;
    if (!FindBridgeVertex(mergedOuter, holes, holes[holeIndex], holeVertexIndex, &outerVertexIndex)) {
      return false;
    }
    MergeHoleIntoOuter(&mergedOuter, holes[holeIndex], outerVertexIndex, holeVertexIndex);
  }

  NormalizePolygonVertices(&mergedOuter);
  if (mergedOuter.size() < 3) {
    return false;
  }
  return Triangulate(mergedOuter, outTriangles);
}

}  // namespace geometry
}  // namespace planning
}  // namespace bitmap
}  // namespace momentum

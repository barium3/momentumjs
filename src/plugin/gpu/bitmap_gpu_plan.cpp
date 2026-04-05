#include "bitmap_gpu_plan.h"

#include "../render/render_internal.h"
#include "../render/render_text.h"

#include <array>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <numeric>
#include <sstream>
#include <unordered_map>
#include <utility>

namespace momentum {

namespace {

constexpr std::size_t kMaxTextAtlasEntriesPerInstance = 512;
constexpr double kBasePathFlatnessTolerance = 0.24;
constexpr double kMinPathFlatnessTolerance = 0.08;
constexpr double kMaxPathFlatnessTolerance = 0.24;

enum BitmapFilterKind {
  BITMAP_FILTER_NONE = 0,
  BITMAP_FILTER_GRAY = 1,
  BITMAP_FILTER_INVERT = 2,
  BITMAP_FILTER_OPAQUE = 3,
  BITMAP_FILTER_THRESHOLD = 4,
  BITMAP_FILTER_POSTERIZE = 5,
  BITMAP_FILTER_BLUR = 6,
  BITMAP_FILTER_ERODE = 7,
  BITMAP_FILTER_DILATE = 8,
};

struct CachedTextAtlasEntry {
  bool hasFillAsset = false;
  RuntimeImageAsset fillAsset;
  std::vector<GlyphAtlasQuad> fillQuads;
  bool hasStrokeAsset = false;
  RuntimeImageAsset strokeAsset;
  std::vector<GlyphAtlasQuad> strokeQuads;
  std::uint64_t lastUseTick = 0;
};

struct AnalyticClipState {
  bool enabled = false;
  std::uint32_t contourStart = 0;
  std::uint32_t contourCount = 0;
  float minX = 0.0f;
  float minY = 0.0f;
  float maxX = 0.0f;
  float maxY = 0.0f;
};

std::mutex gTextAtlasCacheMutex;
std::unordered_map<
  std::uint64_t,
  std::unordered_map<std::uint64_t, std::shared_ptr<CachedTextAtlasEntry>>
> gTextAtlasCacheByInstance;
std::unordered_map<std::uint64_t, int> gTextAtlasNextImageIdByInstance;
std::atomic<std::uint64_t> gTextAtlasUseTick{1};

std::uint64_t HashBytes(const void* data, std::size_t size) {
  const unsigned char* bytes = static_cast<const unsigned char*>(data);
  std::uint64_t hash = 1469598103934665603ull;
  for (std::size_t index = 0; index < size; index += 1) {
    hash ^= static_cast<std::uint64_t>(bytes[index]);
    hash *= 1099511628211ull;
  }
  return hash;
}

std::uint64_t HashCombine(std::uint64_t seed, std::uint64_t value) {
  seed ^= value + 0x9e3779b97f4a7c15ull + (seed << 6) + (seed >> 2);
  return seed;
}

std::uint64_t HashStringValue(const std::string& value) {
  return HashBytes(value.data(), value.size());
}

std::uint64_t HashBoolValue(bool value) {
  return value ? 0xf00dcafeull : 0x0badf00dull;
}

std::uint64_t HashInt64Value(std::int64_t value) {
  return HashBytes(&value, sizeof(value));
}

std::uint64_t HashDoubleValue(double value) {
  std::uint64_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  return HashBytes(&bits, sizeof(bits));
}

std::uint64_t HashScalarSpecValue(const ScalarSpec& spec) {
  std::uint64_t hash = 1469598103934665603ull;
  hash = HashCombine(hash, HashStringValue(spec.mode));
  hash = HashCombine(hash, HashDoubleValue(spec.value));
  return hash;
}

std::uint64_t HashTransformValue(const Transform2D& transform) {
  std::uint64_t hash = 1469598103934665603ull;
  hash = HashCombine(hash, HashDoubleValue(transform.a));
  hash = HashCombine(hash, HashDoubleValue(transform.b));
  hash = HashCombine(hash, HashDoubleValue(transform.c));
  hash = HashCombine(hash, HashDoubleValue(transform.d));
  hash = HashCombine(hash, HashDoubleValue(transform.tx));
  hash = HashCombine(hash, HashDoubleValue(transform.ty));
  return hash;
}

std::uint64_t HashTextAtlasCommandKey(const SceneCommand& command) {
  std::uint64_t hash = 1469598103934665603ull;
  hash = HashCombine(hash, HashStringValue(command.text));
  hash = HashCombine(hash, HashStringValue(command.fontName));
  hash = HashCombine(hash, HashStringValue(command.fontPath));
  hash = HashCombine(hash, HashStringValue(command.fontSourceKind));
  hash = HashCombine(hash, HashStringValue(command.textStyle));
  hash = HashCombine(hash, HashStringValue(command.textWrap));
  hash = HashCombine(hash, HashScalarSpecValue(command.x));
  hash = HashCombine(hash, HashScalarSpecValue(command.y));
  hash = HashCombine(hash, HashScalarSpecValue(command.width));
  hash = HashCombine(hash, HashScalarSpecValue(command.height));
  hash = HashCombine(hash, HashBoolValue(command.textHasWidth));
  hash = HashCombine(hash, HashBoolValue(command.textHasHeight));
  hash = HashCombine(hash, HashDoubleValue(command.textSize));
  hash = HashCombine(hash, HashDoubleValue(command.textLeading));
  hash = HashCombine(hash, HashInt64Value(command.textAlignH));
  hash = HashCombine(hash, HashInt64Value(command.textAlignV));
  hash = HashCombine(hash, HashBoolValue(command.hasFill));
  hash = HashCombine(hash, HashBoolValue(command.hasStroke));
  hash = HashCombine(hash, HashDoubleValue(command.strokeWeight));
  hash = HashCombine(hash, HashTransformValue(command.transform));
  return hash;
}

struct FlattenedPathSubpath {
  std::vector<std::pair<double, double>> vertices;
  bool closed = false;
  bool isContour = false;
};

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

FlattenedPathSubpath FlattenPathSubpath(
  PF_LayerDef* output,
  const Transform2D& transform,
  const PathSubpath& source
) {
  FlattenedPathSubpath flattened;
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

bool IsSamePoint(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  double epsilon = 1e-6
) {
  return IsNearlyEqual(a.first, b.first, epsilon) && IsNearlyEqual(a.second, b.second, epsilon);
}

void NormalizeFlattenedVertices(FlattenedPathSubpath* subpath) {
  if (!subpath) {
    return;
  }

  std::vector<std::pair<double, double>> cleaned;
  cleaned.reserve(subpath->vertices.size());
  for (std::size_t index = 0; index < subpath->vertices.size(); ++index) {
    if (!cleaned.empty() && IsSamePoint(cleaned.back(), subpath->vertices[index])) {
      continue;
    }
    cleaned.push_back(subpath->vertices[index]);
  }

  if (cleaned.size() >= 2 && IsSamePoint(cleaned.front(), cleaned.back())) {
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

bool TriangulateSimplePolygon(
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

std::pair<double, double> AddScaledPoint(
  const std::pair<double, double>& point,
  const std::pair<double, double>& direction,
  double scale
) {
  return std::make_pair(
    point.first + direction.first * scale,
    point.second + direction.second * scale
  );
}

std::pair<double, double> SubtractPoint(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b
) {
  return std::make_pair(a.first - b.first, a.second - b.second);
}

std::pair<double, double> NormalizePoint(const std::pair<double, double>& value) {
  const double length = std::sqrt(value.first * value.first + value.second * value.second);
  if (length <= 1e-9) {
    return std::make_pair(0.0, 0.0);
  }
  return std::make_pair(value.first / length, value.second / length);
}

bool IntersectLines(
  const std::pair<double, double>& p0,
  const std::pair<double, double>& d0,
  const std::pair<double, double>& p1,
  const std::pair<double, double>& d1,
  std::pair<double, double>* outPoint
) {
  if (!outPoint) {
    return false;
  }
  const double denominator = d0.first * d1.second - d0.second * d1.first;
  if (std::fabs(denominator) <= 1e-9) {
    return false;
  }
  const std::pair<double, double> delta = SubtractPoint(p1, p0);
  const double t = (delta.first * d1.second - delta.second * d1.first) / denominator;
  *outPoint = std::make_pair(
    p0.first + d0.first * t,
    p0.second + d0.second * t
  );
  return true;
}

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

void AppendFillTriangle(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c,
  const PF_Pixel& color,
  GpuRenderPlan* plan
);

double NormalizeAngleDeltaLocal(double delta, bool positive) {
  if (positive) {
    while (delta <= 0.0) {
      delta += kPi * 2.0;
    }
  } else {
    while (delta >= 0.0) {
      delta -= kPi * 2.0;
    }
  }
  return delta;
}

void AppendArcFan(
  const std::pair<double, double>& center,
  double radius,
  double startAngle,
  double deltaAngle,
  const PF_Pixel& color,
  GpuRenderPlan* plan
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
    AppendFillTriangle(center, previousPoint, nextPoint, color, plan);
    previousPoint = nextPoint;
  }
}

void AppendStrokeJoinTriangles(
  const std::pair<double, double>& previous,
  const std::pair<double, double>& current,
  const std::pair<double, double>& next,
  double halfWidth,
  int strokeJoin,
  const PF_Pixel& color,
  GpuRenderPlan* plan
) {
  if (!plan || halfWidth <= 1e-9) {
    return;
  }

  int joinMode = strokeJoin;
  if (joinMode != STROKE_JOIN_MITER && joinMode != STROKE_JOIN_BEVEL && joinMode != STROKE_JOIN_ROUND) {
    joinMode = STROKE_JOIN_MITER;
  }

  const std::pair<double, double> uPrev = NormalizePoint(SubtractPoint(current, previous));
  const std::pair<double, double> uNext = NormalizePoint(SubtractPoint(next, current));
  if ((std::fabs(uPrev.first) <= 1e-9 && std::fabs(uPrev.second) <= 1e-9) ||
      (std::fabs(uNext.first) <= 1e-9 && std::fabs(uNext.second) <= 1e-9)) {
    return;
  }

  const double cross = uPrev.first * uNext.second - uPrev.second * uNext.first;
  if (std::fabs(cross) <= 1e-9) {
    return;
  }

  const double side = cross > 0.0 ? -1.0 : 1.0;
  const std::pair<double, double> nPrev = std::make_pair(-uPrev.second * side, uPrev.first * side);
  const std::pair<double, double> nNext = std::make_pair(-uNext.second * side, uNext.first * side);
  const std::pair<double, double> outerPrev = AddScaledPoint(current, nPrev, halfWidth);
  const std::pair<double, double> outerNext = AddScaledPoint(current, nNext, halfWidth);
  const std::pair<double, double> innerPrev = AddScaledPoint(current, nPrev, -halfWidth);
  const std::pair<double, double> innerNext = AddScaledPoint(current, nNext, -halfWidth);

  AppendFillTriangle(current, innerPrev, innerNext, color, plan);

  if (joinMode == STROKE_JOIN_ROUND) {
    const double startAngle = std::atan2(nPrev.second, nPrev.first);
    const double endAngle = std::atan2(nNext.second, nNext.first);
    double delta = endAngle - startAngle;
    while (delta <= -kPi) {
      delta += kPi * 2.0;
    }
    while (delta > kPi) {
      delta -= kPi * 2.0;
    }
    AppendArcFan(current, halfWidth, startAngle, delta, color, plan);
    return;
  }

  AppendFillTriangle(current, outerPrev, outerNext, color, plan);

  if (joinMode == STROKE_JOIN_MITER) {
    std::pair<double, double> intersection;
    if (IntersectLines(outerPrev, uPrev, outerNext, uNext, &intersection)) {
      const std::pair<double, double> miterDelta = SubtractPoint(intersection, current);
      const double miterLength = std::sqrt(
        miterDelta.first * miterDelta.first + miterDelta.second * miterDelta.second
      );
      const double miterLimit = halfWidth * 10.0;
      if (miterLength <= miterLimit) {
        AppendFillTriangle(outerPrev, intersection, outerNext, color, plan);
      }
    }
  }
}

void AppendStrokeBodyTriangles(
  const std::pair<double, double>& start,
  const std::pair<double, double>& end,
  double halfWidth,
  double startExtension,
  double endExtension,
  const PF_Pixel& color,
  GpuRenderPlan* plan
) {
  if (!plan || halfWidth <= 1e-9) {
    return;
  }
  const std::pair<double, double> delta = SubtractPoint(end, start);
  const std::pair<double, double> unitDirection = NormalizePoint(delta);
  if (std::fabs(unitDirection.first) <= 1e-9 && std::fabs(unitDirection.second) <= 1e-9) {
    return;
  }
  const std::pair<double, double> normal = std::make_pair(-unitDirection.second, unitDirection.first);
  const std::pair<double, double> extendedStart = AddScaledPoint(start, unitDirection, -startExtension);
  const std::pair<double, double> extendedEnd = AddScaledPoint(end, unitDirection, endExtension);
  const std::pair<double, double> a = AddScaledPoint(extendedStart, normal, halfWidth);
  const std::pair<double, double> b = AddScaledPoint(extendedStart, normal, -halfWidth);
  const std::pair<double, double> c = AddScaledPoint(extendedEnd, normal, halfWidth);
  const std::pair<double, double> d = AddScaledPoint(extendedEnd, normal, -halfWidth);
  AppendFillTriangle(a, b, c, color, plan);
  AppendFillTriangle(c, b, d, color, plan);
}

void AppendStrokeCapTriangles(
  const std::pair<double, double>& point,
  const std::pair<double, double>& direction,
  double halfWidth,
  int strokeCap,
  bool isStartCap,
  const PF_Pixel& color,
  GpuRenderPlan* plan
) {
  if (!plan || halfWidth <= 1e-9) {
    return;
  }

  int capMode = strokeCap;
  if (capMode != STROKE_CAP_SQUARE && capMode != STROKE_CAP_ROUND && capMode != STROKE_CAP_PROJECT) {
    capMode = STROKE_CAP_ROUND;
  }
  if (capMode == STROKE_CAP_SQUARE) {
    return;
  }

  const std::pair<double, double> unitDirection = NormalizePoint(direction);
  if (std::fabs(unitDirection.first) <= 1e-9 && std::fabs(unitDirection.second) <= 1e-9) {
    return;
  }
  const std::pair<double, double> normal = std::make_pair(-unitDirection.second, unitDirection.first);

  if (capMode == STROKE_CAP_PROJECT) {
    const double extension = isStartCap ? -halfWidth : halfWidth;
    const std::pair<double, double> extended = AddScaledPoint(point, unitDirection, extension);
    const std::pair<double, double> a = AddScaledPoint(extended, normal, halfWidth);
    const std::pair<double, double> b = AddScaledPoint(extended, normal, -halfWidth);
    const std::pair<double, double> c = AddScaledPoint(point, normal, halfWidth);
    const std::pair<double, double> d = AddScaledPoint(point, normal, -halfWidth);
    AppendFillTriangle(a, b, c, color, plan);
    AppendFillTriangle(c, b, d, color, plan);
    return;
  }

  const double startAngle = isStartCap
    ? std::atan2(-normal.second, -normal.first)
    : std::atan2(normal.second, normal.first);
  AppendArcFan(point, halfWidth, startAngle, -kPi, color, plan);
}

void AppendFillTriangle(
  const std::pair<double, double>& a,
  const std::pair<double, double>& b,
  const std::pair<double, double>& c,
  const PF_Pixel& color,
  GpuRenderPlan* plan
) {
  if (!plan) {
    return;
  }
  if (std::fabs(CrossProduct(a, b, c)) <= 1e-9) {
    return;
  }
  GpuRenderPlan::FillTriangle triangle;
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
  GpuRenderPlan* plan
) {
  if (!plan) {
    return;
  }
  if (IsSamePoint(a, b)) {
    return;
  }
  GpuRenderPlan::BoundaryEdge edge;
  edge.x1 = static_cast<float>(a.first);
  edge.y1 = static_cast<float>(a.second);
  edge.x2 = static_cast<float>(b.first);
  edge.y2 = static_cast<float>(b.second);
  plan->boundaryEdges.push_back(edge);
}

void AppendBoundaryLoopEdges(
  const std::vector<std::pair<double, double>>& loop,
  GpuRenderPlan* plan
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
  GpuRenderPlan* plan
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
  GpuRenderPlan* plan
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

void AppendPolylineStrokeBoundary(
  const std::vector<std::pair<double, double>>& vertices,
  bool closed,
  double halfWidth,
  int strokeCap,
  int strokeJoin,
  GpuRenderPlan* plan
) {
  if (!plan || vertices.size() < 2 || halfWidth <= 1e-9) {
    return;
  }
  if (closed) {
    const ClosedStrokeRing ring = BuildClosedStrokeRing(vertices, halfWidth, strokeJoin);
    AppendBoundaryLoopEdges(ring.outer, plan);
    AppendBoundaryLoopEdges(ring.inner, plan);
    return;
  }
  const std::vector<std::pair<double, double>> outline =
    BuildOpenStrokeOutline(vertices, halfWidth, strokeCap, strokeJoin);
  AppendBoundaryLoopEdges(outline, plan);
}

void AppendPointStrokeGeometry(
  const std::pair<double, double>& point,
  double halfWidth,
  int strokeCap,
  const PF_Pixel& color,
  GpuRenderPlan* plan
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
  AppendFillTriangle(topLeft, topRight, bottomRight, color, plan);
  AppendFillTriangle(topLeft, bottomRight, bottomLeft, color, plan);
}

void AppendPolylineStrokeGeometry(
  const std::vector<std::pair<double, double>>& vertices,
  bool closed,
  double halfWidth,
  int strokeCap,
  int strokeJoin,
  const PF_Pixel& color,
  GpuRenderPlan* plan
) {
  if (!plan || vertices.empty() || halfWidth <= 1e-9) {
    return;
  }
  if (vertices.size() == 1) {
    AppendPointStrokeGeometry(vertices.front(), halfWidth, strokeCap, color, plan);
    AppendPointStrokeBoundary(vertices.front(), halfWidth, strokeCap, plan);
    return;
  }

  if (closed) {
    const ClosedStrokeRing ring = BuildClosedStrokeRing(vertices, halfWidth, strokeJoin);
    std::vector<std::array<std::pair<double, double>, 3>> triangles;
    const std::vector<std::vector<std::pair<double, double>>> holes = {ring.inner};
    if (TriangulatePolygonWithHoles(ring.outer, holes, &triangles)) {
      for (std::size_t index = 0; index < triangles.size(); ++index) {
        AppendFillTriangle(triangles[index][0], triangles[index][1], triangles[index][2], color, plan);
      }
    }
    AppendBoundaryLoopEdges(ring.outer, plan);
    AppendBoundaryLoopEdges(ring.inner, plan);
    return;
  }

  std::vector<std::pair<double, double>> outline =
    BuildOpenStrokeOutline(vertices, halfWidth, strokeCap, strokeJoin);
  NormalizePolygonVertices(&outline);
  EnsurePolygonOrientation(&outline, true);
  std::vector<std::array<std::pair<double, double>, 3>> triangles;
  if (TriangulateSimplePolygon(outline, &triangles)) {
    for (std::size_t index = 0; index < triangles.size(); ++index) {
      AppendFillTriangle(triangles[index][0], triangles[index][1], triangles[index][2], color, plan);
    }
  }
  AppendBoundaryLoopEdges(outline, plan);
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
    if (!cleaned.empty() && IsSamePoint(cleaned.back(), (*vertices)[index])) {
      continue;
    }
    cleaned.push_back((*vertices)[index]);
  }
  if (cleaned.size() >= 2 && IsSamePoint(cleaned.front(), cleaned.back())) {
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
    IsSamePoint(a, bridgeStart) ||
    IsSamePoint(a, bridgeEnd) ||
    IsSamePoint(b, bridgeStart) ||
    IsSamePoint(b, bridgeEnd);
}

bool IsBridgeVisible(
  const std::vector<std::pair<double, double>>& outer,
  const std::vector<std::vector<std::pair<double, double>>>& holes,
  const std::pair<double, double>& holePoint,
  const std::pair<double, double>& outerPoint
) {
  if (IsSamePoint(holePoint, outerPoint)) {
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
  return TriangulateSimplePolygon(mergedOuter, outTriangles);
}

std::string BuildUnsupportedReason(
  const SceneCommand& command,
  const std::string& commandClass,
  const std::string& detail
) {
  std::ostringstream stream;
  stream
    << "GPU bitmap v2 does not support this command yet (class=" << commandClass
    << ", type=" << command.type << "): " << detail;
  return stream.str();
}

bool IsIgnorableCommand(const SceneCommand& command) {
  return command.type == "push_state" || command.type == "pop_state";
}

bool IsIdentityTransformValue(const Transform2D& transform) {
  return
    std::fabs(transform.a - 1.0) <= 1e-6 &&
    std::fabs(transform.b) <= 1e-6 &&
    std::fabs(transform.c) <= 1e-6 &&
    std::fabs(transform.d - 1.0) <= 1e-6 &&
    std::fabs(transform.tx) <= 1e-6 &&
    std::fabs(transform.ty) <= 1e-6;
}

bool IsClipCommand(const SceneCommand& command) {
  return
    command.type == "clip_begin" ||
    command.type == "clip_end" ||
    command.clipPath;
}

int ParseBitmapFilterKind(const std::string& kind) {
  if (kind == "GRAY") {
    return BITMAP_FILTER_GRAY;
  }
  if (kind == "INVERT") {
    return BITMAP_FILTER_INVERT;
  }
  if (kind == "OPAQUE") {
    return BITMAP_FILTER_OPAQUE;
  }
  if (kind == "THRESHOLD") {
    return BITMAP_FILTER_THRESHOLD;
  }
  if (kind == "POSTERIZE") {
    return BITMAP_FILTER_POSTERIZE;
  }
  if (kind == "BLUR") {
    return BITMAP_FILTER_BLUR;
  }
  if (kind == "ERODE") {
    return BITMAP_FILTER_ERODE;
  }
  if (kind == "DILATE") {
    return BITMAP_FILTER_DILATE;
  }
  return BITMAP_FILTER_NONE;
}

int AllocateTextAtlasImageIdLocked(std::uint64_t cacheKey);

int ReserveTransientImageId(std::uint64_t cacheKey) {
  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  return AllocateTextAtlasImageIdLocked(cacheKey);
}

void AppendFillBatch(
  std::size_t start,
  std::size_t end,
  std::size_t explicitEdgeStart,
  std::size_t explicitEdgeEnd,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = GpuRenderPlan::DRAW_BATCH_FILLS;
  batch.start = start;
  batch.count = end - start;
  batch.explicitEdgeStart = explicitEdgeStart;
  batch.explicitEdgeCount = explicitEdgeEnd > explicitEdgeStart ? (explicitEdgeEnd - explicitEdgeStart) : 0;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendPathFillBatch(
  std::size_t start,
  std::size_t end,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = GpuRenderPlan::DRAW_BATCH_PATH_FILLS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendStrokeBatch(
  std::size_t start,
  std::size_t end,
  std::size_t edgeStart,
  std::size_t edgeEnd,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = GpuRenderPlan::DRAW_BATCH_STROKES;
  batch.start = start;
  batch.count = end - start;
  batch.explicitEdgeStart = edgeStart;
  batch.explicitEdgeCount = edgeEnd > edgeStart ? (edgeEnd - edgeStart) : 0;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void MoveRecentStrokeGeometryToDedicatedBuffers(
  std::size_t triangleStart,
  std::size_t edgeStart,
  GpuRenderPlan* plan,
  std::size_t* outStrokeTriangleStart,
  std::size_t* outStrokeEdgeStart
) {
  if (outStrokeTriangleStart) {
    *outStrokeTriangleStart = 0;
  }
  if (outStrokeEdgeStart) {
    *outStrokeEdgeStart = 0;
  }
  if (!plan) {
    return;
  }
  if (triangleStart > plan->fillTriangles.size() || edgeStart > plan->boundaryEdges.size()) {
    return;
  }
  if (outStrokeTriangleStart) {
    *outStrokeTriangleStart = plan->strokeTriangles.size();
  }
  if (outStrokeEdgeStart) {
    *outStrokeEdgeStart = plan->strokeBoundaryEdges.size();
  }
  if (triangleStart < plan->fillTriangles.size()) {
    plan->strokeTriangles.insert(
      plan->strokeTriangles.end(),
      plan->fillTriangles.begin() + static_cast<std::ptrdiff_t>(triangleStart),
      plan->fillTriangles.end()
    );
    plan->fillTriangles.resize(triangleStart);
  }
  if (edgeStart < plan->boundaryEdges.size()) {
    plan->strokeBoundaryEdges.insert(
      plan->strokeBoundaryEdges.end(),
      plan->boundaryEdges.begin() + static_cast<std::ptrdiff_t>(edgeStart),
      plan->boundaryEdges.end()
    );
    plan->boundaryEdges.resize(edgeStart);
  }
}

void AppendImageBatch(
  GpuRenderPlan::DrawBatchType batchType,
  std::size_t start,
  std::size_t end,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = batchType;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendFilterBatch(
  std::size_t start,
  std::size_t end,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = GpuRenderPlan::DRAW_BATCH_FILTERS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = BLEND_MODE_REPLACE;
  batch.erase = false;
  batch.eraseStrength = 1.0f;
  batch.clipImageId = 0;
  plan->drawBatches.push_back(batch);
}

void AppendMaskBatch(
  std::size_t start,
  std::size_t end,
  GpuRenderPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  GpuRenderPlan::DrawBatch batch;
  batch.type = GpuRenderPlan::DRAW_BATCH_MASKS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = BLEND_MODE_REPLACE;
  batch.erase = false;
  batch.eraseStrength = 1.0f;
  batch.clipImageId = 0;
  plan->drawBatches.push_back(batch);
}

int AllocateTextAtlasImageIdLocked(std::uint64_t cacheKey) {
  int& nextId = gTextAtlasNextImageIdByInstance[cacheKey];
  if (nextId <= 0) {
    nextId = std::numeric_limits<int>::max();
  }
  while (nextId == 0) {
    nextId -= 1;
  }
  const int allocatedId = nextId;
  if (nextId > 1) {
    nextId -= 1;
  }
  return allocatedId;
}

std::uint64_t HashAlphaMask(const std::vector<unsigned char>& alpha, int width, int height) {
  std::uint64_t hash = 1469598103934665603ull;
  const std::uint64_t prime = 1099511628211ull;
  auto hashByte = [&](unsigned char value) {
    hash ^= static_cast<std::uint64_t>(value);
    hash *= prime;
  };

  for (int shift = 0; shift < 4; shift += 1) {
    hashByte(static_cast<unsigned char>((width >> (shift * 8)) & 0xFF));
    hashByte(static_cast<unsigned char>((height >> (shift * 8)) & 0xFF));
  }

  for (std::size_t index = 0; index < alpha.size(); index += 1) {
    hashByte(alpha[index]);
  }
  return hash == 0 ? 1ull : hash;
}

bool IsDrawableCommandType(const SceneCommand& command) {
  return
    command.type == "point" ||
    command.type == "line" ||
    command.type == "path" ||
    command.type == "image" ||
    command.type == "text";
}

SceneCommand NormalizeClipMaskCommand(const SceneCommand& source) {
  SceneCommand command = source;
  command.clipPath = false;
  command.clipInvert = false;
  command.blendMode = BLEND_MODE_BLEND;
  command.eraseFill = false;
  command.eraseStroke = false;
  command.eraseFillStrength = 1.0;
  command.eraseStrokeStrength = 1.0;
  return command;
}

SceneCommand NormalizeClipSceneCommand(const SceneCommand& source) {
  SceneCommand command = NormalizeClipMaskCommand(source);
  if (command.hasFill) {
    command.fill.red = 255;
    command.fill.green = 255;
    command.fill.blue = 255;
  }
  if (command.hasStroke) {
    command.stroke.red = 255;
    command.stroke.green = 255;
    command.stroke.blue = 255;
  }
  return command;
}

bool BuildClipSceneAssetFromCommands(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  const ScenePayload& parentScene,
  const std::vector<SceneCommand>& commands,
  RuntimeImageAsset* outAsset
) {
  if (!output || !outAsset || output->width <= 0 || output->height <= 0) {
    return false;
  }

  ScenePayload clipScene;
  clipScene.canvasWidth = static_cast<double>(output->width);
  clipScene.canvasHeight = static_cast<double>(output->height);
  clipScene.clearsSurface = true;
  clipScene.hasBackground = false;
  clipScene.imageAssets = parentScene.imageAssets;
  clipScene.commands.reserve(commands.size());
  for (std::size_t index = 0; index < commands.size(); ++index) {
    clipScene.commands.push_back(NormalizeClipSceneCommand(commands[index]));
  }

  RuntimeImageAsset clipAsset;
  clipAsset.id = ReserveTransientImageId(cacheKey);
  clipAsset.source = "gpu_clip_scene";
  clipAsset.width = output->width;
  clipAsset.height = output->height;
  clipAsset.pixelDensity = 1.0;
  clipAsset.version = static_cast<std::uint64_t>(clipAsset.id);
  clipAsset.loaded = true;
  clipAsset.gpuSceneBacked = true;
  clipAsset.gpuScene = std::make_shared<ScenePayload>(std::move(clipScene));
  *outAsset = std::move(clipAsset);
  return true;
}

bool MaterializeClipAlphaFromAsset(
  const RuntimeImageAsset& asset,
  std::vector<unsigned char>* outAlpha
) {
  if (!outAlpha || asset.width <= 0 || asset.height <= 0) {
    return false;
  }
  if (!asset.gpuSceneBacked || !asset.gpuScene) {
    if (asset.pixels.empty()) {
      return false;
    }
    outAlpha->resize(asset.pixels.size());
    for (std::size_t index = 0; index < asset.pixels.size(); ++index) {
      (*outAlpha)[index] = asset.pixels[index].alpha;
    }
    return true;
  }

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(asset.width * asset.height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, asset.width, asset.height, *asset.gpuScene);
  outAlpha->resize(raster.size(), 0);
  for (std::size_t index = 0; index < raster.size(); ++index) {
    (*outAlpha)[index] = raster[index].alpha;
  }
  return true;
}

bool BuildAnalyticClipStateFromCommands(
  PF_LayerDef* output,
  const std::vector<SceneCommand>& commands,
  GpuRenderPlan* plan,
  AnalyticClipState* outState
) {
  if (!output || !plan || !outState) {
    return false;
  }

  AnalyticClipState state;
  state.enabled = true;
  state.contourStart = static_cast<std::uint32_t>(plan->pathFillContours.size());
  state.minX = std::numeric_limits<float>::infinity();
  state.minY = std::numeric_limits<float>::infinity();
  state.maxX = -std::numeric_limits<float>::infinity();
  state.maxY = -std::numeric_limits<float>::infinity();

  auto appendContour = [&](const std::vector<std::pair<double, double>>& source) -> bool {
    if (source.size() < 3) {
      return false;
    }
    std::vector<std::pair<double, double>> contour = source;
    if (contour.size() >= 2) {
      const auto& first = contour.front();
      const auto& last = contour.back();
      if (std::fabs(first.first - last.first) <= 1e-6 &&
          std::fabs(first.second - last.second) <= 1e-6) {
        contour.pop_back();
      }
    }
    if (contour.size() < 3) {
      return false;
    }
    GpuRenderPlan::PathFillContour contourMeta;
    contourMeta.vertexStart = static_cast<std::uint32_t>(plan->pathFillVertices.size());
    contourMeta.vertexCount = static_cast<std::uint32_t>(contour.size());
    for (const auto& point : contour) {
      GpuRenderPlan::PathFillVertex vertex;
      vertex.x = static_cast<float>(point.first);
      vertex.y = static_cast<float>(point.second);
      plan->pathFillVertices.push_back(vertex);
      state.minX = std::min(state.minX, vertex.x);
      state.minY = std::min(state.minY, vertex.y);
      state.maxX = std::max(state.maxX, vertex.x);
      state.maxY = std::max(state.maxY, vertex.y);
    }
    plan->pathFillContours.push_back(contourMeta);
    state.contourCount += 1;
    return true;
  };

  for (const SceneCommand& command : commands) {
    if (command.type != "path") {
      return false;
    }

    std::vector<FlattenedPathSubpath> flattenedSubpaths;
    flattenedSubpaths.reserve(command.path.subpaths.size());
    for (const PathSubpath& subpath : command.path.subpaths) {
      FlattenedPathSubpath flattened = FlattenPathSubpath(output, command.transform, subpath);
      NormalizeFlattenedVertices(&flattened);
      if (!flattened.vertices.empty()) {
        flattenedSubpaths.push_back(std::move(flattened));
      }
    }

    for (FlattenedPathSubpath& flattened : flattenedSubpaths) {
      if (flattened.vertices.size() < 3) {
        continue;
      }
      if (!flattened.closed) {
        const auto& first = flattened.vertices.front();
        const auto& last = flattened.vertices.back();
        const bool alreadyClosed =
          std::fabs(first.first - last.first) <= 1e-6 &&
          std::fabs(first.second - last.second) <= 1e-6;
        if (!alreadyClosed) {
          flattened.vertices.push_back(first);
        }
        flattened.closed = true;
      }
      appendContour(flattened.vertices);
    }
  }

  if (state.contourCount == 0 ||
      !std::isfinite(state.minX) ||
      !std::isfinite(state.minY) ||
      !std::isfinite(state.maxX) ||
      !std::isfinite(state.maxY)) {
    return false;
  }

  *outState = state;
  return true;
}

bool BuildClipMaskAlphaFromCommands(
  PF_LayerDef* output,
  const std::vector<SceneCommand>& commands,
  std::vector<unsigned char>* outAlpha
) {
  if (!output || !outAlpha || output->width <= 0 || output->height <= 0) {
    return false;
  }

  ScenePayload clipScene;
  clipScene.canvasWidth = static_cast<double>(output->width);
  clipScene.canvasHeight = static_cast<double>(output->height);
  clipScene.clearsSurface = true;
  clipScene.hasBackground = false;
  clipScene.commands.reserve(commands.size());
  for (std::size_t index = 0; index < commands.size(); ++index) {
    clipScene.commands.push_back(NormalizeClipMaskCommand(commands[index]));
  }

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(output->width * output->height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, output->width, output->height, clipScene);
  outAlpha->resize(raster.size(), 0);
  for (std::size_t index = 0; index < raster.size(); ++index) {
    (*outAlpha)[index] = raster[index].alpha;
  }
  return true;
}

void IntersectClipMask(
  std::vector<unsigned char>* currentMask,
  const std::vector<unsigned char>& clipMask,
  bool invert
) {
  if (!currentMask) {
    return;
  }
  if (currentMask->empty()) {
    *currentMask = clipMask;
    if (invert) {
      for (std::size_t index = 0; index < currentMask->size(); ++index) {
        (*currentMask)[index] = static_cast<unsigned char>(255 - (*currentMask)[index]);
      }
    }
    return;
  }
  const std::size_t count = std::min(currentMask->size(), clipMask.size());
  for (std::size_t index = 0; index < count; ++index) {
    const int current = static_cast<int>((*currentMask)[index]);
    const int incoming = invert
      ? (255 - static_cast<int>(clipMask[index]))
      : static_cast<int>(clipMask[index]);
    const int blended = static_cast<int>((current * incoming + 127) / 255);
    (*currentMask)[index] = static_cast<unsigned char>(std::max(0, std::min(255, blended)));
  }
}

std::uint64_t NextTextAtlasUseTick() {
  return gTextAtlasUseTick.fetch_add(1, std::memory_order_relaxed);
}

void TouchTextAtlasEntryLocked(const std::shared_ptr<CachedTextAtlasEntry>& entry) {
  if (!entry) {
    return;
  }
  entry->lastUseTick = NextTextAtlasUseTick();
}

void PruneTextAtlasCacheLocked(std::uint64_t cacheKey) {
  auto cacheIt = gTextAtlasCacheByInstance.find(cacheKey);
  if (cacheIt == gTextAtlasCacheByInstance.end()) {
    return;
  }
  auto& entries = cacheIt->second;
  while (entries.size() > kMaxTextAtlasEntriesPerInstance) {
    auto oldestIt = entries.end();
    std::uint64_t oldestTick = std::numeric_limits<std::uint64_t>::max();
    for (auto it = entries.begin(); it != entries.end(); ++it) {
      const std::uint64_t tick = it->second ? it->second->lastUseTick : 0;
      if (tick < oldestTick) {
        oldestTick = tick;
        oldestIt = it;
      }
    }
    if (oldestIt == entries.end()) {
      break;
    }
    entries.erase(oldestIt);
  }

  if (entries.empty()) {
    gTextAtlasCacheByInstance.erase(cacheIt);
    gTextAtlasNextImageIdByInstance.erase(cacheKey);
  }
}

std::shared_ptr<CachedTextAtlasEntry> LookupCachedTextAtlasEntry(
  std::uint64_t cacheKey,
  std::uint64_t textKey
) {
  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  const auto instanceIt = gTextAtlasCacheByInstance.find(cacheKey);
  if (instanceIt == gTextAtlasCacheByInstance.end()) {
    return nullptr;
  }
  const auto entryIt = instanceIt->second.find(textKey);
  if (entryIt == instanceIt->second.end() || !entryIt->second) {
    return nullptr;
  }
  TouchTextAtlasEntryLocked(entryIt->second);
  return entryIt->second;
}

void ReserveTextAtlasImageIds(
  std::uint64_t cacheKey,
  bool needFill,
  bool needStroke,
  int* outFillId,
  int* outStrokeId
) {
  if (outFillId) {
    *outFillId = 0;
  }
  if (outStrokeId) {
    *outStrokeId = 0;
  }
  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  if (needFill && outFillId) {
    *outFillId = AllocateTextAtlasImageIdLocked(cacheKey);
  }
  if (needStroke && outStrokeId) {
    *outStrokeId = AllocateTextAtlasImageIdLocked(cacheKey);
  }
}

std::shared_ptr<CachedTextAtlasEntry> StoreCachedTextAtlasEntry(
  std::uint64_t cacheKey,
  std::uint64_t textKey,
  std::shared_ptr<CachedTextAtlasEntry> entry
) {
  if (!entry) {
    return nullptr;
  }

  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  auto& entries = gTextAtlasCacheByInstance[cacheKey];
  auto existingIt = entries.find(textKey);
  if (existingIt != entries.end() && existingIt->second) {
    TouchTextAtlasEntryLocked(existingIt->second);
    return existingIt->second;
  }

  TouchTextAtlasEntryLocked(entry);
  entries[textKey] = entry;
  PruneTextAtlasCacheLocked(cacheKey);
  return entry;
}

}  // namespace

bool BuildBitmapGpuPlan(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const ScenePayload& scene,
  GpuRenderPlan* outPlan,
  std::string* errorMessage
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap GPU plan request is missing an output target.";
    }
    return false;
  }

  GpuRenderPlan plan;
  plan.scene = scene;
  plan.width = output->width;
  plan.height = output->height;
  plan.cacheKey = cacheKey;
  plan.targetFrame = targetFrame;
  plan.clearsSurface = scene.clearsSurface;
  plan.clearColor = PF_Pixel{0, 0, 0, 0};

  std::vector<std::vector<unsigned char>> clipMaskStack;
  std::vector<int> clipImageIdStack;
  std::vector<AnalyticClipState> analyticClipStack;
  std::vector<std::size_t> clipBeginIndices;
  std::vector<bool> clipInvertStack;
  std::vector<unsigned char> currentClipMask;
  int currentClipImageId = 0;
  AnalyticClipState currentAnalyticClip;

  auto updateCurrentClipAsset = [&]() -> bool {
    currentClipImageId = 0;
    if (currentClipMask.empty()) {
      return true;
    }
    RuntimeImageAsset clipAsset;
    clipAsset.id = ReserveTransientImageId(cacheKey);
    clipAsset.source = "gpu_clip_mask";
    clipAsset.width = output->width;
    clipAsset.height = output->height;
    clipAsset.pixelDensity = 1.0;
    clipAsset.version = HashAlphaMask(currentClipMask, output->width, output->height);
    clipAsset.loaded = true;
    clipAsset.pixels.resize(currentClipMask.size());
    for (std::size_t index = 0; index < currentClipMask.size(); ++index) {
      const unsigned char alpha = currentClipMask[index];
      clipAsset.pixels[index] = PF_Pixel{alpha, 255, 255, 255};
    }
    plan.scene.imageAssets[clipAsset.id] = std::move(clipAsset);
    currentClipImageId = clipAsset.id;
    return true;
  };

  auto resetPlanToClearColor = [&](const PF_Pixel& color) {
    plan.clearsSurface = true;
    plan.clearColor = color;
    plan.fillTriangles.clear();
    plan.pathFillVertices.clear();
    plan.pathFillContours.clear();
    plan.pathFills.clear();
    plan.boundaryEdges.clear();
    plan.strokeTriangles.clear();
    plan.strokeBoundaryEdges.clear();
    plan.imageDraws.clear();
    plan.filterPasses.clear();
    plan.maskPasses.clear();
    plan.drawBatches.clear();
  };

  for (std::size_t commandIndex = 0; commandIndex < scene.commands.size(); ++commandIndex) {
    const SceneCommand& command = scene.commands[commandIndex];

    if (command.type == "push_state") {
      clipMaskStack.push_back(currentClipMask);
      clipImageIdStack.push_back(currentClipImageId);
      analyticClipStack.push_back(currentAnalyticClip);
      continue;
    }
    if (command.type == "pop_state") {
      if (!clipMaskStack.empty()) {
        currentClipMask = clipMaskStack.back();
        clipMaskStack.pop_back();
        if (!clipImageIdStack.empty()) {
          currentClipImageId = clipImageIdStack.back();
          clipImageIdStack.pop_back();
        } else {
          currentClipImageId = 0;
        }
        if (!analyticClipStack.empty()) {
          currentAnalyticClip = analyticClipStack.back();
          analyticClipStack.pop_back();
        } else {
          currentAnalyticClip = AnalyticClipState{};
        }
        if (currentClipImageId == 0 && !currentClipMask.empty()) {
          if (!updateCurrentClipAsset()) {
            if (errorMessage) {
              *errorMessage = "GPU bitmap v2 failed to restore clip mask state.";
            }
            return false;
          }
        }
      }
      continue;
    }
    if (IsIgnorableCommand(command)) {
      continue;
    }

    if (command.type == "clear") {
      // Clear is an in-stream surface reset. Keep only commands after the latest clear.
      resetPlanToClearColor(PF_Pixel{0, 0, 0, 0});
      continue;
    }

    if (command.type == "clip_begin") {
      clipBeginIndices.push_back(commandIndex);
      clipInvertStack.push_back(command.clipInvert);
      continue;
    }

    if (command.type == "clip_end") {
      if (!clipBeginIndices.empty()) {
        const std::size_t beginIndex = clipBeginIndices.back();
        const bool invert = clipInvertStack.back();
        clipBeginIndices.pop_back();
        clipInvertStack.pop_back();

        std::vector<SceneCommand> clipCommands;
        clipCommands.reserve(commandIndex > beginIndex ? (commandIndex - beginIndex - 1) : 0);
        for (std::size_t clipIndex = beginIndex + 1; clipIndex < commandIndex; ++clipIndex) {
          const SceneCommand& clipCommand = scene.commands[clipIndex];
          if (clipCommand.clipPath && IsDrawableCommandType(clipCommand)) {
            clipCommands.push_back(clipCommand);
          }
        }

        const bool canUseGpuClipScene =
          !invert &&
          currentClipImageId == 0 &&
          currentClipMask.empty() &&
          !currentAnalyticClip.enabled;
        if (canUseGpuClipScene) {
          RuntimeImageAsset clipAsset;
          if (!BuildClipSceneAssetFromCommands(output, cacheKey, scene, clipCommands, &clipAsset)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to build GPU clip scene for execution."
              );
            }
            return false;
          }
          AnalyticClipState analyticClip;
          if (!BuildAnalyticClipStateFromCommands(output, clipCommands, &plan, &analyticClip)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to build analytic clip contours."
              );
            }
            return false;
          }
          currentClipMask.clear();
          currentClipImageId = clipAsset.id;
          currentAnalyticClip = analyticClip;
          plan.scene.imageAssets[clipAsset.id] = std::move(clipAsset);
          continue;
        }

        if (currentClipMask.empty() && currentClipImageId != 0) {
          const auto currentClipAssetIt = plan.scene.imageAssets.find(currentClipImageId);
          if (currentClipAssetIt == plan.scene.imageAssets.end() ||
              !MaterializeClipAlphaFromAsset(currentClipAssetIt->second, &currentClipMask)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to materialize existing GPU clip for nested clipping."
              );
            }
            return false;
          }
          currentAnalyticClip = AnalyticClipState{};
        }

        std::vector<unsigned char> clipMask;
        if (!BuildClipMaskAlphaFromCommands(output, clipCommands, &clipMask)) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "clip",
              "failed to build clip mask for GPU execution."
            );
          }
          return false;
        }

        IntersectClipMask(&currentClipMask, clipMask, invert);
        currentAnalyticClip = AnalyticClipState{};
        if (!updateCurrentClipAsset()) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "clip",
              "failed to upload clip mask image."
            );
          }
          return false;
        }
      }
      continue;
    }

    if (command.clipPath || IsClipCommand(command)) {
      continue;
    }

    if (command.type == "background") {
      const bool backgroundErase = command.eraseFill || command.eraseStroke;
      const bool canPromoteToClear =
        command.fill.alpha >= 255 &&
        command.blendMode == BLEND_MODE_BLEND &&
        !backgroundErase &&
        currentClipImageId == 0 &&
        IsIdentityTransformValue(command.transform);
      if (canPromoteToClear) {
        resetPlanToClearColor(command.fill);
        continue;
      }

      const double sceneWidth = GetSceneWidth(scene, output);
      const double sceneHeight = GetSceneHeight(scene, output);
      if (!(sceneWidth > 0.0) || !(sceneHeight > 0.0)) {
        continue;
      }

      const std::size_t fillStart = plan.fillTriangles.size();
      const std::pair<double, double> topLeft = std::make_pair(0.0, 0.0);
      const std::pair<double, double> topRight = std::make_pair(sceneWidth, 0.0);
      const std::pair<double, double> bottomRight = std::make_pair(sceneWidth, sceneHeight);
      const std::pair<double, double> bottomLeft = std::make_pair(0.0, sceneHeight);
      AppendFillTriangle(topLeft, topRight, bottomRight, command.fill, &plan);
      AppendFillTriangle(topLeft, bottomRight, bottomLeft, command.fill, &plan);
      if (plan.fillTriangles.size() > fillStart) {
        const float eraseStrength = static_cast<float>(
          command.eraseFill ? command.eraseFillStrength : command.eraseStrokeStrength
        );
        AppendFillBatch(
          fillStart,
          plan.fillTriangles.size(),
          plan.boundaryEdges.size(),
          plan.boundaryEdges.size(),
          command.blendMode,
          backgroundErase,
          eraseStrength,
          currentClipImageId,
          currentAnalyticClip,
          &plan
        );
      }
      continue;
    }

    if (command.type == "point") {
      if (!command.hasStroke) {
        continue;
      }
      double x = ResolveScalarSpec(command.x, output);
      double y = ResolveScalarSpec(command.y, output);
      ApplyTransform(command.transform, x, y, &x, &y);
      const double halfWidth = std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
      const std::size_t fillStart = plan.fillTriangles.size();
      const std::size_t edgeStart = plan.boundaryEdges.size();
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      AppendPointStrokeGeometry(
        std::make_pair(x, y),
        halfWidth,
        command.strokeCap,
        command.stroke,
        &plan
      );
      MoveRecentStrokeGeometryToDedicatedBuffers(fillStart, edgeStart, &plan, &strokeStart, &strokeEdgeStart);
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "line") {
      if (!command.hasStroke) {
        continue;
      }
      double x1 = ResolveScalarSpec(command.x1, output);
      double y1 = ResolveScalarSpec(command.y1, output);
      double x2 = ResolveScalarSpec(command.x2, output);
      double y2 = ResolveScalarSpec(command.y2, output);
      ApplyTransform(command.transform, x1, y1, &x1, &y1);
      ApplyTransform(command.transform, x2, y2, &x2, &y2);

      const double halfWidth = std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
      const std::size_t fillStart = plan.fillTriangles.size();
      const std::size_t edgeStart = plan.boundaryEdges.size();
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      AppendPolylineStrokeGeometry(
        {std::make_pair(x1, y1), std::make_pair(x2, y2)},
        false,
        halfWidth,
        command.strokeCap,
        command.strokeJoin,
        command.stroke,
        &plan
      );
      MoveRecentStrokeGeometryToDedicatedBuffers(fillStart, edgeStart, &plan, &strokeStart, &strokeEdgeStart);
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "image") {
      if (command.imageId <= 0) {
        continue;
      }
      const auto assetIt = scene.imageAssets.find(command.imageId);
      if (assetIt == scene.imageAssets.end()) {
        continue;
      }
      const RuntimeImageAsset& asset = assetIt->second;
      if (!asset.loaded || asset.width <= 0 || asset.height <= 0) {
        continue;
      }

      const double destX = ResolveScalarSpec(command.x, output);
      const double destY = ResolveScalarSpec(command.y, output);
      const double destWidth = ResolveScalarSpec(command.width, output);
      const double destHeight = ResolveScalarSpec(command.height, output);
      if (!(destWidth > 0.0) || !(destHeight > 0.0)) {
        continue;
      }

      double srcX = 0.0;
      double srcY = 0.0;
      double srcWidth = static_cast<double>(asset.width);
      double srcHeight = static_cast<double>(asset.height);
      if (command.imageHasSourceRect) {
        srcX = command.imageSourceX;
        srcY = command.imageSourceY;
        srcWidth = command.imageSourceWidth;
        srcHeight = command.imageSourceHeight;
      }
      if (!(srcWidth > 0.0) || !(srcHeight > 0.0)) {
        continue;
      }

      const double invAssetWidth = 1.0 / static_cast<double>(asset.width);
      const double invAssetHeight = 1.0 / static_cast<double>(asset.height);
      const float u0 = static_cast<float>(srcX * invAssetWidth);
      const float v0 = static_cast<float>(srcY * invAssetHeight);
      const float u1 = static_cast<float>((srcX + srcWidth) * invAssetWidth);
      const float v1 = static_cast<float>((srcY + srcHeight) * invAssetHeight);

      double x1 = destX;
      double y1 = destY;
      double x2 = destX + destWidth;
      double y2 = destY;
      double x3 = destX + destWidth;
      double y3 = destY + destHeight;
      double x4 = destX;
      double y4 = destY + destHeight;
      ApplyTransform(command.transform, x1, y1, &x1, &y1);
      ApplyTransform(command.transform, x2, y2, &x2, &y2);
      ApplyTransform(command.transform, x3, y3, &x3, &y3);
      ApplyTransform(command.transform, x4, y4, &x4, &y4);

      GpuRenderPlan::ImageDraw imageDraw;
      imageDraw.x1 = static_cast<float>(x1);
      imageDraw.y1 = static_cast<float>(y1);
      imageDraw.u1 = u0;
      imageDraw.v1 = v0;
      imageDraw.x2 = static_cast<float>(x2);
      imageDraw.y2 = static_cast<float>(y2);
      imageDraw.u2 = u1;
      imageDraw.v2 = v0;
      imageDraw.x3 = static_cast<float>(x3);
      imageDraw.y3 = static_cast<float>(y3);
      imageDraw.u3 = u1;
      imageDraw.v3 = v1;
      imageDraw.x4 = static_cast<float>(x4);
      imageDraw.y4 = static_cast<float>(y4);
      imageDraw.u4 = u0;
      imageDraw.v4 = v1;
      imageDraw.imageId = asset.id;
      imageDraw.imageVersion = asset.version;
      imageDraw.tint = command.imageHasTint ? command.imageTint : PF_Pixel{255, 255, 255, 255};
      const std::size_t imageStart = plan.imageDraws.size();
      plan.imageDraws.push_back(imageDraw);
      const bool imageErase = command.eraseFill || command.eraseStroke;
      const float imageEraseStrength = static_cast<float>(
        command.eraseFill ? command.eraseFillStrength : command.eraseStrokeStrength
      );
      AppendImageBatch(
        GpuRenderPlan::DRAW_BATCH_IMAGES,
        imageStart,
        plan.imageDraws.size(),
        command.blendMode,
        imageErase,
        imageEraseStrength,
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "filter") {
      const int filterKind = ParseBitmapFilterKind(command.filterKind);
      if (filterKind == BITMAP_FILTER_NONE) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "filter",
            "unknown filter kind for GPU execution."
          );
        }
        return false;
      }

      GpuRenderPlan::FilterPass pass;
      pass.filterKind = static_cast<std::int32_t>(filterKind);
      pass.value = static_cast<float>(command.filterValue);
      const std::size_t filterStart = plan.filterPasses.size();
      plan.filterPasses.push_back(pass);
      AppendFilterBatch(
        filterStart,
        plan.filterPasses.size(),
        &plan
      );
      continue;
    }

    if (command.type == "mask") {
      if (command.maskImageId <= 0) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "image",
            "mask command is missing mask image id."
          );
        }
        return false;
      }
      const auto maskIt = scene.imageAssets.find(command.maskImageId);
      if (maskIt == scene.imageAssets.end()) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "image",
            "mask command references an image asset that is not available."
          );
        }
        return false;
      }
      const RuntimeImageAsset& maskAsset = maskIt->second;
      if (!maskAsset.loaded || maskAsset.width <= 0 || maskAsset.height <= 0) {
        continue;
      }
      GpuRenderPlan::MaskPass pass;
      pass.maskImageId = maskAsset.id;
      pass.maskImageVersion = maskAsset.version;
      const std::size_t maskStart = plan.maskPasses.size();
      plan.maskPasses.push_back(pass);
      AppendMaskBatch(maskStart, plan.maskPasses.size(), &plan);
      continue;
    }

    if (command.type == "text") {
      if (!command.hasFill && !command.hasStroke) {
        continue;
      }

      const std::uint64_t textKey = HashTextAtlasCommandKey(command);
      std::shared_ptr<CachedTextAtlasEntry> cachedEntry =
        LookupCachedTextAtlasEntry(plan.cacheKey, textKey);

      if (!cachedEntry) {
        auto newEntry = std::make_shared<CachedTextAtlasEntry>();
        int fillImageId = 0;
        int strokeImageId = 0;
        ReserveTextAtlasImageIds(
          plan.cacheKey,
          command.hasFill,
          command.hasStroke,
          &fillImageId,
          &strokeImageId
        );

        GlyphAtlasTextRender glyphAtlas;
        if (!BuildGlyphAtlasTextCommand(command, fillImageId, strokeImageId, &glyphAtlas)) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "text",
              "glyph atlas text generation failed for the requested font/style."
            );
          }
          return false;
        }

        if (glyphAtlas.hasFillAtlas && glyphAtlas.fillAtlas.loaded) {
          newEntry->hasFillAsset = true;
          newEntry->fillAsset = glyphAtlas.fillAtlas;
          newEntry->fillQuads = std::move(glyphAtlas.fillQuads);
        }
        if (glyphAtlas.hasStrokeAtlas && glyphAtlas.strokeAtlas.loaded) {
          newEntry->hasStrokeAsset = true;
          newEntry->strokeAsset = glyphAtlas.strokeAtlas;
          newEntry->strokeQuads = std::move(glyphAtlas.strokeQuads);
        }

        cachedEntry = StoreCachedTextAtlasEntry(plan.cacheKey, textKey, newEntry);
      }

      if (!cachedEntry) {
        continue;
      }

      auto appendTextAtlasDraw = [&](
        const RuntimeImageAsset& asset,
        const std::vector<GlyphAtlasQuad>& quads,
        const PF_Pixel& tint,
        bool erase,
        float eraseStrength
      ) -> bool {
        if (!asset.loaded || asset.id == 0 || asset.width <= 0 || asset.height <= 0 || asset.pixels.empty() || quads.empty()) {
          return true;
        }

        if (plan.scene.imageAssets.find(asset.id) == plan.scene.imageAssets.end()) {
          plan.scene.imageAssets[asset.id] = asset;
        }
        const RuntimeImageAsset& mappedAsset = plan.scene.imageAssets[asset.id];

        const std::size_t imageStart = plan.imageDraws.size();
        for (std::size_t quadIndex = 0; quadIndex < quads.size(); quadIndex += 1) {
          const GlyphAtlasQuad& quad = quads[quadIndex];
          GpuRenderPlan::ImageDraw imageDraw;
          imageDraw.x1 = static_cast<float>(quad.x1);
          imageDraw.y1 = static_cast<float>(quad.y1);
          imageDraw.u1 = static_cast<float>(quad.u1);
          imageDraw.v1 = static_cast<float>(quad.v1);
          imageDraw.x2 = static_cast<float>(quad.x2);
          imageDraw.y2 = static_cast<float>(quad.y2);
          imageDraw.u2 = static_cast<float>(quad.u2);
          imageDraw.v2 = static_cast<float>(quad.v2);
          imageDraw.x3 = static_cast<float>(quad.x3);
          imageDraw.y3 = static_cast<float>(quad.y3);
          imageDraw.u3 = static_cast<float>(quad.u3);
          imageDraw.v3 = static_cast<float>(quad.v3);
          imageDraw.x4 = static_cast<float>(quad.x4);
          imageDraw.y4 = static_cast<float>(quad.y4);
          imageDraw.u4 = static_cast<float>(quad.u4);
          imageDraw.v4 = static_cast<float>(quad.v4);
          imageDraw.imageId = mappedAsset.id;
          imageDraw.imageVersion = mappedAsset.version;
          imageDraw.tint = tint;
          plan.imageDraws.push_back(imageDraw);
        }
        AppendImageBatch(
          GpuRenderPlan::DRAW_BATCH_TEXT_IMAGES,
          imageStart,
          plan.imageDraws.size(),
          command.blendMode,
          erase,
          eraseStrength,
          currentClipImageId,
          currentAnalyticClip,
          &plan
        );
        return true;
      };

      if (command.hasFill &&
          cachedEntry->hasFillAsset &&
          !appendTextAtlasDraw(
            cachedEntry->fillAsset,
            cachedEntry->fillQuads,
            command.fill,
            command.eraseFill,
            static_cast<float>(command.eraseFillStrength)
          )) {
        return false;
      }
      if (command.hasStroke &&
          cachedEntry->hasStrokeAsset &&
          !appendTextAtlasDraw(
            cachedEntry->strokeAsset,
            cachedEntry->strokeQuads,
            command.stroke,
            command.eraseStroke,
            static_cast<float>(command.eraseStrokeStrength)
          )) {
        return false;
      }
      continue;
    }

    if (command.type != "path") {
      if (errorMessage) {
        const std::string commandClass =
          command.type == "clear"
                  ? "clear"
                  : command.type == "background"
                    ? "background"
                  : "generic";
        *errorMessage = BuildUnsupportedReason(
          command,
          commandClass,
          "this API class is not included in bitmap GPU v2 fill-first scope."
        );
      }
      return false;
    }

    if (!command.hasFill && !command.hasStroke) {
      continue;
    }

    std::vector<FlattenedPathSubpath> flattenedSubpaths;
    flattenedSubpaths.reserve(command.path.subpaths.size());
    for (std::size_t subpathIndex = 0; subpathIndex < command.path.subpaths.size(); ++subpathIndex) {
      FlattenedPathSubpath flattened =
        FlattenPathSubpath(output, command.transform, command.path.subpaths[subpathIndex]);
      NormalizeFlattenedVertices(&flattened);
      if (!flattened.vertices.empty()) {
        flattenedSubpaths.push_back(std::move(flattened));
      }
    }

    if (flattenedSubpaths.empty()) {
      continue;
    }

    const std::size_t fillStart = plan.fillTriangles.size();
    const std::size_t pathFillStart = plan.pathFills.size();
    if (command.hasFill) {
      std::vector<std::pair<double, double>> outer;
      std::vector<std::vector<std::pair<double, double>>> holes;
      bool hasOuter = false;

      auto flushFillGroup = [&]() -> bool {
        if (!hasOuter) {
          return true;
        }

        auto appendContour = [&](const std::vector<std::pair<double, double>>& source) -> bool {
          if (source.size() < 3) {
            return false;
          }

          std::vector<std::pair<double, double>> contour = source;
          if (contour.size() >= 2) {
            const std::pair<double, double>& first = contour.front();
            const std::pair<double, double>& last = contour.back();
            const bool repeatedClose =
              std::fabs(first.first - last.first) <= 1e-6 &&
              std::fabs(first.second - last.second) <= 1e-6;
            if (repeatedClose) {
              contour.pop_back();
            }
          }
          if (contour.size() < 3) {
            return false;
          }

          GpuRenderPlan::PathFillContour contourMeta;
          contourMeta.vertexStart =
            static_cast<std::uint32_t>(plan.pathFillVertices.size());
          contourMeta.vertexCount =
            static_cast<std::uint32_t>(contour.size());
          for (std::size_t vertexIndex = 0; vertexIndex < contour.size(); ++vertexIndex) {
            GpuRenderPlan::PathFillVertex vertex;
            vertex.x = static_cast<float>(contour[vertexIndex].first);
            vertex.y = static_cast<float>(contour[vertexIndex].second);
            plan.pathFillVertices.push_back(vertex);
          }
          plan.pathFillContours.push_back(contourMeta);
          return true;
        };

        GpuRenderPlan::PathFill pathFill;
        pathFill.contourStart =
          static_cast<std::uint32_t>(plan.pathFillContours.size());
        pathFill.contourCount = 0;
        pathFill.minX = std::numeric_limits<float>::infinity();
        pathFill.minY = std::numeric_limits<float>::infinity();
        pathFill.maxX = -std::numeric_limits<float>::infinity();
        pathFill.maxY = -std::numeric_limits<float>::infinity();
        pathFill.color = command.fill;

        auto updateBounds = [&](const std::vector<std::pair<double, double>>& contour) {
          for (std::size_t vertexIndex = 0; vertexIndex < contour.size(); ++vertexIndex) {
            const float x = static_cast<float>(contour[vertexIndex].first);
            const float y = static_cast<float>(contour[vertexIndex].second);
            pathFill.minX = std::min(pathFill.minX, x);
            pathFill.minY = std::min(pathFill.minY, y);
            pathFill.maxX = std::max(pathFill.maxX, x);
            pathFill.maxY = std::max(pathFill.maxY, y);
          }
        };

        if (appendContour(outer)) {
          updateBounds(outer);
          pathFill.contourCount += 1;
        }
        for (std::size_t holeIndex = 0; holeIndex < holes.size(); ++holeIndex) {
          if (appendContour(holes[holeIndex])) {
            updateBounds(holes[holeIndex]);
            pathFill.contourCount += 1;
          }
        }

        if (pathFill.contourCount > 0 &&
            std::isfinite(pathFill.minX) &&
            std::isfinite(pathFill.minY) &&
            std::isfinite(pathFill.maxX) &&
            std::isfinite(pathFill.maxY)) {
          plan.pathFills.push_back(pathFill);
        }

        hasOuter = false;
        outer.clear();
        holes.clear();
        return true;
      };

      for (std::size_t subpathIndex = 0; subpathIndex < flattenedSubpaths.size(); ++subpathIndex) {
        FlattenedPathSubpath flattened = flattenedSubpaths[subpathIndex];
        if (flattened.vertices.size() < 3) {
          continue;
        }
        if (!flattened.closed) {
          const std::pair<double, double>& first = flattened.vertices.front();
          const std::pair<double, double>& last = flattened.vertices.back();
          const bool alreadyClosed =
            std::fabs(first.first - last.first) <= 1e-6 &&
            std::fabs(first.second - last.second) <= 1e-6;
          if (!alreadyClosed) {
            flattened.vertices.push_back(first);
          }
          flattened.closed = true;
        }
        if (flattened.isContour) {
          if (!hasOuter) {
            // Recover gracefully: treat an orphan contour as the outer ring.
            // This avoids hard-failing the whole frame for minor authoring mismatches.
            hasOuter = true;
            outer = flattened.vertices;
            continue;
          }
          holes.push_back(flattened.vertices);
          continue;
        }

        if (!flushFillGroup()) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "path_fill",
              "failed to build GPU path fill command."
            );
          }
          return false;
        }
        hasOuter = true;
        outer = flattened.vertices;
      }

      if (!flushFillGroup()) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "path_fill",
            "failed to build GPU path fill command."
          );
        }
        return false;
      }
    }

    const std::size_t strokeFillStart = plan.fillTriangles.size();
    const std::size_t strokeEdgeSeedStart = plan.boundaryEdges.size();
    if (command.hasStroke) {
      for (std::size_t subpathIndex = 0; subpathIndex < flattenedSubpaths.size(); ++subpathIndex) {
        const FlattenedPathSubpath& flattened = flattenedSubpaths[subpathIndex];
        const double strokeHalfWidth =
          std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
        AppendPolylineStrokeGeometry(
          flattened.vertices,
          flattened.closed,
          strokeHalfWidth,
          command.strokeCap,
          command.strokeJoin,
          command.stroke,
          &plan
        );
      }
    }

    if (command.hasStroke) {
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      MoveRecentStrokeGeometryToDedicatedBuffers(
        strokeFillStart,
        strokeEdgeSeedStart,
        &plan,
        &strokeStart,
        &strokeEdgeStart
      );
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
    }
    AppendPathFillBatch(
      pathFillStart,
      plan.pathFills.size(),
      command.blendMode,
      command.eraseFill,
      static_cast<float>(command.eraseFillStrength),
      currentClipImageId,
      currentAnalyticClip,
      &plan
    );
  }

  *outPlan = plan;
  return true;
}

void ClearBitmapGpuTextAtlasCacheByKey(std::uint64_t cacheKey) {
  if (cacheKey == 0) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  gTextAtlasCacheByInstance.erase(cacheKey);
  gTextAtlasNextImageIdByInstance.erase(cacheKey);
}

void ClearAllBitmapGpuTextAtlasCaches() {
  const std::lock_guard<std::mutex> lock(gTextAtlasCacheMutex);
  gTextAtlasCacheByInstance.clear();
  gTextAtlasNextImageIdByInstance.clear();
}

bool BuildBitmapFramePlan(
  PF_LayerDef* output,
  BitmapGpuExecutionProfile profile,
  std::uint64_t cacheKey,
  long targetFrame,
  const std::vector<std::pair<long, ScenePayload>>& scenes,
  BitmapFramePlan* outPlan,
  std::string* errorMessage
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap frame plan request is missing an output target.";
    }
    return false;
  }

  BitmapFramePlan framePlan;
  framePlan.profile = profile;
  framePlan.cacheKey = cacheKey;
  framePlan.targetFrame = targetFrame;
  framePlan.width = output->width;
  framePlan.height = output->height;

  for (std::size_t index = 0; index < scenes.size(); index += 1) {
    BitmapFramePlanOp op;
    op.frame = scenes[index].first;
    if (!BuildBitmapGpuPlan(
      output,
      cacheKey,
      scenes[index].first,
      scenes[index].second,
      &op.drawPlan,
      errorMessage
    )) {
      framePlan.supported = false;
      framePlan.unsupportedReason =
        errorMessage && !errorMessage->empty()
          ? *errorMessage
          : "GPU bitmap v2 does not support one or more commands in this sketch.";
      *outPlan = framePlan;
      return false;
    }
    framePlan.operations.push_back(op);
  }

  *outPlan = framePlan;
  return true;
}

}  // namespace momentum

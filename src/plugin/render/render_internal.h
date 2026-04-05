#pragma once

#include "render_core.h"

#include <utility>

namespace momentum {

bool IntersectLines(
  const std::pair<double, double>& p1,
  const std::pair<double, double>& d1,
  const std::pair<double, double>& p2,
  const std::pair<double, double>& d2,
  std::pair<double, double>* out
);

std::pair<double, double> AddScaled(
  const std::pair<double, double>& point,
  const std::pair<double, double>& vector,
  double scale
);

VertexSpec MakePixelVertexSpec(double x, double y);

std::vector<VertexSpec> BuildRectVertexSpecs(
  double x,
  double y,
  double width,
  double height
);

std::vector<VertexSpec> BuildLineVertexSpecs(
  double x1,
  double y1,
  double x2,
  double y2
);

std::pair<double, double> Normalize(const std::pair<double, double>& vector);

std::vector<std::pair<double, double>> BuildStrokeQuad(
  const std::pair<double, double>& start,
  const std::pair<double, double>& end,
  double halfWidth,
  double startExtension,
  double endExtension
);

double NormalizeAngleDelta(double delta, bool positive);

void AppendArcPoints(
  std::vector<std::pair<double, double>>* points,
  const std::pair<double, double>& center,
  double radius,
  double startAngle,
  double delta,
  bool includeFirst
);

bool ComputeOffsetIntersection(
  const std::pair<double, double>& current,
  const std::pair<double, double>& prevDir,
  const std::pair<double, double>& nextDir,
  double sideSign,
  double halfWidth,
  std::pair<double, double>* out
);

double PolygonSignedArea(const std::vector<std::pair<double, double>>& vertices);

struct ClosedStrokeRing {
  std::vector<std::pair<double, double>> outer;
  std::vector<std::pair<double, double>> inner;
};

std::vector<std::pair<double, double>> BuildOpenStrokeOutline(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeCap,
  int strokeJoin
);

ClosedStrokeRing BuildClosedStrokeRing(
  const std::vector<std::pair<double, double>>& vertices,
  double halfWidth,
  int strokeJoin
);

}

#pragma once

#include "render_core.h"

#include <utility>

namespace momentum {

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

#include "host/effect/events.h"

#include <cassert>
#include <cmath>
#include <limits>

namespace {

bool NearlyEqual(double left, double right) {
  return std::fabs(left - right) < 1e-9;
}

}  // namespace

int main() {
  assert(NearlyEqual(momentum::WrapAngleDegrees(450.0), 90.0));
  assert(NearlyEqual(momentum::WrapAngleDegrees(-90.0), 270.0));
  assert(NearlyEqual(momentum::NormalizeAngleDelta(270.0), -90.0));
  assert(NearlyEqual(momentum::NormalizeAngleDelta(-270.0), 90.0));

  int turns = 0;
  double cycleDegrees = 0.0;
  momentum::SplitAngleDegrees(810.0, &turns, &cycleDegrees);
  assert(turns == 2);
  assert(NearlyEqual(cycleDegrees, 90.0));
  assert(NearlyEqual(
    momentum::ComposeAngleDegrees(turns, cycleDegrees),
    810.0
  ));

  momentum::SplitAngleDegrees(-810.0, &turns, &cycleDegrees);
  assert(turns == -2);
  assert(NearlyEqual(cycleDegrees, -90.0));
  assert(NearlyEqual(
    momentum::ComposeAngleDegrees(turns, cycleDegrees),
    -810.0
  ));

  assert(NearlyEqual(
    momentum::SanitizeAngleDegrees(
      std::numeric_limits<double>::quiet_NaN()
    ),
    0.0
  ));
  assert(NearlyEqual(
    momentum::SanitizeAngleDegrees(
      std::numeric_limits<double>::infinity()
    ),
    0.0
  ));
  return 0;
}

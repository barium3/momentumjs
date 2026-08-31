#pragma once

#include "host/ae_sdk.h"

#include <cmath>

namespace momentum {

inline double WrapAngleDegrees(double degrees) {
  double wrapped = std::fmod(degrees, 360.0);
  if (wrapped < 0.0) {
    wrapped += 360.0;
  }
  return wrapped;
}

inline double NormalizeAngleDelta(double deltaDegrees) {
  while (deltaDegrees > 180.0) {
    deltaDegrees -= 360.0;
  }
  while (deltaDegrees < -180.0) {
    deltaDegrees += 360.0;
  }
  return deltaDegrees;
}

inline double SanitizeAngleDegrees(double degrees) {
  return std::isfinite(degrees) ? degrees : 0.0;
}

inline void SplitAngleDegrees(
  double totalDegrees,
  int* turns,
  double* cycleDegrees
) {
  const double safeDegrees = SanitizeAngleDegrees(totalDegrees);
  int safeTurns =
    static_cast<int>(std::trunc(safeDegrees / 360.0));
  double safeCycleDegrees =
    safeDegrees - (static_cast<double>(safeTurns) * 360.0);
  if (safeCycleDegrees >= 360.0) {
    safeCycleDegrees -= 360.0;
    safeTurns += 1;
  } else if (safeCycleDegrees <= -360.0) {
    safeCycleDegrees += 360.0;
    safeTurns -= 1;
  }
  if (std::fabs(safeCycleDegrees) < 1e-6) {
    safeCycleDegrees = 0.0;
  }
  if (turns) {
    *turns = safeTurns;
  }
  if (cycleDegrees) {
    *cycleDegrees = safeCycleDegrees;
  }
}

inline double ComposeAngleDegrees(
  int turns,
  double cycleDegrees
) {
  double safeCycleDegrees = SanitizeAngleDegrees(cycleDegrees);
  while (safeCycleDegrees >= 360.0) {
    safeCycleDegrees -= 360.0;
    turns += 1;
  }
  while (safeCycleDegrees <= -360.0) {
    safeCycleDegrees += 360.0;
    turns -= 1;
  }
  if (std::fabs(safeCycleDegrees) < 1e-6) {
    safeCycleDegrees = 0.0;
  }
  return (static_cast<double>(turns) * 360.0) +
    safeCycleDegrees;
}

PF_Err RegisterCustomUI(PF_InData* input);

PF_Err HandleCustomEffectUIEvent(
  PF_InData* input,
  PF_OutData* output,
  PF_ParamDef* parameters[],
  PF_EventExtra* event
);

}  // namespace momentum

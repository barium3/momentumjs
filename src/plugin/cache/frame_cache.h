#pragma once

#include "../model/momentum_types.h"

namespace momentum {

void EnforceFrameSnapshotBudget(CachedSketchState* cache);
const CachedSketchState::FrameSnapshot* FindFrameSnapshot(CachedSketchState* cache, long frame);

}  // namespace momentum

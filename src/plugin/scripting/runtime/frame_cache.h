#pragma once

#include "scripting/runtime/types.h"

namespace momentum {

void EnforceFrameSnapshotBudget(CachedSketchState* cache);
const CachedSketchState::FrameSnapshot* FindFrameSnapshot(CachedSketchState* cache, long frame);

}  // namespace momentum

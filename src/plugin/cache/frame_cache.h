#pragma once

#include "../model/momentum_types.h"

namespace momentum {

std::size_t EstimateFrameSnapshotBytes(const CachedSketchState& cache);
long ClampPositiveLong(long value, long fallback);
long EstimateExactFramesCapacity(const CachedSketchState& cache);
void EnforceFrameSnapshotBudget(CachedSketchState* cache);
void EnforceCheckpointBudget(CachedSketchState* cache);
const CachedSketchState::FrameSnapshot* FindFrameSnapshot(CachedSketchState* cache, long frame);
const CachedSketchState::FrameSnapshot* FindNearestSnapshotAtOrBefore(CachedSketchState* cache, long frame);
const CachedSketchState::FrameSnapshot* FindNearestRasterizedSnapshotAtOrBefore(CachedSketchState* cache, long frame);

}  // namespace momentum

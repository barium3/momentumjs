#include "frame_cache.h"

#include <algorithm>

namespace momentum {

std::size_t EstimateFrameSnapshotBytes(const CachedSketchState& cache) {
  if (!cache.raster.empty()) {
    return cache.raster.size() * sizeof(PF_Pixel);
  }

  if (cache.outputWidth > 0 && cache.outputHeight > 0) {
    return static_cast<std::size_t>(cache.outputWidth) *
      static_cast<std::size_t>(cache.outputHeight) *
      sizeof(PF_Pixel);
  }

  return sizeof(CachedSketchState::FrameSnapshot);
}

long ClampPositiveLong(long value, long fallback) {
  return value > 0 ? value : fallback;
}

long EstimateExactFramesCapacity(const CachedSketchState& cache) {
  const std::size_t frameBytes = EstimateFrameSnapshotBytes(cache);
  if (frameBytes == 0) {
    return 1;
  }

  const std::size_t budgetBytes =
    cache.frameCacheBudgetBytes > 0 ? cache.frameCacheBudgetBytes : kDefaultRecentFrameBudgetBytes;
  const std::size_t capacity = std::max<std::size_t>(1, budgetBytes / frameBytes);
  return static_cast<long>(capacity);
}

void EnforceFrameSnapshotBudget(CachedSketchState* cache) {
  if (!cache) {
    return;
  }

  const std::size_t snapshotBytes = EstimateFrameSnapshotBytes(*cache);
  if (snapshotBytes == 0) {
    return;
  }

  const std::size_t budgetBytes =
    cache->frameCacheBudgetBytes > 0 ? cache->frameCacheBudgetBytes : kDefaultRecentFrameBudgetBytes;

  while (!cache->exactSnapshotOrder.empty()) {
    const std::size_t usedBytes = cache->exactSnapshotOrder.size() * snapshotBytes;
    if (usedBytes <= budgetBytes || cache->exactSnapshotOrder.size() <= 1) {
      break;
    }

    auto evictionIt = std::find_if(
      cache->exactSnapshotOrder.begin(),
      cache->exactSnapshotOrder.end(),
      [](long frame) { return frame != 0; }
    );
    if (evictionIt == cache->exactSnapshotOrder.end()) {
      break;
    }

    const long evictedFrame = *evictionIt;
    cache->exactSnapshotOrder.erase(evictionIt);
    cache->exactSnapshots.erase(evictedFrame);
  }
}

void EnforceCheckpointBudget(CachedSketchState* cache) {
  if (!cache) {
    return;
  }

  while (cache->checkpointOrder.size() > kMaxCheckpointSnapshots) {
    const long oldestFrame = cache->checkpointOrder.front();
    cache->checkpointOrder.erase(cache->checkpointOrder.begin());
    cache->checkpointSnapshots.erase(oldestFrame);
  }
}

const CachedSketchState::FrameSnapshot* FindFrameSnapshot(CachedSketchState* cache, long frame) {
  if (!cache) {
    return NULL;
  }

  const auto it = cache->exactSnapshots.find(frame);
  if (it == cache->exactSnapshots.end()) {
    return NULL;
  }

  auto existing = std::find(cache->exactSnapshotOrder.begin(), cache->exactSnapshotOrder.end(), frame);
  if (existing != cache->exactSnapshotOrder.end()) {
    cache->exactSnapshotOrder.erase(existing);
  }
  cache->exactSnapshotOrder.push_back(frame);
  return &it->second;
}

const CachedSketchState::FrameSnapshot* FindNearestSnapshotAtOrBefore(CachedSketchState* cache, long frame) {
  if (!cache) {
    return NULL;
  }

  const CachedSketchState::FrameSnapshot* best = NULL;
  for (std::size_t index = 0; index < cache->checkpointOrder.size(); index += 1) {
    const long candidateFrame = cache->checkpointOrder[index];
    if (candidateFrame > frame) {
      continue;
    }
    const auto it = cache->checkpointSnapshots.find(candidateFrame);
    if (it == cache->checkpointSnapshots.end()) {
      continue;
    }
    if (it->second.runtimeStateJson.empty()) {
      continue;
    }
    if (!best || it->second.frame > best->frame) {
      best = &it->second;
    }
  }
  return best;
}

const CachedSketchState::FrameSnapshot* FindNearestRasterizedSnapshotAtOrBefore(CachedSketchState* cache, long frame) {
  if (!cache) {
    return NULL;
  }

  const CachedSketchState::FrameSnapshot* best = NULL;
  for (const auto& entry : cache->exactSnapshots) {
    if (entry.first > frame) {
      continue;
    }
    if (entry.second.raster.empty()) {
      continue;
    }
    if (!best || entry.second.frame > best->frame) {
      best = &entry.second;
    }
  }
  return best;
}

}  // namespace momentum

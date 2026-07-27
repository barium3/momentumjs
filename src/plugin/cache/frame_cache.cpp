#include "frame_cache.h"

#include <algorithm>

namespace momentum {

namespace {

std::size_t EstimateSceneBytes(const ScenePayload& scene) {
  std::size_t bytes = sizeof(ScenePayload) +
    scene.commands.capacity() * sizeof(SceneCommand);
  for (const auto& imageEntry : scene.imageAssets) {
    bytes += sizeof(imageEntry);
    bytes += ReadImagePixels(imageEntry.second).size() * sizeof(PF_Pixel);
  }
  return bytes;
}

std::size_t EstimateFrameSnapshotBytes(const CachedSketchState& cache) {
  if (cache.exactSnapshots.empty()) {
    return sizeof(CachedSketchState::FrameSnapshot);
  }
  std::size_t totalBytes = 0;
  for (const auto& entry : cache.exactSnapshots) {
    totalBytes += sizeof(CachedSketchState::FrameSnapshot) +
      EstimateSceneBytes(entry.second.scene);
  }
  return std::max<std::size_t>(
    sizeof(CachedSketchState::FrameSnapshot),
    totalBytes / cache.exactSnapshots.size()
  );
}

}  // namespace

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

}  // namespace momentum

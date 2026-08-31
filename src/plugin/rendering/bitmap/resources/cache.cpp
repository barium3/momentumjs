#include "rendering/bitmap/resources/cache_internal.h"

#include <atomic>
#include <cstring>
#include <limits>
#include <mutex>
#include <unordered_map>

namespace momentum {
namespace bitmap {
namespace resources {
namespace {

constexpr std::size_t kMaxEntriesPerInstance = 512;
constexpr std::uint64_t kFnvOffset = 1469598103934665603ull;

std::mutex gCacheMutex;
std::unordered_map<
  std::uint64_t,
  std::unordered_map<std::uint64_t, std::shared_ptr<TextAtlas>>
> gEntriesByInstance;
std::unordered_map<std::uint64_t, int> gNextImageIdByInstance;
std::atomic<std::uint64_t> gUseTick{1};

std::uint64_t HashBytes(const void* data, std::size_t size) {
  const auto* bytes = static_cast<const unsigned char*>(data);
  std::uint64_t hash = kFnvOffset;
  for (std::size_t index = 0; index < size; ++index) {
    hash ^= static_cast<std::uint64_t>(bytes[index]);
    hash *= 1099511628211ull;
  }
  return hash;
}

std::uint64_t Combine(std::uint64_t seed, std::uint64_t value) {
  seed ^= value + 0x9e3779b97f4a7c15ull + (seed << 6) + (seed >> 2);
  return seed;
}

std::uint64_t HashString(const std::string& value) {
  return HashBytes(value.data(), value.size());
}

std::uint64_t HashBool(bool value) {
  return value ? 0xf00dcafeull : 0x0badf00dull;
}

std::uint64_t HashInteger(std::int64_t value) {
  return HashBytes(&value, sizeof(value));
}

std::uint64_t HashDouble(double value) {
  std::uint64_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  return HashBytes(&bits, sizeof(bits));
}

std::uint64_t HashScalar(const ScalarSpec& spec) {
  std::uint64_t hash = kFnvOffset;
  hash = Combine(hash, HashString(spec.mode));
  hash = Combine(hash, HashDouble(spec.value));
  return hash;
}

std::uint64_t HashTransform(const Transform2D& transform) {
  std::uint64_t hash = kFnvOffset;
  hash = Combine(hash, HashDouble(transform.a));
  hash = Combine(hash, HashDouble(transform.b));
  hash = Combine(hash, HashDouble(transform.c));
  hash = Combine(hash, HashDouble(transform.d));
  hash = Combine(hash, HashDouble(transform.tx));
  hash = Combine(hash, HashDouble(transform.ty));
  return hash;
}

int AllocateImageIdLocked(std::uint64_t cacheKey) {
  // IDs count down from INT_MAX to stay disjoint from normal image assets.
  // Zero remains the "no image" sentinel.
  int& nextId = gNextImageIdByInstance[cacheKey];
  if (nextId <= 0) {
    nextId = std::numeric_limits<int>::max();
  }
  const int allocatedId = nextId;
  if (nextId > 1) {
    --nextId;
  }
  return allocatedId;
}

void TouchLocked(const std::shared_ptr<TextAtlas>& entry) {
  if (entry) {
    entry->lastUseTick = gUseTick.fetch_add(1, std::memory_order_relaxed);
  }
}

void PruneLocked(std::uint64_t cacheKey) {
  auto cacheIt = gEntriesByInstance.find(cacheKey);
  if (cacheIt == gEntriesByInstance.end()) {
    return;
  }

  auto& entries = cacheIt->second;
  while (entries.size() > kMaxEntriesPerInstance) {
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
    gEntriesByInstance.erase(cacheIt);
    gNextImageIdByInstance.erase(cacheKey);
  }
}

}  // namespace

std::uint64_t TextKey(const SceneCommand& command) {
  std::uint64_t hash = kFnvOffset;
  hash = Combine(hash, HashString(command.text));
  hash = Combine(hash, HashString(command.fontName));
  hash = Combine(hash, HashString(command.fontPath));
  hash = Combine(hash, HashString(command.fontSourceKind));
  hash = Combine(hash, HashString(command.textStyle));
  hash = Combine(hash, HashString(command.textWrap));
  hash = Combine(hash, HashScalar(command.x));
  hash = Combine(hash, HashScalar(command.y));
  hash = Combine(hash, HashScalar(command.width));
  hash = Combine(hash, HashScalar(command.height));
  hash = Combine(hash, HashBool(command.textHasWidth));
  hash = Combine(hash, HashBool(command.textHasHeight));
  hash = Combine(hash, HashDouble(command.textSize));
  hash = Combine(hash, HashDouble(command.textLeading));
  hash = Combine(hash, HashInteger(command.textAlignH));
  hash = Combine(hash, HashInteger(command.textAlignV));
  hash = Combine(hash, HashBool(command.hasFill));
  hash = Combine(hash, HashBool(command.hasStroke));
  hash = Combine(hash, HashDouble(command.strokeWeight));
  hash = Combine(hash, HashTransform(command.transform));
  return hash;
}

int ReserveImageId(std::uint64_t cacheKey) {
  const std::lock_guard<std::mutex> lock(gCacheMutex);
  return AllocateImageIdLocked(cacheKey);
}

void ReserveTextImageIds(
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

  const std::lock_guard<std::mutex> lock(gCacheMutex);
  if (needFill && outFillId) {
    *outFillId = AllocateImageIdLocked(cacheKey);
  }
  if (needStroke && outStrokeId) {
    *outStrokeId = AllocateImageIdLocked(cacheKey);
  }
}

std::shared_ptr<TextAtlas> FindText(
  std::uint64_t cacheKey,
  std::uint64_t textKey
) {
  const std::lock_guard<std::mutex> lock(gCacheMutex);
  const auto instanceIt = gEntriesByInstance.find(cacheKey);
  if (instanceIt == gEntriesByInstance.end()) {
    return nullptr;
  }
  const auto entryIt = instanceIt->second.find(textKey);
  if (entryIt == instanceIt->second.end() || !entryIt->second) {
    return nullptr;
  }
  TouchLocked(entryIt->second);
  return entryIt->second;
}

std::shared_ptr<TextAtlas> StoreText(
  std::uint64_t cacheKey,
  std::uint64_t textKey,
  std::shared_ptr<TextAtlas> entry
) {
  if (!entry) {
    return nullptr;
  }

  const std::lock_guard<std::mutex> lock(gCacheMutex);
  auto& entries = gEntriesByInstance[cacheKey];
  const auto existingIt = entries.find(textKey);
  if (existingIt != entries.end() && existingIt->second) {
    TouchLocked(existingIt->second);
    return existingIt->second;
  }

  TouchLocked(entry);
  entries[textKey] = entry;
  PruneLocked(cacheKey);
  return entry;
}

void Clear(std::uint64_t cacheKey) {
  if (cacheKey == 0) {
    return;
  }
  const std::lock_guard<std::mutex> lock(gCacheMutex);
  gEntriesByInstance.erase(cacheKey);
  gNextImageIdByInstance.erase(cacheKey);
}

void ClearAll() {
  const std::lock_guard<std::mutex> lock(gCacheMutex);
  gEntriesByInstance.clear();
  gNextImageIdByInstance.clear();
}

}  // namespace resources
}  // namespace bitmap
}  // namespace momentum

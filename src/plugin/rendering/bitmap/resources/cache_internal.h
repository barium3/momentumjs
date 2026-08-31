#pragma once

#include "rendering/bitmap/resources/cache.h"
#include "rendering/software/text.h"

#include <memory>

namespace momentum {
namespace bitmap {
namespace resources {

struct TextAtlas {
  bool hasFillAsset = false;
  RuntimeImageAsset fillAsset;
  std::vector<GlyphAtlasQuad> fillQuads;
  bool hasStrokeAsset = false;
  RuntimeImageAsset strokeAsset;
  std::vector<GlyphAtlasQuad> strokeQuads;
  std::uint64_t lastUseTick = 0;
};

std::uint64_t TextKey(const SceneCommand& command);

int ReserveImageId(std::uint64_t cacheKey);

void ReserveTextImageIds(
  std::uint64_t cacheKey,
  bool needFill,
  bool needStroke,
  int* outFillId,
  int* outStrokeId
);

std::shared_ptr<TextAtlas> FindText(
  std::uint64_t cacheKey,
  std::uint64_t textKey
);

std::shared_ptr<TextAtlas> StoreText(
  std::uint64_t cacheKey,
  std::uint64_t textKey,
  std::shared_ptr<TextAtlas> entry
);

}  // namespace resources
}  // namespace bitmap
}  // namespace momentum

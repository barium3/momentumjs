#pragma once

#include "../model/momentum_types.h"

namespace momentum {

bool LoadImageAssetFromFile(const std::string& path, int id, RuntimeImageAsset* outAsset);
RuntimeImageAsset CreateBlankImageAsset(int id, int width, int height);
bool CropImageAsset(
  const RuntimeImageAsset& source,
  int id,
  int x,
  int y,
  int width,
  int height,
  RuntimeImageAsset* outAsset
);
bool ResizeImageAsset(RuntimeImageAsset* asset, int width, int height);
bool ApplyMaskToImageAsset(RuntimeImageAsset* asset, const RuntimeImageAsset& maskAsset);
bool CopyImageAssetRegion(
  RuntimeImageAsset* destination,
  const RuntimeImageAsset& source,
  double srcX,
  double srcY,
  double srcWidth,
  double srcHeight,
  double dstX,
  double dstY,
  double dstWidth,
  double dstHeight,
  bool useBlendMode,
  int blendMode
);
bool ApplyFilterToImageAsset(RuntimeImageAsset* asset, const std::string& filterKind, double value);
PF_Pixel GetImagePixelNearest(const RuntimeImageAsset& asset, int x, int y);
PF_Pixel SampleImagePixelBilinear(const RuntimeImageAsset& asset, double x, double y);

}  // namespace momentum

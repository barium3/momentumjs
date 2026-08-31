#include "rendering/bitmap/planning/geometry.h"
#include "rendering/bitmap/planning/planner.h"
#include "rendering/bitmap/resources/cache_internal.h"

#include "rendering/software/rasterizer.h"
#include "rendering/software/text.h"

#include <array>
#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <sstream>
#include <utility>

namespace momentum {
namespace bitmap {
namespace planning {

namespace {

enum BitmapFilterKind {
  BITMAP_FILTER_NONE = 0,
  BITMAP_FILTER_GRAY = 1,
  BITMAP_FILTER_INVERT = 2,
  BITMAP_FILTER_OPAQUE = 3,
  BITMAP_FILTER_THRESHOLD = 4,
  BITMAP_FILTER_POSTERIZE = 5,
  BITMAP_FILTER_BLUR = 6,
  BITMAP_FILTER_ERODE = 7,
  BITMAP_FILTER_DILATE = 8,
};

struct AnalyticClipState {
  bool enabled = false;
  std::uint32_t contourStart = 0;
  std::uint32_t contourCount = 0;
  float minX = 0.0f;
  float minY = 0.0f;
  float maxX = 0.0f;
  float maxY = 0.0f;
};

std::string BuildUnsupportedReason(
  const SceneCommand& command,
  const std::string& commandClass,
  const std::string& detail
) {
  std::ostringstream stream;
  stream
    << "The Bitmap frame planner does not support this command yet (class=" << commandClass
    << ", type=" << command.type << "): " << detail;
  return stream.str();
}

bool IsIgnorableCommand(const SceneCommand& command) {
  return command.type == "push_state" || command.type == "pop_state";
}

bool IsIdentityTransformValue(const Transform2D& transform) {
  return
    std::fabs(transform.a - 1.0) <= 1e-6 &&
    std::fabs(transform.b) <= 1e-6 &&
    std::fabs(transform.c) <= 1e-6 &&
    std::fabs(transform.d - 1.0) <= 1e-6 &&
    std::fabs(transform.tx) <= 1e-6 &&
    std::fabs(transform.ty) <= 1e-6;
}

bool IsClipCommand(const SceneCommand& command) {
  return
    command.type == "clip_begin" ||
    command.type == "clip_end" ||
    command.clipPath;
}

int ParseBitmapFilterKind(const std::string& kind) {
  if (kind == "GRAY") {
    return BITMAP_FILTER_GRAY;
  }
  if (kind == "INVERT") {
    return BITMAP_FILTER_INVERT;
  }
  if (kind == "OPAQUE") {
    return BITMAP_FILTER_OPAQUE;
  }
  if (kind == "THRESHOLD") {
    return BITMAP_FILTER_THRESHOLD;
  }
  if (kind == "POSTERIZE") {
    return BITMAP_FILTER_POSTERIZE;
  }
  if (kind == "BLUR") {
    return BITMAP_FILTER_BLUR;
  }
  if (kind == "ERODE") {
    return BITMAP_FILTER_ERODE;
  }
  if (kind == "DILATE") {
    return BITMAP_FILTER_DILATE;
  }
  return BITMAP_FILTER_NONE;
}

int ReserveTransientImageId(std::uint64_t cacheKey) {
  return bitmap::resources::ReserveImageId(cacheKey);
}

void AppendFillBatch(
  std::size_t start,
  std::size_t end,
  std::size_t explicitEdgeStart,
  std::size_t explicitEdgeEnd,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = BitmapDrawPlan::DRAW_BATCH_FILLS;
  batch.start = start;
  batch.count = end - start;
  batch.explicitEdgeStart = explicitEdgeStart;
  batch.explicitEdgeCount = explicitEdgeEnd > explicitEdgeStart ? (explicitEdgeEnd - explicitEdgeStart) : 0;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendPathFillBatch(
  std::size_t start,
  std::size_t end,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = BitmapDrawPlan::DRAW_BATCH_PATH_FILLS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendStrokeBatch(
  std::size_t start,
  std::size_t end,
  std::size_t edgeStart,
  std::size_t edgeEnd,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = BitmapDrawPlan::DRAW_BATCH_STROKES;
  batch.start = start;
  batch.count = end - start;
  batch.explicitEdgeStart = edgeStart;
  batch.explicitEdgeCount = edgeEnd > edgeStart ? (edgeEnd - edgeStart) : 0;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void MoveStrokeGeometry(
  std::size_t triangleStart,
  std::size_t edgeStart,
  BitmapDrawPlan* plan,
  std::size_t* outStrokeTriangleStart,
  std::size_t* outStrokeEdgeStart
) {
  if (outStrokeTriangleStart) {
    *outStrokeTriangleStart = 0;
  }
  if (outStrokeEdgeStart) {
    *outStrokeEdgeStart = 0;
  }
  if (!plan) {
    return;
  }
  if (triangleStart > plan->fillTriangles.size() || edgeStart > plan->boundaryEdges.size()) {
    return;
  }
  if (outStrokeTriangleStart) {
    *outStrokeTriangleStart = plan->strokeTriangles.size();
  }
  if (outStrokeEdgeStart) {
    *outStrokeEdgeStart = plan->strokeBoundaryEdges.size();
  }
  if (triangleStart < plan->fillTriangles.size()) {
    plan->strokeTriangles.insert(
      plan->strokeTriangles.end(),
      plan->fillTriangles.begin() + static_cast<std::ptrdiff_t>(triangleStart),
      plan->fillTriangles.end()
    );
    plan->fillTriangles.resize(triangleStart);
  }
  if (edgeStart < plan->boundaryEdges.size()) {
    plan->strokeBoundaryEdges.insert(
      plan->strokeBoundaryEdges.end(),
      plan->boundaryEdges.begin() + static_cast<std::ptrdiff_t>(edgeStart),
      plan->boundaryEdges.end()
    );
    plan->boundaryEdges.resize(edgeStart);
  }
}

void AppendImageBatch(
  BitmapDrawPlan::DrawBatchType batchType,
  std::size_t start,
  std::size_t end,
  int blendMode,
  bool erase,
  float eraseStrength,
  int clipImageId,
  const AnalyticClipState& analyticClip,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = batchType;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = blendMode;
  batch.erase = erase;
  batch.eraseStrength = eraseStrength;
  batch.clipImageId = clipImageId;
  batch.hasAnalyticClip = analyticClip.enabled;
  batch.clipContourStart = analyticClip.contourStart;
  batch.clipContourCount = analyticClip.contourCount;
  batch.clipMinX = analyticClip.minX;
  batch.clipMinY = analyticClip.minY;
  batch.clipMaxX = analyticClip.maxX;
  batch.clipMaxY = analyticClip.maxY;
  plan->drawBatches.push_back(batch);
}

void AppendFilterBatch(
  std::size_t start,
  std::size_t end,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = BitmapDrawPlan::DRAW_BATCH_FILTERS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = BLEND_MODE_REPLACE;
  batch.erase = false;
  batch.eraseStrength = 1.0f;
  batch.clipImageId = 0;
  plan->drawBatches.push_back(batch);
}

void AppendMaskBatch(
  std::size_t start,
  std::size_t end,
  BitmapDrawPlan* plan
) {
  if (!plan || end <= start) {
    return;
  }
  BitmapDrawPlan::DrawBatch batch;
  batch.type = BitmapDrawPlan::DRAW_BATCH_MASKS;
  batch.start = start;
  batch.count = end - start;
  batch.blendMode = BLEND_MODE_REPLACE;
  batch.erase = false;
  batch.eraseStrength = 1.0f;
  batch.clipImageId = 0;
  plan->drawBatches.push_back(batch);
}

std::uint64_t HashAlphaMask(const std::vector<unsigned char>& alpha, int width, int height) {
  std::uint64_t hash = 1469598103934665603ull;
  const std::uint64_t prime = 1099511628211ull;
  auto hashByte = [&](unsigned char value) {
    hash ^= static_cast<std::uint64_t>(value);
    hash *= prime;
  };

  for (int shift = 0; shift < 4; shift += 1) {
    hashByte(static_cast<unsigned char>((width >> (shift * 8)) & 0xFF));
    hashByte(static_cast<unsigned char>((height >> (shift * 8)) & 0xFF));
  }

  for (std::size_t index = 0; index < alpha.size(); index += 1) {
    hashByte(alpha[index]);
  }
  return hash == 0 ? 1ull : hash;
}

bool IsDrawableCommandType(const SceneCommand& command) {
  return
    command.type == "point" ||
    command.type == "line" ||
    command.type == "path" ||
    command.type == "image" ||
    command.type == "text";
}

SceneCommand NormalizeClipMaskCommand(const SceneCommand& source) {
  SceneCommand command = source;
  command.clipPath = false;
  command.clipInvert = false;
  command.blendMode = BLEND_MODE_BLEND;
  command.eraseFill = false;
  command.eraseStroke = false;
  command.eraseFillStrength = 1.0;
  command.eraseStrokeStrength = 1.0;
  return command;
}

SceneCommand NormalizeClipSceneCommand(const SceneCommand& source) {
  SceneCommand command = NormalizeClipMaskCommand(source);
  if (command.hasFill) {
    command.fill.red = 255;
    command.fill.green = 255;
    command.fill.blue = 255;
  }
  if (command.hasStroke) {
    command.stroke.red = 255;
    command.stroke.green = 255;
    command.stroke.blue = 255;
  }
  return command;
}

bool BuildClipSceneAssetFromCommands(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  const ScenePayload& parentScene,
  const std::vector<SceneCommand>& commands,
  RuntimeImageAsset* outAsset
) {
  if (!output || !outAsset || output->width <= 0 || output->height <= 0) {
    return false;
  }

  ScenePayload clipScene;
  clipScene.canvasWidth = static_cast<double>(output->width);
  clipScene.canvasHeight = static_cast<double>(output->height);
  clipScene.imageAssets = parentScene.imageAssets;
  clipScene.commands.reserve(commands.size());
  for (std::size_t index = 0; index < commands.size(); ++index) {
    clipScene.commands.push_back(NormalizeClipSceneCommand(commands[index]));
  }

  RuntimeImageAsset clipAsset;
  clipAsset.id = ReserveTransientImageId(cacheKey);
  clipAsset.source = "gpu_clip_scene";
  clipAsset.width = output->width;
  clipAsset.height = output->height;
  clipAsset.pixelDensity = 1.0;
  clipAsset.version = static_cast<std::uint64_t>(clipAsset.id);
  clipAsset.loaded = true;
  clipAsset.sceneBacked = true;
  clipAsset.sceneSource = std::make_shared<ScenePayload>(std::move(clipScene));
  *outAsset = std::move(clipAsset);
  return true;
}

bool MaterializeClipAlphaFromAsset(
  const RuntimeImageAsset& asset,
  std::vector<unsigned char>* outAlpha
) {
  if (!outAlpha || asset.width <= 0 || asset.height <= 0) {
    return false;
  }
  if (!asset.sceneBacked || !asset.sceneSource) {
    const std::vector<PF_Pixel>& pixels = ReadImagePixels(asset);
    if (pixels.empty()) {
      return false;
    }
    outAlpha->resize(pixels.size());
    for (std::size_t index = 0; index < pixels.size(); ++index) {
      (*outAlpha)[index] = pixels[index].alpha;
    }
    return true;
  }

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(asset.width * asset.height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, asset.width, asset.height, *asset.sceneSource);
  outAlpha->resize(raster.size(), 0);
  for (std::size_t index = 0; index < raster.size(); ++index) {
    (*outAlpha)[index] = raster[index].alpha;
  }
  return true;
}

bool BuildAnalyticClipStateFromCommands(
  PF_LayerDef* output,
  const std::vector<SceneCommand>& commands,
  BitmapDrawPlan* plan,
  AnalyticClipState* outState
) {
  if (!output || !plan || !outState) {
    return false;
  }

  AnalyticClipState state;
  state.enabled = true;
  state.contourStart = static_cast<std::uint32_t>(plan->pathFillContours.size());
  state.minX = std::numeric_limits<float>::infinity();
  state.minY = std::numeric_limits<float>::infinity();
  state.maxX = -std::numeric_limits<float>::infinity();
  state.maxY = -std::numeric_limits<float>::infinity();

  auto appendContour = [&](const std::vector<std::pair<double, double>>& source) -> bool {
    if (source.size() < 3) {
      return false;
    }
    std::vector<std::pair<double, double>> contour = source;
    if (contour.size() >= 2) {
      const auto& first = contour.front();
      const auto& last = contour.back();
      if (std::fabs(first.first - last.first) <= 1e-6 &&
          std::fabs(first.second - last.second) <= 1e-6) {
        contour.pop_back();
      }
    }
    if (contour.size() < 3) {
      return false;
    }
    BitmapDrawPlan::PathFillContour contourMeta;
    contourMeta.vertexStart = static_cast<std::uint32_t>(plan->pathFillVertices.size());
    contourMeta.vertexCount = static_cast<std::uint32_t>(contour.size());
    for (const auto& point : contour) {
      BitmapDrawPlan::PathFillVertex vertex;
      vertex.x = static_cast<float>(point.first);
      vertex.y = static_cast<float>(point.second);
      plan->pathFillVertices.push_back(vertex);
      state.minX = std::min(state.minX, vertex.x);
      state.minY = std::min(state.minY, vertex.y);
      state.maxX = std::max(state.maxX, vertex.x);
      state.maxY = std::max(state.maxY, vertex.y);
    }
    plan->pathFillContours.push_back(contourMeta);
    state.contourCount += 1;
    return true;
  };

  for (const SceneCommand& command : commands) {
    if (command.type != "path") {
      return false;
    }

    std::vector<bitmap::planning::geometry::FlattenedPath> flattenedSubpaths;
    flattenedSubpaths.reserve(command.path.subpaths.size());
    for (const PathSubpath& subpath : command.path.subpaths) {
      bitmap::planning::geometry::FlattenedPath flattened =
        bitmap::planning::geometry::FlattenPath(output, command.transform, subpath);
      bitmap::planning::geometry::Normalize(&flattened);
      if (!flattened.vertices.empty()) {
        flattenedSubpaths.push_back(std::move(flattened));
      }
    }

    for (bitmap::planning::geometry::FlattenedPath& flattened : flattenedSubpaths) {
      if (flattened.vertices.size() < 3) {
        continue;
      }
      if (!flattened.closed) {
        const auto& first = flattened.vertices.front();
        const auto& last = flattened.vertices.back();
        const bool alreadyClosed =
          std::fabs(first.first - last.first) <= 1e-6 &&
          std::fabs(first.second - last.second) <= 1e-6;
        if (!alreadyClosed) {
          flattened.vertices.push_back(first);
        }
        flattened.closed = true;
      }
      appendContour(flattened.vertices);
    }
  }

  if (state.contourCount == 0 ||
      !std::isfinite(state.minX) ||
      !std::isfinite(state.minY) ||
      !std::isfinite(state.maxX) ||
      !std::isfinite(state.maxY)) {
    return false;
  }

  *outState = state;
  return true;
}

bool BuildClipMaskAlphaFromCommands(
  PF_LayerDef* output,
  const std::vector<SceneCommand>& commands,
  std::vector<unsigned char>* outAlpha
) {
  if (!output || !outAlpha || output->width <= 0 || output->height <= 0) {
    return false;
  }

  ScenePayload clipScene;
  clipScene.canvasWidth = static_cast<double>(output->width);
  clipScene.canvasHeight = static_cast<double>(output->height);
  clipScene.commands.reserve(commands.size());
  for (std::size_t index = 0; index < commands.size(); ++index) {
    clipScene.commands.push_back(NormalizeClipMaskCommand(commands[index]));
  }

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(output->width * output->height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, output->width, output->height, clipScene);
  outAlpha->resize(raster.size(), 0);
  for (std::size_t index = 0; index < raster.size(); ++index) {
    (*outAlpha)[index] = raster[index].alpha;
  }
  return true;
}

void IntersectClipMask(
  std::vector<unsigned char>* currentMask,
  const std::vector<unsigned char>& clipMask,
  bool invert
) {
  if (!currentMask) {
    return;
  }
  if (currentMask->empty()) {
    *currentMask = clipMask;
    if (invert) {
      for (std::size_t index = 0; index < currentMask->size(); ++index) {
        (*currentMask)[index] = static_cast<unsigned char>(255 - (*currentMask)[index]);
      }
    }
    return;
  }
  const std::size_t count = std::min(currentMask->size(), clipMask.size());
  for (std::size_t index = 0; index < count; ++index) {
    const int current = static_cast<int>((*currentMask)[index]);
    const int incoming = invert
      ? (255 - static_cast<int>(clipMask[index]))
      : static_cast<int>(clipMask[index]);
    const int blended = static_cast<int>((current * incoming + 127) / 255);
    (*currentMask)[index] = static_cast<unsigned char>(std::max(0, std::min(255, blended)));
  }
}

}  // namespace

bool Build(
  PF_LayerDef* output,
  std::uint64_t cacheKey,
  long targetFrame,
  const ScenePayload& scene,
  BitmapDrawPlan* outPlan,
  std::string* errorMessage
) {
  if (!output || !outPlan) {
    if (errorMessage) {
      *errorMessage = "Bitmap draw plan request is missing an output target.";
    }
    return false;
  }

  BitmapDrawPlan plan;
  plan.scene = scene;
  plan.width = output->width;
  plan.height = output->height;
  plan.cacheKey = cacheKey;
  plan.targetFrame = targetFrame;

  std::vector<std::vector<unsigned char>> clipMaskStack;
  std::vector<int> clipImageIdStack;
  std::vector<AnalyticClipState> analyticClipStack;
  std::vector<std::size_t> clipBeginIndices;
  std::vector<bool> clipInvertStack;
  std::vector<unsigned char> currentClipMask;
  int currentClipImageId = 0;
  AnalyticClipState currentAnalyticClip;

  auto updateCurrentClipAsset = [&]() -> bool {
    currentClipImageId = 0;
    if (currentClipMask.empty()) {
      return true;
    }
    RuntimeImageAsset clipAsset;
    clipAsset.id = ReserveTransientImageId(cacheKey);
    clipAsset.source = "gpu_clip_mask";
    clipAsset.width = output->width;
    clipAsset.height = output->height;
    clipAsset.pixelDensity = 1.0;
    clipAsset.version = HashAlphaMask(currentClipMask, output->width, output->height);
    clipAsset.loaded = true;
    std::vector<PF_Pixel> clipPixels(currentClipMask.size());
    for (std::size_t index = 0; index < currentClipMask.size(); ++index) {
      const unsigned char alpha = currentClipMask[index];
      clipPixels[index] = PF_Pixel{alpha, 255, 255, 255};
    }
    ReplaceImagePixels(&clipAsset, std::move(clipPixels));
    plan.scene.imageAssets[clipAsset.id] = std::move(clipAsset);
    currentClipImageId = clipAsset.id;
    return true;
  };

  auto startIndependentSurface = [&](const PF_Pixel& color) {
    plan.surfaceStart = BITMAP_SURFACE_CLEAR;
    plan.surfaceColor = color;
    plan.fillTriangles.clear();
    plan.pathFillVertices.clear();
    plan.pathFillContours.clear();
    plan.pathFills.clear();
    plan.boundaryEdges.clear();
    plan.strokeTriangles.clear();
    plan.strokeBoundaryEdges.clear();
    plan.imageDraws.clear();
    plan.filterPasses.clear();
    plan.maskPasses.clear();
    plan.drawBatches.clear();
  };

  for (std::size_t commandIndex = 0; commandIndex < scene.commands.size(); ++commandIndex) {
    const SceneCommand& command = scene.commands[commandIndex];

    if (command.type == "push_state") {
      clipMaskStack.push_back(currentClipMask);
      clipImageIdStack.push_back(currentClipImageId);
      analyticClipStack.push_back(currentAnalyticClip);
      continue;
    }
    if (command.type == "pop_state") {
      if (!clipMaskStack.empty()) {
        currentClipMask = clipMaskStack.back();
        clipMaskStack.pop_back();
        if (!clipImageIdStack.empty()) {
          currentClipImageId = clipImageIdStack.back();
          clipImageIdStack.pop_back();
        } else {
          currentClipImageId = 0;
        }
        if (!analyticClipStack.empty()) {
          currentAnalyticClip = analyticClipStack.back();
          analyticClipStack.pop_back();
        } else {
          currentAnalyticClip = AnalyticClipState{};
        }
        if (currentClipImageId == 0 && !currentClipMask.empty()) {
          if (!updateCurrentClipAsset()) {
            if (errorMessage) {
              *errorMessage = "The Bitmap frame planner failed to restore clip mask state.";
            }
            return false;
          }
        }
      }
      continue;
    }
    if (IsIgnorableCommand(command)) {
      continue;
    }

    if (command.type == "clear") {
      // Keep only commands after the latest full-surface replacement.
      startIndependentSurface(PF_Pixel{0, 0, 0, 0});
      continue;
    }

    if (command.type == "clip_begin") {
      clipBeginIndices.push_back(commandIndex);
      clipInvertStack.push_back(command.clipInvert);
      continue;
    }

    if (command.type == "clip_end") {
      if (!clipBeginIndices.empty()) {
        const std::size_t beginIndex = clipBeginIndices.back();
        const bool invert = clipInvertStack.back();
        clipBeginIndices.pop_back();
        clipInvertStack.pop_back();

        std::vector<SceneCommand> clipCommands;
        clipCommands.reserve(commandIndex > beginIndex ? (commandIndex - beginIndex - 1) : 0);
        for (std::size_t clipIndex = beginIndex + 1; clipIndex < commandIndex; ++clipIndex) {
          const SceneCommand& clipCommand = scene.commands[clipIndex];
          if (clipCommand.clipPath && IsDrawableCommandType(clipCommand)) {
            clipCommands.push_back(clipCommand);
          }
        }

        const bool canUseGpuClipScene =
          !invert &&
          currentClipImageId == 0 &&
          currentClipMask.empty() &&
          !currentAnalyticClip.enabled;
        if (canUseGpuClipScene) {
          RuntimeImageAsset clipAsset;
          if (!BuildClipSceneAssetFromCommands(output, cacheKey, scene, clipCommands, &clipAsset)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to build GPU clip scene for execution."
              );
            }
            return false;
          }
          AnalyticClipState analyticClip;
          if (!BuildAnalyticClipStateFromCommands(output, clipCommands, &plan, &analyticClip)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to build analytic clip contours."
              );
            }
            return false;
          }
          currentClipMask.clear();
          currentClipImageId = clipAsset.id;
          currentAnalyticClip = analyticClip;
          plan.scene.imageAssets[clipAsset.id] = std::move(clipAsset);
          continue;
        }

        if (currentClipMask.empty() && currentClipImageId != 0) {
          const auto currentClipAssetIt = plan.scene.imageAssets.find(currentClipImageId);
          if (currentClipAssetIt == plan.scene.imageAssets.end() ||
              !MaterializeClipAlphaFromAsset(currentClipAssetIt->second, &currentClipMask)) {
            if (errorMessage) {
              *errorMessage = BuildUnsupportedReason(
                command,
                "clip",
                "failed to materialize existing GPU clip for nested clipping."
              );
            }
            return false;
          }
          currentAnalyticClip = AnalyticClipState{};
        }

        std::vector<unsigned char> clipMask;
        if (!BuildClipMaskAlphaFromCommands(output, clipCommands, &clipMask)) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "clip",
              "failed to build clip mask for GPU execution."
            );
          }
          return false;
        }

        IntersectClipMask(&currentClipMask, clipMask, invert);
        currentAnalyticClip = AnalyticClipState{};
        if (!updateCurrentClipAsset()) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "clip",
              "failed to upload clip mask image."
            );
          }
          return false;
        }
      }
      continue;
    }

    if (command.clipPath || IsClipCommand(command)) {
      continue;
    }

    if (command.type == "background") {
      const bool backgroundErase = command.eraseFill || command.eraseStroke;
      const bool canPromoteToClear =
        command.fill.alpha >= 255 &&
        command.blendMode == BLEND_MODE_BLEND &&
        !backgroundErase &&
        currentClipImageId == 0 &&
        currentClipMask.empty() &&
        !currentAnalyticClip.enabled &&
        IsIdentityTransformValue(command.transform);
      if (canPromoteToClear) {
        startIndependentSurface(command.fill);
        continue;
      }

      const double sceneWidth = GetSceneWidth(scene, output);
      const double sceneHeight = GetSceneHeight(scene, output);
      if (!(sceneWidth > 0.0) || !(sceneHeight > 0.0)) {
        continue;
      }

      const std::size_t fillStart = plan.fillTriangles.size();
      const std::pair<double, double> topLeft = std::make_pair(0.0, 0.0);
      const std::pair<double, double> topRight = std::make_pair(sceneWidth, 0.0);
      const std::pair<double, double> bottomRight = std::make_pair(sceneWidth, sceneHeight);
      const std::pair<double, double> bottomLeft = std::make_pair(0.0, sceneHeight);
      geometry::AddTriangle(topLeft, topRight, bottomRight, command.fill, &plan);
      geometry::AddTriangle(topLeft, bottomRight, bottomLeft, command.fill, &plan);
      if (plan.fillTriangles.size() > fillStart) {
        const float eraseStrength = static_cast<float>(
          command.eraseFill ? command.eraseFillStrength : command.eraseStrokeStrength
        );
        AppendFillBatch(
          fillStart,
          plan.fillTriangles.size(),
          plan.boundaryEdges.size(),
          plan.boundaryEdges.size(),
          command.blendMode,
          backgroundErase,
          eraseStrength,
          currentClipImageId,
          currentAnalyticClip,
          &plan
        );
      }
      continue;
    }

    if (command.type == "point") {
      if (!command.hasStroke) {
        continue;
      }
      double x = ResolveScalarSpec(command.x, output);
      double y = ResolveScalarSpec(command.y, output);
      ApplyTransform(command.transform, x, y, &x, &y);
      const double halfWidth = std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
      const std::size_t fillStart = plan.fillTriangles.size();
      const std::size_t edgeStart = plan.boundaryEdges.size();
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      geometry::AddPointStroke(
        std::make_pair(x, y),
        halfWidth,
        command.strokeCap,
        command.stroke,
        &plan
      );
      MoveStrokeGeometry(fillStart, edgeStart, &plan, &strokeStart, &strokeEdgeStart);
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "line") {
      if (!command.hasStroke) {
        continue;
      }
      double x1 = ResolveScalarSpec(command.x1, output);
      double y1 = ResolveScalarSpec(command.y1, output);
      double x2 = ResolveScalarSpec(command.x2, output);
      double y2 = ResolveScalarSpec(command.y2, output);
      ApplyTransform(command.transform, x1, y1, &x1, &y1);
      ApplyTransform(command.transform, x2, y2, &x2, &y2);

      const double halfWidth = std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
      const std::size_t fillStart = plan.fillTriangles.size();
      const std::size_t edgeStart = plan.boundaryEdges.size();
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      geometry::AddPolylineStroke(
        {std::make_pair(x1, y1), std::make_pair(x2, y2)},
        false,
        halfWidth,
        command.strokeCap,
        command.strokeJoin,
        command.stroke,
        &plan
      );
      MoveStrokeGeometry(fillStart, edgeStart, &plan, &strokeStart, &strokeEdgeStart);
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "image") {
      if (command.imageId <= 0) {
        continue;
      }
      const auto assetIt = scene.imageAssets.find(command.imageId);
      if (assetIt == scene.imageAssets.end()) {
        continue;
      }
      const RuntimeImageAsset& asset = assetIt->second;
      if (!asset.loaded || asset.width <= 0 || asset.height <= 0) {
        continue;
      }

      const double destX = ResolveScalarSpec(command.x, output);
      const double destY = ResolveScalarSpec(command.y, output);
      const double destWidth = ResolveScalarSpec(command.width, output);
      const double destHeight = ResolveScalarSpec(command.height, output);
      if (!(destWidth > 0.0) || !(destHeight > 0.0)) {
        continue;
      }

      double srcX = 0.0;
      double srcY = 0.0;
      double srcWidth = static_cast<double>(asset.width);
      double srcHeight = static_cast<double>(asset.height);
      if (command.imageHasSourceRect) {
        srcX = command.imageSourceX;
        srcY = command.imageSourceY;
        srcWidth = command.imageSourceWidth;
        srcHeight = command.imageSourceHeight;
      }
      if (!(srcWidth > 0.0) || !(srcHeight > 0.0)) {
        continue;
      }

      const double invAssetWidth = 1.0 / static_cast<double>(asset.width);
      const double invAssetHeight = 1.0 / static_cast<double>(asset.height);
      const float u0 = static_cast<float>(srcX * invAssetWidth);
      const float v0 = static_cast<float>(srcY * invAssetHeight);
      const float u1 = static_cast<float>((srcX + srcWidth) * invAssetWidth);
      const float v1 = static_cast<float>((srcY + srcHeight) * invAssetHeight);

      double x1 = destX;
      double y1 = destY;
      double x2 = destX + destWidth;
      double y2 = destY;
      double x3 = destX + destWidth;
      double y3 = destY + destHeight;
      double x4 = destX;
      double y4 = destY + destHeight;
      ApplyTransform(command.transform, x1, y1, &x1, &y1);
      ApplyTransform(command.transform, x2, y2, &x2, &y2);
      ApplyTransform(command.transform, x3, y3, &x3, &y3);
      ApplyTransform(command.transform, x4, y4, &x4, &y4);

      BitmapDrawPlan::ImageDraw imageDraw;
      imageDraw.x1 = static_cast<float>(x1);
      imageDraw.y1 = static_cast<float>(y1);
      imageDraw.u1 = u0;
      imageDraw.v1 = v0;
      imageDraw.x2 = static_cast<float>(x2);
      imageDraw.y2 = static_cast<float>(y2);
      imageDraw.u2 = u1;
      imageDraw.v2 = v0;
      imageDraw.x3 = static_cast<float>(x3);
      imageDraw.y3 = static_cast<float>(y3);
      imageDraw.u3 = u1;
      imageDraw.v3 = v1;
      imageDraw.x4 = static_cast<float>(x4);
      imageDraw.y4 = static_cast<float>(y4);
      imageDraw.u4 = u0;
      imageDraw.v4 = v1;
      imageDraw.imageId = asset.id;
      imageDraw.imageVersion = asset.version;
      imageDraw.tint = command.imageHasTint ? command.imageTint : PF_Pixel{255, 255, 255, 255};
      const std::size_t imageStart = plan.imageDraws.size();
      plan.imageDraws.push_back(imageDraw);
      const bool imageErase = command.eraseFill || command.eraseStroke;
      const float imageEraseStrength = static_cast<float>(
        command.eraseFill ? command.eraseFillStrength : command.eraseStrokeStrength
      );
      AppendImageBatch(
        BitmapDrawPlan::DRAW_BATCH_IMAGES,
        imageStart,
        plan.imageDraws.size(),
        command.blendMode,
        imageErase,
        imageEraseStrength,
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
      continue;
    }

    if (command.type == "filter") {
      const int filterKind = ParseBitmapFilterKind(command.filterKind);
      if (filterKind == BITMAP_FILTER_NONE) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "filter",
            "unknown filter kind for GPU execution."
          );
        }
        return false;
      }

      BitmapDrawPlan::FilterPass pass;
      pass.filterKind = static_cast<std::int32_t>(filterKind);
      pass.value = static_cast<float>(command.filterValue);
      const std::size_t filterStart = plan.filterPasses.size();
      plan.filterPasses.push_back(pass);
      AppendFilterBatch(
        filterStart,
        plan.filterPasses.size(),
        &plan
      );
      continue;
    }

    if (command.type == "mask") {
      if (command.maskImageId <= 0) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "image",
            "mask command is missing mask image id."
          );
        }
        return false;
      }
      const auto maskIt = scene.imageAssets.find(command.maskImageId);
      if (maskIt == scene.imageAssets.end()) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "image",
            "mask command references an image asset that is not available."
          );
        }
        return false;
      }
      const RuntimeImageAsset& maskAsset = maskIt->second;
      if (!maskAsset.loaded || maskAsset.width <= 0 || maskAsset.height <= 0) {
        continue;
      }
      BitmapDrawPlan::MaskPass pass;
      pass.maskImageId = maskAsset.id;
      pass.maskImageVersion = maskAsset.version;
      const std::size_t maskStart = plan.maskPasses.size();
      plan.maskPasses.push_back(pass);
      AppendMaskBatch(maskStart, plan.maskPasses.size(), &plan);
      continue;
    }

    if (command.type == "text") {
      if (!command.hasFill && !command.hasStroke) {
        continue;
      }

      const std::uint64_t textKey = resources::TextKey(command);
      std::shared_ptr<resources::TextAtlas> cachedEntry =
        resources::FindText(plan.cacheKey, textKey);

      if (!cachedEntry) {
        auto newEntry = std::make_shared<resources::TextAtlas>();
        int fillImageId = 0;
        int strokeImageId = 0;
        resources::ReserveTextImageIds(
          plan.cacheKey,
          command.hasFill,
          command.hasStroke,
          &fillImageId,
          &strokeImageId
        );

        GlyphAtlasTextRender glyphAtlas;
        if (!BuildGlyphAtlasTextCommand(command, fillImageId, strokeImageId, &glyphAtlas)) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "text",
              "glyph atlas text generation failed for the requested font/style."
            );
          }
          return false;
        }

        if (glyphAtlas.hasFillAtlas && glyphAtlas.fillAtlas.loaded) {
          newEntry->hasFillAsset = true;
          newEntry->fillAsset = glyphAtlas.fillAtlas;
          newEntry->fillQuads = std::move(glyphAtlas.fillQuads);
        }
        if (glyphAtlas.hasStrokeAtlas && glyphAtlas.strokeAtlas.loaded) {
          newEntry->hasStrokeAsset = true;
          newEntry->strokeAsset = glyphAtlas.strokeAtlas;
          newEntry->strokeQuads = std::move(glyphAtlas.strokeQuads);
        }

        cachedEntry = resources::StoreText(plan.cacheKey, textKey, newEntry);
      }

      if (!cachedEntry) {
        continue;
      }

      auto appendTextAtlasDraw = [&](
        const RuntimeImageAsset& asset,
        const std::vector<GlyphAtlasQuad>& quads,
        const PF_Pixel& tint,
        bool erase,
        float eraseStrength
      ) -> bool {
        if (!asset.loaded || asset.id == 0 || asset.width <= 0 || asset.height <= 0 || !HasImagePixels(asset) || quads.empty()) {
          return true;
        }

        if (plan.scene.imageAssets.find(asset.id) == plan.scene.imageAssets.end()) {
          plan.scene.imageAssets[asset.id] = asset;
        }
        const RuntimeImageAsset& mappedAsset = plan.scene.imageAssets[asset.id];

        const std::size_t imageStart = plan.imageDraws.size();
        for (std::size_t quadIndex = 0; quadIndex < quads.size(); quadIndex += 1) {
          const GlyphAtlasQuad& quad = quads[quadIndex];
          BitmapDrawPlan::ImageDraw imageDraw;
          imageDraw.x1 = static_cast<float>(quad.x1);
          imageDraw.y1 = static_cast<float>(quad.y1);
          imageDraw.u1 = static_cast<float>(quad.u1);
          imageDraw.v1 = static_cast<float>(quad.v1);
          imageDraw.x2 = static_cast<float>(quad.x2);
          imageDraw.y2 = static_cast<float>(quad.y2);
          imageDraw.u2 = static_cast<float>(quad.u2);
          imageDraw.v2 = static_cast<float>(quad.v2);
          imageDraw.x3 = static_cast<float>(quad.x3);
          imageDraw.y3 = static_cast<float>(quad.y3);
          imageDraw.u3 = static_cast<float>(quad.u3);
          imageDraw.v3 = static_cast<float>(quad.v3);
          imageDraw.x4 = static_cast<float>(quad.x4);
          imageDraw.y4 = static_cast<float>(quad.y4);
          imageDraw.u4 = static_cast<float>(quad.u4);
          imageDraw.v4 = static_cast<float>(quad.v4);
          imageDraw.imageId = mappedAsset.id;
          imageDraw.imageVersion = mappedAsset.version;
          imageDraw.tint = tint;
          plan.imageDraws.push_back(imageDraw);
        }
        AppendImageBatch(
          BitmapDrawPlan::DRAW_BATCH_TEXT_IMAGES,
          imageStart,
          plan.imageDraws.size(),
          command.blendMode,
          erase,
          eraseStrength,
          currentClipImageId,
          currentAnalyticClip,
          &plan
        );
        return true;
      };

      if (command.hasFill &&
          cachedEntry->hasFillAsset &&
          !appendTextAtlasDraw(
            cachedEntry->fillAsset,
            cachedEntry->fillQuads,
            command.fill,
            command.eraseFill,
            static_cast<float>(command.eraseFillStrength)
          )) {
        return false;
      }
      if (command.hasStroke &&
          cachedEntry->hasStrokeAsset &&
          !appendTextAtlasDraw(
            cachedEntry->strokeAsset,
            cachedEntry->strokeQuads,
            command.stroke,
            command.eraseStroke,
            static_cast<float>(command.eraseStrokeStrength)
          )) {
        return false;
      }
      continue;
    }

    if (command.type != "path") {
      if (errorMessage) {
        const std::string commandClass =
          command.type == "clear"
                  ? "clear"
                  : command.type == "background"
                    ? "background"
                  : "generic";
        *errorMessage = BuildUnsupportedReason(
          command,
          commandClass,
          "this API class is not included in bitmap GPU v2 fill-first scope."
        );
      }
      return false;
    }

    if (!command.hasFill && !command.hasStroke) {
      continue;
    }

    std::vector<geometry::FlattenedPath> flattenedSubpaths;
    flattenedSubpaths.reserve(command.path.subpaths.size());
    for (std::size_t subpathIndex = 0; subpathIndex < command.path.subpaths.size(); ++subpathIndex) {
      geometry::FlattenedPath flattened =
        geometry::FlattenPath(output, command.transform, command.path.subpaths[subpathIndex]);
      geometry::Normalize(&flattened);
      if (!flattened.vertices.empty()) {
        flattenedSubpaths.push_back(std::move(flattened));
      }
    }

    if (flattenedSubpaths.empty()) {
      continue;
    }

    const std::size_t fillStart = plan.fillTriangles.size();
    const std::size_t fillEdgeStart = plan.boundaryEdges.size();
    const std::size_t pathFillStart = plan.pathFills.size();
    if (command.hasFill) {
      std::vector<std::pair<double, double>> outer;
      std::vector<std::vector<std::pair<double, double>>> holes;
      bool hasOuter = false;

      auto flushFillGroup = [&]() -> bool {
        if (!hasOuter) {
          return true;
        }

        // The common p5 primitives (rect, ellipse, triangle, quad and simple
        // beginShape polygons) are single-contour paths. Execute them through
        // the mature analytic-triangle pipeline; reserve the non-zero winding
        // path kernel for compound paths that actually contain holes. Besides
        // being cheaper, this avoids making every ordinary shape depend on the
        // more complex contour-buffer path.
        if (holes.empty()) {
          std::vector<std::pair<double, double>> simpleOuter = outer;
          if (simpleOuter.size() >= 2 &&
              geometry::SamePoint(simpleOuter.front(), simpleOuter.back())) {
            simpleOuter.pop_back();
          }
          std::vector<std::array<std::pair<double, double>, 3>> triangles;
          if (!geometry::Triangulate(simpleOuter, &triangles)) {
            return false;
          }
          for (std::size_t triangleIndex = 0;
               triangleIndex < triangles.size();
               ++triangleIndex) {
            geometry::AddTriangle(
              triangles[triangleIndex][0],
              triangles[triangleIndex][1],
              triangles[triangleIndex][2],
              command.fill,
              &plan
            );
          }
          geometry::AddBoundary(simpleOuter, &plan);
          hasOuter = false;
          outer.clear();
          holes.clear();
          return true;
        }

        auto appendContour = [&](const std::vector<std::pair<double, double>>& source) -> bool {
          if (source.size() < 3) {
            return false;
          }

          std::vector<std::pair<double, double>> contour = source;
          if (contour.size() >= 2) {
            const std::pair<double, double>& first = contour.front();
            const std::pair<double, double>& last = contour.back();
            const bool repeatedClose =
              std::fabs(first.first - last.first) <= 1e-6 &&
              std::fabs(first.second - last.second) <= 1e-6;
            if (repeatedClose) {
              contour.pop_back();
            }
          }
          if (contour.size() < 3) {
            return false;
          }

          BitmapDrawPlan::PathFillContour contourMeta;
          contourMeta.vertexStart =
            static_cast<std::uint32_t>(plan.pathFillVertices.size());
          contourMeta.vertexCount =
            static_cast<std::uint32_t>(contour.size());
          for (std::size_t vertexIndex = 0; vertexIndex < contour.size(); ++vertexIndex) {
            BitmapDrawPlan::PathFillVertex vertex;
            vertex.x = static_cast<float>(contour[vertexIndex].first);
            vertex.y = static_cast<float>(contour[vertexIndex].second);
            plan.pathFillVertices.push_back(vertex);
          }
          plan.pathFillContours.push_back(contourMeta);
          return true;
        };

        BitmapDrawPlan::PathFill pathFill;
        pathFill.contourStart =
          static_cast<std::uint32_t>(plan.pathFillContours.size());
        pathFill.contourCount = 0;
        pathFill.minX = std::numeric_limits<float>::infinity();
        pathFill.minY = std::numeric_limits<float>::infinity();
        pathFill.maxX = -std::numeric_limits<float>::infinity();
        pathFill.maxY = -std::numeric_limits<float>::infinity();
        pathFill.color = command.fill;

        auto updateBounds = [&](const std::vector<std::pair<double, double>>& contour) {
          for (std::size_t vertexIndex = 0; vertexIndex < contour.size(); ++vertexIndex) {
            const float x = static_cast<float>(contour[vertexIndex].first);
            const float y = static_cast<float>(contour[vertexIndex].second);
            pathFill.minX = std::min(pathFill.minX, x);
            pathFill.minY = std::min(pathFill.minY, y);
            pathFill.maxX = std::max(pathFill.maxX, x);
            pathFill.maxY = std::max(pathFill.maxY, y);
          }
        };

        if (appendContour(outer)) {
          updateBounds(outer);
          pathFill.contourCount += 1;
        }
        for (std::size_t holeIndex = 0; holeIndex < holes.size(); ++holeIndex) {
          if (appendContour(holes[holeIndex])) {
            updateBounds(holes[holeIndex]);
            pathFill.contourCount += 1;
          }
        }

        if (pathFill.contourCount > 0 &&
            std::isfinite(pathFill.minX) &&
            std::isfinite(pathFill.minY) &&
            std::isfinite(pathFill.maxX) &&
            std::isfinite(pathFill.maxY)) {
          plan.pathFills.push_back(pathFill);
        }

        hasOuter = false;
        outer.clear();
        holes.clear();
        return true;
      };

      for (std::size_t subpathIndex = 0; subpathIndex < flattenedSubpaths.size(); ++subpathIndex) {
        geometry::FlattenedPath flattened = flattenedSubpaths[subpathIndex];
        if (flattened.vertices.size() < 3) {
          continue;
        }
        if (!flattened.closed) {
          const std::pair<double, double>& first = flattened.vertices.front();
          const std::pair<double, double>& last = flattened.vertices.back();
          const bool alreadyClosed =
            std::fabs(first.first - last.first) <= 1e-6 &&
            std::fabs(first.second - last.second) <= 1e-6;
          if (!alreadyClosed) {
            flattened.vertices.push_back(first);
          }
          flattened.closed = true;
        }
        if (flattened.isContour) {
          if (!hasOuter) {
            // Recover gracefully: treat an orphan contour as the outer ring.
            // This avoids hard-failing the whole frame for minor authoring mismatches.
            hasOuter = true;
            outer = flattened.vertices;
            continue;
          }
          holes.push_back(flattened.vertices);
          continue;
        }

        if (!flushFillGroup()) {
          if (errorMessage) {
            *errorMessage = BuildUnsupportedReason(
              command,
              "path_fill",
              "failed to build GPU path fill command."
            );
          }
          return false;
        }
        hasOuter = true;
        outer = flattened.vertices;
      }

      if (!flushFillGroup()) {
        if (errorMessage) {
          *errorMessage = BuildUnsupportedReason(
            command,
            "path_fill",
            "failed to build GPU path fill command."
          );
        }
        return false;
      }

      if (plan.fillTriangles.size() > fillStart) {
        AppendFillBatch(
          fillStart,
          plan.fillTriangles.size(),
          fillEdgeStart,
          plan.boundaryEdges.size(),
          command.blendMode,
          command.eraseFill,
          static_cast<float>(command.eraseFillStrength),
          currentClipImageId,
          currentAnalyticClip,
          &plan
        );
      }
    }

    const std::size_t strokeFillStart = plan.fillTriangles.size();
    const std::size_t strokeEdgeSeedStart = plan.boundaryEdges.size();
    if (command.hasStroke) {
      for (std::size_t subpathIndex = 0; subpathIndex < flattenedSubpaths.size(); ++subpathIndex) {
        const geometry::FlattenedPath& flattened = flattenedSubpaths[subpathIndex];
        const double strokeHalfWidth =
          std::max(0.5, command.strokeWeight * ApproximateTransformScale(command.transform) * 0.5);
        geometry::AddPolylineStroke(
          flattened.vertices,
          flattened.closed,
          strokeHalfWidth,
          command.strokeCap,
          command.strokeJoin,
          command.stroke,
          &plan
        );
      }
    }

    if (command.hasStroke) {
      std::size_t strokeStart = 0;
      std::size_t strokeEdgeStart = 0;
      MoveStrokeGeometry(
        strokeFillStart,
        strokeEdgeSeedStart,
        &plan,
        &strokeStart,
        &strokeEdgeStart
      );
      AppendStrokeBatch(
        strokeStart,
        plan.strokeTriangles.size(),
        strokeEdgeStart,
        plan.strokeBoundaryEdges.size(),
        command.blendMode,
        command.eraseStroke,
        static_cast<float>(command.eraseStrokeStrength),
        currentClipImageId,
        currentAnalyticClip,
        &plan
      );
    }
    AppendPathFillBatch(
      pathFillStart,
      plan.pathFills.size(),
      command.blendMode,
      command.eraseFill,
      static_cast<float>(command.eraseFillStrength),
      currentClipImageId,
      currentAnalyticClip,
      &plan
    );
  }

  *outPlan = plan;
  return true;
}

void Scale(
  BitmapFramePlan* plan,
  A_long physicalWidth,
  A_long physicalHeight
) {
  if (!plan || plan->width <= 0 || plan->height <= 0 ||
      physicalWidth <= 0 || physicalHeight <= 0) {
    return;
  }

  const A_long logicalWidth = plan->logicalWidth > 0 ? plan->logicalWidth : plan->width;
  const A_long logicalHeight = plan->logicalHeight > 0 ? plan->logicalHeight : plan->height;
  const float scaleX = static_cast<float>(physicalWidth) /
    static_cast<float>(std::max<A_long>(1, logicalWidth));
  const float scaleY = static_cast<float>(physicalHeight) /
    static_cast<float>(std::max<A_long>(1, logicalHeight));
  if (std::fabs(scaleX - 1.0f) < 1e-6f &&
      std::fabs(scaleY - 1.0f) < 1e-6f) {
    plan->width = physicalWidth;
    plan->height = physicalHeight;
    return;
  }

  const float effectScale = std::max(1e-6f, std::sqrt(scaleX * scaleY));
  auto scaleTriangle = [&](BitmapDrawPlan::FillTriangle* triangle) {
    triangle->x1 *= scaleX;
    triangle->y1 *= scaleY;
    triangle->x2 *= scaleX;
    triangle->y2 *= scaleY;
    triangle->x3 *= scaleX;
    triangle->y3 *= scaleY;
  };
  auto scaleEdge = [&](BitmapDrawPlan::BoundaryEdge* edge) {
    edge->x1 *= scaleX;
    edge->y1 *= scaleY;
    edge->x2 *= scaleX;
    edge->y2 *= scaleY;
  };

  for (BitmapFramePlanOp& op : plan->operations) {
    BitmapDrawPlan& drawPlan = op.drawPlan;
    drawPlan.width = physicalWidth;
    drawPlan.height = physicalHeight;
    for (BitmapDrawPlan::FillTriangle& triangle : drawPlan.fillTriangles) {
      scaleTriangle(&triangle);
    }
    for (BitmapDrawPlan::BoundaryEdge& edge : drawPlan.boundaryEdges) {
      scaleEdge(&edge);
    }
    for (BitmapDrawPlan::FillTriangle& triangle : drawPlan.strokeTriangles) {
      scaleTriangle(&triangle);
    }
    for (BitmapDrawPlan::BoundaryEdge& edge : drawPlan.strokeBoundaryEdges) {
      scaleEdge(&edge);
    }
    for (BitmapDrawPlan::PathFillVertex& vertex : drawPlan.pathFillVertices) {
      vertex.x *= scaleX;
      vertex.y *= scaleY;
    }
    for (BitmapDrawPlan::PathFill& pathFill : drawPlan.pathFills) {
      pathFill.minX *= scaleX;
      pathFill.minY *= scaleY;
      pathFill.maxX *= scaleX;
      pathFill.maxY *= scaleY;
    }
    for (BitmapDrawPlan::ImageDraw& image : drawPlan.imageDraws) {
      image.x1 *= scaleX;
      image.y1 *= scaleY;
      image.x2 *= scaleX;
      image.y2 *= scaleY;
      image.x3 *= scaleX;
      image.y3 *= scaleY;
      image.x4 *= scaleX;
      image.y4 *= scaleY;
    }
    for (BitmapDrawPlan::FilterPass& filter : drawPlan.filterPasses) {
      // Blur is the only filter whose numeric value is a pixel radius.
      if (filter.filterKind == BITMAP_FILTER_BLUR) {
        filter.value *= effectScale;
      }
    }
    for (BitmapDrawPlan::DrawBatch& batch : drawPlan.drawBatches) {
      batch.clipMinX *= scaleX;
      batch.clipMinY *= scaleY;
      batch.clipMaxX *= scaleX;
      batch.clipMaxY *= scaleY;
    }
  }

  plan->width = physicalWidth;
  plan->height = physicalHeight;
}

}  // namespace planning
}  // namespace bitmap
}  // namespace momentum

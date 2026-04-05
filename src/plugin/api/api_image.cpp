#include "api_internal.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <string>
#include <vector>

#include "../render/render_image.h"

namespace momentum {

namespace {

struct ImageDescriptor {
  int id = 0;
  std::string source;
  std::string path;
  int width = 0;
  int height = 0;
  double pixelDensity = 1.0;
  bool loaded = false;
  std::string loadError;
};

bool IsSceneBackedAsset(const RuntimeImageAsset& asset);
bool IsActiveCanvasImageId(int imageId);
void RefreshSceneBackedCanvasAssetFromScene(int imageId);
RuntimeImageAsset* CreateSceneSnapshotAssetFromCurrentScene();
bool EnsureCpuPixelsMaterialized(RuntimeImageAsset* asset, bool dropSceneBacking = true);
std::string ToUpperCopy(const std::string& value);
std::string ToLowerCopy(const std::string& value);

std::string NormalizeImageSource(const std::string& value) {
  std::string source = value;
  std::replace(source.begin(), source.end(), '\\', '/');
  return source;
}

std::string ResolveImagePath(const std::string& source) {
  const std::filesystem::path sourcePath(source);
  if (sourcePath.is_absolute()) {
    return sourcePath.lexically_normal().string();
  }

  const std::string runtimeDirectory = runtime_internal::GetRuntimeDirectoryPath();
  if (runtimeDirectory.empty()) {
    return sourcePath.lexically_normal().string();
  }
  return (std::filesystem::path(runtimeDirectory) / sourcePath).lexically_normal().string();
}

JSValueRef MakeJsString(JSContextRef ctx, const std::string& value) {
  JSStringRef stringValue = JSStringCreateWithUTF8CString(value.c_str());
  JSValueRef result = JSValueMakeString(ctx, stringValue);
  JSStringRelease(stringValue);
  return result;
}

JSValueRef GetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name) {
  if (!ctx || !object || !name) {
    return NULL;
  }
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSValueRef value = JSObjectGetProperty(ctx, object, key, NULL);
  JSStringRelease(key);
  return value;
}

void SetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name, JSValueRef value) {
  if (!ctx || !object || !name || !value) {
    return;
  }
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, object, key, value, kJSPropertyAttributeNone, NULL);
  JSStringRelease(key);
}

JSObjectRef MakeColorArray(JSContextRef ctx, const PF_Pixel& color) {
  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  JSObjectSetPropertyAtIndex(ctx, array, 0, JSValueMakeNumber(ctx, color.red), NULL);
  JSObjectSetPropertyAtIndex(ctx, array, 1, JSValueMakeNumber(ctx, color.green), NULL);
  JSObjectSetPropertyAtIndex(ctx, array, 2, JSValueMakeNumber(ctx, color.blue), NULL);
  JSObjectSetPropertyAtIndex(ctx, array, 3, JSValueMakeNumber(ctx, color.alpha), NULL);
  return array;
}

PF_Pixel NormalizeColorArgument(JSContextRef ctx, JSValueRef value) {
  const JSValueRef arguments[] = {value};
  return ParseColorArgs(ctx, value ? 1 : 0, arguments, PF_Pixel{255, 0, 0, 0});
}

JSObjectRef MakeImageDescriptorObject(JSContextRef ctx, const ImageDescriptor& descriptor) {
  JSObjectRef object = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, object, "id", JSValueMakeNumber(ctx, descriptor.id));
  SetJsProperty(ctx, object, "source", MakeJsString(ctx, descriptor.source));
  SetJsProperty(ctx, object, "path", MakeJsString(ctx, descriptor.path));
  SetJsProperty(ctx, object, "width", JSValueMakeNumber(ctx, descriptor.width));
  SetJsProperty(ctx, object, "height", JSValueMakeNumber(ctx, descriptor.height));
  SetJsProperty(ctx, object, "pixelDensity", JSValueMakeNumber(ctx, descriptor.pixelDensity));
  SetJsProperty(ctx, object, "loaded", JSValueMakeBoolean(ctx, descriptor.loaded));
  SetJsProperty(ctx, object, "loadError", MakeJsString(ctx, descriptor.loadError));
  return object;
}

ImageDescriptor DescriptorFromAsset(const RuntimeImageAsset& asset) {
  ImageDescriptor descriptor;
  descriptor.id = asset.id;
  descriptor.source = asset.source;
  descriptor.path = asset.path;
  descriptor.width = asset.width;
  descriptor.height = asset.height;
  descriptor.pixelDensity = asset.pixelDensity;
  descriptor.loaded = asset.loaded;
  descriptor.loadError = asset.loadError;
  return descriptor;
}

bool ReadImageDescriptorObject(JSContextRef ctx, JSObjectRef object, ImageDescriptor* outDescriptor) {
  if (!ctx || !object || !outDescriptor) {
    return false;
  }

  double idValue = 0.0;
  double widthValue = 0.0;
  double heightValue = 0.0;
  double pixelDensityValue = 1.0;
  if (!JsValueToNumberSafe(ctx, GetJsProperty(ctx, object, "id"), idValue)) {
    return false;
  }
  JsValueToNumberSafe(ctx, GetJsProperty(ctx, object, "width"), widthValue);
  JsValueToNumberSafe(ctx, GetJsProperty(ctx, object, "height"), heightValue);
  JsValueToNumberSafe(ctx, GetJsProperty(ctx, object, "pixelDensity"), pixelDensityValue);

  outDescriptor->id = static_cast<int>(std::llround(idValue));
  outDescriptor->source = JsValueToStdString(ctx, GetJsProperty(ctx, object, "source"));
  outDescriptor->path = JsValueToStdString(ctx, GetJsProperty(ctx, object, "path"));
  outDescriptor->width = static_cast<int>(std::llround(widthValue));
  outDescriptor->height = static_cast<int>(std::llround(heightValue));
  outDescriptor->pixelDensity = std::max(1.0, pixelDensityValue);
  outDescriptor->loaded = JSValueToBoolean(ctx, GetJsProperty(ctx, object, "loaded"));
  outDescriptor->loadError = JsValueToStdString(ctx, GetJsProperty(ctx, object, "loadError"));
  return true;
}

bool ReadImageDescriptorValue(JSContextRef ctx, JSValueRef value, ImageDescriptor* outDescriptor) {
  if (!ctx || !value || !JSValueIsObject(ctx, value) || !outDescriptor) {
    return false;
  }
  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return false;
  }

  JSValueRef nested = GetJsProperty(ctx, object, "_imageData");
  if (nested && JSValueIsObject(ctx, nested)) {
    object = JSValueToObject(ctx, nested, NULL);
    if (!object) {
      return false;
    }
  }

  return ReadImageDescriptorObject(ctx, object, outDescriptor);
}

RuntimeImageAsset* FindRuntimeImageAsset(int imageId) {
  if (!g_activeRuntime || imageId <= 0) {
    return NULL;
  }
  auto it = g_activeRuntime->imageAssets.find(imageId);
  return it == g_activeRuntime->imageAssets.end() ? NULL : &it->second;
}

const RuntimeImageAsset* FindRuntimeImageAssetConst(int imageId) {
  if (!g_activeRuntime || imageId <= 0) {
    return NULL;
  }
  auto it = g_activeRuntime->imageAssets.find(imageId);
  return it == g_activeRuntime->imageAssets.end() ? NULL : &it->second;
}

struct CanvasExtent {
  int width = 1;
  int height = 1;
};

CanvasExtent CurrentCanvasExtent() {
  CanvasExtent extent;
  if (!g_activeRuntime) {
    return extent;
  }
  extent.width = std::max(
    1,
    static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasWidth)))
  );
  extent.height = std::max(
    1,
    static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasHeight)))
  );
  return extent;
}

int EnsureCanvasImageId() {
  if (!g_activeRuntime) {
    return 0;
  }
  if (g_activeRuntime->canvasImageId <= 0) {
    g_activeRuntime->canvasImageId = g_activeRuntime->nextImageId++;
  }
  return g_activeRuntime->canvasImageId;
}

std::uint64_t NextCanvasImageVersion(int imageId) {
  if (RuntimeImageAsset* existing = FindRuntimeImageAsset(imageId)) {
    return existing->version + 1;
  }
  return 1;
}

bool CanReuseCanvasImage(
  const RuntimeImageAsset* asset,
  const CanvasExtent& extent,
  bool requireSceneBacked
) {
  if (!asset ||
      !asset->loaded ||
      asset->width != extent.width ||
      asset->height != extent.height) {
    return false;
  }
  if (!requireSceneBacked) {
    return !IsSceneBackedAsset(*asset);
  }
  return asset->gpuSceneBacked && static_cast<bool>(asset->gpuScene);
}

RuntimeImageAsset MakeCanvasImageAsset(
  int imageId,
  const CanvasExtent& extent,
  const char* source,
  std::uint64_t version
) {
  RuntimeImageAsset asset = CreateBlankImageAsset(imageId, extent.width, extent.height);
  asset.source = source ? source : "";
  asset.path.clear();
  asset.pixelDensity = std::max(1.0, g_activeRuntime ? g_activeRuntime->pixelDensity : 1.0);
  asset.loaded = true;
  asset.loadError.clear();
  asset.version = version;
  return asset;
}

JSObjectRef MakeCurrentImageDescriptorObject(JSContextRef ctx, int imageId) {
  const RuntimeImageAsset* asset = FindRuntimeImageAssetConst(imageId);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  return MakeImageDescriptorObject(ctx, DescriptorFromAsset(*asset));
}

JSObjectRef CloneImageAssetToRuntime(JSContextRef ctx, const RuntimeImageAsset& source) {
  if (!g_activeRuntime) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  RuntimeImageAsset clone = source;
  clone.id = g_activeRuntime->nextImageId++;
  g_activeRuntime->imageAssets[clone.id] = clone;
  return MakeImageDescriptorObject(ctx, DescriptorFromAsset(clone));
}

void ReplaceSceneWithCanvasImage(const RuntimeImageAsset& asset) {
  if (!g_activeRuntime) {
    return;
  }

  g_activeRuntime->scene.clearsSurface = true;
  g_activeRuntime->scene.hasBackground = false;
  g_activeRuntime->scene.background = PF_Pixel{0, 0, 0, 0};
  g_activeRuntime->scene.imageAssets.clear();
  ClearSceneCommands(g_activeRuntime);

  SceneCommand command;
  command.type = "image";
  command.imageId = asset.id;
  command.x = {"pixels", 0.0};
  command.y = {"pixels", 0.0};
  command.width = {"pixels", static_cast<double>(asset.width)};
  command.height = {"pixels", static_cast<double>(asset.height)};
  command.imageHasSourceRect = false;
  command.imageHasTint = false;
  command.blendMode = BLEND_MODE_BLEND;
  g_activeRuntime->scene.imageAssets[asset.id] = asset;
  AppendSceneCommand(g_activeRuntime, command);
}

void SyncCanvasSceneAsset(int imageId) {
  if (!g_activeRuntime || imageId <= 0 || g_activeRuntime->canvasImageId != imageId) {
    return;
  }
  const RuntimeImageAsset* asset = FindRuntimeImageAssetConst(imageId);
  if (!asset) {
    return;
  }
  if (IsSceneBackedAsset(*asset) && IsActiveCanvasImageId(imageId)) {
    RefreshSceneBackedCanvasAssetFromScene(imageId);
    return;
  }
  // Once the active canvas is mutated through pixel APIs, the visible scene
  // must be the bitmap asset itself. Merely syncing imageAssets leaves the
  // scene with no image draw command, which produces static/empty output.
  ReplaceSceneWithCanvasImage(*asset);
  MarkSceneDirty(g_activeRuntime);
  g_activeRuntime->canvasImageSceneVersion = g_activeRuntime->sceneVersion;
}

RuntimeImageAsset* SnapshotSceneToCanvasImage() {
  if (!g_activeRuntime) {
    return NULL;
  }

  const CanvasExtent extent = CurrentCanvasExtent();
  const int imageId = EnsureCanvasImageId();
  if (imageId > 0 &&
      g_activeRuntime->canvasImageSceneVersion == g_activeRuntime->sceneVersion) {
    RuntimeImageAsset* existing = FindRuntimeImageAsset(imageId);
    if (existing && existing->loaded && existing->width == extent.width && existing->height == extent.height) {
      return existing;
    }
  }

  RuntimeImageAsset asset =
    MakeCanvasImageAsset(imageId, extent, "__canvas__", NextCanvasImageVersion(imageId));

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(extent.width * extent.height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, extent.width, extent.height, g_activeRuntime->scene);
  asset.pixels.swap(raster);

  g_activeRuntime->imageAssets[imageId] = asset;
  ReplaceSceneWithCanvasImage(g_activeRuntime->imageAssets[imageId]);
  g_activeRuntime->canvasImageSceneVersion = g_activeRuntime->sceneVersion;
  return &g_activeRuntime->imageAssets[imageId];
}

RuntimeImageAsset* GetOrCreateSceneBackedCanvasImage() {
  if (!g_activeRuntime) {
    return NULL;
  }

  const CanvasExtent extent = CurrentCanvasExtent();
  const int imageId = EnsureCanvasImageId();
  if (imageId > 0 &&
      g_activeRuntime->canvasImageSceneVersion == g_activeRuntime->sceneVersion) {
    RuntimeImageAsset* existing = FindRuntimeImageAsset(imageId);
    if (CanReuseCanvasImage(existing, extent, true)) {
      return existing;
    }
  }

  RuntimeImageAsset asset =
    MakeCanvasImageAsset(imageId, extent, "__canvas_scene__", NextCanvasImageVersion(imageId));
  asset.pixels.clear();
  asset.gpuSceneBacked = true;
  asset.gpuScene = std::make_shared<ScenePayload>(g_activeRuntime->scene);
  if (asset.gpuScene) {
    asset.gpuScene->imageAssets.erase(imageId);
  }

  g_activeRuntime->imageAssets[imageId] = asset;
  g_activeRuntime->canvasImageSceneVersion = g_activeRuntime->sceneVersion;
  return &g_activeRuntime->imageAssets[imageId];
}

RuntimeImageAsset* GetOrCreateMutableCanvasImage() {
  if (!g_activeRuntime) {
    return NULL;
  }

  if (g_activeRuntime->activeGraphicsId > 0) {
    g_activeRuntime->graphicsBitmapMode = true;
    g_activeRuntime->graphicsBitmapTouchedThisSession = true;
  }

  const CanvasExtent extent = CurrentCanvasExtent();
  const int imageId = g_activeRuntime->canvasImageId;
  if (imageId > 0 &&
      g_activeRuntime->canvasImageSceneVersion == g_activeRuntime->sceneVersion) {
    RuntimeImageAsset* existing = FindRuntimeImageAsset(imageId);
    if (CanReuseCanvasImage(existing, extent, false)) {
      return existing;
    }
  }

  return SnapshotSceneToCanvasImage();
}

bool IsSceneBackedAsset(const RuntimeImageAsset& asset) {
  return asset.gpuSceneBacked && static_cast<bool>(asset.gpuScene);
}

bool IsActiveCanvasImageId(int imageId) {
  return g_activeRuntime && imageId > 0 && g_activeRuntime->canvasImageId == imageId;
}

void RefreshSceneBackedCanvasAssetFromScene(int imageId) {
  if (!IsActiveCanvasImageId(imageId)) {
    return;
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(imageId);
  if (!asset) {
    return;
  }

  const int canvasWidth = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasWidth))));
  const int canvasHeight = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasHeight))));
  asset->width = canvasWidth;
  asset->height = canvasHeight;
  asset->loaded = true;
  asset->gpuSceneBacked = true;
  asset->gpuScene = std::make_shared<ScenePayload>(g_activeRuntime->scene);
  if (asset->gpuScene) {
    asset->gpuScene->imageAssets.erase(imageId);
  }
  asset->pixels.clear();
  asset->version += 1;
  g_activeRuntime->canvasImageSceneVersion = g_activeRuntime->sceneVersion;
}

RuntimeImageAsset* CreateSceneSnapshotAssetFromCurrentScene() {
  if (!g_activeRuntime) {
    return NULL;
  }
  const int imageId = g_activeRuntime->nextImageId++;
  const int canvasWidth = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasWidth))));
  const int canvasHeight = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasHeight))));
  RuntimeImageAsset asset = CreateBlankImageAsset(imageId, canvasWidth, canvasHeight);
  asset.source = "__canvas_snapshot_scene__";
  asset.path.clear();
  asset.pixelDensity = std::max(1.0, g_activeRuntime->pixelDensity);
  asset.loaded = true;
  asset.gpuSceneBacked = true;
  asset.gpuScene = std::make_shared<ScenePayload>(g_activeRuntime->scene);
  if (asset.gpuScene) {
    asset.gpuScene->imageAssets.erase(imageId);
  }
  asset.pixels.clear();
  g_activeRuntime->imageAssets[imageId] = asset;
  return &g_activeRuntime->imageAssets[imageId];
}

bool EnsureCpuPixelsMaterialized(RuntimeImageAsset* asset, bool dropSceneBacking) {
  if (!asset || !asset->loaded || asset->width <= 0 || asset->height <= 0) {
    return false;
  }
  if (!IsSceneBackedAsset(*asset)) {
    return true;
  }
  if (asset->gpuScene && asset->pixels.empty()) {
    std::vector<PF_Pixel> raster(
      static_cast<std::size_t>(asset->width * asset->height),
      PF_Pixel{0, 0, 0, 0}
    );
    ApplySceneToRaster8(&raster, asset->width, asset->height, *asset->gpuScene);
    asset->pixels.swap(raster);
  }
  if (dropSceneBacking) {
    asset->gpuSceneBacked = false;
    asset->gpuScene.reset();
  }
  return true;
}

std::string ToUpperCopy(const std::string& value) {
  std::string upper = value;
  std::transform(upper.begin(), upper.end(), upper.begin(), [](unsigned char c) {
    return static_cast<char>(std::toupper(c));
  });
  return upper;
}

std::string ToLowerCopy(const std::string& value) {
  std::string lower = value;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return lower;
}

void NormalizeImageRect(int mode, double* x, double* y, double* width, double* height) {
  if (!x || !y || !width || !height) {
    return;
  }

  if (mode == SHAPE_MODE_CENTER) {
    *x -= *width * 0.5;
    *y -= *height * 0.5;
  } else if (mode == SHAPE_MODE_CORNERS) {
    *width -= *x;
    *height -= *y;
  }

  if (*width < 0.0) {
    *x += *width;
    *width = -*width;
  }
  if (*height < 0.0) {
    *y += *height;
    *height = -*height;
  }
}

int NormalizeImageModeValue(long value, int fallback) {
  switch (value) {
    case SHAPE_MODE_CORNER:
    case SHAPE_MODE_CORNERS:
    case SHAPE_MODE_CENTER:
      return static_cast<int>(value);
    default:
      return fallback;
  }
}

int NormalizeBlendModeValue(long value, int fallback) {
  switch (value) {
    case BLEND_MODE_BLEND:
    case BLEND_MODE_ADD:
    case BLEND_MODE_DARKEST:
    case BLEND_MODE_LIGHTEST:
    case BLEND_MODE_DIFFERENCE:
    case BLEND_MODE_EXCLUSION:
    case BLEND_MODE_MULTIPLY:
    case BLEND_MODE_SCREEN:
    case BLEND_MODE_REPLACE:
    case BLEND_MODE_REMOVE:
    case BLEND_MODE_OVERLAY:
    case BLEND_MODE_HARD_LIGHT:
    case BLEND_MODE_SOFT_LIGHT:
    case BLEND_MODE_DODGE:
    case BLEND_MODE_BURN:
      return static_cast<int>(value);
    default:
      return fallback;
  }
}

std::vector<unsigned char> ReadPixelBytes(JSContextRef ctx, JSValueRef value) {
  std::vector<unsigned char> result;
  if (!ctx || !value || !JSValueIsObject(ctx, value)) {
    return result;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return result;
  }

  JSStringRef lengthKey = JSStringCreateWithUTF8CString("length");
  JSValueRef lengthValue = JSObjectGetProperty(ctx, object, lengthKey, NULL);
  JSStringRelease(lengthKey);
  double lengthNumber = 0.0;
  if (!JsValueToNumberSafe(ctx, lengthValue, lengthNumber) || lengthNumber <= 0.0) {
    return result;
  }

  const std::size_t length = static_cast<std::size_t>(std::floor(lengthNumber));
  result.resize(length, 0);
  for (std::size_t i = 0; i < length; ++i) {
    double channel = 0.0;
    if (JsValueToNumberSafe(ctx, JSObjectGetPropertyAtIndex(ctx, object, static_cast<unsigned>(i), NULL), channel)) {
      result[i] = static_cast<unsigned char>(std::round(std::max(0.0, std::min(255.0, channel))));
    }
  }
  return result;
}

void WritePixelsToAsset(RuntimeImageAsset* asset, const std::vector<unsigned char>& values, int x, int y, int width, int height) {
  if (!asset || !asset->loaded || asset->width <= 0 || asset->height <= 0) {
    return;
  }

  const int regionX = std::max(0, x);
  const int regionY = std::max(0, y);
  const int regionWidth = std::max(0, width);
  const int regionHeight = std::max(0, height);
  if (regionWidth <= 0 || regionHeight <= 0) {
    return;
  }

  const std::size_t wholeImageLength =
    static_cast<std::size_t>(std::max(0, asset->width) * std::max(0, asset->height) * 4);
  const std::size_t regionLength =
    static_cast<std::size_t>(regionWidth * regionHeight * 4);
  const bool usesWholeImageBuffer = values.size() >= wholeImageLength;
  const bool usesRegionBuffer = values.size() >= regionLength;
  if (!usesWholeImageBuffer && !usesRegionBuffer) {
    return;
  }

  for (int row = 0; row < regionHeight; ++row) {
    for (int col = 0; col < regionWidth; ++col) {
      const int dstX = regionX + col;
      const int dstY = regionY + row;
      if (dstX < 0 || dstY < 0 || dstX >= asset->width || dstY >= asset->height) {
        continue;
      }

      const std::size_t srcIndex = usesWholeImageBuffer
        ? static_cast<std::size_t>((dstY * asset->width + dstX) * 4)
        : static_cast<std::size_t>((row * regionWidth + col) * 4);
      if (srcIndex + 3 >= values.size()) {
        return;
      }
      const std::size_t dstIndex = static_cast<std::size_t>(dstY * asset->width + dstX);
      asset->pixels[dstIndex] = PF_Pixel{
        values[srcIndex + 3],
        values[srcIndex + 0],
        values[srcIndex + 1],
        values[srcIndex + 2],
      };
    }
  }
  asset->gpuSceneBacked = false;
  asset->gpuScene.reset();
  asset->version += 1;
}

JSObjectRef MakePixelsArray(JSContextRef ctx, const RuntimeImageAsset& asset) {
  JSObjectRef array = JSObjectMakeArray(ctx, 0, NULL, NULL);
  if (!asset.loaded) {
    return array;
  }

  for (std::size_t i = 0; i < asset.pixels.size(); ++i) {
    const unsigned baseIndex = static_cast<unsigned>(i * 4);
    JSObjectSetPropertyAtIndex(ctx, array, baseIndex + 0, JSValueMakeNumber(ctx, asset.pixels[i].red), NULL);
    JSObjectSetPropertyAtIndex(ctx, array, baseIndex + 1, JSValueMakeNumber(ctx, asset.pixels[i].green), NULL);
    JSObjectSetPropertyAtIndex(ctx, array, baseIndex + 2, JSValueMakeNumber(ctx, asset.pixels[i].blue), NULL);
    JSObjectSetPropertyAtIndex(ctx, array, baseIndex + 3, JSValueMakeNumber(ctx, asset.pixels[i].alpha), NULL);
  }
  return array;
}

}  // namespace

JSValueRef JsImageMode(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 1) {
    return JSValueMakeUndefined(ctx);
  }

  long mode = g_activeRuntime->imageMode;
  if (JsValueToLongSafe(ctx, arguments[0], mode)) {
    g_activeRuntime->imageMode = NormalizeImageModeValue(mode, g_activeRuntime->imageMode);
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsPixelDensity(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeNumber(ctx, 1.0);
  }
  if (argumentCount > 0) {
    double nextDensity = g_activeRuntime->pixelDensity;
    if (JsValueToNumberSafe(ctx, arguments[0], nextDensity) && std::isfinite(nextDensity) && !std::isnan(nextDensity)) {
      g_activeRuntime->pixelDensity = std::max(1.0, nextDensity);
    }
  }
  return JSValueMakeNumber(ctx, g_activeRuntime->pixelDensity);
}

JSValueRef JsTint(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime) {
    return JSValueMakeUndefined(ctx);
  }
  g_activeRuntime->currentImageTint = ParseColorArgs(ctx, argumentCount, arguments, g_activeRuntime->currentImageTint);
  g_activeRuntime->imageTintEnabled = true;
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsNoTint(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)argumentCount;
  (void)arguments;
  (void)exception;
  if (g_activeRuntime) {
    g_activeRuntime->imageTintEnabled = false;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 3) {
    return JSValueMakeUndefined(ctx);
  }

  ImageDescriptor descriptor;
  if (!ReadImageDescriptorValue(ctx, arguments[0], &descriptor) || !descriptor.loaded) {
    return JSValueMakeUndefined(ctx);
  }

  const RuntimeImageAsset* asset = FindRuntimeImageAssetConst(descriptor.id);
  if (!asset || !asset->loaded) {
    return JSValueMakeUndefined(ctx);
  }

  double x = 0.0;
  double y = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[1], x) || !JsValueToNumberSafe(ctx, arguments[2], y)) {
    return JSValueMakeUndefined(ctx);
  }

  double width = static_cast<double>(asset->width);
  double height = static_cast<double>(asset->height);
  double srcX = 0.0;
  double srcY = 0.0;
  double srcWidth = static_cast<double>(asset->width);
  double srcHeight = static_cast<double>(asset->height);
  bool hasSourceRect = false;

  if (argumentCount >= 5) {
    if (!JsValueToNumberSafe(ctx, arguments[3], width) || !JsValueToNumberSafe(ctx, arguments[4], height)) {
      return JSValueMakeUndefined(ctx);
    }
  }
  if (argumentCount >= 9) {
    if (!JsValueToNumberSafe(ctx, arguments[5], srcX) ||
        !JsValueToNumberSafe(ctx, arguments[6], srcY) ||
        !JsValueToNumberSafe(ctx, arguments[7], srcWidth) ||
        !JsValueToNumberSafe(ctx, arguments[8], srcHeight)) {
      return JSValueMakeUndefined(ctx);
    }
    hasSourceRect = true;
  }

  NormalizeImageRect(g_activeRuntime->imageMode, &x, &y, &width, &height);

  SceneCommand command;
  command.type = "image";
  command.imageId = asset->id;
  command.x = {"pixels", x};
  command.y = {"pixels", y};
  command.width = {"pixels", width};
  command.height = {"pixels", height};
  command.imageHasSourceRect = hasSourceRect;
  command.imageSourceX = srcX;
  command.imageSourceY = srcY;
  command.imageSourceWidth = srcWidth;
  command.imageSourceHeight = srcHeight;
  command.imageHasTint = g_activeRuntime->imageTintEnabled;
  command.imageTint = g_activeRuntime->currentImageTint;
  command.blendMode = g_activeRuntime->blendMode;
  command.transform = g_activeRuntime->currentTransform;
  g_activeRuntime->scene.imageAssets[asset->id] = *asset;
  AppendSceneCommand(g_activeRuntime, command);
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsMomentumNativeLoadImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 1) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  const std::string normalizedSource = NormalizeImageSource(JsValueToStdString(ctx, arguments[0]));
  const std::string resolvedPath = ResolveImagePath(normalizedSource);
  const int imageId = g_activeRuntime->nextImageId++;
  RuntimeImageAsset asset;
  asset.id = imageId;
  asset.source = normalizedSource;
  asset.path = resolvedPath;
  asset.pixelDensity = 1.0;
  LoadImageAssetFromFile(resolvedPath, imageId, &asset);
  asset.source = normalizedSource;
  asset.path = resolvedPath;
  g_activeRuntime->imageAssets[imageId] = asset;
  return MakeImageDescriptorObject(ctx, DescriptorFromAsset(asset));
}

JSValueRef JsMomentumNativeBackgroundImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  if (!g_activeRuntime || argumentCount < 1 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor) || !descriptor.loaded) {
    return JSValueMakeUndefined(ctx);
  }

  const RuntimeImageAsset* asset = FindRuntimeImageAssetConst(descriptor.id);
  if (!asset || !asset->loaded) {
    return JSValueMakeUndefined(ctx);
  }

  double alpha = 255.0;
  if (argumentCount > 1) {
    JsValueToNumberSafe(ctx, arguments[1], alpha);
  }

  g_activeRuntime->scene.clearsSurface = true;
  g_activeRuntime->scene.hasBackground = false;
  g_activeRuntime->scene.background = PF_Pixel{0, 0, 0, 0};
  ClearSceneCommands(g_activeRuntime);
  g_activeRuntime->scene.imageAssets.clear();

  SceneCommand command;
  command.type = "image";
  command.imageId = asset->id;
  command.x = {"pixels", 0.0};
  command.y = {"pixels", 0.0};
  command.width = {"pixels", std::max(1.0, g_activeRuntime->scene.canvasWidth)};
  command.height = {"pixels", std::max(1.0, g_activeRuntime->scene.canvasHeight)};
  command.imageHasSourceRect = false;
  command.imageHasTint = std::round(std::max(0.0, std::min(255.0, alpha))) < 255.0;
  command.imageTint = PF_Pixel{
    static_cast<A_u_char>(std::round(std::max(0.0, std::min(255.0, alpha)))),
    255,
    255,
    255
  };
  command.blendMode = BLEND_MODE_BLEND;
  command.transform = g_activeRuntime->currentTransform;
  g_activeRuntime->scene.imageAssets[asset->id] = *asset;
  AppendSceneCommand(g_activeRuntime, command);

  if (g_activeRuntime->canvasImageId == asset->id) {
    g_activeRuntime->canvasImageId = 0;
    g_activeRuntime->canvasImageSceneVersion = 0;
  }
  return JSValueMakeUndefined(ctx);
}

JSValueRef JsMomentumNativeCreateImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 2) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  double width = 0.0;
  double height = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], width) || !JsValueToNumberSafe(ctx, arguments[1], height)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  const int imageId = g_activeRuntime->nextImageId++;
  RuntimeImageAsset asset = CreateBlankImageAsset(
    imageId,
    std::max(0, static_cast<int>(std::floor(width))),
    std::max(0, static_cast<int>(std::floor(height)))
  );
  asset.pixelDensity = 1.0;
  g_activeRuntime->imageAssets[imageId] = asset;
  return MakeImageDescriptorObject(ctx, DescriptorFromAsset(asset));
}

JSValueRef JsMomentumNativeImageLoadPixels(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  if (argumentCount < 1 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor)) {
    return JSObjectMakeArray(ctx, 0, NULL, NULL);
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (!asset) {
    return JSObjectMakeArray(ctx, 0, NULL, NULL);
  }
  EnsureCpuPixelsMaterialized(asset, false);
  return MakePixelsArray(ctx, *asset);
}

JSValueRef JsMomentumNativeImageUpdatePixels(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  if (argumentCount < 2 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  if (IsSceneBackedAsset(*asset) && IsActiveCanvasImageId(asset->id)) {
    asset = SnapshotSceneToCanvasImage();
  } else {
    EnsureCpuPixelsMaterialized(asset);
  }
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  int x = 0;
  int y = 0;
  int width = asset->width;
  int height = asset->height;
  if (argumentCount >= 6) {
    double xValue = 0.0;
    double yValue = 0.0;
    double widthValue = 0.0;
    double heightValue = 0.0;
    if (JsValueToNumberSafe(ctx, arguments[2], xValue)) x = static_cast<int>(std::floor(xValue));
    if (JsValueToNumberSafe(ctx, arguments[3], yValue)) y = static_cast<int>(std::floor(yValue));
    if (JsValueToNumberSafe(ctx, arguments[4], widthValue)) width = static_cast<int>(std::floor(widthValue));
    if (JsValueToNumberSafe(ctx, arguments[5], heightValue)) height = static_cast<int>(std::floor(heightValue));
  }
  WritePixelsToAsset(asset, ReadPixelBytes(ctx, arguments[1]), x, y, width, height);
  SyncCanvasSceneAsset(asset->id);
  return MakeCurrentImageDescriptorObject(ctx, asset->id);
}

JSValueRef JsMomentumNativeImageClone(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  if (argumentCount < 1 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  const RuntimeImageAsset* asset = FindRuntimeImageAssetConst(descriptor.id);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  return CloneImageAssetToRuntime(ctx, *asset);
}

JSValueRef JsMomentumNativeImageGetPixel(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  double x = 0.0;
  double y = 0.0;
  if (argumentCount < 3 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor) ||
      !JsValueToNumberSafe(ctx, arguments[1], x) || !JsValueToNumberSafe(ctx, arguments[2], y)) {
    return MakeColorArray(ctx, PF_Pixel{0, 0, 0, 0});
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (asset) {
    EnsureCpuPixelsMaterialized(asset, false);
  }
  return MakeColorArray(
    ctx,
    asset ? GetImagePixelNearest(*asset, static_cast<int>(std::floor(x)), static_cast<int>(std::floor(y))) : PF_Pixel{0, 0, 0, 0}
  );
}

JSValueRef JsMomentumNativeImageGetRegion(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  double x = 0.0;
  double y = 0.0;
  double width = 0.0;
  double height = 0.0;
  if (argumentCount < 5 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor) ||
      !JsValueToNumberSafe(ctx, arguments[1], x) ||
      !JsValueToNumberSafe(ctx, arguments[2], y) ||
      !JsValueToNumberSafe(ctx, arguments[3], width) ||
      !JsValueToNumberSafe(ctx, arguments[4], height)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (asset) {
    EnsureCpuPixelsMaterialized(asset, false);
  }
  if (!asset || !g_activeRuntime) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  RuntimeImageAsset cropped;
  const int imageId = g_activeRuntime->nextImageId++;
  CropImageAsset(
    *asset,
    imageId,
    static_cast<int>(std::floor(x)),
    static_cast<int>(std::floor(y)),
    std::max(0, static_cast<int>(std::floor(width))),
    std::max(0, static_cast<int>(std::floor(height))),
    &cropped
  );
  g_activeRuntime->imageAssets[imageId] = cropped;
  return MakeImageDescriptorObject(ctx, DescriptorFromAsset(cropped));
}

JSValueRef JsMomentumNativeImageSetColor(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  double x = 0.0;
  double y = 0.0;
  if (argumentCount < 4 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor) ||
      !JsValueToNumberSafe(ctx, arguments[1], x) || !JsValueToNumberSafe(ctx, arguments[2], y)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  if (IsSceneBackedAsset(*asset) && IsActiveCanvasImageId(asset->id)) {
    asset = SnapshotSceneToCanvasImage();
  } else {
    EnsureCpuPixelsMaterialized(asset);
  }
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  const int pixelX = static_cast<int>(std::floor(x));
  const int pixelY = static_cast<int>(std::floor(y));
  if (pixelX >= 0 && pixelY >= 0 && pixelX < asset->width && pixelY < asset->height) {
    asset->pixels[static_cast<std::size_t>(pixelY * asset->width + pixelX)] = NormalizeColorArgument(ctx, arguments[3]);
    asset->version += 1;
  }
  SyncCanvasSceneAsset(asset->id);
  return MakeCurrentImageDescriptorObject(ctx, asset->id);
}

JSValueRef JsMomentumNativeImageSetImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor targetDescriptor;
  ImageDescriptor sourceDescriptor;
  double x = 0.0;
  double y = 0.0;
  if (argumentCount < 4 || !ReadImageDescriptorValue(ctx, arguments[0], &targetDescriptor) ||
      !JsValueToNumberSafe(ctx, arguments[1], x) ||
      !JsValueToNumberSafe(ctx, arguments[2], y) ||
      !ReadImageDescriptorValue(ctx, arguments[3], &sourceDescriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* target = FindRuntimeImageAsset(targetDescriptor.id);
  RuntimeImageAsset* source = FindRuntimeImageAsset(sourceDescriptor.id);
  if (!target || !source) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  if (IsSceneBackedAsset(*target) && IsActiveCanvasImageId(target->id)) {
    target = SnapshotSceneToCanvasImage();
  } else {
    EnsureCpuPixelsMaterialized(target);
  }
  EnsureCpuPixelsMaterialized(source, false);
  if (!target || !source) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  CopyImageAssetRegion(
    target,
    *source,
    0.0,
    0.0,
    static_cast<double>(source->width),
    static_cast<double>(source->height),
    x,
    y,
    static_cast<double>(source->width),
    static_cast<double>(source->height),
    false,
    BLEND_MODE_REPLACE
  );
  SyncCanvasSceneAsset(target->id);
  return MakeCurrentImageDescriptorObject(ctx, target->id);
}

JSValueRef JsMomentumNativeImageResize(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  double width = 0.0;
  double height = 0.0;
  if (argumentCount < 3 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor) ||
      !JsValueToNumberSafe(ctx, arguments[1], width) || !JsValueToNumberSafe(ctx, arguments[2], height)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  if (IsSceneBackedAsset(*asset) && IsActiveCanvasImageId(asset->id)) {
    asset = SnapshotSceneToCanvasImage();
  } else {
    EnsureCpuPixelsMaterialized(asset);
  }
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  ResizeImageAsset(asset, static_cast<int>(std::round(width)), static_cast<int>(std::round(height)));
  SyncCanvasSceneAsset(asset->id);
  return MakeCurrentImageDescriptorObject(ctx, asset->id);
}

JSValueRef JsMomentumNativeImageMask(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor targetDescriptor;
  ImageDescriptor maskDescriptor;
  if (argumentCount < 2 || !ReadImageDescriptorValue(ctx, arguments[0], &targetDescriptor) ||
      !ReadImageDescriptorValue(ctx, arguments[1], &maskDescriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* target = FindRuntimeImageAsset(targetDescriptor.id);
  RuntimeImageAsset* mask = FindRuntimeImageAsset(maskDescriptor.id);
  if (!target || !mask) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  if (IsSceneBackedAsset(*target) && IsActiveCanvasImageId(target->id)) {
    RuntimeImageAsset* maskAsset = mask;
    if (maskAsset->id == target->id) {
      maskAsset = CreateSceneSnapshotAssetFromCurrentScene();
      if (!maskAsset) {
        return MakeCurrentImageDescriptorObject(ctx, target->id);
      }
    }

    SceneCommand command;
    command.type = "mask";
    command.maskImageId = maskAsset->id;
    AppendSceneCommand(g_activeRuntime, command);
    g_activeRuntime->scene.imageAssets[maskAsset->id] = *maskAsset;
    RefreshSceneBackedCanvasAssetFromScene(target->id);
    return MakeCurrentImageDescriptorObject(ctx, target->id);
  }

  EnsureCpuPixelsMaterialized(target);
  EnsureCpuPixelsMaterialized(mask, false);
  if (!target || !mask) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  ApplyMaskToImageAsset(target, *mask);
  SyncCanvasSceneAsset(target->id);
  return MakeCurrentImageDescriptorObject(ctx, target->id);
}

JSValueRef JsMomentumNativeImageCopy(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor targetDescriptor;
  if (argumentCount < 10 || !ReadImageDescriptorValue(ctx, arguments[0], &targetDescriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* target = FindRuntimeImageAsset(targetDescriptor.id);
  if (!target) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  RuntimeImageAsset* source = target;
  int numberStartIndex = 1;
  ImageDescriptor sourceDescriptor;
  if (ReadImageDescriptorValue(ctx, arguments[1], &sourceDescriptor)) {
    source = FindRuntimeImageAsset(sourceDescriptor.id);
    numberStartIndex = 2;
  }
  if (!source || argumentCount < static_cast<std::size_t>(numberStartIndex + 8)) {
    return MakeCurrentImageDescriptorObject(ctx, target->id);
  }

  std::vector<double> values;
  for (int i = 0; i < 8; ++i) {
    double number = 0.0;
    if (!JsValueToNumberSafe(ctx, arguments[numberStartIndex + i], number)) {
      return MakeCurrentImageDescriptorObject(ctx, target->id);
    }
    values.push_back(number);
  }

  if (IsSceneBackedAsset(*target) && IsActiveCanvasImageId(target->id)) {
    RuntimeImageAsset* sourceAsset = source;
    if (sourceAsset->id == target->id) {
      sourceAsset = CreateSceneSnapshotAssetFromCurrentScene();
      if (!sourceAsset) {
        return MakeCurrentImageDescriptorObject(ctx, target->id);
      }
    }

    SceneCommand command;
    command.type = "image";
    command.imageId = sourceAsset->id;
    command.x = {"pixels", values[4]};
    command.y = {"pixels", values[5]};
    command.width = {"pixels", values[6]};
    command.height = {"pixels", values[7]};
    command.imageHasSourceRect = true;
    command.imageSourceX = values[0];
    command.imageSourceY = values[1];
    command.imageSourceWidth = values[2];
    command.imageSourceHeight = values[3];
    command.imageHasTint = false;
    command.blendMode = BLEND_MODE_BLEND;
    AppendSceneCommand(g_activeRuntime, command);
    g_activeRuntime->scene.imageAssets[sourceAsset->id] = *sourceAsset;
    RefreshSceneBackedCanvasAssetFromScene(target->id);
    return MakeCurrentImageDescriptorObject(ctx, target->id);
  }

  EnsureCpuPixelsMaterialized(target);
  EnsureCpuPixelsMaterialized(source, false);

  CopyImageAssetRegion(
    target,
    *source,
    values[0],
    values[1],
    values[2],
    values[3],
    values[4],
    values[5],
    values[6],
    values[7],
    true,
    BLEND_MODE_BLEND
  );
  SyncCanvasSceneAsset(target->id);
  return MakeCurrentImageDescriptorObject(ctx, target->id);
}

JSValueRef JsMomentumNativeImageBlend(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor targetDescriptor;
  if (argumentCount < 11 || !ReadImageDescriptorValue(ctx, arguments[0], &targetDescriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* target = FindRuntimeImageAsset(targetDescriptor.id);
  if (!target) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }

  RuntimeImageAsset* source = target;
  int numberStartIndex = 1;
  ImageDescriptor sourceDescriptor;
  if (ReadImageDescriptorValue(ctx, arguments[1], &sourceDescriptor)) {
    source = FindRuntimeImageAsset(sourceDescriptor.id);
    numberStartIndex = 2;
  }
  if (!source || argumentCount < static_cast<std::size_t>(numberStartIndex + 9)) {
    return MakeCurrentImageDescriptorObject(ctx, target->id);
  }

  std::vector<double> values;
  for (int i = 0; i < 8; ++i) {
    double number = 0.0;
    if (!JsValueToNumberSafe(ctx, arguments[numberStartIndex + i], number)) {
      return MakeCurrentImageDescriptorObject(ctx, target->id);
    }
    values.push_back(number);
  }
  long blendMode = BLEND_MODE_BLEND;
  JsValueToLongSafe(ctx, arguments[numberStartIndex + 8], blendMode);
  const int normalizedBlendMode = NormalizeBlendModeValue(blendMode, BLEND_MODE_BLEND);

  if (IsSceneBackedAsset(*target) && IsActiveCanvasImageId(target->id)) {
    RuntimeImageAsset* sourceAsset = source;
    if (sourceAsset->id == target->id) {
      sourceAsset = CreateSceneSnapshotAssetFromCurrentScene();
      if (!sourceAsset) {
        return MakeCurrentImageDescriptorObject(ctx, target->id);
      }
    }

    SceneCommand command;
    command.type = "image";
    command.imageId = sourceAsset->id;
    command.x = {"pixels", values[4]};
    command.y = {"pixels", values[5]};
    command.width = {"pixels", values[6]};
    command.height = {"pixels", values[7]};
    command.imageHasSourceRect = true;
    command.imageSourceX = values[0];
    command.imageSourceY = values[1];
    command.imageSourceWidth = values[2];
    command.imageSourceHeight = values[3];
    command.imageHasTint = false;
    command.blendMode = normalizedBlendMode;
    AppendSceneCommand(g_activeRuntime, command);
    g_activeRuntime->scene.imageAssets[sourceAsset->id] = *sourceAsset;
    RefreshSceneBackedCanvasAssetFromScene(target->id);
    return MakeCurrentImageDescriptorObject(ctx, target->id);
  }

  EnsureCpuPixelsMaterialized(target);
  EnsureCpuPixelsMaterialized(source, false);

  CopyImageAssetRegion(
    target,
    *source,
    values[0],
    values[1],
    values[2],
    values[3],
    values[4],
    values[5],
    values[6],
    values[7],
    true,
    normalizedBlendMode
  );
  SyncCanvasSceneAsset(target->id);
  return MakeCurrentImageDescriptorObject(ctx, target->id);
}

JSValueRef JsMomentumNativeImageFilter(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  ImageDescriptor descriptor;
  if (argumentCount < 2 || !ReadImageDescriptorValue(ctx, arguments[0], &descriptor)) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  RuntimeImageAsset* asset = FindRuntimeImageAsset(descriptor.id);
  if (!asset) {
    return MakeImageDescriptorObject(ctx, ImageDescriptor());
  }
  const std::string filterKind = JsValueToStdString(ctx, arguments[1]);
  double value = 0.0;
  if (argumentCount >= 3) {
    JsValueToNumberSafe(ctx, arguments[2], value);
  }
  if (IsSceneBackedAsset(*asset) && IsActiveCanvasImageId(asset->id)) {
    SceneCommand command;
    command.type = "filter";
    command.filterKind = ToUpperCopy(filterKind);
    command.filterHasValue = argumentCount >= 3;
    command.filterValue = value;
    AppendSceneCommand(g_activeRuntime, command);
    RefreshSceneBackedCanvasAssetFromScene(asset->id);
    return MakeCurrentImageDescriptorObject(ctx, asset->id);
  }
  EnsureCpuPixelsMaterialized(asset);
  ApplyFilterToImageAsset(asset, filterKind, value);
  SyncCanvasSceneAsset(asset->id);
  return MakeCurrentImageDescriptorObject(ctx, asset->id);
}

JSValueRef JsMomentumNativeCanvasImage(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)function;
  (void)thisObject;
  (void)exception;
  std::string requestMode = "scene";
  if (argumentCount >= 1) {
    if (JSValueIsBoolean(ctx, arguments[0])) {
      requestMode = JSValueToBoolean(ctx, arguments[0]) ? "snapshot" : "scene";
    } else {
      requestMode = ToLowerCopy(JsValueToStdString(ctx, arguments[0]));
    }
  }

  RuntimeImageAsset* asset = NULL;
  if (requestMode == "snapshot") {
    asset = SnapshotSceneToCanvasImage();
  } else if (requestMode == "mutable") {
    asset = GetOrCreateMutableCanvasImage();
  } else {
    asset = GetOrCreateSceneBackedCanvasImage();
  }
  return asset ? MakeImageDescriptorObject(ctx, DescriptorFromAsset(*asset)) : MakeImageDescriptorObject(ctx, ImageDescriptor());
}

}  // namespace momentum

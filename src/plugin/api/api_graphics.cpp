#include "api_internal.h"

#include <algorithm>
#include <cmath>
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

JSValueRef MakeJsString(JSContextRef ctx, const std::string& value) {
  JSStringRef stringValue = JSStringCreateWithUTF8CString(value.c_str());
  JSValueRef result = JSValueMakeString(ctx, stringValue);
  JSStringRelease(stringValue);
  return result;
}

void SetJsProperty(JSContextRef ctx, JSObjectRef object, const char* name, JSValueRef value) {
  if (!ctx || !object || !name || !value) {
    return;
  }
  JSStringRef key = JSStringCreateWithUTF8CString(name);
  JSObjectSetProperty(ctx, object, key, value, kJSPropertyAttributeNone, NULL);
  JSStringRelease(key);
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

JSObjectRef MakeGraphicsDescriptorObject(
  JSContextRef ctx,
  int graphicsId,
  const RuntimeImageAsset& imageAsset
) {
  JSObjectRef object = JSObjectMake(ctx, NULL, NULL);
  SetJsProperty(ctx, object, "id", JSValueMakeNumber(ctx, graphicsId));
  SetJsProperty(ctx, object, "imageData", MakeImageDescriptorObject(ctx, DescriptorFromAsset(imageAsset)));
  return object;
}

bool ReadGraphicsId(JSContextRef ctx, JSValueRef value, int* outId) {
  if (!ctx || !value || !outId) {
    return false;
  }

  double idValue = 0.0;
  if (JsValueToNumberSafe(ctx, value, idValue)) {
    *outId = static_cast<int>(std::llround(idValue));
    return *outId > 0;
  }

  if (!JSValueIsObject(ctx, value)) {
    return false;
  }

  JSObjectRef object = JSValueToObject(ctx, value, NULL);
  if (!object) {
    return false;
  }

  JSValueRef graphicsIdValue = GetJsProperty(ctx, object, "_graphicsId");
  if (!graphicsIdValue || JSValueIsUndefined(ctx, graphicsIdValue) || JSValueIsNull(ctx, graphicsIdValue)) {
    graphicsIdValue = GetJsProperty(ctx, object, "id");
  }
  if (!JsValueToNumberSafe(ctx, graphicsIdValue, idValue)) {
    return false;
  }

  *outId = static_cast<int>(std::llround(idValue));
  return *outId > 0;
}

GraphicsSurfaceState CaptureGraphicsSurfaceState(const JsHostRuntime& runtime) {
  GraphicsSurfaceState state;
  static_cast<RuntimeStyleState&>(state) = static_cast<const RuntimeStyleState&>(runtime);
  state.angleMode = runtime.angleMode;
  state.nextImageId = runtime.nextImageId;
  state.canvasImageId = runtime.canvasImageId;
  state.sceneVersion = runtime.sceneVersion;
  state.canvasImageSceneVersion = runtime.canvasImageSceneVersion;
  state.outputImageId = runtime.graphicsOutputImageId;
  state.bitmapMode = runtime.graphicsBitmapMode;
  state.bitmapTouchedThisSession = runtime.graphicsBitmapTouchedThisSession;
  state.imageAssets = runtime.imageAssets;
  state.scene = runtime.scene;
  state.stateStack = runtime.stateStack;
  state.shapeVertices = runtime.shapeVertices;
  state.shapeContours = runtime.shapeContours;
  state.curveVertices = runtime.curveVertices;
  state.contourVertices = runtime.contourVertices;
  state.contourCurveVertices = runtime.contourCurveVertices;
  state.shapeSubpath = runtime.shapeSubpath;
  state.shapeContourSubpaths = runtime.shapeContourSubpaths;
  state.contourSubpath = runtime.contourSubpath;
  state.shapeUsesCurve = runtime.shapeUsesCurve;
  state.contourUsesCurve = runtime.contourUsesCurve;
  state.insideContour = runtime.insideContour;
  state.shapeKind = runtime.shapeKind;
  state.desiredFrameRate = runtime.desiredFrameRate;
  return state;
}

void RestoreGraphicsSurfaceState(JsHostRuntime* runtime, const GraphicsSurfaceState& state) {
  if (!runtime) {
    return;
  }

  static_cast<RuntimeStyleState&>(*runtime) = state;
  runtime->angleMode = state.angleMode;
  runtime->nextImageId = state.nextImageId;
  runtime->canvasImageId = state.canvasImageId;
  runtime->sceneVersion = state.sceneVersion;
  runtime->canvasImageSceneVersion = state.canvasImageSceneVersion;
  runtime->graphicsOutputImageId = state.outputImageId;
  runtime->graphicsBitmapMode = state.bitmapMode;
  runtime->graphicsBitmapTouchedThisSession = state.bitmapTouchedThisSession;
  runtime->imageAssets = state.imageAssets;
  runtime->scene = state.scene;
  runtime->stateStack = state.stateStack;
  runtime->shapeVertices = state.shapeVertices;
  runtime->shapeContours = state.shapeContours;
  runtime->curveVertices = state.curveVertices;
  runtime->contourVertices = state.contourVertices;
  runtime->contourCurveVertices = state.contourCurveVertices;
  runtime->shapeSubpath = state.shapeSubpath;
  runtime->shapeContourSubpaths = state.shapeContourSubpaths;
  runtime->contourSubpath = state.contourSubpath;
  runtime->shapeUsesCurve = state.shapeUsesCurve;
  runtime->contourUsesCurve = state.contourUsesCurve;
  runtime->insideContour = state.insideContour;
  runtime->shapeKind = state.shapeKind;
  runtime->desiredFrameRate = state.desiredFrameRate;
  runtime->noiseInitialized = false;
  runtime->noiseValues.clear();
}

RuntimeImageAsset* SnapshotActiveRuntimeToCanvasImage() {
  if (!g_activeRuntime) {
    return NULL;
  }

  const int canvasWidth = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasWidth))));
  const int canvasHeight = std::max(1, static_cast<int>(std::round(std::max(1.0, g_activeRuntime->scene.canvasHeight))));

  int imageId = g_activeRuntime->canvasImageId;
  if (imageId > 0 &&
      g_activeRuntime->canvasImageSceneVersion == g_activeRuntime->sceneVersion) {
    auto existing = g_activeRuntime->imageAssets.find(imageId);
    if (existing != g_activeRuntime->imageAssets.end() &&
        existing->second.loaded &&
        existing->second.width == canvasWidth &&
        existing->second.height == canvasHeight) {
      return &existing->second;
    }
  }
  if (imageId <= 0) {
    imageId = g_activeRuntime->nextImageId++;
    g_activeRuntime->canvasImageId = imageId;
  }

  std::uint64_t nextVersion = 1;
  {
    auto existing = g_activeRuntime->imageAssets.find(imageId);
    if (existing != g_activeRuntime->imageAssets.end()) {
      nextVersion = existing->second.version + 1;
    }
  }

  RuntimeImageAsset asset = CreateBlankImageAsset(imageId, canvasWidth, canvasHeight);
  asset.source = "__graphics_canvas_scene__";
  asset.path.clear();
  asset.pixelDensity = std::max(1.0, g_activeRuntime->pixelDensity);
  asset.loaded = true;
  asset.loadError.clear();
  asset.version = nextVersion;
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

RuntimeImageAsset SnapshotGraphicsSurfaceToOutputAsset(const GraphicsSurfaceState& surface) {
  const int width =
    std::max(1, static_cast<int>(std::round(std::max(1.0, surface.scene.canvasWidth))));
  const int height =
    std::max(1, static_cast<int>(std::round(std::max(1.0, surface.scene.canvasHeight))));
  RuntimeImageAsset asset = CreateBlankImageAsset(surface.outputImageId, width, height);
  asset.source = "__graphics_output__";
  asset.path.clear();
  asset.pixelDensity = std::max(1.0, surface.pixelDensity);
  asset.loaded = true;
  asset.loadError.clear();
  auto existing = surface.imageAssets.find(surface.outputImageId);
  if (existing != surface.imageAssets.end()) {
    asset.version = existing->second.version + 1;
  }

  std::vector<PF_Pixel> raster(
    static_cast<std::size_t>(width * height),
    PF_Pixel{0, 0, 0, 0}
  );
  ApplySceneToRaster8(&raster, width, height, surface.scene);
  asset.pixels.swap(raster);
  asset.gpuSceneBacked = false;
  asset.gpuScene.reset();
  return asset;
}

void ReplaceActiveSceneWithImageAsset(const RuntimeImageAsset& asset) {
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
  g_activeRuntime->canvasImageId = asset.id;
  g_activeRuntime->canvasImageSceneVersion = g_activeRuntime->sceneVersion;
}

JSObjectRef MakeEmptyGraphicsDescriptor(JSContextRef ctx) {
  RuntimeImageAsset asset = CreateBlankImageAsset(0, 0, 0);
  asset.loaded = false;
  asset.loadError = "Failed to create graphics surface";
  return MakeGraphicsDescriptorObject(ctx, 0, asset);
}

}  // namespace

JSValueRef JsMomentumNativeCreateGraphics(
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
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  double widthValue = 0.0;
  double heightValue = 0.0;
  if (!JsValueToNumberSafe(ctx, arguments[0], widthValue) ||
      !JsValueToNumberSafe(ctx, arguments[1], heightValue)) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  const int width = std::max(1, static_cast<int>(std::floor(widthValue)));
  const int height = std::max(1, static_cast<int>(std::floor(heightValue)));
  const int graphicsId = g_activeRuntime->nextGraphicsId++;
  const int outputImageId = g_activeRuntime->nextImageId++;

  RuntimeImageAsset outputAsset = CreateBlankImageAsset(outputImageId, width, height);
  outputAsset.source = "__graphics_output__";
  outputAsset.path.clear();
  outputAsset.pixelDensity = std::max(1.0, g_activeRuntime->pixelDensity);
  g_activeRuntime->imageAssets[outputImageId] = outputAsset;

  GraphicsSurfaceState surface{};
  surface.currentFill = PF_Pixel{255, 255, 255, 255};
  surface.hasFill = true;
  surface.fillExplicit = false;
  surface.currentStroke = PF_Pixel{255, 0, 0, 0};
  surface.hasStroke = true;
  surface.strokeExplicit = false;
  surface.strokeWeight = 1.0;
  surface.currentTransform = Transform2D{};
  surface.rectMode = SHAPE_MODE_CORNER;
  surface.ellipseMode = SHAPE_MODE_CENTER;
  surface.colorMode = COLOR_MODE_RGB;
  surface.strokeCap = STROKE_CAP_ROUND;
  surface.strokeJoin = STROKE_JOIN_MITER;
  surface.curveTightness = 0.0;
  surface.blendMode = BLEND_MODE_BLEND;
  surface.imageMode = SHAPE_MODE_CORNER;
  surface.imageTintEnabled = false;
  surface.currentImageTint = PF_Pixel{255, 255, 255, 255};
  surface.eraseActive = false;
  surface.eraseFillStrength = 1.0;
  surface.eraseStrokeStrength = 1.0;
  surface.clipCapturing = false;
  surface.clipInvert = false;
  surface.textFontName = "Arial";
  surface.textFontPath.clear();
  surface.textFontSourceKind = "system";
  surface.textStyle = "NORMAL";
  surface.textWrap = "WORD";
  surface.textSize = 12.0;
  surface.textLeading = 15.0;
  surface.textLeadingExplicit = false;
  surface.textAlignH = 0;
  surface.textAlignV = 3;
  surface.outputImageId = outputImageId;
  surface.bitmapMode = false;
  surface.bitmapTouchedThisSession = false;
  surface.canvasImageId = outputImageId;
  surface.canvasImageSceneVersion = 0;
  surface.nextImageId = g_activeRuntime->nextImageId;
  surface.pixelDensity = std::max(1.0, g_activeRuntime->pixelDensity);
  surface.imageAssets.clear();
  surface.stateStack.clear();
  surface.shapeVertices.clear();
  surface.shapeContours.clear();
  surface.curveVertices.clear();
  surface.contourVertices.clear();
  surface.contourCurveVertices.clear();
  surface.shapeSubpath = PathSubpath{};
  surface.shapeContourSubpaths.clear();
  surface.contourSubpath = PathSubpath{};
  surface.shapeUsesCurve = false;
  surface.contourUsesCurve = false;
  surface.insideContour = false;
  surface.shapeKind = BEGIN_SHAPE_DEFAULT;
  surface.desiredFrameRate = g_activeRuntime->desiredFrameRate;
  surface.scene = ScenePayload{};
  surface.scene.canvasWidth = static_cast<double>(width);
  surface.scene.canvasHeight = static_cast<double>(height);
  surface.scene.clearsSurface = true;
  surface.scene.hasBackground = false;
  surface.scene.background = PF_Pixel{0, 0, 0, 0};
  g_activeRuntime->graphicsSurfaces[graphicsId] = surface;

  return MakeGraphicsDescriptorObject(ctx, graphicsId, g_activeRuntime->imageAssets[outputImageId]);
}

JSValueRef JsMomentumNativeEnterGraphics(
  JSContextRef ctx,
  JSObjectRef function,
  JSObjectRef thisObject,
  std::size_t argumentCount,
  const JSValueRef arguments[],
  JSValueRef* exception
) {
  (void)ctx;
  (void)function;
  (void)thisObject;
  (void)exception;
  if (!g_activeRuntime || argumentCount < 1 || g_activeRuntime->activeGraphicsId != 0) {
    return JSValueMakeBoolean(ctx, false);
  }

  int graphicsId = 0;
  if (!ReadGraphicsId(ctx, arguments[0], &graphicsId)) {
    return JSValueMakeBoolean(ctx, false);
  }

  auto surfaceIt = g_activeRuntime->graphicsSurfaces.find(graphicsId);
  if (surfaceIt == g_activeRuntime->graphicsSurfaces.end()) {
    return JSValueMakeBoolean(ctx, false);
  }

  GraphicsSurfaceState savedMain = CaptureGraphicsSurfaceState(*g_activeRuntime);
  GraphicsSurfaceState surface = surfaceIt->second;
  if (surface.nextImageId < g_activeRuntime->nextImageId) {
    surface.nextImageId = g_activeRuntime->nextImageId;
  }
  for (const auto& assetEntry : savedMain.imageAssets) {
    surface.imageAssets[assetEntry.first] = assetEntry.second;
  }

  RestoreGraphicsSurfaceState(g_activeRuntime, surface);
  g_activeRuntime->graphicsBitmapTouchedThisSession = false;
  if (surface.bitmapMode) {
    const auto outputIt = g_activeRuntime->imageAssets.find(surface.outputImageId);
    if (outputIt != g_activeRuntime->imageAssets.end() && outputIt->second.loaded) {
      ReplaceActiveSceneWithImageAsset(outputIt->second);
    }
  }
  g_activeRuntime->activeGraphicsId = graphicsId;
  g_activeRuntime->graphicsSwapState = savedMain;
  g_activeRuntime->hasGraphicsSwapState = true;
  return JSValueMakeBoolean(ctx, true);
}

JSValueRef JsMomentumNativeExitGraphics(
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
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  int graphicsId = 0;
  if (!ReadGraphicsId(ctx, arguments[0], &graphicsId) || g_activeRuntime->activeGraphicsId != graphicsId) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  auto surfaceIt = g_activeRuntime->graphicsSurfaces.find(graphicsId);
  if (surfaceIt == g_activeRuntime->graphicsSurfaces.end() || !g_activeRuntime->hasGraphicsSwapState) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  RuntimeImageAsset latestAsset = CreateBlankImageAsset(0, 1, 1);
  if (RuntimeImageAsset* activeAsset = SnapshotActiveRuntimeToCanvasImage()) {
    latestAsset = *activeAsset;
  }

  GraphicsSurfaceState updatedSurface = CaptureGraphicsSurfaceState(*g_activeRuntime);
  updatedSurface.outputImageId = surfaceIt->second.outputImageId > 0
    ? surfaceIt->second.outputImageId
    : updatedSurface.outputImageId;

  const int outputImageId = updatedSurface.outputImageId;
  const GraphicsSurfaceState savedMain = g_activeRuntime->graphicsSwapState;
  RestoreGraphicsSurfaceState(g_activeRuntime, savedMain);
  g_activeRuntime->activeGraphicsId = 0;
  g_activeRuntime->hasGraphicsSwapState = false;
  RuntimeImageAsset outputAsset = latestAsset;
  outputAsset.id = outputImageId;
  outputAsset.width =
    std::max(1, static_cast<int>(std::round(std::max(1.0, updatedSurface.scene.canvasWidth))));
  outputAsset.height =
    std::max(1, static_cast<int>(std::round(std::max(1.0, updatedSurface.scene.canvasHeight))));
  outputAsset.source = outputAsset.gpuSceneBacked ? "__graphics_output_gpu__" : "__graphics_output__";
  outputAsset.path.clear();
  outputAsset.loaded = true;
  outputAsset.pixelDensity = std::max(1.0, updatedSurface.pixelDensity);
  if (outputAsset.gpuSceneBacked && outputAsset.gpuScene) {
    outputAsset.pixels.clear();
    outputAsset.gpuScene->imageAssets.erase(outputImageId);
  } else {
    outputAsset.gpuSceneBacked = false;
    outputAsset.gpuScene.reset();
  }
  auto existing = g_activeRuntime->imageAssets.find(outputImageId);
  if (existing != g_activeRuntime->imageAssets.end()) {
    outputAsset.version = existing->second.version + 1;
  }
  if (updatedSurface.bitmapTouchedThisSession) {
    updatedSurface.bitmapMode = true;
  } else if (outputAsset.gpuSceneBacked) {
    updatedSurface.bitmapMode = false;
  }
  updatedSurface.bitmapTouchedThisSession = false;
  updatedSurface.canvasImageId = outputImageId;
  updatedSurface.canvasImageSceneVersion = updatedSurface.sceneVersion;
  updatedSurface.imageAssets[outputImageId] = outputAsset;
  surfaceIt->second = updatedSurface;
  g_activeRuntime->imageAssets[outputImageId] = outputAsset;
  return MakeGraphicsDescriptorObject(ctx, graphicsId, g_activeRuntime->imageAssets[outputImageId]);
}

JSValueRef JsMomentumNativePrepareGraphicsBitmap(
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
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  int graphicsId = 0;
  if (!ReadGraphicsId(ctx, arguments[0], &graphicsId)) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  auto surfaceIt = g_activeRuntime->graphicsSurfaces.find(graphicsId);
  if (surfaceIt == g_activeRuntime->graphicsSurfaces.end()) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  GraphicsSurfaceState& surface = surfaceIt->second;
  if (surface.outputImageId <= 0) {
    surface.outputImageId = g_activeRuntime->nextImageId++;
  }

  auto existing = surface.imageAssets.find(surface.outputImageId);
  const bool canReuseBitmap =
    surface.bitmapMode &&
    existing != surface.imageAssets.end() &&
    existing->second.loaded &&
    !existing->second.gpuSceneBacked &&
    surface.canvasImageSceneVersion == surface.sceneVersion;

  if (!canReuseBitmap) {
    RuntimeImageAsset outputAsset = SnapshotGraphicsSurfaceToOutputAsset(surface);
    surface.bitmapMode = true;
    surface.bitmapTouchedThisSession = true;
    surface.canvasImageId = outputAsset.id;
    surface.canvasImageSceneVersion = surface.sceneVersion;
    surface.imageAssets[outputAsset.id] = outputAsset;
  }

  g_activeRuntime->imageAssets[surface.outputImageId] = surface.imageAssets[surface.outputImageId];
  return MakeGraphicsDescriptorObject(ctx, graphicsId, g_activeRuntime->imageAssets[surface.outputImageId]);
}

JSValueRef JsMomentumNativeCommitGraphicsBitmap(
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
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  int graphicsId = 0;
  if (!ReadGraphicsId(ctx, arguments[0], &graphicsId)) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  auto surfaceIt = g_activeRuntime->graphicsSurfaces.find(graphicsId);
  if (surfaceIt == g_activeRuntime->graphicsSurfaces.end()) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  GraphicsSurfaceState& surface = surfaceIt->second;
  if (surface.outputImageId <= 0) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  auto activeAssetIt = g_activeRuntime->imageAssets.find(surface.outputImageId);
  if (activeAssetIt == g_activeRuntime->imageAssets.end()) {
    return MakeEmptyGraphicsDescriptor(ctx);
  }

  RuntimeImageAsset outputAsset = activeAssetIt->second;
  outputAsset.id = surface.outputImageId;
  outputAsset.source = "__graphics_output__";
  outputAsset.path.clear();
  outputAsset.loaded = true;
  outputAsset.gpuSceneBacked = false;
  outputAsset.gpuScene.reset();

  surface.bitmapMode = true;
  surface.bitmapTouchedThisSession = true;
  surface.canvasImageId = outputAsset.id;
  surface.canvasImageSceneVersion = surface.sceneVersion;
  surface.imageAssets[outputAsset.id] = outputAsset;
  g_activeRuntime->imageAssets[outputAsset.id] = outputAsset;
  return MakeGraphicsDescriptorObject(ctx, graphicsId, outputAsset);
}

}  // namespace momentum

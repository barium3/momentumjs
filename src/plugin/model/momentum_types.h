#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <JavaScriptCore/JavaScript.h>

#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_EffectCBSuites.h"
#include "AE_EffectPixelFormat.h"
#include "AE_EffectGPUSuites.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "String_Utils.h"
#include "AEFX_SuiteHelper.h"

#include "../momentum_version.h"

namespace momentum {

struct ScenePayload;

constexpr int kControllerSlotCount = 16;
constexpr int kControllerParamKindsPerSlot = 7;
constexpr int kControllerSliderSlotCount = kControllerSlotCount;
constexpr int kControllerAngleSlotCount = kControllerSlotCount;
constexpr int kControllerColorSlotCount = kControllerSlotCount;
constexpr int kControllerCheckboxSlotCount = kControllerSlotCount;
constexpr int kControllerSelectSlotCount = kControllerSlotCount;
constexpr int kControllerPointSlotCount = kControllerSlotCount;

struct ControllerSliderValue {
  double value = 0.0;
};

struct ControllerAngleValue {
  double degrees = 0.0;
};

struct ControllerColorValue {
  double r = 1.0;
  double g = 1.0;
  double b = 1.0;
  double a = 1.0;
};

struct ControllerCheckboxValue {
  bool checked = false;
};

struct ControllerSelectValue {
  int index = 0;
};

struct ControllerPointValue {
  double x = 0.0;
  double y = 0.0;
};

struct ControllerPoolState {
  std::array<ControllerSliderValue, kControllerSliderSlotCount> sliders{};
  std::array<ControllerAngleValue, kControllerAngleSlotCount> angles{};
  std::array<ControllerColorValue, kControllerColorSlotCount> colors{};
  std::array<ControllerCheckboxValue, kControllerCheckboxSlotCount> checkboxes{};
  std::array<ControllerSelectValue, kControllerSelectSlotCount> selects{};
  std::array<ControllerPointValue, kControllerPointSlotCount> points{};
  std::string stateHash;
};

enum ParamIndex {
  PARAM_INPUT = 0,
  PARAM_REVISION,
  PARAM_INSTANCE_ID,
  PARAM_CONTROLLER_SLOT_BASE,
  PARAM_CONTROLLER_AFTER =
    PARAM_CONTROLLER_SLOT_BASE + (kControllerSlotCount * kControllerParamKindsPerSlot),
  PARAM_COUNT = PARAM_CONTROLLER_AFTER,
};

constexpr int ControllerSlotParamBaseIndex(int slot) {
  return PARAM_CONTROLLER_SLOT_BASE + (slot * kControllerParamKindsPerSlot);
}

constexpr int ControllerPointParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot);
}

constexpr int ControllerSliderParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 1;
}

constexpr int ControllerColorParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 2;
}

constexpr int ControllerColorValueParamIndex(int slot) {
  return ControllerColorParamIndex(slot);
}

constexpr int ControllerCheckboxParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 3;
}

constexpr int ControllerSelectParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 4;
}

constexpr int ControllerAngleValueParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 5;
}

constexpr int ControllerAngleUiParamIndex(int slot) {
  return ControllerSlotParamBaseIndex(slot) + 6;
}

constexpr int ControllerAngleParamIndex(int slot) {
  return ControllerAngleValueParamIndex(slot);
}

struct ScalarSpec {
  std::string mode;
  double value = 0.0;
};

struct Transform2D {
  double a = 1.0;
  double b = 0.0;
  double c = 0.0;
  double d = 1.0;
  double tx = 0.0;
  double ty = 0.0;
};

struct VertexSpec {
  ScalarSpec x = {"pixels", 0.0};
  ScalarSpec y = {"pixels", 0.0};
};

enum PathSegmentType {
  PATH_SEGMENT_MOVE_TO = 0,
  PATH_SEGMENT_LINE_TO = 1,
  PATH_SEGMENT_QUADRATIC_TO = 2,
  PATH_SEGMENT_CUBIC_TO = 3,
  PATH_SEGMENT_CLOSE = 4,
};

struct PathSegment {
  int type = PATH_SEGMENT_MOVE_TO;
  VertexSpec point;
  VertexSpec control1;
  VertexSpec control2;
};

struct PathSubpath {
  std::vector<PathSegment> segments;
  bool isContour = false;
};

struct VectorPath {
  std::vector<PathSubpath> subpaths;
};

enum ShapeMode {
  SHAPE_MODE_CORNER = 0,
  SHAPE_MODE_CORNERS = 1,
  SHAPE_MODE_CENTER = 2,
  SHAPE_MODE_RADIUS = 3,
};

enum BeginShapeKind {
  BEGIN_SHAPE_DEFAULT = 0,
  BEGIN_SHAPE_POINTS = 10,
  BEGIN_SHAPE_LINES = 11,
  BEGIN_SHAPE_TRIANGLES = 12,
  BEGIN_SHAPE_TRIANGLE_FAN = 13,
  BEGIN_SHAPE_TRIANGLE_STRIP = 14,
  BEGIN_SHAPE_QUADS = 15,
  BEGIN_SHAPE_QUAD_STRIP = 16,
  BEGIN_SHAPE_TESS = 17,
 };

enum ColorMode {
  COLOR_MODE_RGB = 0,
  COLOR_MODE_HSB = 1,
  COLOR_MODE_HSL = 2,
};

enum AngleMode {
  ANGLE_MODE_RADIANS = 0,
  ANGLE_MODE_DEGREES = 1,
};

enum ArcMode {
  ARC_MODE_OPEN = 100,
  ARC_MODE_CHORD = 101,
  ARC_MODE_PIE = 102,
};

enum StrokeCapMode {
  STROKE_CAP_ROUND = 200,
  STROKE_CAP_SQUARE = 201,
  STROKE_CAP_PROJECT = 202,
};

enum StrokeJoinMode {
  STROKE_JOIN_MITER = 300,
  STROKE_JOIN_BEVEL = 301,
  STROKE_JOIN_ROUND = 302,
};

enum BlendMode {
  BLEND_MODE_BLEND = 400,
  BLEND_MODE_ADD = 401,
  BLEND_MODE_DARKEST = 402,
  BLEND_MODE_LIGHTEST = 403,
  BLEND_MODE_DIFFERENCE = 404,
  BLEND_MODE_EXCLUSION = 405,
  BLEND_MODE_MULTIPLY = 406,
  BLEND_MODE_SCREEN = 407,
  BLEND_MODE_REPLACE = 408,
  BLEND_MODE_REMOVE = 409,
  BLEND_MODE_OVERLAY = 410,
  BLEND_MODE_HARD_LIGHT = 411,
  BLEND_MODE_SOFT_LIGHT = 412,
  BLEND_MODE_DODGE = 413,
  BLEND_MODE_BURN = 414,
};

struct RuntimeImageAsset {
  int id = 0;
  std::string source;
  std::string path;
  int width = 0;
  int height = 0;
  double pixelDensity = 1.0;
  std::uint64_t version = 1;
  bool loaded = false;
  std::string loadError;
  std::vector<PF_Pixel> pixels;
  bool gpuSceneBacked = false;
  std::shared_ptr<ScenePayload> gpuScene;
};

struct SceneCommand {
  std::string type;
  std::string filterKind;
  std::string text;
  std::string fontName;
  std::string fontPath;
  std::string fontSourceKind = "system";
  std::string textStyle = "NORMAL";
  std::string textWrap = "WORD";
  ScalarSpec x = {"pixels", 0.0};
  ScalarSpec y = {"pixels", 0.0};
  ScalarSpec width = {"pixels", 0.0};
  ScalarSpec height = {"pixels", 0.0};
  ScalarSpec x1 = {"pixels", 0.0};
  ScalarSpec y1 = {"pixels", 0.0};
  ScalarSpec x2 = {"pixels", 0.0};
  ScalarSpec y2 = {"pixels", 0.0};
  PF_Pixel fill = {0, 0, 0, 0};
  bool hasFill = false;
  PF_Pixel stroke = {0, 0, 0, 0};
  bool hasStroke = false;
  double strokeWeight = 1.0;
  int strokeCap = STROKE_CAP_ROUND;
  int strokeJoin = STROKE_JOIN_MITER;
  int blendMode = BLEND_MODE_BLEND;
  bool eraseFill = false;
  bool eraseStroke = false;
  double eraseFillStrength = 1.0;
  double eraseStrokeStrength = 1.0;
  bool clipPath = false;
  bool clipInvert = false;
  bool textHasWidth = false;
  bool textHasHeight = false;
  double textSize = 12.0;
  double textLeading = 15.0;
  int textAlignH = 0;
  int textAlignV = 3;
  int imageId = 0;
  int maskImageId = 0;
  bool imageHasSourceRect = false;
  double imageSourceX = 0.0;
  double imageSourceY = 0.0;
  double imageSourceWidth = 0.0;
  double imageSourceHeight = 0.0;
  bool imageHasTint = false;
  PF_Pixel imageTint = {255, 255, 255, 255};
  bool filterHasValue = false;
  double filterValue = 0.0;
  Transform2D transform;
  VectorPath path;
  std::vector<VertexSpec> vertices;
  std::vector<std::vector<VertexSpec>> contours;
  bool closePath = false;
};

struct ScenePayload {
  PF_Pixel background = {255, 18, 18, 24};
  bool hasBackground = false;
  bool clearsSurface = false;
  double canvasWidth = 0.0;
  double canvasHeight = 0.0;
  std::unordered_map<int, RuntimeImageAsset> imageAssets;
  std::vector<SceneCommand> commands;
};

struct RuntimeStyleState {
  PF_Pixel currentFill = {255, 255, 255, 255};
  bool hasFill = true;
  bool fillExplicit = false;
  PF_Pixel currentStroke = {255, 0, 0, 0};
  bool hasStroke = true;
  bool strokeExplicit = false;
  double strokeWeight = 1.0;
  Transform2D currentTransform;
  int rectMode = SHAPE_MODE_CORNER;
  int ellipseMode = SHAPE_MODE_CENTER;
  int colorMode = COLOR_MODE_RGB;
  int strokeCap = STROKE_CAP_ROUND;
  int strokeJoin = STROKE_JOIN_MITER;
  double curveTightness = 0.0;
  int blendMode = BLEND_MODE_BLEND;
  int imageMode = SHAPE_MODE_CORNER;
  double pixelDensity = 1.0;
  bool imageTintEnabled = false;
  PF_Pixel currentImageTint = {255, 255, 255, 255};
  bool eraseActive = false;
  double eraseFillStrength = 1.0;
  double eraseStrokeStrength = 1.0;
  bool clipCapturing = false;
  bool clipInvert = false;
  std::string textFontName = "Arial";
  std::string textFontPath;
  std::string textFontSourceKind = "system";
  std::string textStyle = "NORMAL";
  std::string textWrap = "WORD";
  double textSize = 12.0;
  double textLeading = 15.0;
  bool textLeadingExplicit = false;
  int textAlignH = 0;
  int textAlignV = 3;
};

struct RuntimeSnapshot : RuntimeStyleState {};

struct GraphicsSurfaceState : RuntimeStyleState {
  int angleMode = ANGLE_MODE_RADIANS;
  int nextImageId = 1;
  int canvasImageId = 0;
  std::uint64_t sceneVersion = 0;
  std::uint64_t canvasImageSceneVersion = 0;
  int outputImageId = 0;
  bool bitmapMode = false;
  bool bitmapTouchedThisSession = false;
  std::unordered_map<int, RuntimeImageAsset> imageAssets;
  ScenePayload scene;
  std::vector<RuntimeSnapshot> stateStack;
  std::vector<VertexSpec> shapeVertices;
  std::vector<std::vector<VertexSpec>> shapeContours;
  std::vector<VertexSpec> curveVertices;
  std::vector<VertexSpec> contourVertices;
  std::vector<VertexSpec> contourCurveVertices;
  PathSubpath shapeSubpath;
  std::vector<PathSubpath> shapeContourSubpaths;
  PathSubpath contourSubpath;
  bool shapeUsesCurve = false;
  bool contourUsesCurve = false;
  bool insideContour = false;
  int shapeKind = BEGIN_SHAPE_DEFAULT;
  double desiredFrameRate = 0.0;
};

struct RuntimeEngineState : RuntimeStyleState {
  int angleMode = ANGLE_MODE_RADIANS;
  A_u_long randomState = 0x12345678UL;
  bool gaussianHasSpare = false;
  double gaussianSpare = 0.0;
  A_u_long noiseSeed = 0x12345678UL;
  int noiseOctaves = 4;
  double noiseFalloff = 0.5;
  int nextImageId = 1;
  int canvasImageId = 0;
  std::uint64_t sceneVersion = 0;
  std::uint64_t canvasImageSceneVersion = 0;
  int graphicsOutputImageId = 0;
  bool graphicsBitmapMode = false;
  bool graphicsBitmapTouchedThisSession = false;
  int nextGraphicsId = 1;
  int activeGraphicsId = 0;
  bool hasGraphicsSwapState = false;
  GraphicsSurfaceState graphicsSwapState;
  std::unordered_map<int, RuntimeImageAsset> imageAssets;
  std::unordered_map<int, GraphicsSurfaceState> graphicsSurfaces;
};

struct JsHostRuntime : RuntimeEngineState {
  ScenePayload scene;
  std::vector<RuntimeSnapshot> stateStack;
  std::vector<VertexSpec> shapeVertices;
  std::vector<std::vector<VertexSpec>> shapeContours;
  std::vector<VertexSpec> curveVertices;
  std::vector<VertexSpec> contourVertices;
  std::vector<VertexSpec> contourCurveVertices;
  PathSubpath shapeSubpath;
  std::vector<PathSubpath> shapeContourSubpaths;
  PathSubpath contourSubpath;
  bool shapeUsesCurve = false;
  bool contourUsesCurve = false;
  bool insideContour = false;
  int shapeKind = BEGIN_SHAPE_DEFAULT;
  double desiredFrameRate = 0.0;
  long currentFrameCount = 0;
  double currentTimeSeconds = 0.0;
  std::string debugTracePath;
  std::string debugSessionId;
  bool noiseInitialized = false;
  std::vector<double> noiseValues;
};

extern thread_local JsHostRuntime* g_activeRuntime;

struct CachedSketchState {
  enum BitmapExecutionProfile {
    BITMAP_PROFILE_DIRECT_FRAME = 0,
    BITMAP_PROFILE_STATEFUL_ACCUMULATION = 1,
  };

  struct FrameSnapshot {
    long frame = 0;
    ScenePayload scene;
    bool sceneIsAccumulated = true;
    std::vector<PF_Pixel> raster;
    std::string debugSample;
    std::string runtimeStateJson;
    ControllerPoolState controllerState;
    bool hasControllerState = false;
    RuntimeEngineState engineState;
    bool hasEngineState = false;
  };

  JSGlobalContextRef context = NULL;
  JSValueRef drawFn = NULL;
  ScenePayload latestScene;
  bool latestSceneIsAccumulated = true;
  JsHostRuntime runtime;
  std::vector<PF_Pixel> raster;
  std::string source;
  std::string sourceHash;
  std::string controllerHash;
  std::string controllerStateHash;
  ControllerPoolState controllerState;
  bool hasControllerState = false;
  A_long revision = -1;
  std::size_t frameCacheBudgetBytes = 512ULL * 1024ULL * 1024ULL;
  long checkpointInterval = 12;
  long denseWindowBacktrack = 8;
  long denseWindowForward = 24;
  A_long outputWidth = 0;
  A_long outputHeight = 0;
  long lastFrame = 0;
  long simulatedFrame = 0;
  bool controllerHistoryDirty = false;
  long controllerHistoryDirtyFrame = -1;
  bool valid = false;
  BitmapExecutionProfile bitmapProfile = BITMAP_PROFILE_STATEFUL_ACCUMULATION;
  std::unordered_map<long, FrameSnapshot> exactSnapshots;
  std::vector<long> exactSnapshotOrder;
  std::unordered_map<long, FrameSnapshot> checkpointSnapshots;
  std::vector<long> checkpointOrder;
  std::unordered_map<long, ScenePayload> gpuFrameScenes;
};

struct RuntimePointControllerSpec {
  std::string label;
  ControllerPointValue defaultValue;
  bool hasDefaultValue = false;
};

struct RuntimeSliderControllerSpec {
  std::string label;
  double minValue = 0.0;
  double maxValue = 100.0;
  double defaultValue = 0.0;
  double step = 0.0;
  bool hasDefaultValue = false;
};

struct RuntimeAngleControllerSpec {
  std::string label;
  double defaultValue = 0.0;
  bool hasDefaultValue = false;
};

struct RuntimeColorControllerSpec {
  std::string label;
  ControllerColorValue defaultValue;
  bool hasDefaultValue = false;
};

struct RuntimeCheckboxControllerSpec {
  std::string label;
  bool defaultValue = false;
  bool hasDefaultValue = false;
};

struct RuntimeSelectControllerOptionSpec {
  std::string label;
};

struct RuntimeSelectControllerSpec {
  std::string label;
  std::vector<RuntimeSelectControllerOptionSpec> options;
  int defaultValue = 0;
  bool hasDefaultValue = false;
};

enum class RuntimeControllerSlotKind {
  kNone = 0,
  kSlider = 1,
  kAngle = 2,
  kColor = 3,
  kCheckbox = 4,
  kSelect = 5,
  kPoint = 6,
};

struct RuntimeControllerSlotSpec {
  RuntimeControllerSlotKind kind = RuntimeControllerSlotKind::kNone;
  std::string id;
  std::string label;
  RuntimeSliderControllerSpec slider;
  RuntimeAngleControllerSpec angle;
  RuntimeColorControllerSpec color;
  RuntimeCheckboxControllerSpec checkbox;
  RuntimeSelectControllerSpec select;
  RuntimePointControllerSpec point;
};

struct RuntimeSketchBundle {
  int bundleVersion = 0;
  long revision = -1;
  std::string runtimeTarget;
  std::string sourcePath;
  std::string sourceText;
  std::string sourceHash;
  std::string debugTracePath;
  std::string debugSessionId;
  std::string profile;
  std::string backgroundMode;
  std::string controllerHash;
  std::vector<RuntimeControllerSlotSpec> controllerSlots;
  double pixelDensity = 1.0;
  std::size_t recentFrameBudgetBytes = 512ULL * 1024ULL * 1024ULL;
  long checkpointInterval = 12;
  long denseWindowBacktrack = 8;
  long denseWindowForward = 24;
  bool hasEmbeddedSource = false;
};

enum BitmapGpuExecutionProfile {
  BITMAP_GPU_PROFILE_DIRECT_FRAME = 0,
  BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION = 1,
};

struct GpuRenderPlan {
  ScenePayload scene;
  A_long width = 0;
  A_long height = 0;
  double pixelDensity = 1.0;
  std::uint64_t cacheKey = 0;
  long targetFrame = 0;
  bool clearsSurface = false;
  PF_Pixel clearColor = {0, 0, 0, 0};

  struct FillTriangle {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
    float x3 = 0.0f;
    float y3 = 0.0f;
    PF_Pixel color = {255, 255, 255, 255};
  };

  struct BoundaryEdge {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
  };

  struct PathFillVertex {
    float x = 0.0f;
    float y = 0.0f;
  };

  struct PathFillContour {
    std::uint32_t vertexStart = 0;
    std::uint32_t vertexCount = 0;
  };

  struct PathFill {
    std::uint32_t contourStart = 0;
    std::uint32_t contourCount = 0;
    float minX = 0.0f;
    float minY = 0.0f;
    float maxX = 0.0f;
    float maxY = 0.0f;
    PF_Pixel color = {255, 255, 255, 255};
  };

  struct ImageDraw {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float u1 = 0.0f;
    float v1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;
    float u2 = 1.0f;
    float v2 = 0.0f;
    float x3 = 0.0f;
    float y3 = 0.0f;
    float u3 = 1.0f;
    float v3 = 1.0f;
    float x4 = 0.0f;
    float y4 = 0.0f;
    float u4 = 0.0f;
    float v4 = 1.0f;
    int imageId = 0;
    std::uint64_t imageVersion = 0;
    PF_Pixel tint = {255, 255, 255, 255};
  };

  struct FilterPass {
    std::int32_t filterKind = 0;
    float value = 0.0f;
  };

  struct MaskPass {
    int maskImageId = 0;
    std::uint64_t maskImageVersion = 0;
  };

  enum DrawBatchType : std::uint8_t {
    DRAW_BATCH_FILLS = 0,
    DRAW_BATCH_STROKES = 1,
    DRAW_BATCH_IMAGES = 2,
    DRAW_BATCH_PATH_FILLS = 3,
    DRAW_BATCH_FILTERS = 4,
    DRAW_BATCH_MASKS = 5,
    DRAW_BATCH_TEXT_IMAGES = 6,
  };

  struct DrawBatch {
    DrawBatchType type = DRAW_BATCH_FILLS;
    std::size_t start = 0;
    std::size_t count = 0;
    std::size_t explicitEdgeStart = 0;
    std::size_t explicitEdgeCount = 0;
    int blendMode = BLEND_MODE_BLEND;
    bool erase = false;
    float eraseStrength = 1.0f;
    int clipImageId = 0;
    bool hasAnalyticClip = false;
    std::uint32_t clipContourStart = 0;
    std::uint32_t clipContourCount = 0;
    float clipMinX = 0.0f;
    float clipMinY = 0.0f;
    float clipMaxX = 0.0f;
    float clipMaxY = 0.0f;
  };

  std::vector<FillTriangle> fillTriangles;
  std::vector<BoundaryEdge> boundaryEdges;
  std::vector<FillTriangle> strokeTriangles;
  std::vector<BoundaryEdge> strokeBoundaryEdges;
  std::vector<PathFillVertex> pathFillVertices;
  std::vector<PathFillContour> pathFillContours;
  std::vector<PathFill> pathFills;
  std::vector<ImageDraw> imageDraws;
  std::vector<FilterPass> filterPasses;
  std::vector<MaskPass> maskPasses;
  std::vector<DrawBatch> drawBatches;
};

struct BitmapFramePlanOp {
  long frame = 0;
  GpuRenderPlan drawPlan;
};

struct BitmapFramePlan {
  BitmapGpuExecutionProfile profile = BITMAP_GPU_PROFILE_STATEFUL_ACCUMULATION;
  std::uint64_t cacheKey = 0;
  long targetFrame = 0;
  A_long width = 0;
  A_long height = 0;
  A_long logicalWidth = 0;
  A_long logicalHeight = 0;
  long checkpointInterval = 0;
  bool hasSeedGpuCheckpoint = false;
  long seedFrame = 0;
  bool supported = true;
  std::string unsupportedReason;
  std::vector<BitmapFramePlanOp> operations;
};

struct BitmapGpuRenderTarget {
  PF_EffectWorld* outputWorld = NULL;
  PF_PixelFormat pixelFormat = PF_PixelFormat_INVALID;
  void* outputWorldData = NULL;
  A_long sourceOriginX = 0;
  A_long sourceOriginY = 0;
  A_long logicalWidth = 0;
  A_long logicalHeight = 0;
  PF_GPUDeviceInfo deviceInfo;
};

constexpr std::size_t kDefaultRecentFrameBudgetBytes = 512ULL * 1024ULL * 1024ULL;
constexpr std::size_t kMaxCheckpointSnapshots = 32;
constexpr long kDefaultDenseWindowBacktrack = 8;
constexpr long kDefaultDenseWindowForward = 24;

struct SequenceCacheData {
  A_u_long magic = 0;
  A_u_long version = 0;
  std::uint64_t instanceId = 0;
  A_long syncedRevision = -1;
  A_u_long bundleTextSize = 0;
  A_u_long sourceTextSize = 0;
};

constexpr A_u_long kSequenceCacheDataMagic = 0x4D4F4D54UL;  // 'MOMT'
constexpr A_u_long kSequenceCacheDataLegacyVersion = 2;
constexpr A_u_long kSequenceCacheDataVersion = 3;

}  // namespace momentum

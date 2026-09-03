#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include <JavaScriptCore/JavaScript.h>

#include "controllers/types.h"
#include "scene/types.h"
#include "scripting/runtime/loop_control.h"

namespace momentum {

struct RuntimeEngineState : RuntimeStyleState {
  RuntimeLoopState loopState;
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
  bool noiseInitialized = false;
  std::vector<double> noiseValues;
};

extern thread_local JsHostRuntime* g_activeRuntime;

enum class RuntimeCodeTransitionMode {
  kRestart = 0,
  kSoft = 1,
};

struct RuntimeSoftCodeCue {
  A_Time time = {0, 1};
  std::string sourceHash;
  std::string patchSource;
};

struct CachedSketchState {
  struct FrameSnapshot {
    long frame = 0;
    ScenePayload scene;
    ControllerPoolState controllerState;
    bool hasControllerState = false;
  };

  JSGlobalContextRef context = NULL;
  JSValueRef drawFn = NULL;
  ScenePayload latestScene;
  JsHostRuntime runtime;
  std::string source;
  std::string sourceHash;
  std::string controllerHash;
  std::vector<RuntimeSoftCodeCue> softCodeCues;
  std::size_t nextSoftCodeCueIndex = 0;
  std::string controllerStateHash;
  ControllerPoolState controllerState;
  bool hasControllerState = false;
  std::size_t frameCacheBudgetBytes = 512ULL * 1024ULL * 1024ULL;
  long checkpointInterval = 12;
  A_Time codeStartTime = {0, 1};
  A_long hostTimeStep = 0;
  A_u_long hostTimeScale = 1;
  A_long outputWidth = 0;
  A_long outputHeight = 0;
  long lastFrame = 0;
  long simulatedFrame = 0;
  bool controllerHistoryDirty = false;
  long controllerHistoryDirtyFrame = -1;
  bool valid = false;
  std::unordered_map<long, FrameSnapshot> exactSnapshots;
  std::vector<long> exactSnapshotOrder;
  // Immutable per-frame command deltas shared by every raster backend.
  std::unordered_map<long, ScenePayload> frameScenes;
  std::unordered_map<long, std::uint64_t> frameControllerTimelineHashes;
};

struct RuntimeSketchBundle {
  int bundleVersion = 0;
  std::string runtimeTarget;
  std::string sourcePath;
  std::string sourceText;
  std::string sourceHash;
  std::string debugTracePath;
  std::string controllerHash;
  RuntimeCodeTransitionMode requestedCodeTransition =
    RuntimeCodeTransitionMode::kRestart;
  long codeCueSafetyVersion = 0;
  std::string codeCueContextHash;
  std::string codeCueSemanticHash;
  std::string codeCueTargetPatchSource;
  bool codeCueHasDraw = false;
  std::vector<RuntimeSoftCodeCue> softCodeCues;
  std::vector<RuntimeControllerSlotSpec> controllerSlots;
  // UI-only transport metadata used while committing an editor Cue. The
  // rendered Cue start is always resolved from AE's actual keyframe stream.
  double requestedCueTimeSeconds = -1.0;
  A_Time codeStartTime = {0, 1};
  double pixelDensity = 1.0;
  std::size_t recentFrameBudgetBytes = 512ULL * 1024ULL * 1024ULL;
  long checkpointInterval = 12;
  bool hasEmbeddedSource = false;
};

constexpr std::size_t kDefaultRecentFrameBudgetBytes = 512ULL * 1024ULL * 1024ULL;

}  // namespace momentum

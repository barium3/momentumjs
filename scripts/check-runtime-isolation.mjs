import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const environment = read("src/plugin/scripting/runtime/environment.cpp");
const runtimeCore = read("src/plugin/scripting/runtime/core.cpp");
const renderContext = read("src/plugin/host/effect/render.cpp");
const effectMain =
  read("src/plugin/host/effect/render.h") +
  read("src/plugin/host/entry.cpp") +
  read("src/plugin/host/effect/parameters.cpp") +
  read("src/plugin/host/effect/events.cpp") +
  read("src/plugin/host/effect/sequence.cpp") +
  read("src/plugin/host/effect/code_editor.cpp") +
  renderContext +
  read("src/plugin/host/sequence_data.cpp");
const codeSnapshotNative = read("src/plugin/host/code/snapshot.cpp");
const codeTimelineState = read("src/plugin/host/code/timeline.cpp");
const runtimeMaintenance = read("src/plugin/scripting/runtime/maintenance.cpp");
const momentumTypes = [
  "src/plugin/controllers/types.h",
  "src/plugin/host/parameter_layout.h",
  "src/plugin/host/sequence_data.h",
  "src/plugin/scene/types.h",
  "src/plugin/scripting/runtime/types.h",
].map(read).join("\n");
const effectContract = read("src/plugin/host/effect_contract.h");
const pipl = read("src/plugin/host/resources/MomentumPiPL.r");
const runtimeFiles = read("jsx/plugin/runtimeFiles.jsx");
const bitmapApply = read("jsx/plugin/bitmapApply.jsx");
const codeSnapshot = read("jsx/plugin/codeSnapshot.jsx");
const timelineClock = read("js/ui/timelineClock.js");
const effectCodeClock = read("js/ui/effectCodeClock.js");
const effectCodeDiff = read("js/ui/effectCodeDiff.js");
const effectCode = read("js/ui/effectCode.js");
const editorSurface = read("js/ui/editor/editorSurface.js");
const codeCueSafety = read("js/compiler/analyzers/codeCueSafety.js");
const controllerCollection = read("js/compiler/collectors/controllerCollection.js");
const mainHtml = read("index.html");
const panelStyles = read("styles.css");
const extensionManifest = read("CSXS/manifest.xml");
const pluginBridge = read("js/plugin/bridge.js");
const monacoLoader = read("js/vendor/monaco-editor/min/vs/loader.js");
const monacoEditorMain = read("js/vendor/monaco-editor/min/vs/editor/editor.main.js");
const bitmapMetalRenderer =
  read("src/plugin/rendering/bitmap/backends/metal/renderer.mm") +
  read("src/plugin/rendering/bitmap/backends/metal/shaders.cpp");
const bitmapRenderer = read("src/plugin/rendering/bitmap/backends/gpu/renderer.cpp");
const bitmapCpuRenderer = read("src/plugin/rendering/bitmap/backends/cpu/renderer.cpp");
const bitmapPlan =
  read("src/plugin/rendering/bitmap/planning/plan.h") +
  read("src/plugin/rendering/bitmap/planning/planner.cpp");
const renderCore = read("src/plugin/rendering/software/rasterizer.cpp");
const apiStyle = read("src/plugin/scripting/api/style.cpp");
const apiImage = read("src/plugin/scripting/api/image.cpp");
const frameCache = read("src/plugin/scripting/runtime/frame_cache.cpp");
const editorManager = read("js/ui/editor/editorManager.js");
const activeFileSource = read("js/ui/files/activeFile.js");
const codeBundle = read("js/ui/codeBundle.js");
const bitmapControllerBootstrap = read(
  "js/ui/editor/bitmapControllerBootstrap.js",
);
const codeExecutor = read("js/ui/editor/codeExecutor.js");
const debugTraceManager = read("js/ui/console/debugTraceManager.js");
const debugTraceHost = read("jsx/plugin/debugTrace.jsx");
const installerCommon = read("scripts/lib/common.sh");

assert.match(
  editorSurface,
  /MONACO_LOADER_URL[\s\S]*COMMON_EDITOR_OPTIONS[\s\S]*defineTheme[\s\S]*function create\(/,
  "one shared editor surface must own Monaco loading, common options, theming, and creation",
);
assert.match(
  editorSurface,
  /"editor\.background": "#1a1a19"/,
  "Effect Code diff highlighting must preserve Momentum's current editor base",
);
assert.match(
  mainHtml,
  /timelineClock\.js[\s\S]*effectCodeDiff\.js[\s\S]*effectCodeClock\.js[\s\S]*effectCode\.js/,
  "the diff renderer must initialize before Effect Code starts",
);
assert.doesNotMatch(
  effectCodeDiff,
  /createDiffEditor|editor\.create\(/,
  "diff highlighting must reuse the shared editor instead of creating a second Monaco instance",
);
assert.match(
  editorSurface,
  /MONACO_ROOT = "js\/vendor\/monaco-editor\/min"[\s\S]*MONACO_LOADER_URL = `\$\{MONACO_ROOT\}\/vs\/loader\.js`/,
  "the shared editor must load its vendored Monaco runtime",
);
assert.doesNotMatch(
  editorSurface,
  /MONACO_CDN_ROOT|cdnjs\.cloudflare\.com\/ajax\/libs\/monaco-editor/,
  "Monaco must not depend on the network at runtime",
);
assert.ok(
  monacoLoader.length > 1000 && monacoEditorMain.length > 100000,
  "the vendored Monaco loader and editor runtime must be packaged",
);
assert.match(
  editorSurface,
  /function configureSynchronousWorkers\([\s\S]*MonacoEnvironment[\s\S]*environment\.getWorker[\s\S]*throw new Error\(SYNCHRONOUS_WORKER_MESSAGE\)[\s\S]*configureSynchronousWorkers\(\)/,
  "AE CEP must force Monaco onto its supported synchronous fallback instead of creating crash-prone Dedicated Workers",
);
assert.match(
  editorSurface,
  /MONACO_WORKER_FALLBACK_WARNING[\s\S]*console\.warn = function \(message\)[\s\S]*message === SYNCHRONOUS_WORKER_MESSAGE/,
  "expected synchronous-fallback warnings must be filtered without loading Monaco internals",
);
assert.doesNotMatch(
  editorSurface,
  /vs\/base\/common\/worker\/simpleWorker/,
  "the editor surface must not load Monaco's internal worker module",
);
assert.doesNotMatch(
  editorSurface + editorManager + effectCode,
  /new\s+Worker\s*\(/,
  "Momentum editor code must not create a browser Dedicated Worker",
);
assert.match(
  mainHtml,
  /editor\/validation\.js[\s\S]*editor\/autocomplete\.js[\s\S]*editor\/editorSurface\.js[\s\S]*editor\/editorManager\.js/,
  "the main Panel must create its editor through the shared Monaco surface",
);
assert.equal(
  (editorSurface + editorManager + effectCode).match(/monaco\.editor\.create\(/g)?.length || 0,
  1,
  "Monaco editor instances must have one shared creation path",
);
assert.doesNotMatch(
  mainHtml,
  /monaco-editor[^\n]*loader\.min\.js|<textarea[\s>]/,
  "the Panel must not duplicate Monaco loading or retain a plain Code Editor textarea",
);
assert.match(
  editorSurface,
  /ownedModel = monaco\.editor\.createModel\([\s\S]*delete editorOptions\.value[\s\S]*editorOptions\.model = ownedModel[\s\S]*monaco\.editor\.create\(container, editorOptions\)/,
  "the shared editor must receive an explicit persistent model instead of Monaco's auto-disposed value model",
);
assert.match(
  editorManager,
  /function acquireTemporaryMode\([\s\S]*workspaceModel = editor\.getModel\(\)[\s\S]*attach\(model\)[\s\S]*release\(\)[\s\S]*editor\.setModel\(workspaceModel\)/,
  "the editor manager must own one temporary-mode lease around its persistent workspace model",
);
assert.match(
  effectCode,
  /function attachEffectModel\([\s\S]*editorModeLease\.attach\(model\)[\s\S]*function releaseWorkspace\([\s\S]*lease\.release\(\)[\s\S]*workspaceManager\.leaveEffectCode\(\)/,
  "Effect Code model swaps and workspace restoration must go through the editor lease",
);
const effectCodeTeardownBody = effectCode.match(
  /function teardownSession\([\s\S]*?\n  function closeSession/,
)?.[0] ?? "";
assert.match(
  effectCodeTeardownBody,
  /runCleanup\(releaseWorkspace\)[\s\S]*disposeModelRegistry\(sessionModels\)/,
  "Effect Code must return the editor lease before disposing its session models",
);
assert.doesNotMatch(
  effectCode,
  /captureWorkspaceState|saved\.model|saved\.source|saved\.language|editor\.setModel\(|stagingModel/,
  "Effect Code must not retain raw workspace models or an obsolete staging model",
);
assert.match(
  effectCode,
  /function disposeModelRegistry[\s\S]*entry\.model\.dispose\(\)[\s\S]*function createEffectSourceModel[\s\S]*monaco\.editor\.createModel\(source, "javascript", uri\)[\s\S]*function createSessionModelRegistry[\s\S]*createEffectSourceModel/,
  "Effect Code must preload and dispose independent Monaco source models",
);
assert.match(
  effectCode,
  /previousEntry\.model\.isDisposed[\s\S]*registry\[sourceHash\] = previousEntry[\s\S]*activeModelHash = nextModels\[previousActiveModelHash\][\s\S]*disposeModelRegistry\(previousModels, nextModels\)/,
  "seamless Effect Code refreshes must retain live Monaco models instead of remounting copies",
);
assert.doesNotMatch(
  extensionManifest,
  /com\.example\.momentum\.js\.codeEditor|<Type>Modeless<\/Type>/,
  "Effect Code must not retain a second CEP extension or Modeless window",
);

assert.match(
  installerCommon,
  /build\/Momentum\.plugin[\s\S]*build\/Debug\/Momentum\.plugin/,
  "installer must prefer the active single-config CMake bundle over a stale Debug bundle"
);

assert.equal(
  (environment.match(/EffectRuntimeKey ResolveEffectRuntimeKey\(/g) || []).length,
  1,
  "there must be exactly one runtime-key implementation"
);
assert.match(
  environment,
  /PF_EffectSequenceDataSuite1[\s\S]*PF_GetConstSequenceData/,
  "Smart Render must resolve read-only sequence data through the AE suite"
);
assert.match(
  environment,
  /ReadLiveEffectSessionId[\s\S]*liveEffectSessionId/,
  "Sequence Data must expose one process-local live Effect session"
);
assert.match(
  momentumTypes,
  /std::uint64_t liveEffectSessionId = 0;/,
  "live Sequence Data must carry one process-local Effect session id"
);
assert.doesNotMatch(
  environment,
  /gEffectRefRuntimeAliases|reinterpret_cast<EffectRuntimeKey>\(in_data->effect_ref\)/,
  "effect_ref must not be registered in a separate alias table"
);
const liveEffectSessionIdentityBody =
  environment.match(/std::uint64_t ResolveLiveEffectSessionId\([\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  liveEffectSessionIdentityBody,
  /ResolveEffectRuntimeKey/,
  "persistent render lanes must use the live Effect session identity"
);
assert.doesNotMatch(
  liveEffectSessionIdentityBody,
  /creationToken|instanceId/,
  "creation transport metadata must never participate in render identity"
);
assert.doesNotMatch(
  liveEffectSessionIdentityBody,
  /effect_ref/,
  "transient AE render callback references must never own persistent lanes"
);
assert.match(
  effectMain,
  /flattenedData->liveEffectSessionId\s*=\s*0/,
  "flattening must remove live identity so replicas cannot share mutable state"
);
assert.match(
  effectMain,
  /PF_ADD_POINT\([\s\S]*ControllerPointParamDiskId\(slot\)/,
  "point controllers must remain native AE point parameter streams"
);
assert.match(
  effectMain,
  /\w+\.events\s*=\s*PF_CustomEFlag_EFFECT\s*\|\s*PF_CustomEFlag_COMP\s*;/,
  "custom UI registration must include the read-only Composition clock"
);
assert.doesNotMatch(
  effectMain,
  /PF_CustomEFlag_LAYER|HandleCustomCompUIEvent|PointHandleDrawInfo|point-overlay-drag/,
  "Composition and Layer point interaction must remain owned by AE's native point UI"
);
assert.match(
  effectMain,
  /windowType == PF_Window_COMP[\s\S]*PF_Event_DRAW[\s\S]*ObserveCodeEditorCompDraw[\s\S]*return PF_Err_NONE/,
  "the Composition custom UI must only observe redraws and never consume input"
);
assert.doesNotMatch(
  runtimeCore,
  /activePointSlot|GetEffectSessionActivePointSlot|SetEffectSessionActivePointSlot/,
  "native point UI must not retain a parallel process-local selection state"
);
assert.match(
  effectMain,
  /ResetSequence[\s\S]*live-effect-session-created/,
  "shared sequence reset must create an independent live Effect session"
);
assert.match(
  effectMain,
  /SequenceResetup[\s\S]*return ResetSequence/,
  "Sequence Resetup must create an independent live Effect session"
);
assert.match(
  effectMain.match(/constexpr PF_OutFlags kMomentumBaseOutFlags[\s\S]*?;/)?.[0] ?? "",
  /PF_OutFlag_NON_PARAM_VARY/,
  "time-driven Bitmap sketches must declare non-parameter variation"
);
assert.match(
  effectMain,
  /\w+->out_flags \|= PF_OutFlag_NON_PARAM_VARY/,
  "dynamic flags must preserve non-parameter variation"
);
assert.match(
  effectMain.match(/constexpr PF_OutFlags kMomentumBaseOutFlags[\s\S]*?;/)?.[0] ?? "",
  /PF_OutFlag_WIDE_TIME_INPUT[\s\S]*PF_OutFlag_SEQUENCE_DATA_NEEDS_FLATTENING/,
  "stateful sketches must declare temporal dependency and sequence flattening"
);
assert.match(
  effectMain.match(/constexpr PF_OutFlags2 kMomentumBaseOutFlags2[\s\S]*?;/)?.[0] ?? "",
  /PF_OutFlag2_SUPPORTS_GPU_RENDER_F32/,
  "GPU playback must be declared in the shared effect contract"
);
assert.match(
  effectMain.match(/constexpr PF_OutFlags2 kMomentumBaseOutFlags2[\s\S]*?;/)?.[0] ?? "",
  /PF_OutFlag2_I_MIX_GUID_DEPENDENCIES/,
  "Effect-local bitmap Documents must participate in the AE frame-cache GUID"
);
assert.match(
  effectMain,
  /documentIdentityStream[\s\S]*sourceHash[\s\S]*GuidMixInPtr/,
  "PreRender must mix the Effect-local bitmap Document into the frame-cache GUID"
);
assert.match(
  effectMain,
  /PF_Err ResetSequence\([\s\S]*EnsureSequenceDataHandleInitialized\([\s\S]*LiveEffectSessionMode::kCreateFresh[\s\S]*PF_Err SequenceSetup\([\s\S]*ResetSequence\([\s\S]*"sequence-setup"[\s\S]*PF_Err SequenceResetup\([\s\S]*ResetSequence\([\s\S]*"sequence-resetup"/,
  "Sequence Setup and Resetup must rebind copied effects to independent sessions"
);
assert.match(
  effectMain,
  /sessionMode == LiveEffectSessionMode::kReuseExisting[\s\S]*DiscardEffectRuntimeState\(previousRuntimeKey/,
  "reuse-mode replacement must retire only its own previous live session"
);
assert.match(
  effectMain,
  /SequenceFlatten[\s\S]*CopyFlattenedSequenceData\(input, output\)[\s\S]*GetFlattenedSequenceData[\s\S]*CopyFlattenedSequenceData\(input, output\)/,
  "all flattened snapshots must strip process-local UI identity"
);
assert.match(
  effectMain,
  /struct RenderInvocationInfo \{[\s\S]*std::uintptr_t runtimeKey/,
  "PreRender data must carry an invocation-owned runtime across the Smart Render boundary"
);
assert.match(
  effectMain,
  /info->runtimeKey = NextRenderInvocationRuntimeKey\(\)/,
  "PreRender must create an isolated evaluator"
);
assert.match(
  effectMain,
  /PrepareEffectRuntimeDocument\([\s\S]*info->runtimeKey/,
  "PreRender must prepare its immutable Document with the isolated evaluator"
);
assert.doesNotMatch(
  effectMain.match(/PF_Err BuildRenderInvocationInfo\([\s\S]*?PF_Err CopyCpuRasterToOutput\(/)?.[0] ?? "",
  /ResolveEffectRuntimeKey/,
  "render invocation identity must never come from Sequence/UI state"
);
assert.match(
  effectMain,
  /BuildBitmapFramePlanAtCurrentTime\(\s*(?:input|in_data),\s*info->runtimeKey/,
  "Bitmap frame planning must consume the invocation runtime delivered through pre_render_data"
);
assert.match(
  runtimeCore,
  /ExecuteSketchAtCurrentTime\([\s\S]*?ResolveEffectRuntimeState\(invocationKey, false\)[\s\S]*?ResolveEffectRuntimeState\(renderCacheKey, true\)/,
  "render evaluation must separate immutable PreRender inputs from the persistent evaluator lane"
);
assert.doesNotMatch(
  runtimeCore.match(/bool CheckoutControllerStateAtTime\([\s\S]*?A_long SketchFrameToTimeValue\(/)?.[0] ?? "",
  /GetLiveControllerState|ResolveEffectRuntimeKey/,
  "rendered controller values must come directly from AE parameter streams"
);
assert.match(
  runtimeCore,
  /ExpandDownsampledPointCoordinate[\s\S]*downsample\.den[\s\S]*downsample\.num[\s\S]*param\.u\.td\.x_value[\s\S]*in_data->downsample_x[\s\S]*param\.u\.td\.y_value[\s\S]*in_data->downsample_y/,
  "native AE Point values must be restored to logical createCanvas coordinates before replay"
);
assert.match(
  runtimeCore,
  /ScopedRuntimeDocument documentScope\(&bundle\)/,
  "Smart Render controller replay must use the immutable Document captured by PreRender"
);
assert.match(
  runtimeCore,
  /CaptureEffectControllerTimeline[\s\S]*CheckoutControllerStateAtTime[\s\S]*invocationState->controllerTimeline = std::move\(timeline\)/,
  "PreRender must publish an immutable AE controller timeline into the invocation"
);
assert.match(
  runtimeCore,
  /invocationState->controllerTimelinePrefixHashes = std::move\(timelinePrefixHashes\)/,
  "PreRender must publish prefix hashes so retained Bitmap history can reject edited keyframes"
);
assert.match(
  runtimeCore,
  /ScopedControllerTimeline controllerTimelineScope/,
  "both Bitmap executors must consume the invocation controller timeline"
);
assert.match(
  runtimeCore,
  /const bool canAdvanceFromCurrent[\s\S]*targetFrame > cache\.lastFrame/,
  "the live evaluator lane must advance from any valid earlier frontier"
);
assert.match(
  runtimeCore,
  /cache=history[\s\S]*return recordedScene->second/,
  "an old Bitmap frame must reuse immutable command history without rewinding the live evaluator"
);
assert.doesNotMatch(
  runtimeCore,
  /forward-lane-rebase/,
  "old-frame recovery must not destroy the forward Bitmap lane"
);
assert.match(
  runtimeCore,
  /Planning never depends on a mutable GPU cursor[\s\S]*collectScenes\(fallbackStartFrame, targetFrame, &scenes\)/,
  "every Metal plan must retain a self-contained logical fallback"
);
assert.match(
  runtimeCore,
  /targetStartsIndependentSurface[\s\S]*stage=planner mode=independent-surface[\s\S]*return true/,
  "an opaque per-frame background must keep the common planning path O(1)"
);
assert.doesNotMatch(
  runtimeCore,
  /QueryBitmapGpuCanvasCursor|QueryBitmapGpuRecoveryCanvasCursor|stateful-append|stateful-reuse-playback-canvas/,
  "planning must not depend on a mutable backend cursor"
);
assert.match(
  bitmapMetalRenderer,
  /GetOrCreateMetalCacheRenderLock\(plan\.cacheKey\)[\s\S]*GetNearestMetalExactFrameTexture[\s\S]*GetNearestMetalCanvasCheckpoint/,
  "Metal must select immutable seeds only after acquiring the per-cache render lock"
);
assert.match(
  bitmapMetalRenderer,
  /if \(seedFrame < 0\)[\s\S]*plan\.fallbackSurfaceStart[\s\S]*const long firstOperationFrame = seedFrame \+ 1/,
  "a missing seed must execute the complete plan from its explicit fallback surface"
);
assert.doesNotMatch(
  momentumTypes + runtimeCore + bitmapMetalRenderer,
  /hasSeedGpuCheckpoint|useRecoveryCanvas|hasPreferredRecoveryCursor|preferredRecoveryFrame|gMetalRecoveryCanvasStates|replayFromScratch|effectiveSurfaceStart/,
  "the retired mutable recovery-canvas protocol must not return"
);
assert.doesNotMatch(
  runtimeCore,
  /const bool shouldCaptureRuntimeState = true|TrimBitmapPlanScenesAfterLastFullClear/,
  "the forward lane must not serialize every JS frame or classify background semantics"
);
assert.doesNotMatch(
  effectMain,
  /cpuRenderCacheKey|gpuRenderCacheKey/,
  "CPU and Metal must not fork the shared Bitmap evaluator identity"
);
assert.match(
  effectMain,
  /std::uintptr_t renderCacheKey = 0;[\s\S]*ResolveEffectRenderCacheKeyForScale/,
  "CPU and Metal must consume one shared Bitmap cache identity"
);
assert.match(
  environment,
  /MOMENTUM_VERBOSE_RENDER_LOG[\s\S]*ShouldWriteRenderDiagnostic/,
  "hot-path diagnostics must be filtered unless verbose logging is requested"
);
assert.match(
  effectMain,
  /GuidMixInPtr\([\s\S]*controllerTimelineHash\.data\(\)/,
  "controller values and keyframe history must participate in the AE frame-cache GUID"
);
const updateParamsUiBody =
  effectMain.match(/PF_Err UpdateParamsUI\([\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(
  updateParamsUiBody,
  /SyncControllerParamValuesFromBundle|SyncLiveControllerStateFromBundle/,
  "UPDATE_PARAMS_UI must never overwrite AE-owned controller values or keyframes"
);
assert.match(
  effectMain,
  /fillTriangles[\s\S]*bitmap-frame-plan-ready/,
  "Bitmap planning must expose geometry and successful output diagnostics"
);
assert.match(
  effectMain,
  /DownsampleScale\((?:input|in_data)->downsample_x\)[\s\S]*renderCanvasWidth[\s\S]*sourceStepX/,
  "interactive AE downsampling must map the complete logical canvas into the reduced output"
);
const outputCopyOriginBody =
  renderContext.match(
    /OutputCopyOriginInfo ResolveOutputCopyOrigin\([^;]*?\)\s*\{[\s\S]*?\n\}/
  )?.[0] ?? "";
assert.match(
  outputCopyOriginBody,
  /originSourceX = outputWorld\.origin_x - invocation\.canvasLeft[\s\S]*sourceOriginX = static_cast<double>\(originSourceX\)/,
  "AE output-world origins must remain in logical layer coordinates"
);
assert.doesNotMatch(
  outputCopyOriginBody,
  /originSourceX\) \* result\.sourceStepX|originSourceY\) \* result\.sourceStepY/,
  "downsample copy must not scale AE's logical output-world origin twice"
);
const preRenderCanvasRectBody =
  effectMain.match(/PF_LRect canvasRect\{\};[\s\S]*?extra->output->max_result_rect = canvasRect;/)?.[0] ?? "";
assert.match(
  preRenderCanvasRectBody,
  /canvasRect\.right =\s*canvasRect\.left \+ std::max<A_long>\(1, info->canvasWidth\)[\s\S]*canvasRect\.bottom =\s*canvasRect\.top \+ std::max<A_long>\(1, info->canvasHeight\)/,
  "Smart PreRender rectangles must remain in full-resolution AE layer coordinates"
);
assert.doesNotMatch(
  preRenderCanvasRectBody,
  /renderCanvasWidth|renderCanvasHeight|downsampleScale/,
  "Smart PreRender must not expose physical GPU texture dimensions as AE layer rectangles"
);
assert.match(
  bitmapMetalRenderer,
  /sourceOriginX \+ \(float\(gid\.x\) \+ 0\.5f\) \* uniforms\.sourceStepX/,
  "Metal output copies must scale every reduced-resolution pixel across the complete canvas"
);
assert.doesNotMatch(
  bitmapMetalRenderer,
  /uint2 sourceGid = uint2\(gid\.x \+ uniforms\.sourceOriginX/,
  "Metal output must not crop a reduced AE world from the logical canvas at 1:1"
);
assert.match(effectMain, /gpu-render-complete/);
assert.match(
  effectMain,
  /bitmap::planning::Scale[\s\S]*renderCanvasWidth[\s\S]*renderCanvasHeight/,
  "AE downsample renders must scale the physical GPU plan instead of cropping the logical canvas"
);
assert.match(
  bitmapPlan,
  /void Scale\([\s\S]*fillTriangles[\s\S]*strokeTriangles[\s\S]*pathFillVertices[\s\S]*imageDraws/,
  "interactive GPU scaling must cover every geometry-backed draw family"
);
assert.match(
  effectMain,
  /controller-render-superseded[\s\S]*PF_Interrupt_CANCEL/,
  "obsolete controller renders must be discarded before AE can present stale output"
);
assert.match(
  effectMain,
  /MarkControllerParamHistoryDirty[\s\S]*RegisterControllerInteractionChange\(liveEffectSessionId\)/,
  "every controller edit must advance the Effect-local latest-wins generation"
);
assert.match(
  effectMain,
  /controllerInteractionGeneration\s*=\s*ReadControllerInteractionGeneration\(info->lineageIdentity\)[\s\S]*CaptureEffectControllerTimeline/,
  "PreRender must snapshot the interaction generation before capturing controller history"
);
assert.match(
  effectMain,
  /if \(!IsCurrentControllerRenderRequest\(\*info\) \|\|[\s\S]*!IsLatestControllerInteraction\(\*info\)\)[\s\S]*policy=latest-wins[\s\S]*PF_Interrupt_CANCEL/,
  "Smart Render entry must discard controller requests superseded while waiting"
);
assert.doesNotMatch(
  effectMain,
  /PARAM_INSTANCE_ID|PARAM_REVISION|ResolveStableInstanceId/,
  "render and controller logic must not retain the retired persistent ids"
);
assert.match(
  runtimeCore,
  /ResolveEffectRenderCacheKeyForScale[\s\S]*preview resize cannot evict full-resolution checkpoints/,
  "interactive physical canvases must not evict the exact full-resolution lane"
);
assert.match(
  bitmapPlan,
  /holes\.empty\(\)[\s\S]*geometry::Triangulate[\s\S]*AppendFillBatch/,
  "ordinary single-contour p5 shapes must use the analytic triangle GPU path"
);
assert.match(
  runtimeCore,
  /PreRender did not prepare the requested Sketch Document/,
  "Smart Render must not reload mutable DocumentStore state after PreRender"
);
assert.match(effectContract, /MOMENTUM_EFFECT_OUT_FLAGS 0x06008416/);
assert.match(effectContract, /MOMENTUM_EFFECT_OUT_FLAGS2 0x0AA21401/);
assert.match(effectMain, /PF_OutFlag2_SUPPORTS_THREADED_RENDERING/);
assert.match(pipl, /AE_Effect_Version \{\s*MOMENTUM_VERSION_PIPL\s*\}/);
assert.match(
  effectMain,
  /MOMENTUM_VERSION_PIPL == PF_VERSION\([\s\S]*MOMENTUM_VERSION_BUILD[\s\S]*C\+\+ and PiPL effect versions diverged/,
  "the compiled effect and PiPL resource must share one checked version encoding"
);
assert.match(pipl, /AE_Effect_Global_OutFlags \{\s*MOMENTUM_EFFECT_OUT_FLAGS\s*\}/);
assert.match(pipl, /AE_Effect_Global_OutFlags_2 \{\s*MOMENTUM_EFFECT_OUT_FLAGS2\s*\}/);
assert.doesNotMatch(
  effectMain,
  /GetEffectRefKey|GetEffectRuntimeKey|ResolvePointControllerRuntimeKey/,
  "all Effect-local consumers must use the single runtime-key resolver"
);
assert.doesNotMatch(
  runtimeCore,
  /gSketchRuntimeMutex|g_cachedSketches|g_cachedGpuFramePlans|g_liveControllerStates/,
  "keyframe replay state must not use the removed process-wide cache/lock system"
);
assert.doesNotMatch(
  runtimeCore + momentumTypes + bitmapMetalRenderer,
  /DIRECT_FRAME|direct-time-js|BitmapGpuExecutionProfile|useLegacyProfileFastPath/,
  "the removed direct-frame bitmap pipeline must not return"
);
assert.doesNotMatch(
  runtimeCore + momentumTypes + frameCache,
  /checkpointSnapshots|checkpointOrder|runtimeStateJson|FindNearestSnapshotAtOrBefore/,
  "the unused CPU runtime-state checkpoint system must not return"
);
assert.doesNotMatch(
  environment + momentumTypes + editorManager,
  /denseWindowBacktrack|denseWindowForward|backgroundMode|inferStateProfile/,
  "serialized bitmap metadata must contain only settings consumed by the active pipeline"
);
assert.doesNotMatch(
  bitmapRenderer,
  /DirectXBitmapBackend|BitmapGpuFrameworkSupported|virtual PF_GPU_Framework framework/,
  "GPU capability declarations must not retain unimplemented backend placeholders"
);
assert.match(
  runtimeCore,
  /struct EffectRuntimeState[\s\S]*std::recursive_mutex mutex;[\s\S]*controllerTimeline;[\s\S]*CachedSketchState sketch;[\s\S]*bitmapFramePlans;/,
  "each isolated render runtime must own its controller timeline, JS history, and Bitmap frame plans"
);
assert.doesNotMatch(
  runtimeCore,
  /liveControllers|hasLiveControllers|GetLiveControllerState|UpdateLiveControllerState/,
  "controller values must not be duplicated into UI Session state"
);

assert.doesNotMatch(
  runtimeCore,
  /transportInstanceId|syncedRevision|documentRevisionParam|cache\.revision/,
  "runtime caches must not retain transport or Revision identity"
);
assert.doesNotMatch(
  effectMain,
  /ResolveKnownInstanceId|gRuntimeInstanceRegistry|gRuntimeSyncedRevision|gRuntimeSyncedControllerHash|gPointOverlayActiveSlots/,
  "effect-local metadata must not escape into parallel global registries"
);
assert.doesNotMatch(
  runtimeCore + effectMain,
  /ResetEffectSessionRenderCache|SketchExecutionMode|kCpuFallback|cpuRenderCacheKey|gpuRenderCacheKey/,
  "the removed split CPU/GPU Bitmap pipeline must not return"
);
assert.match(
  effectMain,
  /SelectEffectRuntimeSketchBundle[\s\S]*hasEmbeddedSource/,
  "the effect-embedded Code streams must remain authoritative"
);
assert.match(
  runtimeFiles,
  /_momentumSeedBitmapCreationTokenCounter/,
  "creation-token allocation must be seeded from existing transport folders"
);
assert.match(
  bitmapApply,
  /var creationToken = _momentumNextBitmapCreationToken\(\)/,
  "each newly-created bitmap effect must receive a fresh one-shot creation token"
);
assert.doesNotMatch(
  bitmapApply + editorManager + effectMain + runtimeCore + momentumTypes,
  /PARAM_REVISION|kRevisionParamDiskId|\.revision\b|\brevision\s*=/,
  "Revision must not return as a second source identity"
);
assert.match(
  debugTraceManager,
  /const parsed = parseTraceLine\(line\);\s*if \(!parsed\) \{\s*continue;/,
  "background diagnostics must be filtered before reaching the user Console"
);
assert.match(
  debugTraceManager,
  /window\.cep\.fs\.readFile[\s\S]*useExternalClock[\s\S]*updateTimelineSample/,
  "Console playback must read traces outside ExtendScript and share Edit Code time samples",
);
assert.match(
  bitmapApply + debugTraceHost + editorManager + debugTraceManager,
  /compId: Number\(comp\.id\)[\s\S]*compId: applyResult\.compId[\s\S]*sampleCompId !== session\.compId[\s\S]*stopAndClear\(\)/,
  "Bitmap Console tracking must terminate on an exact composition-id change",
);
assert.doesNotMatch(
  debugTraceManager + debugTraceHost,
  /session\.compName|result\.compName|compName: String\(comp\.name/,
  "Console lifecycle must not fall back to ambiguous composition names",
);
assert.match(
  activeFileSource + effectCode,
  /resetRuntimeConsole[\s\S]*stopAndClear\(\)[\s\S]*function teardownSession[\s\S]*stopAndClear\(\)[\s\S]*consoleManager\.clearConsole\(\)/,
  "file and Edit Code boundaries must stop tracking and clear their visible Console channels",
);
assert.doesNotMatch(
  debugTraceManager + debugTraceHost,
  /readFileSegment/,
  "the blocked ExtendScript trace-file reader must be removed",
);
assert.match(
  effectMain + effectCodeClock,
  /AEGP_GetItemViewPlaybackTime/,
  "Effect Code playback must use AE's native view time instead of inferring host stalls",
);
assert.match(effectMain, /code-editor-view-clock\.txt/);
assert.match(effectCodeClock, /readCepTextFile/);
assert.match(effectCodeClock, /VIEW_SAMPLE_MS/);
assert.doesNotMatch(
  effectMain.match(/PF_Err UpdateParamsUI\([\s\S]*?\n\}/)?.[0] ?? "",
  /PublishCodeEditorViewClock/,
  "UPDATE_PARAMS_UI must not remain a release-only timeline clock",
);
assert.match(
  effectMain,
  /void ObserveCodeEditorCompDraw\(\)[\s\S]*PublishCodeEditorViewClockInternal\(\)/,
  "timeline scrubbing must publish from AE's continuous Composition redraw stream",
);
assert.match(
  effectMain,
  /CodeEditIdleHook\([\s\S]*?PublishCodeEditorViewClockInternal\(\)/,
  "preview playback must sample the shared item-view clock from the idle hook",
);
assert.match(
  effectMain,
  /StoreCodeEditSession\([\s\S]*WakeCodeEditorIdleHook\(\)[\s\S]*AEGP_CauseIdleRoutinesToBeCalled/,
  "opening a new active Edit Code session must explicitly wake AE's sleeping idle hook",
);
assert.doesNotMatch(
  effectMain,
  /code-editor-(?:comp-draw-probe|comp-draw-sample|view-clock-ui-sample)/,
  "temporary Composition clock probes must not remain in production",
);
assert.match(
  effectMain + effectCodeClock,
  /view-clock-v2[\s\S]*sessionToken[\s\S]*sample\.sessionToken !== context\.sessionToken/,
  "every native clock sample must be bound to its exact Edit Code session",
);
assert.doesNotMatch(
  effectMain + codeSnapshot + effectCodeClock,
  /code-editor-(?:render|playback)-clock|render-clock-v1|renderClockPath|playbackClockPath|parseRenderClock|parsePlaybackClock|PublishCodeEditorTimelineClock|ReadCodeEditSessionForCodeStream/,
  "Edit Code must use one supported item-view clock instead of a render-callback side channel",
);
assert.doesNotMatch(
  effectMain + codeSnapshot + effectCodeClock,
  /PublishCodeEditorUiClock|momentumReadCodeEditorScrubTime|SCRUB_(?:ACTIVE|IDLE|RETRY|SAMPLE)/,
  "the release-only UI clock and host-blocked ExtendScript scrub probes must stay removed",
);
assert.match(
  effectCodeClock,
  /nativePreviewing = sample\.previewing;\s*applyTimeSample\(sample\);/,
  "item-view samples must update Edit Code during both preview and manual timeline movement",
);
assert.match(
  codeBundle + effectCode + codeSnapshot,
  /runtimeMetadata[\s\S]*debugTracePath[\s\S]*_momentumResolveCodeEditorRuntimePath/,
  "Code commits must preserve and reconnect their runtime Console transport",
);
assert.match(
  debugTraceManager,
  /if \(!match\) \{\s*return null;/,
  "only structured user console records may be replayed in the Console"
);
assert.match(
  effectMain,
  /ResolveFullCodeCueTimeline[\s\S]*PF_CheckoutKeyframe[\s\S]*CanApplySoftCodeCue/,
  "Bitmap rendering must capture the complete AE Code Cue timeline"
);
assert.match(
  codeSnapshotNative,
  /snapshot\.transitionMode == kCodeSnapshotTransitionSoft[\s\S]*kCodeSnapshotTransitionRestart/,
  "Code snapshots must persist their automatic Soft or Restart decision"
);
assert.match(
  runtimeCore,
  /ApplySoftCodeCuesForFrame[\s\S]*momentum-soft-code-cue\.js[\s\S]*soft-code-cue-applied/,
  "Soft Cues must patch draw in the existing JavaScript runtime"
);
assert.match(
  mainHtml,
  /controllerCollection\.js[\s\S]*codeCueSafety\.js/,
  "the unified Momentum editor must load the controller and Cue safety analyzers"
);
assert.match(
  codeCueSafety,
  /SAFETY_VERSION = 7[\s\S]*collectTopLevelPatchBindings[\s\S]*collectSoftGlobalBindings[\s\S]*frozenGlobals[\s\S]*resolveBinding[\s\S]*findUnsafeFunctionReference[\s\S]*collectLifecycleFingerprint[\s\S]*findUnsafeChangedCode[\s\S]*buildAtomicTargetPatchSource/,
  "AST Cue safety must freeze structural state and build an order-independent target patch"
);
assert.match(
  codeCueSafety,
  /__momentumAppliedBinding[\s\S]*__momentumPreviousBinding[\s\S]*try \{[\s\S]*catch \(__momentumPatchError\)[\s\S]*throw __momentumPatchError/,
  "multi-binding Soft patches must track applied operations and roll back a failed transaction"
);
assert.match(
  codeBundle,
  /compilerCodeCueSafety[\s\S]*buildTargetMetadata/,
  "the shared Code Bundle service must build each Cue's self-contained AST target metadata"
);
assert.match(
  effectCode,
  /validateCodeCueContract[\s\S]*code-cue-contract-rejected/,
  "the Effect editor must apply one AST contract gate before creating a Cue"
);
assert.match(
  codeBundle,
  /validateCodeCueContract[\s\S]*\.controllers[\s\S]*\.fingerprint[\s\S]*controller-contract-changed[\s\S]*不支持二次修改控件/,
  "the unified Code Cue AST contract must reject controller declaration changes with the fixed product message"
);
assert.match(
  controllerCollection,
  /FACTORIES[\s\S]*readFactorySelectChain[\s\S]*staticConfig[\s\S]*declarations[\s\S]*configs[\s\S]*fingerprint/,
  "one compiler collector must derive Base configs and Edit Code fingerprints from the same controller declarations"
);
assert.match(
  bitmapControllerBootstrap,
  /compilerControllerCollectionPass[\s\S]*\.isFactoryName[\s\S]*\.callsiteId/,
  "runtime controller instrumentation must reuse the shared collector's factory and callsite semantics"
);
assert.match(
  codeSnapshot,
  /session\.baseEntry\.bundlePath[\s\S]*controller: baseController/,
  "Code Cue context must expose the exact frozen Base controller contract"
);
assert.match(
  codeBundle,
  /stableSerialize[\s\S]*buildCodeCueBundle[\s\S]*baseController/,
  "controller hashes must be stable and Cue bundles must be built from Base-owned controls"
);
assert.doesNotMatch(
  effectCode + editorManager + codeBundle + codeSnapshot + controllerCollection + bitmapControllerBootstrap + codeExecutor,
  /buildBitmapCodeSnapshotBundle|validateBitmapControllerCueContract|extractBitmapControllerConfigs|collectBitmapControllerCueContract|buildBitmapControllerCallsiteId|controller-schema-rejected|controller-contract-rejected|nextControllerHash|previousControllerHash|bundle\.controller = baseController/,
  "retired controller extractors, duplicate AST validation, and JSX controller rewriting must stay removed"
);
assert.match(
  read("js/compiler/collectors/environmentConfig.js"),
  /name === "pixelDensity"[\s\S]*config\.pixelDensity/,
  "pixel density setters must remain available to the bitmap runtime"
);
assert.doesNotMatch(
  read("js/compiler/validators/callValidationPass.js"),
  /COMPILER_FIXED_ENVIRONMENT_RUNTIME_CALL|COMPILER_FIXED_ENVIRONMENT_DYNAMIC_VALUE/,
  "the shared compiler must not impose Effect Code Cue restrictions on ordinary code"
);
const bitmapCodeCueContractBody =
  codeBundle.match(/function validateCodeCueContract\([\s\S]*?\n  \}\n\n  function mergeControllerConfigs/)?.[0] ?? "";
assert.match(
  codeBundle,
  /FIXED_CODE_CUE_APIS[\s\S]*createCanvas[\s\S]*frameRate[\s\S]*duration[\s\S]*collectFixedCodeCueCalls/,
  "the Effect editor contract must compare fixed API calls regardless of function placement"
);
assert.doesNotMatch(
  bitmapCodeCueContractBody,
  /pixelDensity/,
  "pixel density must remain outside the three fixed Code Cue APIs"
);
assert.doesNotMatch(
  codeBundle,
  /extractBasicDrawDescriptor|__MOMENTUM_SOFT_DRAW__/,
  "the retired text-hole Soft classifier must not return"
);
assert.match(
  environment,
  /safetyVersion[\s\S]*semanticHash[\s\S]*targetPatchSource/,
  "native Bundle parsing must preserve AST identity and the target patch"
);
assert.match(
  effectMain,
  /kOrderIndependentCodeCueSafetyVersion = 7[\s\S]*codeCueContextHash ==[\s\S]*previousBundle\.codeCueContextHash[\s\S]*codeCueTargetPatchSource/,
  "native Cue selection must connect the actual adjacent Cue pair by structural hash"
);
assert.doesNotMatch(
  runtimeCore + momentumTypes,
  /offsetSeconds|RuntimeSoftCodeCue[\s\S]{0,240}drawBody/,
  "runtime Cue scheduling must not revive the retired floating-seconds or draw-body patch path"
);
assert.match(
  momentumTypes,
  /struct RuntimeSoftCodeCue[\s\S]{0,180}A_Time time/,
  "runtime Soft Cues must retain AE's exact timeline time"
);
assert.match(
  runtimeCore,
  /ResolveRuntimeTimelineFrame[\s\S]*CodeTimelineFrameRounding::kUp[\s\S]*frame-clock-changed/,
  "Cue replay must use rational AE timing and invalidate caches when the host frame clock changes"
);
assert.match(
  runtimeCore,
  /ApplySoftCodeCuesForFrame[\s\S]*EvaluateScript\([\s\S]*cue\.patchSource[\s\S]*momentum-soft-code-cue\.js/,
  "offline replay must execute only the validated AST function patch"
);
assert.doesNotMatch(
  runtimeCore + effectMain,
  /ValidateSoftCodePatch|momentum-soft-predecessor\.js|momentum-soft-preflight\.js|codeCuePreviousSourceHash/,
  "the removed predecessor sandbox and compatibility metadata must not return"
);
assert.match(
  codeSnapshot + effectCode,
  /sessionToken[\s\S]*locator[\s\S]*targetMode[\s\S]*targetTimeSeconds/,
  "Edit Code must bind an opaque session to an exact Effect and frozen Cue target"
);
assert.doesNotMatch(
  effectMain,
  /kCodeControlLaunchFeedback|IsCodeControlOpening|SetCodeControlOpening|Opening\.\.\./,
  "the native Edit Code button must not retain a synthetic CEP launch state"
);
assert.doesNotMatch(
  effectMain,
  /ResolveCodeEditSessionToken|kDuplicateClickWindow|reusedRecentSession/,
  "the retired 150ms session deduplicator must not return"
);
const openCodeEditorBody =
  effectMain.match(/PF_Err OpenCodeEditorWindow\([\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  openCodeEditorBody,
  /PARAM_DEFAULT_CODE[\s\S]*ResolveFullCodeCueTimeline[\s\S]*targetTime\.value = input->current_time[\s\S]*snapshots\/base\.js[\s\S]*snapshots\/cue-/,
  "Edit Code must freeze Base, exact native A_Time, and the complete Cue timeline"
);
assert.match(
  openCodeEditorBody,
  /kCodeEditorOpenIntentFileName[\s\S]*open-v1[\s\S]*QueueCodeEditorPanelWake\(sessionToken\)[\s\S]*DispatchCodeEditorCepEvent/,
  "Edit Code must persist its open intent before attempting CEP delivery"
);
assert.match(
  effectMain,
  /BuildCodeEditorPanelWakeScript[\s\S]*findMenuCommandId\('momentum\.js'\)[\s\S]*executeCommand\(panelCommandId\)[\s\S]*ProcessCodeEditorPanelWake[\s\S]*CodeEditorPanelClaimed/,
  "the native fallback must reveal the main Momentum panel only after the fast path remains unclaimed"
);
assert.doesNotMatch(
  effectMain.match(
    /std::string BuildCodeEditorCepEventScript\([\s\S]*?return script\.str\(\);\n\}/,
  )?.[0] ?? "",
  /findMenuCommandId|executeCommand/,
  "the already-open CEP fast path must never toggle the panel menu"
);
assert.match(
  codeSnapshot,
  /function momentumPeekCodeEditorOpenIntent[\s\S]*function momentumClaimCodeEditorPanel[\s\S]*code-editor-open\.claimed[\s\S]*function momentumAcknowledgeCodeEditorOpenIntent[\s\S]*pendingSessionToken !== sessionToken[\s\S]*intentFile\.remove/,
  "the CEP startup mailbox must acknowledge only the session it successfully opened"
);
assert.match(
  pluginBridge,
  /effectCodeManager\.open\(sessionToken\)[\s\S]*momentumAcknowledgeCodeEditorOpenIntent[\s\S]*drainPendingCodeEditorOpen\(\)\.finally\(revealInitialPanel\)/,
  "the shared panel must drain the durable Edit Code request after ExtendScript starts"
);
assert.match(
  mainHtml + panelStyles,
  /<body class="panel-launch-pending">[\s\S]*body\.panel-launch-pending #container[\s\S]*visibility: hidden/,
  "cold panel startup must hide the ordinary workspace until its open intent is resolved",
);
assert.doesNotMatch(
  effectCode,
  /momentum:effect-code-open|handleOpenEvent/,
  "Effect Code opening must have one bridge-owned delivery path"
);
assert.match(
  pluginBridge,
  /codeEditorOpenQueue[\s\S]*queueEffectCodeSession/,
  "the CEP bridge must serialize Effect Code session delivery",
);
assert.doesNotMatch(
  effectCode,
  /\bactivating\b|\bqueuedSessionToken\b/,
  "the Effect Code manager must not duplicate the bridge-owned session queue",
);

const coldOpenToken = "A".repeat(32);
const cepEventListeners = new Map();
let coldOpenIntent = coldOpenToken;
let coldOpenCalls = 0;
let coldOpenClaims = 0;
let coldOpenAcknowledgements = 0;
const coldOpenTokens = [];
const coldOpenResolvers = [];
const launchClasses = new Set(["panel-launch-pending"]);
class MockCSInterface {
  registerKeyEventsInterest() {}
  getSystemPath() { return "/mock/extension"; }
  addEventListener(name, listener) {
    cepEventListeners.set(name, listener);
  }
  evalScript(script, callback) {
    if (script.indexOf("__momentumBootstrapResult") >= 0) {
      callback("ok");
      return;
    }
    if (script.indexOf("momentumPeekCodeEditorOpenIntent") === 0) {
      callback(coldOpenIntent);
      return;
    }
    if (script.indexOf("momentumClaimCodeEditorPanel") === 0) {
      coldOpenClaims += 1;
      callback("ok");
      return;
    }
    if (script.indexOf("momentumAcknowledgeCodeEditorOpenIntent") === 0) {
      coldOpenIntent = "";
      coldOpenAcknowledgements += 1;
      callback("ok");
      return;
    }
    callback("");
  }
}
const bridgeSandbox = {
  CSInterface: MockCSInterface,
  SystemPath: { EXTENSION: "extension" },
  Promise,
  console,
  encodeURIComponent,
  setTimeout,
  document: {
    readyState: "loading",
    body: {
      classList: {
        remove(name) { launchClasses.delete(name); },
      },
    },
    addEventListener() {},
    getElementById() { return null; },
  },
  effectCodeManager: {
    open(sessionToken) {
      coldOpenCalls += 1;
      coldOpenTokens.push(sessionToken);
      return new Promise((resolve) => {
        coldOpenResolvers.push(resolve);
      });
    },
  },
};
bridgeSandbox.window = bridgeSandbox;
vm.runInNewContext(pluginBridge, bridgeSandbox, {
  filename: "js/plugin/bridge.js",
});
bridgeSandbox.momentumPluginBridge.init();
cepEventListeners.get("com.example.momentum.codeEditor.open")({
  data: coldOpenToken,
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(coldOpenCalls, 1);
assert.equal(
  launchClasses.has("panel-launch-pending"),
  true,
  "the ordinary workspace must stay hidden while Effect Code is still opening",
);
coldOpenResolvers.shift()(true);
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  coldOpenCalls,
  1,
  "startup mailbox delivery and the fast-path CEP event must deduplicate one session",
);
assert.equal(
  coldOpenClaims,
  1,
  "an already-open CEP panel must claim the fast path before native fallback can toggle it",
);
assert.equal(
  coldOpenAcknowledgements,
  1,
  "a cold-start request must be acknowledged only after Effect Code opens",
);
assert.equal(coldOpenIntent, "");
assert.equal(
  launchClasses.has("panel-launch-pending"),
  false,
  "the panel must reveal only after the target Edit Code mode is ready",
);

const secondOpenToken = "B".repeat(32);
const thirdOpenToken = "C".repeat(32);
const openEventListener = cepEventListeners.get(
  "com.example.momentum.codeEditor.open",
);
openEventListener({ data: secondOpenToken });
openEventListener({ data: thirdOpenToken });
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  coldOpenTokens,
  [coldOpenToken, secondOpenToken],
  "a later Effect Code session must wait for the current delivery",
);
coldOpenResolvers.shift()(true);
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  coldOpenTokens,
  [coldOpenToken, secondOpenToken, thirdOpenToken],
  "the bridge must deliver the next distinct Effect Code session in order",
);
coldOpenResolvers.shift()(true);
await new Promise((resolve) => setTimeout(resolve, 0));

const normalLaunchClasses = new Set(["panel-launch-pending"]);
const normalBridgeSandbox = {
  CSInterface: MockCSInterface,
  SystemPath: { EXTENSION: "extension" },
  Promise,
  console,
  encodeURIComponent,
  setTimeout,
  document: {
    readyState: "loading",
    body: {
      classList: {
        remove(name) { normalLaunchClasses.delete(name); },
      },
    },
    addEventListener() {},
    getElementById() { return null; },
  },
  effectCodeManager: {
    open() {
      throw new Error("normal launch must not open Effect Code");
    },
  },
};
normalBridgeSandbox.window = normalBridgeSandbox;
vm.runInNewContext(pluginBridge, normalBridgeSandbox, {
  filename: "js/plugin/bridge.js",
});
normalBridgeSandbox.momentumPluginBridge.init();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  normalLaunchClasses.has("panel-launch-pending"),
  false,
  "a normal panel launch must reveal immediately after finding no Edit Code intent",
);
assert.match(
  codeSnapshot,
  /session = _momentumResolveLiveCodeEditSession\(session, target\)[\s\S]*_momentumReadCodeEditSources\(session\)[\s\S]*targetTimeValue: session\.target\.timeValue[\s\S]*targetTimeScale: session\.target\.timeScale/,
  "JSX must preload sources for the exact live AE target"
);
assert.doesNotMatch(
  codeSnapshot + effectCode + editorManager,
  /_momentumResolveCodeEditPredecessorEntry|predecessorSource|analyzeBasicSoftCodeTransition/,
  "Cue metadata must not depend on the predecessor present at authoring time"
);
const codeSnapshotSandbox = {};
vm.runInNewContext(codeSnapshot, codeSnapshotSandbox, {
  filename: "jsx/plugin/codeSnapshot.jsx",
});
codeSnapshotSandbox.File = function File(path) {
  this.fsName = String(path || "");
};
codeSnapshotSandbox._momentumReadCodeEditorText = function () {
  return "timeline-v1\n2/1\tfirst-hash\n4/1\tsecond-hash\n";
};
const liveSession = {
  sessionFolder: { fsName: "/tmp/session" },
  baseEntry: {
    sourceHash: "base-hash",
    controllerHash: "none",
    sourcePath: "snapshots/base.js",
    bundlePath: "snapshots/base.json",
  },
  target: { timeValue: 0, timeScale: 1000 },
  cues: [
    {
      timeValue: 1,
      timeScale: 1,
      sourceHash: "first-hash",
      controllerHash: "none",
      sourcePath: "snapshots/cue-0.js",
      bundlePath: "snapshots/cue-0.json",
    },
    {
      timeValue: 3,
      timeScale: 1,
      sourceHash: "second-hash",
      controllerHash: "none",
      sourcePath: "snapshots/cue-1.js",
      bundlePath: "snapshots/cue-1.json",
    },
  ],
};
const movedTimelineSession =
  codeSnapshotSandbox._momentumResolveLiveCodeEditSession(
    liveSession,
    { comp: { time: 3 } },
  );
assert.equal(movedTimelineSession.target.sourceHash, "first-hash");
assert.equal(movedTimelineSession.target.mode, "new-cue");
assert.equal(movedTimelineSession.target.timeValue, 3000);
assert.equal(movedTimelineSession.cues[0].timeValue, 2);
assert.equal(movedTimelineSession.cues[1].timeValue, 4);
assert.equal(
  movedTimelineSession.timelineFingerprint,
  "timeline-v1\n2/1\tfirst-hash\n4/1\tsecond-hash\n",
  "read-only session resolution must apply the exact moved-key fingerprint",
);
assert.doesNotMatch(codeSnapshot, /codeProp\.addKey|nearestKeyIndex/);
assert.doesNotMatch(
  effectMain + pluginBridge + effectCode,
  /AEGP_GetLayerCurrentTime|ReadCodeEditorPlayheadEvents|DispatchCodeEditorCepEventFromIdle|com\.example\.momentum\.codeEditor\.playhead|CODE_EDITOR_PLAYHEAD_EVENT|momentum:effect-code-playhead|native-code-playhead/,
  "the retired native Idle playhead publisher must be removed end to end",
);
assert.match(
  codeSnapshot + effectCode,
  /_momentumReadCodeEditSources[\s\S]*sources:\s*sources[\s\S]*createSessionModelRegistry[\s\S]*nextContext\.sources/,
  "opening Edit Code must preload every frozen Cue source exactly once",
);
assert.match(
  effectMain + codeSnapshot,
  /code-edit-sessions/,
  "editor launch and per-submit commit transport must have separate ownership"
);
assert.match(effectMain + codeSnapshot, /code-edit-commit\.pending/);
assert.doesNotMatch(effectMain + codeSnapshot, /code-edit-rebase\.pending/);
assert.match(effectMain + codeSnapshot, /code-edit-results/);
assert.doesNotMatch(
  effectMain + codeSnapshot,
  /code_editor_launch/,
  "the removed Modeless editor launch-file fallback must not return",
);
assert.doesNotMatch(codeSnapshot, /Math\.random\(\)[\s\S]*commit/);
assert.match(
  runtimeFiles,
  /targetFile\.lineFeed = "Unix"/,
  "ExtendScript transports must write a stable LF wire format"
);
assert.match(
  effectMain,
  /NormalizeCodeEditTransportText[\s\S]*text\[index\] == '\\r'/,
  "native Code commit parsing must accept CR, LF, and CRLF transports"
);
assert.match(
  codeBundle,
  /function normalizeSource[\s\S]*replace\(\/\\r\\n\?\/g, "\\n"\)[\s\S]*replace\(\/\\n\+\$\/g, ""\)/,
  "Base and Cue sources must share one canonical frontend representation"
);
assert.match(
  effectCode,
  /CodeBundle\.normalizeSource\(editor\.getValue\(\)\)/,
  "the Code editor must compile and commit canonical source"
);
assert.match(
  effectMain,
  /NormalizeCodeSourceText\(\*sourceText\)[\s\S]*snapshot\.sourceText = canonicalSource/,
  "native creation and commit boundaries must persist canonical source"
);
assert.match(
  codeSnapshotNative + effectMain,
  /bundle\.sourceText = NormalizeCodeSourceText\(snapshot\.sourceText\)[\s\S]*effectiveIdentity[\s\S]*CodeSourcesAreEquivalent[\s\S]*active-identity-cue/,
  "a source-equivalent Cue must remain a render no-op, including legacy Base text"
);
assert.match(
  effectCode,
  /if \(context && context\.sessionToken === sessionToken\) \{[\s\S]*return Promise\.resolve\(true\)/,
  "an already delivered editor session must not load twice"
);
assert.doesNotMatch(
  effectCode + pluginBridge,
  /requestOpenExtension|MAIN_EXTENSION_ID|PANEL_FOCUS|panelFocusGeneration|ensureMainPanelFocus|CODE_EDITOR_EXTENSION_ID|com\.example\.momentum\.js\.codeEditor/,
  "Effect Code must not manipulate the CEP window or restore a secondary extension"
);
assert.match(
  mainHtml + panelStyles + effectCode,
  /id="editor-container" tabindex="-1"[\s\S]*#editor-container:focus[\s\S]*function focusEffectCodeSurface\(\)[\s\S]*editorContainer\.focus\(\)/,
  "Effect Code must activate a neutral DOM focus surface instead of Monaco"
);
assert.match(
  effectCode,
  /function releaseEditorTextFocus\(\)[\s\S]*editorElement\.contains\(activeElement\)[\s\S]*activeElement\.blur\(\)[\s\S]*function handleWindowBlur\(\)[\s\S]*releaseEditorTextFocus\(\)[\s\S]*addEventListener\("blur", handleWindowBlur/,
  "Effect Code must clear Monaco's text focus when entering or leaving the CEP panel"
);
const codeCursorBody =
  effectMain.match(/PF_Err AdjustCodeControlCursor\([\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  codeCursorBody,
  /HitTestCodeControl[\s\S]*PF_Cursor_FINGER_POINTER/,
  "the Edit Code cursor must only change inside the drawn button"
);
assert.match(
  codeCursorBody,
  /PF_EO_HANDLED_EVENT/,
  "cursor adjustment must keep AE from immediately restoring its default cursor"
);
assert.match(
  effectCode,
  /waitForCommitResult[\s\S]*momentumGetCodeEditCommitResult[\s\S]*result\.succeeded/,
  "the editor must asynchronously await the idle-hook transaction result"
);
const commitCodeCueStart = effectMain.lastIndexOf(
  "PF_Err HandleCodeEditorSignal("
);
const commitCodeCueEnd = effectMain.indexOf(
  "\nvoid ProcessNativeCodeCueReconcile(",
  commitCodeCueStart
);
const commitCodeCueBody = effectMain.slice(
  commitCodeCueStart,
  commitCodeCueEnd
);
assert.doesNotMatch(
  commitCodeCueBody,
  /AEGP_InsertKeyframe|AEGP_SetKeyframeValue|AEGP_StartAddKeyframes/,
  "the supervised transport callback must queue rather than mutate keyframes"
);
assert.match(
  commitCodeCueBody,
  /PendingCodeEditCommit pendingCommit[\s\S]*QueueCodeEditCommit\(std::move\(pendingCommit\)\)/,
  "the supervised callback must hand an immutable job to the idle hook"
);
const idleCommitStart = effectMain.lastIndexOf(
  "A_Err CodeEditIdleHook("
);
const idleCommitEnd = effectMain.indexOf(
  "\n\n}  // namespace",
  idleCommitStart
);
const idleCommitBody = effectMain.slice(
  idleCommitStart,
  idleCommitEnd
);
assert.match(
  idleCommitBody,
  /AEGP_LTimeMode_LayerTime[\s\S]*AEGP_SetKeyframeValue[\s\S]*AEGP_StartAddKeyframes[\s\S]*AEGP_EndAddKeyframes/,
  "the idle hook must update or add the exact native-time key atomically"
);
assert.match(
  idleCommitBody,
  /job\.frozenCues[\s\S]*CodeCueTimesEqual[\s\S]*sourceHash/,
  "the idle transaction must revalidate the exact frozen timeline"
);
assert.match(
  idleCommitBody,
  /expectedTimeline = job\.frozenCues[\s\S]*SetKnownCodeCueTimeline\(\s*job\.liveEffectSessionId,\s*expectedTimeline\s*\)[\s\S]*AEGP_SetKeyframeValue/,
  "editor commits must publish their expected Cue timeline before AEGP writes can re-enter the effect"
);
const userChangedParamBody = effectMain.match(
  /PF_Err HandleUserChangedParam\([\s\S]*?\n\}\n\nPF_Err UpdateParamsUI\(/
)?.[0] ?? "";
assert.match(
  effectMain,
  /ObserveCodeCueTimeline[\s\S]*FindSingleInsertedCodeCue[\s\S]*insertedIndex != 0[\s\S]*QueueCodeCueReconcile\(std::move\(pending\)\)/,
  "the UI-side observer must queue only a newly inserted earliest native Code key"
);
assert.match(
  effectMain,
  /SerializeCodeEditTimelineFingerprint[\s\S]*timeline-v1[\s\S]*CodeCueTimeIdentity[\s\S]*timeline\.changed/,
  "Code timeline markers must carry the changing native timeline fingerprint"
);
assert.match(
  codeSnapshot,
  /_momentumResolveLiveCodeEditSession[\s\S]*_momentumReadLiveCodeEditTimeline[\s\S]*target\.comp\.time[\s\S]*session\.timelineFingerprint/,
  "Effect Code must resolve moved native Code keys from read-only session files"
);
assert.doesNotMatch(
  codeSnapshot + effectCodeClock + effectCode,
  /momentumGetCodeEditorPlayhead|momentumReadCodeEditorClock|function pollPlayhead|PLAYHEAD_POLL_INTERVAL_MS|momentumSampleActiveCompTime|sampleTimeProbe|time-probe/,
  "legacy playhead polling and the temporary measurement probe must not return"
);
assert.match(
  effectMain,
  /AEGP_GetItemViewPlaybackTime[\s\S]*previewing[\s\S]*viewTime/,
  "the shared native publisher must read AE's explicit item-view time",
);
assert.match(
  effectMain + codeSnapshot + effectCodeClock,
  /code-editor-view-clock\.txt[\s\S]*viewClockPath[\s\S]*window\.cep\.fs\.readFile[\s\S]*parseViewClock/,
  "Effect Code must consume the unified native item-view clock directly",
);
assert.match(
  effectMain + effectCodeClock,
  /AEGP_GetItemViewPlaybackTime[\s\S]*nativePreviewing = sample\.previewing;\s*applyTimeSample\(sample\);/,
  "one AE item-view clock must own preview and manual timeline sampling",
);
assert.match(
  timelineClock,
  /clockState\.inFlight = Promise\.resolve\(\)[\s\S]*clockOptions\.readSample\(\)[\s\S]*clockOptions\.onSample\(sample\)/,
  "the shared clock reader must serialize and immediately apply every native sample",
);
assert.doesNotMatch(
  timelineClock + effectCodeClock,
  /stall|predict|latestSample|requestCodeClockFrame|renderLatestCodeClock/,
  "the retired request-stall inference and frame coalescing must not return",
);
assert.match(
  codeSnapshot + effectCodeClock,
  /function momentumReadCodeEditorTimeline[\s\S]*_momentumReadCodeEditorTimelineUpdate[\s\S]*momentumReadCodeEditorTimeline[\s\S]*TIMELINE_INTERVAL_MS/,
  "Code Cue marker reconciliation must run independently from playback sampling",
);
assert.match(
  codeSnapshot + effectCodeClock,
  /timeline\.changed[\s\S]*_momentumReadCodeEditorTimelineUpdate[\s\S]*parseTimeline[\s\S]*context\.cues = nextCues/,
  "moved Cue boundaries must flow into the frontend clock without reloading Monaco",
);
const codeClockApplyBody = effectCodeClock.match(
  /function applyTimeSample\([\s\S]*?\n    function readViewSample/,
)?.[0] ?? "";
assert.doesNotMatch(
  codeClockApplyBody,
  /callHost|loadContext|requestSessionRefresh|dispatchEvent/,
  "clock samples must resolve and switch preloaded models without secondary host work",
);
assert.match(
  codeClockApplyBody,
  /resolveTarget[\s\S]*switchToSourceModel/,
  "the frontend clock must map time to a preloaded source model locally",
);
assert.match(
  codeSnapshot,
  /session = _momentumResolveLiveCodeEditSession\(session, target\)[\s\S]*originalSourceHash = editTarget === "base"[\s\S]*session\.baseEntry[\s\S]*session\.target\.sourceHash[\s\S]*commit\.request/,
  "submit must resolve both commit destinations from authoritative AE state"
);
assert.match(
  effectCode,
  /isPaused:[\s\S]*isDraftDirty\(\)[\s\S]*function submit\(editTarget\)[\s\S]*editTarget !== "cue" && editTarget !== "base"/,
  "a dirty draft must pause timeline following until either explicit destination is submitted",
);
assert.doesNotMatch(
  effectCode + codeSnapshot,
  /payload\.sourceHash|sourceHash:\s*editTarget/,
  "CEP must not freeze a stale source target when the AE playhead can keep moving",
);
const baseCommitBody = effectMain.match(
  /void ProcessBaseCodeCommit\([\s\S]*?\n\}\n\nvoid ProcessCodeEditorPanelWake/
)?.[0] ?? "";
assert.match(
  baseCommitBody,
  /PARAM_DEFAULT_CODE[\s\S]*AEGP_GetNewStreamValue[\s\S]*originalSourceHash[\s\S]*Modify Momentum Base Code[\s\S]*AEGP_SetStreamValue/,
  "Base commits must revalidate and atomically replace only Default Code",
);
assert.doesNotMatch(
  baseCommitBody,
  /AEGP_SetKeyframeValue|AEGP_StartAddKeyframes|PARAM_CODE_SNAPSHOT/,
  "Base commits must never alter the Code keyframe stream",
);
assert.match(
  effectMain,
  /liveCueTimeline =\s*ResolveFullCodeCueTimeline[\s\S]*liveTargetTime[\s\S]*liveOriginalSourceHash[\s\S]*pendingCommit\.frozenCues =\s*FingerprintCodeCueTimeline/,
  "commits must revalidate the live native timeline instead of trusting a stale editor session"
);
assert.match(
  codeTimelineState,
  /ObserveKnownCodeCueTimelineFromRender[\s\S]*timeline\.size\(\) <= existing->second\.size\(\)[\s\S]*Preserve the older[\s\S]*native AE key insertion/,
  "renders may publish deletes and moves but must preserve insertion evidence for the UI-thread observer"
);
assert.match(
  effectMain,
  /ObserveCodeCueTimeline[\s\S]*user-changed-param[\s\S]*ObserveCodeCueTimeline[\s\S]*update-params-ui/,
  "both supervised changes and ECW refreshes must observe native Code timeline edits"
);
assert.match(
  effectMain.match(
    /void ProcessNativeCodeCueReconcile\([\s\S]*?\n\}\n\nA_Err CodeEditIdleHook\(/
  )?.[0] ?? "",
  /ProcessNativeCodeCueReconcile[\s\S]*AEGP_GetKeyframeTime[\s\S]*CodeCueTimesEqual[\s\S]*inheritedSourceHash[\s\S]*AEGP_SetKeyframeValue/,
  "the AEGP idle hook must validate and persist Base into the exact inserted key"
);
assert.doesNotMatch(
  effectMain.match(/RuntimeSketchBundle SelectEffectRuntimeSketchBundle\([\s\S]*?\n\}/)?.[0] ?? "",
  /AEGP_SetKeyframeValue|PF_ChangeFlag_CHANGED_VALUE/,
  "Base reconciliation belongs to key creation, never to render selection"
);
assert.doesNotMatch(
  effectMain,
  /OverwriteCodeSnapshotHandle/,
  "the retired USER_CHANGED_PARAM arbitrary-handle patch must not return"
);
assert.match(
  effectCode,
  /editTarget === "cue"[\s\S]*source === originalSource[\s\S]*context\.targetMode === "existing-cue"[\s\S]*submit-new-cue-unchanged/,
  "OK at an empty time must create an explicit Cue even when its source is unchanged"
);
assert.match(
  effectMain,
  /code-edit-idle-job-queued[\s\S]*code-edit-idle-commit-complete/,
  "native diagnostics must cover queue and idle completion"
);
const codeCommitParamBlock = effectMain.match(
  /AEFX_CLR_STRUCT\(def\);\s*def\.flags =\s*PF_ParamFlag_SUPERVISE \| PF_ParamFlag_CANNOT_TIME_VARY;[\s\S]*?PF_ADD_SLIDER\(\s*"Code Edit Signal"[\s\S]*?\);/
);
assert.ok(codeCommitParamBlock, "Code Edit Signal parameter declaration must exist");
assert.match(
  codeCommitParamBlock[0],
  /def\.ui_flags = PF_PUI_INVISIBLE;/,
  "Code Edit Signal must remain hidden in Effect Controls"
);
assert.doesNotMatch(
  codeCommitParamBlock[0],
  /def\.ui_flags\s*=\s*[^;]*PF_PUI_NO_ECW_UI/,
  "Code Edit Signal must not suppress its Effect Controls callback"
);
assert.match(
  codeCommitParamBlock[0],
  /"Code Edit Signal",\s*0,\s*1,\s*0,\s*1/,
  "the hidden transport must be a one-bit wake signal, not a request id"
);
assert.match(
  effectCode,
  /context = nextContext;[\s\S]*updateHeader\(\);[\s\S]*setBusy\(false\)/,
  "a newly delivered edit session must recover the shared Panel editor"
);
assert.match(
  effectMain,
  /WriteCodeEditCommitResult\([\s\S]*code-edit-idle-commit-complete/,
  "the idle transaction must publish an explicit success or failure result"
);
assert.doesNotMatch(effectMain, /SyncCodeNoCueValueToBase/);
assert.match(
  effectMain.match(/CodeKeyframeTimeline ResolveCodeKeyframeTimeline\([\s\S]*?return result;\n\}/)?.[0] ?? "",
  /keyframeCount == PF_KeyIndex_NONE \|\| keyframeCount <= 0/,
  "zero AE Code keys must be represented as an empty Cue track"
);
assert.doesNotMatch(
  effectMain + codeSnapshot + effectCode + pluginBridge,
  /nextEditTransaction|transactionId|edit-transactions|code_editor_request|editTransaction/,
  "the retired sequential, global-active editor transaction protocol must not return"
);
assert.match(
  effectMain,
  /#include "host\/code\/snapshot\.h"[\s\S]*#include "host\/code\/timeline\.h"/,
  "the Effect command module must consume the dedicated Code modules"
);
assert.doesNotMatch(
  effectMain,
  /struct CodeSnapshotHeader|gKnownCodeCueTimelines|bool ReadCodeSnapshotHandleWithSuite\(/,
  "snapshot serialization and timeline identity state must not leak back into Effect commands"
);
assert.match(
  codeSnapshotNative,
  /struct CodeSnapshotHeader[\s\S]*HandleCodeSnapshotArbitraryCallbacks/,
  "the Code snapshot module must own its wire format and arbitrary callbacks"
);
assert.match(
  runtimeMaintenance,
  /"instances"[\s\S]*"edit-transactions"[\s\S]*"instance_trace\.log"[\s\S]*PruneDirectory[\s\S]*"code-edit-sessions"[\s\S]*"creation-transports"[\s\S]*PruneArchivedRuntimeLogs/,
  "runtime maintenance must remove retired transports and bound active transport folders"
);
const jsonObjectExtractorBody =
  environment.match(/std::optional<std::string> ExtractJsonObjectField\([\s\S]*?return json\.substr\([\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  jsonObjectExtractorBody,
  /bool inString = false;[\s\S]*bool escaping = false;[\s\S]*if \(inString\)/,
  "runtime JSON object extraction must ignore braces inside escaped source strings"
);
assert.match(
  runtimeMaintenance,
  /RotateLogFileIfNeeded[\s\S]*effect_runtime\.log[\s\S]*code_editor\.log/,
  "native runtime logs must have bounded rotation"
);
const defaultRenderDiagnosticBody =
  environment.match(/bool ShouldWriteRenderDiagnostic\([\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(
  defaultRenderDiagnosticBody,
  /event == "code-parameter-state"|event == "render-timing"|event == "controller-history-replay"/,
  "release diagnostics must not write per-frame render traces by default"
);
assert.match(
  environment,
  /MOMENTUM_VERBOSE_RENDER_LOG[\s\S]*IsVerboseRenderDiagnosticEnabled/,
  "full render diagnostics must remain available as an explicit opt-in"
);
assert.match(
  codeSnapshot,
  /file\.length[\s\S]*512 \* 1024[\s\S]*file\.open\("w"\)/,
  "the CEP Code editor log must also remain bounded"
);
assert.doesNotMatch(
  momentumTypes + runtimeCore + bitmapPlan + bitmapMetalRenderer + bitmapCpuRenderer + renderCore,
  /clearsSurface|resetsHistory|targetCleared|clearDestination|stateful-append/,
  "the retired inferred canvas-clear state must not return"
);
assert.match(
  bitmapPlan,
  /enum BitmapSurfaceStart[\s\S]*BITMAP_SURFACE_INHERIT[\s\S]*BITMAP_SURFACE_CLEAR[\s\S]*surfaceStart[\s\S]*surfaceColor/,
  "every Bitmap draw plan must carry one explicit surface-start contract"
);
assert.match(
  bitmapPlan,
  /command\.type == "clear"[\s\S]*startIndependentSurface\(PF_Pixel\{0, 0, 0, 0\}\)/,
  "clear() must become an explicit transparent independent surface"
);
assert.match(
  bitmapPlan,
  /command\.fill\.alpha >= 255[\s\S]*currentClipMask\.empty\(\)[\s\S]*!currentAnalyticClip\.enabled[\s\S]*startIndependentSurface\(command\.fill\)/,
  "only a proven unclipped opaque background may sever pixel history"
);
const renderDrawPlanBody =
  bitmapMetalRenderer.match(/PF_Err RenderDrawPlanToTexture\([\s\S]*?PF_Err CommitAndWait\(/)?.[0] ?? "";
assert.match(
  renderDrawPlanBody,
  /surfaceStart == BITMAP_SURFACE_CLEAR[\s\S]*encodeClearTarget\([\s\S]*for \(std::size_t batchIndex/,
  "Metal must initialize the destination before any drawable batch can be culled"
);
assert.match(
  renderDrawPlanBody,
  /encodeClearTarget\(\s*scratchTexture[\s\S]*encodeBatchDraw\(scratchTexture, batch\)[\s\S]*encodeCompositeScratchIntoTarget/,
  "composited batches must never reuse stale scratch pixels"
);
assert.match(
  bitmapCpuRenderer,
  /plan\.fallbackSurfaceStart == BITMAP_SURFACE_CLEAR[\s\S]*plan\.fallbackSurfaceColor[\s\S]*operation\.drawPlan\.surfaceStart == BITMAP_SURFACE_CLEAR[\s\S]*RenderSceneToRaster8/,
  "CPU and Metal must consume the same explicit surface-start contract"
);
const backgroundImageBody =
  apiImage.match(/JSValueRef JsMomentumNativeBackgroundImage\([\s\S]*?JSValueRef JsMomentumNativeCreateImage\(/)?.[0] ?? "";
assert.doesNotMatch(
  backgroundImageBody,
  /ClearSceneCommands|currentTransform/,
  "background(image, alpha) must remain an ordered canvas composite"
);
assert.match(
  apiStyle,
  /JSValueRef JsClear\([\s\S]*command\.type = "clear"[\s\S]*AppendSceneCommand/,
  "clear() must be represented by an ordered surface command"
);

console.log("Momentum runtime isolation invariants: OK");

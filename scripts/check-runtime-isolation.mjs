import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const environment = read("src/plugin/runtime/runtime_environment.cpp");
const runtimeCore = read("src/plugin/runtime/runtime_core.cpp");
const effectMain = read("src/plugin/entry/effect_main.cpp");
const momentumTypes = read("src/plugin/model/momentum_types.h");
const effectContract = read("src/plugin/momentum_effect_contract.h");
const pipl = read("src/plugin/MomentumPiPL.r");
const runtimeFiles = read("jsx/plugin/runtimeFiles.jsx");
const bitmapApply = read("jsx/plugin/bitmapApply.jsx");
const bitmapGpuBackendMetal = read("src/plugin/gpu/bitmap_gpu_backend_metal.mm");
const bitmapGpuBackend = read("src/plugin/gpu/bitmap_gpu_backend.cpp");
const frameCache = read("src/plugin/cache/frame_cache.cpp");
const editorManager = read("js/ui/editor/core/manager.js");

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
  /ReadSequenceUiSessionToken[\s\S]*uiSessionToken/,
  "UI sequence state may retain a process-local session token"
);
assert.match(
  momentumTypes,
  /std::uint64_t uiSessionToken = 0;/,
  "live sequence data must carry a process-local session token"
);
assert.doesNotMatch(
  environment,
  /gEffectRefRuntimeAliases|reinterpret_cast<EffectRuntimeKey>\(in_data->effect_ref\)/,
  "effect_ref must not be registered in a separate alias table"
);
const renderLineageIdentityBody =
  effectMain.match(/std::uint64_t ResolveRenderLineageIdentity\([\s\S]*?\n\}/)?.[0] ?? "";
assert.match(
  renderLineageIdentityBody,
  /ResolveEffectRuntimeKey[\s\S]*instanceId/,
  "persistent render lanes must combine stable Sequence session identity and transport id"
);
assert.doesNotMatch(
  renderLineageIdentityBody,
  /effect_ref/,
  "transient AE render callback references must never own persistent lanes"
);
assert.match(
  effectMain,
  /flattenedData->uiSessionToken\s*=\s*0/,
  "flattening must remove live identity so replicas cannot share mutable state"
);
assert.match(
  effectMain,
  /PF_ADD_POINT\([\s\S]*ControllerPointParamIndex\(slot\)/,
  "point controllers must remain native AE point parameter streams"
);
assert.match(
  effectMain,
  /ci\.events\s*=\s*PF_CustomEFlag_EFFECT\s*;/,
  "custom UI registration must be limited to Effect Controls"
);
assert.doesNotMatch(
  effectMain,
  /PF_CustomEFlag_(?:COMP|LAYER)|HandleCustomCompUIEvent|PointHandleDrawInfo|point-overlay-drag/,
  "Composition and Layer point interaction must be owned by AE's native point UI"
);
assert.doesNotMatch(
  runtimeCore,
  /activePointSlot|GetEffectSessionActivePointSlot|SetEffectSessionActivePointSlot/,
  "native point UI must not retain a parallel process-local selection state"
);
assert.match(
  effectMain,
  /SequenceResetup[\s\S]*ui-session-created/,
  "Sequence Resetup must restore the effect document and UI session"
);
assert.match(
  effectMain.match(/constexpr PF_OutFlags kMomentumBaseOutFlags[\s\S]*?;/)?.[0] ?? "",
  /PF_OutFlag_NON_PARAM_VARY/,
  "time-driven Bitmap sketches must declare non-parameter variation"
);
assert.match(
  effectMain,
  /out_data->out_flags \|= PF_OutFlag_NON_PARAM_VARY/,
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
  /ReadRuntimeSketchDependencyBytes[\s\S]*GuidMixInPtr/,
  "PreRender must mix the Effect-local bitmap Document into the frame-cache GUID"
);
assert.match(
  effectMain,
  /SequenceSetup[\s\S]*EnsureSequenceDataHandleInitialized\([\s\S]*SequenceUiSessionMode::kCreateFresh[\s\S]*SequenceResetup[\s\S]*EnsureSequenceDataHandleInitialized\([\s\S]*SequenceUiSessionMode::kCreateFresh/,
  "Sequence Setup and Resetup must rebind copied effects to independent UI sessions"
);
assert.match(
  effectMain,
  /WriteSequenceRuntimeSnapshot[\s\S]*EnsureSequenceDataHandleInitialized\([\s\S]*SequenceUiSessionMode::kReuseExisting/,
  "ordinary document snapshot updates must preserve the effect's UI session"
);
assert.match(
  effectMain,
  /uiSessionMode == SequenceUiSessionMode::kReuseExisting[\s\S]*DiscardEffectRuntimeState\(previousRuntimeKey/,
  "copy rebinding must never discard the source effect's possibly shared UI session"
);
assert.match(
  effectMain,
  /SequenceFlatten[\s\S]*CopyFlattenedDocumentSnapshot\(in_data, out_data\)[\s\S]*GetFlattenedSequenceData[\s\S]*CopyFlattenedDocumentSnapshot\(in_data, out_data\)/,
  "all flattened snapshots must strip process-local UI identity"
);
assert.match(
  effectMain,
  /struct RenderInvocationInfo \{[\s\S]*std::uintptr_t runtimeKey/,
  "PreRender data must carry an invocation-owned runtime across the Smart Render boundary"
);
assert.match(
  effectMain,
  /info->runtimeKey = NextRenderInvocationRuntimeKey\(\)[\s\S]*PrepareEffectRuntimeDocument\([\s\S]*info->runtimeKey/,
  "PreRender must create an isolated evaluator and prepare its immutable Document"
);
assert.doesNotMatch(
  effectMain.match(/PF_Err BuildRenderInvocationInfo\([\s\S]*?PF_Err CopyCpuRasterToOutput\(/)?.[0] ?? "",
  /ResolveEffectRuntimeKey/,
  "render invocation identity must never come from Sequence/UI state"
);
assert.match(
  effectMain,
  /BuildBitmapFramePlanAtCurrentTime\(\s*in_data,\s*info->runtimeKey/,
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
  /QueryBitmapGpuRecoveryCanvasCursor[\s\S]*stateful-recovery-preferred-with-checkpoint/,
  "backward playback must compare the recovery cursor with the reliable checkpoint path"
);
assert.match(
  runtimeCore,
  /collectScenes\(checkpointFrame \+ 1, targetFrame, &scenes\)[\s\S]*planHasPreferredRecoveryCursor = true/,
  "a preferred recovery cursor must retain checkpoint-to-target operations as its fallback"
);
assert.match(
  bitmapGpuBackendMetal,
  /canvasState\.lastFrame == plan\.preferredRecoveryFrame[\s\S]*!canUsePreferredRecoveryCursor[\s\S]*plan\.hasSeedGpuCheckpoint/,
  "Metal must revalidate the recovery cursor and fall back to the checkpoint when AE renders out of order"
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
  effectMain.match(/PF_Err UpdateParamsUI\([\s\S]*?return SyncControllerParamUI\(in_data, out_data, params\);\n\}/)?.[0] ?? "";
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
  /ResolveDownsampleScale\(in_data->downsample_x\)[\s\S]*renderCanvasWidth[\s\S]*sourceStepX/,
  "interactive AE downsampling must map the complete logical canvas into the reduced output"
);
const outputCopyOriginBody =
  effectMain.match(/OutputCopyOriginInfo ResolveOutputCopyOrigin\([\s\S]*?\n\}/)?.[0] ?? "";
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
  /canvasRect\.right = canvasRect\.left \+ std::max<A_long>\(1, info->canvasWidth\)[\s\S]*canvasRect\.bottom = canvasRect\.top \+ std::max<A_long>\(1, info->canvasHeight\)/,
  "Smart PreRender rectangles must remain in full-resolution AE layer coordinates"
);
assert.doesNotMatch(
  preRenderCanvasRectBody,
  /renderCanvasWidth|renderCanvasHeight|downsampleScale/,
  "Smart PreRender must not expose physical GPU texture dimensions as AE layer rectangles"
);
assert.match(
  bitmapGpuBackendMetal,
  /sourceOriginX \+ \(float\(gid\.x\) \+ 0\.5f\) \* uniforms\.sourceStepX/,
  "Metal output copies must scale every reduced-resolution pixel across the complete canvas"
);
assert.doesNotMatch(
  bitmapGpuBackendMetal,
  /uint2 sourceGid = uint2\(gid\.x \+ uniforms\.sourceOriginX/,
  "Metal output must not crop a reduced AE world from the logical canvas at 1:1"
);
assert.match(effectMain, /gpu-render-complete/);
assert.match(
  effectMain,
  /ScaleBitmapFramePlanToPhysicalCanvas[\s\S]*renderCanvasWidth[\s\S]*renderCanvasHeight/,
  "AE downsample renders must scale the physical GPU plan instead of cropping the logical canvas"
);
assert.match(
  read("src/plugin/gpu/bitmap_draw_plan.cpp"),
  /ScaleBitmapFramePlanToPhysicalCanvas[\s\S]*fillTriangles[\s\S]*strokeTriangles[\s\S]*pathFillVertices[\s\S]*imageDraws/,
  "interactive GPU scaling must cover every geometry-backed draw family"
);
assert.match(
  effectMain,
  /controller-render-superseded[\s\S]*PF_Interrupt_CANCEL/,
  "obsolete controller renders must be discarded before AE can present stale output"
);
assert.match(
  effectMain,
  /MarkControllerParamHistoryDirty[\s\S]*RegisterControllerInteractionChange\(instanceId\)/,
  "every controller edit must advance the Effect-local latest-wins generation"
);
assert.match(
  effectMain,
  /controllerInteractionGeneration\s*=\s*ReadControllerInteractionGeneration\(info->instanceId\)[\s\S]*CaptureEffectControllerTimeline/,
  "PreRender must snapshot the interaction generation before capturing controller history"
);
assert.match(
  effectMain,
  /if \(!IsCurrentControllerRenderRequest\(\*info\) \|\|[\s\S]*!IsLatestControllerInteraction\(\*info\)\)[\s\S]*policy=latest-wins[\s\S]*PF_Interrupt_CANCEL/,
  "Smart Render entry must discard controller requests superseded while waiting"
);
assert.match(
  effectMain,
  /params\s*&&\s*params\[PARAM_INSTANCE_ID\][\s\S]*params\[PARAM_INSTANCE_ID\]->u\.sd\.value[\s\S]*controller-param-changed/,
  "native controller edits must register latest-wins against the stable Effect instance id"
);
assert.match(
  runtimeCore,
  /ResolveEffectRenderCacheKeyForScale[\s\S]*preview resize cannot evict full-resolution checkpoints/,
  "interactive physical canvases must not evict the exact full-resolution lane"
);
assert.match(
  read("src/plugin/gpu/bitmap_draw_plan.cpp"),
  /holes\.empty\(\)[\s\S]*TriangulateSimplePolygon[\s\S]*AppendFillBatch/,
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
  runtimeCore + momentumTypes + bitmapGpuBackendMetal,
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
  bitmapGpuBackend,
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
  /instanceId\s*>\s*0[\s\S]{0,120}static_cast<std::uintptr_t>/,
  "runtime caches must not prefer instanceId over the effect-local key"
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
  environment,
  /unique per-instance directory[\s\S]*read-only DocumentStore fallback[\s\S]*shared pending\/global files are never render sources/,
  "render fallback must be uniquely addressed and must never use shared staging files"
);
assert.match(
  effectMain,
  /embedded[\s\S]*definition is authoritative/,
  "the effect-embedded runtime snapshot must remain authoritative"
);
assert.match(
  runtimeFiles,
  /_momentumSeedBitmapInstanceIdCounter/,
  "instance-id allocation must be seeded from existing runtime folders"
);
assert.match(
  bitmapApply,
  /var instanceId = _momentumNextBitmapInstanceId\(\)/,
  "each newly-created bitmap effect must receive a fresh transport id"
);

console.log("Momentum runtime isolation invariants: OK");

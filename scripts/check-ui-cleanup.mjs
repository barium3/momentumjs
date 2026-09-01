import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const html = read("index.html");
const stylePaths = [
  "styles.css",
  "js/ui/files/files.css",
  "js/ui/effectCode.css",
  "js/ui/tooltip.css",
  "js/ui/console/console.css",
];
const styles = stylePaths.map(read).join("\n");
const bootstrapSource = read("js/ui/bootstrap.js");
const errorProtocolSource = read("js/ui/console/errorProtocol.js");
const consoleSource = read("js/ui/console/consoleManager.js");
const workspaceSource = read("js/ui/workspace.js");
const debugTraceSource = read("js/ui/console/debugTraceManager.js");
const interactionsSource = read("js/ui/editor/interactions.js");
const autocompleteBindingsSource = read("js/ui/editor/autocompleteBindings.js");
const autocompleteFontsSource = read("js/ui/editor/autocompleteFonts.js");
const autocompleteSource = read("js/ui/editor/autocomplete.js");
const editorManagerSource = read("js/ui/editor/editorManager.js");
const editorSurfaceSource = read("js/ui/editor/editorSurface.js");
const validationSource = read("js/ui/editor/validation.js");
const codeBundleSource = read("js/ui/codeBundle.js");
const bitmapControllerBootstrapSource = read(
  "js/ui/editor/bitmapControllerBootstrap.js",
);
const codeExecutorSource = read("js/ui/editor/codeExecutor.js");
const timelineClockSource = read("js/ui/timelineClock.js");
const effectCodeClockSource = read("js/ui/effectCodeClock.js");
const effectCodeDiffSource = read("js/ui/effectCodeDiff.js");
const effectCodeSource = read("js/ui/effectCode.js");
const tooltipSource = read("js/ui/tooltip.js");
const activeFileSource = read("js/ui/files/activeFile.js");
const fileEntrySource = read("js/ui/files/fileEntry.js");
const fileManagerSource = read("js/ui/files/fileManager.js");
const fileTreeSource = read("js/ui/files/fileTree.js");
const pluginBitmapSource = read("js/plugin/bitmap.js");
const pluginBridgeSource = read("js/plugin/bridge.js");
const codeSnapshotSource = read("jsx/plugin/codeSnapshot.jsx");

assert.doesNotMatch(html, /acorn-walk|walk\.min\.js/);
assert.doesNotMatch(html, /js\/ui\/app\/host\.js/);
assert.match(html, /js\/vendor\/p5\.min\.js[\s\S]*js\/vendor\/acorn\.min\.js/);
assert.match(html, /font-awesome\/6\.4\.0\/css\/all\.min\.css/);
assert.match(html, /class="fas fa-bars"/);
assert.match(
  html,
  /styles\.css[\s\S]*js\/ui\/files\/files\.css[\s\S]*js\/ui\/effectCode\.css[\s\S]*js\/ui\/tooltip\.css[\s\S]*js\/ui\/console\/console\.css/,
  "UI module styles must load after the shared panel layout",
);
assert.match(
  html,
  /js\/ui\/effectCode\.js[\s\S]*js\/ui\/tooltip\.js[\s\S]*js\/ui\/bootstrap\.js/,
  "the delegated Tooltip must load before app startup",
);
assert.match(
  html,
  /id="cancelEffectCode"[\s\S]*effect-code-exit-button[\s\S]*>Exit<[\s\S]*id="commitCodeCue"[\s\S]*effect-code-keyframe-diamond[\s\S]*id="modifyBaseCode"[\s\S]*>Base Code</,
  "Edit Code must expose Exit, keyframe, and Base Code actions",
);
assert.match(
  html,
  /id="runEditorScript"[\s\S]*aria-label="Run code"/,
  "the Run action must retain its accessibility label",
);
assert.equal(
  (html.match(/data-tooltip=/g) || []).length,
  2,
  "only the two right-side Edit Code actions may show Tooltips",
);
assert.match(
  html,
  /id="commitCodeCue"[\s\S]*data-tooltip="Add Code keyframe"[\s\S]*id="modifyBaseCode"[\s\S]*data-tooltip="Modify Base Code"/,
);
assert.doesNotMatch(html, /fa-times|fa-code|fa-pen-to-square/);
assert.doesNotMatch(html, /js\/ui\/icons\.js|data-momentum-icon/);
assert.doesNotMatch(styles, /#top-toolbar|\.console-timestamp/);
assert.doesNotMatch(
  styles,
  /\.console-(?:key|array-empty|object-empty|more)(?![\w-])/,
  "retired Console value-tree selectors must not return",
);
assert.match(
  styles,
  /\.toolbar-left\s*\{[^}]*padding-left:\s*5px[^}]*\}/,
  "toolbar cleanup must preserve the current left spacing",
);
assert.match(
  styles,
  /\.toolbar-right\s*\{[^}]*gap:\s*12px[^}]*padding-right:\s*10px[^}]*\}/,
  "the right-side toolbar actions must keep their wider spacing",
);
assert.match(
  styles,
  /\.icon-button:not\(:disabled\):hover[\s\S]*\.icon-button:not\(:disabled\):active[\s\S]*\.icon-button:disabled\s*\{[^}]*cursor:\s*default/,
  "disabled toolbar actions must not retain interactive hover or active states",
);
assert.match(
  styles,
  /\.run-mode-select:focus-visible\s*\{[^}]*--momentum-color-focus[\s\S]*\.delete-entry-button:focus-visible\s*\{[^}]*--momentum-color-focus/,
  "select and file actions must share one keyboard focus treatment",
);
assert.ok(
  styles.indexOf(".file.selected > .file-item-content") <
    styles.indexOf(".file > .file-item-content.drop-into"),
  "drop targets must override selected and hover row backgrounds",
);
assert.doesNotMatch(
  styles,
  /#modifyBaseCode\.base-code-editing/,
  "Modify Base Code must be a direct commit action, not a second editor mode",
);
assert.match(
  html,
  /timelineClock\.js[\s\S]*debugTraceManager\.js[\s\S]*effectCodeDiff\.js[\s\S]*effectCodeClock\.js[\s\S]*effectCode\.js/,
  "Effect Code diff rendering must load before the clock and session manager",
);
assert.match(
  styles,
  /--momentum-color-diff-added-background:\s*#3df5991f[\s\S]*--momentum-color-diff-deleted-background:\s*#f7796e1f/,
  "Effect Code changes must use the requested rsms green and red backgrounds",
);
assert.match(
  styles,
  /--momentum-color-danger:\s*#a9443c[\s\S]*--momentum-color-danger-hover:\s*#c05046[\s\S]*--momentum-color-danger-active:\s*#8f3933/,
  "the Exit action must use the requested brick-red states",
);
assert.match(
  styles,
  /--momentum-color-danger-border:\s*#a9443c55[\s\S]*\.effect-code-exit-button\s*{[^}]*min-width:\s*46px[^}]*border:\s*1px solid var\(--momentum-color-danger-border\)[^}]*background-color:\s*transparent[^}]*color:\s*var\(--momentum-color-danger\)/,
  "Edit Code must use a compact outlined dark-red Exit button",
);
assert.match(
  styles,
  /\.effect-code-keyframe-diamond\s*{[^}]*width:\s*7px[^}]*height:\s*7px[^}]*border:\s*1px solid currentColor[^}]*background-color:\s*transparent[^}]*rotate\(45deg\)[\s\S]*\.effect-code-keyframe-present \.effect-code-keyframe-diamond\s*{[^}]*background-color:\s*currentColor/,
  "the Code keyframe action must switch between hollow and solid diamonds",
);
assert.match(
  styles,
  /\.effect-code-label-button\s*{[^}]*min-width:\s*66px/,
  "Modify Base Code must use a compact text button",
);
assert.match(
  styles,
  /\.momentum-tooltip\s*{[^}]*position:\s*fixed[^}]*padding:\s*1px 5px[^}]*background-color:\s*#efefed[^}]*font-size:\s*9px[^}]*line-height:\s*13px[^}]*pointer-events:\s*none/,
  "panel tooltips must use one non-interactive white label",
);
assert.match(
  tooltipSource,
  /SHOW_DELAY_MS = 350[\s\S]*readTooltipText[\s\S]*getAttribute\("data-tooltip"\)[\s\S]*document\.addEventListener\("mouseover", handleMouseOver, true\)[\s\S]*document\.addEventListener\("mouseout", handleMouseOut, true\)/,
  "one delegated Tooltip must cover explicitly labelled controls",
);
assert.doesNotMatch(
  tooltipSource,
  /getAttribute\("(?:title|aria-label)"\)|data-momentum-native-title/,
  "ordinary accessibility labels must not opt controls into visible Tooltips",
);
assert.match(
  styles,
  /effect-code-diff-green-line[^}]*var\(--momentum-color-diff-added-background\)[\s\S]*effect-code-diff-deleted-line[^}]*var\(--momentum-color-diff-deleted-background\)/,
  "Effect Code highlights must consume the shared semantic color tokens",
);
assert.match(
  styles,
  /effect-code-diff-flash-added[^}]*momentum-diff-added-flash 180ms ease-out[\s\S]*effect-code-diff-flash-deleted[^}]*momentum-diff-deleted-flash 180ms ease-out/,
  "timeline Diff flashes must animate only the red and green content",
);
assert.match(
  effectCodeClockSource,
  /const sourceChanged = target\.sourceHash !== options\.getActiveModelHash\(\)[\s\S]*options\.syncDiff\(sourceChanged\)/,
  "the live clock must request a Diff flash only when its source model changes",
);
assert.match(
  editorSurfaceSource,
  /"editorBracketMatch\.background":\s*"#f76ec9"[\s\S]*"scrollbar\.shadow":\s*"#77777577"/,
  "the draft frame must reuse the former pink while the scroll shadow returns to gray",
);
const draftFrameRule = styles.match(
  /#editor-container\.effect-code-draft-dirty::after\s*\{[^}]*\}/,
);
assert.ok(
  draftFrameRule,
  "the pending Effect Code state must own one editor frame rule",
);
assert.match(draftFrameRule[0], /inset:\s*0 8px 0 0/);
assert.match(
  draftFrameRule[0],
  /box-shadow:\s*inset 0 0 12px var\(--momentum-color-draft-glow\)/,
);
assert.doesNotMatch(
  draftFrameRule[0],
  /(?:^|\n)\s*(?:background|border|filter|animation|transition|opacity)\s*:/,
  "the pending-draft hint must remain one static inner glow",
);
assert.match(
  editorSurfaceSource,
  /scrollbar:\s*\{[^}]*vertical:\s*"visible"[^}]*verticalScrollbarSize:\s*8/,
  "the vertical scrollbar must remain visible outside the draft glow",
);
assert.doesNotMatch(
  html + styles + consoleSource,
  /toggleConsole|console-toggle-button|console-collapsed|momentum\.consoleCollapsed/,
  "the removed Console collapse control must not leave UI or state logic behind",
);
assert.match(
  styles,
  /effect-code-diff-green-edge\s*\{[^}]*position:\s*relative[\s\S]*effect-code-diff-green-edge::before[^}]*position:\s*absolute[^}]*right:\s*0[^}]*width:\s*3px[\s\S]*effect-code-diff-deleted-line::before[^}]*right:\s*100%[^}]*width:\s*3px/,
  "green and red edges must render outside the code without consuming columns",
);
assert.match(
  styles,
  /effect-code-diff-green-tail::after[^}]*height:\s*16px[\s\S]*effect-code-diff-deleted-line[^}]*height:\s*16px/,
  "green and red code tags must use one consistent narrow visual height",
);
assert.doesNotMatch(
  styles,
  /effect-code-diff-green-edge::before[^}]*width:\s*9px|effect-code-diff-deleted-line[^}]*padding:\s*0 3px 0 10px/,
  "Effect Code highlights must not indent the underlying code",
);
assert.match(
  styles,
  /effect-code-diff-deleted-zone[^}]*pointer-events:\s*auto[\s\S]*effect-code-diff-restore-button[^}]*pointer-events:\s*auto/,
  "the deleted-code zone must expose its restore action to pointer input",
);
assert.match(
  effectCodeDiffSource,
  /computeLineDiff[\s\S]*precomputeTimeline[\s\S]*showTimeline[\s\S]*showDraft/,
  "one focused module must own cached timeline and draft diff rendering",
);
assert.doesNotMatch(consoleSource, /function buildObjectTree\s*\(/);
assert.doesNotMatch(consoleSource, /captureState|restoreState/);
assert.match(
  consoleSource,
  /function activateChannel[\s\S]*saveActiveChannel[\s\S]*state\.nodes/,
  "Console modes must switch retained DOM channels instead of serializing HTML",
);
assert.match(
  consoleSource,
  /<button type="button" class="console-details-header"[^>]*aria-expanded="true"[\s\S]*closest\("\.console-details-header"\)[\s\S]*querySelector\("\.console-details-toggle"\)/,
  "the full Console details header must be a keyboard-operable disclosure button",
);
assert.doesNotMatch(
  effectCodeSource,
  /captureWorkspaceUiState|restoreWorkspace|style\.display|consoleState/,
  "Effect Code must not own workspace DOM restoration",
);
assert.match(
  effectCodeClockSource,
  /function parseViewClock[\s\S]*function applyTimeSample[\s\S]*const viewClock[\s\S]*function pollTimeline/,
  "one focused module must own the unified native clock and Code timeline reconciliation",
);
assert.doesNotMatch(
  effectCodeClockSource,
  /renderClock|parseRenderClock|RENDER_SAMPLE_MS|RENDER_RETRY_MS|playbackClock|parsePlaybackClock|PLAYBACK_SAMPLE_MS|PLAYBACK_RETRY_MS/,
  "retired split-clock implementations must not return",
);
assert.doesNotMatch(
  effectCodeClockSource,
  /momentumReadCodeEditorScrubTime|SCRUB_ACTIVE_SAMPLE_MS|probeScrubTime/,
  "the host-blocked ExtendScript scrub path must not return",
);
assert.doesNotMatch(
  effectCodeSource,
  /function (?:parseCodeClockTimeline|applyCodeClockSample|sampleCodeClock|startCodeClock|stopCodeClock)\s*\(/,
  "the Effect Code session manager must not reimplement its live clock",
);
assert.doesNotMatch(
  effectCodeSource,
  /close:\s*closeSession|submit:\s*submit|typeof window\.(?:momentumPluginBridge|consoleManager|activeFile|editorManager|debugTraceManager)/,
  "Effect Code must expose only its production API and trust fixed UI modules",
);
assert.doesNotMatch(
  fileEntrySource,
  /normalizeTree:\s*normalizeTree/,
  "recursive entry normalization must remain private",
);
assert.doesNotMatch(
  fileManagerSource + fileTreeSource,
  /typeof window\.(?:fileDrop|fileManager|fileTreeUI)/,
  "file UI modules must use their fixed load-order contract directly",
);
assert.doesNotMatch(
  fileTreeSource + styles,
  /entry-drop-zone|drop-between/,
  "file ordering must use each row instead of a narrow gap-only target",
);
assert.match(
  fileTreeSource,
  /function getEntryDropIntent[\s\S]*offsetRatio < 0\.5 \? "before" : "after"/,
  "file rows must divide their full height between before and after targets",
);
assert.match(
  fileTreeSource,
  /contentDiv\.ondrop[\s\S]*dropIntent[\s\S]*fileManager\.moveEntry/,
  "the visible row drop intent must drive internal file ordering",
);
assert.doesNotMatch(
  editorSurfaceSource,
  /momentumEditor(?:Autocomplete|Validation)\s*&&|typeof window\.momentumEditor(?:Autocomplete|Validation)/,
  "Editor Surface must treat autocomplete and validation as fixed modules",
);
assert.doesNotMatch(
  codeExecutorSource,
  /typeof window\.(?:ImageAnalyzer|FontAnalyzer|P5Analyzer|sketchCompiler)|codePreprocessor\s*&&|!window\.momentumRuntimeCapabilities/,
  "Code Executor must not retain compatibility paths for fixed runtime modules",
);
assert.doesNotMatch(
  validationSource + autocompleteSource + autocompleteBindingsSource,
  /typeof window\.sketchCompiler|compilerSymbols\s*&&|!window\.compilerGlobalBindingsPass/,
  "editor services must consume the fixed compiler modules directly",
);
assert.doesNotMatch(
  bitmapControllerBootstrapSource + codeBundleSource,
  /!window\.compilerAst|typeof window\.compilerAst/,
  "AST consumers must use the compiler module contract directly",
);
assert.ok(
  html.indexOf('src="js/ui/effectCodeClock.js"') <
    html.indexOf('src="js/ui/effectCode.js"'),
  "the Effect Code clock must load before the session manager",
);
assert.doesNotMatch(
  activeFileSource,
  /style\.display|ensureImageContainer/,
  "Active File must delegate visible surfaces to Workspace",
);
assert.match(
  workspaceSource,
  /function syncMode[\s\S]*enterEffectCode[\s\S]*leaveEffectCode[\s\S]*showEditor[\s\S]*showImage/,
  "one Workspace manager must own visible modes and surfaces",
);
assert.doesNotMatch(
  workspaceSource,
  /editor\.hidden/,
  "image previews must not remove the shared Monaco editor from layout",
);
assert.match(
  workspaceSource,
  /workspace-editor-inactive/,
  "Workspace must preserve Monaco geometry while an image covers it",
);
assert.match(
  editorSurfaceSource,
  /new ResizeObserver[\s\S]*observe\(container\)/,
  "the Editor Surface must own container-size observation",
);
assert.doesNotMatch(
  editorSurfaceSource,
  /window\.addEventListener\("resize", layout\)/,
  "Editor layout must follow its container rather than only the window",
);
[
  consoleSource,
  effectCodeSource,
  fileManagerSource,
].forEach((source) => {
  assert.doesNotMatch(
    source,
    /editorManager\.layout\(/,
    "feature modules must not manually repair Editor Surface layout",
  );
});
assert.match(
  styles,
  /#image-container\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*\}/,
  "the image preview must cover the editor without changing its dimensions",
);
assert.doesNotMatch(
  codeExecutorSource,
  /function (?:toExtendScriptStringExpr|evalExtendScript)\s*\(/,
);
assert.match(
  bitmapControllerBootstrapSource,
  /function createWindowBindingSession[\s\S]*function bindControllerBootstrapStubs[\s\S]*function runBitmapControllerBootstrap/,
  "one focused module must own the temporary bitmap Controller runtime",
);
assert.doesNotMatch(
  codeExecutorSource,
  /function (?:createWindowBindingSession|bindControllerBootstrapStubs|runBitmapControllerBootstrap|instrumentBitmapControllerCallsites)\s*\(/,
  "the Code Executor must not reimplement bitmap Controller bootstrap logic",
);
assert.ok(
  html.indexOf('src="js/ui/editor/bitmapControllerBootstrap.js"') <
    html.indexOf('src="js/ui/editor/codeExecutor.js"'),
  "the bitmap Controller bootstrap must load before the Code Executor",
);
assert.doesNotMatch(editorManagerSource, /function expectExtendScriptOk\s*\(/);
assert.doesNotMatch(
  editorManagerSource,
  /function (?:normalizeSource|buildRuntimeBundle|buildCodeCueBundle|validateCodeCueContract|formatDiagnostic)\s*\(/,
  "Editor Manager must not reimplement the shared Code Bundle service",
);
assert.match(
  editorManagerSource,
  /window\.editorManager = \(function \(\)[\s\S]*return createManager\(\);\s*\}\)\(\);\s*$/,
  "the Editor Manager file must expose only its one public singleton",
);
assert.doesNotMatch(
  editorManagerSource,
  /momentumEditorManagerFactory/,
  "the private Editor Manager factory must not leak onto window",
);
assert.match(
  editorSurfaceSource,
  /return \{\s*create,\s*\};\s*\}\)\(\);\s*$/,
  "the Editor Surface must expose only the operation consumed by Editor Manager",
);
assert.doesNotMatch(
  editorSurfaceSource,
  /return \{\s*autocomplete,|model: editorOptions\.model/,
  "the created Editor Surface must not expose unconsumed implementation details",
);
assert.doesNotMatch(
  validationSource,
  /return \{\s*createController,\s*formatDiagnosticMessage/,
  "Validation formatting must remain private to its controller module",
);
assert.doesNotMatch(
  codeExecutorSource,
  /function (?:absolutizeBitmapAssetCalls|absolutizeIoAssetCalls|absolutizeLoadFontCalls|absolutizeLoadImageCalls)\s*\(/,
  "the Code Executor must not re-export unused Asset wrappers",
);
assert.doesNotMatch(
  editorManagerSource,
  /typeof window\.codeExecutor\.(?:absolutizeBitmapAssetCalls|discoverBitmapControllers)|Promise\.resolve\(\[\]\)/,
  "required Bitmap dependencies must not keep compatibility fallbacks",
);
assert.doesNotMatch(
  bootstrapSource,
  /window\.momentumApp/,
  "the private app bootstrap must not leak onto window",
);
assert.doesNotMatch(
  debugTraceSource,
  /getElementById\("console-output"\)|document\.createElement\("div"\)/,
  "Debug Trace must use the required Console Manager dependency",
);
assert.doesNotMatch(
  html,
  /js\/ui\/(?:app\/|editor\/(?:core|features|runtime)\/|editor\/index\.js)/,
  "UI loading paths must stay flat within their feature directory",
);
assert.match(
  codeBundleSource,
  /return \{[\s\S]*buildCodeCueBundle[\s\S]*buildRuntimeBundle[\s\S]*formatDiagnostic[\s\S]*normalizeSource[\s\S]*validateCodeCueContract[\s\S]*\};/,
  "one focused service must own source, Bundle, contract, and diagnostic helpers",
);
assert.ok(
  html.indexOf('src="js/ui/codeBundle.js"') <
    html.indexOf('src="js/ui/editor/editorManager.js"') &&
  html.indexOf('src="js/ui/codeBundle.js"') <
    html.indexOf('src="js/ui/effectCode.js"'),
  "the Code Bundle service must load before both UI consumers",
);
assert.doesNotMatch(
  codeSnapshotSource,
  /function (?:_momentumCodeEditTimesEqual|momentumRestoreCodeEditorFocus)\s*\(/,
);
assert.doesNotMatch(
  interactionsSource,
  /DEBUG_HISTORY_SHORTCUTS|DEBUG_LABEL_ALLOWLIST|debugLog\s*\(/,
  "disabled debug work must stay out of the editor input path",
);
assert.equal(
  (interactionsSource.match(/addEventListener\("keydown", windowKeydownHandler/g) || []).length,
  1,
  "one DOM keydown router must own CEP editor shortcuts",
);
assert.doesNotMatch(
  interactionsSource,
  /windowCommentKeydownHandler|windowHistoryKeydownHandler|attachInputAreaSelectHandler/,
);
assert.match(
  autocompleteFontsSource,
  /function getTextFontFirstArgumentContext[\s\S]*function buildFontSuggestions/,
  "one focused service must own textFont context and font suggestions",
);
assert.doesNotMatch(
  autocompleteSource,
  /function (?:getTextFontFirstArgumentContext|buildFontSuggestions|getFontAnalyzer|getMemberCompletionContext|buildUserBindingSuggestions)\s*\(/,
  "the autocomplete coordinator must not reimplement focused completion services",
);
assert.match(
  autocompleteBindingsSource,
  /function createScopeContextForOffset[\s\S]*function getMemberCompletionContext[\s\S]*function buildUserBindingSuggestions/,
  "one focused service must own AST scope, member, and user binding completions",
);
assert.ok(
  html.indexOf('src="js/ui/editor/autocompleteBindings.js"') <
    html.indexOf('src="js/ui/editor/autocomplete.js"') &&
    html.indexOf('src="js/ui/editor/autocompleteFonts.js"') <
    html.indexOf('src="js/ui/editor/autocomplete.js"'),
  "focused completion services must load before the autocomplete coordinator",
);
assert.doesNotMatch(
  consoleSource,
  /MIRROR_TO_NATIVE_CONSOLE|mirrorToNativeConsole/,
  "constant-disabled native Console mirroring must not return",
);
assert.match(
  consoleSource,
  /registerExpandableValue[\s\S]*data-value-id[\s\S]*expandableValues\[valueId\]/,
  "nested Console objects must use an in-memory value registry",
);
assert.doesNotMatch(
  consoleSource,
  /data-value=['"]|JSON\.parse\(nestedExpandable|JSON\.stringify\(value/,
  "nested Console values must never be serialized into HTML attributes",
);
assert.doesNotMatch(
  consoleSource,
  /handleNestedToggle|newToggle\.addEventListener/,
  "one delegated Console click handler must own every expansion level",
);
[
  "diagnoseCode",
  "formatDocument",
  "isRunEnabled",
  "getRenderMode",
  "initEditor",
  "initRenderMode",
  "setRenderMode",
  "toggleLineComments",
].forEach((name) => {
  assert.doesNotMatch(
    editorManagerSource,
    new RegExp(`\\n\\s+${name}(?::|,)`),
    `the editor manager must not expose its internal ${name} helper`,
  );
});
[
  "onExtendScriptReady",
  "renderExtendScriptFailure",
  "toExtendScriptStringExpr",
  "evalExtendScript",
].forEach((name) => {
  assert.doesNotMatch(
    pluginBridgeSource,
    new RegExp(`\\n\\s+${name},`),
    `the CEP bridge must not expose its internal ${name} helper`,
  );
});
assert.doesNotMatch(pluginBitmapSource, /\n\s+DEFAULT_COMP,/);
assert.doesNotMatch(pluginBitmapSource, /\n\s+expectExtendScriptOk,/);
assert.doesNotMatch(codeExecutorSource, /index === 3 \? 1 : 1/);
assert.match(
  editorManagerSource,
  /renderModeSelect\.hidden = !isRunEnabled[\s\S]*renderModeSelect\.disabled = !isRunEnabled/,
  "Render Mode must disappear for images and non-runnable files",
);
assert.match(
  editorManagerSource,
  /RENDER_MODE_POINTER_FOCUS_CLASS[\s\S]*select\.addEventListener\("mousedown"[\s\S]*classList\.add\(RENDER_MODE_POINTER_FOCUS_CLASS\)[\s\S]*select\.addEventListener\("blur"[\s\S]*classList\.remove\(RENDER_MODE_POINTER_FOCUS_CLASS\)/,
  "pointer use must not leave the Render Mode focus frame behind",
);
assert.match(
  styles,
  /\.run-mode-select\.render-mode-pointer-focus:focus\s*{[^}]*box-shadow:\s*none/,
  "the pointer-focused Render Mode control must suppress its focus frame",
);
assert.doesNotMatch(
  fileTreeSource + effectCodeDiffSource,
  /(?:deleteButton|restoreButton)\.title\s*=/,
  "delete and restore controls must not show visible Tooltips",
);
assert.match(
  fileTreeSource,
  /expandedFolderPaths[\s\S]*remapExpandedEntry[\s\S]*removeExpandedEntry[\s\S]*previousScrollTop[\s\S]*replaceChildren/,
  "File Tree refreshes must preserve expansion and scroll state",
);
assert.match(
  fileTreeSource,
  /if \(isExternalDrop\) \{[\s\S]*importExternalDrop\(\s*dataTransfer,\s*Entry\.getParentPath\(item\.path\),\s*item\.path,\s*dropIntent/,
  "external drops on a file must resolve against the hovered file",
);
assert.doesNotMatch(
  fileTreeSource,
  /setTimeout\(commitInput,\s*100\)/,
  "inline names must commit deterministically on blur",
);
assert.match(
  bootstrapSource,
  /tooltipManager\.init\(\)[\s\S]*consoleManager\.init\(\)[\s\S]*workspaceManager\.init\(\)[\s\S]*debugTraceManager\.init\(\)[\s\S]*activeFile\.init\(\)[\s\S]*fileTreeUI\.init\(\)[\s\S]*fileManager\.init\(\)[\s\S]*effectCodeManager\.init\(\)[\s\S]*editorManager\.init\(\)[\s\S]*momentumPluginBridge\.init\(\)/,
  "one app bootstrap must own the complete UI startup order",
);
assert.match(
  debugTraceSource,
  /return \{\s*ensureSession,\s*init,\s*startSession,\s*stop,\s*stopAndClear,\s*updateTimelineSample,\s*useExternalClock,/,
  "Debug Trace startup must be explicit",
);
assert.match(
  activeFileSource,
  /function init\(\)[\s\S]*momentum:editor-ready[\s\S]*beforeunload/,
  "Active File global listeners must be installed by init",
);
assert.match(
  fileTreeSource,
  /function init\(\)[\s\S]*handleDocumentKeydown[\s\S]*handleDocumentDragover[\s\S]*handleDocumentDrop/,
  "File Tree document listeners must be installed by init",
);
assert.match(
  fileManagerSource,
  /function init\(\)[\s\S]*ActiveFile\.setRefreshHandler[\s\S]*initResponsiveLayout\(\)/,
  "File Manager coordination must start through init",
);

function createEventHub() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(listener);
    },
    dispatch(type, event) {
      (listeners.get(type) || []).slice().forEach((listener) => listener(event));
    },
    removeEventListener(type, listener) {
      if (!listeners.has(type)) {
        return;
      }
      listeners.set(
        type,
        listeners.get(type).filter((candidate) => candidate !== listener),
      );
    },
  };
}

const eventHub = createEventHub();
const editorTriggers = [];
let runCount = 0;
let interactionsDocumentFocused = true;
const editorNode = {
  contains() {
    return true;
  },
  querySelector() {
    return null;
  },
};
const editorModel = {
  getValue() {
    return "function draw() {}";
  },
};
const editor = {
  focus() {},
  getDomNode() {
    return editorNode;
  },
  getModel() {
    return editorModel;
  },
  getSelections() {
    return [];
  },
  getValue() {
    return editorModel.getValue();
  },
  hasTextFocus() {
    return true;
  },
  hasWidgetFocus() {
    return true;
  },
  trigger(source, action) {
    editorTriggers.push({ source, action });
  },
};
const interactionsContext = {
  Date,
  console,
  document: {
    activeElement: editorNode,
    hasFocus() {
      return interactionsDocumentFocused;
    },
  },
  monaco: {
    Range: class Range {},
    Selection: class Selection {},
  },
  setTimeout,
  ...eventHub,
};
interactionsContext.window = interactionsContext;
interactionsContext.globalThis = interactionsContext;
vm.runInNewContext(interactionsSource, interactionsContext, {
  filename: "interactions.js",
});

const interactions = interactionsContext.momentumEditorInteractions.createController({
  canRunScript() {
    return true;
  },
  getEditor() {
    return editor;
  },
  runScript() {
    runCount += 1;
  },
});
interactions.bindWindowShortcuts();

function keyboardEvent(overrides) {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: "",
    keyCode: 0,
    metaKey: false,
    shiftKey: false,
    which: 0,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    ...overrides,
  };
}

eventHub.dispatch(
  "keydown",
  keyboardEvent({ key: "r", code: "KeyR", keyCode: 82, which: 82, metaKey: true }),
);
assert.equal(runCount, 1, "Cmd/Ctrl+R must still run the current file");

eventHub.dispatch("keyup", keyboardEvent({ key: "Meta", code: "MetaLeft" }));
eventHub.dispatch(
  "keydown",
  keyboardEvent({ key: "a", code: "KeyA", keyCode: 65, which: 65, metaKey: true }),
);
assert.equal(
  editorTriggers.some((entry) => entry.action === "editor.action.selectAll"),
  true,
  "Cmd/Ctrl+A must still select the Monaco document",
);

const editorTriggerCount = editorTriggers.length;
interactionsDocumentFocused = false;
eventHub.dispatch("momentum:cep-keydown", {
  detail: {
    key: "a",
    code: "KeyA",
    keyCode: 65,
    which: 65,
    metaKey: true,
  },
});
assert.equal(
  editorTriggers.length,
  editorTriggerCount,
  "forwarded CEP shortcuts must not steal keyboard commands from After Effects",
);
interactionsDocumentFocused = true;

let registeredProvider = null;
let disposedProviderCount = 0;
let compilerOptions = null;
let modeConfiguration = null;
const autocompleteContext = {
  Promise,
  console,
  monaco: {
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: {
        Class: 1,
        Constant: 2,
        Function: 3,
        Method: 4,
        Property: 5,
        Variable: 6,
      },
      registerCompletionItemProvider(language, provider) {
        assert.equal(language, "javascript");
        registeredProvider = provider;
        return {
          dispose() {
            disposedProviderCount += 1;
          },
        };
      },
      typescript: {
        ScriptTarget: { ES2020: 7 },
        javascriptDefaults: {
          modeConfiguration: { diagnostics: true },
          setCompilerOptions(options) {
            compilerOptions = options;
          },
          setModeConfiguration(options) {
            modeConfiguration = options;
          },
        },
      },
    },
  },
};
autocompleteContext.window = autocompleteContext;
autocompleteContext.globalThis = autocompleteContext;
vm.runInNewContext(autocompleteBindingsSource, autocompleteContext, {
  filename: "autocompleteBindings.js",
});
vm.runInNewContext(autocompleteFontsSource, autocompleteContext, {
  filename: "autocompleteFonts.js",
});
vm.runInNewContext(autocompleteSource, autocompleteContext, {
  filename: "autocomplete.js",
});

const autocomplete =
  autocompleteContext.momentumEditorAutocomplete.createController();
autocomplete.configure();
assert.ok(registeredProvider, "JavaScript autocomplete provider must be registered");
assert.equal(registeredProvider.triggerCharacters.includes("."), true);
assert.equal(registeredProvider.triggerCharacters.includes("a"), true);
assert.equal(compilerOptions.noLib, true);
assert.equal(modeConfiguration.completionItems, false);
autocomplete.dispose();
assert.equal(disposedProviderCount, 1);

function encodeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function createConsoleElement() {
  let text = "";
  let htmlValue = "";
  return {
    className: "",
    scrollHeight: 0,
    scrollTop: 0,
    style: {},
    appendChild() {},
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    set textContent(value) {
      text = String(value);
      htmlValue = encodeHtml(text);
    },
    get textContent() {
      return text;
    },
    set innerHTML(value) {
      htmlValue = String(value);
    },
    get innerHTML() {
      return htmlValue;
    },
  };
}

const consoleOutput = createConsoleElement();
const consoleLines = [];
let consoleClickListenerCount = 0;
consoleOutput.appendChild = (line) => consoleLines.push(line);
consoleOutput.removeChild = (line) => {
  consoleLines.splice(consoleLines.indexOf(line), 1);
  return line;
};
consoleOutput.replaceChildren = (...lines) => {
  consoleLines.splice(0, consoleLines.length, ...lines);
};
Object.defineProperty(consoleOutput, "firstChild", {
  get() { return consoleLines[0] || null; },
});
consoleOutput.addEventListener = (type) => {
  if (type === "click") {
    consoleClickListenerCount += 1;
  }
};
const consoleContext = {
  console: {
    error() {},
    info() {},
    log() {},
    warn() {},
  },
  document: {
    createElement() {
      return createConsoleElement();
    },
    getElementById(id) {
      return id === "console-output" ? consoleOutput : null;
    },
    querySelector() {
      return null;
    },
  },
};
consoleContext.window = consoleContext;
consoleContext.globalThis = consoleContext;
vm.runInNewContext(errorProtocolSource, consoleContext, {
  filename: "error-protocol.js",
});
vm.runInNewContext(consoleSource, consoleContext, {
  filename: "console-manager.js",
});
consoleContext.consoleManager.init();
consoleContext.consoleManager.init();
assert.equal(consoleClickListenerCount, 1, "Console init must be idempotent");
consoleContext.consoleManager.appendExternalLine("<unsafe>&\"", "warn");
assert.match(consoleLines[0].innerHTML, /&lt;unsafe&gt;&amp;&quot;/);

const circularValue = {
  text: "'><img src=x onerror=unsafe>",
};
circularValue.self = circularValue;
const unsafeNamedFunction = function () {};
Object.defineProperty(unsafeNamedFunction, "name", {
  value: "<unsafe-function>",
});
consoleContext.console.log(
  Symbol("<unsafe-symbol>"),
  unsafeNamedFunction,
  circularValue,
);
const objectLine = consoleLines[1].innerHTML;
assert.doesNotMatch(objectLine, /<unsafe-symbol>|<unsafe-function>|<img/);
assert.match(objectLine, /data-value-id="console-value-1"/);
assert.doesNotMatch(objectLine, /data-value=/);
assert.match(
  objectLine,
  /<button type="button" class="console-details-header"[^>]*aria-controls=/,
  "Console object details must render a real disclosure button",
);
consoleContext.console.error({
  code: "IMAGE_LOAD_FAILED",
  message: "Could not decode asset.png",
  path: "C:/workspace/asset.png",
  type: "error",
});
const normalizedErrorLine = consoleLines[2].innerHTML;
assert.match(normalizedErrorLine, /\[IMAGE_LOAD_FAILED\] Could not decode asset\.png/);
assert.doesNotMatch(
  normalizedErrorLine,
  /console-expandable-ref[^>]*>Object<\/span>/,
  "error-like objects must expose their message instead of a red Object label",
);
const workspaceConsoleLines = consoleLines.slice();

consoleContext.consoleManager.activateChannel("effect-code");
assert.equal(consoleLines.length, 0, "Effect Code must start with an isolated Console channel");
consoleContext.consoleManager.appendExternalLine("effect message", "log");
const effectConsoleLine = consoleLines[0];
consoleContext.consoleManager.activateChannel("workspace");
assert.deepEqual(
  consoleLines,
  workspaceConsoleLines,
  "the workspace Console nodes must return without HTML serialization",
);
assert.notEqual(consoleLines.includes(effectConsoleLine), true);
consoleContext.consoleManager.activateChannel("effect-code");
assert.deepEqual(consoleLines, [effectConsoleLine]);
consoleContext.consoleManager.clearConsole();
assert.equal(consoleLines.length, 0);
consoleContext.consoleManager.activateChannel("workspace");
assert.equal(consoleLines.length, 3, "clearing Effect Code must not clear workspace logs");

function createWorkspaceElement(hidden = false) {
  const classes = new Set();
  const attributes = new Map();
  return {
    children: [],
    hidden,
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
    getAttribute(name) { return attributes.get(name) || null; },
    removeAttribute(name) { attributes.delete(name); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
}

const workspaceElements = {
  container: createWorkspaceElement(),
  editor: createWorkspaceElement(),
  "file-list": createWorkspaceElement(),
  "image-container": createWorkspaceElement(true),
};
const workspaceChannels = [];
let workspaceTooltipHides = 0;
const workspaceContext = {
  consoleManager: {
    activateChannel(name) { workspaceChannels.push(name); },
  },
  document: {
    createElement() { return {}; },
    getElementById(id) { return workspaceElements[id]; },
  },
  encodeURI,
  fileEntry: {
    normalizePath(value) { return String(value).replace(/\\/g, "/"); },
  },
  tooltipManager: {
    hide() { workspaceTooltipHides += 1; },
  },
};
workspaceContext.window = workspaceContext;
workspaceContext.globalThis = workspaceContext;
vm.runInNewContext(workspaceSource, workspaceContext, { filename: "workspace.js" });
workspaceContext.workspaceManager.init();
workspaceContext.workspaceManager.showImage("/tmp/image name.png");
assert.equal(workspaceElements.editor.hidden, false);
assert.equal(
  workspaceElements.editor.classList.contains("workspace-editor-inactive"),
  true,
);
assert.equal(workspaceElements.editor.getAttribute("aria-hidden"), "true");
assert.equal(workspaceElements["image-container"].hidden, false);
assert.match(workspaceElements["image-container"].children[0].src, /image%20name\.png/);
workspaceContext.workspaceManager.showImage("/tmp/second image.png");
assert.equal(workspaceElements.editor.hidden, false);
assert.equal(
  workspaceElements.editor.classList.contains("workspace-editor-inactive"),
  true,
);
workspaceContext.workspaceManager.enterEffectCode();
assert.equal(workspaceElements.editor.hidden, false);
assert.equal(
  workspaceElements.editor.classList.contains("workspace-editor-inactive"),
  false,
);
assert.equal(workspaceElements["image-container"].hidden, true);
assert.equal(
  workspaceElements.container.classList.contains("effect-code-active"),
  true,
);
assert.equal(workspaceElements["file-list"].getAttribute("aria-disabled"), "true");
workspaceContext.workspaceManager.leaveEffectCode();
assert.equal(workspaceElements.editor.hidden, false);
assert.equal(
  workspaceElements.editor.classList.contains("workspace-editor-inactive"),
  true,
);
assert.equal(workspaceElements["image-container"].hidden, false);
assert.deepEqual(workspaceChannels, ["workspace", "effect-code", "workspace"]);
workspaceContext.workspaceManager.showEditor();
assert.equal(workspaceElements.editor.hidden, false);
assert.equal(
  workspaceElements.editor.classList.contains("workspace-editor-inactive"),
  false,
);
assert.equal(workspaceElements.editor.getAttribute("aria-hidden"), "false");
assert.equal(workspaceElements["image-container"].hidden, true);
assert.equal(
  workspaceTooltipHides,
  6,
  "every workspace surface transition must dismiss its Tooltip",
);

const editorSurfaceFrames = new Map();
const editorSurfaceObservers = [];
const editorSurfaceLayoutCalls = [];
let nextEditorSurfaceFrame = 0;
const editorSurfaceBounds = { width: 640, height: 360 };
const editorSurfaceContainer = {
  getBoundingClientRect() {
    return editorSurfaceBounds;
  },
  style: {
    setProperty() {},
  },
};
const editorSurfaceModel = {
  dispose() {},
};
const editorSurfaceEditor = {
  dispose() {},
  getContribution() { return null; },
  layout(dimensions) { editorSurfaceLayoutCalls.push(dimensions); },
};
class MockResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.target = null;
    editorSurfaceObservers.push(this);
  }
  disconnect() {
    this.disconnected = true;
  }
  observe(target) {
    this.target = target;
  }
}
const editorSurfaceContext = {
  Promise,
  ResizeObserver: MockResizeObserver,
  clearTimeout() {},
  console,
  monaco: {
    Uri: {
      parse(value) { return value; },
    },
    editor: {
      create() { return editorSurfaceEditor; },
      createModel() { return editorSurfaceModel; },
      defineTheme() {},
    },
  },
  requestAnimationFrame(callback) {
    nextEditorSurfaceFrame += 1;
    editorSurfaceFrames.set(nextEditorSurfaceFrame, callback);
    return nextEditorSurfaceFrame;
  },
  cancelAnimationFrame(frameId) {
    editorSurfaceFrames.delete(frameId);
  },
  setTimeout() { return 1; },
};
editorSurfaceContext.window = editorSurfaceContext;
editorSurfaceContext.globalThis = editorSurfaceContext;
vm.runInNewContext(editorSurfaceSource, editorSurfaceContext, {
  filename: "editorSurface.js",
});
const observedEditorSurface = await editorSurfaceContext.momentumEditorSurface.create({
  autocomplete: false,
  container: editorSurfaceContainer,
  editorOptions: {
    language: "javascript",
    value: "const visible = true;",
  },
  validation: false,
});
assert.equal(editorSurfaceObservers.length, 1);
assert.equal(editorSurfaceObservers[0].target, editorSurfaceContainer);
assert.equal(editorSurfaceFrames.size, 1);
editorSurfaceObservers[0].callback();
editorSurfaceObservers[0].callback();
assert.equal(
  editorSurfaceFrames.size,
  1,
  "repeated size notifications must coalesce into one Editor layout",
);
const initialEditorSurfaceFrame = editorSurfaceFrames.entries().next().value;
editorSurfaceFrames.delete(initialEditorSurfaceFrame[0]);
initialEditorSurfaceFrame[1]();
assert.equal(editorSurfaceLayoutCalls.length, 1);
assert.equal(editorSurfaceLayoutCalls[0].width, 640);
assert.equal(editorSurfaceLayoutCalls[0].height, 360);
editorSurfaceBounds.width = 0;
editorSurfaceObservers[0].callback();
const hiddenEditorSurfaceFrame = editorSurfaceFrames.entries().next().value;
editorSurfaceFrames.delete(hiddenEditorSurfaceFrame[0]);
hiddenEditorSurfaceFrame[1]();
assert.equal(
  editorSurfaceLayoutCalls.length,
  1,
  "zero-size containers must not overwrite Monaco's last valid geometry",
);
observedEditorSurface.dispose();
assert.equal(editorSurfaceObservers[0].disconnected, true);

let debugTraceListenerCount = 0;
const debugTraceContext = {
  console,
  momentumTimelineClock: {
    createClock() {
      return { start() {}, stop() {} };
    },
  },
  document: {
    hidden: false,
    addEventListener(type) {
      if (type === "visibilitychange") {
        debugTraceListenerCount += 1;
      }
    },
  },
  clearTimeout,
  setTimeout,
};
debugTraceContext.window = debugTraceContext;
debugTraceContext.globalThis = debugTraceContext;
vm.runInNewContext(debugTraceSource, debugTraceContext, {
  filename: "debug-trace-manager.js",
});
assert.equal(debugTraceListenerCount, 0, "module evaluation must not start Debug Trace");
debugTraceContext.debugTraceManager.init();
debugTraceContext.debugTraceManager.init();
assert.equal(debugTraceListenerCount, 1, "Debug Trace init must be idempotent");

const fileTreeListeners = [];
const fileTreeContext = {
  console,
  document: {
    addEventListener(type) {
      fileTreeListeners.push(type);
    },
    querySelectorAll() {
      return [];
    },
  },
  fileEntry: {},
  fileTypes: {},
};
fileTreeContext.window = fileTreeContext;
fileTreeContext.globalThis = fileTreeContext;
vm.runInNewContext(fileTreeSource, fileTreeContext, {
  filename: "file-tree.js",
});
assert.deepEqual(fileTreeListeners, [], "module evaluation must not bind File Tree events");
fileTreeContext.fileTreeUI.init();
fileTreeContext.fileTreeUI.init();
assert.deepEqual(
  fileTreeListeners,
  ["keydown", "dragover", "drop"],
  "File Tree init must bind each document event exactly once",
);

const appInitOrder = [];
let domReadyListener = null;
let toolbarBindingCount = 0;
const bootstrapContext = {
  activeFile: { init() { appInitOrder.push("active-file"); } },
  consoleManager: { init() { appInitOrder.push("console"); } },
  debugTraceManager: { init() { appInitOrder.push("debug-trace"); } },
  workspaceManager: { init() { appInitOrder.push("workspace"); } },
  document: {
    readyState: "loading",
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") {
        domReadyListener = listener;
      }
    },
    getElementById() {
      return {
        addEventListener(type) {
          if (type === "click") {
            toolbarBindingCount += 1;
          }
        },
      };
    },
  },
  editorManager: {
    init() { appInitOrder.push("editor"); },
    runScript() {},
  },
  effectCodeManager: { init() { appInitOrder.push("effect-code"); } },
  fileManager: {
    createNewFile() {},
    createNewFolder() {},
    init() { appInitOrder.push("file-manager"); },
    toggleFileListCollapsed() {},
  },
  fileTreeUI: { init() { appInitOrder.push("file-tree"); } },
  momentumPluginBridge: { init() { appInitOrder.push("bridge"); } },
  tooltipManager: { init() { appInitOrder.push("tooltip"); } },
};
bootstrapContext.window = bootstrapContext;
bootstrapContext.globalThis = bootstrapContext;
vm.runInNewContext(bootstrapSource, bootstrapContext, {
  filename: "bootstrap.js",
});
assert.deepEqual(appInitOrder, [], "bootstrap must wait until the DOM is ready");
assert.equal(typeof domReadyListener, "function");
domReadyListener();
assert.deepEqual(appInitOrder, [
  "tooltip",
  "console",
  "workspace",
  "debug-trace",
  "active-file",
  "file-tree",
  "file-manager",
  "effect-code",
  "editor",
  "bridge",
]);
assert.equal(toolbarBindingCount, 4);
domReadyListener();
assert.equal(appInitOrder.length, 10, "app init must be idempotent");
assert.equal(toolbarBindingCount, 4, "toolbar events must be bound once");

console.log("UI cleanup checks passed.");

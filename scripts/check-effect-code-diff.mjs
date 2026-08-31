import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/effectCodeDiff.js", import.meta.url),
  "utf8",
);

function createNode() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    children: [],
    className: "",
    disabled: false,
    style: {},
    textContent: "",
    title: "",
    type: "",
    addEventListener(name, listener) { listeners.set(name, listener); },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    dispatch(name) {
      const listener = listeners.get(name);
      return listener ? listener({
        preventDefault() {},
        stopPropagation() {},
        type: name,
      }) : undefined;
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
}

const context = {
  document: { createElement: createNode },
  monaco: {
    Range: class Range {
      constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
  },
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "effectCodeDiff.js" });

const Diff = context.momentumEffectCodeDiff;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(
  plain(Diff.computeLineDiff("a\nb\nc", "a\nB\nc\nd")),
  {
    greenLines: [2, 4],
    deletedLines: [],
  },
  "replacement lines and inserted lines must share the same green treatment",
);
assert.deepEqual(
  plain(Diff.computeLineDiff("completely old", "entirely new")),
  {
    greenLines: [1],
    deletedLines: [],
  },
  "even unrelated one-for-one replacements must remain a single green line",
);
assert.deepEqual(
  plain(Diff.computeLineDiff("a\nb\nc", "a\nc")),
  {
    greenLines: [],
    deletedLines: [{ afterLineNumber: 1, line: "b" }],
  },
  "a pure deletion must remain visible as a red inline row",
);
assert.deepEqual(
  plain(Diff.computeLineDiff("a\nb\nc", "a\nB")),
  {
    greenLines: [2],
    deletedLines: [{ afterLineNumber: 2, line: "c" }],
  },
  "a trailing deletion must remain below its paired green modification",
);
assert.deepEqual(
  plain(Diff.computeLineDiff("a\nb\nc", "a\nC")),
  {
    greenLines: [2],
    deletedLines: [{ afterLineNumber: 1, line: "b" }],
  },
  "line similarity must preserve a leading deletion above its green modification",
);
assert.deepEqual(
  plain(Diff.computeLineDiff(
    "a\nstart\nkeep\nend\nz",
    "a\nKEEP\nz",
  )),
  {
    greenLines: [2],
    deletedLines: [
      { afterLineNumber: 1, line: "start" },
      { afterLineNumber: 2, line: "end" },
    ],
  },
  "deletions on both sides of a modification must keep separate stable anchors",
);
assert.deepEqual(
  plain(Diff.computeLineDiff("a\n\nb", "a\nb")),
  {
    greenLines: [],
    deletedLines: [{ afterLineNumber: 1, line: "" }],
  },
  "blank-line deletions must remain in the exact raw diff",
);

const timeline = {
  baseSourceHash: "base",
  playheadTimeSeconds: 2.5,
  targetTimeSeconds: 2.5,
  cues: [
    { timeValue: 1, timeScale: 1, sourceHash: "a" },
    { timeValue: 2, timeScale: 1, sourceHash: "b" },
    { timeValue: 3, timeScale: 1, sourceHash: "c" },
  ],
};
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "b")),
  { beforeSourceHash: "a", afterSourceHash: "b" },
  "a Code cue must compare against the state immediately before it",
);
timeline.cues.reverse();
timeline.playheadTimeSeconds = 3.5;
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "c")),
  { beforeSourceHash: "b", afterSourceHash: "c" },
  "cue array order must not override the actual keyframe-time order",
);

timeline.cues = [
  { timeValue: 1, timeScale: 1, sourceHash: "a" },
  { timeValue: 4, timeScale: 1, sourceHash: "b" },
  { timeValue: 3, timeScale: 1, sourceHash: "c" },
];
timeline.playheadTimeSeconds = 4;
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "b")),
  { beforeSourceHash: "c", afterSourceHash: "b" },
  "moving a cue across another cue must immediately change its predecessor",
);

timeline.cues = [
  { timeValue: 2, timeScale: 1, sourceHash: "b" },
  { timeValue: 3, timeScale: 1, sourceHash: "c" },
];
timeline.playheadTimeSeconds = 2;
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "b")),
  { beforeSourceHash: "base", afterSourceHash: "b" },
  "deleting the first cue must promote Base Code to the next cue's predecessor",
);

timeline.cues = [
  { timeValue: 1, timeScale: 1, sourceHash: "a" },
  { timeValue: 2, timeScale: 1, sourceHash: "inserted" },
  { timeValue: 3, timeScale: 1, sourceHash: "b" },
];
timeline.playheadTimeSeconds = 3;
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "b")),
  { beforeSourceHash: "inserted", afterSourceHash: "b" },
  "inserting a cue must make it the following cue's predecessor",
);

timeline.cues = [
  { timeValue: 1, timeScale: 1, sourceHash: "same" },
  { timeValue: 2, timeScale: 1, sourceHash: "middle" },
  { timeValue: 3, timeScale: 1, sourceHash: "same" },
];
timeline.playheadTimeSeconds = 3;
assert.deepEqual(
  plain(Diff.resolveTimelinePair(timeline, "same")),
  { beforeSourceHash: "middle", afterSourceHash: "same" },
  "repeated source hashes must resolve by keyframe time rather than hash identity",
);

timeline.playheadTimeSeconds = 0.5;
assert.equal(
  Diff.resolveTimelinePair(timeline, "base"),
  null,
  "the pre-roll Base state has no earlier Code state to compare",
);

let currentModel = null;
let nextDecorationId = 1;
let nextZoneId = 1;
const zones = new Map();
const model = {
  value: "a\nB",
  decorations: [],
  deltaDecorations(_oldIds, decorations) {
    this.decorations = decorations.slice();
    return decorations.map(() => `decoration-${nextDecorationId++}`);
  },
  getLineCount() { return this.value ? this.value.split("\n").length : 1; },
  getLineMaxColumn(lineNumber) {
    return this.value.split("\n")[lineNumber - 1].length + 1;
  },
  getValue() { return this.value; },
};
currentModel = model;
const executedEdits = [];
let focusCalls = 0;
let undoStops = 0;

function getOffset(value, lineNumber, column) {
  const lines = value.split("\n");
  let offset = 0;
  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + column - 1;
}

const editor = {
  changeViewZones(callback) {
    callback({
      addZone(zone) {
        const id = `zone-${nextZoneId++}`;
        zones.set(id, zone);
        return id;
      },
      removeZone(id) { zones.delete(id); },
    });
  },
  executeEdits(sourceId, edits) {
    executedEdits.push({ sourceId, edits });
    edits.slice().reverse().forEach((edit) => {
      const startOffset = getOffset(
        model.value,
        edit.range.startLineNumber,
        edit.range.startColumn,
      );
      const endOffset = getOffset(
        model.value,
        edit.range.endLineNumber,
        edit.range.endColumn,
      );
      model.value = model.value.slice(0, startOffset) +
        edit.text + model.value.slice(endOffset);
    });
    return true;
  },
  focus() { focusCalls += 1; },
  getModel() { return currentModel; },
  getScrollLeft() { return 0; },
  getScrollTop() { return 0; },
  pushUndoStop() { undoStops += 1; },
  setScrollLeft() {},
  setScrollTop() {},
};

function getRestoreButton(zone) {
  function find(node) {
    if (!node) {
      return null;
    }
    if (node.className === "effect-code-diff-restore-button") {
      return node;
    }
    for (const child of node.children || []) {
      const match = find(child);
      if (match) {
        return match;
      }
    }
    return null;
  }
  return find(zone.domNode);
}

const controller = Diff.createController({ editor });
controller.setSources([
  { sourceHash: "base", source: "a\nb\nc" },
  { sourceHash: "cue", source: "a\nB" },
]);
controller.showTimeline({
  baseSourceHash: "base",
  playheadTimeSeconds: 1,
  cues: [{ timeValue: 1, timeScale: 1, sourceHash: "cue" }],
}, "cue", true);
assert.equal(model.decorations.length, 1);
assert.equal(model.decorations[0].range.startLineNumber, 2);
assert.equal(model.decorations[0].range.endColumn, 2);
assert.equal(
  model.decorations[0].options.inlineClassName,
  "effect-code-diff-green-line effect-code-diff-flash-added",
);
assert.equal(
  model.decorations[0].options.beforeContentClassName,
  "effect-code-diff-green-edge",
);
assert.equal(
  model.decorations[0].options.afterContentClassName,
  "effect-code-diff-green-tail",
);
assert.equal(zones.size, 1);
const deletedZone = Array.from(zones.values())[0];
assert.equal(deletedZone.afterLineNumber, 2);
assert.equal(deletedZone.heightInLines, 1);
assert.equal(deletedZone.ordinal, 1);
assert.equal(deletedZone.domNode.className, "effect-code-diff-deleted-zone");
const deletedContent = deletedZone.domNode.children[0];
assert.equal(deletedContent.className, "effect-code-diff-deleted-content");
assert.equal(
  deletedContent.children[0].className,
  "effect-code-diff-deleted-line effect-code-diff-flash-deleted",
);
assert.equal(deletedContent.children[0].textContent, "c");
assert.equal(deletedZone.suppressMouseDown, false);
const trailingRestoreButton = getRestoreButton(deletedZone);
assert.ok(trailingRestoreButton, "each red deletion line must expose one restore action");
assert.equal(
  trailingRestoreButton.getAttribute("aria-label"),
  "Restore deleted line",
);
assert.equal(trailingRestoreButton.children[0].textContent, "+");
trailingRestoreButton.dispatch("mousedown");
trailingRestoreButton.dispatch("click");
assert.equal(model.value, "a\nB\nc", "a trailing deletion must restore at EOF");
assert.equal(
  executedEdits.length,
  1,
  "mousedown and its following click must never restore the same line twice",
);
assert.equal(
  executedEdits[0].sourceId,
  "momentum.restoreDeletedEffectCodeLine",
);
assert.equal(undoStops, 2, "a restore must be isolated as one Monaco undo step");
assert.equal(focusCalls, 1, "restoring code must return focus to Monaco");

model.value = "root\nkeep";
controller.setSources([
  { sourceHash: "base", source: "root\nkeep" },
  { sourceHash: "prior", source: "root\nadded\nkeep" },
  { sourceHash: "current", source: "root\nkeep" },
]);
controller.showTimeline({
  baseSourceHash: "base",
  playheadTimeSeconds: 2,
  cues: [
    { timeValue: 2, timeScale: 1, sourceHash: "current" },
    { timeValue: 1, timeScale: 1, sourceHash: "prior" },
  ],
}, "current");
assert.equal(
  model.decorations.length,
  0,
  "a cue matching Base Code must not hide a deletion from its actual predecessor",
);
assert.equal(zones.size, 1);
const predecessorDeletion = Array.from(zones.values())[0];
assert.equal(predecessorDeletion.afterLineNumber, 1);
assert.equal(
  predecessorDeletion.domNode.children[0].children[0].textContent,
  "added",
);
getRestoreButton(predecessorDeletion).dispatch("click");
assert.equal(
  model.value,
  "root\nadded\nkeep",
  "a middle deletion must restore before its original successor",
);

model.value = "root\nkeep";
controller.setSources([
  { sourceHash: "base", source: "root\nkeep" },
  { sourceHash: "prior", source: "root\none\ntwo\nkeep" },
  { sourceHash: "current", source: "root\nkeep" },
]);
controller.showTimeline({
  baseSourceHash: "base",
  playheadTimeSeconds: 2,
  cues: [
    { timeValue: 1, timeScale: 1, sourceHash: "prior" },
    { timeValue: 2, timeScale: 1, sourceHash: "current" },
  ],
}, "current");
assert.equal(zones.size, 2, "each nonblank deleted line must own one View Zone");
const consecutiveDeletions = Array.from(zones.values()).sort(
  (left, right) => left.ordinal - right.ordinal,
);
assert.deepEqual(
  consecutiveDeletions.map(
    (zone) => zone.domNode.children[0].children[0].textContent,
  ),
  ["one", "two"],
);
getRestoreButton(consecutiveDeletions[1]).dispatch("click");
assert.equal(
  model.value,
  "root\ntwo\nkeep",
  "a line restore must not restore its neighboring deletion",
);
controller.showDraft("root\none\ntwo\nkeep", model.value);
assert.equal(zones.size, 1, "the current source must recompute the remaining deletion");
assert.equal(
  Array.from(zones.values())[0].domNode.children[0].children[0].textContent,
  "one",
);

model.value = "a\nb";
controller.showDraft("a\n\nb", model.value);
assert.equal(zones.size, 0, "a deleted blank line must not render a red row");
controller.showDraft("a\n\nremoved\nb", model.value);
assert.equal(zones.size, 1, "blank rows must not hide neighboring code deletions");
assert.equal(
  Array.from(zones.values())[0].domNode.children[0].children[0].textContent,
  "removed",
);
assert.equal(
  Array.from(zones.values())[0].domNode.children[0].children[0].className,
  "effect-code-diff-deleted-line",
  "draft deletions must not replay the timeline-switch flash",
);

model.value = "keep";
controller.setSources([
  { sourceHash: "base", source: "first\nkeep" },
  { sourceHash: "prior", source: "first\nkeep" },
  { sourceHash: "current", source: "keep" },
]);
controller.showTimeline({
  baseSourceHash: "base",
  playheadTimeSeconds: 2,
  cues: [
    { timeValue: 1, timeScale: 1, sourceHash: "prior" },
    { timeValue: 2, timeScale: 1, sourceHash: "current" },
  ],
}, "current");
const leadingDeletion = Array.from(zones.values())[0];
assert.equal(leadingDeletion.afterLineNumber, 0);
getRestoreButton(leadingDeletion).dispatch("click");
assert.equal(model.value, "first\nkeep", "a leading deletion must restore at line 1");
assert.equal(executedEdits.length, 4, "each restore must use one edit transaction");
assert.equal(undoStops, 8, "each restored line must create one independent undo step");

model.value = "changed";
controller.showDraft("original", model.value);
assert.equal(
  model.decorations[0].options.inlineClassName,
  "effect-code-diff-green-line",
  "draft additions must keep the green highlight without timeline animation",
);

controller.dispose();
assert.equal(model.decorations.length, 0);
assert.equal(zones.size, 0);

console.log("Effect Code diff highlighting: OK");

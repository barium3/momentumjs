// Computes and renders the inline red/green diff used by Effect Code.
window.momentumEffectCodeDiff = (function () {
  "use strict";

  const TIME_EPSILON = 0.000001;

  function splitLines(source) {
    const text = String(source == null ? "" : source).replace(/\r\n?/g, "\n");
    return text ? text.split("\n") : [];
  }

  function computeOperations(beforeLines, afterLines) {
    const beforeCount = beforeLines.length;
    const afterCount = afterLines.length;
    const maximumDistance = beforeCount + afterCount;
    const offset = maximumDistance + 1;
    let frontier = new Int32Array(maximumDistance * 2 + 3);
    frontier.fill(-1);
    frontier[offset + 1] = 0;
    const trace = [];

    for (let distance = 0; distance <= maximumDistance; distance += 1) {
      trace.push(frontier.slice());
      for (
        let diagonal = -distance;
        diagonal <= distance;
        diagonal += 2
      ) {
        const frontierIndex = offset + diagonal;
        let beforeIndex = 0;
        if (
          diagonal === -distance ||
          (
            diagonal !== distance &&
            frontier[frontierIndex - 1] < frontier[frontierIndex + 1]
          )
        ) {
          beforeIndex = frontier[frontierIndex + 1];
        } else {
          beforeIndex = frontier[frontierIndex - 1] + 1;
        }
        let afterIndex = beforeIndex - diagonal;
        while (
          beforeIndex < beforeCount &&
          afterIndex < afterCount &&
          beforeLines[beforeIndex] === afterLines[afterIndex]
        ) {
          beforeIndex += 1;
          afterIndex += 1;
        }
        frontier[frontierIndex] = beforeIndex;
        if (beforeIndex >= beforeCount && afterIndex >= afterCount) {
          return backtrackOperations(
            trace,
            beforeLines,
            afterLines,
            offset,
          );
        }
      }
    }
    return [];
  }

  function backtrackOperations(trace, beforeLines, afterLines, offset) {
    let beforeIndex = beforeLines.length;
    let afterIndex = afterLines.length;
    const reversed = [];

    for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
      const frontier = trace[distance];
      const diagonal = beforeIndex - afterIndex;
      let previousDiagonal = 0;
      if (
        diagonal === -distance ||
        (
          diagonal !== distance &&
          frontier[offset + diagonal - 1] <
            frontier[offset + diagonal + 1]
        )
      ) {
        previousDiagonal = diagonal + 1;
      } else {
        previousDiagonal = diagonal - 1;
      }
      const previousBeforeIndex = frontier[offset + previousDiagonal];
      const previousAfterIndex = previousBeforeIndex - previousDiagonal;

      while (
        beforeIndex > previousBeforeIndex &&
        afterIndex > previousAfterIndex
      ) {
        reversed.push({
          type: "equal",
          beforeIndex: beforeIndex - 1,
          afterIndex: afterIndex - 1,
        });
        beforeIndex -= 1;
        afterIndex -= 1;
      }
      if (distance === 0) {
        break;
      }
      if (beforeIndex === previousBeforeIndex) {
        reversed.push({
          type: "insert",
          afterIndex: afterIndex - 1,
        });
        afterIndex -= 1;
      } else {
        reversed.push({
          type: "delete",
          beforeIndex: beforeIndex - 1,
        });
        beforeIndex -= 1;
      }
    }
    return reversed.reverse();
  }

  function lineSimilarity(leftLine, rightLine) {
    const left = String(leftLine || "").trim().toLowerCase();
    const right = String(rightLine || "").trim().toLowerCase();
    if (left === right) {
      return 1;
    }
    if (!left || !right) {
      return 0;
    }
    let previous = new Uint32Array(right.length + 1);
    let current = new Uint32Array(right.length + 1);
    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = rightIndex;
    }
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      current[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const substitutionCost = left.charAt(leftIndex - 1) ===
          right.charAt(rightIndex - 1) ? 0 : 1;
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + substitutionCost,
        );
      }
      const swap = previous;
      previous = current;
      current = swap;
    }
    return 1 - previous[right.length] / Math.max(left.length, right.length);
  }

  function alignChangedLines(deletionLines, insertionLines) {
    const deletionCount = deletionLines.length;
    const insertionCount = insertionLines.length;
    if (!deletionCount) {
      return insertionLines.map(function () { return { type: "insert" }; });
    }
    if (!insertionCount) {
      return deletionLines.map(function (line) {
        return { type: "delete", line: line };
      });
    }

    if (deletionCount >= insertionCount) {
      const scores = Array.from(
        { length: deletionCount + 1 },
        function () { return new Float64Array(insertionCount + 1); },
      );
      for (let deletionIndex = 1; deletionIndex <= deletionCount; deletionIndex += 1) {
        const maximumPairs = Math.min(deletionIndex, insertionCount);
        for (let insertionIndex = 1; insertionIndex <= maximumPairs; insertionIndex += 1) {
          scores[deletionIndex][insertionIndex] = Math.max(
            scores[deletionIndex - 1][insertionIndex],
            scores[deletionIndex - 1][insertionIndex - 1] + lineSimilarity(
              deletionLines[deletionIndex - 1],
              insertionLines[insertionIndex - 1],
            ),
          );
        }
      }

      let deletionIndex = deletionCount;
      let insertionIndex = insertionCount;
      const reversed = [];
      while (deletionIndex > 0) {
        const pairScore = insertionIndex > 0
          ? scores[deletionIndex - 1][insertionIndex - 1] + lineSimilarity(
            deletionLines[deletionIndex - 1],
            insertionLines[insertionIndex - 1],
          )
          : Number.NEGATIVE_INFINITY;
        const skipScore = scores[deletionIndex - 1][insertionIndex];
        if (
          insertionIndex > 0 &&
          (deletionIndex === insertionIndex || pairScore > skipScore)
        ) {
          reversed.push({ type: "modify" });
          deletionIndex -= 1;
          insertionIndex -= 1;
        } else {
          reversed.push({
            type: "delete",
            line: deletionLines[deletionIndex - 1],
          });
          deletionIndex -= 1;
        }
      }
      return reversed.reverse();
    }

    const scores = Array.from(
      { length: insertionCount + 1 },
      function () { return new Float64Array(deletionCount + 1); },
    );
    for (let insertionIndex = 1; insertionIndex <= insertionCount; insertionIndex += 1) {
      const maximumPairs = Math.min(insertionIndex, deletionCount);
      for (let deletionIndex = 1; deletionIndex <= maximumPairs; deletionIndex += 1) {
        scores[insertionIndex][deletionIndex] = Math.max(
          scores[insertionIndex - 1][deletionIndex],
          scores[insertionIndex - 1][deletionIndex - 1] + lineSimilarity(
            deletionLines[deletionIndex - 1],
            insertionLines[insertionIndex - 1],
          ),
        );
      }
    }

    let insertionIndex = insertionCount;
    let deletionIndex = deletionCount;
    const reversed = [];
    while (insertionIndex > 0) {
      const pairScore = deletionIndex > 0
        ? scores[insertionIndex - 1][deletionIndex - 1] + lineSimilarity(
          deletionLines[deletionIndex - 1],
          insertionLines[insertionIndex - 1],
        )
        : Number.NEGATIVE_INFINITY;
      const skipScore = scores[insertionIndex - 1][deletionIndex];
      if (
        deletionIndex > 0 &&
        (insertionIndex === deletionIndex || pairScore > skipScore)
      ) {
        reversed.push({ type: "modify" });
        insertionIndex -= 1;
        deletionIndex -= 1;
      } else {
        reversed.push({ type: "insert" });
        insertionIndex -= 1;
      }
    }
    return reversed.reverse();
  }

  function computeLineDiff(beforeSource, afterSource) {
    const beforeLines = splitLines(beforeSource);
    const afterLines = splitLines(afterSource);
    const operations = computeOperations(beforeLines, afterLines);
    const greenLines = [];
    const deletedLines = [];
    let operationIndex = 0;
    let consumedAfterLines = 0;

    while (operationIndex < operations.length) {
      const operation = operations[operationIndex];
      if (operation.type === "equal") {
        consumedAfterLines += 1;
        operationIndex += 1;
        continue;
      }

      const deletionLines = [];
      const insertionLines = [];
      const insertionAnchor = consumedAfterLines;
      while (
        operationIndex < operations.length &&
        operations[operationIndex].type !== "equal"
      ) {
        const change = operations[operationIndex];
        if (change.type === "delete") {
          deletionLines.push(beforeLines[change.beforeIndex]);
        } else {
          insertionLines.push(afterLines[change.afterIndex]);
        }
        operationIndex += 1;
      }

      let hunkAfterOffset = 0;
      alignChangedLines(deletionLines, insertionLines).forEach(function (change) {
        if (change.type === "delete") {
          deletedLines.push({
            afterLineNumber: insertionAnchor + hunkAfterOffset,
            line: change.line,
          });
          return;
        }
        hunkAfterOffset += 1;
        greenLines.push(insertionAnchor + hunkAfterOffset);
      });
      consumedAfterLines += insertionLines.length;
    }

    return {
      greenLines: greenLines,
      deletedLines: deletedLines,
    };
  }

  function getSortedTimelineCues(context) {
    return (Array.isArray(context && context.cues) ? context.cues : [])
      .map(function (cue) {
        const timeValue = Number(cue && cue.timeValue);
        const timeScale = Number(cue && cue.timeScale);
        const sourceHash = String(cue && cue.sourceHash || "");
        if (
          !Number.isFinite(timeValue) ||
          !Number.isFinite(timeScale) ||
          timeScale <= 0 ||
          !sourceHash
        ) {
          return null;
        }
        return {
          sourceHash: sourceHash,
          timeSeconds: timeValue / timeScale,
        };
      })
      .filter(Boolean)
      .sort(function (left, right) {
        return left.timeSeconds - right.timeSeconds;
      });
  }

  function resolveTimelinePair(context, activeSourceHash) {
    const baseSourceHash = String(context && context.baseSourceHash || "");
    const activeHash = String(activeSourceHash || "");
    if (!context || !baseSourceHash || !activeHash) {
      return null;
    }

    const playheadTime = Number(context.playheadTimeSeconds);
    const targetTime = Number(context.targetTimeSeconds);
    const effectiveTime = Number.isFinite(playheadTime)
      ? playheadTime
      : targetTime;
    if (!Number.isFinite(effectiveTime)) {
      return null;
    }

    const cues = getSortedTimelineCues(context);
    let activeCueIndex = -1;
    for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
      if (cues[cueIndex].timeSeconds > effectiveTime + TIME_EPSILON) {
        break;
      }
      activeCueIndex = cueIndex;
    }
    if (activeCueIndex < 0) {
      return null;
    }

    const activeCue = cues[activeCueIndex];
    if (activeCue.sourceHash !== activeHash) {
      return null;
    }
    return {
      beforeSourceHash: activeCueIndex > 0
        ? cues[activeCueIndex - 1].sourceHash
        : baseSourceHash,
      afterSourceHash: activeCue.sourceHash,
    };
  }

  function createDeletedZone(deletion, restore, flash) {
    const zone = document.createElement("div");
    zone.className = "effect-code-diff-deleted-zone";
    const content = document.createElement("div");
    content.className = "effect-code-diff-deleted-content";
    const line = document.createElement("div");
    line.className = "effect-code-diff-deleted-line" +
      (flash ? " effect-code-diff-flash-deleted" : "");
    line.textContent = deletion.line;
    content.appendChild(line);

    const restoreButton = document.createElement("button");
    restoreButton.className = "effect-code-diff-restore-button";
    restoreButton.type = "button";
    restoreButton.setAttribute("aria-label", "Restore deleted line");
    const restoreIcon = document.createElement("span");
    restoreIcon.className = "effect-code-diff-restore-icon";
    restoreIcon.textContent = "+";
    restoreIcon.setAttribute("aria-hidden", "true");
    restoreButton.appendChild(restoreIcon);
    let restorationStarted = false;
    function restoreOnce(event) {
      event.preventDefault();
      event.stopPropagation();
      if (restorationStarted) {
        return;
      }
      restorationStarted = true;
      restoreButton.disabled = true;
      if (!restore()) {
        restorationStarted = false;
        restoreButton.disabled = false;
      }
    }
    restoreButton.addEventListener("mousedown", restoreOnce);
    restoreButton.addEventListener("click", restoreOnce);
    line.appendChild(restoreButton);
    zone.appendChild(content);
    return zone;
  }

  function createController(options) {
    const editor = options && options.editor;
    if (!editor) {
      throw new Error("An editor is required for Effect Code diff rendering.");
    }

    let sourceByHash = Object.create(null);
    let diffCache = Object.create(null);
    let decoratedModel = null;
    let decorationIds = [];
    let viewZoneIds = [];
    let renderKey = "";

    function removeVisuals() {
      if (
        decoratedModel &&
        decorationIds.length &&
        typeof decoratedModel.deltaDecorations === "function"
      ) {
        decoratedModel.deltaDecorations(decorationIds, []);
      }
      decorationIds = [];
      decoratedModel = null;
      if (viewZoneIds.length && typeof editor.changeViewZones === "function") {
        editor.changeViewZones(function (accessor) {
          viewZoneIds.forEach(function (zoneId) {
            accessor.removeZone(zoneId);
          });
        });
      }
      viewZoneIds = [];
    }

    function clear() {
      removeVisuals();
      renderKey = "";
    }

    function restoreDeletedLine(model, deletion) {
      if (
        editor.getModel() !== model ||
        typeof model.getValue !== "function" ||
        typeof model.getLineCount !== "function" ||
        typeof model.getLineMaxColumn !== "function" ||
        typeof editor.executeEdits !== "function"
      ) {
        return false;
      }

      const deletedLine = String(deletion && deletion.line || "");
      if (!deletedLine.trim()) {
        return false;
      }

      const source = model.getValue();
      const sourceLines = splitLines(source);
      const requestedAnchor = Number(deletion.afterLineNumber);
      const anchor = Math.max(
        0,
        Math.min(
          sourceLines.length,
          Number.isFinite(requestedAnchor) ? Math.floor(requestedAnchor) : 0,
        ),
      );
      const deletedSource = deletedLine;
      let range = null;
      let text = deletedSource;

      if (sourceLines.length && anchor < sourceLines.length) {
        const insertionLine = anchor + 1;
        range = new monaco.Range(insertionLine, 1, insertionLine, 1);
        text += "\n";
      } else if (sourceLines.length) {
        const finalLine = model.getLineCount();
        const finalColumn = model.getLineMaxColumn(finalLine);
        range = new monaco.Range(
          finalLine,
          finalColumn,
          finalLine,
          finalColumn,
        );
        text = `\n${text}`;
      } else {
        range = new monaco.Range(1, 1, 1, 1);
      }

      if (typeof editor.pushUndoStop === "function") {
        editor.pushUndoStop();
      }
      const applied = editor.executeEdits(
        "momentum.restoreDeletedEffectCodeLine",
        [{ range: range, text: text, forceMoveMarkers: true }],
      );
      if (applied === false) {
        return false;
      }
      if (typeof editor.pushUndoStop === "function") {
        editor.pushUndoStop();
      }
      if (typeof editor.focus === "function") {
        editor.focus();
      }
      return true;
    }

    function applyDiff(diff, nextRenderKey, flash) {
      if (renderKey === nextRenderKey) {
        return true;
      }
      const model = typeof editor.getModel === "function"
        ? editor.getModel()
        : null;
      if (!model) {
        clear();
        return false;
      }
      const scrollTop = typeof editor.getScrollTop === "function"
        ? editor.getScrollTop()
        : null;
      const scrollLeft = typeof editor.getScrollLeft === "function"
        ? editor.getScrollLeft()
        : null;
      const visibleRanges = typeof editor.getVisibleRanges === "function"
        ? editor.getVisibleRanges()
        : [];
      const anchorLineNumber = visibleRanges.length
        ? visibleRanges[0].startLineNumber
        : null;
      const anchorViewportOffset =
        anchorLineNumber !== null &&
        scrollTop !== null &&
        typeof editor.getTopForLineNumber === "function"
          ? editor.getTopForLineNumber(anchorLineNumber) - scrollTop
          : null;
      removeVisuals();

      if (diff.greenLines.length && typeof model.deltaDecorations === "function") {
        const maximumLineNumber = typeof model.getLineCount === "function"
          ? model.getLineCount()
          : Number.MAX_SAFE_INTEGER;
        const decorations = diff.greenLines
          .filter(function (lineNumber) {
            return lineNumber >= 1 && lineNumber <= maximumLineNumber;
          })
          .map(function (lineNumber) {
            return {
              range: new monaco.Range(
                lineNumber,
                1,
                lineNumber,
                model.getLineMaxColumn(lineNumber),
              ),
              options: {
                afterContentClassName: "effect-code-diff-green-tail",
                beforeContentClassName: "effect-code-diff-green-edge",
                inlineClassName: "effect-code-diff-green-line" +
                  (flash ? " effect-code-diff-flash-added" : ""),
              },
            };
          });
        decoratedModel = model;
        decorationIds = model.deltaDecorations([], decorations);
      }

      const visibleDeletedLines = diff.deletedLines.filter(function (deletion) {
        return String(deletion && deletion.line || "").trim().length > 0;
      });
      if (visibleDeletedLines.length && typeof editor.changeViewZones === "function") {
        const maximumLineNumber = typeof model.getLineCount === "function"
          ? model.getLineCount()
          : Number.MAX_SAFE_INTEGER;
        editor.changeViewZones(function (accessor) {
          visibleDeletedLines.forEach(function (deletion, deletionIndex) {
            viewZoneIds.push(accessor.addZone({
              afterLineNumber: Math.max(
                0,
                Math.min(maximumLineNumber, deletion.afterLineNumber),
              ),
              domNode: createDeletedZone(deletion, function () {
                return restoreDeletedLine(model, deletion);
              }, flash),
              heightInLines: 1,
              ordinal: deletionIndex + 1,
              suppressMouseDown: false,
            }));
          });
        });
      }
      renderKey = nextRenderKey;
      if (scrollTop !== null && typeof editor.setScrollTop === "function") {
        const anchoredScrollTop =
          anchorLineNumber !== null &&
          anchorViewportOffset !== null &&
          typeof editor.getTopForLineNumber === "function"
            ? editor.getTopForLineNumber(anchorLineNumber) - anchorViewportOffset
            : scrollTop;
        editor.setScrollTop(anchoredScrollTop);
      }
      if (scrollLeft !== null && typeof editor.setScrollLeft === "function") {
        editor.setScrollLeft(scrollLeft);
      }
      return true;
    }

    function getCachedDiff(beforeHash, afterHash) {
      const cacheKey = `${beforeHash}\u0000${afterHash}`;
      if (!diffCache[cacheKey]) {
        if (!(beforeHash in sourceByHash) || !(afterHash in sourceByHash)) {
          throw new Error("An Effect Code diff source is unavailable.");
        }
        diffCache[cacheKey] = computeLineDiff(
          sourceByHash[beforeHash],
          sourceByHash[afterHash],
        );
      }
      return {
        cacheKey: cacheKey,
        diff: diffCache[cacheKey],
      };
    }

    function setSources(sources) {
      sourceByHash = Object.create(null);
      diffCache = Object.create(null);
      (Array.isArray(sources) ? sources : []).forEach(function (entry) {
        const sourceHash = String(entry && entry.sourceHash || "");
        if (sourceHash) {
          sourceByHash[sourceHash] = String(entry.source == null ? "" : entry.source);
        }
      });
      renderKey = "";
    }

    function setSource(sourceHash, source) {
      const hash = String(sourceHash || "");
      if (!hash) {
        return false;
      }
      sourceByHash[hash] = String(source == null ? "" : source);
      return true;
    }

    function precomputeTimeline(context) {
      if (!context) {
        return;
      }
      const baseHash = String(context.baseSourceHash || "");
      if (!baseHash) {
        return;
      }
      let previousHash = baseHash;
      getSortedTimelineCues(context).forEach(function (cue) {
        const currentHash = cue.sourceHash;
        if (currentHash !== previousHash) {
          getCachedDiff(previousHash, currentHash);
        }
        previousHash = currentHash;
      });
    }

    function showTimeline(context, activeSourceHash, flash) {
      const pair = resolveTimelinePair(context, activeSourceHash);
      if (!pair) {
        clear();
        return false;
      }
      const cached = getCachedDiff(
        pair.beforeSourceHash,
        pair.afterSourceHash,
      );
      return applyDiff(
        cached.diff,
        `timeline:${cached.cacheKey}`,
        flash === true,
      );
    }

    function showDraft(originalSource, draftSource) {
      const before = String(originalSource == null ? "" : originalSource);
      const after = String(draftSource == null ? "" : draftSource);
      return applyDiff(
        computeLineDiff(before, after),
        `draft:${before}\u0000${after}`,
        false,
      );
    }

    function dispose() {
      clear();
      sourceByHash = Object.create(null);
      diffCache = Object.create(null);
    }

    return {
      clear: clear,
      dispose: dispose,
      precomputeTimeline: precomputeTimeline,
      setSource: setSource,
      setSources: setSources,
      showDraft: showDraft,
      showTimeline: showTimeline,
    };
  }

  return {
    computeLineDiff: computeLineDiff,
    createController: createController,
    resolveTimelinePair: resolveTimelinePair,
  };
})();

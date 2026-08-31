// Reconciles Edit Code with the native AE timeline clock.
window.momentumEffectCodeClock = (function () {
  "use strict";

  const VIEW_SAMPLE_MS = 16;
  const VIEW_RETRY_MS = 50;
  const TIMELINE_INTERVAL_MS = 100;
  const TIMELINE_RETRY_MS = 250;
  const TIME_EPSILON = 0.000001;

  function normalizeTimeline(cues) {
    if (!Array.isArray(cues)) {
      throw new Error("The Code Cue timeline is unavailable.");
    }
    const normalized = cues.map(function (cue) {
      const timeValue = Number(cue && cue.timeValue);
      const timeScale = Number(cue && cue.timeScale);
      const sourceHash = String((cue && cue.sourceHash) || "");
      if (
        !Number.isFinite(timeValue) ||
        !Number.isFinite(timeScale) ||
        timeScale <= 0 ||
        !sourceHash
      ) {
        throw new Error("The Code Cue timeline contains an invalid entry.");
      }
      return { timeValue, timeScale, sourceHash };
    });
    normalized.sort(function (left, right) {
      return left.timeValue / left.timeScale - right.timeValue / right.timeScale;
    });
    return normalized;
  }

  function parseTimeline(value) {
    const lines = String(value || "").replace(/\r/g, "").split("\n");
    if (lines[0] !== "timeline-v1") {
      throw new Error("The live Code Cue timeline has an invalid version.");
    }
    const cues = [];
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      const fields = line.split("\t");
      const timeFields = String(fields[0] || "").split("/");
      if (fields.length !== 2 || timeFields.length !== 2) {
        throw new Error("The live Code Cue timeline is malformed.");
      }
      cues.push({
        timeValue: Number(timeFields[0]),
        timeScale: Number(timeFields[1]),
        sourceHash: String(fields[1] || ""),
      });
    }
    return normalizeTimeline(cues);
  }

  function parseViewClock(value, context) {
    const fields = String(value || "").trim().split("\t");
    if (fields.length !== 6 || fields[0] !== "view-clock-v2") {
      throw new Error("The native item-view clock is malformed.");
    }
    const sessionToken = String(fields[1] || "");
    const compId = Number(fields[2]);
    const timeValue = Number(fields[4]);
    const timeScale = Number(fields[5]);
    if (
      !sessionToken ||
      !Number.isFinite(compId) ||
      compId <= 0 ||
      !Number.isFinite(timeValue) ||
      !Number.isFinite(timeScale) ||
      timeScale <= 0
    ) {
      throw new Error("The native playback clock contains an invalid sample.");
    }
    return {
      active: true,
      compId,
      duration: Number(context.duration) || 0,
      frameDuration: Number(context.frameDuration) || 0,
      previewing: fields[3] === "1",
      sessionToken,
      timeSeconds: timeValue / timeScale,
      workAreaDuration: Number(context.workAreaDuration) || 0,
      workAreaStart: Number(context.workAreaStart) || 0,
    };
  }

  function parseTimelineUpdate(value) {
    const fields = String(value == null ? "" : value).split("\t");
    if (fields[0] === "0") {
      return "";
    }
    if (fields[0] === "1" && fields.length === 2) {
      return fields[1] ? decodeURIComponent(fields[1]) : "";
    }
    throw new Error(fields.slice(1).join(" ") || "Invalid Code timeline response.");
  }

  function readCepTextFile(filePath) {
    if (
      !filePath ||
      !window.cep ||
      !window.cep.fs ||
      typeof window.cep.fs.readFile !== "function"
    ) {
      throw new Error("The native item-view clock is unavailable.");
    }
    const result = window.cep.fs.readFile(String(filePath));
    if (!result || Number(result.err) !== 0 || typeof result.data !== "string") {
      throw new Error("The native item-view clock could not be read.");
    }
    return result.data;
  }

  function createClock(options) {
    let viewFailureReported = false;
    let timelineFailureReported = false;
    let nativePreviewing = false;
    let timelineGeneration = 0;
    let timelineTimer = 0;
    let timelineInFlight = false;
    let timelineFailures = 0;
    let lastAppliedSample = null;
    let lastReadState = "";
    let lastSampleDecision = "";
    let lastPreviewState = "";

    function diagnose(stage, detail) {
      if (typeof options.diagnose === "function") {
        options.diagnose(stage, detail);
      }
    }

    function reportReadState(state, detail) {
      if (state === lastReadState) {
        return;
      }
      lastReadState = state;
      diagnose("clock-read-state", detail);
    }

    function reportSampleDecision(decision, detail) {
      if (decision === lastSampleDecision) {
        return;
      }
      lastSampleDecision = decision;
      diagnose("clock-sample-state", detail);
    }

    function isViewClockPaused() {
      const paused = options.isPaused();
      const reason = paused && typeof options.getPauseReason === "function"
        ? String(options.getPauseReason() || "paused")
        : paused
          ? "paused"
          : "";
      reportReadState(
        paused ? `paused:${reason}` : "running",
        paused ? `state=paused reason=${reason}` : "state=running",
      );
      return paused;
    }

    function resolveTarget(context, timeSeconds) {
      const cues = Array.isArray(context.cues) ? context.cues : [];
      let sourceHash = String(context.baseSourceHash || "");
      let exactCue = null;
      for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
        const cue = cues[cueIndex];
        const cueSeconds = cue.timeValue / cue.timeScale;
        if (cueSeconds > timeSeconds + TIME_EPSILON) {
          break;
        }
        sourceHash = cue.sourceHash;
        if (Math.abs(cueSeconds - timeSeconds) <= TIME_EPSILON) {
          exactCue = cue;
          break;
        }
      }
      if (!sourceHash) {
        throw new Error("The Base Code model is unavailable.");
      }
      const timeScale = exactCue
        ? exactCue.timeScale
        : Math.max(1, Number(context.clockTimeScale) || 1);
      return {
        sourceHash,
        targetMode: exactCue ? "existing-cue" : "new-cue",
        targetTimeValue: exactCue
          ? exactCue.timeValue
          : Math.round(timeSeconds * timeScale),
        targetTimeScale: timeScale,
        targetTimeSeconds: timeSeconds,
      };
    }

    function applyTimeSample(sample) {
      const context = options.getContext();
      if (!options.isActive()) {
        reportSampleDecision("inactive", "decision=rejected reason=inactive");
        return false;
      }
      if (isViewClockPaused()) {
        const reason = typeof options.getPauseReason === "function"
          ? String(options.getPauseReason() || "paused")
          : "paused";
        reportSampleDecision(
          `paused:${reason}`,
          `decision=rejected reason=${reason}`,
        );
        return false;
      }
      if (!context) {
        reportSampleDecision("missing-context", "decision=rejected reason=missing-context");
        return false;
      }
      if (!sample || sample.active !== true) {
        reportSampleDecision("inactive-sample", "decision=rejected reason=inactive-sample");
        return false;
      }
      if (sample.sessionToken !== context.sessionToken) {
        reportSampleDecision(
          `session:${sample.sessionToken}:${context.sessionToken}`,
          `decision=rejected reason=session-mismatch sample=${sample.sessionToken} context=${context.sessionToken}`,
        );
        return false;
      }
      const targetCompId = Number(context.locator && context.locator.compId);
      if (!targetCompId || sample.compId !== targetCompId) {
        reportSampleDecision(
          `comp:${sample.compId}:${targetCompId}`,
          `decision=rejected reason=comp-mismatch sample=${sample.compId} context=${targetCompId}`,
        );
        return false;
      }

      const target = resolveTarget(context, sample.timeSeconds);
      const sourceChanged = target.sourceHash !== options.getActiveModelHash();
      if (sourceChanged && !options.switchToSourceModel(target.sourceHash)) {
        throw new Error(`The Code model ${target.sourceHash} is unavailable.`);
      }
      const headerChanged = context.targetMode !== target.targetMode;
      context.sourceHash = target.sourceHash;
      context.targetMode = target.targetMode;
      context.targetTimeValue = target.targetTimeValue;
      context.targetTimeScale = target.targetTimeScale;
      context.targetTimeSeconds = target.targetTimeSeconds;
      context.playheadTimeSeconds = sample.timeSeconds;
      lastAppliedSample = sample;
      options.syncDiff(sourceChanged);
      if (typeof options.timelineSampled === "function") {
        options.timelineSampled(sample);
      }
      if (headerChanged) {
        options.updateHeader();
      }
      reportSampleDecision(
        `accepted:${context.sessionToken}`,
        `decision=accepted session=${context.sessionToken} comp=${sample.compId}`,
      );
      const previewState = `${context.sessionToken}:${sample.previewing ? 1 : 0}`;
      if (previewState !== lastPreviewState) {
        lastPreviewState = previewState;
        diagnose(
          "clock-preview-state",
          `session=${context.sessionToken} preview=${sample.previewing ? "yes" : "no"} time=${sample.timeSeconds}`,
        );
      }
      return true;
    }

    function readViewSample() {
      const context = options.getContext();
      if (!context) {
        throw new Error("The Code clock context is unavailable.");
      }
      return parseViewClock(
        readCepTextFile(context.viewClockPath),
        context,
      );
    }

    function handleViewError(error, consecutiveFailures) {
      if (consecutiveFailures < 20 || viewFailureReported) {
        return;
      }
      viewFailureReported = true;
      const message = error && error.message ? error.message : String(error);
      options.showError(`Edit Code lost its native item-view clock: ${message}`);
    }

    const viewClock = window.momentumTimelineClock.createClock({
      isActive: options.isActive,
      isPaused: isViewClockPaused,
      onError: handleViewError,
      onSample: function (sample) {
        viewFailureReported = false;
        nativePreviewing = sample.previewing;
        applyTimeSample(sample);
      },
      readSample: readViewSample,
      retryDelayMs: VIEW_RETRY_MS,
      sampleDelayMs: VIEW_SAMPLE_MS,
    });

    function applyTimelineUpdate(timelineText, sessionToken) {
      if (!timelineText) {
        return;
      }
      const context = options.getContext();
      if (
        !options.isActive() ||
        !context ||
        context.sessionToken !== sessionToken
      ) {
        return;
      }
      const nextCues = parseTimeline(timelineText);
      nextCues.forEach(function (cue) {
        if (!options.hasSourceModel(cue.sourceHash)) {
          throw new Error(
            `The live Code Cue source ${cue.sourceHash} was not preloaded.`,
          );
        }
      });
      context.cues = nextCues;
      options.timelineChanged();
      if (lastAppliedSample) {
        applyTimeSample(lastAppliedSample);
      }
    }

    function clearTimelineTimer() {
      if (timelineTimer) {
        window.clearTimeout(timelineTimer);
        timelineTimer = 0;
      }
    }

    function scheduleTimelinePoll(generation, delayMs) {
      if (generation !== timelineGeneration || !options.isActive()) {
        return;
      }
      clearTimelineTimer();
      timelineTimer = window.setTimeout(function () {
        timelineTimer = 0;
        pollTimeline(generation);
      }, Math.max(1, delayMs));
    }

    function pollTimeline(generation) {
      if (
        generation !== timelineGeneration ||
        !options.isActive() ||
        timelineInFlight
      ) {
        return;
      }
      if (nativePreviewing || options.isPaused()) {
        scheduleTimelinePoll(generation, TIMELINE_INTERVAL_MS);
        return;
      }
      const context = options.getContext();
      if (!context) {
        scheduleTimelinePoll(generation, TIMELINE_RETRY_MS);
        return;
      }
      const sessionToken = context.sessionToken;
      timelineInFlight = true;
      options.callHost("momentumReadCodeEditorTimeline", [sessionToken])
        .then(parseTimelineUpdate)
        .then(function (timelineText) {
          if (generation !== timelineGeneration) {
            return;
          }
          applyTimelineUpdate(timelineText, sessionToken);
          timelineFailures = 0;
          timelineFailureReported = false;
        })
        .catch(function (error) {
          if (generation !== timelineGeneration) {
            return;
          }
          timelineFailures += 1;
          if (timelineFailures >= 3 && !timelineFailureReported) {
            timelineFailureReported = true;
            const message = error && error.message ? error.message : String(error);
            options.showError(`Edit Code lost its Code Cue timeline: ${message}`);
          }
        })
        .then(function () {
          if (generation !== timelineGeneration) {
            return;
          }
          timelineInFlight = false;
          scheduleTimelinePoll(
            generation,
            timelineFailures > 0
              ? TIMELINE_RETRY_MS
              : TIMELINE_INTERVAL_MS,
          );
        });
    }

    function start() {
      viewFailureReported = false;
      timelineFailureReported = false;
      nativePreviewing = false;
      timelineFailures = 0;
      timelineInFlight = false;
      lastAppliedSample = null;
      lastReadState = "";
      lastSampleDecision = "";
      lastPreviewState = "";
      const generation = ++timelineGeneration;
      diagnose("clock-lifecycle", `state=start generation=${generation}`);
      viewClock.start();
      pollTimeline(generation);
    }

    function stop() {
      viewClock.stop();
      nativePreviewing = false;
      timelineGeneration += 1;
      timelineInFlight = false;
      lastAppliedSample = null;
      clearTimelineTimer();
      diagnose("clock-lifecycle", `state=stop generation=${timelineGeneration}`);
      lastReadState = "";
      lastSampleDecision = "";
      lastPreviewState = "";
    }

    return {
      normalizeTimeline,
      start,
      stop,
    };
  }

  return { createClock };
})();

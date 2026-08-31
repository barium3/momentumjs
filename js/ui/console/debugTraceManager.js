window.debugTraceManager = (function () {
  "use strict";

  const TRACE_FAST_POLL_MS = 100;
  const TRACE_MEDIUM_POLL_MS = 250;
  const TRACE_IDLE_POLL_MS = 750;
  const TIMELINE_POLL_MS = 180;

  let tracePollTimer = 0;
  let pollToken = 0;
  let activeSession = null;
  let pendingFragment = "";
  let initialized = false;
  let consecutiveIdleTracePolls = 0;
  let externalTimelineSource = false;

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    document.addEventListener("visibilitychange", () => {
      if (!activeSession) {
        return;
      }
      clearScheduledTracePoll();
      timelineClock.stop();
      if (document.hidden) {
        return;
      }
      scheduleTracePoll(0);
      if (!externalTimelineSource) {
        timelineClock.start();
      }
    });
  }

  function clearScheduledTracePoll() {
    if (tracePollTimer) {
      window.clearTimeout(tracePollTimer);
      tracePollTimer = 0;
    }
  }

  function stop() {
    pollToken += 1;
    clearScheduledTracePoll();
    timelineClock.stop();
    activeSession = null;
    pendingFragment = "";
    consecutiveIdleTracePolls = 0;
  }

  function stopAndClear() {
    stop();
    window.consoleManager.clearConsole();
  }

  function startSession(sessionInfo) {
    stop();

    const compId = Number(sessionInfo && sessionInfo.compId);
    if (!sessionInfo || !sessionInfo.filePath ||
        !Number.isFinite(compId) || compId <= 0) {
      return;
    }

    activeSession = {
      compId,
      currentFrame: 0,
      filePath: String(sessionInfo.filePath),
      frameLogs: Object.create(null),
      lastReplayedFrame: 0,
      lastReplayedSignature: "",
      offset: 0,
    };

    if (!document.hidden) {
      scheduleTracePoll(0);
      if (!externalTimelineSource) {
        timelineClock.start();
      }
    }
  }

  function scheduleTracePoll(delayMs) {
    clearScheduledTracePoll();
    if (!activeSession) {
      return;
    }
    tracePollTimer = window.setTimeout(pollActiveSessionTrace, Math.max(0, delayMs || 0));
  }

  function pollActiveSessionTrace() {
    if (!activeSession) {
      return;
    }

    if (document.hidden) {
      return;
    }

    const token = pollToken;
    const session = activeSession;
    const fileText = readTraceFile(session.filePath);
    if (!isSessionCurrent(token, session)) {
      return;
    }
    if (fileText === null) {
      consecutiveIdleTracePolls += 1;
      scheduleTracePoll(TRACE_IDLE_POLL_MS);
      return;
    }
    if (fileText.length < session.offset) {
      session.offset = 0;
      session.frameLogs = Object.create(null);
      session.lastReplayedFrame = 0;
      session.lastReplayedSignature = "";
      pendingFragment = "";
    }

    const chunkText = fileText.slice(session.offset);
    session.offset = fileText.length;
    const flushResult = flushChunk(session, chunkText);
    consecutiveIdleTracePolls = flushResult.hadLines
      ? 0
      : consecutiveIdleTracePolls + 1;

    if (flushResult.hadLines) {
      if (session.currentFrame <= 0 && flushResult.lastFrame > 0) {
        session.currentFrame = flushResult.lastFrame;
      }
      scheduleTracePoll(TRACE_FAST_POLL_MS);
      return;
    }
    scheduleTracePoll(
      consecutiveIdleTracePolls >= 4
        ? TRACE_IDLE_POLL_MS
        : TRACE_MEDIUM_POLL_MS,
    );
  }

  function isSessionCurrent(token, session) {
    return token === pollToken && !!activeSession && activeSession.filePath === session.filePath;
  }

  function readTraceFile(filePath) {
    if (
      !window.cep ||
      !window.cep.fs ||
      typeof window.cep.fs.readFile !== "function"
    ) {
      return null;
    }
    try {
      const result = window.cep.fs.readFile(String(filePath || ""));
      return result && Number(result.err) === 0 && typeof result.data === "string"
        ? result.data
        : null;
    } catch (_readTraceError) {
      return null;
    }
  }

  function parseJsonResult(rawResult) {
    try {
      return rawResult ? JSON.parse(rawResult) : null;
    } catch (_parseError) {
      return null;
    }
  }

  function readHostTimelineSample() {
    return window.momentumPluginBridge
      .callExtendScript("getActiveCompTimeInfo", [])
      .then(function (rawResult) {
        const result = parseJsonResult(rawResult);
        if (!result || result.ok !== true) {
          throw new Error("The active composition time is unavailable.");
        }
        if (result.active !== true) {
          return { active: false };
        }
        return {
          active: true,
          compId: Number(result.compId),
          duration: Number(result.duration),
          frameDuration: Number(result.frameDuration),
          timeSeconds: Number(result.timeSeconds),
          workAreaDuration: Number(result.workAreaDuration),
          workAreaStart: Number(result.workAreaStart),
        };
      });
  }

  function applyTimelineSample(sample) {
    const session = activeSession;
    if (document.hidden || !session || !sample) {
      return;
    }
    const sampleCompId = Number(sample.compId);
    if (
      !externalTimelineSource &&
      (sample.active !== true || !Number.isFinite(sampleCompId) ||
        sampleCompId !== session.compId)
    ) {
      stopAndClear();
      return;
    }
    if (sample.active !== true || !Number.isFinite(sampleCompId) ||
        sampleCompId !== session.compId) {
      return;
    }
    const frameDuration = Number(sample.frameDuration);
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) {
      return;
    }
    const currentFrame = normalizeFrameNumber(
      Math.floor(Number(sample.timeSeconds) / frameDuration) + 1,
    );
    if (currentFrame > 0 && currentFrame !== session.currentFrame) {
      session.currentFrame = currentFrame;
      replayFrameLogs(session, currentFrame);
    }
  }

  const timelineClock = window.momentumTimelineClock.createClock({
    isActive: function () {
      return !!activeSession && !externalTimelineSource && !document.hidden;
    },
    isPaused: function () {
      return document.hidden;
    },
    onSample: applyTimelineSample,
    readSample: readHostTimelineSample,
    sampleDelayMs: TIMELINE_POLL_MS,
  });

  function resetReplayCursor() {
    if (!activeSession) {
      return;
    }
    activeSession.currentFrame = 0;
    activeSession.lastReplayedFrame = 0;
    activeSession.lastReplayedSignature = "";
  }

  function useExternalClock(enabled) {
    const nextEnabled = enabled === true;
    if (externalTimelineSource === nextEnabled) {
      return;
    }
    externalTimelineSource = nextEnabled;
    timelineClock.stop();
    resetReplayCursor();
    if (!externalTimelineSource && activeSession && !document.hidden) {
      timelineClock.start();
    }
  }

  function updateTimelineSample(sample) {
    if (!externalTimelineSource) {
      return;
    }
    applyTimelineSample(sample);
  }

  function ensureSession(sessionInfo) {
    const compId = Number(sessionInfo && sessionInfo.compId);
    if (!sessionInfo || !sessionInfo.filePath ||
        !Number.isFinite(compId) || compId <= 0) {
      return false;
    }
    const filePath = String(sessionInfo.filePath);
    if (activeSession && activeSession.filePath === filePath &&
        activeSession.compId === compId) {
      return true;
    }
    startSession(sessionInfo);
    return !!activeSession;
  }

  function flushChunk(session, chunkText) {
    if (!chunkText) {
      return {
        hadLines: false,
        lastFrame: 0,
      };
    }

    const combined = pendingFragment + chunkText;
    const normalized = combined.replace(/\r\n/g, "\n");
    const endsWithNewline = /\n$/.test(normalized);
    const parts = normalized.split("\n");
    pendingFragment = endsWithNewline ? "" : parts.pop();

    let hadLines = false;
    let lastFrame = 0;

    for (let index = 0; index < parts.length; index += 1) {
      const line = parts[index];
      if (!line) {
        continue;
      }
      const parsed = parseTraceLine(line);
      if (!parsed) {
        continue;
      }
      storeTraceEntry(session, parsed);
      appendEntry(parsed);
      hadLines = true;
      if (parsed.frame > 0) {
        lastFrame = parsed.frame;
      }
    }

    return {
      hadLines,
      lastFrame,
    };
  }

  function parseTraceLine(line) {
    const text = String(line || "");
    const match = text.match(
      /^frame=(\d+)\s+time=([^\s]+)\s+level=([^\s]+)(?:\s+session=([^\s]+))?\s+message=(.*)$/,
    );
    if (!match) {
      return null;
    }

    return {
      frame: normalizeFrameNumber(match[1]),
      level: normalizeLevel(match[3]),
      text: `[f${match[1]} t${match[2]}] ${match[5]}`,
    };
  }

  function normalizeFrameNumber(frameValue) {
    const numericFrame = Number(frameValue);
    if (!Number.isFinite(numericFrame) || numericFrame <= 0) {
      return 0;
    }
    return Math.floor(numericFrame);
  }

  function normalizeLevel(level) {
    if (level === "error") {
      return "error";
    }
    if (level === "warn") {
      return "warn";
    }
    return "log";
  }

  function storeTraceEntry(session, entry) {
    const frameKey = String(entry.frame || 0);
    if (!session.frameLogs[frameKey]) {
      session.frameLogs[frameKey] = [];
    }
    session.frameLogs[frameKey].push({
      level: entry.level,
      text: entry.text,
    });
  }

  function getFrameEntries(session, frame) {
    const frameKey = String(normalizeFrameNumber(frame));
    return session.frameLogs[frameKey] || [];
  }

  function replayFrameLogs(session, frame) {
    const entries = getFrameEntries(session, frame);
    if (!entries.length) {
      return;
    }

    const signature = buildFrameSignature(entries);
    if (session.lastReplayedFrame === frame && session.lastReplayedSignature === signature) {
      return;
    }

    for (let index = 0; index < entries.length; index += 1) {
      appendExternalLine(entries[index].text, entries[index].level);
    }
    session.lastReplayedFrame = frame;
    session.lastReplayedSignature = signature;
  }

  function buildFrameSignature(entries) {
    if (!entries.length) {
      return "empty";
    }
    const lastEntry = entries[entries.length - 1];
    return `${entries.length}:${lastEntry.level}:${lastEntry.text}`;
  }

  function appendEntry(entry) {
    if (!entry || !entry.text) {
      return;
    }
    appendExternalLine(entry.text, entry.level);
  }

  function appendExternalLine(text, level) {
    window.consoleManager.appendExternalLine(text, level);
  }

  return {
    ensureSession,
    init,
    startSession,
    stop,
    stopAndClear,
    updateTimelineSample,
    useExternalClock,
  };
})();

window.debugTraceManager = (function () {
  const TRACE_FAST_POLL_MS = 250;
  const TRACE_MEDIUM_POLL_MS = 500;
  const TRACE_IDLE_POLL_MS = 1200;
  const FRAME_POLL_MS = 180;

  let tracePollTimer = 0;
  let framePollTimer = 0;
  let pollToken = 0;
  let activeSession = null;
  let pendingFragment = "";
  let initialized = false;
  let consecutiveIdleTracePolls = 0;

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
      clearScheduledFramePoll();
      if (!document.hidden) {
        scheduleTracePoll(0);
        scheduleFramePoll(0);
      }
    });
  }

  function clearScheduledTracePoll() {
    if (tracePollTimer) {
      window.clearTimeout(tracePollTimer);
      tracePollTimer = 0;
    }
  }

  function clearScheduledFramePoll() {
    if (framePollTimer) {
      window.clearTimeout(framePollTimer);
      framePollTimer = 0;
    }
  }

  function stop() {
    pollToken += 1;
    clearScheduledTracePoll();
    clearScheduledFramePoll();
    activeSession = null;
    pendingFragment = "";
    consecutiveIdleTracePolls = 0;
  }

  function startSession(sessionInfo) {
    stop();

    if (!sessionInfo || !sessionInfo.filePath) {
      return;
    }

    activeSession = {
      compName: sessionInfo.compName ? String(sessionInfo.compName) : "",
      currentFrame: 0,
      filePath: String(sessionInfo.filePath),
      frameLogs: Object.create(null),
      lastReplayedFrame: 0,
      lastReplayedSignature: "",
      offset: 0,
      sessionId: sessionInfo.sessionId ? String(sessionInfo.sessionId) : "",
    };

    if (!document.hidden) {
      scheduleTracePoll(0);
      scheduleFramePoll(0);
    }
  }

  function scheduleTracePoll(delayMs) {
    clearScheduledTracePoll();
    if (!activeSession) {
      return;
    }
    tracePollTimer = window.setTimeout(pollActiveSessionTrace, Math.max(0, delayMs || 0));
  }

  function scheduleFramePoll(delayMs) {
    clearScheduledFramePoll();
    if (!activeSession) {
      return;
    }
    framePollTimer = window.setTimeout(pollActiveTimelineFrame, Math.max(0, delayMs || 0));
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

    window.momentumPluginBridge
      .callExtendScript("readFileSegment", [session.filePath, String(session.offset)])
      .then((rawResult) => {
        if (!isSessionCurrent(token, session)) {
          return;
        }

        const result = parseJsonResult(rawResult);
        if (!result || result.ok !== true) {
          consecutiveIdleTracePolls += 1;
          scheduleTracePoll(TRACE_IDLE_POLL_MS);
          return;
        }

        if (result.exists !== true) {
          consecutiveIdleTracePolls += 1;
          scheduleTracePoll(TRACE_MEDIUM_POLL_MS);
          return;
        }

        if (typeof result.startOffset === "number" && result.startOffset === 0 && session.offset > 0) {
          pendingFragment = "";
        }

        const chunkText = typeof result.text === "string" ? result.text : "";
        session.offset =
          typeof result.nextOffset === "number"
            ? result.nextOffset
            : session.offset + chunkText.length;

        const flushResult = flushChunk(session, chunkText);
        consecutiveIdleTracePolls = flushResult.hadLines ? 0 : consecutiveIdleTracePolls + 1;

        if (flushResult.hadLines) {
          if (session.currentFrame <= 0 && flushResult.lastFrame > 0) {
            session.currentFrame = flushResult.lastFrame;
          }
          scheduleTracePoll(TRACE_FAST_POLL_MS);
          return;
        }

        scheduleTracePoll(consecutiveIdleTracePolls >= 4 ? TRACE_IDLE_POLL_MS : TRACE_MEDIUM_POLL_MS);
      })
      .catch(() => {
        if (!isSessionCurrent(token, session)) {
          return;
        }
        consecutiveIdleTracePolls += 1;
        scheduleTracePoll(TRACE_IDLE_POLL_MS);
      });
  }

  function pollActiveTimelineFrame() {
    if (!activeSession) {
      return;
    }

    if (document.hidden) {
      return;
    }

    const token = pollToken;
    const session = activeSession;

    window.momentumPluginBridge
      .callExtendScript("getActiveCompTimeInfo", [])
      .then((rawResult) => {
        if (!isSessionCurrent(token, session)) {
          return;
        }

        const result = parseJsonResult(rawResult);
        if (!result || result.ok !== true) {
          scheduleFramePoll(FRAME_POLL_MS);
          return;
        }

        if (result.active !== true) {
          scheduleFramePoll(FRAME_POLL_MS);
          return;
        }

        const compName = result.compName ? String(result.compName) : "";
        if (session.compName && compName && session.compName !== compName) {
          scheduleFramePoll(FRAME_POLL_MS);
          return;
        }

        const currentFrame = normalizeFrameNumber(result.currentFrame);
        if (currentFrame > 0 && currentFrame !== session.currentFrame) {
          session.currentFrame = currentFrame;
          replayFrameLogs(session, currentFrame);
        }

        scheduleFramePoll(FRAME_POLL_MS);
      })
      .catch(() => {
        if (!isSessionCurrent(token, session)) {
          return;
        }
        scheduleFramePoll(FRAME_POLL_MS);
      });
  }

  function isSessionCurrent(token, session) {
    return token === pollToken && !!activeSession && activeSession.filePath === session.filePath;
  }

  function parseJsonResult(rawResult) {
    try {
      return rawResult ? JSON.parse(rawResult) : null;
    } catch (_parseError) {
      return null;
    }
  }

  function flushChunk(session, chunkText) {
    if (!chunkText) {
      return {
        changedFrames: Object.create(null),
        hadLines: false,
        lastFrame: 0,
      };
    }

    const combined = pendingFragment + chunkText;
    const normalized = combined.replace(/\r\n/g, "\n");
    const endsWithNewline = /\n$/.test(normalized);
    const parts = normalized.split("\n");
    pendingFragment = endsWithNewline ? "" : parts.pop();

    const changedFrames = Object.create(null);
    let hadLines = false;
    let lastFrame = 0;

    for (let index = 0; index < parts.length; index += 1) {
      const line = parts[index];
      if (!line) {
        continue;
      }
      const parsed = parseTraceLine(line);
      storeTraceEntry(session, parsed);
      appendEntry(parsed);
      hadLines = true;
      if (parsed.frame > 0) {
        changedFrames[String(parsed.frame)] = true;
        lastFrame = parsed.frame;
      }
    }

    return {
      changedFrames,
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
      return {
        frame: 0,
        level: "log",
        text,
      };
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
    if (
      window.consoleManager &&
      typeof window.consoleManager.appendExternalLine === "function"
    ) {
      window.consoleManager.appendExternalLine(text, level);
      return;
    }

    const output = document.getElementById("console-output");
    if (output) {
      const line = document.createElement("div");
      line.className = "console-line";
      line.textContent = String(text == null ? "" : text);
      output.appendChild(line);
      output.scrollTop = output.scrollHeight;
    }
  }

  init();

  return {
    startSession,
    stop,
  };
})();

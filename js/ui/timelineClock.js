// Runs one serialized timeline reader without overlapping samples.
window.momentumTimelineClock = (function () {
  "use strict";

  const DEFAULT_SAMPLE_DELAY_MS = 16;
  const DEFAULT_RETRY_DELAY_MS = 100;

  function normalizeSample(value) {
    const sample = value || {};
    if (sample.active === false) {
      return { active: false };
    }
    const timeSeconds = Number(sample.timeSeconds);
    if (!Number.isFinite(timeSeconds)) {
      throw new Error("The timeline clock returned an invalid time.");
    }
    return Object.assign({}, sample, {
      active: true,
      timeSeconds,
    });
  }

  function createClock(options) {
    const clockOptions = options || {};
    const sampleDelayMs = Math.max(
      1,
      Number(clockOptions.sampleDelayMs) || DEFAULT_SAMPLE_DELAY_MS,
    );
    const retryDelayMs = Math.max(
      1,
      Number(clockOptions.retryDelayMs) || DEFAULT_RETRY_DELAY_MS,
    );

    let generation = 0;
    let state = null;
    let sampleTimer = 0;

    function clearSampleTimer() {
      if (sampleTimer) {
        window.clearTimeout(sampleTimer);
        sampleTimer = 0;
      }
    }

    function isCurrent(clockState) {
      return !!(
        clockState &&
        state === clockState &&
        clockState.generation === generation
      );
    }

    function scheduleSample(clockState, delayMs) {
      if (!isCurrent(clockState)) {
        return;
      }
      clearSampleTimer();
      sampleTimer = window.setTimeout(function () {
        sampleTimer = 0;
        requestSample(clockState);
      }, Math.max(1, delayMs));
    }

    function requestSample(clockState) {
      if (!isCurrent(clockState) || clockState.inFlight) {
        return;
      }
      if (!clockOptions.isActive() || clockOptions.isPaused()) {
        scheduleSample(clockState, sampleDelayMs);
        return;
      }

      clockState.inFlight = Promise.resolve().then(function () {
        return clockOptions.readSample();
      });
      clockState.inFlight
        .then(normalizeSample)
        .then(function (sample) {
          if (!isCurrent(clockState)) {
            return;
          }
          clockState.consecutiveFailures = 0;
          clockOptions.onSample(sample);
        })
        .catch(function (error) {
          if (!isCurrent(clockState)) {
            return;
          }
          clockState.consecutiveFailures += 1;
          if (typeof clockOptions.onError === "function") {
            clockOptions.onError(error, clockState.consecutiveFailures);
          }
        })
        .then(function () {
          if (!isCurrent(clockState)) {
            return;
          }
          clockState.inFlight = null;
          scheduleSample(
            clockState,
            clockState.consecutiveFailures > 0
              ? retryDelayMs
              : sampleDelayMs,
          );
        });
    }

    function start() {
      if (state) {
        return;
      }
      state = {
        consecutiveFailures: 0,
        generation: ++generation,
        inFlight: null,
      };
      requestSample(state);
    }

    function stop() {
      state = null;
      generation += 1;
      clearSampleTimer();
    }

    return { start, stop };
  }

  return { createClock };
})();

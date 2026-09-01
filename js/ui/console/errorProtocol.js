// Normalizes errors crossing CEP, ExtendScript, and native runtime boundaries.
window.momentumErrors = (function () {
  "use strict";

  const HOST_UNAVAILABLE_PATTERN =
    /EvalScript error\.|engineAllocationFailure|PlugPlugErrorCode_engineAllocationFailure/i;

  function create(code, message, options) {
    const details = options || {};
    const error = new Error(message || "Momentum operation failed.");
    error.code = String(code || "MOMENTUM_ERROR");
    error.stage = details.stage ? String(details.stage) : "";
    error.path = details.path ? String(details.path) : "";
    error.platform = details.platform ? String(details.platform) : "";
    error.retryable = details.retryable === true;
    error.details = details.details || null;
    if (details.cause !== undefined) {
      error.cause = details.cause;
    }
    return error;
  }

  function firstText(values) {
    for (let index = 0; index < values.length; index += 1) {
      if (typeof values[index] === "string" && values[index].trim()) {
        return values[index].trim();
      }
    }
    return "";
  }

  function getNestedError(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    if (value.error && value.error !== value) {
      return value.error;
    }
    if (value.reason && value.reason !== value) {
      return value.reason;
    }
    return null;
  }

  function getObjectName(value) {
    if (!value || typeof value !== "object") {
      return "Error";
    }
    if (typeof value.name === "string" && value.name) {
      return value.name;
    }
    if (
      value.constructor &&
      typeof value.constructor.name === "string" &&
      value.constructor.name &&
      value.constructor.name !== "Object"
    ) {
      return value.constructor.name;
    }
    return "Error";
  }

  function normalize(value, defaults) {
    const fallback = defaults || {};
    const nested = getNestedError(value);
    const source = nested || value;
    const sourceObject = source && typeof source === "object" ? source : null;
    const eventType = sourceObject && typeof sourceObject.type === "string"
      ? sourceObject.type
      : "";
    const eventTarget = sourceObject && sourceObject.target &&
        typeof sourceObject.target === "object"
      ? sourceObject.target
      : null;
    const inferredPath = firstText([
      sourceObject && sourceObject.path,
      sourceObject && sourceObject.fileName,
      eventTarget && eventTarget.currentSrc,
      eventTarget && eventTarget.src,
    ]);
    let message = firstText([
      sourceObject && sourceObject.message,
      typeof source === "string" ? source : "",
      value && value !== source && value.message,
      fallback.message,
    ]);

    if (!message && eventType) {
      message = eventType.toLowerCase() === "error" && inferredPath
        ? `Failed to load resource: ${inferredPath}`
        : `${eventType} event`;
    }
    if (!message) {
      message = sourceObject
        ? `${getObjectName(sourceObject)} reported as an error`
        : "Momentum operation failed.";
    }

    const code = firstText([
      sourceObject && sourceObject.code,
      value && value !== source && value.code,
      fallback.code,
      "MOMENTUM_ERROR",
    ]);
    const stage = firstText([
      sourceObject && sourceObject.stage,
      fallback.stage,
    ]);
    const path = firstText([
      inferredPath,
      fallback.path,
    ]);
    const platform = firstText([
      sourceObject && sourceObject.platform,
      fallback.platform,
    ]);
    const stack = firstText([
      sourceObject && sourceObject.stack,
      fallback.stack,
    ]);

    return {
      name: getObjectName(sourceObject),
      code,
      message,
      stage,
      path,
      platform,
      retryable:
        sourceObject && typeof sourceObject.retryable === "boolean"
          ? sourceObject.retryable
          : fallback.retryable === true,
      stack,
      details: sourceObject || value || null,
    };
  }

  function format(value, fallbackMessage) {
    const normalized = normalize(value, { message: fallbackMessage || "" });
    const codePrefix = normalized.code && normalized.code !== "MOMENTUM_ERROR"
      ? `[${normalized.code}] `
      : "";
    return codePrefix + normalized.message;
  }

  function isHostUnavailableResult(value) {
    return HOST_UNAVAILABLE_PATTERN.test(String(value == null ? "" : value));
  }

  return {
    create,
    format,
    isHostUnavailableResult,
    normalize,
  };
})();

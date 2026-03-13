// Environment helpers.

/**
 * Extract createCanvas() dimensions.
 */
function extractSizeParams(code) {
  var sizePattern = /createCanvas\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/;
  var match = code.match(sizePattern);
  if (match) {
    return { width: parseInt(match[1]), height: parseInt(match[2]) };
  }
  return null;
}

/**
 * Extract frameRate().
 */
function extractFrameRateParam(code) {
  var frameRatePattern = /frameRate\s*\(\s*(\d+)\s*\)/;
  var match = code.match(frameRatePattern);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

function _parseDurationTimecode(value, fps) {
  var parts = String(value || "").split(":");
  if (parts.length !== 3 && parts.length !== 4) return null;

  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return null;
    nums.push(parseInt(parts[i], 10));
  }

  var hh = 0;
  var mm = 0;
  var ss = 0;
  var ff = 0;

  if (nums.length === 3) {
    mm = nums[0];
    ss = nums[1];
    ff = nums[2];
  } else {
    hh = nums[0];
    mm = nums[1];
    ss = nums[2];
    ff = nums[3];
  }

  if (ss >= 60 || mm >= 60 || ff >= fps) return null;
  return hh * 3600 + mm * 60 + ss + ff / fps;
}

function _parseDurationCall(match, fps) {
  if (!match || !match[1]) return null;

  var rawArgs = match[1].replace(/^\s+|\s+$/g, "");
  if (!rawArgs) return null;

  if (
    (rawArgs.charAt(0) === '"' && rawArgs.charAt(rawArgs.length - 1) === '"') ||
    (rawArgs.charAt(0) === "'" && rawArgs.charAt(rawArgs.length - 1) === "'")
  ) {
    return _parseDurationTimecode(rawArgs.slice(1, -1), fps);
  }

  var parts = rawArgs.split(",");
  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].replace(/^\s+|\s+$/g, "");
    if (!/^\d+(?:\.\d+)?$/.test(part)) return null;
    nums.push(Number(part));
  }

  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] + nums[1] / fps;
  if (nums.length === 3) return nums[0] * 60 + nums[1] + nums[2] / fps;
  if (nums.length === 4)
    return nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps;

  return null;
}

function extractDurationParam(code, fps) {
  var durationPattern = /duration\s*\(\s*([^)]*?)\s*\)/;
  var match = code.match(durationPattern);
  if (!match) return null;
  var seconds = _parseDurationCall(match, fps || 30);
  return seconds && seconds > 0 ? seconds : null;
}

/**
 * Extract the filename hint from source.
 */
function extractFileNameFromCode(code, defaultName) {
  var fileNamePattern = /\/\/\s*@filename[:\s]*([^\n]+)/;
  var match = code.match(fileNamePattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return defaultName || "Untitled";
}

/**
 * Build environment config from source.
 */
function extractEnvironmentConfig(
  setupCode,
  compName,
  defaultWidth,
  defaultHeight,
  defaultFrameRate
) {
  var sizeParams = extractSizeParams(setupCode || "");
  var frameRateValue = extractFrameRateParam(setupCode || "");
  var resolvedFrameRate = frameRateValue || defaultFrameRate || 30;
  var durationValue = extractDurationParam(setupCode || "", resolvedFrameRate);

  return {
    name: compName || "New Composition",
    width: sizeParams ? sizeParams.width : defaultWidth || 100,
    height: sizeParams ? sizeParams.height : defaultHeight || 100,
    frameRate: resolvedFrameRate,
    duration: durationValue || 10,
    sizeParams: sizeParams,
    frameRateValue: frameRateValue,
    durationValue: durationValue
  };
}

/**
 * Remove config-only calls from runtime code.
 */
function removeConfigFunctions(code) {
  code = code.replace(/createCanvas\s*\([^)]*\)\s*;?/g, "");
  code = code.replace(/frameRate\s*\([^)]*\)\s*;?/g, "");
  code = code.replace(/duration\s*\([^)]*\)\s*;?/g, "");
  return code;
}

// Environment variables.

/**
 * Environment globals.
 */
var frameCount;
var width;
var height;

/**
 * Return environment variable mappings.
 */
function getEnvironmentVariableMapping() {
  return {
    frameCount: "currentFrame",
    width: "width",
    height: "height"
  };
}

/**
 * Build environment helpers for expressions.
 */
function getEnvironmentLib(deps) {
  if (!deps) return "";

  var lib = [];
  var hasAny = false;
  for (var key in deps) {
    if (deps.hasOwnProperty(key) && deps[key]) {
      hasAny = true;
      break;
    }
  }

  if (!hasAny) return "";

  lib.push("// ===== Environment Variables =====");
  if (deps.width) {
    lib.push("const width = thisComp.width;");
  }
  if (deps.height) {
    lib.push("const height = thisComp.height;");
  }
  if (deps.frameCount) {
    lib.push("var frameCount = currentFrame;");
  }
  if (deps.isLooping) {
    lib.push("function isLooping() { return _ctx._looping !== false; }");
  }
  if (deps.loop) {
    lib.push("function loop() { _ctx._looping = true; }");
  }
  if (deps.noLoop) {
    lib.push("function noLoop() { _ctx._looping = false; }");
  }
  if (deps.redraw) {
    lib.push("function redraw() { _ctx._redrawRequested = true; }");
  }

  return lib.join("\n");
}

// Echo effect.

/**
 * Add the echo effect used by draw playback.
 */
function addEchoEffect(
  drawLayer,
  engineComp,
  uniqueMainCompName,
  drawBackgroundCount
) {
  try {
    var effectParade = drawLayer.property("ADBE Effect Parade");

    if (effectParade) {
      var echoEffect = effectParade.addProperty("ADBE Echo");

      if (echoEffect) {
        var propCount = echoEffect.numProperties;
        var echoTimeProp = null;
        var numEchoesProp = null;
        var startingIntensityProp = null;
        var decayProp = null;
        var compositeOperatorProp = null;

        if (propCount >= 1) {
          try {
            echoTimeProp = echoEffect.property(1);
          } catch (e) {}
        }

        if (propCount >= 2) {
          try {
            numEchoesProp = echoEffect.property(2);
          } catch (e) {}
        }

        if (propCount >= 3) {
          try {
            startingIntensityProp = echoEffect.property(3);
          } catch (e) {}
        }

        if (propCount >= 4) {
          try {
            decayProp = echoEffect.property(4);
          } catch (e) {}
        }

        if (propCount >= 5) {
          try {
            compositeOperatorProp = echoEffect.property(5);
          } catch (e) {}
        }

        if (numEchoesProp) {
          var escapedMainCompNameForEcho = uniqueMainCompName.replace(
            /"/g,
            '\\"'
          );
          var drawBgCountForEcho = drawBackgroundCount || 0;
          var numEchoesExprLines = [
            'var raw = comp("' +
              escapedMainCompNameForEcho +
              '").layer("__engine__").text.sourceText;',
            "var json = raw && raw.toString ? raw.toString() : raw;",
            "var data = JSON.parse(json);",
            "var backgrounds = data.backgrounds || [];",
            "var drawBgCount = " + drawBgCountForEcho + ";",
            "var lastDrawBg = null;",
            "if (drawBgCount > 0 && backgrounds.length > 0) {",
            "  var startIndex = Math.max(0, backgrounds.length - drawBgCount);",
            "  for (var i = backgrounds.length - 1; i >= startIndex; i--) {",
            "    if (backgrounds[i] && backgrounds[i].color && backgrounds[i].color.length >= 4) {",
            "      lastDrawBg = backgrounds[i];",
            "      break;",
            "    }",
            "  }",
            "}",
            "if (lastDrawBg && lastDrawBg.explicitAlpha === false) {",
            "  0;",
            "} else {",
            "  timeToFrames(time);",
            "}"
          ];
          numEchoesProp.expression = numEchoesExprLines.join("\n");
        }

        if (startingIntensityProp) {
          try {
            startingIntensityProp.setValue(1);
          } catch (e4) {}
        }

        if (decayProp) {
          var escapedMainCompNameForDecay = uniqueMainCompName.replace(
            /"/g,
            '\\"'
          );
          var drawBgCount = drawBackgroundCount || 0;
          var decayExpr = [
            'var raw = comp("' +
              escapedMainCompNameForDecay +
              '").layer("__engine__").text.sourceText;',
            "// ===== Echo Decay =====",
            "var json = raw && raw.toString ? raw.toString() : raw;",
            "var data = JSON.parse(json);",
            "var backgrounds = data.backgrounds || [];",
            "var alpha = 0;",
            "var drawBgCount = " + drawBgCount + ";",
            "if (drawBgCount > 0 && backgrounds.length > 0) {",
            "  var lastDrawBg = null;",
            "  var startIndex = Math.max(0, backgrounds.length - drawBgCount);",
            "  for (var i = backgrounds.length - 1; i >= startIndex; i--) {",
            "    if (backgrounds[i] && backgrounds[i].color && backgrounds[i].color.length >= 4) {",
            "      lastDrawBg = backgrounds[i];",
            "      break;",
            "    }",
            "  }",
            "  if (lastDrawBg) {",
            "    alpha = lastDrawBg.color[3] !== undefined ? lastDrawBg.color[3] : 1;",
            "    if (lastDrawBg.explicitAlpha === false) {",
            "      alpha = 1;",
            "    }",
            "  }",
            "}",
            "1 - alpha"
          ].join("\n");

          decayProp.expression = decayExpr;
        }

        var escapedMainCompName = uniqueMainCompName.replace(/"/g, '\\"');
        var echoTimeExpr = '-comp("' + escapedMainCompName + '").frameDuration';

        if (echoTimeProp) {
          echoTimeProp.expression = echoTimeExpr;
        }

        if (compositeOperatorProp) {
          compositeOperatorProp.setValue(6);
        }
      }
    }
  } catch (e) {}
}

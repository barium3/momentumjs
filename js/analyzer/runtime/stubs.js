// Lightweight browser-side stubs for custom Momentum helpers.
(function (window) {
  "use strict";

  function markStub(name) {
    if (!window.__momentumStubs) {
      window.__momentumStubs = {};
    }
    window.__momentumStubs[name] = true;
  }

  function installMomentumStubs(options) {
    options = options || {};
    var mode = options.mode || "execution";

    if (typeof window.duration === "undefined") {
      window.duration = function () {};
      markStub("duration");
    }

    if (typeof window.createPoint === "undefined") {
      window.createPoint = function (defaultX, defaultY) {
        var x = defaultX === undefined ? 0 : defaultX;
        var y = defaultY === undefined ? 0 : defaultY;

        return {
          value: function () {
            return [x, y];
          },
          x: function () {
            return x;
          },
          y: function () {
            return y;
          },
        };
      };
      markStub("createPoint");
    }

    if (typeof window.createSlider === "undefined") {
      window.createSlider = function (min, max, value, step) {
        var sliderMin = min === undefined ? 0 : Number(min);
        var sliderMax = max === undefined ? 100 : Number(max);
        var sliderValue = value === undefined ? sliderMin : Number(value);
        var sliderStep = step === undefined ? 0 : Number(step);

        function clampAndSnap(nextValue) {
          var mapped = Number(nextValue);
          if (!(mapped === mapped)) mapped = sliderValue;
          if (mapped < sliderMin) mapped = sliderMin;
          if (mapped > sliderMax) mapped = sliderMax;
          if (sliderStep > 0) {
            mapped = Math.floor((mapped - sliderMin) / sliderStep) * sliderStep + sliderMin;
            if (mapped < sliderMin) mapped = sliderMin;
            if (mapped > sliderMax) mapped = sliderMax;
          }
          return mapped;
        }

        return {
          value: function () {
            return clampAndSnap(sliderValue);
          },
        };
      };
      markStub("createSlider");
    }

    if (typeof window.createAngle === "undefined") {
      window.createAngle = function (defaultDegrees) {
        var deg = defaultDegrees === undefined ? 0 : defaultDegrees;

        return {
          value: function () {
            return deg;
          },
          degrees: function () {
            return deg;
          },
          radians: function () {
            return (deg * Math.PI) / 180;
          },
        };
      };
      markStub("createAngle");
    }

    if (typeof window.createColorPicker === "undefined") {
      window.createColorPicker = function (r, g, b, a) {
        function normalizeColorArray(input) {
          if (typeof input === "string") {
            var text = input.replace(/^#/, "");
            if (text.length === 3 || text.length === 4) {
              var expanded = "";
              for (var ti = 0; ti < text.length; ti += 1) {
                expanded += text.charAt(ti) + text.charAt(ti);
              }
              text = expanded;
            }
            if (text.length === 6 || text.length === 8) {
              var red = parseInt(text.substring(0, 2), 16);
              var green = parseInt(text.substring(2, 4), 16);
              var blue = parseInt(text.substring(4, 6), 16);
              var alpha = text.length === 8 ? parseInt(text.substring(6, 8), 16) : 255;
              return [red / 255, green / 255, blue / 255, alpha / 255];
            }
          }
          if (input instanceof Array && input.length >= 3) {
            var raw = [
              Number(input[0]),
              Number(input[1]),
              Number(input[2]),
              input.length >= 4 ? Number(input[3]) : 1,
            ];
            var use255Scale = false;
            for (var ri = 0; ri < raw.length; ri += 1) {
              if (raw[ri] > 1) {
                use255Scale = true;
                break;
              }
            }
            var divisor = use255Scale ? 255 : 1;
            return [
              Math.max(0, Math.min(1, (isFinite(raw[0]) ? raw[0] : 1) / divisor)),
              Math.max(0, Math.min(1, (isFinite(raw[1]) ? raw[1] : 1) / divisor)),
              Math.max(0, Math.min(1, (isFinite(raw[2]) ? raw[2] : 1) / divisor)),
              Math.max(0, Math.min(1, (isFinite(raw[3]) ? raw[3] : 1) / divisor)),
            ];
          }
          return [1, 1, 1, 1];
        }

        function colorArrayToHex(colorArray) {
          var color = normalizeColorArray(colorArray);
          function channelToHex(value) {
            var channel = Math.round(Math.max(0, Math.min(1, value)) * 255);
            return (channel < 16 ? "0" : "") + channel.toString(16);
          }
          var hex = "#" + channelToHex(color[0]) + channelToHex(color[1]) + channelToHex(color[2]);
          var alpha = Math.round(Math.max(0, Math.min(1, color[3])) * 255);
          if (alpha < 255) {
            hex += (alpha < 16 ? "0" : "") + alpha.toString(16);
          }
          return hex;
        }

        var colorValue;
        if (arguments.length === 1) {
          colorValue = normalizeColorArray(r);
        } else if (arguments.length >= 3) {
          colorValue = normalizeColorArray([r, g, b, a === undefined ? 255 : a]);
        } else {
          colorValue = [1, 1, 1, 1];
        }

        return {
          color: function () {
            if (typeof window.color === "function") {
              return window.color(this.value());
            }
            return colorValue.slice();
          },
          value: function () {
            return colorArrayToHex(colorValue);
          },
        };
      };
      markStub("createColorPicker");
    }

    if (typeof window.createCheckbox === "undefined") {
      window.createCheckbox = function (label, checked) {
        var isChecked = !!checked;
        return {
          value: function () {
            return isChecked;
          },
          checked: function () {
            return isChecked;
          },
        };
      };
      markStub("createCheckbox");
    }

    if (typeof window.createSelect === "undefined") {
      window.createSelect = function () {
        var options = [];
        var defaultIndex = 0;

        function clampIndex(value) {
          var length = options.length > 0 ? options.length : 1;
          var index = Math.round(Number(value) || 0);
          if (index < 0) index = 0;
          if (index > length - 1) index = length - 1;
          return index;
        }

        return {
          option: function (label, value) {
            options.push(arguments.length >= 2 ? value : label);
            defaultIndex = clampIndex(defaultIndex);
            return this;
          },
          index: function () {
            defaultIndex = clampIndex(defaultIndex);
            return defaultIndex;
          },
          value: function () {
            var index = this.index();
            if (index < 0 || index >= options.length) {
              return null;
            }
            return options[index];
          },
          selected: function (value) {
            if (arguments.length === 0) {
              return this.value();
            }
            if (typeof value === "number" && isFinite(value)) {
              defaultIndex = clampIndex(value);
              return this;
            }
            for (var optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
              if (options[optionIndex] === value) {
                defaultIndex = clampIndex(optionIndex);
                return this;
              }
            }
            defaultIndex = 0;
            return this;
          },
        };
      };
      markStub("createSelect");
    }

    if (typeof window.image === "undefined") {
      window.image = function () {};
      markStub("image");
    }

    if (typeof window.imageMode === "undefined") {
      window.imageMode = function () {};
      markStub("imageMode");
    }

    if (typeof window.tint === "undefined") {
      window.tint = function () {};
      markStub("tint");
    }
    if (typeof window.noTint === "undefined") {
      window.noTint = function () {};
      markStub("noTint");
    }

    if (typeof window.preload === "undefined") {
      window.preload = function () {};
      markStub("preload");
    }

    if (mode !== "execution" || typeof window.loadImage === "undefined") {
      window.loadImage = function (path) {
        var varName = path
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1");

        if (
          window.__momentumLoadedImages &&
          window.__momentumLoadedImages[path]
        ) {
          return window.__momentumLoadedImages[path];
        }

        if (window[varName]) {
          return window[varName];
        }

        var img = {
          width: 0,
          height: 0,
          _momentumPath: path,
          _momentumResolvedUrl: null,
          _momentumFullPath: null,
          _momentumReady: false,
          _placeholder: true,
          get: function (x, y, w, h) {
            if (arguments.length >= 4) {
              return {
                width: Math.max(0, Math.floor(Number(w) || 0)),
                height: Math.max(0, Math.floor(Number(h) || 0)),
                _momentumPath: path,
                _momentumResolvedUrl: null,
                _momentumFullPath: null,
                _momentumReady: false,
                _placeholder: true,
                get: function () {
                  return [0, 0, 0, 0];
                },
              };
            }
            return [0, 0, 0, 0];
          },
        };
        return img;
      };
      markStub("loadImage");
    }
  }

  window.installMomentumStubs = installMomentumStubs;
})(window);

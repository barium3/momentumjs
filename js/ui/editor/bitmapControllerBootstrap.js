// Discovers bitmap Controller declarations in an isolated temporary p5 runtime.
window.momentumBitmapControllerBootstrap = (function () {
  const controllerCollection = window.compilerControllerCollectionPass;
  const BITMAP_CONTROLLER_CALLSITE_PREFIX = controllerCollection.callsitePrefix;

  function createService(options) {
    const {
      absolutizeBitmapAssetCalls,
      buildExecutionPlan,
      getCompiler,
    } = options;

    function getP5RuntimeFunction(p, funcName) {
      const p5Proto =
        p && p.constructor && p.constructor.prototype
          ? p.constructor.prototype
          : typeof p5 !== "undefined" && p5.prototype
            ? p5.prototype
            : null;

      let original = p5Proto && typeof p5Proto[funcName] === "function"
        ? p5Proto[funcName]
        : null;

      if (!original && p && typeof p[funcName] === "function") {
        original = p[funcName];
      }

      return typeof original === "function" ? original : null;
    }

    function createWindowBindingSession(targetWindow) {
      const descriptors = {};

      function remember(name) {
        if (Object.prototype.hasOwnProperty.call(descriptors, name)) {
          return;
        }

        descriptors[name] = Object.prototype.hasOwnProperty.call(targetWindow, name)
          ? Object.getOwnPropertyDescriptor(targetWindow, name)
          : null;
      }

      function setValue(name, value) {
        remember(name);
        Object.defineProperty(targetWindow, name, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
      }

      function setAccessor(name, getter, setter) {
        remember(name);
        Object.defineProperty(targetWindow, name, {
          configurable: true,
          enumerable: true,
          get: getter,
          set: setter,
        });
      }

      function restore() {
        const names = Object.keys(descriptors);
        for (let i = names.length - 1; i >= 0; i -= 1) {
          const name = names[i];
          const descriptor = descriptors[name];
          try {
            if (descriptor) {
              Object.defineProperty(targetWindow, name, descriptor);
            } else {
              delete targetWindow[name];
            }
          } catch (_restoreError) {
            if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
              try {
                targetWindow[name] = descriptor.value;
              } catch (_valueRestoreError) {}
            } else if (!descriptor) {
              try {
                delete targetWindow[name];
              } catch (_deleteRestoreError) {
                targetWindow[name] = undefined;
              }
            }
          }
        }
      }

      return {
        setAccessor,
        setValue,
        restore,
      };
    }

    function bindP5RuntimeVariables(targetWindow, session, p) {
      const allVariables =
        typeof functionRegistry !== "undefined" && functionRegistry.getAllVariables
          ? functionRegistry.getAllVariables()
          : [];

      for (let i = 0; i < allVariables.length; i += 1) {
        const varName = allVariables[i];

        if (p && varName in p) {
          session.setAccessor(
            varName,
            () => p[varName],
            (value) => {
              try {
                p[varName] = value;
              } catch (_assignError) {}
            },
          );
          continue;
        }

        if (typeof p5 !== "undefined" && Object.prototype.hasOwnProperty.call(p5, varName)) {
          session.setValue(varName, p5[varName]);
          continue;
        }

        if (
          typeof p5 !== "undefined" &&
          p5.prototype &&
          Object.prototype.hasOwnProperty.call(p5.prototype, varName) &&
          p5.prototype[varName] !== undefined
        ) {
          session.setValue(varName, p5.prototype[varName]);
          continue;
        }

        if (typeof Math !== "undefined" && Object.prototype.hasOwnProperty.call(Math, varName)) {
          session.setValue(varName, Math[varName]);
        }
      }

      if (p && p.constructor && p.constructor.Vector) {
        session.setValue("createVector", function (x, y, z) {
          return new p.constructor.Vector(x, y, z);
        });
      }
    }

    function bindP5RuntimeFunctions(session, p) {
      const allFunctions =
        typeof functionRegistry !== "undefined" && functionRegistry.getAllFunctions
          ? functionRegistry.getAllFunctions()
          : [];

      for (let i = 0; i < allFunctions.length; i += 1) {
        const funcName = allFunctions[i];

        if (funcName === "print") {
          session.setValue(funcName, function () {
            return console.log.apply(console, arguments);
          });
          continue;
        }

        const original = getP5RuntimeFunction(p, funcName);
        if (!original) {
          continue;
        }

        session.setValue(funcName, function () {
          return original.apply(p, arguments);
        });
      }
    }

    function bindSilentConsole(session) {
      const noop = function () {};
      session.setValue("console", {
        log: noop,
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
      });
      session.setValue("print", noop);
    }

    function instrumentBitmapControllerCallsites(sourceCode) {
      const source = String(sourceCode || "");
      if (!source.trim()) {
        return source;
      }

      let program = null;
      try {
        program = window.compilerAst.parse(source);
      } catch (_parseError) {
        return source;
      }

      const inserts = [];
      window.compilerAst.walk(program, function (node) {
        if (!node || node.type !== "CallExpression" || !node.callee) {
          return;
        }
        if (
          node.callee.type !== "Identifier" ||
          !controllerCollection.isFactoryName(node.callee.name)
        ) {
          return;
        }

        const openParen = source.indexOf("(", node.callee.end);
        if (openParen === -1 || openParen > node.end) {
          return;
        }

        inserts.push({
          start: openParen + 1,
          end: openParen + 1,
          text:
            JSON.stringify(controllerCollection.callsiteId(node, node.callee.name)) +
            (node.arguments.length > 0 ? ", " : ""),
        });
      });

      return window.compilerAst.applyTextReplacements(source, inserts);
    }

    function bindControllerBootstrapStubs(session, controllerCollector) {
      const controllerTypeCounts = {};

      function extractControllerBootstrapArgs(argsLike) {
        const args = Array.prototype.slice.call(argsLike || []);
        let id = null;

        if (
          args.length > 0 &&
          typeof args[0] === "string" &&
          args[0].indexOf(BITMAP_CONTROLLER_CALLSITE_PREFIX) === 0
        ) {
          id = args.shift();
        }

        return {
          id,
          args,
        };
      }

      function pushControllerConfig(type, callInfo, payload) {
        const typeKey = String(type || "controller");
        const ordinal = controllerTypeCounts[typeKey] || 0;
        controllerTypeCounts[typeKey] = ordinal + 1;

        const config = Object.assign(
          {
            type: typeKey,
            id: callInfo && callInfo.id ? callInfo.id : `${BITMAP_CONTROLLER_CALLSITE_PREFIX}${typeKey}_${ordinal}`,
          },
          payload || {},
        );
        controllerCollector.push(config);
        return config;
      }

      function normalizeSliderValue(value, fallbackValue) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          return numeric;
        }
        const fallback = Number(fallbackValue);
        return Number.isFinite(fallback) ? fallback : 0;
      }

      function normalizeColorArray(input) {
        if (typeof input === "string") {
          let text = input.replace(/^#/, "");
          if (text.length === 3 || text.length === 4) {
            const expanded = [];
            for (let i = 0; i < text.length; i += 1) {
              expanded.push(text.charAt(i), text.charAt(i));
            }
            text = expanded.join("");
          }
          if (text.length === 6 || text.length === 8) {
            const red = parseInt(text.slice(0, 2), 16);
            const green = parseInt(text.slice(2, 4), 16);
            const blue = parseInt(text.slice(4, 6), 16);
            const alpha = text.length === 8 ? parseInt(text.slice(6, 8), 16) : 255;
            return [red / 255, green / 255, blue / 255, alpha / 255];
          }
        }

        if (Array.isArray(input) && input.length >= 3) {
          const raw = [
            Number(input[0]),
            Number(input[1]),
            Number(input[2]),
            input.length >= 4 ? Number(input[3]) : 1,
          ];
          const use255Scale = raw.some(
            (value) => Number.isFinite(value) && value > 1,
          );
          const divisor = use255Scale ? 255 : 1;
          return raw.map((value) => {
            const numeric = Number.isFinite(value) ? value : 1;
            const normalized = numeric / divisor;
            if (normalized < 0) return 0;
            if (normalized > 1) return 1;
            return normalized;
          });
        }

        return [1, 1, 1, 1];
      }

      function colorArrayToHex(colorArray) {
        const rgba = normalizeColorArray(colorArray);
        const parts = [];
        for (let i = 0; i < 3; i += 1) {
          const channel = Math.round(Math.max(0, Math.min(1, rgba[i])) * 255);
          parts.push((channel < 16 ? "0" : "") + channel.toString(16));
        }
        const alpha = Math.round(Math.max(0, Math.min(1, rgba[3])) * 255);
        let hex = `#${parts.join("")}`;
        if (alpha < 255) {
          hex += (alpha < 16 ? "0" : "") + alpha.toString(16);
        }
        return hex;
      }

      function callResourceSuccess(callback, value) {
        if (typeof callback === "function") {
          callback(value);
        }
        return value;
      }

      function findResourceSuccessCallback(argsLike) {
        const args = Array.prototype.slice.call(argsLike || []);
        for (let index = 1; index < args.length; index += 1) {
          if (typeof args[index] === "function") {
            return args[index];
          }
        }
        return null;
      }

      function createImagePlaceholder(path) {
        const source = String(path == null ? "" : path);
        const imageValue = {
          __momentumType: "Image",
          _momentumPath: source,
          _momentumFullPath: source,
          width: 1,
          height: 1,
          pixels: [0, 0, 0, 255],
          get() {
            return arguments.length >= 2 ? [0, 0, 0, 255] : imageValue;
          },
          set() {},
          loadPixels() {
            return imageValue.pixels;
          },
          updatePixels() {},
          resize(width, height) {
            imageValue.width = Math.max(1, Math.floor(Number(width) || 1));
            imageValue.height = Math.max(1, Math.floor(Number(height) || 1));
            return imageValue;
          },
          copy() {
            return imageValue;
          },
          mask() {
            return imageValue;
          },
          filter() {
            return imageValue;
          },
        };
        return imageValue;
      }

      function createTablePlaceholder() {
        return {
          columns: [],
          rows: [],
          get() { return null; },
          getArray() { return []; },
          getColumn() { return []; },
          getColumnCount() { return 0; },
          getRow() { return null; },
          getRowCount() { return 0; },
          findRows() { return []; },
          matchRows() { return []; },
        };
      }

      function createXmlPlaceholder() {
        return {
          getChild() { return null; },
          getChildren() { return []; },
          getContent() { return ""; },
          getName() { return ""; },
          getNum(_name, defaultValue) {
            return Number(defaultValue) || 0;
          },
          getString(_name, defaultValue) {
            return defaultValue == null ? "" : String(defaultValue);
          },
        };
      }

      session.setValue("duration", function () {});
      session.setValue("createSlider", function (min, max, value, step) {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const args = callInfo.args;
        const sliderMin = normalizeSliderValue(args[0], 0);
        const sliderMax = normalizeSliderValue(args[1], 100);
        const sliderValue =
          args[2] === undefined ? sliderMin : normalizeSliderValue(args[2], sliderMin);
        const sliderStep = Number.isFinite(Number(args[3])) ? Number(args[3]) : 0;

        function clampAndSnap(nextValue) {
          let mapped = normalizeSliderValue(nextValue, sliderValue);
          if (mapped < sliderMin) mapped = sliderMin;
          if (mapped > sliderMax) mapped = sliderMax;
          if (sliderStep > 0) {
            mapped = Math.floor((mapped - sliderMin) / sliderStep) * sliderStep + sliderMin;
            if (mapped < sliderMin) mapped = sliderMin;
            if (mapped > sliderMax) mapped = sliderMax;
          }
          return mapped;
        }

        const mappedValue = clampAndSnap(sliderValue);
        pushControllerConfig("slider", callInfo, {
          min: sliderMin,
          max: sliderMax,
          value: mappedValue,
          step: sliderStep,
        });

        return {
          value() {
            return mappedValue;
          },
        };
      });
      session.setValue("createAngle", function (defaultDegrees) {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const args = callInfo.args;
        const degrees = normalizeSliderValue(args[0], 0);

        pushControllerConfig("angle", callInfo, {
          value: degrees,
        });

        return {
          value() {
            return degrees;
          },
          degrees() {
            return degrees;
          },
          radians() {
            return (degrees * Math.PI) / 180;
          },
        };
      });
      session.setValue("createColorPicker", function (r, g, b, a) {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const args = callInfo.args;
        let colorValue = [1, 1, 1, 1];
        if (args.length === 1) {
          colorValue = normalizeColorArray(args[0]);
        } else if (args.length >= 3) {
          colorValue = normalizeColorArray([args[0], args[1], args[2], args[3] === undefined ? 255 : args[3]]);
        }

        pushControllerConfig("color", callInfo, {
          value: colorValue.slice(),
        });

        return {
          color() {
            if (typeof color === "function") {
              return color(colorArrayToHex(colorValue));
            }
            return colorValue.slice();
          },
          value() {
            return colorArrayToHex(colorValue);
          },
        };
      });
      session.setValue("createCheckbox", function (label, checked) {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const args = callInfo.args;
        const config = pushControllerConfig("checkbox", callInfo, {
          value: !!args[1],
        });
        if (typeof args[0] === "string" && args[0]) {
          config.label = args[0];
        }

        return {
          value() {
            return config.value;
          },
          checked() {
            return config.value;
          },
        };
      });
      session.setValue("createSelect", function () {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const config = pushControllerConfig("select", callInfo, {
          options: [],
          value: 0,
        });
        const optionValues = [];

        function clampIndex(value) {
          const length = optionValues.length > 0 ? optionValues.length : 1;
          let index = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
          if (index < 0) index = 0;
          if (index > length - 1) index = length - 1;
          return index;
        }

        return {
          option(label, value) {
            const optionLabel = label === undefined || label === null ? "" : String(label);
            config.options.push({ label: optionLabel });
            optionValues.push(arguments.length >= 2 ? value : label);
            config.value = clampIndex(config.value);
            return this;
          },
          index() {
            config.value = clampIndex(config.value);
            return config.value;
          },
          value() {
            const index = this.index();
            if (index < 0 || index >= optionValues.length) {
              return null;
            }
            return optionValues[index];
          },
          selected(value) {
            if (arguments.length === 0) {
              return this.value();
            }
            let nextIndex = -1;
            if (typeof value === "number" && isFinite(value)) {
              nextIndex = Math.floor(value);
            } else {
              for (let i = 0; i < optionValues.length; i += 1) {
                if (optionValues[i] === value || config.options[i].label === String(value)) {
                  nextIndex = i;
                  break;
                }
              }
            }
            if (nextIndex < 0) {
              nextIndex = 0;
            }
            config.value = clampIndex(nextIndex);
            return this;
          },
        };
      });
      session.setValue("createPoint", function (defaultX, defaultY) {
        const callInfo = extractControllerBootstrapArgs(arguments);
        const args = callInfo.args;
        const x = normalizeSliderValue(args[0], 0);
        const y = normalizeSliderValue(args[1], 0);

        pushControllerConfig("point", callInfo, {
          value: [x, y],
        });

        return {
          value() {
            return [x, y];
          },
          x() {
            return x;
          },
          y() {
            return y;
          },
        };
      });

      // Controller discovery must never perform real asset I/O. p5 loadImage()
      // is asynchronous and can otherwise complete after this temporary runtime
      // has been destroyed, leaking a late ErrorEvent into the panel Console.
      session.setValue("loadImage", function (path) {
        return callResourceSuccess(
          findResourceSuccessCallback(arguments),
          createImagePlaceholder(path),
        );
      });
      session.setValue("image", function () {});
      session.setValue("background", function () {});
      session.setValue("tint", function () {});
      session.setValue("noTint", function () {});
      session.setValue("loadJSON", function () {
        return callResourceSuccess(findResourceSuccessCallback(arguments), {});
      });
      session.setValue("loadStrings", function () {
        return callResourceSuccess(findResourceSuccessCallback(arguments), []);
      });
      session.setValue("loadBytes", function () {
        return callResourceSuccess(
          findResourceSuccessCallback(arguments),
          { bytes: [] },
        );
      });
      session.setValue("loadTable", function () {
        return callResourceSuccess(
          findResourceSuccessCallback(arguments),
          createTablePlaceholder(),
        );
      });
      session.setValue("loadXML", function () {
        return callResourceSuccess(
          findResourceSuccessCallback(arguments),
          createXmlPlaceholder(),
        );
      });

      session.setValue("loadFont", function (path) {
        const source = String(path == null ? "" : path);
        const fontValue = {
          __momentumType: "Font",
          _fontData: {
            source: source,
            fontName: "",
            fontPath: source,
            fontSourceKind: "file",
            loaded: true,
            loadError: "",
          },
          font: {
            familyName: "",
            path: source,
            source: source,
            loaded: true,
          },
          textBounds() {
            return { x: 0, y: 0, w: 0, h: 0 };
          },
          textToPoints() {
            return [];
          },
        };
        return callResourceSuccess(
          findResourceSuccessCallback(arguments),
          fontValue,
        );
      });
    }

    function buildControllerBootstrapEntrypoints(sourceCode, targetWindow) {
      const factory = new Function(
        "window",
        `with (window) {\n${sourceCode}\nreturn {\npreload: (typeof preload === "function") ? preload : null,\nsetup: (typeof setup === "function") ? setup : null,\ndraw: (typeof draw === "function") ? draw : null\n};\n}`,
      );

      return factory(targetWindow);
    }

    async function createBitmapBootstrapRuntime(initialWidth, initialHeight) {
      if (typeof p5 === "undefined") {
        throw new Error("p5.js is not loaded");
      }

      return new Promise((resolve, reject) => {
        const container = document.createElement("div");
        container.style.cssText =
          "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;";
        document.body.appendChild(container);

        let instance = null;

        try {
          instance = new p5((p) => {
            p.setup = function () {
              p.createCanvas(initialWidth, initialHeight);
              p.noLoop();
            };
          }, container);
        } catch (error) {
          if (container.parentNode) {
            container.parentNode.removeChild(container);
          }
          reject(error);
          return;
        }

        window.setTimeout(() => {
          resolve({
            p: instance,
            destroy() {
              try {
                if (instance && typeof instance.remove === "function") {
                  instance.remove();
                }
              } catch (_removeError) {}
              if (container.parentNode) {
                container.parentNode.removeChild(container);
              }
            },
          });
        }, 0);
      });
    }

    async function runBitmapControllerBootstrap(code, compiled) {
      const source = absolutizeBitmapAssetCalls(typeof code === "string" ? code : "");
      const effectiveCompiled =
        compiled && compiled.ok ? compiled : getCompiler().compile(source);

      if (!effectiveCompiled || !effectiveCompiled.ok) {
        return [];
      }

      const plan = buildExecutionPlan(effectiveCompiled);
      const runtime = await createBitmapBootstrapRuntime(
        plan.globalVars.width || 100,
        plan.globalVars.height || 100,
      );
      const controllerCollector = [];
      const session = createWindowBindingSession(window);
      const controllerSource = instrumentBitmapControllerCallsites(source);

      try {
        bindP5RuntimeVariables(window, session, runtime.p);
        bindP5RuntimeFunctions(session, runtime.p);
        bindSilentConsole(session);
        bindControllerBootstrapStubs(session, controllerCollector);

        const entrypoints = buildControllerBootstrapEntrypoints(controllerSource, window);

        if (entrypoints && typeof entrypoints.preload === "function") {
          entrypoints.preload.call(window);
        }

        if (entrypoints && typeof entrypoints.setup === "function") {
          entrypoints.setup.call(window);
        }

        if (entrypoints && typeof entrypoints.draw === "function") {
          entrypoints.draw.call(window);
        }

        return controllerCollector.slice();
      } finally {
        session.restore();
        runtime.destroy();
      }
    }

    async function discoverBitmapControllers(code, compiled) {
      try {
        return await runBitmapControllerBootstrap(code, compiled);
      } catch (_bootstrapError) {
        return [];
      }
    }


    return {
      discoverBitmapControllers,
    };
  }

  return { createService };
})();

// Owns Monaco loading, construction, models, and view state.
window.momentumEditorSurface = (function () {
  "use strict";

  const MONACO_VERSION = "0.30.1";
  const MONACO_ROOT = "js/vendor/monaco-editor/min";
  const MONACO_LOADER_URL = `${MONACO_ROOT}/vs/loader.js`;
  const MONACO_VS_URL = `${MONACO_ROOT}/vs`;
  const THEME_NAME = "rsms-dark";
  const MONACO_WORKER_FALLBACK_WARNING =
    "Could not create web worker(s). Falling back to loading web worker code in main thread, which might cause UI freezes. Please see https://github.com/microsoft/monaco-editor#faq";
  const OVERLAY_GUTTER = 12;
  const SUGGEST_MAX_WIDTH = 430;
  const SYNCHRONOUS_WORKER_MESSAGE =
    "Momentum disables Monaco Web Workers because AE CEP can crash its renderer process.";
  const COMMON_EDITOR_OPTIONS = {
    autoIndent: "full",
    detectIndentation: false,
    fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    formatOnPaste: true,
    formatOnType: true,
    insertSpaces: true,
    minimap: { enabled: false },
    tabSize: 2,
    theme: THEME_NAME,
    wordBasedSuggestions: false,
    scrollbar: {
      vertical: "visible",
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  };

  let amdLoaderPromise = null;
  let monacoPromise = null;
  let themeDefined = false;
  let workerPolicyConfigured = false;

  function configureSynchronousWorkers() {
    if (workerPolicyConfigured) {
      return;
    }

    const environment =
      window.MonacoEnvironment && typeof window.MonacoEnvironment === "object"
        ? window.MonacoEnvironment
        : {};
    environment.getWorker = function () {
      throw new Error(SYNCHRONOUS_WORKER_MESSAGE);
    };
    window.MonacoEnvironment = environment;

    const originalWarn = console.warn;
    console.warn = function (message) {
      if (
        message === MONACO_WORKER_FALLBACK_WARNING ||
        message === SYNCHRONOUS_WORKER_MESSAGE
      ) {
        return;
      }
      originalWarn.apply(console, arguments);
    };
    workerPolicyConfigured = true;
  }

  function hasAmdLoader() {
    return !!(
      window.require &&
      typeof window.require === "function" &&
      typeof window.require.config === "function"
    );
  }

  function loadAmdLoader() {
    if (hasAmdLoader()) {
      return Promise.resolve();
    }

    if (amdLoaderPromise) {
      return amdLoaderPromise;
    }

    amdLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MONACO_LOADER_URL;
      script.async = true;
      script.setAttribute("data-momentum-monaco-loader", MONACO_VERSION);
      script.addEventListener("load", () => {
        if (hasAmdLoader()) {
          resolve();
          return;
        }
        reject(new Error("The Monaco AMD loader did not initialize."));
      });
      script.addEventListener("error", () => {
        reject(new Error("Could not load the Monaco editor runtime."));
      });
      document.head.appendChild(script);
    });

    return amdLoaderPromise;
  }

  function defineTheme() {
    if (themeDefined) {
      return;
    }

    monaco.editor.defineTheme(THEME_NAME, {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "#888888" },
        { token: "meta.keyword", foreground: "#85ad99" },
        { token: "meta.variable", foreground: "#6c9380" },
        { token: "meta.annotation", foreground: "#6c9380" },
        { token: "delimiter", foreground: "#ffffff66" },
        { token: "delimiter.bracket", foreground: "#ffffff66" },
        { token: "type", foreground: "#f7ac6e" },
        { token: "type.identifier", foreground: "#ffab66" },
        { token: "keyword", foreground: "#94b3d1" },
        { token: "keyword.operator", foreground: "#ffc799" },
        {
          token: "identifier.function",
          foreground: "#ffffff",
          fontStyle: "bold",
        },
        { token: "string", foreground: "#94d1b3" },
        { token: "constant", foreground: "#94d1b3" },
        { token: "number", foreground: "#94d1b3" },
        { token: "regexp", foreground: "#3399ff" },
        { token: "tag", foreground: "#ffffff66" },
        { token: "tag.attribute.name", foreground: "#ffab66" },
        { token: "invalid", foreground: "#ff1500" },
      ],
      colors: {
        "editor.foreground": "#ffffffcc",
        "editor.background": "#1a1a19",
        "editorCursor.foreground": "#e8e3da",
        "editor.selectionBackground": "#66c2ff4c",
        "editor.inactiveSelectionBackground": "#b3b3b333",
        "diffEditor.insertedLineBackground": "#00db6e80",
        "diffEditor.removedLineBackground": "#ff150080",
        "editorIndentGuide.background": "#ffffff0f",
        "editorIndentGuide.activeBackground": "#ffffff0f",
        "editor.findMatchHighlightBackground": "#66c2ff66",
        "editor.findMatchBackground": "#ffff00",
        "editorError.foreground": "#ff5b4d",
        "editorWarning.foreground": "#ffff00",
        "editorBracketMatch.background": "#f76ec9",
        "editorBracketMatch.border": "#00000000",
        "scrollbar.shadow": "#77777577",
      },
    });
    themeDefined = true;
  }

  function loadMonaco() {
    configureSynchronousWorkers();

    if (window.monaco && window.monaco.editor) {
      defineTheme();
      return Promise.resolve(window.monaco);
    }

    if (monacoPromise) {
      return monacoPromise;
    }

    monacoPromise = loadAmdLoader().then(() => {
      window.require.config({
        paths: {
          vs: MONACO_VS_URL,
        },
      });

      return new Promise((resolve, reject) => {
        window.require(
          ["vs/editor/editor.main"],
          () => {
            defineTheme();
            resolve(window.monaco);
          },
          (error) => {
            reject(error instanceof Error
              ? error
              : new Error("Could not initialize the Monaco editor runtime."));
          },
        );
      });
    });

    return monacoPromise;
  }

  function buildEditorOptions(options) {
    const requested = options || {};
    const editorOptions = Object.assign({}, COMMON_EDITOR_OPTIONS, requested);
    editorOptions.minimap = Object.assign(
      {},
      COMMON_EDITOR_OPTIONS.minimap,
      requested.minimap || {},
    );
    editorOptions.scrollbar = Object.assign(
      {},
      COMMON_EDITOR_OPTIONS.scrollbar,
      requested.scrollbar || {},
    );
    return editorOptions;
  }

  function normalizeSuggestWidgetMeasurements(suggestWidget) {
    if (
      !suggestWidget ||
      !suggestWidget.element ||
      !suggestWidget._contentWidget ||
      typeof suggestWidget.getLayoutInfo !== "function" ||
      typeof suggestWidget._contentWidget.beforeRender !== "function" ||
      typeof suggestWidget._resize !== "function"
    ) {
      return;
    }

    const contentWidget = suggestWidget._contentWidget;
    const beforeRender = contentWidget.beforeRender;
    contentWidget.beforeRender = function () {
      const dimension = beforeRender.call(this);
      const layout = suggestWidget.getLayoutInfo();
      // Monaco reserves invisible horizontal padding when positioning this widget.
      return {
        width: Math.max(1, dimension.width - layout.horizontalPadding),
        height: dimension.height,
      };
    };

    const resize = suggestWidget._resize;
    suggestWidget._resize = function (width, height) {
      const minimumSize = this.element.minSize;
      // Monaco's 220 px minimum must shrink with the rendered widget width.
      if (minimumSize && width < minimumSize.width) {
        this.element.minSize = {
          width,
          height: minimumSize.height,
        };
      }
      return resize.call(this, width, height);
    };
  }

  function create(options) {
    const settings = options || {};
    const container = settings.container;
    if (!container) {
      return Promise.reject(new Error("A Monaco editor container is required."));
    }

    return loadMonaco().then(() => {
      const autocomplete = settings.autocomplete === false
        ? null
        : window.momentumEditorAutocomplete.createController();
      if (autocomplete) {
        autocomplete.configure();
      }

      const editorOptions = buildEditorOptions(settings.editorOptions);
      let ownedModel = null;
      if (!editorOptions.model) {
        const initialValue = String(editorOptions.value || "");
        const initialLanguage = String(editorOptions.language || "plaintext");
        const modelUri = settings.modelUri && monaco.Uri &&
          typeof monaco.Uri.parse === "function"
          ? monaco.Uri.parse(String(settings.modelUri))
          : undefined;
        ownedModel = monaco.editor.createModel(
          initialValue,
          initialLanguage,
          modelUri,
        );
        delete editorOptions.value;
        delete editorOptions.language;
        editorOptions.model = ownedModel;
      }
      let editor = null;
      try {
        editor = monaco.editor.create(container, editorOptions);
      } catch (error) {
        if (ownedModel && typeof ownedModel.dispose === "function") {
          ownedModel.dispose();
          ownedModel = null;
        }
        throw error;
      }
      const validation = settings.validation === false
        ? null
        : window.momentumEditorValidation.createController({
            getEditor: () => editor,
            validationDelay: settings.validationDelay,
          });
      const disposables = [];
      let initialValidationTimer = null;
      let layoutFrame = 0;
      let resizeObserver = null;
      let disposed = false;
      const suggestController = typeof editor.getContribution === "function"
        ? editor.getContribution("editor.contrib.suggestController")
        : null;
      const suggestWidget = suggestController && suggestController.widget
        ? suggestController.widget.value
        : null;
      normalizeSuggestWidgetMeasurements(suggestWidget);

      const fitEditorOverlays = (position) => {
        const editorBounds = container.getBoundingClientRect();
        const availableWidth = Math.max(
          1,
          editorBounds.width - OVERLAY_GUTTER * 2,
        );
        container.style.setProperty(
          "--momentum-editor-overlay-max-width",
          `${availableWidth}px`,
        );

        if (
          !suggestWidget ||
          !suggestWidget.element ||
          !suggestWidget.element.size ||
          typeof suggestWidget.getLayoutInfo !== "function"
        ) {
          return;
        }

        const cursor = editor.getScrolledVisiblePosition(
          position || editor.getPosition(),
        );
        const widgetLayout = suggestWidget.getLayoutInfo();
        const widgetFrameWidth = widgetLayout.borderWidth * 2;
        const cursorPageLeft = cursor
          ? editorBounds.left + cursor.left
          : editorBounds.left;
        const widthToRightEdge = cursor
          ? editorBounds.right -
            cursorPageLeft -
            OVERLAY_GUTTER -
            widgetFrameWidth
          : availableWidth;
        const targetWidth = Math.max(
          1,
          Math.min(SUGGEST_MAX_WIDTH, widthToRightEdge),
        );
        if (suggestWidget._persistedSize) {
          const persistedSize = suggestWidget._persistedSize.restore();
          const targetHeight = persistedSize
            ? persistedSize.height
            : widgetLayout.defaultSize.height;
          if (!persistedSize || Math.abs(persistedSize.width - targetWidth) > 1) {
            suggestWidget._persistedSize.store({
              width: targetWidth,
              height: targetHeight,
            });
          }
        }

        if (
          suggestWidget.element.domNode.classList.contains("visible") &&
          typeof suggestWidget._resize === "function" &&
          Math.abs(suggestWidget.element.size.width - targetWidth) > 1
        ) {
          suggestWidget._resize(targetWidth, suggestWidget.element.size.height);
        }
      };

      if (validation && typeof editor.onDidChangeModelContent === "function") {
        disposables.push(editor.onDidChangeModelContent(() => {
          validation.scheduleValidation();
        }));
      }
      if (
        suggestController &&
        suggestController.model &&
        typeof suggestController.model.onDidTrigger === "function"
      ) {
        disposables.push(suggestController.model.onDidTrigger((event) => {
          fitEditorOverlays(event && event.position);
        }));
      }

      const layout = () => {
        layoutFrame = 0;
        if (disposed || !editor || typeof editor.layout !== "function") {
          return;
        }
        const bounds = container.getBoundingClientRect();
        if (!(bounds.width > 0) || !(bounds.height > 0)) {
          return;
        }
        editor.layout({
          width: Math.max(1, Math.floor(bounds.width)),
          height: Math.max(1, Math.floor(bounds.height)),
        });
        fitEditorOverlays();
      };

      const requestLayout = () => {
        if (disposed || layoutFrame) {
          return;
        }
        layoutFrame = window.requestAnimationFrame(layout);
      };

      resizeObserver = new ResizeObserver(requestLayout);
      resizeObserver.observe(container);
      requestLayout();
      initialValidationTimer = window.setTimeout(() => {
        initialValidationTimer = null;
        if (validation && typeof validation.validateCurrentModel === "function") {
          validation.validateCurrentModel();
        }
      }, 100);

      function dispose() {
        if (disposed) {
          return;
        }
        disposed = true;
        if (initialValidationTimer !== null) {
          window.clearTimeout(initialValidationTimer);
          initialValidationTimer = null;
        }
        if (layoutFrame) {
          window.cancelAnimationFrame(layoutFrame);
          layoutFrame = 0;
        }
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
        disposables.forEach((disposable) => {
          if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
          }
        });
        if (validation && typeof validation.dispose === "function") {
          validation.dispose();
        }
        if (autocomplete && typeof autocomplete.dispose === "function") {
          autocomplete.dispose();
        }
        if (editor && typeof editor.dispose === "function") {
          editor.dispose();
        }
        if (ownedModel && typeof ownedModel.dispose === "function") {
          ownedModel.dispose();
          ownedModel = null;
        }
      }

      return {
        dispose,
        editor,
        validation,
      };
    });
  }

  return {
    create,
  };
})();

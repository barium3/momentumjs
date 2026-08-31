// Single source of truth for file icons, editor modes, previews, and actions.
window.fileTypes = (function () {
  const DEFAULT_TYPE = {
    autoOpen: false,
    iconClass: "fa-file-alt",
    language: "plaintext",
    previewKind: "text",
    runnable: false,
  };
  const IMAGE_TYPE = {
    autoOpen: true,
    iconClass: "fa-file-image",
    language: "plaintext",
    previewKind: "image",
    runnable: false,
  };
  const PLAIN_TEXT_TYPE = {
    autoOpen: true,
    iconClass: "fa-file-alt",
    language: "plaintext",
    previewKind: "text",
    runnable: false,
  };

  function codeType(language, runnable) {
    return {
      autoOpen: true,
      iconClass: "fa-file-code",
      language: language,
      previewKind: "text",
      runnable: runnable === true,
    };
  }

  const TYPE_BY_EXTENSION = {
    bmp: IMAGE_TYPE,
    css: codeType("css"),
    csv: codeType("csv"),
    gif: IMAGE_TYPE,
    html: codeType("html"),
    jpeg: IMAGE_TYPE,
    jpg: IMAGE_TYPE,
    js: codeType("javascript", true),
    json: codeType("json"),
    jsx: codeType("javascript"),
    md: PLAIN_TEXT_TYPE,
    png: IMAGE_TYPE,
    svg: {
      autoOpen: true,
      iconClass: "fa-file-image",
      language: "plaintext",
      previewKind: "text",
      runnable: false,
    },
    txt: PLAIN_TEXT_TYPE,
    xml: codeType("xml"),
  };

  function getExtension(value) {
    const fileName = String(value || "").toLowerCase().split(/[\\/]/).pop() || "";
    const extensionIndex = fileName.lastIndexOf(".");
    if (extensionIndex > 0) {
      return fileName.substring(extensionIndex + 1);
    }
    return /^[a-z0-9]+$/.test(fileName) ? fileName : "";
  }

  function getType(value) {
    return TYPE_BY_EXTENSION[getExtension(value)] || DEFAULT_TYPE;
  }

  return {
    canAutoOpen: function (value) {
      return getType(value).autoOpen;
    },
    getIconClass: function (value) {
      return getType(value).iconClass;
    },
    getLanguage: function (value) {
      return getType(value).language;
    },
    isImage: function (value) {
      return getType(value).previewKind === "image";
    },
    isRunnable: function (value) {
      return getType(value).runnable;
    },
  };
})();

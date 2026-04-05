window.momentumPluginAsset = (function () {
  function normalizeAssetPath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  function isAbsoluteAssetPath(path) {
    return /^(?:[A-Za-z]:[\\/]|\/)/.test(String(path || ""));
  }

  function isFontAssetPath(path) {
    return /\.(ttf|otf|ttc|otc|dfont)$/i.test(String(path || ""));
  }

  function absolutizeLoadFontCalls(code) {
    if (!code || !window.extensionPath) {
      return code;
    }

    const userDirectory =
      String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
    const loadFontRegex = /loadFont\s*\(\s*(["'])([^"']+)\1/g;

    return String(code).replace(loadFontRegex, (match, quote, rawPath) => {
      if (!rawPath || isAbsoluteAssetPath(rawPath) || !isFontAssetPath(rawPath)) {
        return match;
      }

      const normalizedPath = normalizeAssetPath(rawPath);
      const absolutePath = `${userDirectory}/${normalizedPath}`;
      return match.replace(`${quote}${rawPath}${quote}`, `${quote}${absolutePath}${quote}`);
    });
  }

  function absolutizeLoadImageCalls(code) {
    if (!code || !window.extensionPath) {
      return code;
    }

    const userDirectory =
      String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
    const loadImageRegex = /loadImage\s*\(\s*(["'])([^"']+)\1/g;

    return String(code).replace(loadImageRegex, (match, quote, rawPath) => {
      if (!rawPath || isAbsoluteAssetPath(rawPath)) {
        return match;
      }

      const normalizedPath = normalizeAssetPath(rawPath);
      const absolutePath = `${userDirectory}/${normalizedPath}`;
      return match.replace(`${quote}${rawPath}${quote}`, `${quote}${absolutePath}${quote}`);
    });
  }

  function absolutizeIoAssetCalls(code) {
    if (!code || !window.extensionPath) {
      return code;
    }

    const userDirectory =
      String(window.extensionPath).replace(/[\\\/]+$/, "") + "/user";
    const ioRegex =
      /(loadJSON|loadTable|loadStrings|loadBytes|loadXML)\s*\(\s*(["'])([^"']+)\2/g;

    return String(code).replace(ioRegex, (match, funcName, quote, rawPath) => {
      if (!rawPath || isAbsoluteAssetPath(rawPath)) {
        return match;
      }

      const normalizedPath = normalizeAssetPath(rawPath);
      const absolutePath = `${userDirectory}/${normalizedPath}`;
      return match.replace(`${quote}${rawPath}${quote}`, `${quote}${absolutePath}${quote}`);
    });
  }

  function absolutizeBitmapAssetCalls(code) {
    return absolutizeIoAssetCalls(
      absolutizeLoadImageCalls(absolutizeLoadFontCalls(code)),
    );
  }

  function absolutizeAeFontPaths(plan) {
    if (!plan) {
      return plan;
    }

    return {
      ...plan,
      aeDrawCode: absolutizeLoadFontCalls(plan.aeDrawCode || ""),
      aeSetupCode: absolutizeLoadFontCalls(plan.aeSetupCode || ""),
      aeGlobalCode: absolutizeLoadFontCalls(plan.aeGlobalCode || ""),
      aeDrawFullCode: absolutizeLoadFontCalls(plan.aeDrawFullCode || ""),
      aeSetupFullCode: absolutizeLoadFontCalls(plan.aeSetupFullCode || ""),
      aePreloadFullCode: absolutizeLoadFontCalls(plan.aePreloadFullCode || ""),
    };
  }

  return {
    absolutizeAeFontPaths,
    absolutizeBitmapAssetCalls,
    absolutizeIoAssetCalls,
    absolutizeLoadFontCalls,
    absolutizeLoadImageCalls,
  };
})();

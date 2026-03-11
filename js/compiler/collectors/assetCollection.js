window.compilerAssetCollectionPass = (function () {
  var DEFAULT_FONT = "Arial";

  function ensureAssetCollection() {
    return {
      images: [],
      fonts: [],
      tables: [],
      json: [],
      hasText: false,
    };
  }

  function pushUnique(list, value) {
    if (!value || list.indexOf(value) !== -1) return;
    list.push(value);
  }

  function collect(program) {
    var assets = ensureAssetCollection();
    if (!program) return assets;

    window.compilerAst.walk(program, function (node) {
      if (!node || node.type !== "CallExpression") {
        return;
      }

      var funcName = window.compilerAst.getCalleeName(node.callee);
      if (!funcName) return;

      if (funcName === "text") {
        assets.hasText = true;
      }

      if (
        funcName !== "loadImage" &&
        funcName !== "textFont" &&
        funcName !== "loadTable" &&
        funcName !== "loadJSON"
      ) {
        return;
      }

      var value = window.compilerAst.getStringLiteralValue(
        node.arguments && node.arguments[0],
      );
      if (!value) return;

      if (funcName === "loadImage") {
        pushUnique(assets.images, value);
      } else if (funcName === "textFont") {
        pushUnique(assets.fonts, value);
      } else if (funcName === "loadTable") {
        pushUnique(assets.tables, value);
      } else if (funcName === "loadJSON") {
        pushUnique(assets.json, value);
      }
    });

    if (assets.hasText && assets.fonts.length === 0) {
      assets.fonts.push(DEFAULT_FONT);
    }

    return assets;
  }

  return {
    collect: collect,
    defaultFont: DEFAULT_FONT,
  };
})();

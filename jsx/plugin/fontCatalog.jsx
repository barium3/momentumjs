function getAvailableFontCatalog() {
  try {
    if (!app.fonts || !app.fonts.allFonts) {
      return JSON.stringify([]);
    }

    var entries = [];
    var seen = {};
    var groups = app.fonts.allFonts;

    function remember(entry) {
      var key = [
        entry.family || "",
        entry.style || "",
        entry.displayName || "",
        entry.postScriptName || "",
      ].join("|");
      if (!entry.displayName || !entry.postScriptName || seen[key]) {
        return;
      }
      seen[key] = true;
      entries.push(entry);
    }

    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (!group || !group.length) {
        continue;
      }
      for (var j = 0; j < group.length; j++) {
        var font = group[j];
        if (!font) {
          continue;
        }
        var familyName = font.familyName || "";
        var styleName = font.styleName || "";
        var postScriptName = font.postScriptName || "";
        var displayName = familyName;
        if (familyName && styleName) {
          displayName = familyName + " " + styleName;
        } else if (!displayName) {
          displayName = postScriptName;
        }
        remember({
          family: familyName,
          style: styleName,
          displayName: displayName,
          postScriptName: postScriptName,
        });
      }
    }
    return JSON.stringify(entries);
  } catch (_error) {
    return JSON.stringify([]);
  }
}

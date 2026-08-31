// Owns textFont argument detection, font discovery, matching, and suggestions.
window.momentumEditorFontCompletions = (function () {
  let fontAnalyzer = null;

  function getFontAnalyzer() {
    if (!fontAnalyzer) {
      fontAnalyzer = new window.FontAnalyzer();
    }
    return fontAnalyzer;
  }

  function ensureFontAnalyzerReady() {
    const analyzer = getFontAnalyzer();
    return Promise.resolve(analyzer.init())
      .catch(() => {})
      .then(() => analyzer);
  }

  function createService(options) {
    const createSuggestion = options.createSuggestion;

    function getTextFontFirstArgumentContext(model, position) {
      if (typeof monaco === "undefined") {
        return null;
      }

      const line = model.getLineContent(position.lineNumber);
      const linePrefix = line.slice(0, Math.max(0, position.column - 1));
      const match = linePrefix.match(/\btextFont\s*\(([\s\S]*)$/);
      if (!match) {
        return null;
      }

      const argPrefix = match[1];
      const argsStartIndex = linePrefix.length - argPrefix.length;
      let parenDepth = 0;
      let bracketDepth = 0;
      let braceDepth = 0;
      let quote = null;
      let escaped = false;

      for (let i = 0; i < argPrefix.length; i += 1) {
        const ch = argPrefix.charAt(i);

        if (quote) {
          if (escaped) {
            escaped = false;
          } else if (ch === "\\") {
            escaped = true;
          } else if (ch === quote) {
            quote = null;
          }
          continue;
        }

        if (ch === '"' || ch === "'" || ch === "`") {
          quote = ch;
          continue;
        }

        if (ch === "(") {
          parenDepth += 1;
          continue;
        }
        if (ch === ")") {
          if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            return null;
          }
          parenDepth = Math.max(0, parenDepth - 1);
          continue;
        }
        if (ch === "[") {
          bracketDepth += 1;
          continue;
        }
        if (ch === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1);
          continue;
        }
        if (ch === "{") {
          braceDepth += 1;
          continue;
        }
        if (ch === "}") {
          braceDepth = Math.max(0, braceDepth - 1);
          continue;
        }

        if (ch === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          return null;
        }
      }

      const trimmedPrefixLength = argPrefix.match(/^\s*/)[0].length;
      const argStartIndex = argsStartIndex + trimmedPrefixLength;
      const argStartChar = line.charAt(argStartIndex);

      if (argStartChar === '"' || argStartChar === "'") {
        const quoteChar = argStartChar;
        let endIndex = line.length;
        let localEscaped = false;

        for (let i = argStartIndex + 1; i < line.length; i += 1) {
          const ch = line.charAt(i);
          if (localEscaped) {
            localEscaped = false;
          } else if (ch === "\\") {
            localEscaped = true;
          } else if (ch === quoteChar) {
            endIndex = i;
            break;
          }
        }

        return {
          isString: true,
          range: new monaco.Range(
            position.lineNumber,
            argStartIndex + 2,
            position.lineNumber,
            endIndex + 1,
          ),
          query: line.slice(
            argStartIndex + 1,
            Math.min(endIndex, position.column - 1),
          ),
        };
      }

      const word = model.getWordUntilPosition(position);
      return {
        isString: false,
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        query: linePrefix.slice(argStartIndex).trim(),
      };
    }

    function normalizeFontSearchValue(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/["']/g, "")
        .replace(/[\s_-]+/g, "");
    }

    function buildFontEntryList(analyzer) {
      if (!analyzer) {
        return [];
      }

      if (typeof analyzer.getAllFontEntries === "function") {
        const entries = analyzer.getAllFontEntries();
        if (entries.length) {
          return entries;
        }
      }

      const fontMap =
        typeof analyzer.getAllFonts === "function"
          ? analyzer.getAllFonts()
          : {};

      return Object.keys(fontMap).map((name) => ({
        family: name,
        style: "",
        displayName: name,
        postScriptName: fontMap[name],
      }));
    }

    function getFontMatchScore(query, entry) {
      if (!query) {
        return 0;
      }

      const family = entry.family || "";
      const style = entry.style || "";
      const displayName = entry.displayName || family;
      const compactStyle = style.replace(/\s+/g, "");
      const candidates = [
        displayName,
        family,
        style,
        `${family} ${style}`.trim(),
        `${family}-${compactStyle}`.trim(),
        entry.postScriptName || "",
      ];

      let bestScore = Infinity;
      candidates.forEach((candidate) => {
        const normalized = normalizeFontSearchValue(candidate);
        if (!normalized) {
          return;
        }

        if (normalized === query) {
          bestScore = Math.min(bestScore, 0);
        } else if (normalized.indexOf(query) === 0) {
          bestScore = Math.min(bestScore, 1);
        } else if (normalized.includes(query)) {
          bestScore = Math.min(bestScore, 2);
        }
      });

      return bestScore;
    }

    function buildFontInsertText(context, name) {
      return context.isString ? name : `"${name}"`;
    }

    function collectMatchingFontFamilies(entries, query) {
      const familyGroups = Object.create(null);
      const filteredEntries = [];

      entries.forEach((entry) => {
        const score = getFontMatchScore(query, entry);
        if (score === Infinity) {
          return;
        }

        const familyName = entry.family || entry.displayName || "Unknown";
        if (!familyGroups[familyName]) {
          familyGroups[familyName] = {
            family: familyName,
            score,
            styles: [],
            styleSet: Object.create(null),
          };
        } else {
          familyGroups[familyName].score = Math.min(
            familyGroups[familyName].score,
            score,
          );
        }

        if (entry.style && !familyGroups[familyName].styleSet[entry.style]) {
          familyGroups[familyName].styleSet[entry.style] = true;
          familyGroups[familyName].styles.push(entry.style);
        }

        filteredEntries.push({
          ...entry,
          score,
        });
      });

      return {
        families: Object.keys(familyGroups)
          .map((name) => familyGroups[name])
          .sort((a, b) => {
            if (a.score !== b.score) {
              return a.score - b.score;
            }
            return a.family.localeCompare(b.family);
          }),
        filteredEntries,
      };
    }

    function buildFontFamilySuggestion(context, group) {
      const documentation = group.styles.length
        ? `Styles: ${group.styles
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .join(", ")}`
        : "Available AE font family";

      return createSuggestion(context.range, {
        label: group.family,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: buildFontInsertText(context, group.family),
        detail: "Font family",
        documentation,
        filterText: `${group.family} ${group.styles.join(" ")}`,
        sortText: `0_${String(group.score)}_${group.family.toLowerCase()}`,
      });
    }

    function buildFontVariantSuggestion(context, group, entry) {
      const label = entry.displayName || group.family;
      const variantName = entry.style ? `${group.family} ${entry.style}` : label;

      if (label === group.family && !entry.style) {
        return null;
      }

      return createSuggestion(context.range, {
        label: variantName,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: buildFontInsertText(context, label),
        detail: entry.style ? `Style: ${entry.style}` : "Font variant",
        documentation: entry.postScriptName
          ? `PostScript: ${entry.postScriptName}`
          : "Available AE font variant",
        filterText: [
          variantName,
          label,
          `${group.family}-${(entry.style || "").replace(/\s+/g, "")}`,
          entry.postScriptName || "",
        ].join(" "),
        sortText: `1_${String(group.score)}_${group.family.toLowerCase()}_${(
          entry.style || label
        ).toLowerCase()}`,
      });
    }

    function buildFamilyFontSuggestions(entries, context, query) {
      const { families, filteredEntries } = collectMatchingFontFamilies(
        entries,
        query,
      );
      const suggestions = [];

      families.forEach((group) => {
        suggestions.push(buildFontFamilySuggestion(context, group));

        filteredEntries
          .filter(
            (entry) =>
              (entry.family || entry.displayName || "Unknown") === group.family,
          )
          .sort((a, b) => {
            if (a.score !== b.score) {
              return a.score - b.score;
            }
            return (a.displayName || "").localeCompare(b.displayName || "");
          })
          .forEach((entry) => {
            const suggestion = buildFontVariantSuggestion(
              context,
              group,
              entry,
            );
            if (suggestion) {
              suggestions.push(suggestion);
            }
          });
      });

      return suggestions;
    }

    function buildFontSuggestions(context) {
      if (typeof monaco === "undefined") {
        return Promise.resolve([]);
      }

      return ensureFontAnalyzerReady().then((analyzer) => {
        const loadEntries =
          analyzer &&
          typeof analyzer.refreshFontMap === "function" &&
          typeof analyzer.getAllFontEntries === "function" &&
          analyzer.getAllFontEntries().length === 0
            ? Promise.resolve(analyzer.refreshFontMap()).then(() =>
                buildFontEntryList(analyzer),
              )
            : Promise.resolve(buildFontEntryList(analyzer));

        return loadEntries.then((entries) => {
          const query = normalizeFontSearchValue(context.query);
          return buildFamilyFontSuggestions(entries, context, query);
        });
      });
    }

    return {
      buildFontSuggestions,
      getTextFontFirstArgumentContext,
    };
  }

  return { createService };
})();

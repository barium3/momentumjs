import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const fontSource = readFileSync(
  new URL("../js/ui/editor/autocompleteFonts.js", import.meta.url),
  "utf8",
);
const bindingSource = readFileSync(
  new URL("../js/ui/editor/autocompleteBindings.js", import.meta.url),
  "utf8",
);

class Range {
  constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
    Object.assign(this, {
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    });
  }
}

let analyzerInitCount = 0;
class FontAnalyzer {
  init() {
    analyzerInitCount += 1;
  }

  getAllFontEntries() {
    return [
      {
        family: "Inter",
        style: "Regular",
        displayName: "Inter Regular",
        postScriptName: "Inter-Regular",
      },
      {
        family: "Inter",
        style: "Bold",
        displayName: "Inter Bold",
        postScriptName: "Inter-Bold",
      },
      {
        family: "Roboto",
        style: "Regular",
        displayName: "Roboto Regular",
        postScriptName: "Roboto-Regular",
      },
    ];
  }
}

const context = {
  FontAnalyzer,
  Promise,
  monaco: {
    Range,
    languages: {
      CompletionItemKind: {
        Class: 1,
        Function: 2,
        Value: 3,
        Variable: 4,
      },
    },
  },
};
context.window = context;
context.globalThis = context;
vm.runInNewContext(fontSource, context, { filename: "autocompleteFonts.js" });
vm.runInNewContext(bindingSource, context, {
  filename: "autocompleteBindings.js",
});

const fontService = context.momentumEditorFontCompletions.createService({
  createSuggestion(range, config) {
    return { ...config, range };
  },
});
const line = 'textFont("Inter")';
const fontContext = fontService.getTextFontFirstArgumentContext(
  {
    getLineContent() {
      return line;
    },
    getWordUntilPosition() {
      return { startColumn: 11, endColumn: 16 };
    },
  },
  { lineNumber: 1, column: 16 },
);

assert.equal(fontContext.query, "Inter");
assert.equal(fontContext.isString, true);
assert.ok(fontContext.range instanceof Range);

const suggestions = await fontService.buildFontSuggestions(fontContext);
assert.deepEqual(
  Array.from(suggestions, (suggestion) => suggestion.label),
  ["Inter", "Inter Bold", "Inter Regular"],
);
assert.equal(suggestions[0].insertText, "Inter");
assert.equal(analyzerInitCount, 1);

context.compilerAst = {
  parse() {
    throw new Error("Use the binding fallback scanner");
  },
  walk() {},
};
const bindingService =
  context.momentumEditorBindingCompletions.createService({
    buildFunctionInsertText(name) {
      return `${name}($0)`;
    },
    createSuggestion(range, config) {
      return { ...config, range };
    },
    formatSignatureSummary() {
      return "";
    },
    getCompletionRange() {
      return null;
    },
    hasFollowingCallParen() {
      return false;
    },
    isReplacingExistingArgumentValue() {
      return false;
    },
  });
const bindingCode = "const speed = 1; function pulse() {}";
const bindingSuggestions = bindingService.buildUserBindingSuggestions(
  {
    getValue() {
      return bindingCode;
    },
    getOffsetAt() {
      return bindingCode.length;
    },
  },
  { lineNumber: 1, column: bindingCode.length + 1 },
  new Range(1, 1, 1, 1),
  null,
  null,
);
const bindingLabels = Array.from(
  bindingSuggestions,
  (suggestion) => suggestion.label,
).sort();
assert.deepEqual(bindingLabels, ["pulse", "speed"]);
assert.equal(
  Array.from(bindingSuggestions).find(
    (suggestion) => suggestion.label === "pulse",
  ).insertText,
  "pulse($0)",
);

console.log("Autocomplete workflows: OK");

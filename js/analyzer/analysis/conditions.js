// Backward-compatible alias for compiler-owned conditional analysis.

if (
  typeof window !== "undefined" &&
  typeof window.ConditionalAnalyzer === "undefined" &&
  typeof window.CompilerConditionAnalysis !== "undefined"
) {
  window.ConditionalAnalyzer = window.CompilerConditionAnalysis;
}

if (
  typeof module !== "undefined" &&
  module.exports &&
  typeof window !== "undefined" &&
  window.CompilerConditionAnalysis
) {
  module.exports = window.CompilerConditionAnalysis;
}

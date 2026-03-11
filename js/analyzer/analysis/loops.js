// Backward-compatible alias for compiler-owned loop analysis.

if (
  typeof window !== "undefined" &&
  typeof window.LoopAnalyzer === "undefined" &&
  typeof window.CompilerLoopAnalysis !== "undefined"
) {
  window.LoopAnalyzer = window.CompilerLoopAnalysis;
}

if (
  typeof module !== "undefined" &&
  module.exports &&
  typeof window !== "undefined" &&
  window.CompilerLoopAnalysis
) {
  module.exports = window.CompilerLoopAnalysis;
}

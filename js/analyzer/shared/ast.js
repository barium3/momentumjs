// Shared AST helpers for analyzer modules.
// Compiler core owns the implementations; analyzer consumes them through
// these stable aliases to avoid duplicating tree utilities.

function addAstParentLinks(node, parent) {
  return window.compilerAst.addParentLinks(node, parent);
}

function walkAst(node, visitor) {
  return window.compilerAst.walk(node, visitor);
}

function getAstCalleeName(callee) {
  return window.compilerAst.getCalleeName(callee);
}

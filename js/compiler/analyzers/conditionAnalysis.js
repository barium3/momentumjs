// Finds control-flow conditions that can block render calls.

class CompilerConditionalAnalyzer {
  constructor() {
    if (typeof getRenderFunctionNames === "function") {
      this.renderFunctions = getRenderFunctionNames();
    } else {
      throw new Error(
        "[ConditionalAnalyzer] functionRegistry not found. Please ensure registry.js is loaded."
      );
    }
  }

  findBranchesWithRender(code) {
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, locations: true });
    } catch (e) {
      return [];
    }

    addAstParentLinks(ast, null);
    const renderCalls = this.collectRenderFunctions(ast);
    const callGraph = this.buildFunctionCallGraph(ast);
    const conditionMap = new Map();

    for (const renderCall of renderCalls) {
      const affectingConditions = this.findAffectingBranches(
        renderCall,
        ast,
        callGraph
      );
      
      for (const cond of affectingConditions) {
        let key = this.getConditionKey(cond.node && cond.node.test, cond.condition);
        if (!conditionMap.has(key)) {
          conditionMap.set(key, {
            condition: cond.condition,
            hasThen: cond.hasThen,
            hasElse: cond.hasElse,
            node: cond.node,
            affectedRenderFunctions: [],
          });
        }
        const existing = conditionMap.get(key);
        existing.hasThen = existing.hasThen || cond.hasThen;
        existing.hasElse = existing.hasElse || cond.hasElse;
        if (!existing.affectedRenderFunctions.includes(renderCall.funcName)) {
          existing.affectedRenderFunctions.push(renderCall.funcName);
        }
      }
    }

    const conditions = Array.from(conditionMap.values()).map((c) => ({
      ...c,
      hasRender: true,
    }));
    
    return conditions;
  }

  collectRenderFunctions(ast) {
    const renderCalls = [];

    walkAst(ast, (node) => {
      if (node.type === "CallExpression") {
        const funcName = getAstCalleeName(node.callee);
        if (funcName && this.renderFunctions.includes(funcName)) {
          const functionScope = this.findFunctionScope(node);
          renderCalls.push({
            node: node,
            funcName: funcName,
            functionScope: functionScope,
          });
        }
      }
    });

    return renderCalls;
  }

  findFunctionScope(node) {
    let current = node;
    while (current) {
      if (
        current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression"
      ) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  getFunctionName(fnNode) {
    if (!fnNode) return null;

    if (fnNode.type === "FunctionDeclaration" && fnNode.id) {
      return fnNode.id.name;
    }

    if (
      fnNode.type === "FunctionExpression" ||
      fnNode.type === "ArrowFunctionExpression"
    ) {
      const parent = fnNode.parent;
      if (!parent) return null;

      if (
        parent.type === "VariableDeclarator" &&
        parent.id &&
        parent.id.type === "Identifier"
      ) {
        return parent.id.name;
      }

      if (
        parent.type === "AssignmentExpression" &&
        parent.left &&
        parent.left.type === "Identifier"
      ) {
        return parent.left.name;
      }

      if (parent.type === "Property" && parent.key) {
        return parent.key.name || parent.key.value || null;
      }
    }

    return null;
  }

  buildFunctionCallGraph(ast) {
    const callSitesByName = new Map();

    walkAst(ast, (node) => {
      if (node.type === "CallExpression") {
        let calleeName = getAstCalleeName(node.callee);

        if (!calleeName) return false;

        const callerFunction = this.findFunctionScope(node);
        if (!callerFunction) {
          return false;
        }

        if (!callSitesByName.has(calleeName)) {
          callSitesByName.set(calleeName, []);
        }
        callSitesByName.get(calleeName).push({
          callNode: node,
          callerFunction,
        });
      }

      return false;
    });

    return { callSitesByName };
  }

  collectConditionsForNode(execNode, functionScope, ast) {
    const conditions = [];
    const renderNode = execNode;
    const searchBoundary = functionScope || ast;
    let currentNode = renderNode;
    const visitedIfs = new Set();

    while (currentNode && currentNode !== searchBoundary) {
      const parent = currentNode.parent;
      if (!parent) break;
      if (currentNode === functionScope) break;
      if (parent.type === "IfStatement" && !visitedIfs.has(parent)) {
        const stmt = parent;

        if (this.isInSameFunctionScope(stmt, renderNode, functionScope)) {
          visitedIfs.add(stmt);
          const inThen = this.isNodeDescendant(renderNode, stmt.consequent);
          const inElse =
            stmt.alternate && this.isNodeDescendant(renderNode, stmt.alternate);

          if (inThen) {
            this.processNestedIfsWithReturnInBranch(
              renderNode,
              stmt.consequent,
              functionScope,
              visitedIfs,
              conditions
            );

            const conditionStr = this.extractConditionExpression(stmt.test);
            conditions.push({
              condition: conditionStr,
              hasThen: true,
              hasElse: false,
              node: stmt,
            });
          } else if (inElse) {
            this.processNestedIfsWithReturnInBranch(
              renderNode,
              stmt.alternate,
              functionScope,
              visitedIfs,
              conditions
            );

            const conditionStr = this.extractConditionExpression(stmt.test);
            conditions.push({
              condition: conditionStr,
              hasThen: false,
              hasElse: true,
              node: stmt,
            });
          }
        }
      }

      if (parent.type === "BlockStatement" || parent.type === "Program") {
        const statements = parent.body || [];

        for (const stmt of statements) {
          if (stmt.end > renderNode.start) break;
          if (stmt.type === "IfStatement" && !visitedIfs.has(stmt)) {
            if (!this.isInSameFunctionScope(stmt, renderNode, functionScope)) {
              continue;
            }

            const inThen = this.isNodeDescendant(renderNode, stmt.consequent);
            const inElse =
              stmt.alternate && this.isNodeDescendant(renderNode, stmt.alternate);
            if (inThen || inElse) {
              continue;
            }

            visitedIfs.add(stmt);
            const nestedIfsInThen = this.findNestedIfsWithReturn(
              renderNode,
              stmt.consequent,
              functionScope,
              visitedIfs
            );
            const nestedIfsInElse = stmt.alternate
              ? this.findNestedIfsWithReturn(
                  renderNode,
                  stmt.alternate,
                  functionScope,
                  visitedIfs
                )
              : [];

            for (const nestedIf of nestedIfsInThen) {
              if (!visitedIfs.has(nestedIf)) {
                visitedIfs.add(nestedIf);
                conditions.push({
                  condition: this.extractConditionExpression(nestedIf.test),
                  hasThen: false,
                  hasElse: true,
                  node: nestedIf,
                });
              }
            }
            for (const nestedIf of nestedIfsInElse) {
              if (!visitedIfs.has(nestedIf)) {
                visitedIfs.add(nestedIf);
                conditions.push({
                  condition: this.extractConditionExpression(nestedIf.test),
                  hasThen: true,
                  hasElse: false,
                  node: nestedIf,
                });
              }
            }

            const hasDirectReturnInThen = this.hasDirectReturn(
              renderNode,
              stmt.consequent,
              functionScope
            );
            const hasDirectReturnInElse = stmt.alternate
              ? this.hasDirectReturn(renderNode, stmt.alternate, functionScope)
              : false;

            if (
              hasDirectReturnInThen ||
              hasDirectReturnInElse ||
              nestedIfsInThen.length > 0 ||
              nestedIfsInElse.length > 0
            ) {
              conditions.push({
                condition: this.extractConditionExpression(stmt.test),
                hasThen:
                  !hasDirectReturnInThen && nestedIfsInThen.length === 0,
                hasElse:
                  hasDirectReturnInThen || nestedIfsInThen.length > 0,
                node: stmt,
              });
            }
          }
        }
      }

      currentNode = parent;
    }

    return conditions;
  }

  findAffectingBranches(renderCall, ast, callGraph) {
    const allConditions = [];
    const visitedFunctions = new Set();

    const startFunction = renderCall.functionScope;
    const renderNode = renderCall.node;

    const localConditions = this.collectConditionsForNode(
      renderNode,
      startFunction,
      ast
    );
    allConditions.push(...localConditions);

    const functionName = this.getFunctionName(startFunction);

    if (!functionName) {
      return allConditions;
    }

    const { callSitesByName } = callGraph || {};
    if (!callSitesByName) {
      return allConditions;
    }

    const collectFromCallers = (calleeName) => {
      if (!calleeName) return;
      if (visitedFunctions.has(calleeName)) return;
      visitedFunctions.add(calleeName);

      const callSites = callSitesByName.get(calleeName) || [];
      for (const { callNode, callerFunction } of callSites) {
        const callerConds = this.collectConditionsForNode(
          callNode,
          callerFunction,
          ast
        );
        allConditions.push(...callerConds);

        const callerName = this.getFunctionName(callerFunction);
        if (callerName) {
          collectFromCallers(callerName);
        }
      }
    };

    collectFromCallers(functionName);

    return allConditions;
  }

  /**
   * 递归查找分支中所有包含 return 的嵌套 if 语句
   * @param {Object} renderNode - 渲染函数节点
   * @param {Object} branchNode - 要检查的分支节点
   * @param {Object} functionScope - 函数作用域
   * @param {Set} visitedIfs - 已访问的 if 语句集合（用于避免重复，但不在这里标记为已访问）
   * @returns {Array} 包含 return 的 if 语句数组
   */
  findNestedIfsWithReturn(renderNode, branchNode, functionScope, visitedIfs) {
    if (!branchNode) return [];

    const nestedIfs = [];
    const localVisited = new Set();

    this.walkNode(branchNode, (node) => {
      if (node.type === "IfStatement" && !localVisited.has(node) && !visitedIfs.has(node)) {
        localVisited.add(node);

        const hasReturnInThen = this.hasDirectReturn(
          renderNode,
          node.consequent,
          functionScope
        );
        const hasReturnInElse = node.alternate
          ? this.hasDirectReturn(renderNode, node.alternate, functionScope)
          : false;

        const deeperNestedInThen = this.findNestedIfsWithReturn(
          renderNode,
          node.consequent,
          functionScope,
          visitedIfs
        );
        const deeperNestedInElse = node.alternate
          ? this.findNestedIfsWithReturn(renderNode, node.alternate, functionScope, visitedIfs)
          : [];

        if (hasReturnInThen || hasReturnInElse || deeperNestedInThen.length > 0 || deeperNestedInElse.length > 0) {
          nestedIfs.push(node);
          nestedIfs.push(...deeperNestedInThen);
          nestedIfs.push(...deeperNestedInElse);
        }
      }
      return false;
    });

    return nestedIfs;
  }

  /**
   * 处理分支中的嵌套 if return，正确设置条件让 return 不执行
   * @param {Object} renderNode - 渲染函数节点
   * @param {Object} branchNode - 要检查的分支节点
   * @param {Object} functionScope - 函数作用域
   * @param {Set} visitedIfs - 已访问的 if 语句集合
   * @param {Array} conditions - 条件数组（会被修改）
   */
  processNestedIfsWithReturnInBranch(renderNode, branchNode, functionScope, visitedIfs, conditions) {
    if (!branchNode) return;

    const localVisited = new Set();

    this.walkNode(branchNode, (node) => {
      if (node.type === "IfStatement" && !localVisited.has(node) && !visitedIfs.has(node)) {
        localVisited.add(node);

        const hasReturnInThen = this.hasDirectReturn(
          renderNode,
          node.consequent,
          functionScope
        );
        const hasReturnInElse = node.alternate
          ? this.hasDirectReturn(renderNode, node.alternate, functionScope)
          : false;

        const deeperNestedInThen = this.findNestedIfsWithReturn(
          renderNode,
          node.consequent,
          functionScope,
          visitedIfs
        );
        const deeperNestedInElse = node.alternate
          ? this.findNestedIfsWithReturn(renderNode, node.alternate, functionScope, visitedIfs)
          : [];

        if (hasReturnInThen || deeperNestedInThen.length > 0) {
          if (!visitedIfs.has(node)) {
            visitedIfs.add(node);
            conditions.push({
              condition: this.extractConditionExpression(node.test),
              hasThen: false,
              hasElse: true,
              node: node,
            });
          }
          for (const nestedIf of deeperNestedInThen) {
            if (!visitedIfs.has(nestedIf)) {
              visitedIfs.add(nestedIf);
              conditions.push({
                condition: this.extractConditionExpression(nestedIf.test),
                hasThen: false,
                hasElse: true,
                node: nestedIf,
              });
            }
          }
        }

        // 如果 else 分支有 return（直接或嵌套），需要强制条件为 true（让 return 不执行）
        if (hasReturnInElse || deeperNestedInElse.length > 0) {
          if (!visitedIfs.has(node)) {
            visitedIfs.add(node);
            conditions.push({
              condition: this.extractConditionExpression(node.test),
              hasThen: true,
              hasElse: false,
              node: node,
            });
          }
          for (const nestedIf of deeperNestedInElse) {
            if (!visitedIfs.has(nestedIf)) {
              visitedIfs.add(nestedIf);
              conditions.push({
                condition: this.extractConditionExpression(nestedIf.test),
                hasThen: true,
                hasElse: false,
                node: nestedIf,
              });
            }
          }
        }
      }
      return false;
    });
  }

  hasDirectReturn(renderNode, branchNode, functionScope) {
    if (!branchNode) return false;

    if (branchNode.type === "BlockStatement") {
      const statements = branchNode.body || [];
      for (const stmt of statements) {
        if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") {
          if (
            stmt.start < renderNode.start &&
            this.isInSameFunctionScope(stmt, renderNode, functionScope)
          ) {
            return true;
          }
        }
      }
    } else if (branchNode.type === "ReturnStatement" || branchNode.type === "ThrowStatement") {
      if (
        branchNode.start < renderNode.start &&
        this.isInSameFunctionScope(branchNode, renderNode, functionScope)
      ) {
        return true;
      }
    }

    return false;
  }

  isNodeDescendant(node1, node2) {
    if (!node1 || !node2) return false;
    if (node1 === node2) return true;

    let current = node1.parent;
    while (current) {
      if (current === node2) return true;
      current = current.parent;
    }
    return false;
  }

  isInSameFunctionScope(node1, node2, functionScope) {
    if (!functionScope) {
      return true;
    }

    const node1InScope = this.isNodeDescendant(node1, functionScope) || node1 === functionScope;
    const node2InScope = this.isNodeDescendant(node2, functionScope) || node2 === functionScope;

    return node1InScope && node2InScope;
  }

  /**
   * 提取条件表达式的字符串表示
   */
  extractConditionExpression(node) {
    if (!node) return "";

    switch (node.type) {
      case "BinaryExpression":
        return `${this.extractConditionExpression(node.left)} ${node.operator} ${this.extractConditionExpression(node.right)}`;
      case "LogicalExpression":
        return `${this.extractConditionExpression(node.left)} ${node.operator} ${this.extractConditionExpression(node.right)}`;
      case "UnaryExpression":
        return `${node.operator} ${this.extractConditionExpression(node.argument)}`;
      case "Identifier":
        return node.name;
      case "Literal":
        return String(node.value);
      case "MemberExpression":
        return this.extractMemberExpression(node);
      case "CallExpression":
        const callee = this.extractConditionExpression(node.callee);
        const args = node.arguments.map(arg => this.extractConditionExpression(arg)).join(", ");
        return `${callee}(${args})`;
      default:
        return "";
    }
  }

  extractMemberExpression(node) {
    let obj = "";
    if (node.object.type === "Identifier") {
      obj = node.object.name;
    } else if (node.object.type === "MemberExpression") {
      obj = this.extractMemberExpression(node.object);
    }

    const prop = node.property.name || String(node.property.value);
    return `${obj}.${prop}`;
  }

  walkNode(node, callback) {
    if (!node) return false;

    if (callback(node)) return true;

    for (const key in node) {
      if (key === "type" || key === "loc" || key === "start" || key === "end" || key === "parent")
        continue;

      const child = node[key];
      if (Array.isArray(child)) {
        for (const childNode of child) {
          if (childNode && typeof childNode === "object") {
            if (this.walkNode(childNode, callback)) return true;
          }
        }
      } else if (child && typeof child === "object") {
        if (this.walkNode(child, callback)) return true;
      }
    }

    return false;
  }

  convertElseToIndependentIf(code, conditions) {
    if (!conditions || conditions.length === 0) {
      return code;
    }

    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, locations: true, sourceType: "script" });
    } catch (e) {
      return code;
    }

    addAstParentLinks(ast, null);

    const ifNodesToProcess = [];
    const conditionMap = new Map();

    for (const cond of conditions) {
      let key = this.getConditionKey(cond.node && cond.node.test, cond.condition);
      if (!conditionMap.has(key)) {
        conditionMap.set(key, cond);
      }
    }

    const self = this;
    function traverse(node) {
      if (!node) return;
      
      if (node.type === "IfStatement") {
        let key = self.getConditionKey(node.test, self.extractConditionExpression(node.test));
        if (conditionMap.has(key)) {
          ifNodesToProcess.push({
            node: node,
            condition: conditionMap.get(key),
          });
        }
      }

      for (const key in node) {
        if (key === "parent") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach((item) => {
            if (item && typeof item === "object") {
              traverse(item);
            }
          });
        } else if (child && typeof child === "object") {
          traverse(child);
        }
      }
    }

    traverse(ast);

    if (ifNodesToProcess.length === 0) {
      return code;
    }

    ifNodesToProcess.sort((a, b) => {
      const startA = a.node.test ? a.node.test.start : a.node.start;
      const startB = b.node.test ? b.node.test.start : b.node.start;
      return startB - startA;
    });

    let modifiedCode = code;
    let modifications = [];

    for (const { node, condition } of ifNodesToProcess) {
      if (node.test) {
        if (condition.hasThen && !condition.hasElse) {
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
            value: "true",
          });
        } else if (!condition.hasThen && condition.hasElse) {
          if (node.alternate) {
            modifications.push({
              type: "forceCondition",
              start: node.test.start,
              end: node.test.end,
              value: "false",
            });
          } else {
            modifications.push({
              type: "forceCondition",
              start: node.test.start,
              end: node.test.end,
              value: "false",
            });
          }
        } else if (condition.hasThen && condition.hasElse) {
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
              value: "true",
            });
        } else {
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
            value: "true",
          });
        }
      }

      if (node.alternate && (condition.hasElse || node.alternate.type === "IfStatement")) {
        let elseStart = node.consequent.end;
        
        while (elseStart < code.length && 
               (code[elseStart] === " " || code[elseStart] === "\n" || code[elseStart] === "\t" || code[elseStart] === "\r")) {
          elseStart++;
        }
        
        if (code.substring(elseStart, elseStart + 4) === "else") {
          let elseContentStart = elseStart + 4;
          while (elseContentStart < code.length && 
                 (code[elseContentStart] === " " || code[elseContentStart] === "\n" || code[elseContentStart] === "\t" || code[elseContentStart] === "\r")) {
            elseContentStart++;
          }

          const isElseIf = code.substring(elseContentStart, elseContentStart + 2) === "if";
          
          if (isElseIf) {
            let elseIfEnd = node.alternate && node.alternate.consequent
              ? node.alternate.consequent.start
              : elseContentStart + 2;

            modifications.push({
              type: "convertElseIf",
              elseStart: elseStart,
              elseIfEnd: elseIfEnd,
            });
          } else {
            modifications.push({
              type: "convertElse",
              elseStart: elseStart,
              elseContentStart: elseContentStart,
            });
          }
        }
      }
    }

    if (modifications.length > 0) {
      const headerRanges = [];
      for (const mod of modifications) {
        if (mod.type === "convertElseIf") {
          headerRanges.push({
            start: mod.elseStart,
            end: mod.elseIfEnd,
          });
        } else if (mod.type === "convertElse") {
          headerRanges.push({
            start: mod.elseStart,
            end: mod.elseContentStart,
          });
        }
      }

      if (headerRanges.length > 0) {
        modifications = modifications.filter((mod) => {
          if (mod.type !== "forceCondition") return true;
          const pos = mod.start;
          return !headerRanges.some((range) => pos >= range.start && pos < range.end);
        });
      }
    }

    modifications.sort((a, b) => {
      const posA = a.start || a.elseStart || 0;
      const posB = b.start || b.elseStart || 0;
      return posB - posA;
    });

    for (const mod of modifications) {
      if (mod.type === "forceCondition") {
        const value = mod.value || "true";
        modifiedCode =
          modifiedCode.substring(0, mod.start) +
          `${value} /* forced */` +
          modifiedCode.substring(mod.end);
      } else if (mod.type === "convertElseIf") {
        modifiedCode =
          modifiedCode.substring(0, mod.elseStart) +
          "if (true /* forced */)" +
          modifiedCode.substring(mod.elseIfEnd);
      } else if (mod.type === "convertElse") {
        modifiedCode =
          modifiedCode.substring(0, mod.elseStart) +
          "if (true /* forced */)" +
          modifiedCode.substring(mod.elseContentStart);
      }
    }

    return modifiedCode;
  }

  getConditionKey(node, fallback) {
    if (
      node &&
      typeof node.start === "number" &&
      typeof node.end === "number"
    ) {
      return `${node.start}:${node.end}`;
    }
    return fallback || "";
  }
}

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = CompilerConditionalAnalyzer;
}

window.CompilerConditionAnalysis = CompilerConditionalAnalyzer;

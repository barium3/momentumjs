/**
 * 条件分支分析器
 * 识别代码中包含渲染函数的条件分支
 * 
 * 新思路：
 * 1. 先找到所有渲染函数调用
 * 2. 对每个渲染函数，向上追溯控制流，找出影响它的 if/return 等
 * 3. 标记需要强制执行的条件
 */

class ConditionalAnalyzer {
  constructor() {
    // 从 registry 获取渲染函数列表
    if (typeof window !== "undefined" && window.functionRegistry) {
      this.renderFunctions = window.functionRegistry.getRenderFunctions();
    } else if (typeof functionRegistry !== "undefined") {
      this.renderFunctions = functionRegistry.getRenderFunctions();
    } else {
      throw new Error(
        "[ConditionalAnalyzer] functionRegistry not found. Please ensure registry.js is loaded."
      );
    }
  }

  /**
   * 查找所有包含渲染函数的条件分支
   * @param {string} code - 用户代码
   * @returns {Array} 条件分支数组
   */
  findBranchesWithRender(code) {
    // 使用 Acorn 解析代码为 AST
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, locations: true });
    } catch (e) {
      console.error("[ConditionalAnalyzer] AST 解析失败:", e);
      return [];
    }

    // 阶段1：建立父子节点关系
    this.addParentLinks(ast);

    // 阶段2：收集所有渲染函数调用
    const renderCalls = this.collectRenderFunctions(ast);
    console.log("[DEBUG] 找到的渲染函数调用:", renderCalls.map(c => c.funcName));

    // 阶段3：对每个渲染函数，找出影响它的条件
    const conditionMap = new Map(); // key: condition string, value: condition info

    for (const renderCall of renderCalls) {
      const affectingConditions = this.findAffectingBranches(renderCall, ast);
      console.log(`[DEBUG] 渲染函数 ${renderCall.funcName} 找到的条件:`, 
        affectingConditions.map(c => ({
          condition: c.condition,
          hasThen: c.hasThen,
          hasElse: c.hasElse
        })));
      
      for (const cond of affectingConditions) {
        const key = cond.condition;
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
        const oldHasThen = existing.hasThen;
        const oldHasElse = existing.hasElse;
        existing.hasThen = existing.hasThen || cond.hasThen;
        existing.hasElse = existing.hasElse || cond.hasElse;
        if (oldHasThen !== existing.hasThen || oldHasElse !== existing.hasElse) {
          console.log(`[DEBUG] 合并条件 "${key}": hasThen ${oldHasThen}->${existing.hasThen}, hasElse ${oldHasElse}->${existing.hasElse}`);
        }
        if (!existing.affectedRenderFunctions.includes(renderCall.funcName)) {
          existing.affectedRenderFunctions.push(renderCall.funcName);
        }
      }
    }

    // 阶段4：转换为数组并添加 hasRender 标记（向后兼容）
    const conditions = Array.from(conditionMap.values()).map((c) => ({
      ...c,
      hasRender: true, // 所有返回的条件都包含渲染函数
    }));
    
    console.log("[DEBUG] 最终合并后的条件:", conditions.map(c => ({
      condition: c.condition,
      hasThen: c.hasThen,
      hasElse: c.hasElse,
      affectedRenderFunctions: c.affectedRenderFunctions
    })));
    
    return conditions;
  }

  /**
   * 建立 AST 节点的父子关系
   */
  addParentLinks(node, parent = null) {
    if (!node) return;

    node.parent = parent;

    for (const key in node) {
      if (
        key === "type" ||
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "parent"
      )
        continue;

      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((childNode) => {
          if (childNode && typeof childNode === "object") {
            this.addParentLinks(childNode, node);
          }
        });
      } else if (child && typeof child === "object") {
        this.addParentLinks(child, node);
      }
    }
  }

  /**
   * 收集所有渲染函数调用
   * @returns {Array} 渲染函数调用数组，每个元素包含 { node, funcName, functionScope, callChain }
   */
  collectRenderFunctions(ast) {
    const renderCalls = [];

    this.walkAST(ast, (node) => {
      if (node.type === "CallExpression") {
        const funcName =
          node.callee.name ||
          (node.callee.property && node.callee.property.name);
        if (funcName && this.renderFunctions.includes(funcName)) {
          const functionScope = this.findFunctionScope(node);
          // 找到调用链：如果渲染函数在对象方法中，找到这个方法是在哪里被调用的
          const callChain = this.findCallChain(node, ast);
          renderCalls.push({
            node: node,
            funcName: funcName,
            functionScope: functionScope,
            callChain: callChain, // 调用链信息
          });
        }
      }
    });

    return renderCalls;
  }

  /**
   * 找到渲染函数调用的调用链
   * 机制：
   * 1. 找到渲染函数（如 line()）所在的函数（如 intersect()）
   * 2. 识别这个函数是否是类的方法
   * 3. 找到这个类的定义
   * 4. 找到类的所有实例（在 setup/draw 中通过 new ClassName() 创建的）
   * 5. 找到这些实例在 setup/draw 中的方法调用（如 c1.intersect(c2)）
   * 
   * @param {Object} renderNode - 渲染函数调用的 AST 节点
   * @param {Object} ast - AST 根节点
   * @returns {Object|null} 调用链信息 { methodName, className, classNode, instances, callerScope, callerNode, inSetupOrDraw }
   */
  findCallChain(renderNode, ast) {
    const functionScope = this.findFunctionScope(renderNode);
    if (!functionScope) {
      return null; // 在全局作用域，没有调用链
    }

    // 步骤1：找到方法名
    let methodName = null;
    let methodNode = null;
    let className = null;
    let classNode = null;

    if (functionScope.id && functionScope.id.name) {
      methodName = functionScope.id.name;
      methodNode = functionScope;
    } else if (functionScope.parent) {
      // 可能是对象方法，如 { intersect: function() { ... } }
      if (functionScope.parent.type === "Property") {
        methodName = functionScope.parent.key.name || functionScope.parent.key.value;
        methodNode = functionScope.parent;
      } else if (functionScope.parent.type === "MethodDefinition") {
        // ES6 类方法，如 class Circle { intersect() { ... } }
        methodName = functionScope.parent.key.name || functionScope.parent.key.value;
        methodNode = functionScope.parent;
        
        // 步骤2：找到这个类
        let current = functionScope.parent.parent;
        while (current) {
          if (current.type === "ClassDeclaration" || current.type === "ClassExpression") {
            className = current.id ? current.id.name : null;
            classNode = current;
            break;
          }
          current = current.parent;
        }
      }
    }

    if (!methodName) {
      return null; // 无法确定方法名
    }

    // 步骤3：如果找到了类，找到类的所有实例（在 setup/draw 中通过 new ClassName() 创建的）
    const instances = []; // 存储实例变量名和创建位置
    const arrayVariables = new Set(); // 存储数组变量名（如 circles）
    if (className) {
      this.walkAST(ast, (node) => {
        // 查找 new ClassName() 表达式
        if (
          node.type === "NewExpression" &&
          node.callee.type === "Identifier" &&
          node.callee.name === className
        ) {
          const scope = this.findFunctionScope(node);
          // 检查是否在 setup 或 draw 中
          if (scope && scope.id) {
            const callerName = scope.id.name;
            if (callerName === "setup" || callerName === "draw") {
              // 找到赋值语句，获取变量名
              let parent = node.parent;
              while (parent) {
                if (parent.type === "VariableDeclarator" && parent.id) {
                  const varName = parent.id.name;
                  instances.push({
                    varName: varName,
                    newNode: node,
                    scope: scope,
                  });
                  break;
                } else if (
                  parent.type === "AssignmentExpression" &&
                  parent.left.type === "Identifier"
                ) {
                  const varName = parent.left.name;
                  instances.push({
                    varName: varName,
                    newNode: node,
                    scope: scope,
                  });
                  break;
                } else if (
                  // 检查是否是数组 push，如 circles.push(new Circle())
                  parent.type === "CallExpression" &&
                  parent.callee &&
                  parent.callee.type === "MemberExpression" &&
                  parent.callee.property &&
                  parent.callee.property.name === "push" &&
                  parent.arguments &&
                  parent.arguments[0] === node
                ) {
                  // 提取数组变量名
                  const arrayName = this.extractObjectName(parent.callee);
                  if (arrayName) {
                    arrayVariables.add(arrayName);
                  }
                  break;
                }
                parent = parent.parent;
              }
            }
          }
        }
        return false;
      });
    }

    // 步骤4：找到这些实例在 setup/draw 中的方法调用（如 c1.intersect(c2)）
    let callerScope = null;
    let callerNode = null;
    let foundInSetupOrDraw = false;
    let fallbackCallerScope = null; // 备用：不在 setup/draw 中的调用
    let fallbackCallerNode = null;

    this.walkAST(ast, (node) => {
      if (node.type === "CallExpression") {
        // 检查是否是方法调用，如 c1.intersect(c2) 或 circles[i].update()
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property &&
          node.callee.property.name === methodName
        ) {
          const scope = this.findFunctionScope(node);
          
          // 如果找到了类，检查调用对象是否是类的实例
          if (className && (instances.length > 0 || arrayVariables.size > 0)) {
            // 使用辅助函数提取对象名（支持数组访问）
            const objectName = this.extractObjectName(node.callee);
            
            // 检查是否是直接实例调用（如 c1.update()）
            const isDirectInstanceCall = objectName && instances.some(
              (inst) => inst.varName === objectName
            );
            
            // 检查是否是数组元素调用（如 circles[i].update()）
            const isArrayElementCall = objectName && arrayVariables.has(objectName);
            
            if (isDirectInstanceCall || isArrayElementCall) {
              // 检查是否在 setup 或 draw 中
              if (scope && scope.id) {
                const callerName = scope.id.name;
                if (callerName === "setup" || callerName === "draw") {
                  callerNode = node;
                  callerScope = scope;
                  foundInSetupOrDraw = true;
                  return true; // 找到在 setup/draw 中的调用，停止搜索
                }
              }
              
              // 即使不在 setup/draw 中，也记录为备用调用
              if (!fallbackCallerNode) {
                fallbackCallerNode = node;
                fallbackCallerScope = scope;
              }
            }
          } else {
            // 没有找到类，使用原来的逻辑（可能是普通对象方法）
            if (scope && scope.id) {
              const callerName = scope.id.name;
              if (callerName === "setup" || callerName === "draw") {
                callerNode = node;
                callerScope = scope;
                foundInSetupOrDraw = true;
                return true;
              }
            }
            
            // 记录备用调用
            if (!fallbackCallerNode) {
              fallbackCallerNode = node;
              fallbackCallerScope = scope;
            }
          }
        }
        // 检查是否是直接函数调用，如 intersect(c1, c2)
        else if (
          node.callee.type === "Identifier" &&
          node.callee.name === methodName
        ) {
          const scope = this.findFunctionScope(node);
          
          if (scope && scope.id) {
            const callerName = scope.id.name;
            if (callerName === "setup" || callerName === "draw") {
              callerNode = node;
              callerScope = scope;
              foundInSetupOrDraw = true;
              return true;
            }
          }
          
          // 记录备用调用
          if (!fallbackCallerNode) {
            fallbackCallerNode = node;
            fallbackCallerScope = scope;
          }
        }
      }
      return false;
    });
    
    // 如果没有找到在 setup/draw 中的调用，使用备用调用
    if (!callerScope && !callerNode && fallbackCallerScope && fallbackCallerNode) {
      callerScope = fallbackCallerScope;
      callerNode = fallbackCallerNode;
    }

    // 返回调用链信息
    if (callerScope && callerNode) {
      return {
        methodName: methodName,
        methodNode: methodNode,
        className: className,
        classNode: classNode,
        instances: instances,
        arrayVariables: Array.from(arrayVariables), // 数组变量列表
        callerScope: callerScope,
        callerNode: callerNode,
        inSetupOrDraw: foundInSetupOrDraw,
      };
    } else if (className && (instances.length > 0 || arrayVariables.size > 0)) {
      // 即使没找到直接调用，也返回类和方法信息，因为条件分析仍然需要在方法内部进行
      return {
        methodName: methodName,
        methodNode: methodNode,
        className: className,
        classNode: classNode,
        instances: instances,
        arrayVariables: Array.from(arrayVariables), // 数组变量列表
        callerScope: null,
        callerNode: null,
        inSetupOrDraw: false,
      };
    }

    return null;
  }

  /**
   * 找到节点所在的函数作用域
   * @returns {Node|null} 函数节点（FunctionDeclaration/FunctionExpression/ArrowFunctionExpression）
   */
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
    return null; // 在全局作用域
  }

  /**
   * 从 MemberExpression 中提取对象变量名
   * 支持：
   * - Identifier: obj.method() -> "obj"
   * - 数组访问: arr[i].method() -> "arr"
   * - 嵌套访问: obj.arr[i].method() -> 递归提取
   * @param {Object} node - MemberExpression 节点
   * @returns {string|null} 对象变量名，如果无法提取则返回 null
   */
  extractObjectName(node) {
    if (!node || node.type !== "MemberExpression") {
      return null;
    }

    // 如果是 Identifier，直接返回名称
    if (node.object.type === "Identifier") {
      return node.object.name;
    }

    // 如果是数组访问（MemberExpression with computed），递归提取
    if (node.object.type === "MemberExpression") {
      return this.extractObjectName(node.object);
    }

    // 其他情况（如 this.xxx），返回 null
    return null;
  }

  /**
   * 找出影响渲染函数执行的条件分支
   * @param {Object} renderCall - 渲染函数调用信息 { node, funcName, functionScope, callChain }
   * @param {Object} ast - AST 根节点
   * @returns {Array} 条件分支数组
   * 
   * 新逻辑：从渲染函数节点向上追溯，检查所有层级的 if return 机制
   * 对于所有可能阻止渲染函数执行的 if return，强制条件为 false，让 return 不执行
   */
  findAffectingBranches(renderCall, ast) {
    const conditions = [];
    const renderNode = renderCall.node;
    const functionScope = renderCall.functionScope;

    // 确定搜索边界：在函数作用域内查找
    const searchBoundary = functionScope || ast;

    // 从渲染函数节点向上遍历到函数作用域边界
    // 对于路径上的每个 BlockStatement，检查其所有语句
    let currentNode = renderNode;
    const visitedIfs = new Set(); // 避免重复处理同一个 if

    while (currentNode && currentNode !== searchBoundary) {
      const parent = currentNode.parent;
      if (!parent) break;

      // 如果到达了函数作用域边界，停止
      if (currentNode === functionScope) break;

      // 关键修复：直接检查父节点是否是 IfStatement
      // 这样即使渲染函数在 else 分支中，也能找到包含它的 if 语句
      if (parent.type === "IfStatement" && !visitedIfs.has(parent)) {
        const stmt = parent;
        
        // 确保 if 语句和渲染函数在同一函数作用域内
        if (this.isInSameFunctionScope(stmt, renderNode, functionScope)) {
          visitedIfs.add(stmt);

          // 判断渲染函数是否在 if 的某个分支中
          const inThen = this.isNodeDescendant(renderNode, stmt.consequent);
          const inElse = stmt.alternate && this.isNodeDescendant(renderNode, stmt.alternate);

          console.log(`[DEBUG] 渲染函数 ${renderCall.funcName}: 检查 if 语句, inThen=${inThen}, inElse=${inElse}`);

          if (inThen) {
            // 渲染函数在 then 分支中，需要强制执行 then 分支
            // 但也要检查 then 分支中是否有嵌套的 if return 会阻止渲染函数执行
            this.processNestedIfsWithReturnInBranch(
              renderNode,
              stmt.consequent,
              functionScope,
              visitedIfs,
              conditions
            );

            // 强制执行外层 if 的 then 分支（让渲染函数能够执行）
            const conditionStr = this.extractConditionExpression(stmt.test);
            console.log(`[DEBUG] 渲染函数在 then 分支中，条件: "${conditionStr}"`);
            conditions.push({
              condition: conditionStr,
              hasThen: true,
              hasElse: false,
              node: stmt,
            });
          } else if (inElse) {
            // 渲染函数在 else 分支中，需要强制执行 else 分支
            // 但也要检查 else 分支中是否有嵌套的 if return 会阻止渲染函数执行
            this.processNestedIfsWithReturnInBranch(
              renderNode,
              stmt.alternate,
              functionScope,
              visitedIfs,
              conditions
            );

            // 强制执行外层 if 的 else 分支（让渲染函数能够执行）
            const conditionStr = this.extractConditionExpression(stmt.test);
            console.log(`[DEBUG] 渲染函数在 else 分支中，条件: "${conditionStr}"`);
            conditions.push({
              condition: conditionStr,
              hasThen: false,
              hasElse: true,
              node: stmt,
            });
          }
        }
      }

      // 检查父节点是否是 BlockStatement 或 Program，查找其中的 if 语句
      // 这些 if 语句可能在渲染函数之前，且可能包含 return 会阻止渲染函数执行
      if (parent.type === "BlockStatement" || parent.type === "Program") {
        const statements = parent.body || [];
        
        // 检查该 BlockStatement 中所有在渲染函数之前的语句
        for (const stmt of statements) {
          // 只检查在渲染函数之前的语句
          if (stmt.end > renderNode.start) break;

          // 检查是否是 IfStatement
          if (stmt.type === "IfStatement" && !visitedIfs.has(stmt)) {
            // 确保 if 语句和渲染函数在同一函数作用域内
            if (!this.isInSameFunctionScope(stmt, renderNode, functionScope)) {
              continue;
            }

            // 如果渲染函数在这个 if 的分支中，已经在上面处理过了，跳过
            const inThen = this.isNodeDescendant(renderNode, stmt.consequent);
            const inElse = stmt.alternate && this.isNodeDescendant(renderNode, stmt.alternate);
            if (inThen || inElse) {
              continue; // 已经在上面处理过了
            }

            visitedIfs.add(stmt);

            // 渲染函数不在 if 的分支中，检查 if 分支中是否有 return 会阻止渲染函数执行
            // 这里需要递归检查所有嵌套层级的 if return
            const nestedIfsInThen = this.findNestedIfsWithReturn(
              renderNode,
              stmt.consequent,
              functionScope,
              visitedIfs
            );
            const nestedIfsInElse = stmt.alternate
              ? this.findNestedIfsWithReturn(renderNode, stmt.alternate, functionScope, visitedIfs)
              : [];

            // 添加所有嵌套的 if return
            for (const nestedIf of nestedIfsInThen) {
              if (!visitedIfs.has(nestedIf)) {
                visitedIfs.add(nestedIf);
                conditions.push({
                  condition: this.extractConditionExpression(nestedIf.test),
                  hasThen: false, // 强制条件为 false，让 return 不执行
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
                  hasThen: true, // 强制条件为 true，让 return 不执行（因为 return 在 else 分支）
                  hasElse: false,
                  node: nestedIf,
                });
              }
            }

            // 检查当前 if 的分支中是否有直接的 return（不在嵌套 if 中）
            const hasDirectReturnInThen = this.hasDirectReturn(
              renderNode,
              stmt.consequent,
              functionScope
            );
            const hasDirectReturnInElse = stmt.alternate
              ? this.hasDirectReturn(renderNode, stmt.alternate, functionScope)
              : false;

            if (hasDirectReturnInThen || hasDirectReturnInElse || nestedIfsInThen.length > 0 || nestedIfsInElse.length > 0) {
              // 如果 then 分支有 return（直接或嵌套），需要强制条件为 false（让 return 不执行）
              // 如果 else 分支有 return（直接或嵌套），需要强制条件为 true（让 return 不执行）
              conditions.push({
                condition: this.extractConditionExpression(stmt.test),
                hasThen: !hasDirectReturnInThen && nestedIfsInThen.length === 0, // then 有 return 时，hasThen=false
                hasElse: hasDirectReturnInThen || nestedIfsInThen.length > 0,  // then 有 return 时，hasElse=true
                node: stmt,
              });
            }
          }
        }
      }

      // 继续向上遍历
      currentNode = parent;
    }

    return conditions;
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
    const localVisited = new Set(); // 本地已访问集合，避免在同一分支中重复处理

    // 遍历分支节点，查找所有 if 语句
    this.walkNode(branchNode, (node) => {
      if (node.type === "IfStatement" && !localVisited.has(node) && !visitedIfs.has(node)) {
        localVisited.add(node);

        // 检查这个 if 的分支中是否有 return
        const hasReturnInThen = this.hasDirectReturn(
          renderNode,
          node.consequent,
          functionScope
        );
        const hasReturnInElse = node.alternate
          ? this.hasDirectReturn(renderNode, node.alternate, functionScope)
          : false;

        // 递归检查嵌套的 if（使用本地集合避免重复）
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
          // 也添加更深层的嵌套 if
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

    const localVisited = new Set(); // 本地已访问集合，避免在同一分支中重复处理

    // 遍历分支节点，查找所有 if 语句
    this.walkNode(branchNode, (node) => {
      if (node.type === "IfStatement" && !localVisited.has(node) && !visitedIfs.has(node)) {
        localVisited.add(node);

        // 检查这个 if 的分支中是否有 return
        const hasReturnInThen = this.hasDirectReturn(
          renderNode,
          node.consequent,
          functionScope
        );
        const hasReturnInElse = node.alternate
          ? this.hasDirectReturn(renderNode, node.alternate, functionScope)
          : false;

        // 递归检查嵌套的 if
        const deeperNestedInThen = this.findNestedIfsWithReturn(
          renderNode,
          node.consequent,
          functionScope,
          visitedIfs
        );
        const deeperNestedInElse = node.alternate
          ? this.findNestedIfsWithReturn(renderNode, node.alternate, functionScope, visitedIfs)
          : [];

        // 如果 then 分支有 return（直接或嵌套），需要强制条件为 false（让 return 不执行）
        if (hasReturnInThen || deeperNestedInThen.length > 0) {
          if (!visitedIfs.has(node)) {
            visitedIfs.add(node);
            conditions.push({
              condition: this.extractConditionExpression(node.test),
              hasThen: false, // 强制条件为 false，让 return 不执行
              hasElse: true,
              node: node,
            });
          }
          // 处理更深层的嵌套 if
          for (const nestedIf of deeperNestedInThen) {
            if (!visitedIfs.has(nestedIf)) {
              visitedIfs.add(nestedIf);
              conditions.push({
                condition: this.extractConditionExpression(nestedIf.test),
                hasThen: false, // 强制条件为 false，让 return 不执行
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
              hasThen: true, // 强制条件为 true，让 return 不执行（因为 return 在 else 分支）
              hasElse: false,
              node: node,
            });
          }
          // 处理更深层的嵌套 if
          for (const nestedIf of deeperNestedInElse) {
            if (!visitedIfs.has(nestedIf)) {
              visitedIfs.add(nestedIf);
              conditions.push({
                condition: this.extractConditionExpression(nestedIf.test),
                hasThen: true, // 强制条件为 true，让 return 不执行
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

  /**
   * 检查分支中是否有直接的 return（在当前分支的直接语句中，不在嵌套 if 中）
   * @param {Object} renderNode - 渲染函数节点
   * @param {Object} branchNode - 要检查的分支节点
   * @param {Object} functionScope - 函数作用域
   * @returns {boolean} 是否有直接的 return
   */
  hasDirectReturn(renderNode, branchNode, functionScope) {
    if (!branchNode) return false;

    // 如果分支是 BlockStatement，检查其直接子语句
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
      // 如果分支本身就是 return 语句
      if (
        branchNode.start < renderNode.start &&
        this.isInSameFunctionScope(branchNode, renderNode, functionScope)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断 node1 是否是 node2 的后代节点
   */
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

  /**
   * 检查在 renderNode 之前，targetNode 子树中是否有 return/throw（在同一函数作用域内）
   */
  hasEarlyReturn(renderNode, targetNode, functionScope) {
    if (!targetNode) return false;

    let hasReturn = false;

    this.walkNode(targetNode, (node) => {
      if (
        (node.type === "ReturnStatement" || node.type === "ThrowStatement") &&
        node.start < renderNode.start &&
        this.isInSameFunctionScope(node, renderNode, functionScope)
      ) {
        hasReturn = true;
        return true; // 停止遍历
      }
      return false;
    });

    return hasReturn;
  }

  /**
   * 判断两个节点是否在同一函数作用域内
   */
  isInSameFunctionScope(node1, node2, functionScope) {
    if (!functionScope) {
      // 都在全局作用域
      return true;
    }

    // 检查两个节点是否都在 functionScope 内
    const node1InScope = this.isNodeDescendant(node1, functionScope) || node1 === functionScope;
    const node2InScope = this.isNodeDescendant(node2, functionScope) || node2 === functionScope;

    return node1InScope && node2InScope;
  }

  /**
   * 找到包含指定节点的最内层 IfStatement
   */
  findParentIfStatement(node) {
    let current = node.parent;
    while (current) {
      if (current.type === "IfStatement") {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * 遍历 AST（通用方法）
   */
  walkAST(node, callback) {
    if (!node) return;

    if (callback(node)) return; // 如果 callback 返回 true，停止遍历

    for (const key in node) {
      if (
        key === "type" ||
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "parent"
      )
        continue;

      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((childNode) => {
          if (childNode && typeof childNode === "object") {
            this.walkAST(childNode, callback);
          }
        });
      } else if (child && typeof child === "object") {
        this.walkAST(child, callback);
      }
    }
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
        // 处理函数调用，如 abs(cA.r-cB.r)
        const callee = this.extractConditionExpression(node.callee);
        const args = node.arguments.map(arg => this.extractConditionExpression(arg)).join(", ");
        return `${callee}(${args})`;
      default:
        return "";
    }
  }

  /**
   * 提取成员表达式
   */
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

  /**
   * 检查节点是否包含渲染函数（保留用于向后兼容）
   */
  containsRenderFunction(node) {
    if (!node) return false;

    let contains = false;

    this.walkNode(node, (n) => {
      if (n.type === "CallExpression") {
        const funcName =
          n.callee.name || (n.callee.property && n.callee.property.name);
        if (this.renderFunctions.includes(funcName)) {
          contains = true;
          return true; // 停止遍历
        }
      }
      return false;
    });

    return contains;
  }

  /**
   * 遍历节点
   */
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

  /**
   * 强制条件分支执行
   * @param {string} code - 原始代码
   * @param {string|Object} conditionOrNode - 条件表达式字符串或条件对象（包含 condition 和 node）
   * @param {string} branch - 'then' 或 'else'
   * @returns {string} 修改后的代码
   */
  forceBranch(code, conditionOrNode, branch) {
    // 如果传入的是对象（包含 node），使用 AST 方式精确修改
    if (typeof conditionOrNode === "object" && conditionOrNode.node) {
      return this.forceBranchByNode(code, conditionOrNode.node, branch);
    }
    // 否则，使用字符串条件（向后兼容）
    const condition = typeof conditionOrNode === "string" 
      ? conditionOrNode 
      : conditionOrNode.condition;
    return this.forceBranchByString(code, condition, branch);
  }

  /**
   * 使用 AST 节点精确修改条件分支
   * @param {string} code - 原始代码
   * @param {Object} ifNode - IfStatement AST 节点
   * @param {string} branch - 'then' 或 'else'
   * @returns {string} 修改后的代码
   */
  forceBranchByNode(code, ifNode, branch) {
    if (!ifNode || ifNode.type !== "IfStatement") {
      console.warn(`[ConditionalAnalyzer] 无效的 ifNode:`, ifNode);
      return code;
    }

    const testStart = ifNode.test.start;
    const testEnd = ifNode.test.end;
    const forcedCondition = branch === "then" ? "true /* forced */" : "false /* forced */";
    return code.substring(0, testStart) + forcedCondition + code.substring(testEnd);
  }

  /**
   * 使用字符串匹配修改条件分支（向后兼容，不够精确）
   * @param {string} code - 原始代码
   * @param {string} condition - 条件表达式字符串
   * @param {string} branch - 'then' 或 'else'
   * @returns {string} 修改后的代码
   */
  forceBranchByString(code, condition, branch) {
    const escapedCondition = condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`if\\s*\\(${escapedCondition}\\)`, "g");
    const replacement = branch === "then" ? "if (true /* forced */)" : "if (false /* forced */)";
    return code.replace(pattern, replacement);
  }

  /**
   * 将 else/else if 转换为独立 if，并强制所有条件为 true
   * 这样可以让所有分支都在单次执行中运行
   * @param {string} code - 原始代码
   * @param {Array} conditions - 条件分支数组（从 findBranchesWithRender 获取）
   * @returns {string} 修改后的代码
   */
  convertElseToIndependentIf(code, conditions) {
    if (!conditions || conditions.length === 0) {
      return code;
    }

    // 解析代码为 AST
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 2020, locations: true, sourceType: "script" });
    } catch (e) {
      console.error("[ConditionalAnalyzer] AST 解析失败:", e);
      return code;
    }

    // 建立父子节点关系
    this.addParentLinks(ast);

    // 收集所有需要处理的 IfStatement 节点
    const ifNodesToProcess = [];
    const conditionMap = new Map(); // key: condition string, value: condition info

    // 建立条件字符串到条件信息的映射
    for (const cond of conditions) {
      const key = cond.condition;
      if (!conditionMap.has(key)) {
        conditionMap.set(key, cond);
      }
    }

    // 遍历 AST，找到所有 IfStatement 节点
    const self = this;
    function traverse(node) {
      if (!node) return;
      
      if (node.type === "IfStatement") {
        const conditionStr = self.extractConditionExpression(node.test);
        if (conditionMap.has(conditionStr)) {
          ifNodesToProcess.push({
            node: node,
            condition: conditionMap.get(conditionStr),
          });
        }
      }

      // 递归遍历子节点
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

    // 按照位置从后往前排序，避免修改时位置偏移
    ifNodesToProcess.sort((a, b) => {
      const startA = a.node.test ? a.node.test.start : a.node.start;
      const startB = b.node.test ? b.node.test.start : b.node.start;
      return startB - startA;
    });

    let modifiedCode = code;
    const modifications = []; // 存储所有修改操作

    // 收集所有需要进行的修改
    for (const { node, condition } of ifNodesToProcess) {
      // 根据条件信息决定如何修改
      // hasThen: true 表示需要执行 then 分支
      // hasElse: true 表示需要执行 else 分支
      
      console.log(`[DEBUG] 处理条件节点: "${condition.condition}", hasThen: ${condition.hasThen}, hasElse: ${condition.hasElse}, 有alternate: ${!!node.alternate}`);
      
      // 1. 处理条件表达式
      if (node.test) {
        if (condition.hasThen && !condition.hasElse) {
          // 只需要执行 then 分支，强制条件为 true
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
            value: "true",
          });
        } else if (!condition.hasThen && condition.hasElse) {
          // 只需要执行 else 分支
          if (node.alternate) {
            // 有 else 分支，强制条件为 false（不执行 then，执行 else）
            modifications.push({
              type: "forceCondition",
              start: node.test.start,
              end: node.test.end,
              value: "false",
            });
          } else {
            // 没有 else 分支，强制条件为 false（不执行 then 中的 return）
            modifications.push({
              type: "forceCondition",
              start: node.test.start,
              end: node.test.end,
              value: "false",
            });
          }
        } else if (condition.hasThen && condition.hasElse) {
          // 两个分支都需要执行，强制条件为 true，并将 else 转换为独立 if
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
            value: "true",
          });
        } else {
          // 默认情况：强制条件为 true
          modifications.push({
            type: "forceCondition",
            start: node.test.start,
            end: node.test.end,
            value: "true",
          });
        }
      }

      // 2. 如果有 else/else if，且需要执行 else 分支，转换为独立 if
      if (node.alternate && condition.hasElse) {
        console.log(`[DEBUG] 准备转换 else 分支，条件: "${condition.condition}"`);
        // 找到 else 的位置（consequent 的结束位置）
        let elseStart = node.consequent.end;
        
        // 跳过空格和换行
        while (elseStart < code.length && 
               (code[elseStart] === " " || code[elseStart] === "\n" || code[elseStart] === "\t" || code[elseStart] === "\r")) {
          elseStart++;
        }
        
        // 检查是否是 else
        if (code.substring(elseStart, elseStart + 4) === "else") {
          let elseContentStart = elseStart + 4;
          // 跳过空格
          while (elseContentStart < code.length && 
                 (code[elseContentStart] === " " || code[elseContentStart] === "\n" || code[elseContentStart] === "\t" || code[elseContentStart] === "\r")) {
            elseContentStart++;
          }

          // 检查是否是 else if
          const isElseIf = code.substring(elseContentStart, elseContentStart + 2) === "if";
          
          if (isElseIf) {
            // else if -> 转换为独立 if
            // 找到 else if 的条件表达式
            let ifStart = elseContentStart + 2;
            while (ifStart < code.length && code[ifStart] === " ") {
              ifStart++;
            }
            
            // 找到条件表达式的结束位置（右括号）
            let parenCount = 0;
            let conditionStart = ifStart;
            let conditionEnd = ifStart;
            
            if (conditionStart < code.length && code[conditionStart] === "(") {
              parenCount = 1;
              conditionStart++;
              conditionEnd = conditionStart;
              
              while (conditionEnd < code.length && parenCount > 0) {
                if (code[conditionEnd] === "(") parenCount++;
                if (code[conditionEnd] === ")") parenCount--;
                if (parenCount > 0) conditionEnd++;
              }
            }

            // 记录修改：将 "else if (condition)" 替换为 "if (true /* forced */)"
            modifications.push({
              type: "convertElseIf",
              elseStart: elseStart,
              conditionEnd: conditionEnd + 1, // 包括右括号
            });
          } else {
            // else -> 转换为独立 if (true)
            // 记录修改：将 "else" 替换为 "if (true /* forced */)"
            modifications.push({
              type: "convertElse",
              elseStart: elseStart,
              elseContentStart: elseContentStart,
            });
          }
        }
      }
    }

    // 按照位置从后往前应用修改
    modifications.sort((a, b) => {
      const posA = a.start || a.elseStart || 0;
      const posB = b.start || b.elseStart || 0;
      return posB - posA;
    });

    // 应用所有修改
    for (const mod of modifications) {
      if (mod.type === "forceCondition") {
        const value = mod.value || "true";
        console.log(`[DEBUG] 强制条件: ${code.substring(mod.start, mod.end)} -> ${value}`);
        modifiedCode =
          modifiedCode.substring(0, mod.start) +
          `${value} /* forced */` +
          modifiedCode.substring(mod.end);
      } else if (mod.type === "convertElseIf") {
        console.log(`[DEBUG] 转换 else if 为独立 if`);
        modifiedCode =
          modifiedCode.substring(0, mod.elseStart) +
          "if (true /* forced */)" +
          modifiedCode.substring(mod.conditionEnd);
      } else if (mod.type === "convertElse") {
        console.log(`[DEBUG] 转换 else 为独立 if`);
        modifiedCode =
          modifiedCode.substring(0, mod.elseStart) +
          "if (true /* forced */)" +
          modifiedCode.substring(mod.elseContentStart);
      }
    }
    
    console.log("[DEBUG] 转换后的代码:\n", modifiedCode);

    return modifiedCode;
  }
}

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = ConditionalAnalyzer;
}

// 全局可用
window.ConditionalAnalyzer = ConditionalAnalyzer;

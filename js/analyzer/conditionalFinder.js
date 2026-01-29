/**
 * 条件分支识别器
 * 识别代码中包含渲染函数的条件分支
 */

class ConditionalFinder {
  constructor() {
    // 支持的渲染函数
    this.renderFunctions = ['ellipse', 'circle', 'rect', 'line', 'point'];
  }

  /**
   * 查找所有包含渲染函数的条件分支
   * @param {string} code - 用户代码
   * @returns {Array} 条件分支数组
   */
  findConditionsWithRender(code) {
    const conditions = [];

    // 使用 Acorn 解析代码为 AST
    const ast = acorn.parse(code, { ecmaVersion: 2020 });
    this.walkAST(ast, null, conditions);

    // 过滤出包含渲染函数的条件
    return conditions.filter(c => c.hasRender);
  }

  /**
   * 遍历 AST 查找条件语句并收集渲染函数信息
   */
  walkAST(node, parentNode, conditions) {
    if (!node) return;

    // 检查当前节点是否是 IfStatement
    if (node.type === 'IfStatement') {
      const condition = this.extractCondition(node.test);
      const hasThen = this.containsRenderFunction(node.consequent);
      const hasElse = node.alternate && node.alternate.type !== 'IfStatement'
        ? this.containsRenderFunction(node.alternate)
        : false;

      if (hasThen || hasElse) {
        conditions.push({
          condition: condition,
          hasRender: true,
          hasThen: hasThen,
          hasElse: hasElse,
          node: node
        });
      }

      // 递归处理 then 和 else 分支
      if (node.consequent) {
        this.walkAST(node.consequent, node, conditions);
      }
      if (node.alternate && node.alternate.type !== 'IfStatement') {
        this.walkAST(node.alternate, node, conditions);
      } else if (node.alternate) {
        this.walkAST(node.alternate, node, conditions);
      }
    }

    // 继续遍历子节点
    for (const key in node) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;

      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(childNode => {
          if (childNode && typeof childNode === 'object') {
            this.walkAST(childNode, node, conditions);
          }
        });
      } else if (child && typeof child === 'object') {
        this.walkAST(child, node, conditions);
      }
    }
  }

  /**
   * 提取条件的字符串表示
   */
  extractCondition(node) {
    if (!node) return '';

    switch (node.type) {
      case 'BinaryExpression':
        return `${this.extractCondition(node.left)} ${node.operator} ${this.extractCondition(node.right)}`;
      case 'LogicalExpression':
        return `${this.extractCondition(node.left)} ${node.operator} ${this.extractCondition(node.right)}`;
      case 'UnaryExpression':
        return `${node.operator} ${this.extractCondition(node.argument)}`;
      case 'Identifier':
        return node.name;
      case 'Literal':
        return String(node.value);
      case 'MemberExpression':
        return this.extractMemberExpression(node);
      default:
        return '';
    }
  }

  /**
   * 提取成员表达式
   */
  extractMemberExpression(node) {
    let obj = '';
    if (node.object.type === 'Identifier') {
      obj = node.object.name;
    } else if (node.object.type === 'MemberExpression') {
      obj = this.extractMemberExpression(node.object);
    }

    const prop = node.property.name || String(node.property.value);
    return `${obj}.${prop}`;
  }

  /**
   * 检查节点是否包含渲染函数
   */
  containsRenderFunction(node) {
    if (!node) return false;

    let contains = false;

    this.walkNode(node, (n) => {
      if (n.type === 'CallExpression') {
        const funcName = n.callee.name || (n.callee.property && n.callee.property.name);
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
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;

      const child = node[key];
      if (Array.isArray(child)) {
        for (const childNode of child) {
          if (childNode && typeof childNode === 'object') {
            if (this.walkNode(childNode, callback)) return true;
          }
        }
      } else if (child && typeof child === 'object') {
        if (this.walkNode(child, callback)) return true;
      }
    }

    return false;
  }

  /**
   * 生成强制条件的代码
   * @param {string} code - 原始代码
   * @param {string} condition - 条件表达式
   * @param {string} branch - 'then' 或 'false'
   * @returns {string} 修改后的代码
   */
  forceCondition(code, condition, branch) {
    // 转义正则特殊字符
    const escapedCondition = condition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`if\\s*\\(${escapedCondition}\\)`, 'g');
    const replacement = branch === 'then' ? 'if (true /* forced */)' : 'if (false /* forced */)';
    return code.replace(pattern, replacement);
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConditionalFinder;
}

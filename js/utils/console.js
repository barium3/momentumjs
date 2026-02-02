// Console output redirection module
window.consoleManager = (function () {
  let consoleOutput = null;

  // Helper: 检测是否是对象（排除 null 和数组）
  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  // Helper: 安全地获取对象类型
  function getType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // Helper: 递归构建对象的可展开 HTML
  function buildObjectTree(obj, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) {
      return `<span class="console-string">...</span>`;
    }

    const type = getType(obj);

    // 处理基本类型
    if (!isObject(obj) && !Array.isArray(obj)) {
      return formatValue(obj);
    }

    // 处理数组
    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return `<span class="console-array-empty">[]</span>`;
      }
      const items = obj.slice(0, 10).map(item => buildObjectTree(item, depth + 1, maxDepth));
      const more = obj.length > 10 ? `, <span class="console-more">+${obj.length - 10} more</span>` : '';
      return `<span class="console-array">[${items.join(', ')}${more}]</span>`;
    }

    // 处理普通对象
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return `<span class="console-object-empty">{}</span>`;
    }

    // 生成预览（显示前几个属性）
    const previewKeys = keys.slice(0, 5);
    const preview = previewKeys.map(key => {
      const value = obj[key];
      const formattedValue = isObject(value) ? buildObjectTree(value, depth + 1, maxDepth) : formatValue(value);
      return `<span class="console-key">${escapeHtml(key)}</span>: ${formattedValue}`;
    });
    const more = keys.length > 5 ? `, <span class="console-more">+${keys.length - 5} more</span>` : '';

    return `<span class="console-object">{${
      preview.join(', ')
    }${more}}</span>`;
  }

  // Helper: 格式化基本类型的值
  function formatValue(value) {
    const type = typeof value;

    if (value === null) {
      return `<span class="console-null">null</span>`;
    }
    if (value === undefined) {
      return `<span class="console-undefined">undefined</span>`;
    }
    if (type === 'string') {
      return `<span class="console-string">"${escapeHtml(value)}"</span>`;
    }
    if (type === 'number') {
      return `<span class="console-number">${value}</span>`;
    }
    if (type === 'boolean') {
      return `<span class="console-boolean">${value}</span>`;
    }
    if (type === 'function') {
      return `<span class="console-function">ƒ ${value.name || 'anonymous'}()</span>`;
    }
    if (isObject(value)) {
      return `<span class="console-object-ref">Object</span>`;
    }

    return `<span class="console-string">${String(value)}</span>`;
  }

  // Helper: HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 创建可展开的对象详情面板
  function createObjectDetails(obj, depth = 0, messageId = null, index = null) {
    if (!isObject(obj) && !Array.isArray(obj)) {
      return '';
    }

    const type = getType(obj);
    const keys = Object.keys(obj);
    const id = 'obj-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    // 添加 data-message 和 data-index 用于匹配点击事件
    const messageAttr = messageId ? `data-message="${messageId}"` : '';
    const indexAttr = index !== null ? `data-index="${index}"` : '';

    let detailsHtml = '';

    if (Array.isArray(obj)) {
      detailsHtml = `
        <div class="console-object-details" ${messageAttr} ${indexAttr} data-id="${id}" style="display: none;">
          <div class="console-details-header">
            <span class="console-details-toggle expanded" data-target="${id}">▼</span>
            <span class="console-details-type">Array(${obj.length})</span>
          </div>
          <div class="console-details-content" id="${id}-content">
            ${obj.map((item, idx) => `
              <div class="console-details-row">
                <span class="console-details-index">${idx}</span>
                <span class="console-details-value">${formatValueForDetails(item, idx)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      const ownProps = keys.map(key => {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(obj, key);
          const value = obj[key];
          const isGetter = descriptor && typeof descriptor.get === 'function';
          return {
            key,
            value: isGetter ? '<getter>' : value,
            enumerable: descriptor ? descriptor.enumerable : true
          };
        } catch (e) {
          return { key, value: '<error>', enumerable: true };
        }
      }).filter(prop => prop.enumerable);

      detailsHtml = `
        <div class="console-object-details" ${messageAttr} ${indexAttr} data-id="${id}" style="display: none;">
          <div class="console-details-header">
            <span class="console-details-toggle expanded" data-target="${id}">▼</span>
            <span class="console-details-type">Object</span>
          </div>
          <div class="console-details-content" id="${id}-content">
            ${ownProps.map(prop => `
              <div class="console-details-row">
                <span class="console-details-key">${escapeHtml(prop.key)}</span>:
                <span class="console-details-value">${formatValueForDetails(prop.value, prop.key)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    return detailsHtml;
  }

  // 格式化详情面板中的值
  function formatValueForDetails(value, key) {
    const type = getType(value);

    if (value === null) {
      return `<span class="console-null">null</span>`;
    }
    if (value === undefined) {
      return `<span class="console-undefined">undefined</span>`;
    }
    if (typeof value === 'function') {
      return `<span class="console-function">ƒ ${value.name || 'anonymous'}()</span>`;
    }
    if (isObject(value) || Array.isArray(value)) {
      const typeLabel = Array.isArray(value) ? `Array(${value.length})` : 'Object';
      return `<span class="console-expandable" data-value='${JSON.stringify(value, null, 0)}'>${typeLabel}</span>`;
    }
    if (typeof value === 'string') {
      return `<span class="console-string">"${escapeHtml(value)}"</span>`;
    }
    if (typeof value === 'number') {
      return `<span class="console-number">${value}</span>`;
    }
    if (typeof value === 'boolean') {
      return `<span class="console-boolean">${value}</span>`;
    }

    return `<span class="console-string">${escapeHtml(String(value))}</span>`;
  }

  // 渲染单条日志
  function renderLog(args, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    let mainContent = '';
    let detailsHtml = '';

    args.forEach((arg, index) => {
      const type = getType(arg);

      if (index > 0) {
        mainContent += ' ';
      }

      if (isObject(arg) || Array.isArray(arg)) {
        // 为对象创建可展开的引用
        const refId = `${messageId}-ref-${index}`;
        const typeLabel = Array.isArray(arg) ? `Array(${arg.length})` : 'Object';
        mainContent += `<span class="console-expandable-ref" data-message="${messageId}" data-index="${index}" data-type="${type}">${typeLabel}</span>`;
        detailsHtml += createObjectDetails(arg, 0, messageId, index);
      } else {
        mainContent += formatValue(arg);
      }
    });

    const lineDiv = document.createElement('div');
    lineDiv.className = 'console-line' + (isError ? ' console-error-line' : '');
    lineDiv.innerHTML = `
      <span class="console-timestamp">[${timestamp}]</span>
      <span class="console-message">${mainContent}</span>
      ${detailsHtml}
    `;

    consoleOutput.appendChild(lineDiv);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  // 初始化
  function initConsole() {
    consoleOutput = document.getElementById("console-output");
    if (!consoleOutput) return;

    // 绑定展开/折叠事件
    consoleOutput.addEventListener('click', function(e) {
      // 展开对象详情的点击事件
      const toggle = e.target.closest('.console-details-toggle');
      if (toggle) {
        e.stopPropagation();
        const targetId = toggle.getAttribute('data-target');
        const detailsEl = document.querySelector(`.console-object-details[data-id="${targetId}"]`);
        const contentEl = document.getElementById(`${targetId}-content`);

        if (detailsEl && contentEl) {
          const isExpanded = toggle.classList.contains('expanded');
          if (isExpanded) {
            toggle.classList.remove('expanded');
            toggle.textContent = '▶';
            contentEl.style.display = 'none';
          } else {
            toggle.classList.add('expanded');
            toggle.textContent = '▼';
            contentEl.style.display = 'block';
          }
        }
        return;
      }

      // 点击可展开引用
      const ref = e.target.closest('.console-expandable-ref');
      if (ref) {
        e.stopPropagation();
        const messageId = ref.getAttribute('data-message');
        const index = parseInt(ref.getAttribute('data-index'));
        const type = ref.getAttribute('data-type');
        const detailsEl = document.querySelector(`.console-object-details[data-message="${messageId}"][data-index="${index}"]`);

        if (detailsEl) {
          const isVisible = detailsEl.style.display !== 'none';
          detailsEl.style.display = isVisible ? 'none' : 'block';
          ref.classList.toggle('expanded', !isVisible);
        }
        return;
      }

      // 点击嵌套可展开对象
      const nestedExpandable = e.target.closest('.console-expandable');
      if (nestedExpandable) {
        e.stopPropagation();
        const parentRow = nestedExpandable.closest('.console-details-row');
        const existingDetails = parentRow.querySelector('.console-nested-details');

        if (existingDetails) {
          const isVisible = existingDetails.style.display !== 'none';
          existingDetails.style.display = isVisible ? 'none' : 'block';
          nestedExpandable.classList.toggle('expanded', !isVisible);
        } else {
          // 尝试解析 data-value 属性
          try {
            const dataValue = JSON.parse(nestedExpandable.getAttribute('data-value') || '{}');
            const nestedDetails = createObjectDetails(dataValue);
            if (nestedDetails) {
              const container = document.createElement('div');
              container.className = 'console-nested-details';
              container.innerHTML = nestedDetails;
              parentRow.appendChild(container);

              // 初始化新的展开元素
              const newToggle = container.querySelector('.console-details-toggle');
              if (newToggle) {
                newToggle.addEventListener('click', handleNestedToggle);
              }

              nestedExpandable.classList.add('expanded');
            }
          } catch (err) {
            console.warn('Failed to expand object:', err);
          }
        }
        return;
      }
    });

    // 处理嵌套展开的辅助函数
    function handleNestedToggle(e) {
      e.stopPropagation();
      const toggle = e.target;
      const targetId = toggle.getAttribute('data-target');
      const detailsEl = document.querySelector(`.console-object-details[data-id="${targetId}"]`);
      const contentEl = document.getElementById(`${targetId}-content`);

      if (detailsEl && contentEl) {
        const isExpanded = toggle.classList.contains('expanded');
        if (isExpanded) {
          toggle.classList.remove('expanded');
          toggle.textContent = '▶';
          contentEl.style.display = 'none';
        } else {
          toggle.classList.add('expanded');
          toggle.textContent = '▼';
          contentEl.style.display = 'block';
        }
      }
    }

    // 覆盖 console.log
    const oldLog = console.log;
    console.log = function (...args) {
      renderLog(args, false);
      oldLog.apply(console, args);
    };

    // 覆盖 console.error
    const oldError = console.error;
    console.error = function (...args) {
      renderLog(args, true);
      oldError.apply(console, args);
    };

    // 覆盖 console.warn
    const oldWarn = console.warn;
    console.warn = function (...args) {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'console-line console-warn-line';
      lineDiv.innerHTML = `<span class="console-timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="console-warn">${args.join(' ')}</span><br>`;
      consoleOutput.appendChild(lineDiv);
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
      oldWarn.apply(console, args);
    };

    // 覆盖 console.info
    const oldInfo = console.info;
    console.info = function (...args) {
      renderLog(args, false);
      oldInfo.apply(console, args);
    };
  }

  function clearConsole() {
    if (consoleOutput) {
      consoleOutput.innerHTML = "";
    }
  }

  return {
    initConsole,
    clearConsole,
  };
})();

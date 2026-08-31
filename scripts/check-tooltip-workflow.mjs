import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../js/ui/tooltip.js", import.meta.url),
  "utf8",
);

class FakeElement {
  constructor(tagName, rect = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName || "div").toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    this.id = "";
    this.className = "";
    this.style = {};
    this.textContent = "";
    this.rect = {
      bottom: 0,
      height: 0,
      left: 0,
      top: 0,
      width: 0,
      ...rect,
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(target) {
    return target === this || this.children.some((child) =>
      child.contains(target));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

const listeners = new Map();
const windowListeners = new Map();
const scheduled = new Map();
let nextTimer = 1;
const documentElement = new FakeElement("html");
documentElement.clientWidth = 320;
documentElement.clientHeight = 180;
const body = documentElement.appendChild(new FakeElement("body"));
let tooltipElement = null;

function addListener(store, type, listener) {
  if (!store.has(type)) {
    store.set(type, []);
  }
  store.get(type).push(listener);
}

function dispatch(store, type, event = {}) {
  for (const listener of store.get(type) || []) {
    listener(event);
  }
}

function runScheduledTooltip() {
  assert.equal(scheduled.size, 1);
  const entry = scheduled.entries().next().value;
  scheduled.delete(entry[0]);
  entry[1]();
}

const context = {
  console,
  document: {
    body,
    documentElement,
    addEventListener(type, listener) {
      addListener(listeners, type, listener);
    },
    createElement(tagName) {
      const element = new FakeElement(tagName, {
        bottom: 20,
        height: 20,
        width: 116,
      });
      tooltipElement = element;
      return element;
    },
  },
  innerHeight: 180,
  innerWidth: 320,
  addEventListener(type, listener) {
    addListener(windowListeners, type, listener);
  },
  clearTimeout(timer) {
    scheduled.delete(timer);
  },
  setTimeout(callback, delay) {
    assert.equal(delay, 350);
    const timer = nextTimer;
    nextTimer += 1;
    scheduled.set(timer, callback);
    return timer;
  },
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(source, context, { filename: "tooltip.js" });
context.tooltipManager.init();
context.tooltipManager.init();

assert.equal(body.children.filter((child) =>
  child.id === "momentum-tooltip").length, 1);
assert.equal((listeners.get("mouseover") || []).length, 1);
assert.equal((listeners.get("mouseout") || []).length, 1);

const keyframeButton = body.appendChild(new FakeElement("button", {
  bottom: 32,
  height: 28,
  left: 250,
  top: 4,
  width: 28,
}));
keyframeButton.setAttribute("data-tooltip", "Add Code keyframe");
keyframeButton.setAttribute("aria-label", "Add Code keyframe");
const diamond = keyframeButton.appendChild(new FakeElement("span"));
diamond.setAttribute("aria-hidden", "true");

dispatch(listeners, "mouseover", {
  relatedTarget: null,
  target: diamond,
});
assert.equal(scheduled.size, 1);
runScheduledTooltip();
assert.equal(tooltipElement.hidden, false);
assert.equal(tooltipElement.textContent, "Add Code keyframe");
assert.ok(Number.parseInt(tooltipElement.style.left, 10) <= 198);
assert.ok(Number.parseInt(tooltipElement.style.top, 10) >= 38);

dispatch(listeners, "mouseout", {
  relatedTarget: null,
  target: diamond,
});
assert.equal(tooltipElement.hidden, true);

const ariaOnlyButton = body.appendChild(new FakeElement("button"));
ariaOnlyButton.setAttribute("aria-label", "Run code");
dispatch(listeners, "mouseover", {
  relatedTarget: null,
  target: ariaOnlyButton,
});
assert.equal(scheduled.size, 0);
assert.equal(tooltipElement.hidden, true);

const dynamicButton = body.appendChild(new FakeElement("button", {
  bottom: 174,
  height: 20,
  left: 8,
  top: 154,
  width: 20,
}));
dynamicButton.setAttribute("data-tooltip", "Dynamic action");
dynamicButton.setAttribute("aria-label", "Dynamic action");
dispatch(listeners, "mouseover", {
  relatedTarget: null,
  target: dynamicButton,
});
runScheduledTooltip();
assert.equal(tooltipElement.textContent, "Dynamic action");
assert.ok(Number.parseInt(tooltipElement.style.top, 10) < 154);
dispatch(listeners, "mousedown", { target: dynamicButton });
assert.equal(tooltipElement.hidden, true);

console.log("Tooltip workflow: OK");

// One delegated tooltip for static and dynamically created panel controls.
window.tooltipManager = (function () {
  "use strict";

  const SHOW_DELAY_MS = 350;
  const TOOLTIP_GAP = 6;
  const VIEWPORT_PADDING = 6;

  let initialized = false;
  let tooltip = null;
  let pendingTarget = null;
  let activeTarget = null;
  let showTimer = 0;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function readTooltipText(target) {
    if (!target || typeof target.getAttribute !== "function") {
      return "";
    }
    return normalizeText(target.getAttribute("data-tooltip"));
  }

  function findTooltipTarget(node) {
    let element = node && node.nodeType === 1
      ? node
      : node && node.parentElement;
    while (element && element !== document.documentElement) {
      if (
        element !== tooltip &&
        element.getAttribute("aria-hidden") !== "true" &&
        readTooltipText(element)
      ) {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function clearShowTimer() {
    if (showTimer) {
      window.clearTimeout(showTimer);
      showTimer = 0;
    }
  }

  function positionTooltip(target) {
    if (!tooltip || !target ||
        typeof target.getBoundingClientRect !== "function") {
      return;
    }
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth ||
      document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight ||
      document.documentElement.clientHeight;
    let left = targetRect.left +
      (targetRect.width - tooltipRect.width) / 2;
    let top = targetRect.bottom + TOOLTIP_GAP;

    left = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        left,
        viewportWidth - tooltipRect.width - VIEWPORT_PADDING,
      ),
    );
    if (top + tooltipRect.height + VIEWPORT_PADDING > viewportHeight) {
      top = targetRect.top - tooltipRect.height - TOOLTIP_GAP;
    }
    top = Math.max(VIEWPORT_PADDING, top);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function showPendingTooltip() {
    showTimer = 0;
    const target = pendingTarget;
    if (!target || !tooltip ||
        !document.documentElement.contains(target)) {
      hide();
      return;
    }
    const text = readTooltipText(target);
    if (!text) {
      hide();
      return;
    }
    pendingTarget = null;
    activeTarget = target;
    tooltip.textContent = text;
    tooltip.hidden = false;
    positionTooltip(target);
  }

  function hide() {
    clearShowTimer();
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.textContent = "";
    }
    pendingTarget = null;
    activeTarget = null;
  }

  function schedule(target) {
    if (!target || target === pendingTarget || target === activeTarget) {
      return;
    }
    hide();
    const text = readTooltipText(target);
    if (!text) {
      return;
    }
    pendingTarget = target;
    showTimer = window.setTimeout(showPendingTooltip, SHOW_DELAY_MS);
  }

  function handleMouseOver(event) {
    const target = findTooltipTarget(event.target);
    const previousTarget = findTooltipTarget(event.relatedTarget);
    if (target && target !== previousTarget) {
      schedule(target);
    }
  }

  function handleMouseOut(event) {
    const target = findTooltipTarget(event.target);
    const nextTarget = findTooltipTarget(event.relatedTarget);
    if (target && target !== nextTarget &&
        (target === pendingTarget || target === activeTarget)) {
      hide();
    }
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    tooltip = document.createElement("div");
    tooltip.id = "momentum-tooltip";
    tooltip.className = "momentum-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.appendChild(tooltip);

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
  }

  return {
    hide,
    init,
  };
})();

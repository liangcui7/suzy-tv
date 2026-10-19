const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "iframe[tabindex]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function isHidden(element) {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const style = window.getComputedStyle?.(element);
  return style?.display === "none" || style?.visibility === "hidden";
}

function hasUsableRect(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function center(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function primaryDistance(direction, currentRect, candidateRect) {
  switch (direction) {
    case "up":
      return currentRect.top - candidateRect.bottom;
    case "down":
      return candidateRect.top - currentRect.bottom;
    case "left":
      return currentRect.left - candidateRect.right;
    case "right":
      return candidateRect.left - currentRect.right;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function secondaryDistance(direction, currentRect, candidateRect) {
  const currentCenter = center(currentRect);
  const candidateCenter = center(candidateRect);
  if (direction === "up" || direction === "down") {
    return Math.abs(candidateCenter.x - currentCenter.x);
  }
  return Math.abs(candidateCenter.y - currentCenter.y);
}

function directionalScore(direction, currentRect, candidateRect) {
  const primary = primaryDistance(direction, currentRect, candidateRect);
  if (primary < -1) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, primary) * 1000 + secondaryDistance(direction, currentRect, candidateRect);
}

export function clearRemoteFocus(root = document) {
  root.querySelectorAll("[data-remote-focused]").forEach((focusedElement) => {
    focusedElement.removeAttribute("data-remote-focused");
  });
}

function focusElement(element) {
  clearRemoteFocus(element.ownerDocument);
  element.setAttribute("data-remote-focused", "true");
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function defaultFocusElement(elements) {
  return elements.find((element) => element.matches("[data-remote-default]")) ?? elements[0];
}

export function getRemoteFocusableElements(root = document) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    return !isHidden(element) && hasUsableRect(element);
  });
}

export function moveFocusByDirection(direction, root = document) {
  const elements = getRemoteFocusableElements(root);
  if (elements.length === 0) {
    return null;
  }

  const active = root.activeElement;
  if (!active || active === root.body || active === root.documentElement || !elements.includes(active)) {
    const next = defaultFocusElement(elements);
    focusElement(next);
    return next;
  }

  const currentRect = active.getBoundingClientRect();
  const next = elements
    .filter((element) => element !== active)
    .map((element) => ({ element, score: directionalScore(direction, currentRect, element.getBoundingClientRect()) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => a.score - b.score)[0]?.element;

  if (!next) {
    return active;
  }

  focusElement(next);
  return next;
}

export function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function getRect(source: Element | Range | Window | DOMRect | Rect): Rect {
  if (typeof Window !== 'undefined' && source instanceof Window) {
    return { top: 0, left: 0, right: source.innerWidth, bottom: source.innerHeight, width: source.innerWidth, height: source.innerHeight };
  }
  if (typeof Element !== 'undefined' && source instanceof Element) {
    const r = source.getBoundingClientRect();
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  }
  if (typeof Range !== 'undefined' && source instanceof Range) {
    const rects = source.getClientRects();
    const r = rects.length ? rects[0] : source.getBoundingClientRect();
    return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  }
  const r = source as Rect;
  return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
}

export function isVisible(element: Element | null | undefined): boolean {
  return !!(element && (element as HTMLElement).offsetParent !== null);
}

export function createElement(doc: Document, name: string, attributes: Record<string, string> = {}, children: Array<Node | string> = []): HTMLElement {
  const element = doc.createElement(name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  for (const child of children) element.append(typeof child === 'string' ? doc.createTextNode(child) : child);
  return element;
}

export function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === Node.TEXT_NODE;
}

export function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === Node.ELEMENT_NODE;
}

export function getAncestors(node: Node): Node[] {
  const ancestors: Node[] = [];
  let current: Node | null = node;
  while (current && current.nodeType !== Node.DOCUMENT_NODE) {
    ancestors.unshift(current);
    current = current.parentNode;
  }
  return ancestors;
}

/** Scrolls the window so `target` is visible; `coveredTop` is the height hidden by a sticky toolbar. */
export function scrollViewportToShowTarget(target: Element | Range, viewportOffset = 20, coveredTop = 0): void {
  const rect = getRect(target);
  const viewportHeight = window.innerHeight;
  if (rect.top < coveredTop + viewportOffset) {
    window.scrollBy(0, rect.top - coveredTop - viewportOffset);
  } else if (rect.bottom > viewportHeight - viewportOffset) {
    window.scrollBy(0, rect.bottom - viewportHeight + viewportOffset);
  }
}

export function toUnit(unit: string): (value: number) => string {
  return value => value + unit;
}

export const toPx = toUnit('px');

export function removeDomNode(node: Node): void {
  node.parentNode?.removeChild(node);
}

export function insertAt(parent: Node, index: number, node: Node): void {
  parent.insertBefore(node, parent.childNodes[index] || null);
}

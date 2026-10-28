/** Block filler rendered inside empty blocks so the caret can be placed there. */
export function BR_FILLER(domDocument: globalThis.Document): HTMLBRElement {
  const fillerBr = domDocument.createElement('br');
  fillerBr.dataset.ckeFiller = 'true';
  return fillerBr;
}

export function NBSP_FILLER(domDocument: globalThis.Document): globalThis.Text {
  return domDocument.createTextNode(' ');
}

export function MARKED_NBSP_FILLER(domDocument: globalThis.Document): HTMLSpanElement {
  const span = domDocument.createElement('span');
  span.dataset.ckeFiller = 'true';
  span.innerHTML = ' ';
  return span;
}

export const INLINE_FILLER_LENGTH = 7;
export const INLINE_FILLER = '⁠'.repeat(INLINE_FILLER_LENGTH);

export function startsWithFiller(domNode: globalThis.Node | string): boolean {
  if (typeof domNode === 'string') return domNode.substr(0, INLINE_FILLER_LENGTH) === INLINE_FILLER;
  return isDomText(domNode) && domNode.data.substr(0, INLINE_FILLER_LENGTH) === INLINE_FILLER;
}

export function isInlineFiller(domText: globalThis.Text): boolean {
  return domText.data.length === INLINE_FILLER_LENGTH && startsWithFiller(domText);
}

export function getDataWithoutFiller(domText: globalThis.Text | string): string {
  const data = typeof domText === 'string' ? domText : domText.data;
  if (startsWithFiller(data)) return data.slice(INLINE_FILLER_LENGTH);
  return data;
}

export type BlockFillerMode = 'br' | 'nbsp' | 'markedNbsp';

export function isBlockFiller(domNode: globalThis.Node, mode: BlockFillerMode = 'br'): boolean {
  if (mode === 'br') {
    return isDomElement(domNode) && domNode.tagName === 'BR' && (domNode as HTMLElement).dataset.ckeFiller === 'true';
  }
  if (isDomElement(domNode) && domNode.tagName === 'BR' && (domNode as HTMLElement).dataset.ckeFiller === 'true') return true;
  if (isDomText(domNode) && domNode.data === ' ') {
    const parent = domNode.parentNode;
    return !!parent && parent.childNodes.length === 1;
  }
  if (isDomElement(domNode) && domNode.tagName === 'SPAN' && (domNode as HTMLElement).dataset.ckeFiller === 'true') return true;
  return false;
}

export function isDomText(node: globalThis.Node | null | undefined): node is globalThis.Text {
  return !!node && node.nodeType === 3;
}

export function isDomElement(node: globalThis.Node | null | undefined): node is globalThis.Element {
  return !!node && node.nodeType === 1;
}

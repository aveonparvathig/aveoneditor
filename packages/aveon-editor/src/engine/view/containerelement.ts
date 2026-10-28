import { Element, type ElementAttributes } from './element';
import type { Document } from './document';
import type { Node } from './node';

/** Block-level structure element (paragraph, list item, table cell...). */
export class ContainerElement extends Element {
  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    this.getFillerOffset = getFillerOffset;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'containerElement' || type === 'view:containerElement' || super.is(type);
    }
    return name === this.name && (type === 'containerElement' || type === 'view:containerElement' || type === 'element' || type === 'view:element');
  }
}

export function getFillerOffset(this: Element): number | null {
  const children = Array.from(this.getChildren());
  const lastChild = children[this.childCount - 1];
  if (lastChild && (lastChild as any).is('element', 'br')) {
    return this.childCount;
  }
  for (const child of children) {
    if (!(child as any).is('uiElement')) return null;
  }
  return this.childCount;
}

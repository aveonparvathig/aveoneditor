import { Element, type ElementAttributes } from './element';
import type { Document } from './document';
import { Node } from './node';

/** Element that cannot have children (`<img>`, `<hr>`, `<br>`). */
export class EmptyElement extends Element {
  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    this.getFillerOffset = () => null;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'emptyElement' || type === 'view:emptyElement' || super.is(type);
    }
    return name === this.name && (type === 'emptyElement' || type === 'view:emptyElement' || type === 'element' || type === 'view:element');
  }

  public override _insertChild(index: number, items: any): number {
    if (items && (items instanceof Node || Array.from(items as Iterable<Node>).length > 0)) {
      throw new Error('view-emptyelement-cannot-add');
    }
    return 0;
  }
}

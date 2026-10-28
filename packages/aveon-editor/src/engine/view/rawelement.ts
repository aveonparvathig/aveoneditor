import { Element, type ElementAttributes } from './element';
import { Node } from './node';
import type { Document } from './document';
import type { DomConverter } from './domconverter';

/** Element whose DOM content is rendered by a callback and not managed by the editor (embeds, HTML snippets). */
export class RawElement extends Element {
  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    this.getFillerOffset = () => null;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'rawElement' || type === 'view:rawElement' || super.is(type);
    }
    return name === this.name && (type === 'rawElement' || type === 'view:rawElement' || type === 'element' || type === 'view:element');
  }

  public override _insertChild(index: number, items: any): number {
    if (items && (items instanceof Node || Array.from(items as Iterable<Node>).length > 0)) {
      throw new Error('view-rawelement-cannot-add');
    }
    return 0;
  }

  /** Renders the inner DOM. Override via the writer's `createRawElement()` render callback. */
  public render(domElement: HTMLElement, _domConverter?: DomConverter): void {
    void domElement;
  }
}

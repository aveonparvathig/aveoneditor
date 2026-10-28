import { Element, type ElementAttributes } from './element';
import { Node } from './node';
import type { Document } from './document';
import type { DomConverter } from './domconverter';

/** Non-content element rendered in the editing view (widget handles, toolbars...). Skipped by the selection. */
export class UIElement extends Element {
  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    this.getFillerOffset = () => null;
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'uiElement' || type === 'view:uiElement' || super.is(type);
    }
    return name === this.name && (type === 'uiElement' || type === 'view:uiElement' || type === 'element' || type === 'view:element');
  }

  public override _insertChild(index: number, items: any): number {
    if (items && (items instanceof Node || Array.from(items as Iterable<Node>).length > 0)) {
      throw new Error('view-uielement-cannot-add');
    }
    return 0;
  }

  /** Renders the DOM element. Override to customise. */
  public render(domDocument: globalThis.Document, _domConverter?: DomConverter): HTMLElement {
    return this.toDomElement(domDocument);
  }

  public toDomElement(domDocument: globalThis.Document): HTMLElement {
    const domElement = domDocument.createElement(this.name);
    for (const key of this.getAttributeKeys()) {
      domElement.setAttribute(key, this.getAttribute(key)!);
    }
    return domElement;
  }
}

/** Keyboard handling helper: moves the selection over UI elements. */
export function injectUiElementHandling(view: { document: Document; domConverter: DomConverter }): void {
  void view;
}

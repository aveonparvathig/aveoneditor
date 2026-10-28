import { Element, type ElementAttributes } from './element';
import type { Document } from './document';
import type { Node } from './node';

export const DEFAULT_PRIORITY = 10;

/** Inline formatting element (`<strong>`, `<a>`, `<span style>`). */
export class AttributeElement extends Element {
  public static readonly DEFAULT_PRIORITY = DEFAULT_PRIORITY;
  /** @internal */
  public _priority: number = DEFAULT_PRIORITY;
  /** @internal */
  public _id: string | number | null = null;
  /** @internal */
  public _clonesGroup: Set<AttributeElement> | null = null;

  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    this.getFillerOffset = getFillerOffset;
  }

  public get priority(): number {
    return this._priority;
  }

  public get id(): string | number | null {
    return this._id;
  }

  public getElementsWithSameId(): Set<AttributeElement> {
    if (this.id === null) throw new Error('attribute-element-get-elements-with-same-id-no-id');
    return new Set(this._clonesGroup);
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'attributeElement' || type === 'view:attributeElement' || super.is(type);
    }
    return name === this.name && (type === 'attributeElement' || type === 'view:attributeElement' || type === 'element' || type === 'view:element');
  }

  public override isSimilar(otherElement: Node): boolean {
    if (!(otherElement instanceof AttributeElement)) return false;
    if (this.id !== null || otherElement.id !== null) {
      return this.id === otherElement.id;
    }
    return super.isSimilar(otherElement) && this.priority === otherElement.priority;
  }

  public override _clone(deep = false): AttributeElement {
    const cloned = super._clone(deep) as AttributeElement;
    cloned._priority = this._priority;
    cloned._id = this._id;
    return cloned;
  }
}

function getFillerOffset(this: AttributeElement): number | null {
  if (nonUiChildrenCount(this)) return null;
  let element: any = this.parent;
  while (element && element.is('attributeElement')) {
    if (nonUiChildrenCount(element) > 1) return null;
    element = element.parent;
  }
  if (!element || nonUiChildrenCount(element) > 1) return null;
  return this.childCount;
}

function nonUiChildrenCount(element: Element): number {
  return Array.from(element.getChildren()).filter(element => !(element as any).is('uiElement')).length;
}

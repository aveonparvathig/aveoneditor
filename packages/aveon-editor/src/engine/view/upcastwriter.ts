import { DocumentFragment } from './documentfragment';
import { Element, type ElementAttributes } from './element';
import { Text } from './text';
import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { Selection, type Selectable, type SelectionOptions } from './selection';
import type { Document } from './document';
import type { Node } from './node';
import type { Item } from './item';

/** Writer for the data view used during upcasting (view → model). */
export class UpcastWriter {
  public readonly document: Document;

  constructor(document: Document) {
    this.document = document;
  }

  public createDocumentFragment(children?: Node | Iterable<Node>): DocumentFragment {
    return new DocumentFragment(this.document, children);
  }

  public createElement(name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>): Element {
    return new Element(this.document, name, attrs, children);
  }

  public createText(data: string): Text {
    return new Text(this.document, data);
  }

  public clone(element: Element, deep = false): Element {
    return element._clone(deep);
  }

  public appendChild(items: Item | string | Iterable<Item | string>, element: Element | DocumentFragment): number {
    return element._appendChild(items);
  }

  public insertChild(index: number, items: Item | string | Iterable<Item | string>, element: Element | DocumentFragment): number {
    return element._insertChild(index, items);
  }

  public removeChildren(index: number, howMany: number, element: Element | DocumentFragment): Node[] {
    return element._removeChildren(index, howMany);
  }

  public remove(element: Node): Node[] {
    const parent = element.parent;
    if (parent) {
      return this.removeChildren(parent.getChildIndex(element), 1, parent);
    }
    return [];
  }

  public replace(oldElement: Element, newElement: Element): boolean {
    const parent = oldElement.parent;
    if (parent) {
      const index = parent.getChildIndex(oldElement);
      this.removeChildren(index, 1, parent);
      this.insertChild(index, newElement, parent);
      return true;
    }
    return false;
  }

  public unwrapElement(element: Element): void {
    const parent = element.parent;
    if (parent) {
      const index = parent.getChildIndex(element);
      this.remove(element);
      this.insertChild(index, Array.from(element.getChildren()), parent);
    }
  }

  public rename(newName: string, element: Element): Element | null {
    const newElement = new Element(this.document, newName, element.getAttributes(), Array.from(element.getChildren()));
    return this.replace(element, newElement) ? newElement : null;
  }

  public setAttribute(key: string, value: unknown, element: Element): void {
    element._setAttribute(key, value);
  }

  public removeAttribute(key: string, element: Element): void {
    element._removeAttribute(key);
  }

  public addClass(className: string | string[], element: Element): void {
    element._addClass(className);
  }

  public removeClass(className: string | string[], element: Element): void {
    element._removeClass(className);
  }

  public setStyle(property: string | Record<string, string>, value: string | Element, element?: Element): void {
    if (typeof property === 'object') {
      (value as Element)._setStyle(property);
    } else {
      element!._setStyle(property, value as string);
    }
  }

  public removeStyle(property: string | string[], element: Element): void {
    element._removeStyle(property);
  }

  public setCustomProperty(key: string | symbol, value: unknown, element: Element | DocumentFragment): void {
    element._setCustomProperty(key, value);
  }

  public removeCustomProperty(key: string | symbol, element: Element | DocumentFragment): boolean {
    return element._removeCustomProperty(key);
  }

  public createPositionAt(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): Position {
    return Position._createAt(itemOrPosition, offset);
  }

  public createPositionAfter(item: Item): Position {
    return Position._createAfter(item);
  }

  public createPositionBefore(item: Item): Position {
    return Position._createBefore(item);
  }

  public createRange(start: Position, end?: Position | null): Range {
    return new Range(start, end);
  }

  public createRangeOn(item: Item): Range {
    return Range._createOn(item);
  }

  public createRangeIn(element: Element | DocumentFragment): Range {
    return Range._createIn(element);
  }

  public createSelection(selectable?: Selectable, placeOrOffset?: PositionOffset | SelectionOptions, options?: SelectionOptions): Selection {
    return new Selection(selectable, placeOrOffset, options);
  }
}

import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { Selection, type Selectable, type SelectionOptions } from './selection';
import { ContainerElement } from './containerelement';
import { AttributeElement } from './attributeelement';
import { EmptyElement } from './emptyelement';
import { UIElement } from './uielement';
import { RawElement } from './rawelement';
import { EditableElement } from './editableelement';
import { Text } from './text';
import { Element, type ElementAttributes } from './element';
import { DocumentFragment } from './documentfragment';
import type { Document } from './document';
import { Node } from './node';
import type { Item } from './item';
import type { DomConverter } from './domconverter';
import { isIterable } from '../../utils/misc';

export interface ElementOptions {
  priority?: number;
  id?: string | number;
  renderUnsafeAttributes?: string[];
}

/**
 * Writer for the editing/data view. Creates view elements and manipulates the tree
 * (insert, remove, wrap/unwrap with attribute elements, break/merge containers).
 */
export class DowncastWriter {
  public readonly document: Document;
  private _cloneGroups = new Map<string | number, Set<AttributeElement>>();
  private _slotFactory: any = null;

  constructor(document: Document) {
    this.document = document;
  }

  public setSelection(selectable: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | SelectionOptions, options?: SelectionOptions): void {
    this.document.selection._setTo(selectable, placeOrOffset, options);
  }

  public setSelectionFocus(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): void {
    this.document.selection._setFocus(itemOrPosition, offset);
  }

  public createDocumentFragment(children?: Node | Iterable<Node>): DocumentFragment {
    return new DocumentFragment(this.document, children);
  }

  public createText(data: string): Text {
    return new Text(this.document, data);
  }

  public createAttributeElement(name: string, attributes?: ElementAttributes, options: ElementOptions = {}): AttributeElement {
    const attributeElement = new AttributeElement(this.document, name, attributes);
    if (typeof options.priority === 'number') attributeElement._priority = options.priority;
    if (options.id) attributeElement._id = options.id;
    if (options.renderUnsafeAttributes) (attributeElement as any)._unsafeAttributesToRender.push(...options.renderUnsafeAttributes);
    return attributeElement;
  }

  public createContainerElement(name: string, attributes?: ElementAttributes, childrenOrOptions?: Node | Iterable<Node> | ElementOptions, options: ElementOptions = {}): ContainerElement {
    let children: Node | Iterable<Node> | undefined;
    if (childrenOrOptions && (childrenOrOptions instanceof Node || isIterable(childrenOrOptions))) {
      children = childrenOrOptions as any;
    } else {
      options = (childrenOrOptions as ElementOptions) || options;
    }
    const containerElement = new ContainerElement(this.document, name, attributes, children);
    if (options.renderUnsafeAttributes) (containerElement as any)._unsafeAttributesToRender.push(...options.renderUnsafeAttributes);
    return containerElement;
  }

  public createEditableElement(name: string, attributes?: ElementAttributes, options: ElementOptions = {}): EditableElement {
    const editableElement = new EditableElement(this.document, name, attributes);
    if (options.renderUnsafeAttributes) (editableElement as any)._unsafeAttributesToRender.push(...options.renderUnsafeAttributes);
    return editableElement;
  }

  public createEmptyElement(name: string, attributes?: ElementAttributes, options: ElementOptions = {}): EmptyElement {
    const emptyElement = new EmptyElement(this.document, name, attributes);
    if (options.renderUnsafeAttributes) (emptyElement as any)._unsafeAttributesToRender.push(...options.renderUnsafeAttributes);
    return emptyElement;
  }

  public createUIElement(name: string, attributes?: ElementAttributes, renderFunction?: (this: UIElement, domDocument: globalThis.Document, domConverter?: DomConverter) => HTMLElement): UIElement {
    const uiElement = new UIElement(this.document, name, attributes);
    if (renderFunction) uiElement.render = renderFunction;
    return uiElement;
  }

  public createRawElement(name: string, attributes?: ElementAttributes, renderFunction?: (this: RawElement, domElement: HTMLElement, domConverter?: DomConverter) => void, options: ElementOptions = {}): RawElement {
    const rawElement = new RawElement(this.document, name, attributes);
    if (renderFunction) rawElement.render = renderFunction;
    if (options.renderUnsafeAttributes) (rawElement as any)._unsafeAttributesToRender.push(...options.renderUnsafeAttributes);
    return rawElement;
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

  /** Breaks attribute elements at the position (or range boundaries) up to the container. */
  public breakAttributes(positionOrRange: Position | Range): Position | Range {
    if (positionOrRange instanceof Position) {
      return this._breakAttributes(positionOrRange);
    }
    return this._breakAttributesRange(positionOrRange);
  }

  /** Breaks the container element at the position. */
  public breakContainer(position: Position): Position {
    const element = position.parent as ContainerElement;
    if (!element.is('containerElement')) throw new Error('view-writer-break-non-container-element');
    if (!element.parent) throw new Error('view-writer-break-root');
    if (position.isAtStart) {
      return Position._createBefore(element);
    } else if (!position.isAtEnd) {
      const newElement = element._clone(false);
      this.insert(Position._createAfter(element), newElement);
      const sourceRange = new Range(position, Position._createAt(element, 'end'));
      const targetPosition = new Position(newElement, 0);
      this.move(sourceRange, targetPosition);
    }
    return Position._createAfter(element);
  }

  /** Merges similar attribute elements (or text nodes) around the position. */
  public mergeAttributes(position: Position): Position {
    const positionOffset = position.offset;
    const positionParent = position.parent;
    if (positionParent instanceof Text) return position;
    if ((positionParent as any)._id !== undefined && (positionParent as AttributeElement).id) return position;
    const nodeBefore = (positionParent as Element).getChild(positionOffset - 1);
    const nodeAfter = (positionParent as Element).getChild(positionOffset);
    if (!nodeBefore || !nodeAfter) return position;
    if (nodeBefore instanceof Text && nodeAfter instanceof Text) {
      return mergeTextNodes(nodeBefore, nodeAfter);
    } else if (nodeBefore instanceof AttributeElement && nodeAfter instanceof AttributeElement && nodeBefore.isSimilar(nodeAfter)) {
      const count = nodeBefore.childCount;
      nodeBefore._appendChild(Array.from(nodeAfter.getChildren()));
      nodeAfter._remove();
      this._removeFromClonedElementsGroup(nodeAfter);
      return this.mergeAttributes(new Position(nodeBefore, count));
    }
    return position;
  }

  /** Merges two container elements around the position. */
  public mergeContainers(position: Position): Position {
    const prev = position.nodeBefore as ContainerElement | null;
    const next = position.nodeAfter as ContainerElement | null;
    if (!prev || !next || !prev.is('containerElement') || !next.is('containerElement')) {
      throw new Error('view-writer-merge-containers-invalid-position');
    }
    const lastChild = prev.getChild(prev.childCount - 1);
    const newPosition = lastChild instanceof Text ? Position._createAt(lastChild, 'end') : Position._createAt(prev, 'end');
    this.move(Range._createIn(next), Position._createAt(prev, 'end'));
    this.remove(Range._createOn(next));
    return newPosition;
  }

  /** Inserts nodes at the position (breaking attribute elements as needed). */
  public insert(position: Position, nodes: Node | Iterable<Node> | DocumentFragment): Range {
    const nodeArray = nodes instanceof DocumentFragment ? Array.from(nodes.getChildren()) : isIterable(nodes) ? Array.from(nodes as Iterable<Node>) : [nodes as Node];
    validateNodesToInsert(nodeArray, this.document);
    const container = getParentContainer(position);
    if (!container) throw new Error('view-writer-invalid-position-container');
    const insertionPosition = this._breakAttributes(position, true);
    const length = (container as Element)._insertChild(insertionPosition.offset, nodeArray);
    for (const node of nodeArray) this._addToClonedElementsGroup(node);
    const endPosition = insertionPosition.getShiftedBy(length);
    const start = this.mergeAttributes(insertionPosition);
    if (!start.isEqual(insertionPosition)) {
      endPosition.offset--;
    }
    const end = this.mergeAttributes(endPosition);
    return new Range(start, end);
  }

  /** Removes the range (or item) and returns the removed nodes in a fragment. */
  public remove(rangeOrItem: Range | Item): DocumentFragment {
    const range = rangeOrItem instanceof Range ? rangeOrItem : Range._createOn(rangeOrItem);
    validateRangeContainer(range, this.document);
    if (range.isCollapsed) return new DocumentFragment(this.document);
    const { start: breakStart, end: breakEnd } = this._breakAttributesRange(range, true);
    const parentContainer = breakStart.parent as Element;
    const count = breakEnd.offset - breakStart.offset;
    const removed = parentContainer._removeChildren(breakStart.offset, count);
    for (const node of removed) this._removeFromClonedElementsGroup(node);
    const mergePosition = this.mergeAttributes(breakStart);
    range.start = mergePosition;
    range.end = mergePosition.clone();
    return new DocumentFragment(this.document, removed);
  }

  /** Removes matching elements from the range. */
  public clear(range: Range, element: Element): void {
    validateRangeContainer(range, this.document);
    const walker = range.getWalker({ direction: 'backward', ignoreElementEnd: true });
    for (const ret of walker) {
      const item = ret.item;
      let rangeToRemove: Range | undefined;
      if (item.is('element') && element.isSimilar(item as Element)) {
        rangeToRemove = Range._createOn(item);
      } else if (!ret.nextPosition.isAfter(range.start) && item.is('$textProxy')) {
        const parentElement = (item as any).getAncestors().find((ancestor: any) => ancestor.is('element') && element.isSimilar(ancestor));
        if (parentElement) rangeToRemove = Range._createIn(parentElement);
      }
      if (rangeToRemove) {
        if (rangeToRemove.end.isAfter(range.end)) rangeToRemove.end = range.end;
        if (rangeToRemove.start.isBefore(range.start)) rangeToRemove.start = range.start;
        this.remove(rangeToRemove);
      }
    }
  }

  public move(sourceRange: Range, targetPosition: Position): Range {
    let nodes: DocumentFragment;
    if (targetPosition.isAfter(sourceRange.end)) {
      targetPosition = this._breakAttributes(targetPosition, true);
      const parent = targetPosition.parent as Element;
      const countBefore = parent.childCount;
      sourceRange = this._breakAttributesRange(sourceRange, true);
      nodes = this.remove(sourceRange);
      targetPosition.offset += parent.childCount - countBefore;
    } else {
      nodes = this.remove(sourceRange);
    }
    return this.insert(targetPosition, nodes);
  }

  /** Wraps the range (or position) with the attribute element. */
  public wrap(range: Range, attribute: AttributeElement): Range {
    if (!(attribute instanceof AttributeElement)) throw new Error('view-writer-wrap-invalid-attribute');
    validateRangeContainer(range, this.document);
    if (!range.isCollapsed) {
      return this._wrapRange(range, attribute);
    }
    let position = range.start;
    if (position.parent instanceof Element && !(position.parent as Element).childCount && !(position.parent instanceof ContainerElement)) {
      position = position.getLastMatchingPosition(value => value.item.is('uiElement'));
    }
    position = this._wrapPosition(position, attribute);
    const viewSelection = this.document.selection;
    if (viewSelection.isCollapsed && viewSelection.getFirstPosition()!.isEqual(range.start)) {
      this.setSelection(position);
    }
    return new Range(position);
  }

  /** Unwraps nodes in the range from the attribute element. */
  public unwrap(range: Range, attribute: AttributeElement): Range {
    if (!(attribute instanceof AttributeElement)) throw new Error('view-writer-unwrap-invalid-attribute');
    validateRangeContainer(range, this.document);
    if (range.isCollapsed) return range;
    const { start: breakStart, end: breakEnd } = this._breakAttributesRange(range, true);
    const parentContainer = breakStart.parent as Element;
    const newRange = this._unwrapChildren(parentContainer, breakStart.offset, breakEnd.offset, attribute);
    const start = this.mergeAttributes(newRange.start);
    if (!start.isEqual(newRange.start)) newRange.end.offset--;
    const end = this.mergeAttributes(newRange.end);
    return new Range(start, end);
  }

  public rename(newName: string, viewElement: ContainerElement): ContainerElement {
    const newElement = new ContainerElement(this.document, newName, viewElement.getAttributes());
    this.insert(Position._createAfter(viewElement), newElement);
    this.move(Range._createIn(viewElement), Position._createAt(newElement, 0));
    this.remove(Range._createOn(viewElement));
    return newElement;
  }

  public clearClonedElementsGroup(groupName: string | number): void {
    this._cloneGroups.delete(groupName);
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

  /** Creates a slot element (placeholder for children conversion in structure converters). */
  public createSlot(modeOrFilter: 'children' | ((node: any) => boolean) = 'children'): Element {
    if (!this._slotFactory) throw new Error('view-writer-invalid-create-slot-context');
    return this._slotFactory(this, modeOrFilter);
  }

  /** @internal */
  public _registerSlotFactory(slotFactory: any): void {
    this._slotFactory = slotFactory;
  }

  /** @internal */
  public _clearSlotFactory(): void {
    this._slotFactory = null;
  }

  private _wrapChildren(parent: Element, startOffset: number, endOffset: number, wrapElement: AttributeElement): Range {
    let i = startOffset;
    const wrapPositions: Position[] = [];
    while (i < endOffset) {
      const child = parent.getChild(i)!;
      const isText = child instanceof Text;
      const isAttribute = child instanceof AttributeElement;
      if (isAttribute && this._wrapAttributeElement(wrapElement, child as AttributeElement)) {
        wrapPositions.push(new Position(parent, i));
      } else if (isText || !isAttribute || shouldABeOutsideB(wrapElement, child as AttributeElement)) {
        const newAttribute = wrapElement._clone();
        child._remove();
        newAttribute._appendChild(child);
        parent._insertChild(i, newAttribute);
        this._addToClonedElementsGroup(newAttribute);
        wrapPositions.push(new Position(parent, i));
      } else {
        this._wrapChildren(child as Element, 0, (child as Element).childCount, wrapElement);
      }
      i++;
    }
    let offsetChange = 0;
    for (const position of wrapPositions) {
      position.offset -= offsetChange;
      if (position.offset === startOffset) continue;
      const newPosition = this.mergeAttributes(position);
      if (!newPosition.isEqual(position)) {
        offsetChange++;
        endOffset--;
      }
    }
    return Range._createFromParentsAndOffsets(parent, startOffset, parent, endOffset);
  }

  private _unwrapChildren(parent: Element, startOffset: number, endOffset: number, unwrapElement: AttributeElement): Range {
    let i = startOffset;
    const unwrapPositions: Position[] = [];
    while (i < endOffset) {
      const child = parent.getChild(i)!;
      if (!(child instanceof AttributeElement)) {
        i++;
        continue;
      }
      if (child.isSimilar(unwrapElement)) {
        const unwrapped = Array.from(child.getChildren());
        const count = child.childCount;
        child._remove();
        parent._insertChild(i, unwrapped);
        this._removeFromClonedElementsGroup(child);
        unwrapPositions.push(new Position(parent, i), new Position(parent, i + count));
        i += count;
        endOffset += count - 1;
        continue;
      }
      if (this._unwrapAttributeElement(unwrapElement, child)) {
        unwrapPositions.push(new Position(parent, i), new Position(parent, i + 1));
        i++;
        continue;
      }
      this._unwrapChildren(child, 0, child.childCount, unwrapElement);
      i++;
    }
    let offsetChange = 0;
    for (const position of unwrapPositions) {
      position.offset -= offsetChange;
      if (position.offset === startOffset || position.offset === endOffset) continue;
      const newPosition = this.mergeAttributes(position);
      if (!newPosition.isEqual(position)) {
        offsetChange++;
        endOffset--;
      }
    }
    return Range._createFromParentsAndOffsets(parent, startOffset, parent, endOffset);
  }

  private _wrapRange(range: Range, attribute: AttributeElement): Range {
    const { start: breakStart, end: breakEnd } = this._breakAttributesRange(range, true);
    const parentContainer = breakStart.parent as Element;
    const newRange = this._wrapChildren(parentContainer, breakStart.offset, breakEnd.offset, attribute);
    const start = this.mergeAttributes(newRange.start);
    if (!start.isEqual(newRange.start)) newRange.end.offset--;
    const end = this.mergeAttributes(newRange.end);
    return new Range(start, end);
  }

  private _wrapPosition(position: Position, attribute: AttributeElement): Position {
    if (attribute.isSimilar(position.parent as Node)) {
      return movePositionToTextNode(position.clone());
    }
    if (position.parent instanceof Text) {
      position = breakTextNode(position);
    }
    const fakeElement = this.createAttributeElement('_wrapPosition-fake-element');
    fakeElement._priority = Number.POSITIVE_INFINITY;
    fakeElement.isSimilar = () => false;
    (position.parent as Element)._insertChild(position.offset, fakeElement);
    const wrapRange = new Range(position, position.getShiftedBy(1));
    this.wrap(wrapRange, attribute);
    const newPosition = new Position(fakeElement.parent!, fakeElement.index!);
    fakeElement._remove();
    const nodeBefore = newPosition.nodeBefore;
    const nodeAfter = newPosition.nodeAfter;
    if (nodeBefore instanceof Text && nodeAfter instanceof Text) {
      return mergeTextNodes(nodeBefore, nodeAfter);
    }
    return movePositionToTextNode(newPosition);
  }

  private _wrapAttributeElement(wrapper: AttributeElement, toWrap: AttributeElement): boolean {
    if (!canBeJoined(wrapper, toWrap)) return false;
    if (wrapper.name !== toWrap.name || wrapper.priority !== toWrap.priority) return false;
    for (const key of wrapper.getAttributeKeys()) {
      if (key === 'class' || key === 'style') continue;
      if (toWrap.hasAttribute(key) && toWrap.getAttribute(key) !== wrapper.getAttribute(key)) return false;
    }
    for (const key of wrapper.getStyleNames()) {
      if (toWrap.hasStyle(key) && toWrap.getStyle(key) !== wrapper.getStyle(key)) return false;
    }
    for (const key of wrapper.getAttributeKeys()) {
      if (key === 'class' || key === 'style') continue;
      if (!toWrap.hasAttribute(key)) this.setAttribute(key, wrapper.getAttribute(key), toWrap);
    }
    for (const key of wrapper.getStyleNames()) {
      if (!toWrap.hasStyle(key)) this.setStyle(key, wrapper.getStyle(key)!, toWrap);
    }
    for (const key of wrapper.getClassNames()) {
      if (!toWrap.hasClass(key)) this.addClass(key, toWrap);
    }
    return true;
  }

  private _unwrapAttributeElement(wrapper: AttributeElement, toUnwrap: AttributeElement): boolean {
    if (!canBeJoined(wrapper, toUnwrap)) return false;
    if (wrapper.name !== toUnwrap.name || wrapper.priority !== toUnwrap.priority) return false;
    for (const key of wrapper.getAttributeKeys()) {
      if (key === 'class' || key === 'style') continue;
      if (!toUnwrap.hasAttribute(key) || toUnwrap.getAttribute(key) !== wrapper.getAttribute(key)) return false;
    }
    if (!toUnwrap.hasClass(...wrapper.getClassNames())) return false;
    for (const key of wrapper.getStyleNames()) {
      if (!toUnwrap.hasStyle(key) || toUnwrap.getStyle(key) !== wrapper.getStyle(key)) return false;
    }
    for (const key of wrapper.getAttributeKeys()) {
      if (key === 'class' || key === 'style') continue;
      this.removeAttribute(key, toUnwrap);
    }
    this.removeClass(Array.from(wrapper.getClassNames()), toUnwrap);
    this.removeStyle(Array.from(wrapper.getStyleNames()), toUnwrap);
    return true;
  }

  private _breakAttributesRange(range: Range, forceSplitText = false): Range {
    const rangeStart = range.start;
    const rangeEnd = range.end;
    validateRangeContainer(range, this.document);
    if (range.isCollapsed) {
      const position = this._breakAttributes(range.start, forceSplitText);
      return new Range(position, position);
    }
    const breakEnd = this._breakAttributes(rangeEnd, forceSplitText);
    const count = (breakEnd.parent as Element).childCount;
    const breakStart = this._breakAttributes(rangeStart, forceSplitText);
    breakEnd.offset += (breakEnd.parent as Element).childCount - count;
    return new Range(breakStart, breakEnd);
  }

  private _breakAttributes(position: Position, forceSplitText = false): Position {
    const positionOffset = position.offset;
    const positionParent = position.parent;
    if ((positionParent as any).is('emptyElement')) throw new Error('view-writer-cannot-break-empty-element');
    if ((positionParent as any).is('uiElement')) throw new Error('view-writer-cannot-break-ui-element');
    if ((positionParent as any).is('rawElement')) throw new Error('view-writer-cannot-break-raw-element');
    if (!forceSplitText && positionParent instanceof Text && isContainerOrFragment(positionParent.parent!)) {
      return position.clone();
    }
    if (isContainerOrFragment(positionParent)) {
      return position.clone();
    }
    if (positionParent instanceof Text) {
      return this._breakAttributes(breakTextNode(position), forceSplitText);
    }
    const parentElement = positionParent as Element;
    const length = parentElement.childCount;
    if (positionOffset === length) {
      const newPosition = new Position(parentElement.parent!, parentElement.index! + 1);
      return this._breakAttributes(newPosition, forceSplitText);
    }
    if (positionOffset === 0) {
      const newPosition = new Position(parentElement.parent!, parentElement.index!);
      return this._breakAttributes(newPosition, forceSplitText);
    }
    const offsetAfter = parentElement.index! + 1;
    const clonedNode = parentElement._clone();
    (parentElement.parent as Element)._insertChild(offsetAfter, clonedNode);
    this._addToClonedElementsGroup(clonedNode);
    const count = parentElement.childCount - positionOffset;
    const nodesToMove = parentElement._removeChildren(positionOffset, count);
    clonedNode._appendChild(nodesToMove);
    const newPosition = new Position(parentElement.parent!, parentElement.index! + 1);
    return this._breakAttributes(newPosition, forceSplitText);
  }

  private _addToClonedElementsGroup(element: Node): void {
    if (!element.root.is('rootElement')) return;
    if (element instanceof Element) {
      for (const child of element.getChildren()) this._addToClonedElementsGroup(child);
    }
    const id = (element as AttributeElement).id;
    if (!id) return;
    let group = this._cloneGroups.get(id);
    if (!group) {
      group = new Set();
      this._cloneGroups.set(id, group);
    }
    group.add(element as AttributeElement);
    (element as AttributeElement)._clonesGroup = group;
  }

  private _removeFromClonedElementsGroup(element: Node): void {
    if (element instanceof Element) {
      for (const child of element.getChildren()) this._removeFromClonedElementsGroup(child);
    }
    const id = (element as AttributeElement).id;
    if (!id) return;
    const group = this._cloneGroups.get(id);
    if (!group) return;
    group.delete(element as AttributeElement);
  }
}

function getParentContainer(position: Position): ContainerElement | DocumentFragment | undefined {
  let parent: any = position.parent;
  while (!isContainerOrFragment(parent)) {
    if (!parent) return undefined;
    parent = parent.parent;
  }
  return parent;
}

function shouldABeOutsideB(a: AttributeElement, b: AttributeElement): boolean {
  if (a.priority < b.priority) return true;
  if (a.priority > b.priority) return false;
  return a.getIdentity() < b.getIdentity();
}

function movePositionToTextNode(position: Position): Position {
  const nodeBefore = position.nodeBefore;
  if (nodeBefore instanceof Text) return new Position(nodeBefore, nodeBefore.data.length);
  const nodeAfter = position.nodeAfter;
  if (nodeAfter instanceof Text) return new Position(nodeAfter, 0);
  return position;
}

function breakTextNode(position: Position): Position {
  const textNode = position.parent as Text;
  if (position.offset === textNode.data.length) {
    return new Position(textNode.parent!, textNode.index! + 1);
  }
  if (position.offset === 0) {
    return new Position(textNode.parent!, textNode.index!);
  }
  const textToMove = textNode.data.slice(position.offset);
  textNode._data = textNode.data.slice(0, position.offset);
  (textNode.parent as Element)._insertChild(textNode.index! + 1, new Text(textNode.document, textToMove));
  return new Position(textNode.parent!, textNode.index! + 1);
}

function mergeTextNodes(t1: Text, t2: Text): Position {
  const nodeBeforeLength = t1.data.length;
  t1._data += t2.data;
  t2._remove();
  return new Position(t1, nodeBeforeLength);
}

const validNodesToInsert = [Text, AttributeElement, ContainerElement, EmptyElement, RawElement, UIElement];

function validateNodesToInsert(nodes: Node[], errorContext: Document): void {
  for (const node of nodes) {
    if (!validNodesToInsert.some(validNode => node instanceof validNode)) {
      throw new Error('view-writer-insert-invalid-node-type');
    }
    if (!(node instanceof Text)) {
      validateNodesToInsert(Array.from((node as Element).getChildren()), errorContext);
    }
  }
}

function isContainerOrFragment(node: any): boolean {
  return node && (node.is('containerElement') || node.is('documentFragment'));
}

function validateRangeContainer(range: Range, errorContext: Document): void {
  const startContainer = getParentContainer(range.start);
  const endContainer = getParentContainer(range.end);
  if (!startContainer || !endContainer || startContainer !== endContainer) {
    throw new Error('view-writer-invalid-range-container');
  }
  void errorContext;
}

function canBeJoined(a: AttributeElement, b: AttributeElement): boolean {
  return a.id === null && b.id === null;
}

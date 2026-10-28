import { AttributeOperation } from './operation/attributeoperation';
import { InsertOperation } from './operation/insertoperation';
import { MarkerOperation } from './operation/markeroperation';
import { MergeOperation } from './operation/mergeoperation';
import { MoveOperation } from './operation/moveoperation';
import { RenameOperation } from './operation/renameoperation';
import { RootAttributeOperation } from './operation/rootattributeoperation';
import { SplitOperation } from './operation/splitoperation';
import { DocumentFragment } from './documentfragment';
import { Text } from './text';
import { Element } from './element';
import { RootElement } from './rootelement';
import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { DocumentSelection } from './documentselection';
import { TextProxy } from './textproxy';
import type { Node, NodeAttributes } from './node';
import type { Model } from './model';
import type { Batch } from './batch';
import type { Item } from './item';
import type { Selectable } from './selection';
import type { Marker } from './markercollection';
import { isIterable, toMap } from '../../utils/misc';

/**
 * The model writer: all model changes go through it and become operations in a batch.
 * Obtain it from `model.change()` or `model.enqueueChange()`.
 */
export class Writer {
  public readonly model: Model;
  public readonly batch: Batch;

  /** @internal */
  constructor(model: Model, batch: Batch) {
    this.model = model;
    this.batch = batch;
  }

  public createText(data: string, attributes?: NodeAttributes): Text {
    return new Text(data, attributes);
  }

  public createElement(name: string, attributes?: NodeAttributes): Element {
    return new Element(name, attributes);
  }

  public createDocumentFragment(): DocumentFragment {
    return new DocumentFragment();
  }

  public cloneElement(element: Element, deep = true): Element {
    return element._clone(deep);
  }

  /** Inserts an item (node, text, fragment) at the position. Attached nodes are moved. */
  public insert(item: Item | DocumentFragment, itemOrPosition: Item | Position | Element | DocumentFragment, offset: PositionOffset = 0): void {
    this._assertWriterUsedCorrectly();
    if (item instanceof Text && item.data === '') return;
    const position = Position._createAt(itemOrPosition as any, offset);
    if ((item as any).parent) {
      if (isSameTree(item.root as any, position.root)) {
        this.move(Range._createOn(item as Node), position);
        return;
      }
      if ((item as any).is('rootElement')) throw new Error('model-writer-insert-root');
      this.remove(item as Node);
    }
    const version = (position.root as any).document ? (position.root as any).document.version : null;
    const insert = new InsertOperation(position, item as any, version);
    if (item instanceof Text) insert.shouldReceiveAttributes = true;
    this.batch.addOperation(insert);
    this.model.applyOperation(insert);

    if (item instanceof DocumentFragment) {
      for (const [markerName, markerRange] of item.markers) {
        const rangeRootPosition = Position._createAt(markerRange.root, 0);
        const range = new Range(markerRange.start._getCombined(rangeRootPosition, position), markerRange.end._getCombined(rangeRootPosition, position));
        const options = { range, usingOperation: true, affectsData: true };
        if (this.model.markers.has(markerName)) {
          this.updateMarker(markerName, options);
        } else {
          this.addMarker(markerName, options);
        }
      }
    }
  }

  public insertText(text: string, attributes?: NodeAttributes | Item | Position | Element | DocumentFragment, itemOrPosition?: Item | Position | Element | DocumentFragment | PositionOffset, offset?: PositionOffset): void {
    if (attributes instanceof DocumentFragment || attributes instanceof Element || attributes instanceof Position || (attributes && (attributes as any).is)) {
      this.insert(this.createText(text), attributes as any, itemOrPosition as PositionOffset);
    } else {
      this.insert(this.createText(text, attributes as NodeAttributes), itemOrPosition as any, offset);
    }
  }

  public insertElement(name: string, attributes?: NodeAttributes | Item | Position | Element | DocumentFragment, itemOrPosition?: any, offset?: PositionOffset): void {
    if (attributes instanceof DocumentFragment || attributes instanceof Element || attributes instanceof Position || (attributes && (attributes as any).is)) {
      this.insert(this.createElement(name), attributes as any, itemOrPosition as PositionOffset);
    } else {
      this.insert(this.createElement(name, attributes as NodeAttributes), itemOrPosition, offset);
    }
  }

  public append(item: Item | DocumentFragment, parent: Element | DocumentFragment): void {
    this.insert(item, parent, 'end');
  }

  public appendText(text: string, attributes: NodeAttributes | Element | DocumentFragment, parent?: Element | DocumentFragment): void {
    if (attributes instanceof DocumentFragment || attributes instanceof Element) {
      this.insert(this.createText(text), attributes, 'end');
    } else {
      this.insert(this.createText(text, attributes), parent!, 'end');
    }
  }

  public appendElement(name: string, attributes: NodeAttributes | Element | DocumentFragment, parent?: Element | DocumentFragment): void {
    if (attributes instanceof DocumentFragment || attributes instanceof Element) {
      this.insert(this.createElement(name), attributes, 'end');
    } else {
      this.insert(this.createElement(name, attributes), parent!, 'end');
    }
  }

  public setAttribute(key: string, value: unknown, itemOrRange: Item | Range | DocumentFragment): void {
    this._assertWriterUsedCorrectly();
    if (itemOrRange instanceof Range) {
      const ranges = itemOrRange.getMinimalFlatRanges();
      for (const range of ranges) setAttributeOnRange(this, key, value, range);
    } else {
      setAttributeOnItem(this, key, value, itemOrRange as Item);
    }
  }

  public setAttributes(attributes: NodeAttributes, itemOrRange: Item | Range | DocumentFragment): void {
    for (const [key, val] of toMap(attributes as any)) {
      this.setAttribute(key as string, val, itemOrRange);
    }
  }

  public removeAttribute(key: string, itemOrRange: Item | Range | DocumentFragment): void {
    this._assertWriterUsedCorrectly();
    if (itemOrRange instanceof Range) {
      const ranges = itemOrRange.getMinimalFlatRanges();
      for (const range of ranges) setAttributeOnRange(this, key, null, range);
    } else {
      setAttributeOnItem(this, key, null, itemOrRange as Item);
    }
  }

  public clearAttributes(itemOrRange: Item | Range): void {
    this._assertWriterUsedCorrectly();
    const removeAttributesFromItem = (item: Item) => {
      for (const attribute of Array.from(item.getAttributeKeys())) {
        this.removeAttribute(attribute, item);
      }
    };
    if (!(itemOrRange instanceof Range)) {
      removeAttributesFromItem(itemOrRange);
    } else {
      for (const item of itemOrRange.getItems()) removeAttributesFromItem(item);
    }
  }

  public move(range: Range, itemOrPosition: Item | Position | Element | DocumentFragment, offset?: PositionOffset): void {
    this._assertWriterUsedCorrectly();
    if (!(range instanceof Range)) throw new Error('writer-move-invalid-range');
    if (!range.isFlat) throw new Error('writer-move-range-not-flat');
    const position = Position._createAt(itemOrPosition as any, offset);
    if (position.root !== range.root && position.root !== range.root) {
      // allowed across trees? CKEditor disallows; we require same tree.
    }
    if (!isSameTree(range.root, position.root)) throw new Error('writer-move-different-document');
    const version = (range.root as any).document ? (range.root as any).document.version : null;
    const operation = new MoveOperation(range.start, range.end.offset - range.start.offset, position, version);
    this.batch.addOperation(operation);
    this.model.applyOperation(operation);
  }

  public remove(itemOrRange: Item | Range | DocumentFragment): void {
    this._assertWriterUsedCorrectly();
    const rangeToRemove = itemOrRange instanceof Range ? itemOrRange : Range._createOn(itemOrRange as Node);
    const ranges = rangeToRemove.getMinimalFlatRanges().reverse();
    for (const flat of ranges) {
      applyRemoveOperation(flat.start, flat.end.offset - flat.start.offset, this.batch, this.model);
    }
  }

  /** Merges the two elements around the position. */
  public merge(position: Position): void {
    this._assertWriterUsedCorrectly();
    const nodeBefore = position.nodeBefore;
    const nodeAfter = position.nodeAfter;
    if (!(nodeBefore instanceof Element)) throw new Error('writer-merge-no-element-before');
    if (!(nodeAfter instanceof Element)) throw new Error('writer-merge-no-element-after');
    if (!(position.root as any).document) {
      this._mergeDetached(position);
    } else {
      this._merge(position);
    }
  }

  public createPositionFromPath(root: Element | DocumentFragment, path: number[], stickiness?: any): Position {
    return this.model.createPositionFromPath(root, path, stickiness);
  }

  public createPositionAt(itemOrPosition: any, offset?: PositionOffset): Position {
    return this.model.createPositionAt(itemOrPosition, offset);
  }

  public createPositionAfter(item: Item): Position {
    return this.model.createPositionAfter(item);
  }

  public createPositionBefore(item: Item): Position {
    return this.model.createPositionBefore(item);
  }

  public createRange(start: Position, end?: Position): Range {
    return this.model.createRange(start, end);
  }

  public createRangeIn(element: Element | DocumentFragment): Range {
    return this.model.createRangeIn(element);
  }

  public createRangeOn(element: Item): Range {
    return this.model.createRangeOn(element);
  }

  public createSelection(selectable?: any, placeOrOffset?: any, options?: any): any {
    return this.model.createSelection(selectable, placeOrOffset, options);
  }

  public rename(element: Element, newName: string): void {
    this._assertWriterUsedCorrectly();
    if (!(element instanceof Element)) throw new Error('writer-rename-not-element-instance');
    const version = (element.root as any).document ? (element.root as any).document.version : null;
    const renameOperation = new RenameOperation(Position._createBefore(element), element.name, newName, version);
    this.batch.addOperation(renameOperation);
    this.model.applyOperation(renameOperation);
  }

  /** Splits elements from the position up to the limit element. */
  public split(position: Position, limitElement?: Element | DocumentFragment): { position: Position; range: Range } {
    this._assertWriterUsedCorrectly();
    let splitElement: Element | DocumentFragment | null = position.parent;
    if (!splitElement.parent) throw new Error('writer-split-element-no-parent');
    if (!limitElement) limitElement = splitElement.parent;
    if (!(position.parent as Element).getAncestors({ includeSelf: true }).includes(limitElement)) {
      throw new Error('writer-split-invalid-limit-element');
    }
    let firstSplitElement: Element | undefined;
    let lastSplitElement: Element | undefined;
    do {
      const version = (splitElement.root as any).document ? (splitElement.root as any).document.version : null;
      const howMany = splitElement.maxOffset - position.offset;
      const insertionPosition = SplitOperation.getInsertionPosition(position);
      const split = new SplitOperation(position, howMany, insertionPosition, null, version);
      this.batch.addOperation(split);
      this.model.applyOperation(split);
      if (!firstSplitElement && !lastSplitElement) {
        firstSplitElement = splitElement as Element;
      }
      lastSplitElement = position.parent.nextSibling as Element;
      position = this.createPositionAfter(position.parent as Element);
      splitElement = position.parent;
    } while (splitElement !== limitElement);

    return { position, range: this.createRange(this.createPositionAt(firstSplitElement!, 'end'), this.createPositionAt(lastSplitElement!, 0)) };
  }

  /** Wraps the flat range with the element. */
  public wrap(range: Range, elementOrString: Element | string): void {
    this._assertWriterUsedCorrectly();
    if (!range.isFlat) throw new Error('writer-wrap-range-not-flat');
    const element = elementOrString instanceof Element ? elementOrString : new Element(elementOrString);
    if (element.childCount > 0) throw new Error('writer-wrap-element-not-empty');
    if (element.parent !== null) throw new Error('writer-wrap-element-attached');
    this.insert(element, range.start);
    const shiftedRange = new Range(range.start.getShiftedBy(1), range.end.getShiftedBy(1));
    this.move(shiftedRange, Position._createAt(element, 0));
  }

  /** Unwraps children of the element and removes it. */
  public unwrap(element: Element): void {
    this._assertWriterUsedCorrectly();
    if (element.parent === null) throw new Error('writer-unwrap-element-no-parent');
    this.move(Range._createIn(element), this.createPositionAfter(element));
    this.remove(element);
  }

  public addMarker(name: string, options: { range: Range; usingOperation: boolean; affectsData?: boolean }): Marker {
    this._assertWriterUsedCorrectly();
    if (!options || typeof options.usingOperation !== 'boolean') throw new Error('writer-addmarker-no-usingoperation');
    const usingOperation = options.usingOperation;
    const range = options.range;
    const affectsData = options.affectsData === undefined ? false : options.affectsData;
    if (this.model.markers.has(name)) throw new Error('writer-addmarker-marker-exists');
    if (!range) throw new Error('writer-addmarker-no-range');
    if (!usingOperation) {
      return this.model.markers._set(name, range, usingOperation, affectsData);
    }
    applyMarkerOperation(this, name, null, range, affectsData);
    return this.model.markers.get(name)!;
  }

  public updateMarker(markerOrName: string | Marker, options?: { range?: Range; usingOperation?: boolean; affectsData?: boolean }): void {
    this._assertWriterUsedCorrectly();
    const markerName = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    const currentMarker = this.model.markers.get(markerName);
    if (!currentMarker) throw new Error('writer-updatemarker-marker-not-exists');
    if (!options) {
      this.model.markers._refresh(currentMarker);
      return;
    }
    const hasUsingOperationDefined = typeof options.usingOperation === 'boolean';
    const affectsDataDefined = typeof options.affectsData === 'boolean';
    const affectsData = affectsDataDefined ? options.affectsData! : currentMarker.affectsData;
    if (!hasUsingOperationDefined && !options.range && !affectsDataDefined) {
      throw new Error('writer-updatemarker-wrong-options');
    }
    const currentRange = currentMarker.getRange();
    const updatedRange = options.range ? options.range : currentRange;
    if (hasUsingOperationDefined && options.usingOperation !== currentMarker.managedUsingOperations) {
      if (options.usingOperation) {
        applyMarkerOperation(this, markerName, null, updatedRange, affectsData);
      } else {
        applyMarkerOperation(this, markerName, currentRange, null, affectsData);
        this.model.markers._set(markerName, updatedRange, undefined, affectsData);
      }
      return;
    }
    if (currentMarker.managedUsingOperations) {
      applyMarkerOperation(this, markerName, currentRange, updatedRange, affectsData);
    } else {
      this.model.markers._set(markerName, updatedRange, undefined, affectsData);
    }
  }

  public removeMarker(markerOrName: string | Marker): void {
    this._assertWriterUsedCorrectly();
    const name = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    if (!this.model.markers.has(name)) throw new Error('writer-removemarker-no-marker');
    const marker = this.model.markers.get(name)!;
    if (!marker.managedUsingOperations) {
      this.model.markers._remove(name);
      return;
    }
    const oldRange = marker.getRange();
    applyMarkerOperation(this, name, oldRange, null, marker.affectsData);
  }

  public addRoot(rootName: string, elementName = '$root'): RootElement {
    this._assertWriterUsedCorrectly();
    const doc = this.model.document;
    const root = doc.getRoot(rootName) || doc.createRoot(elementName, rootName);
    root._setAttached(true);
    return root;
  }

  public setSelection(selectable: Selectable, placeOrOffset?: any, options?: { backward?: boolean }): void {
    this._assertWriterUsedCorrectly();
    this.model.document.selection._setTo(selectable, placeOrOffset, options);
  }

  public setSelectionFocus(itemOrPosition: Item | Position | Element, offset?: PositionOffset): void {
    this._assertWriterUsedCorrectly();
    this.model.document.selection._setFocus(itemOrPosition as any, offset);
  }

  public setSelectionAttribute(keyOrObjectOrIterable: string | Record<string, unknown> | Iterable<[string, unknown]>, value?: unknown): void {
    this._assertWriterUsedCorrectly();
    if (typeof keyOrObjectOrIterable === 'string') {
      this._setSelectionAttribute(keyOrObjectOrIterable, value);
    } else {
      for (const [key, val] of toMap(keyOrObjectOrIterable as any)) {
        this._setSelectionAttribute(key as string, val);
      }
    }
  }

  public removeSelectionAttribute(keyOrIterableOfKeys: string | Iterable<string>): void {
    this._assertWriterUsedCorrectly();
    if (typeof keyOrIterableOfKeys === 'string') {
      this._removeSelectionAttribute(keyOrIterableOfKeys);
    } else {
      for (const key of keyOrIterableOfKeys) this._removeSelectionAttribute(key);
    }
  }

  public overrideSelectionGravity(): string {
    return this.model.document.selection._overrideGravity();
  }

  public restoreSelectionGravity(uid: string): void {
    this.model.document.selection._restoreGravity(uid);
  }

  private _setSelectionAttribute(key: string, value: unknown): void {
    const selection = this.model.document.selection;
    if (selection.isCollapsed && (selection.anchor!.parent as Element).isEmpty) {
      const storeKey = DocumentSelection._getStoreAttributeKey(key);
      this.setAttribute(storeKey, value, selection.anchor!.parent as Element);
    }
    selection._setAttribute(key, value);
  }

  private _removeSelectionAttribute(key: string): void {
    const selection = this.model.document.selection;
    if (selection.isCollapsed && (selection.anchor!.parent as Element).isEmpty) {
      const storeKey = DocumentSelection._getStoreAttributeKey(key);
      this.removeAttribute(storeKey, selection.anchor!.parent as Element);
    }
    selection._removeAttribute(key);
  }

  private _assertWriterUsedCorrectly(): void {
    if (this !== this.model._currentWriter) {
      throw new Error('writer-incorrect-use: Trying to use a writer outside the change() block.');
    }
  }

  private _mergeDetached(position: Position): void {
    const nodeBefore = position.nodeBefore as Element;
    const nodeAfter = position.nodeAfter as Element;
    this.move(Range._createIn(nodeAfter), Position._createAt(nodeBefore, 'end'));
    this.remove(nodeAfter);
  }

  private _merge(position: Position): void {
    const nodeBefore = position.nodeBefore as Element;
    const nodeAfter = position.nodeAfter as Element;
    const targetPosition = Position._createAt(nodeBefore, 'end');
    const graveyard = this.model.document.graveyard;
    const graveyardPosition = new Position(graveyard, [0]);
    const version = (position.root as any).document.version;
    const merge = new MergeOperation(Position._createAt(nodeAfter, 0), nodeAfter.maxOffset, targetPosition, graveyardPosition, version);
    this.batch.addOperation(merge);
    this.model.applyOperation(merge);
  }
}

function setAttributeOnRange(writer: Writer, key: string, value: unknown, range: Range): void {
  const model = writer.model;
  const doc = model.document;
  const normalizedValue = value === undefined ? null : value;
  let lastSplitPosition: Position = range.start;
  let position: Position | null = null;
  let valueBefore: unknown = null;
  let valueAfter: unknown = null;

  const addOperation = () => {
    const opRange = new Range(lastSplitPosition, position!);
    const version = (opRange.root as any).document ? doc.version : null;
    const operation = new AttributeOperation(opRange, key, valueBefore, normalizedValue, version);
    writer.batch.addOperation(operation);
    model.applyOperation(operation);
  };

  for (const val of range.getWalker({ shallow: true })) {
    const attr = val.item.getAttribute(key);
    valueAfter = attr === undefined ? null : attr;
    if (position && valueBefore !== valueAfter) {
      if (valueBefore !== normalizedValue) {
        addOperation();
      }
      lastSplitPosition = position;
    }
    position = val.nextPosition;
    valueBefore = valueAfter;
  }
  if (position instanceof Position && position !== lastSplitPosition && valueBefore !== normalizedValue) {
    addOperation();
  }
}

function setAttributeOnItem(writer: Writer, key: string, value: unknown, item: Item): void {
  const model = writer.model;
  const doc = model.document;
  const prev = item.getAttribute(key);
  const previousValue = prev === undefined ? null : prev;
  if (value === undefined) value = null;
  let range: Range;
  let operation: AttributeOperation | RootAttributeOperation;
  if (previousValue !== value) {
    const isRootChanged = (item as any).is('rootElement');
    if (isRootChanged) {
      const version = (item as RootElement).document ? doc.version : null;
      operation = new RootAttributeOperation(item as RootElement, key, previousValue, value, version);
    } else {
      range = new Range(Position._createBefore(item as Node), writer.createPositionAfter(item));
      const version = (range.root as any).document ? doc.version : null;
      operation = new AttributeOperation(range, key, previousValue, value, version);
    }
    writer.batch.addOperation(operation);
    model.applyOperation(operation);
  }
}

function applyMarkerOperation(writer: Writer, name: string, oldRange: Range | null, newRange: Range | null, affectsData: boolean): void {
  const model = writer.model;
  const doc = model.document;
  const operation = new MarkerOperation(name, oldRange, newRange, model.markers, !!affectsData, doc.version);
  writer.batch.addOperation(operation);
  model.applyOperation(operation);
}

function applyRemoveOperation(position: Position, howMany: number, batch: Batch, model: Model): void {
  let operation: MoveOperation;
  if ((position.root as any).document) {
    const doc = model.document;
    const graveyardPosition = new Position(doc.graveyard, [0]);
    operation = new MoveOperation(position, howMany, graveyardPosition, doc.version);
  } else {
    const detachedRoot = position.root as DocumentFragment | Element;
    // Detached tree: move to a throw-away fragment.
    const holder = new DocumentFragment();
    operation = new MoveOperation(position, howMany, new Position(holder, [0]), null);
    void detachedRoot;
  }
  batch.addOperation(operation);
  model.applyOperation(operation);
}

function isSameTree(rootA: Element | DocumentFragment, rootB: Element | DocumentFragment): boolean {
  if (rootA === rootB) return true;
  if (rootA instanceof RootElement && rootB instanceof RootElement) return true;
  return false;
}

export { isIterable, TextProxy };

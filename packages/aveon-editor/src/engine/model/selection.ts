import { Emitter } from '../../utils/emitter';
import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { Element } from './element';
import { Text } from './text';
import type { Node } from './node';
import { DocumentFragment } from './documentfragment';
import { TextProxy } from './textproxy';
import { isIterable } from '../../utils/misc';
import type { Schema } from './schema';

export type Selectable = Selection | Position | Range | Node | Iterable<Range> | Element | DocumentFragment | TextProxy | null;

/**
 * Model selection: one or more ranges, a direction and attributes.
 */
export class Selection extends Emitter {
  protected _ranges: Range[] = [];
  protected _lastRangeBackward = false;
  protected _attrs = new Map<string, unknown>();

  constructor(selectable?: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | { backward?: boolean }, options?: { backward?: boolean }) {
    super();
    if (selectable) {
      this.setTo(selectable, placeOrOffset as any, options);
    }
  }

  public get anchor(): Position | null {
    if (this._ranges.length > 0) {
      const range = this._ranges[this._ranges.length - 1];
      return this._lastRangeBackward ? range.end : range.start;
    }
    return null;
  }

  public get focus(): Position | null {
    if (this._ranges.length > 0) {
      const range = this._ranges[this._ranges.length - 1];
      return this._lastRangeBackward ? range.start : range.end;
    }
    return null;
  }

  public get isCollapsed(): boolean {
    const length = this._ranges.length;
    if (length === 1) return this._ranges[0].isCollapsed;
    return false;
  }

  public get rangeCount(): number {
    return this._ranges.length;
  }

  public get isBackward(): boolean {
    return !this.isCollapsed && this._lastRangeBackward;
  }

  public isEqual(otherSelection: Selection): boolean {
    if (this.rangeCount !== otherSelection.rangeCount) return false;
    if (this.rangeCount === 0) return true;
    if (!this.anchor!.isEqual(otherSelection.anchor!) || !this.focus!.isEqual(otherSelection.focus!)) return false;
    for (const thisRange of this._ranges) {
      let found = false;
      for (const otherRange of otherSelection._ranges) {
        if (thisRange.isEqual(otherRange)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  public *getRanges(): IterableIterator<Range> {
    for (const range of this._ranges) yield new Range(range.start, range.end);
  }

  public getFirstRange(): Range | null {
    let first: Range | null = null;
    for (const range of this._ranges) {
      if (!first || range.start.isBefore(first.start)) first = range;
    }
    return first ? new Range(first.start, first.end) : null;
  }

  public getLastRange(): Range | null {
    let last: Range | null = null;
    for (const range of this._ranges) {
      if (!last || range.end.isAfter(last.end)) last = range;
    }
    return last ? new Range(last.start, last.end) : null;
  }

  public getFirstPosition(): Position | null {
    const first = this.getFirstRange();
    return first ? first.start.clone() : null;
  }

  public getLastPosition(): Position | null {
    const last = this.getLastRange();
    return last ? last.end.clone() : null;
  }

  public setTo(selectable: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | { backward?: boolean }, options?: { backward?: boolean }): void {
    if (selectable === null) {
      this._setRanges([]);
    } else if (selectable instanceof Selection) {
      this._setRanges(selectable.getRanges(), selectable.isBackward);
    } else if (selectable && typeof (selectable as any).getRanges === 'function') {
      this._setRanges((selectable as any).getRanges(), (selectable as any).isBackward);
    } else if (selectable instanceof Range) {
      this._setRanges([selectable], !!(placeOrOffset && (placeOrOffset as any).backward));
    } else if (selectable instanceof Position) {
      this._setRanges([new Range(selectable)]);
    } else if (selectable instanceof Element || selectable instanceof DocumentFragment || selectable instanceof Text || selectable instanceof TextProxy || (selectable as any).is?.('node')) {
      const node = selectable as any;
      const backward = !!(options && options.backward);
      let range: Range;
      if (placeOrOffset === 'in') {
        range = Range._createIn(node);
      } else if (placeOrOffset === 'on') {
        range = Range._createOn(node);
      } else if (placeOrOffset !== undefined) {
        range = new Range(Position._createAt(node, placeOrOffset as PositionOffset));
      } else {
        throw new Error('model-selection-setto-required-second-parameter');
      }
      this._setRanges([range], backward);
    } else if (isIterable(selectable)) {
      this._setRanges(selectable as Iterable<Range>, !!(placeOrOffset && (placeOrOffset as any).backward));
    } else {
      throw new Error('model-selection-setto-not-selectable');
    }
  }

  public setFocus(itemOrPosition: Position | Node | Element | DocumentFragment, offset?: PositionOffset): void {
    if (this.anchor === null) throw new Error('model-selection-setfocus-no-ranges');
    const newFocus = Position._createAt(itemOrPosition as any, offset);
    if (newFocus.compareWith(this.focus!) === 'same') return;
    const anchor = this.anchor;
    if (this._ranges.length) {
      this._popRange();
    }
    if (newFocus.compareWith(anchor) === 'before') {
      this._pushRange(new Range(newFocus, anchor));
      this._lastRangeBackward = true;
    } else {
      this._pushRange(new Range(anchor, newFocus));
      this._lastRangeBackward = false;
    }
    this.fire('change:range', { directChange: true });
  }

  public getAttribute(key: string): unknown {
    return this._attrs.get(key);
  }

  public getAttributes(): Iterable<[string, unknown]> {
    return this._attrs.entries();
  }

  public getAttributeKeys(): Iterable<string> {
    return this._attrs.keys();
  }

  public hasAttribute(key: string): boolean {
    return this._attrs.has(key);
  }

  public removeAttribute(key: string): void {
    if (this.hasAttribute(key)) {
      this._attrs.delete(key);
      this.fire('change:attribute', { attributeKeys: [key], directChange: true });
    }
  }

  public setAttribute(key: string, value: unknown): void {
    if (this.getAttribute(key) !== value) {
      this._attrs.set(key, value);
      this.fire('change:attribute', { attributeKeys: [key], directChange: true });
    }
  }

  /** Element selected as a whole (single range exactly wrapping one element), or `null`. */
  public getSelectedElement(): Element | null {
    if (this.rangeCount !== 1) return null;
    return this.getFirstRange()!.getContainedElement();
  }

  public is(type: string): boolean {
    return type === 'selection' || type === 'model:selection';
  }

  /** Yields top-most blocks touched by the selection. */
  public *getSelectedBlocks(): IterableIterator<Element> {
    const visited = new WeakSet<Element>();
    const schema = getSchema(this);
    if (!schema) return;

    for (const range of this.getRanges()) {
      const startBlock = getParentBlock(range.start, visited, schema);
      if (startBlock && isTopBlockInRange(startBlock, range, schema)) {
        yield startBlock;
      }
      for (const value of range.getWalker()) {
        const block = value.item;
        if (value.type === 'elementEnd' && block instanceof Element && isUnvisitedTopBlock(block, visited, range, schema)) {
          yield block;
        }
      }
      const endBlock = getParentBlock(range.end, visited, schema);
      if (endBlock && !range.end.isTouching(Position._createAt(endBlock, 0)) && isTopBlockInRange(endBlock, range, schema)) {
        yield endBlock;
      }
    }
  }

  public containsEntireContent(element?: Element): boolean {
    const el = element || (this.anchor!.root as Element);
    const limitStartPosition = Position._createAt(el, 0);
    const limitEndPosition = Position._createAt(el, 'end');
    return limitStartPosition.isTouching(this.getFirstPosition()!) && limitEndPosition.isTouching(this.getLastPosition()!);
  }

  protected _setRanges(newRanges: Iterable<Range>, isLastBackward = false): void {
    const ranges = Array.from(newRanges);
    const anyNewRange = ranges.some(newRange => {
      if (!(newRange instanceof Range)) throw new Error('model-selection-set-ranges-not-range');
      return this._ranges.every(oldRange => !oldRange.isEqual(newRange));
    });
    if (ranges.length === this._ranges.length && !anyNewRange) return;
    this._replaceAllRanges(ranges);
    this._lastRangeBackward = !!isLastBackward;
    this.fire('change:range', { directChange: true });
  }

  protected _replaceAllRanges(ranges: Range[]): void {
    this._removeAllRanges();
    for (const range of ranges) this._pushRange(range);
  }

  protected _removeAllRanges(): void {
    while (this._ranges.length > 0) this._popRange();
  }

  protected _popRange(): void {
    this._ranges.pop();
  }

  protected _pushRange(range: Range): void {
    this._checkRange(range);
    this._ranges.push(new Range(range.start, range.end));
  }

  protected _checkRange(range: Range): void {
    for (const stored of this._ranges) {
      if (range.isIntersecting(stored)) throw new Error('model-selection-range-intersects');
    }
  }
}

function getSchema(selection: Selection): Schema | null {
  const anchor = selection.anchor;
  if (!anchor) return null;
  const root: any = anchor.root;
  if (root.is && root.is('rootElement')) return root.document.model.schema;
  return (selection as any)._schema ?? null;
}

function getParentBlock(position: Position, visited: WeakSet<Element>, schema: Schema): Element | null {
  const element = position.parent;
  if (element instanceof DocumentFragment) return null;
  const ancestors = element.getAncestors({ parentFirst: true, includeSelf: true }) as Element[];
  const block = ancestors.find(el => el instanceof Element && schema.isBlock(el));
  if (block && !visited.has(block)) {
    visited.add(block);
    return block;
  }
  return null;
}

function isUnvisitedBlock(node: Element, visited: WeakSet<Element>, schema: Schema): boolean {
  if (visited.has(node)) return false;
  if (!schema.isBlock(node)) return false;
  visited.add(node);
  return true;
}

function isUnvisitedTopBlock(block: Element, visited: WeakSet<Element>, range: Range, schema: Schema): boolean {
  return isUnvisitedBlock(block, visited, schema) && isTopBlockInRange(block, range, schema);
}

function isTopBlockInRange(block: Element, range: Range, schema: Schema): boolean {
  const parentBlock = findAncestorBlock(block, schema);
  if (!parentBlock) return true;
  const parentBlockRange = Range._createOn(parentBlock);
  return !range.containsRange(parentBlockRange, true);
}

function findAncestorBlock(node: Element, schema: Schema): Element | undefined {
  let parent = node.parent;
  while (parent) {
    if (parent instanceof Element && schema.isBlock(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

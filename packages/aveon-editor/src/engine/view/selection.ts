import { Emitter } from '../../utils/emitter';
import { Position, type PositionOffset } from './position';
import { Range } from './range';
import { Node } from './node';
import { Element } from './element';
import { DocumentFragment } from './documentfragment';
import { EditableElement } from './editableelement';
import { TextProxy } from './textproxy';
import type { Item } from './item';
import { isIterable, count } from '../../utils/misc';

export type Selectable = Selection | Position | Range | Node | Iterable<Range> | DocumentFragment | TextProxy | null;

export interface SelectionOptions {
  backward?: boolean;
  fake?: boolean;
  label?: string;
}

/** View selection: ranges, direction and fake selection support. */
export class Selection extends Emitter {
  protected _ranges: Range[] = [];
  protected _lastRangeBackward = false;
  protected _isFake = false;
  protected _fakeSelectionLabel = '';

  constructor(selectable?: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | SelectionOptions, options?: SelectionOptions) {
    super();
    if (selectable) this.setTo(selectable, placeOrOffset as any, options);
  }

  public get isFake(): boolean {
    return this._isFake;
  }

  public get fakeSelectionLabel(): string {
    return this._fakeSelectionLabel;
  }

  public get anchor(): Position | null {
    if (!this._ranges.length) return null;
    const range = this._ranges[this._ranges.length - 1];
    const anchor = this._lastRangeBackward ? range.end : range.start;
    return anchor.clone();
  }

  public get focus(): Position | null {
    if (!this._ranges.length) return null;
    const range = this._ranges[this._ranges.length - 1];
    const focus = this._lastRangeBackward ? range.start : range.end;
    return focus.clone();
  }

  public get isCollapsed(): boolean {
    return this.rangeCount === 1 && this._ranges[0].isCollapsed;
  }

  public get rangeCount(): number {
    return this._ranges.length;
  }

  public get isBackward(): boolean {
    return !this.isCollapsed && this._lastRangeBackward;
  }

  public get editableElement(): EditableElement | null {
    if (this.anchor) return this.anchor.editableElement;
    return null;
  }

  public *getRanges(): IterableIterator<Range> {
    for (const range of this._ranges) yield range.clone();
  }

  public getFirstRange(): Range | null {
    let first: Range | null = null;
    for (const range of this._ranges) {
      if (!first || range.start.isBefore(first.start)) first = range;
    }
    return first ? first.clone() : null;
  }

  public getLastRange(): Range | null {
    let last: Range | null = null;
    for (const range of this._ranges) {
      if (!last || range.end.isAfter(last.end)) last = range;
    }
    return last ? last.clone() : null;
  }

  public getFirstPosition(): Position | null {
    const firstRange = this.getFirstRange();
    return firstRange ? firstRange.start.clone() : null;
  }

  public getLastPosition(): Position | null {
    const lastRange = this.getLastRange();
    return lastRange ? lastRange.end.clone() : null;
  }

  public isEqual(otherSelection: Selection): boolean {
    if (this.isFake !== otherSelection.isFake) return false;
    if (this.isFake && this.fakeSelectionLabel !== otherSelection.fakeSelectionLabel) return false;
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

  public isSimilar(otherSelection: Selection): boolean {
    if (this.isBackward !== otherSelection.isBackward) return false;
    const numOfRangesA = count(this.getRanges());
    const numOfRangesB = count(otherSelection.getRanges());
    if (numOfRangesA !== numOfRangesB) return false;
    if (numOfRangesA === 0) return true;
    for (let rangeA of this.getRanges()) {
      rangeA = rangeA.getTrimmed();
      let found = false;
      for (let rangeB of otherSelection.getRanges()) {
        rangeB = rangeB.getTrimmed();
        if (rangeA.start.isEqual(rangeB.start) && rangeA.end.isEqual(rangeB.end)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  public getSelectedElement(): Element | null {
    if (this.rangeCount !== 1) return null;
    return this.getFirstRange()!.getContainedElement();
  }

  public setTo(selectable: Selectable, placeOrOffset?: PositionOffset | 'in' | 'on' | SelectionOptions, options?: SelectionOptions): void {
    if (selectable === null) {
      this._setRanges([]);
      this._setFakeOptions(placeOrOffset as SelectionOptions);
    } else if (selectable instanceof Selection || (selectable && typeof (selectable as any).is === 'function' && (selectable as any).is('documentSelection'))) {
      const source = selectable as Selection;
      this._setRanges(source.getRanges(), source.isBackward);
      this._setFakeOptions({ fake: source.isFake, label: source.fakeSelectionLabel });
    } else if (selectable instanceof Range) {
      this._setRanges([selectable], !!(placeOrOffset && (placeOrOffset as SelectionOptions).backward));
      this._setFakeOptions(placeOrOffset as SelectionOptions);
    } else if (selectable instanceof Position) {
      this._setRanges([new Range(selectable)]);
      this._setFakeOptions(placeOrOffset as SelectionOptions);
    } else if (selectable instanceof Node || selectable instanceof DocumentFragment || selectable instanceof TextProxy) {
      const backward = !!options && !!options.backward;
      let range: Range;
      if (placeOrOffset === undefined) throw new Error('view-selection-setto-required-second-parameter');
      if (placeOrOffset === 'in') {
        range = Range._createIn(selectable as Element);
      } else if (placeOrOffset === 'on') {
        range = Range._createOn(selectable as Item);
      } else {
        range = new Range(Position._createAt(selectable as any, placeOrOffset as PositionOffset));
      }
      this._setRanges([range], backward);
      this._setFakeOptions(options);
    } else if (isIterable(selectable)) {
      this._setRanges(selectable as Iterable<Range>, !!(placeOrOffset && (placeOrOffset as SelectionOptions).backward));
      this._setFakeOptions(placeOrOffset as SelectionOptions);
    } else {
      throw new Error('view-selection-setto-not-selectable');
    }
    this.fire('change');
  }

  public setFocus(itemOrPosition: Item | Position | DocumentFragment, offset?: PositionOffset): void {
    if (this.anchor === null) throw new Error('view-selection-setfocus-no-ranges');
    const newFocus = Position._createAt(itemOrPosition as any, offset);
    if (newFocus.compareWith(this.focus!) === 'same') return;
    const anchor = this.anchor;
    this._ranges.pop();
    if (newFocus.compareWith(anchor) === 'before') {
      this._addRange(new Range(newFocus, anchor), true);
    } else {
      this._addRange(new Range(anchor, newFocus));
    }
    this.fire('change');
  }

  public is(type: string): boolean {
    return type === 'selection' || type === 'view:selection';
  }

  protected _setRanges(newRanges: Iterable<Range>, isLastBackward = false): void {
    const ranges = Array.from(newRanges);
    this._ranges = [];
    for (const range of ranges) this._addRange(range);
    this._lastRangeBackward = !!isLastBackward;
  }

  protected _setFakeOptions(options: SelectionOptions = {}): void {
    this._isFake = !!options.fake;
    this._fakeSelectionLabel = options.fake ? options.label || '' : '';
  }

  protected _addRange(range: Range, isBackward = false): void {
    if (!(range instanceof Range)) throw new Error('view-selection-add-range-not-range');
    this._pushRange(range);
    this._lastRangeBackward = !!isBackward;
  }

  protected _pushRange(range: Range): void {
    for (const storedRange of this._ranges) {
      if (range.isIntersecting(storedRange)) throw new Error('view-selection-range-intersects');
    }
    this._ranges.push(new Range(range.start, range.end));
  }
}

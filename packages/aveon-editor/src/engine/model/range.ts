import { Position, type PositionOffset } from './position';
import { TreeWalker, type TreeWalkerOptions, type TreeWalkerValue } from './treewalker';
import { Element } from './element';
import type { Node } from './node';
import type { TextProxy } from './textproxy';
import type { DocumentFragment } from './documentfragment';
import type { Operation } from './operation/operation';
import type { InsertOperation } from './operation/insertoperation';
import type { MoveOperation } from './operation/moveoperation';
import type { SplitOperation } from './operation/splitoperation';
import type { MergeOperation } from './operation/mergeoperation';
import type { Item } from './item';

/** A range between two positions in the model tree. */
export class Range implements Iterable<TreeWalkerValue> {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position, end?: Position | null) {
    this.start = Position._createAt(start);
    this.end = end ? Position._createAt(end) : Position._createAt(start);
    this.start.stickiness = this.isCollapsed ? 'toNone' : 'toNext';
    this.end.stickiness = this.isCollapsed ? 'toNone' : 'toPrevious';
  }

  public [Symbol.iterator](): Iterator<TreeWalkerValue> {
    return new TreeWalker({ boundaries: this, ignoreElementEnd: true });
  }

  public get isCollapsed(): boolean {
    return this.start.isEqual(this.end);
  }

  public get isFlat(): boolean {
    return this.start.hasSameParentAs(this.end);
  }

  public get root(): Element | DocumentFragment {
    return this.start.root;
  }

  public containsPosition(position: Position): boolean {
    return position.isAfter(this.start) && position.isBefore(this.end);
  }

  public containsRange(otherRange: Range, loose = false): boolean {
    if (otherRange.isCollapsed) loose = false;
    const containsStart = this.containsPosition(otherRange.start) || (loose && this.start.isEqual(otherRange.start));
    const containsEnd = this.containsPosition(otherRange.end) || (loose && this.end.isEqual(otherRange.end));
    return containsStart && containsEnd;
  }

  public containsItem(item: Item): boolean {
    const pos = Position._createBefore(item as any);
    return this.containsPosition(pos) || this.start.isEqual(pos);
  }

  public is(type: string): boolean {
    return type === 'range' || type === 'model:range';
  }

  public isEqual(otherRange: Range): boolean {
    return this.start.isEqual(otherRange.start) && this.end.isEqual(otherRange.end);
  }

  public isIntersecting(otherRange: Range): boolean {
    return this.start.isBefore(otherRange.end) && this.end.isAfter(otherRange.start);
  }

  public getDifference(otherRange: Range): Range[] {
    const ranges: Range[] = [];
    if (this.isIntersecting(otherRange)) {
      if (this.containsPosition(otherRange.start)) {
        ranges.push(new Range(this.start, otherRange.start));
      }
      if (this.containsPosition(otherRange.end)) {
        ranges.push(new Range(otherRange.end, this.end));
      }
    } else {
      ranges.push(new Range(this.start, this.end));
    }
    return ranges;
  }

  public getIntersection(otherRange: Range): Range | null {
    if (this.isIntersecting(otherRange)) {
      let commonRangeStart = this.start;
      let commonRangeEnd = this.end;
      if (this.containsPosition(otherRange.start)) commonRangeStart = otherRange.start;
      if (this.containsPosition(otherRange.end)) commonRangeEnd = otherRange.end;
      return new Range(commonRangeStart, commonRangeEnd);
    }
    return null;
  }

  public getJoined(otherRange: Range, loose = false): Range | null {
    let shouldJoin = this.isIntersecting(otherRange);
    if (!shouldJoin) {
      if (this.start.isBefore(otherRange.start)) {
        shouldJoin = loose ? this.end.isTouching(otherRange.start) : this.end.isEqual(otherRange.start);
      } else {
        shouldJoin = loose ? otherRange.end.isTouching(this.start) : otherRange.end.isEqual(this.start);
      }
    }
    if (!shouldJoin) return null;
    let startPosition = this.start;
    let endPosition = this.end;
    if (otherRange.start.isBefore(startPosition)) startPosition = otherRange.start;
    if (otherRange.end.isAfter(endPosition)) endPosition = otherRange.end;
    return new Range(startPosition, endPosition);
  }

  /** Splits the range into the minimal set of flat ranges. */
  public getMinimalFlatRanges(): Range[] {
    const ranges: Range[] = [];
    const diffAt = this.start.getCommonPath(this.end).length;
    const pos = Position._createAt(this.start);
    let posParent = pos.parent;

    while (pos.path.length > diffAt + 1) {
      const howMany = posParent.maxOffset - pos.offset;
      if (howMany !== 0) {
        ranges.push(new Range(pos, pos.getShiftedBy(howMany)));
      }
      pos.path = pos.path.slice(0, -1);
      pos.offset++;
      posParent = posParent.parent as Element;
    }

    while (pos.path.length <= this.end.path.length) {
      const offset = this.end.path[pos.path.length - 1];
      const howMany = offset - pos.offset;
      if (howMany !== 0) {
        ranges.push(new Range(pos, pos.getShiftedBy(howMany)));
      }
      pos.offset = offset;
      pos.path.push(0);
    }
    return ranges;
  }

  public getWalker(options: Partial<TreeWalkerOptions> = {}): TreeWalker {
    return new TreeWalker({ ...options, boundaries: this });
  }

  public *getItems(options: Partial<TreeWalkerOptions> = {}): IterableIterator<Element | TextProxy> {
    const walker = new TreeWalker({ ...options, boundaries: this, ignoreElementEnd: true });
    for (const value of walker) yield value.item;
  }

  public *getPositions(options: Partial<TreeWalkerOptions> = {}): IterableIterator<Position> {
    const walker = new TreeWalker({ ...options, boundaries: this });
    yield walker.position;
    for (const value of walker) yield value.nextPosition;
  }

  public getCommonAncestor(): Element | DocumentFragment | null {
    return this.start.getCommonAncestor(this.end);
  }

  public getContainedElement(): Element | null {
    if (this.isCollapsed) return null;
    const nodeAfterStart = this.start.nodeAfter;
    const nodeBeforeEnd = this.end.nodeBefore;
    if (nodeAfterStart && nodeAfterStart instanceof Element && nodeAfterStart === nodeBeforeEnd) {
      return nodeAfterStart;
    }
    return null;
  }

  public clone(): Range {
    return new Range(this.start, this.end);
  }

  public toJSON(): { start: unknown; end: unknown } {
    return { start: this.start.toJSON(), end: this.end.toJSON() };
  }

  // Transformations ---------------------------------------------------------

  public getTransformedByOperation(operation: Operation): Range[] {
    switch (operation.type) {
      case 'insert':
        return this._getTransformedByInsertOperation(operation as InsertOperation);
      case 'move':
      case 'remove':
      case 'reinsert':
        return this._getTransformedByMoveOperation(operation as MoveOperation);
      case 'split':
        return [this._getTransformedBySplitOperation(operation as SplitOperation)];
      case 'merge':
        return [this._getTransformedByMergeOperation(operation as MergeOperation)];
    }
    return [new Range(this.start, this.end)];
  }

  public getTransformedByOperations(operations: Iterable<Operation>): Range[] {
    const ranges: Range[] = [new Range(this.start, this.end)];
    for (const operation of operations) {
      for (let i = 0; i < ranges.length; i++) {
        const result = ranges[i].getTransformedByOperation(operation);
        ranges.splice(i, 1, ...result);
        i += result.length - 1;
      }
    }
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      for (let j = i + 1; j < ranges.length; j++) {
        const next = ranges[j];
        if (range.containsRange(next) || next.containsRange(range) || range.isEqual(next)) {
          ranges.splice(j, 1);
        }
      }
    }
    return ranges;
  }

  /** @internal */
  public _getTransformedByInsertOperation(operation: InsertOperation, spread = false): Range[] {
    return this._getTransformedByInsertion(operation.position, operation.howMany, spread);
  }

  /** @internal */
  public _getTransformedByMoveOperation(operation: MoveOperation, spread = false): Range[] {
    return this._getTransformedByMove(operation.sourcePosition, operation.targetPosition, operation.howMany, spread);
  }

  /** @internal */
  public _getTransformedBySplitOperation(operation: SplitOperation): Range {
    const start = this.start._getTransformedBySplitOperation(operation);
    let end = this.end._getTransformedBySplitOperation(operation);
    if (this.end.isEqual(operation.insertionPosition)) {
      end = this.end.getShiftedBy(1);
    }
    if (start.root !== end.root) {
      end = this.end.getShiftedBy(-1);
    }
    return new Range(start, end);
  }

  /** @internal */
  public _getTransformedByMergeOperation(operation: MergeOperation): Range {
    if (this.start.isEqual(operation.targetPosition) && this.end.isEqual(operation.deletionPosition)) {
      return new Range(this.start);
    }
    let start = this.start._getTransformedByMergeOperation(operation);
    let end = this.end._getTransformedByMergeOperation(operation);
    if (start.root !== end.root) {
      end = this.end.getShiftedBy(-1);
    }
    if (start.isAfter(end)) {
      if (operation.sourcePosition.isBefore(operation.targetPosition)) {
        start = Position._createAt(end);
        start.offset = 0;
      } else {
        if (!operation.deletionPosition.isEqual(start)) {
          end = operation.deletionPosition;
        }
        start = operation.targetPosition;
      }
    }
    return new Range(start, end);
  }

  /** @internal */
  public _getTransformedByInsertion(insertPosition: Position, howMany: number, spread = false): Range[] {
    if (spread && this.containsPosition(insertPosition)) {
      return [new Range(this.start, insertPosition), new Range(insertPosition.getShiftedBy(howMany), this.end._getTransformedByInsertion(insertPosition, howMany))];
    }
    const range = new Range(this.start, this.end);
    (range as any).start = range.start._getTransformedByInsertion(insertPosition, howMany);
    (range as any).end = range.end._getTransformedByInsertion(insertPosition, howMany);
    return [range];
  }

  /** @internal */
  public _getTransformedByMove(sourcePosition: Position, targetPosition: Position, howMany: number, spread = false): Range[] {
    if (this.isCollapsed) {
      const newPos = this.start._getTransformedByMove(sourcePosition, targetPosition, howMany);
      return [new Range(newPos)];
    }
    const moveRange = Range._createFromPositionAndShift(sourcePosition, howMany);
    const insertPosition = targetPosition._getTransformedByDeletion(sourcePosition, howMany)!;

    if (targetPosition.hasSameParentAs(this.start) && moveRange.containsRange(this, true)) {
      return [new Range(this.start._getCombined(moveRange.start, insertPosition), this.end._getCombined(moveRange.start, insertPosition))];
    }

    const differenceSet = this.getDifference(moveRange);
    let difference: Range | null = null;
    const common = this.getIntersection(moveRange);

    if (differenceSet.length === 1) {
      difference = new Range(differenceSet[0].start._getTransformedByDeletion(sourcePosition, howMany)!, differenceSet[0].end._getTransformedByDeletion(sourcePosition, howMany)!);
    } else if (differenceSet.length === 2) {
      difference = new Range(this.start, this.end._getTransformedByDeletion(sourcePosition, howMany)!);
    }

    let result: Range[] = [];
    if (difference) {
      result = difference._getTransformedByInsertion(insertPosition, howMany, common !== null || spread);
    }
    if (common) {
      const transformedCommon = new Range(common.start._getCombined(moveRange.start, insertPosition), common.end._getCombined(moveRange.start, insertPosition));
      if (result.length === 2) {
        result.splice(1, 0, transformedCommon);
      } else {
        result.push(transformedCommon);
      }
    }
    return result;
  }

  /** @internal */
  public _getTransformedByDeletion(deletePosition: Position, howMany: number): Range | null {
    let newStart = this.start._getTransformedByDeletion(deletePosition, howMany);
    let newEnd = this.end._getTransformedByDeletion(deletePosition, howMany);
    if (newStart === null && newEnd === null) return null;
    if (newStart === null) newStart = deletePosition;
    if (newEnd === null) newEnd = deletePosition;
    return new Range(newStart, newEnd);
  }

  // Static factories --------------------------------------------------------

  public static _createFromPositionAndShift(position: Position, shift: number): Range {
    const start = position;
    const end = position.getShiftedBy(shift);
    return shift > 0 ? new this(start, end) : new this(end, start);
  }

  public static _createIn(element: Element | DocumentFragment): Range {
    return new this(Position._createAt(element, 0), Position._createAt(element, element.maxOffset));
  }

  public static _createOn(item: Node | TextProxy): Range {
    return this._createFromPositionAndShift(Position._createBefore(item), item.offsetSize);
  }

  public static _createFromRanges(ranges: Range[]): Range {
    if (ranges.length === 0) throw new Error('range-create-from-ranges-empty-array');
    if (ranges.length === 1) return ranges[0].clone();
    const ref = ranges[0];
    ranges.sort((a, b) => (a.start.isAfter(b.start) ? 1 : -1));
    const refIndex = ranges.indexOf(ref);
    const result = new this(ref.start, ref.end);
    if (refIndex > 0) {
      for (let i = refIndex - 1; true; i--) {
        if (ranges[i].end.isEqual(result.start)) {
          (result as any).start = Position._createAt(ranges[i].start);
        } else {
          break;
        }
      }
    }
    for (let i = refIndex + 1; i < ranges.length; i++) {
      if (ranges[i].start.isEqual(result.end)) {
        (result as any).end = Position._createAt(ranges[i].end);
      } else {
        break;
      }
    }
    return result;
  }

  public static _createAt(itemOrPosition: Position | Node | Element | DocumentFragment, offset?: PositionOffset): Range {
    return new this(Position._createAt(itemOrPosition as any, offset));
  }

  public static fromJSON(json: any, doc: any): Range {
    return new this(Position.fromJSON(json.start, doc), Position.fromJSON(json.end, doc));
  }
}
